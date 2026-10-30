"""eyes/eye_state.py の DarknessEstimator（昼夜の配色・アラーム中に明るくする）のテスト。
実行：cd firmware/chicken && python3 -m unittest discover -s tests"""

from __future__ import annotations

import unittest

from eyes.eye_state import DarknessEstimator


def run(estimator: DarknessEstimator, seconds: int, **kwargs: object) -> float:
    """1秒ごとに seconds 秒ぶん update して、最後の暗さを返す"""
    start = 1000.0
    estimator.update(start, **kwargs)  # type: ignore[arg-type]
    value = estimator.value
    for t in range(1, seconds + 1):
        value = estimator.update(start + t, **kwargs)  # type: ignore[arg-type]
    return value


class DarknessEstimatorTest(unittest.TestCase):
    def test_night_stays_dark(self) -> None:
        self.assertGreater(run(DarknessEstimator(initial=1.0), 30, hour=2), 0.99)

    def test_alarm_brightens_gradually_at_night(self) -> None:
        estimator = DarknessEstimator(initial=1.0)
        self.assertGreater(run(estimator, 5, hour=5, wake=True), 0.5)  # すぐには明るくならない（朝日のように）
        self.assertLess(run(estimator, 60, hour=5, wake=True), 0.05)  # 1分ほどで、ほぼ昼の明るさ

    def test_dark_again_after_alarm_at_night(self) -> None:
        estimator = DarknessEstimator(initial=0.0)
        self.assertGreater(run(estimator, 30, hour=3), 0.9)  # アラームが止まれば、夜の暗い目に戻る

    def test_day_stays_bright(self) -> None:
        self.assertLess(run(DarknessEstimator(initial=0.0), 30, hour=12, wake=True), 0.01)


if __name__ == "__main__":
    unittest.main()
