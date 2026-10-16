"""A111 レーダーの呼吸検知の誤検知を防ぐフィルタ（Issue #16、実機検証 C2）。

公式の呼吸アルゴリズム（acconeer の breathing）は、前に何もなくても約7割の掃引で呼吸数を出してしまう。
そこで、掃引ごとの「反射の強さ（env_max）」と「ピーク位置のばらつき（peak_std_mm）」から、
「人がいるか」「呼吸しているか」を判定し、どちらも満たすときだけ呼吸数を採用する。

しきい値は、2026-10-16 に岡田さんが測った値（#16）から決めた。
  - 人がいない：env_max は最大 42.5。peak_std_mm はすべて NaN（ピークが定まらない）
  - 人がいる（胸に向けて 30〜50cm）：env_max は最小 約252。peak_std_mm の中央値 1.46（息止めは 0.14）
ベッドでの距離・角度・布団で値が変わるので、実機で調整する（integration_config.py の RADAR_*）。

ハードウェアに依存しない純粋なロジックなので、tests/test_radar_filter.py でテストできる。
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from statistics import median
from typing import Deque, Optional, Tuple


@dataclass(frozen=True)
class RadarFilterConfig:
    # env_max の直近の中央値がこれ以上なら「人がいる」（人なし 42.5 と 人あり 252 のあいだ）
    presence_env_max: float = 100.0
    # peak_std_mm の直近の中央値がこれ以上なら「呼吸している」（胸 1.46 と 息止め 0.14 のあいだ）
    breathing_std_mm: float = 0.5
    # 中央値をとる直近の時間（秒）。1回ごとでは息止めでも大きな値が出るため、まとめて見る
    window_sec: float = 10.0
    # 「いる／いない」が変わったと判断するまでに、同じ結果が続く時間（秒）。寝返りなどで一瞬変わっても揺れないように
    presence_hold_sec: float = 30.0


@dataclass(frozen=True)
class RadarReading:
    present: bool
    breathing: bool
    # 人がいて呼吸しているときだけ、アルゴリズムの呼吸数を返す
    bpm: Optional[float]
    # この掃引で「いる／いない」が切り替わったら True（在床・離床のイベント presence_events に使う）
    presence_changed: bool


def _finite(value: Optional[float]) -> bool:
    return value is not None and not math.isnan(value) and not math.isinf(value)


class BreathingFilter:
    def __init__(self, config: RadarFilterConfig = RadarFilterConfig()) -> None:
        self._config = config
        # (時刻, env_max, peak_std_mm)
        self._window: Deque[Tuple[float, float, Optional[float]]] = deque()
        self._present = False
        self._pending_since: Optional[float] = None

    @property
    def present(self) -> bool:
        return self._present

    def update(self, t: float, env_max: float, peak_std_mm: Optional[float], bpm: Optional[float]) -> RadarReading:
        """掃引1回分を入れて、判定を返す。t は秒（time.monotonic() など、増えていく時刻）"""
        cfg = self._config
        self._window.append((t, env_max, peak_std_mm if _finite(peak_std_mm) else None))
        while self._window and self._window[0][0] < t - cfg.window_sec:
            self._window.popleft()

        # 人がいるか：env_max の中央値で判定し、同じ結果が presence_hold_sec 続いたら切り替える
        present_now = median(e for _, e, _ in self._window) >= cfg.presence_env_max
        changed = False
        if present_now == self._present:
            self._pending_since = None
        elif self._pending_since is None:
            self._pending_since = t
        elif t - self._pending_since >= cfg.presence_hold_sec:
            self._present = present_now
            self._pending_since = None
            changed = True

        # 呼吸しているか：ピークが定まった掃引の peak_std_mm の中央値で判定する（人がいないと NaN ばかりになる）
        stds = [s for _, _, s in self._window if s is not None]
        breathing = self._present and bool(stds) and median(stds) >= cfg.breathing_std_mm

        return RadarReading(
            present=self._present,
            breathing=breathing,
            bpm=bpm if breathing and _finite(bpm) else None,
            presence_changed=changed,
        )
