"""目の表示（試作）：通常・眠い・うれしい・起こす の表情とまばたきを pygame で描く。

    python3 -m eyes.eye_display                          # 全画面（ラズパイの DSI 用）
    python3 -m eyes.eye_display --windowed               # PC でウィンドウ表示
    python3 -m eyes.eye_display --expression sleepy      # 最初の表情を指定
    python3 -m eyes.eye_display --darkness 0.0           # 昼の配色（0.0=昼、1.0=夜）
    python3 -m eyes.eye_display --save-frames out/       # 画面なしで表情ごとの PNG を保存して確認

    python3 -m eyes.eye_display --link                   # 本体（app.py）と連携：状態を読み、タッチでメニュー・会話開始

連携なしのときのキー：1=通常 2=眠い 3=うれしい 4=起こす 8=聞いている 9=考え中 0=眠り、5=昼 6=夜 7=時刻で自動、Esc か Q で終了。
実機で調整する値（色・大きさ・位置）は下の定数にまとめている（Issue #28）。
"""

from __future__ import annotations

import argparse
import datetime
import logging
import os
import time
from pathlib import Path

import pygame

import integration_config as config

from .eye_state import EXPRESSIONS, DarknessEstimator, EyeFrame, EyeState, Expression
from .ipc import CommandSender, DisplayState, read_state
from .menu import BACK_BUTTON, SCREEN_SIZE as MENU_SCREEN_SIZE, TALK_BUTTON, MenuState, Screen

logger = logging.getLogger(__name__)

# 実機で調整する値
SCREEN_SIZE = MENU_SCREEN_SIZE  # 5インチ DSI ディスプレイ（800×480。メニューのボタン位置もこの大きさが前提）
# 夜の配色：暗い背景に明るい目（寝室でまぶしくない）
NIGHT_BACKGROUND = (16, 20, 24)
NIGHT_EYE = (240, 236, 224)
NIGHT_PUPIL = (20, 24, 28)
# 昼の配色：ほんのり色づいた白い背景に、白目と黒い瞳（液晶でも瞳がはっきり見えるよう、コントラストを強くする）
DAY_BACKGROUND = (255, 238, 196)  # 黄色すぎたので薄くした。もっと白くするなら G・B を上げる
DAY_EYE = (255, 255, 255)
DAY_PUPIL = (28, 24, 22)
HIGHLIGHT_COLOR = (255, 255, 255)
EYE_WIDTH_RATIO = 0.22  # 画面の幅に対する目の幅
EYE_HEIGHT_RATIO = 0.55  # 画面の高さに対する目の高さ（開いているとき）
EYE_GAP_RATIO = 0.20  # 画面の幅に対する、左右の目の中心間隔
EYE_CENTER_Y_RATIO = 0.5
MIN_VISIBLE_HEIGHT = 6  # 閉じたときも、線として残す高さ（px）
GAZE_MAX_OFFSET = 0.12  # 目の大きさに対する視線のずれの最大割合
SMILE_CUT_SHIFT = 0.22  # 笑い目：下から切り取る楕円を、目の高さの何割ずらすか（小さいほど細い三日月）
SMILE_RECENTER = 0.2  # 笑い目のとき、目全体を下げる量（目の高さに対する割合）
SMILE_HIDE_PUPIL = 0.25  # 笑いがこの値を超えたら瞳を描かない
CLOSED_LID = 0.8  # まぶたがこれを超えたら、目を閉じた線で描く（眠り）
CLOSED_LINE_HEIGHT_RATIO = 0.035  # 閉じた目の線の太さ（画面の高さに対する割合）

Color = tuple[int, int, int]


class Palette:
    """暗さ（0.0=昼、1.0=夜）から混ぜた配色。"""

    def __init__(self, darkness: float) -> None:
        self.background = _mix(DAY_BACKGROUND, NIGHT_BACKGROUND, darkness)
        self.eye = _mix(DAY_EYE, NIGHT_EYE, darkness)
        self.pupil = _mix(DAY_PUPIL, NIGHT_PUPIL, darkness)
        self.closed_line = _mix(DAY_PUPIL, NIGHT_EYE, darkness)  # 閉じた目の線：昼は暗い色、夜は明るい色（背景と区別できるように）


def _mix(day: Color, night: Color, darkness: float) -> Color:
    d = min(1.0, max(0.0, darkness))
    return (
        int(day[0] + (night[0] - day[0]) * d),
        int(day[1] + (night[1] - day[1]) * d),
        int(day[2] + (night[2] - day[2]) * d),
    )


KEY_TO_EXPRESSION = {
    pygame.K_1: Expression.NORMAL,
    pygame.K_2: Expression.SLEEPY,
    pygame.K_3: Expression.HAPPY,
    pygame.K_4: Expression.WAKE,
    pygame.K_8: Expression.LISTEN,
    pygame.K_9: Expression.THINK,
    pygame.K_0: Expression.SLEEP,
}


