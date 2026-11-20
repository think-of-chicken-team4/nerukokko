"""eyes/ipc.py（本体と表示のやりとり）と eyes/menu.py（目・メニューの切り替え）のテスト。
実行：cd firmware/chicken && python3 -m unittest discover -s tests"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from eyes.ipc import (
    COMMAND_ALARM_VOLUME_DOWN,
    COMMAND_ALARM_VOLUME_UP,
    COMMAND_PREVIEW_ALARM,
    COMMAND_PREVIEW_VOICE,
    COMMAND_STOP_RECORDING,
    COMMAND_TALK,
    COMMAND_VOLUME_DOWN,
    COMMAND_VOLUME_UP,
    CommandReceiver,
    CommandSender,
    DisplayState,
    read_state,
    write_json_atomic,
    write_state,
)
from eyes.menu import (
    ALARM_VOLUME_DOWN_BUTTON,
    ALARM_PREVIEW_BUTTON,
    ALARM_VOLUME_UP_BUTTON,
    BACK_BUTTON,
    GEAR_BUTTON,
    TALK_ZONE,
    VOICE_PREVIEW_BUTTON,
    VOLUME_DOWN_BUTTON,
    VOLUME_UP_BUTTON,
    MenuState,
    Screen,
)

NORMAL = DisplayState()
BUSY = DisplayState(busy=True)
LISTENING = DisplayState(busy=True, talk_phase="listen")
THINKING = DisplayState(busy=True, talk_phase="think")
RINGING = DisplayState(expression="wake", alarm_ringing=True)


class StateFileTest(unittest.TestCase):
    def test_roundtrip_and_stale(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "display.json"
            write_state(path, DisplayState(expression="wake", busy=True, alarm_ringing=True), now=1000.0)
            self.assertEqual(read_state(path, now=1002.0, stale_sec=10), DisplayState("wake", True, True))
            self.assertIsNone(read_state(path, now=1011.0, stale_sec=10))  # 本体が止まっている

    def test_missing_or_broken_file_is_none(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "display.json"
            self.assertIsNone(read_state(path, now=0, stale_sec=10))
            path.write_text("{ここは壊れている", encoding="utf-8")
            self.assertIsNone(read_state(path, now=0, stale_sec=10))
            path.write_text('{"updated": "abc"}', encoding="utf-8")
            self.assertIsNone(read_state(path, now=0, stale_sec=10))

    def test_atomic_write_leaves_no_temp_files(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "sub" / "display.json"
            write_json_atomic(path, {"a": 1})
            write_json_atomic(path, {"a": 2})
            self.assertEqual([p.name for p in path.parent.iterdir()], ["display.json"])


class CommandTest(unittest.TestCase):
    def test_receiver_gets_each_command_once(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "cmd.json"
            receiver = CommandReceiver(path)
            sender = CommandSender(path)
            self.assertIsNone(receiver.poll())
            sender.send(COMMAND_TALK)
            self.assertEqual(receiver.poll(), COMMAND_TALK)
            self.assertIsNone(receiver.poll())  # 同じ操作は二度受け取らない
            sender.send(COMMAND_TALK)
            self.assertEqual(receiver.poll(), COMMAND_TALK)

    def test_old_command_before_start_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "cmd.json"
            CommandSender(path).send(COMMAND_TALK)  # 本体が止まっているあいだに押された
            receiver = CommandReceiver(path)  # 本体の起動
            self.assertIsNone(receiver.poll())
            CommandSender(path).send(COMMAND_TALK)  # 表示を再起動しても、番号は続く
            self.assertEqual(receiver.poll(), COMMAND_TALK)

    def test_broken_command_file_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "cmd.json"
            receiver = CommandReceiver(path)
            path.write_text("壊れている", encoding="utf-8")
            self.assertIsNone(receiver.poll())


def inside(rect, dx=0.5, dy=0.5):
    x, y, w, h = rect
    return (int(x + w * dx), int(y + h * dy))


SLEEPING = DisplayState(expression="sleep")


class MenuTest(unittest.TestCase):
    def test_tap_center_starts_talking(self) -> None:
        m = MenuState(timeout_sec=20)
        self.assertEqual(m.tap(1.0, inside(TALK_ZONE), NORMAL).command, COMMAND_TALK)

    def test_tap_outside_center_does_nothing(self) -> None:
        m = MenuState(timeout_sec=20)
        for point in ((5, 5), (790, 470), (400, 20), (10, 240), (400, 470)):
            self.assertIsNone(m.tap(1.0, point, NORMAL).command, point)
            self.assertEqual(m.screen, Screen.EYES)

    def test_any_tap_stops_recording_while_listening(self) -> None:
        m = MenuState(timeout_sec=20)
        m.tap(0.0, inside(TALK_ZONE), NORMAL)
        self.assertEqual(m.tap(2.0, (10, 450), LISTENING).command, COMMAND_STOP_RECORDING)  # 端でも、どこでもよい

    def test_second_tap_right_after_start_is_ignored(self) -> None:
        m = MenuState(timeout_sec=20)
        self.assertEqual(m.tap(1.0, inside(TALK_ZONE), NORMAL).command, COMMAND_TALK)
        # 本体の状態が届く前でも、届いて聞いている目に変わった直後でも、1秒以内のタップは無視する
        self.assertIsNone(m.tap(1.2, inside(TALK_ZONE), NORMAL).command)
        self.assertIsNone(m.tap(1.5, inside(TALK_ZONE), LISTENING).command)
        self.assertEqual(m.tap(2.1, inside(TALK_ZONE), LISTENING).command, COMMAND_STOP_RECORDING)

    def test_taps_do_nothing_while_thinking_or_speaking(self) -> None:
        m = MenuState(timeout_sec=20)
        for phase in ("think", "speak"):
            state = DisplayState(busy=True, talk_phase=phase)
            self.assertIsNone(m.tap(10.0, inside(TALK_ZONE), state).command)
            self.assertEqual(m.tap(10.5, inside(GEAR_BUTTON), state).screen, Screen.EYES)  # 歯車も開かない

    def test_gear_opens_options_and_back_closes(self) -> None:
        m = MenuState(timeout_sec=20)
        self.assertEqual(m.tap(0.0, inside(GEAR_BUTTON), NORMAL).screen, Screen.OPTIONS)
        self.assertEqual(m.tap(1.0, inside(BACK_BUTTON), NORMAL).screen, Screen.EYES)

    def test_gear_is_away_from_screen_edge(self) -> None:
        m = MenuState(timeout_sec=20)
        # 画面の左端（x=0）の誤タッチでは、開かない（実機のログに (0, 57) があった）
        self.assertEqual(m.tap(0.0, (0, 57), NORMAL).screen, Screen.EYES)

    def test_options_timeout_returns_to_eyes(self) -> None:
        m = MenuState(timeout_sec=20)
        m.tap(10.0, inside(GEAR_BUTTON), NORMAL)
        self.assertEqual(m.tick(29.9, NORMAL), Screen.OPTIONS)
        self.assertEqual(m.tick(30.0, NORMAL), Screen.EYES)

    def test_timeout_counts_from_last_touch(self) -> None:
        m = MenuState(timeout_sec=20)
        m.tap(0.0, inside(GEAR_BUTTON), NORMAL)
        m.tap(15.0, (5, 5), NORMAL)  # 何もない所でも、触れば時間は延びる
        self.assertEqual(m.tick(34.0, NORMAL), Screen.OPTIONS)
        self.assertEqual(m.tick(35.0, NORMAL), Screen.EYES)

    def test_volume_buttons_in_options(self) -> None:
        m = MenuState(timeout_sec=20)
        m.tap(0.0, inside(GEAR_BUTTON), NORMAL)
        self.assertEqual(m.tap(1.0, inside(VOLUME_UP_BUTTON), NORMAL).command, COMMAND_VOLUME_UP)
        self.assertEqual(m.tap(1.1, inside(VOLUME_UP_BUTTON), NORMAL).command, COMMAND_VOLUME_UP)  # 続けて押せる
        self.assertEqual(m.tap(1.2, inside(VOLUME_DOWN_BUTTON), NORMAL).command, COMMAND_VOLUME_DOWN)
        self.assertEqual(m.tap(1.3, inside(VOLUME_DOWN_BUTTON), NORMAL).screen, Screen.OPTIONS)

    def test_alarm_volume_buttons_are_separate(self) -> None:
        m = MenuState(timeout_sec=20)
        m.tap(0.0, inside(GEAR_BUTTON), NORMAL)
        self.assertEqual(m.tap(1.0, inside(ALARM_VOLUME_UP_BUTTON), NORMAL).command, COMMAND_ALARM_VOLUME_UP)
        self.assertEqual(m.tap(1.1, inside(ALARM_VOLUME_DOWN_BUTTON), NORMAL).command, COMMAND_ALARM_VOLUME_DOWN)
        self.assertEqual(m.tap(1.2, inside(VOLUME_UP_BUTTON), NORMAL).command, COMMAND_VOLUME_UP)  # 会話のほうとは、別のボタン

    def test_preview_buttons_in_options(self) -> None:
        m = MenuState(timeout_sec=20)
        m.tap(0.0, inside(GEAR_BUTTON), NORMAL)
        self.assertEqual(m.tap(1.0, inside(VOICE_PREVIEW_BUTTON), NORMAL).command, COMMAND_PREVIEW_VOICE)
        self.assertEqual(m.tap(1.1, inside(ALARM_PREVIEW_BUTTON), NORMAL).command, COMMAND_PREVIEW_ALARM)
        self.assertEqual(m.tap(1.2, inside(ALARM_PREVIEW_BUTTON), NORMAL).screen, Screen.OPTIONS)  # オプション画面のまま

    def test_preview_buttons_do_nothing_while_alarm_ringing(self) -> None:
        m = MenuState(timeout_sec=20)
        self.assertIsNone(m.tap(0.0, inside(ALARM_PREVIEW_BUTTON), RINGING).command)

    def test_volume_buttons_do_not_change_volume_on_eyes_screen(self) -> None:
        m = MenuState(timeout_sec=20)
        # 目の画面では、音量のボタンはない（そこは、話しかける範囲なので、会話が始まるだけ）
        self.assertNotEqual(m.tap(0.0, inside(VOLUME_UP_BUTTON), NORMAL).command, COMMAND_VOLUME_UP)

    def test_option_rows_do_not_overlap(self) -> None:
        rects = (
            VOLUME_DOWN_BUTTON, VOLUME_UP_BUTTON, VOICE_PREVIEW_BUTTON,
            ALARM_VOLUME_DOWN_BUTTON, ALARM_VOLUME_UP_BUTTON, ALARM_PREVIEW_BUTTON, BACK_BUTTON,
        )
        for i, a in enumerate(rects):
            for b in rects[i + 1:]:
                overlap_x = a[0] < b[0] + b[2] and b[0] < a[0] + a[2]
                overlap_y = a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
                self.assertFalse(overlap_x and overlap_y, (a, b))

    def test_sleeping_eyes_need_two_taps(self) -> None:
        m = MenuState(timeout_sec=20)
        self.assertIsNone(m.tap(10.0, inside(TALK_ZONE), SLEEPING).command)  # 1 回目は、目を覚ますだけ
        self.assertTrue(m.eyes_awake(11.0))
        self.assertEqual(m.tap(12.0, inside(TALK_ZONE), SLEEPING).command, COMMAND_TALK)  # 4 秒以内の 2 回目で始まる

    def test_sleeping_second_tap_too_late_wakes_again(self) -> None:
        m = MenuState(timeout_sec=20)
        m.tap(10.0, inside(TALK_ZONE), SLEEPING)
        self.assertFalse(m.eyes_awake(14.1))
        self.assertIsNone(m.tap(14.5, inside(TALK_ZONE), SLEEPING).command)  # また、目を覚ますだけ

    def test_alarm_ringing_blocks_all_touch(self) -> None:
        m = MenuState(timeout_sec=20)
        self.assertIsNone(m.tap(0.0, inside(TALK_ZONE), RINGING).command)
        self.assertEqual(m.tap(1.0, inside(GEAR_BUTTON), RINGING).screen, Screen.EYES)
        m.tap(2.0, inside(GEAR_BUTTON), NORMAL)
        self.assertEqual(m.tick(3.0, RINGING), Screen.EYES)  # オプションを開いたままアラームが鳴ったら閉じる
        self.assertIsNone(m.tap(4.0, inside(TALK_ZONE), RINGING).command)


class StateFileExtraTest(unittest.TestCase):
    def test_talk_phase_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "display.json"
            write_state(path, LISTENING, now=1000.0)
            self.assertEqual(read_state(path, now=1001.0, stale_sec=10), LISTENING)
            write_state(path, NORMAL, now=1000.0)
            self.assertIsNone(read_state(path, now=1001.0, stale_sec=10).talk_phase)

    def test_volume_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "display.json"
            write_state(path, DisplayState(volume=0.6, alarm_volume=0.9), now=1000.0)
            got = read_state(path, now=1001.0, stale_sec=10)
            self.assertEqual((got.volume, got.alarm_volume), (0.6, 0.9))


if __name__ == "__main__":
    unittest.main()
