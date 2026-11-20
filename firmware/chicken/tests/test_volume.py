"""eyes/volume.py（会話の音量の段階・保存）のテスト。
実行：cd firmware/chicken && python3 -m unittest discover -s tests"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from eyes import volume


class StepTest(unittest.TestCase):
    def test_up_and_down(self) -> None:
        self.assertEqual(volume.step(0.5, 1), 0.6)
        self.assertEqual(volume.step(0.5, -1), 0.4)

    def test_stops_at_both_ends(self) -> None:
        self.assertEqual(volume.step(1.0, 1), 1.0)
        self.assertEqual(volume.step(0.1, -1), 0.1)

    def test_no_float_drift_after_many_steps(self) -> None:
        v = 0.1
        for _ in range(9):
            v = volume.step(v, 1)
        self.assertEqual(v, 1.0)
        for _ in range(9):
            v = volume.step(v, -1)
        self.assertEqual(v, 0.1)


class AlarmMinimumTest(unittest.TestCase):
    def test_alarm_volume_cannot_go_below_minimum(self) -> None:
        m = volume.ALARM_VOLUME_MIN
        self.assertEqual(m, 0.3)
        v = 0.5
        for _ in range(10):
            v = volume.step(v, -1, m)
        self.assertEqual(v, 0.3)
        self.assertEqual(volume.step(0.3, -1, m), 0.3)
        self.assertEqual(volume.step(0.3, 1, m), 0.4)

    def test_conversation_volume_can_go_lower(self) -> None:
        self.assertEqual(volume.step(0.1, -1), 0.1)
        self.assertEqual(volume.step(0.2, -1), 0.1)

    def test_load_clamps_to_alarm_minimum(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "alarm_volume.json"
            path.write_text('{"volume": 0.1}', encoding="utf-8")
            self.assertEqual(volume.load(path, default=0.8, minimum=0.3), 0.3)
            self.assertEqual(volume.load(path.with_name("none.json"), default=0.1, minimum=0.3), 0.3)

    def test_save_clamps_to_alarm_minimum(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "alarm_volume.json"
            volume.save(path, 0.1, minimum=0.3)
            self.assertEqual(volume.load(path, default=0.8, minimum=0.3), 0.3)


class SaveLoadTest(unittest.TestCase):
    def test_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "sub" / "volume.json"
            volume.save(path, 0.7)
            self.assertEqual(volume.load(path, default=0.3), 0.7)

    def test_default_when_missing_or_broken(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "volume.json"
            self.assertEqual(volume.load(path, default=0.4), 0.4)
            path.write_text("壊れている", encoding="utf-8")
            self.assertEqual(volume.load(path, default=0.4), 0.4)
            path.write_text('{"volume": "abc"}', encoding="utf-8")
            self.assertEqual(volume.load(path, default=0.4), 0.4)

    def test_out_of_range_is_clamped(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "volume.json"
            path.write_text('{"volume": 5}', encoding="utf-8")
            self.assertEqual(volume.load(path, default=0.4), 1.0)
            self.assertEqual(volume.load(path.with_name("none.json"), default=9), 1.0)


if __name__ == "__main__":
    unittest.main()
