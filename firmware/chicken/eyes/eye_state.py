"""目のアニメーションの状態管理（描画に依存しない）。

時刻を引数で受け取るだけなので、pygame なしでテストできる。
表情は set_expression() で切り替え、各パラメータをなめらかに近づける。
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from enum import Enum


class Expression(Enum):
    NORMAL = "normal"  # 通常
    SLEEPY = "sleepy"  # 眠い（就寝前）
    HAPPY = "happy"  # うれしい（朝のスコアが高いとき）
    WAKE = "wake"  # 起こす（アラーム中）


@dataclass(frozen=True)
class ExpressionParams:
    lid: float  # 上まぶたの下がり具合 0.0=なし、1.0=全部閉じる
    smile: float  # 下から切り取る度合い 0.0=なし、1.0=三日月（笑い目）
    scale: float  # 目の大きさの倍率
    pupil: float  # 瞳の大きさの倍率
    blink_speed: float  # まばたきの速さ（1.0=標準、小さいほどゆっくり）
    blink_gap: float  # まばたきの間隔の倍率
    gaze_range: float  # 視線のゆらぎの大きさの倍率
    pulse: float  # 大きさの脈動の振幅（起こすときに目を目立たせる）


# 実機で見て調整する値
EXPRESSIONS: dict[Expression, ExpressionParams] = {
    Expression.NORMAL: ExpressionParams(0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0),
    Expression.SLEEPY: ExpressionParams(0.42, 0.0, 0.95, 0.9, 0.45, 0.6, 0.35, 0.0),
    Expression.HAPPY: ExpressionParams(0.0, 1.0, 1.0, 1.0, 1.0, 1.4, 0.4, 0.0),
    Expression.WAKE: ExpressionParams(0.0, 0.0, 1.12, 0.75, 1.4, 0.8, 0.5, 0.05),
}

BLINK_INTERVAL_SEC = (2.5, 6.0)  # まばたきの間隔（この範囲でランダム、blink_gap を掛ける）
BLINK_CLOSE_SEC = 0.09
BLINK_OPEN_SEC = 0.14
DOUBLE_BLINK_PROBABILITY = 0.15
GAZE_INTERVAL_SEC = (1.5, 4.0)
GAZE_SMOOTHING_PER_SEC = 6.0
EXPRESSION_SMOOTHING_PER_SEC = 7.0  # 表情が切り替わる速さ
PULSE_HZ = 1.6


@dataclass(frozen=True)
class EyeFrame:
    """1フレーム分の目の状態。"""

    openness: float  # まばたきの開き具合 0.0=閉じている、1.0=開いている
    gaze_x: float  # -1.0〜1.0（左〜右）
    gaze_y: float  # -1.0〜1.0（上〜下）
    lid: float = 0.0
    smile: float = 0.0
    scale: float = 1.0
    pupil: float = 1.0
    gaze_range: float = 1.0


class EyeState:
    def __init__(self, now: float, rng: random.Random | None = None) -> None:
        self._rng = rng or random.Random()
        self._expression = Expression.NORMAL
        self._params = EXPRESSIONS[Expression.NORMAL]
        self._blink_started: float | None = None
        self._pending_blinks = 0
        self._next_blink = now + self._blink_wait()
        self._gaze_target = (0.0, 0.0)
        self._gaze = (0.0, 0.0)
        self._next_gaze = now + self._rng.uniform(*GAZE_INTERVAL_SEC)
        self._last_update = now

    @property
    def expression(self) -> Expression:
        return self._expression

    def set_expression(self, expression: Expression) -> None:
        self._expression = expression

    def update(self, now: float) -> EyeFrame:
        dt = max(0.0, now - self._last_update)
        self._last_update = now
        self._params = _approach(self._params, EXPRESSIONS[self._expression], dt)
        openness = self._update_blink(now)
        self._update_gaze(now, dt)
        pulse = self._params.pulse * math.sin(2.0 * math.pi * PULSE_HZ * now)
        return EyeFrame(
            openness=openness,
            gaze_x=self._gaze[0],
            gaze_y=self._gaze[1],
            lid=self._params.lid,
            smile=self._params.smile,
            scale=self._params.scale + pulse,
            pupil=self._params.pupil,
            gaze_range=self._params.gaze_range,
        )

    def _blink_wait(self) -> float:
        return self._rng.uniform(*BLINK_INTERVAL_SEC) * self._params.blink_gap

    def _update_blink(self, now: float) -> float:
        if self._blink_started is None:
            if now >= self._next_blink:
                self._blink_started = now
                self._pending_blinks = 1 if self._rng.random() < DOUBLE_BLINK_PROBABILITY else 0
            else:
                return 1.0
        speed = max(0.1, self._params.blink_speed)
        close_sec = BLINK_CLOSE_SEC / speed
        open_sec = BLINK_OPEN_SEC / speed
        elapsed = now - self._blink_started
        if elapsed >= close_sec + open_sec:
            if self._pending_blinks > 0:
                self._pending_blinks -= 1
                self._blink_started = now
            else:
                self._blink_started = None
                self._next_blink = now + self._blink_wait()
            return 1.0
        if elapsed < close_sec:
            return 1.0 - _smoothstep(elapsed / close_sec)
        return _smoothstep((elapsed - close_sec) / open_sec)

    def _update_gaze(self, now: float, dt: float) -> None:
        if now >= self._next_gaze:
            self._gaze_target = (self._rng.uniform(-1.0, 1.0), self._rng.uniform(-0.6, 0.6))
            self._next_gaze = now + self._rng.uniform(*GAZE_INTERVAL_SEC)
        k = min(1.0, GAZE_SMOOTHING_PER_SEC * dt)
        self._gaze = (
            self._gaze[0] + (self._gaze_target[0] - self._gaze[0]) * k,
            self._gaze[1] + (self._gaze_target[1] - self._gaze[1]) * k,
        )


def _approach(current: ExpressionParams, target: ExpressionParams, dt: float) -> ExpressionParams:
    k = min(1.0, EXPRESSION_SMOOTHING_PER_SEC * dt)
    return ExpressionParams(*(c + (t - c) * k for c, t in zip(_values(current), _values(target))))


def _values(params: ExpressionParams) -> tuple[float, ...]:
    return (
        params.lid,
        params.smile,
        params.scale,
        params.pupil,
        params.blink_speed,
        params.blink_gap,
        params.gaze_range,
        params.pulse,
    )


def _smoothstep(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)
