"""目の表示（試作）：通常の目＋まばたきを pygame で描く。

    python3 -m eyes.eye_display                  # 全画面（ラズパイの DSI 用）
    python3 -m eyes.eye_display --windowed       # PC でウィンドウ表示
    python3 -m eyes.eye_display --save-frames out/ --frames 12   # 画面なしで PNG に保存して確認

終了は Esc か Q。実機で調整する値（色・大きさ・位置）は下の定数にまとめている（Issue #28）。
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from pathlib import Path

import pygame

from .eye_state import GAZE_MAX_OFFSET, EyeFrame, EyeState

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


def draw_eyes(surface: pygame.Surface, frame: EyeFrame) -> None:
    width, height = surface.get_size()
    surface.fill(BACKGROUND)
    eye_w = int(width * EYE_WIDTH_RATIO)
    full_h = int(height * EYE_HEIGHT_RATIO)
    eye_h = max(MIN_VISIBLE_HEIGHT, int(full_h * frame.openness))
    center_y = int(height * EYE_CENTER_Y_RATIO)
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
    if h < full_h * 0.35:
        return  # ほぼ閉じているときは瞳を描かない
    pupil_r = int(min(w, full_h) * 0.30)
    offset_x = int(frame.gaze_x * w * GAZE_MAX_OFFSET)
    offset_y = int(frame.gaze_y * full_h * GAZE_MAX_OFFSET)
    px, py = cx + offset_x, cy + offset_y
    clip_before = surface.get_clip()
    surface.set_clip(rect)  # まぶたの外には瞳をはみ出させない
    pygame.draw.circle(surface, PUPIL_COLOR, (px, py), pupil_r)
    pygame.draw.circle(surface, HIGHLIGHT_COLOR, (px - pupil_r // 3, py - pupil_r // 3), max(3, pupil_r // 5))
    surface.set_clip(clip_before)


def run(windowed: bool) -> None:
    pygame.init()
    flags = 0 if windowed else pygame.FULLSCREEN
    screen = pygame.display.set_mode(SCREEN_SIZE, flags)
    pygame.display.set_caption("ねるコッコ 目（試作）")
    pygame.mouse.set_visible(windowed)
    clock = pygame.time.Clock()
    state = EyeState(time.monotonic())
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT or (
                event.type == pygame.KEYDOWN and event.key in (pygame.K_ESCAPE, pygame.K_q)
            ):
                running = False
        draw_eyes(screen, state.update(time.monotonic()))
        pygame.display.flip()
        clock.tick(FPS)
    pygame.quit()


def save_frames(directory: Path, count: int) -> None:
    """画面なし（dummy ドライバ）で、まばたきの途中経過を PNG に保存する。確認用。"""
    os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
    pygame.init()
    surface = pygame.Surface(SCREEN_SIZE)
    directory.mkdir(parents=True, exist_ok=True)
    for i in range(count):
        openness = 1.0 - abs(1.0 - 2.0 * i / max(1, count - 1))  # 開→閉→開
        draw_eyes(surface, EyeFrame(openness=1.0 - openness, gaze_x=0.0, gaze_y=0.0))
        pygame.image.save(surface, str(directory / f"blink_{i:02d}.png"))
    logger.info("%d 枚保存しました：%s", count, directory)
    pygame.quit()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    parser = argparse.ArgumentParser(description="目の表示（試作）")
    parser.add_argument("--windowed", action="store_true", help="全画面でなくウィンドウで表示する")
    parser.add_argument("--save-frames", type=Path, help="画面なしで PNG を保存するフォルダ（確認用）")
    parser.add_argument("--frames", type=int, default=9, help="--save-frames のときの枚数")
    args = parser.parse_args()
    if args.save_frames:
        save_frames(args.save_frames, args.frames)
    else:
        run(args.windowed)


if __name__ == "__main__":
    main()
