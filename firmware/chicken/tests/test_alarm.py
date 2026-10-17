"""alarm.py のテスト。実行：cd firmware/chicken && python3 -m unittest discover -s tests"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from alarm import AlarmAction, AlarmClock

T = 1_800_000_000.0


class AlarmClockTest(unittest.TestCase):
    def test_rings_at_time_and_stops_on_dock(self) -> None:
        a = AlarmClock()
        a.set_target(T)
        self.assertEqual(a.tick(T - 1), AlarmAction.NONE)
        self.assertEqual(a.tick(T), AlarmAction.START)
        self.assertTrue(a.ringing)
        self.assertEqual(a.tick(T + 10), AlarmAction.NONE)
        self.assertTrue(a.dock())
        self.assertFalse(a.ringing)
        self.assertEqual(a.tick(T + 20), AlarmAction.NONE)  # 同じ時刻では二度鳴らない

    def test_stops_after_max_time(self) -> None:
        a = AlarmClock(max_ring_sec=60)
        a.set_target(T)
        a.tick(T)
        self.assertEqual(a.tick(T + 59), AlarmAction.NONE)
        self.assertEqual(a.tick(T + 60), AlarmAction.STOP)
        self.assertFalse(a.ringing)

    def test_dock_when_not_ringing_does_nothing(self) -> None:
        self.assertFalse(AlarmClock().dock())

    def test_remembers_alarm_after_restart(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "alarm.json"
            AlarmClock(path).set_target(T)
            restarted = AlarmClock(path)  # Wi-Fi なし・再起動しても鳴る
            self.assertEqual(restarted.tick(T + 5), AlarmAction.START)
            again = AlarmClock(path)  # 鳴らしたことも覚えている
            self.assertEqual(again.tick(T + 10), AlarmAction.NONE)

    def test_skips_if_far_past(self) -> None:
        a = AlarmClock(max_ring_sec=1800)
        a.set_target(T)
        self.assertEqual(a.tick(T + 3600), AlarmAction.NONE)

    def test_new_target_after_ringing(self) -> None:
        a = AlarmClock()
        a.set_target(T)
        a.tick(T)
        a.dock()
        a.set_target(T + 86400)
        self.assertEqual(a.tick(T + 86400), AlarmAction.START)


if __name__ == "__main__":
    unittest.main()
