"""eyes/mood.py（状態から表情を選ぶ）と、表情の定義のテスト。
実行：cd firmware/chicken && python3 -m unittest discover -s tests"""

from __future__ import annotations

import unittest

from eyes.eye_state import EXPRESSIONS, Expression
from eyes.mood import KIND_MORNING_SUMMARY, TALK_LISTEN, TALK_THINK, choose_expression


def choose(**overrides: object) -> str:
    base = dict(alarm_ringing=False, talk_phase=None, speaking_kind=None, session_active=False, hour=12, evening_hour=21)
    base.update(overrides)
    return choose_expression(**base)  # type: ignore[arg-type]


class ChooseExpressionTest(unittest.TestCase):
    def test_default_is_normal(self) -> None:
        self.assertEqual(choose(), "normal")

    def test_each_state(self) -> None:
        self.assertEqual(choose(talk_phase=TALK_LISTEN), "listen")
        self.assertEqual(choose(talk_phase=TALK_THINK), "think")
        self.assertEqual(choose(speaking_kind=KIND_MORNING_SUMMARY), "happy")
        self.assertEqual(choose(session_active=True), "sleep")
        self.assertEqual(choose(hour=21), "sleepy")
        self.assertEqual(choose(hour=20), "normal")

    def test_evening_suggestion_does_not_make_happy(self) -> None:
        self.assertEqual(choose(speaking_kind="evening_suggestion"), "normal")

    def test_priority(self) -> None:
        self.assertEqual(choose(alarm_ringing=True, talk_phase=TALK_LISTEN, session_active=True), "wake")
        self.assertEqual(choose(talk_phase=TALK_LISTEN, speaking_kind=KIND_MORNING_SUMMARY, session_active=True), "listen")
        self.assertEqual(choose(speaking_kind=KIND_MORNING_SUMMARY, session_active=True), "happy")
        self.assertEqual(choose(session_active=True, hour=23), "sleep")

    def test_every_result_is_a_known_expression(self) -> None:
        known = {e.value for e in Expression}
        for phase in (None, TALK_LISTEN, TALK_THINK):
            for kind in (None, KIND_MORNING_SUMMARY):
                for active in (False, True):
                    for hour in (3, 12, 22):
                        self.assertIn(choose(talk_phase=phase, speaking_kind=kind, session_active=active, hour=hour), known)

    def test_all_expressions_have_params(self) -> None:
        self.assertEqual(set(EXPRESSIONS), set(Expression))


if __name__ == "__main__":
    unittest.main()
