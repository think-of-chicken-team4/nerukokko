"""detectors.py のテスト（ハードウェアなしで動く）。実行：cd firmware/chicken && python3 -m unittest discover -s tests"""

from __future__ import annotations

import unittest

from detectors import BreathingAggregator, SoundConfig, SoundDetector, TurnConfig, TurnDetector

G = 16384  # 1g


class TurnDetectorTest(unittest.TestCase):
    def test_moves_within_10s_are_one_turn(self) -> None:
        d = TurnDetector()
        events = []
        events += d.add(0.0, 0, 0, G)  # 基準
        events += d.add(1.0, int(0.3 * G), 0, G)  # 動きあり（0.3g）
        events += d.add(4.0, int(0.3 * G), int(0.5 * G), G)  # 動きあり（0.5g）、10秒以内なので同じ寝返り
        events += d.add(9.0, int(0.3 * G), int(0.5 * G), G)  # 変化なし（定期送信）
        self.assertEqual(events, [])
        events += d.flush(14.5)  # 最後の動き（4秒）から10秒以上たった
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].timestamp, 1.0)
        self.assertAlmostEqual(events[0].intensity, 0.5, places=2)

    def test_two_turns_apart(self) -> None:
        d = TurnDetector()
        d.add(0.0, 0, 0, G)
        d.add(1.0, G // 2, 0, G)
        events = d.add(30.0, 0, 0, G)  # 30秒後にまた動いた → 1回目が確定
        events += d.flush(45.0)
        self.assertEqual([e.timestamp for e in events], [1.0, 30.0])

    def test_small_noise_is_ignored(self) -> None:
        d = TurnDetector()
        for i in range(50):
            d.add(i * 0.5, int(0.006 * G) * (i % 2), 0, G)  # 静止時のノイズ（0.006g）
        self.assertEqual(d.flush(100.0), [])

    def test_threshold_is_configurable(self) -> None:
        d = TurnDetector(TurnConfig(min_change_g=0.005))
        d.add(0.0, 0, 0, G)
        d.add(1.0, int(0.006 * G), 0, G)
        self.assertEqual(len(d.flush(20.0)), 1)


def feed(d: SoundDetector, start: float, seconds: float, level: float, step: float = 0.3):
    events = []
    t = start
    while t < start + seconds - 1e-9:
        events += d.add(round(t, 2), level)
        t += step
    return events


class SoundDetectorTest(unittest.TestCase):
    def quiet(self, d: SoundDetector, start: float = 0.0, seconds: float = 30.0):
        return feed(d, start, seconds, 200.0)

    def test_repeated_short_sounds_are_snore(self) -> None:
        d = SoundDetector()
        events = self.quiet(d)
        t = 30.0
        for _ in range(4):  # 1秒の大きな音を、3秒おきに4回
            events += feed(d, t, 0.9, 2000.0)
            events += feed(d, t + 0.9, 3.0, 200.0)
            t += 3.9
        events += self.quiet(d, t, 10.0)
        snores = [e for e in events if e.type == "snore"]
        self.assertEqual(len(snores), 1)
        self.assertAlmostEqual(snores[0].timestamp, 30.0, places=1)
        self.assertGreater(snores[0].duration_ms, 10000)
        self.assertGreaterEqual(snores[0].confidence, 0.8)  # 間隔がそろっている

    def test_one_long_sound_is_sleep_talk(self) -> None:
        d = SoundDetector()
        events = self.quiet(d)
        events += feed(d, 30.0, 1.8, 2500.0)
        events += self.quiet(d, 31.8, 10.0)
        self.assertEqual([e.type for e in events], ["sleep_talk"])
        self.assertGreaterEqual(events[0].duration_ms, 1500)

    def test_two_short_sounds_are_not_snore(self) -> None:
        d = SoundDetector()
        events = self.quiet(d)
        events += feed(d, 30.0, 0.6, 2000.0)
        events += self.quiet(d, 30.6, 3.0)
        events += feed(d, 33.6, 0.6, 2000.0)
        events += self.quiet(d, 34.2, 10.0)
        self.assertEqual(events, [])

    def test_quiet_room_noise_is_ignored(self) -> None:
        # 背景がとても静か（50）なら、3倍（150）を少し超える程度の音（250）は数えない（下限 300）
        d = SoundDetector(SoundConfig(min_loud_level=300.0))
        events = feed(d, 0.0, 30.0, 50.0) + feed(d, 30.0, 2.0, 250.0) + feed(d, 32.0, 10.0, 50.0)
        self.assertEqual(events, [])


class BreathingAggregatorTest(unittest.TestCase):
    def test_median_per_minute(self) -> None:
        agg = BreathingAggregator()
        out = []
        for i, bpm in enumerate([14.0, 15.0, 30.0, 14.5, None, 13.0]):
            out += agg.add(i * 10.0, bpm)
        out += agg.add(61.0, 14.0)
        self.assertEqual(out, [(60.0, 14.5)])

    def test_no_values_no_output(self) -> None:
        agg = BreathingAggregator()
        agg.add(0.0, None)
        self.assertEqual(agg.flush(100.0), [])


if __name__ == "__main__":
    unittest.main()
