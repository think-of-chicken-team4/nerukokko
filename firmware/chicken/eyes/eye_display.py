"""目の表示（試作）：通常・眠い・うれしい・起こす の表情とまばたきを pygame で描く。

    python3 -m eyes.eye_display                          # 全画面（ラズパイの DSI 用）
    python3 -m eyes.eye_display --windowed               # PC でウィンドウ表示
    python3 -m eyes.eye_display --expression sleepy      # 最初の表情を指定
    python3 -m eyes.eye_display --save-frames out/       # 画面なしで表情ごとの PNG を保存して確認

キー：1=通常 2=眠い 3=うれしい 4=起こす、Esc か Q で終了。
実機で調整する値（色・大きさ・位置）は下の定数にまとめている（Issue #28）。
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from pathlib import Path

import pygame

from .eye_state import EXPRESSIONS, EyeFrame, EyeState, Expression

logger = logging.getLogger(__name__)

# 実機で調整する値
SCREEN_SIZE = (800, 480)  # 5インチ DSI ディスプレイ
FPS = 60
BACKGROUND = (16, 20, 24)  # 夜でもまぶしくない暗い背景
EYE_COLOR = (240, 236, 224)
PUPIL_COLOR = (20, 24, 28)
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

KEY_TO_EXPRESSION = {
    pygame.K_1: Expression.NORMAL,
    pygame.K_2: Expression.SLEEPY,
    pygame.K_3: Expression.HAPPY,
    pygame.K_4: Expression.WAKE,
}


def draw_eyes(surface: pygame.Surface, frame: EyeFrame) -> None:
    width, height = surface.get_size()
    surface.fill(BACKGROUND)
    eye_w = int(width * EYE_WIDTH_RATIO * frame.scale)
    full_h = int(height * EYE_HEIGHT_RATIO * frame.scale)
    eye_h = max(MIN_VISIBLE_HEIGHT, int(full_h * frame.openness))
    center_y = int(height * EYE_CENTER_Y_RATIO + full_h * SMILE_RECENTER * frame.smile)  # 笑い目は上に寄るので下げる
    gap = int(width * EYE_GAP_RATIO)
    for sign in (-1, 1):
        center_x = width // 2 + sign * gap
        _draw_one_eye(surface, center_x, center_y, eye_w, eye_h, full_h, frame)


def _draw_one_eye(
    surface: pygame.Surface, cx: int, cy: int, w: int, h: int, full_h: int, frame: EyeFrame
) -> None:
    rect = pygame.Rect(0, 0, w, h)
    rect.center = (cx, cy)
    pygame.draw.ellipse(surface, EYE_COLOR, rect)
    if h >= full_h * 0.35 and frame.smile < SMILE_HIDE_PUPIL:
        _draw_pupil(surface, rect, cx, cy, w, full_h, frame)
    if frame.smile > 0.01:
        cut = rect.copy()
        cut.centery = rect.centery + int(h * SMILE_CUT_SHIFT * frame.smile)
        pygame.draw.ellipse(surface, BACKGROUND, cut)  # 下を丸く切り取って笑い目（三日月）にする
    if frame.lid > 0.01:
        lid = pygame.Rect(rect.left - 2, rect.top - 2, rect.width + 4, int(h * frame.lid) + 2)
        pygame.draw.rect(surface, BACKGROUND, lid)  # 上まぶた（眠いとき）


def _draw_pupil(
    surface: pygame.Surface, rect: pygame.Rect, cx: int, cy: int, w: int, full_h: int, frame: EyeFrame
) -> None:
    pupil_r = int(min(w, full_h) * 0.30 * frame.pupil)
    offset_x = int(frame.gaze_x * frame.gaze_range * w * GAZE_MAX_OFFSET)
    offset_y = int(frame.gaze_y * frame.gaze_range * full_h * GAZE_MAX_OFFSET)
    px, py = cx + offset_x, cy + offset_y
    clip_before = surface.get_clip()
    surface.set_clip(rect)  # まぶたの外には瞳をはみ出させない
    pygame.draw.circle(surface, PUPIL_COLOR, (px, py), pupil_r)
    pygame.draw.circle(surface, HIGHLIGHT_COLOR, (px - pupil_r // 3, py - pupil_r // 3), max(3, pupil_r // 5))
    surface.set_clip(clip_before)


def run(windowed: bool, expression: Expression) -> None:
    pygame.init()
    flags = 0 if windowed else pygame.FULLSCREEN
    screen = pygame.display.set_mode(SCREEN_SIZE, flags)
    pygame.display.set_caption("ねるコッコ 目（試作）")
    pygame.mouse.set_visible(windowed)
    clock = pygame.time.Clock()
    state = EyeState(time.monotonic())
    state.set_expression(expression)
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key in (pygame.K_ESCAPE, pygame.K_q):
                    running = False
                elif event.key in KEY_TO_EXPRESSION:
                    state.set_expression(KEY_TO_EXPRESSION[event.key])
        draw_eyes(screen, state.update(time.monotonic()))
        pygame.display.flip()
        clock.tick(FPS)
    pygame.quit()


def save_frames(directory: Path) -> None:
    """画面なし（dummy ドライバ）で、表情ごとの静止画（まばたきなし）を PNG に保存する。確認用。"""
    os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
    pygame.init()
    surface = pygame.Surface(SCREEN_SIZE)
    directory.mkdir(parents=True, exist_ok=True)
    for expression, params in EXPRESSIONS.items():
        frame = EyeFrame(
            openness=1.0, gaze_x=0.0, gaze_y=0.0, lid=params.lid, smile=params.smile,
            scale=params.scale, pupil=params.pupil, gaze_range=params.gaze_range,
        )
        draw_eyes(surface, frame)
        pygame.image.save(surface, str(directory / f"{expression.value}.png"))
    logger.info("表情ごとの PNG を保存しました：%s", directory)
    pygame.quit()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    parser = argparse.ArgumentParser(description="目の表示（試作）")
    parser.add_argument("--windowed", action="store_true", help="全画面でなくウィンドウで表示する")
    parser.add_argument("--expression", choices=[e.value for e in Expression], default="normal")
    parser.add_argument("--save-frames", type=Path, help="画面なしで PNG を保存するフォルダ（確認用）")
    args = parser.parse_args()
    if args.save_frames:
        save_frames(args.save_frames)
    else:
        run(args.windowed, Expression(args.expression))


if __name__ == "__main__":
    main()
