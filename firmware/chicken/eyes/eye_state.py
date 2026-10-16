"""目のアニメーションの状態管理（描画に依存しない）。

時刻を引数で受け取るだけなので、pygame なしでテストできる。
"""

from __future__ import annotations

import random
from dataclasses import dataclass

# 実機（DSI ディスプレイ）で見て調整する値
BLINK_INTERVAL_SEC = (2.5, 6.0)  # まばたきの間隔（この範囲でランダム）
BLINK_CLOSE_SEC = 0.09
BLINK_OPEN_SEC = 0.14
DOUBLE_BLINK_PROBABILITY = 0.15
GAZE_INTERVAL_SEC = (1.5, 4.0)
GAZE_MAX_OFFSET = 0.12  # 目の大きさに対する視線のずれの最大割合
GAZE_SMOOTHING_PER_SEC = 6.0


@dataclass(frozen=True)
class EyeFrame:
    """1フレーム分の目の状態。"""

    openness: float  # 0.0=閉じている、1.0=開いている
    gaze_x: float  # -1.0〜1.0（左〜右）
    gaze_y: float  # -1.0〜1.0（上〜下）


class EyeState:
    def __init__(self, now: float, rng: random.Random | None = None) -> None:
        self._rng = rng or random.Random()
        self._blink_started: float | None = None
        self._pending_blinks = 0
        self._next_blink = now + self._rng.uniform(*BLINK_INTERVAL_SEC)
        self._gaze_target = (0.0, 0.0)
        self._gaze = (0.0, 0.0)
        self._next_gaze = now + self._rng.uniform(*GAZE_INTERVAL_SEC)
        self._last_update = now

    def update(self, now: float) -> EyeFrame:
        dt = max(0.0, now - self._last_update)
        self._last_update = now
        openness = self._update_blink(now)
        self._update_gaze(now, dt)
        return EyeFrame(openness=openness, gaze_x=self._gaze[0], gaze_y=self._gaze[1])

    def _update_blink(self, now: float) -> float:
        if self._blink_started is None:
            if now >= self._next_blink:
                self._blink_started = now
                self._pending_blinks = 1 if self._rng.random() < DOUBLE_BLINK_PROBABILITY else 0
            else:
                return 1.0
        elapsed = now - self._blink_started
        total = BLINK_CLOSE_SEC + BLINK_OPEN_SEC
        if elapsed >= total:
            if self._pending_blinks > 0:
                self._pending_blinks -= 1
                self._blink_started = now
            else:
                self._blink_started = None
                self._next_blink = now + self._rng.uniform(*BLINK_INTERVAL_SEC)
            return 1.0
        if elapsed < BLINK_CLOSE_SEC:
            return 1.0 - _smoothstep(elapsed / BLINK_CLOSE_SEC)
        return _smoothstep((elapsed - BLINK_CLOSE_SEC) / BLINK_OPEN_SEC)

    def _update_gaze(self, now: float, dt: float) -> None:
        if now >= self._next_gaze:
            self._gaze_target = (self._rng.uniform(-1.0, 1.0), self._rng.uniform(-0.6, 0.6))
            self._next_gaze = now + self._rng.uniform(*GAZE_INTERVAL_SEC)
        k = min(1.0, GAZE_SMOOTHING_PER_SEC * dt)
        self._gaze = (
            self._gaze[0] + (self._gaze_target[0] - self._gaze[0]) * k,
            self._gaze[1] + (self._gaze_target[1] - self._gaze[1]) * k,
        )


def _smoothstep(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)
