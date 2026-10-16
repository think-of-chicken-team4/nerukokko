"""radar_filter.py のテスト。ハードウェアなしで動く。

実行：cd firmware/chicken && python3 -m unittest discover -s tests
数値は 2026-10-16 の実測（Issue #16）に近い値を使う。
"""

from __future__ import annotations

import math
import unittest

from radar_filter import BreathingFilter, RadarFilterConfig

RATE = 10  # テストでは1秒に10掃引


def feed(f: BreathingFilter, start: float, seconds: float, env_max: float, std: float, bpm: float = 14.0):
    """seconds 秒ぶん同じ値を入れて、最後の判定と、途中で切り替わった回数を返す"""
    last = None
    changes = 0
    for i in range(int(seconds * RATE)):
        last = f.update(start + i / RATE, env_max, std, bpm)
        changes += last.presence_changed
    return last, changes


class BreathingFilterTest(unittest.TestCase):
    def test_nothing_in_front_gives_no_bpm(self) -> None:
        # 人がいない：反射が弱く、ピークが定まらない（NaN）。公式アルゴリズムは BPM を出してしまう
        f = BreathingFilter()
        reading, changes = feed(f, 0, 60, env_max=30.0, std=math.nan, bpm=9.0)
        self.assertFalse(reading.present)
        self.assertFalse(reading.breathing)
        self.assertIsNone(reading.bpm)
        self.assertEqual(changes, 0)

    def test_person_breathing_gives_bpm_after_hold(self) -> None:
        f = BreathingFilter()
        # 人が来てすぐは、まだ「いない」のまま（30秒続いてから切り替える）
        reading, _ = feed(f, 0, 20, env_max=280.0, std=1.4, bpm=14.2)
        self.assertFalse(reading.present)
        self.assertIsNone(reading.bpm)
        reading, changes = feed(f, 20, 30, env_max=280.0, std=1.4, bpm=14.2)
        self.assertTrue(reading.present)
        self.assertTrue(reading.breathing)
        self.assertEqual(reading.bpm, 14.2)
        self.assertEqual(changes, 1)

    def test_breath_hold_is_present_but_not_breathing(self) -> None:
        f = BreathingFilter()
        feed(f, 0, 40, env_max=280.0, std=1.4)
        reading, _ = feed(f, 40, 15, env_max=290.0, std=0.14, bpm=6.1)
        self.assertTrue(reading.present)
        self.assertFalse(reading.breathing)
        self.assertIsNone(reading.bpm)

    def test_short_dip_does_not_flip_presence(self) -> None:
        # 寝返りなどで10秒だけ反射が弱くなっても「いない」にならない
        f = BreathingFilter()
        feed(f, 0, 40, env_max=280.0, std=1.4)
        reading, changes = feed(f, 40, 10, env_max=30.0, std=math.nan)
        self.assertTrue(reading.present)
        self.assertEqual(changes, 0)

    def test_leaving_bed_flips_after_hold(self) -> None:
        f = BreathingFilter()
        feed(f, 0, 40, env_max=280.0, std=1.4)
        reading, changes = feed(f, 40, 60, env_max=30.0, std=math.nan, bpm=9.0)
        self.assertFalse(reading.present)
        self.assertIsNone(reading.bpm)
        self.assertEqual(changes, 1)

    def test_thresholds_are_configurable(self) -> None:
        # ベッドの置き場所で値が変わったら、設定で変えられる
        f = BreathingFilter(RadarFilterConfig(presence_env_max=50.0, presence_hold_sec=0.0))
        reading, _ = feed(f, 0, 12, env_max=60.0, std=0.8, bpm=13.0)
        self.assertTrue(reading.present)
        self.assertEqual(reading.bpm, 13.0)


if __name__ == "__main__":
    unittest.main()
