"""寝返り・いびき・寝言・呼吸数の判定（docs/api-spec.md §6）。

ハードウェアに依存しない純粋なロジック。時刻は秒（UTC の epoch 秒）で受け取り、判定済みのイベントを返す。
しきい値はすべて integration_config.py（環境変数）で変えられる。実機で調整する（hw-verification E1・E2）。
tests/test_detectors.py でテストしている。
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from statistics import median
from typing import Deque, List, Optional, Tuple


# ---------------------------------------------------------------- 寝返り（§6-1）


@dataclass(frozen=True)
class TurnConfig:
    # MPU-6050 を ±2g で使うとき 16384 = 1g
    lsb_per_g: float = 16384.0
    # たまごから届いた加速度が、前に届いた値からこれ（g）以上変わったら「動きあり」
    # （たまごは、しきい値を超えたときと、5秒ごとの定期送信の両方で同じ形の値を送るので、鶏でも変化量を見る）
    min_change_g: float = 0.05
    # この時間（秒）以内に続いた「動きあり」は、まとめて寝返り1回
    merge_sec: float = 10.0


@dataclass(frozen=True)
class TurnEvent:
    timestamp: float
    intensity: float  # その寝返りのあいだの、加速度の変化量の最大値（g）


class TurnDetector:
    def __init__(self, config: TurnConfig = TurnConfig()) -> None:
        self._config = config
        self._previous: Optional[Tuple[int, int, int]] = None
        self._start: Optional[float] = None
        self._last: float = 0.0
        self._max_change: float = 0.0

    def add(self, t: float, x: int, y: int, z: int) -> List[TurnEvent]:
        """たまごから加速度が届いたら呼ぶ。確定した寝返りを返す"""
        done = self.flush(t)
        if self._previous is not None:
            change = max(abs(x - self._previous[0]), abs(y - self._previous[1]), abs(z - self._previous[2]))
            change_g = change / self._config.lsb_per_g
            if change_g >= self._config.min_change_g:
                if self._start is None:
                    self._start = t
                    self._max_change = 0.0
                self._last = t
                self._max_change = max(self._max_change, change_g)
        self._previous = (x, y, z)
        return done

    def flush(self, now: float) -> List[TurnEvent]:
        """最後の動きから merge_sec たったら、その寝返りを確定する（定期的に呼ぶ）"""
        if self._start is not None and now - self._last >= self._config.merge_sec:
            event = TurnEvent(timestamp=self._start, intensity=round(min(self._max_change, 999.99), 3))
            self._start = None
            return [event]
        return []

    def reset_baseline(self) -> None:
        """たまごとつなぎ直したときは、前の値との差を使わない"""
        self._previous = None


# ---------------------------------------------------------------- いびき・寝言（§6-2）


@dataclass(frozen=True)
class SoundConfig:
    # 直近この時間（秒）の音量の中央値を「背景の音量」とする
    background_sec: float = 60.0
    # 背景のこの倍を超えたら「大きな音」
    loud_ratio: float = 3.0
    # 背景がとても静かなときに、小さな音まで拾わないための下限（たまごの音量の値）
    min_loud_level: float = 300.0
    # いびき：0.3〜3秒の大きな音が、2〜6秒の間隔で3回以上くり返す
    snore_min_sec: float = 0.3
    snore_max_sec: float = 3.0
    snore_gap_min_sec: float = 2.0
    snore_gap_max_sec: float = 6.0
    snore_min_count: int = 3
    # 寝言：くり返さない大きな音が、この時間（秒）以上続く
    talk_min_sec: float = 1.0


@dataclass(frozen=True)
class SoundEvent:
    timestamp: float
    type: str  # "snore" | "sleep_talk"
    duration_ms: int
    confidence: float


class SoundDetector:
    def __init__(self, config: SoundConfig = SoundConfig()) -> None:
        self._config = config
        self._history: Deque[Tuple[float, float]] = deque()
        self._loud_start: Optional[float] = None
        self._loud_last: float = 0.0
        # 確定した「大きな音」の区間（開始, 終了）で、まだいびき・寝言として出していないもの
        self._segments: List[Tuple[float, float]] = []

    def add(self, t: float, level: float) -> List[SoundEvent]:
        """音量（約0.3秒ごと）を入れる。確定したいびき・寝言を返す"""
        cfg = self._config
        background = median(v for _, v in self._history) if self._history else level
        loud = level > max(background * cfg.loud_ratio, cfg.min_loud_level)

        # 大きな音のあいだは背景に入れない（いびきが続くと背景が上がってしまうため）
        if not loud:
            self._history.append((t, level))
        while self._history and self._history[0][0] < t - cfg.background_sec:
            self._history.popleft()

        if loud:
            if self._loud_start is None:
                self._loud_start = t
            self._loud_last = t
        elif self._loud_start is not None:
            self._segments.append((self._loud_start, t))
            self._loud_start = None

        return self._judge(t)

    def flush(self, now: float) -> List[SoundEvent]:
        """しばらく音が来ないときに、たまった区間を判定する（定期的に呼ぶ）"""
        return self._judge(now)

    def _judge(self, now: float) -> List[SoundEvent]:
        cfg = self._config
        events: List[SoundEvent] = []
        # いちばん新しい区間から snore_gap_max_sec 以上たったら、それまでの区間を確定して判定する
        if not self._segments or self._loud_start is not None or now - self._segments[-1][1] < cfg.snore_gap_max_sec:
            return events
        segments, self._segments = self._segments, []

        series: List[Tuple[float, float]] = []
        for seg in segments + [(float("inf"), float("inf"))]:
            length = seg[1] - seg[0]
            is_snore_like = cfg.snore_min_sec <= length <= cfg.snore_max_sec
            if series:
                gap = seg[0] - series[-1][1]
                if is_snore_like and cfg.snore_gap_min_sec <= gap <= cfg.snore_gap_max_sec:
                    series.append(seg)
                    continue
                events.extend(self._close_series(series))
                series = []
            if seg[0] == float("inf"):
                break
            if is_snore_like:
                series = [seg]
            elif length >= cfg.talk_min_sec:
                events.append(SoundEvent(seg[0], "sleep_talk", int(length * 1000), 0.5))
        return events

    def _close_series(self, series: List[Tuple[float, float]]) -> List[SoundEvent]:
        cfg = self._config
        if len(series) >= cfg.snore_min_count:
            gaps = [b[0] - a[1] for a, b in zip(series, series[1:])]
            mean = sum(gaps) / len(gaps)
            spread = (max(gaps) - min(gaps)) / mean if mean > 0 else 1.0
            # 間隔がそろっているほど確からしい（0.5〜0.95）
            confidence = round(max(0.5, min(0.95, 0.95 - spread * 0.45)), 2)
            duration = series[-1][1] - series[0][0]
            return [SoundEvent(series[0][0], "snore", int(duration * 1000), confidence)]
        # くり返しが足りない音のうち、長いものは寝言
        return [
            SoundEvent(s[0], "sleep_talk", int((s[1] - s[0]) * 1000), 0.5)
            for s in series
            if s[1] - s[0] >= cfg.talk_min_sec
        ]


# ---------------------------------------------------------------- 呼吸数（§6-3）


@dataclass
class BreathingAggregator:
    """レーダーの呼吸数を1分ごとにまとめ、その中央値を1件にする"""

    interval_sec: float = 60.0
    _bucket_start: Optional[float] = None
    _values: List[float] = field(default_factory=list)

    def add(self, t: float, bpm: Optional[float]) -> List[Tuple[float, float]]:
        out = self.flush(t)
        if bpm is not None and 0 <= bpm <= 60:
            if self._bucket_start is None:
                self._bucket_start = t
            self._values.append(bpm)
        return out

    def flush(self, now: float) -> List[Tuple[float, float]]:
        """(時刻, 呼吸数) を返す。時刻はまとめた1分の終わり"""
        if self._bucket_start is None or now - self._bucket_start < self.interval_sec:
            return []
        result = [(self._bucket_start + self.interval_sec, round(median(self._values), 1))] if self._values else []
        self._bucket_start = None
        self._values = []
        return result