def draw_eyes(surface: pygame.Surface, frame: EyeFrame, darkness: float = 1.0) -> None:
    palette = Palette(darkness)
    width, height = surface.get_size()
    surface.fill(palette.background)
    eye_w = int(width * EYE_WIDTH_RATIO * frame.scale)
    full_h = int(height * EYE_HEIGHT_RATIO * frame.scale)
    eye_h = max(MIN_VISIBLE_HEIGHT, int(full_h * frame.openness))
    center_y = int(height * EYE_CENTER_Y_RATIO + full_h * SMILE_RECENTER * frame.smile)  # 笑い目は上に寄るので下げる
    gap = int(width * EYE_GAP_RATIO)
    for sign in (-1, 1):
        center_x = width // 2 + sign * gap
        _draw_one_eye(surface, center_x, center_y, eye_w, eye_h, full_h, frame, palette)


def _draw_one_eye(
    surface: pygame.Surface, cx: int, cy: int, w: int, h: int, full_h: int, frame: EyeFrame, palette: Palette
) -> None:
    if frame.lid > CLOSED_LID:
        line_h = max(MIN_VISIBLE_HEIGHT, int(surface.get_height() * CLOSED_LINE_HEIGHT_RATIO))
        line = pygame.Rect(0, 0, w, line_h)
        line.center = (cx, cy + full_h // 8)  # 目の中心より少し下に、閉じた線を引く
        pygame.draw.rect(surface, palette.closed_line, line, border_radius=line_h // 2)
        return
    rect = pygame.Rect(0, 0, w, h)
    rect.center = (cx, cy)
    pygame.draw.ellipse(surface, palette.eye, rect)
    if h >= full_h * 0.35 and frame.smile < SMILE_HIDE_PUPIL:
        _draw_pupil(surface, rect, cx, cy, w, full_h, frame, palette)
    if frame.smile > 0.01:
        cut = rect.copy()
        cut.centery = rect.centery + int(h * SMILE_CUT_SHIFT * frame.smile)
        pygame.draw.ellipse(surface, palette.background, cut)  # 下を丸く切り取って笑い目（三日月）にする
    if frame.lid > 0.01:
        lid = pygame.Rect(rect.left - 2, rect.top - 2, rect.width + 4, int(h * frame.lid) + 2)
        pygame.draw.rect(surface, palette.background, lid)  # 上まぶた（眠いとき）


def _draw_pupil(
    surface: pygame.Surface, rect: pygame.Rect, cx: int, cy: int, w: int, full_h: int, frame: EyeFrame,
    palette: Palette,
) -> None:
    pupil_r = int(min(w, full_h) * 0.30 * frame.pupil)
    offset_x = int(frame.gaze_x * frame.gaze_range * w * GAZE_MAX_OFFSET)
    offset_y = int(frame.gaze_y * frame.gaze_range * full_h * GAZE_MAX_OFFSET)
    px, py = cx + offset_x, cy + offset_y
    clip_before = surface.get_clip()
    surface.set_clip(rect)  # まぶたの外には瞳をはみ出させない
    pygame.draw.circle(surface, palette.pupil, (px, py), pupil_r)
    pygame.draw.circle(surface, HIGHLIGHT_COLOR, (px - pupil_r // 3, py - pupil_r // 3), max(3, pupil_r // 5))
    surface.set_clip(clip_before)


# メニューの文字。日本語フォントがないときは英字で代用する（ラズパイには fonts-noto-cjk を入れる）
FONT_CANDIDATES = "notosanscjkjp,notosansjp,notosanscjk,takaogothic,ipagothic,ipaexgothic,droidsansfallback,vlgothic"
MENU_TEXT = {"talk": ("話す", "TALK"), "busy": ("会話中…", "..."), "back": ("もどる", "BACK")}


def load_fonts() -> tuple[tuple[pygame.font.Font, pygame.font.Font], bool]:
    """((大きい文字, 小さい文字), 日本語が出るか)"""
    path = pygame.font.match_font(FONT_CANDIDATES)
    return (pygame.font.Font(path, 110), pygame.font.Font(path, 52)), path is not None


def draw_menu(surface: pygame.Surface, state: DisplayState, darkness: float, fonts: tuple[pygame.font.Font, pygame.font.Font], has_jp: bool) -> None:
    """fonts は (大きい文字, 小さい文字)。「話す」は大きく、「もどる」は小さく"""
    palette = Palette(darkness)
    surface.fill(palette.background)
    label_color = palette.pupil
    talk_text = MENU_TEXT["busy" if state.busy else "talk"][0 if has_jp else 1]
    talk_fill = _mix(palette.eye, palette.background, 0.6) if state.busy else palette.eye  # 会話中は薄くして押せないと示す
    back_text = MENU_TEXT["back"][0 if has_jp else 1]
    for rect, text, fill, font in ((TALK_BUTTON, talk_text, talk_fill, fonts[0]), (BACK_BUTTON, back_text, palette.eye, fonts[1])):
        box = pygame.Rect(rect)
        pygame.draw.rect(surface, fill, box, border_radius=40)
        label = font.render(text, True, label_color)
        surface.blit(label, label.get_rect(center=box.center))


def run(windowed: bool, expression: Expression, darkness: float | None, link: bool = False) -> None:
    pygame.init()
    flags = 0 if windowed else pygame.FULLSCREEN
    screen = pygame.display.set_mode(SCREEN_SIZE, flags)
    pygame.display.set_caption("ねるコッコ 目（試作）")
    pygame.mouse.set_visible(windowed)
    clock = pygame.time.Clock()
    state = EyeState(time.monotonic())
    state.set_expression(expression)
    ambient = DarknessEstimator(initial=1.0 if darkness is None else darkness)
    auto = darkness is None  # --darkness 指定なしなら、時刻で自動
    menu = MenuState(config.MENU_TIMEOUT_SEC)
    sender = CommandSender(config.DISPLAY_COMMAND_PATH) if link else None
    fonts, has_jp = load_fonts()
    link_state = DisplayState()
    running = True
    while running:
        now = time.monotonic()
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.MOUSEBUTTONDOWN and link:  # DSI のタッチはマウスとして届く（マルチタッチなし）
                result = menu.tap(now, event.pos, link_state)
                if result.command and sender:
                    sender.send(result.command)
                    logger.info("本体に送りました：%s", result.command)
            elif event.type == pygame.KEYDOWN:
                if event.key in (pygame.K_ESCAPE, pygame.K_q):
                    running = False
                elif event.key in KEY_TO_EXPRESSION and not link:
                    state.set_expression(KEY_TO_EXPRESSION[event.key])
                elif event.key == pygame.K_5:
                    auto = False
                    ambient.force(0.0)
                elif event.key == pygame.K_6:
                    auto = False
                    ambient.force(1.0)
                elif event.key == pygame.K_7:
                    auto = True
        if link:
            received = read_state(config.DISPLAY_STATE_PATH, time.time(), config.DISPLAY_STALE_SEC)
            if received is not None:  # 本体が止まっているあいだは、最後の状態のまま目だけ動かす
                link_state = received
                state.set_expression(_expression_of(received))
            menu.tick(now, link_state)
        if auto:
            ambient.update(now, hour=datetime.datetime.now().hour)  # 照度センサーの値は、連携時に lux= で渡す
        if link and menu.screen is Screen.MENU:
            draw_menu(screen, link_state, ambient.value, fonts, has_jp)
        else:
            draw_eyes(screen, state.update(now), ambient.value)
        pygame.display.flip()
        clock.tick(config.DISPLAY_FPS)
    pygame.quit()


def _expression_of(state: DisplayState) -> Expression:
    try:
        return Expression(state.expression)
    except ValueError:
        return Expression.NORMAL  # 知らない表情名は通常にする


def save_frames(directory: Path) -> None:
    """画面なし（dummy ドライバ）で、表情×昼夜の静止画（まばたきなし）を PNG に保存する。確認用。"""
    os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
    pygame.init()
    surface = pygame.Surface(SCREEN_SIZE)
    directory.mkdir(parents=True, exist_ok=True)
    for expression, params in EXPRESSIONS.items():
        frame = EyeFrame(
            openness=1.0, gaze_x=0.0, gaze_y=0.0, lid=params.lid, smile=params.smile,
            scale=params.scale, pupil=params.pupil, gaze_range=params.gaze_range,
        )
        for name, darkness in (("day", 0.0), ("night", 1.0)):
            draw_eyes(surface, frame, darkness)
            pygame.image.save(surface, str(directory / f"{expression.value}_{name}.png"))
    fonts, has_jp = load_fonts()
    for name, darkness in (("day", 0.0), ("night", 1.0)):
        for busy in (False, True):
            draw_menu(surface, DisplayState(busy=busy), darkness, fonts, has_jp)
            pygame.image.save(surface, str(directory / f"menu{'_busy' if busy else ''}_{name}.png"))
    logger.info("表情ごとの PNG を保存しました：%s", directory)
    pygame.quit()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    parser = argparse.ArgumentParser(description="目の表示（試作）")
    parser.add_argument("--windowed", action="store_true", help="全画面でなくウィンドウで表示する")
    parser.add_argument("--expression", choices=[e.value for e in Expression], default="normal")
    parser.add_argument("--darkness", type=float, help="暗さ 0.0=昼 〜 1.0=夜（指定すると固定。なければ時刻で自動）")
    parser.add_argument("--link", action="store_true", help="本体（app.py）と連携する：状態ファイルを読み、タッチでメニューを開く")
    parser.add_argument("--save-frames", type=Path, help="画面なしで PNG を保存するフォルダ（確認用）")
    args = parser.parse_args()
    if args.save_frames:
        save_frames(args.save_frames)
    else:
        run(args.windowed, Expression(args.expression), args.darkness, args.link)


if __name__ == "__main__":
    main()
