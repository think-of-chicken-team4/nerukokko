"""eyes/ipc.py（本体と表示のやりとり）と eyes/menu.py（目・メニューの切り替え）のテスト。
実行：cd firmware/chicken && python3 -m unittest discover -s tests"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from eyes.ipc import (
    COMMAND_STOP_RECORDING,
    COMMAND_TALK,
    CommandReceiver,
    CommandSender,
    DisplayState,
    read_state,
    write_json_atomic,
    write_state,
)
from eyes.menu import BACK_BUTTON, TALK_BUTTON, MenuState, Screen

NORMAL = DisplayState()
BUSY = DisplayState(busy=True)
LISTENING = DisplayState(busy=True, talk_phase="listen")
THINKING = DisplayState(busy=True, talk_phase="think")
RINGING = DisplayState(expression="wake", alarm_ringing=True)


def center(rect):
    x, y, w, h = rect
    return (x + w // 2, y + h // 2)


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


class MenuTest(unittest.TestCase):
    def test_tap_opens_menu_and_talk_sends_command(self) -> None:
        m = MenuState(timeout_sec=20)
        self.assertEqual(m.screen, Screen.EYES)
        self.assertEqual(m.tap(1.0, (400, 240), NORMAL).screen, Screen.MENU)
        result = m.tap(2.0, center(TALK_BUTTON), NORMAL)
        self.assertEqual(result.command, COMMAND_TALK)

    def test_tap_outside_buttons_does_nothing(self) -> None:
        m = MenuState(timeout_sec=20)
        m.tap(1.0, (400, 240), NORMAL)
        result = m.tap(2.0, (5, 5), NORMAL)
        self.assertIsNone(result.command)
        self.assertEqual(result.screen, Screen.MENU)

    def test_back_button_and_timeout_return_to_eyes(self) -> None:
        m = MenuState(timeout_sec=20)
        m.tap(1.0, (400, 240), NORMAL)
        self.assertEqual(m.tap(2.0, center(BACK_BUTTON), NORMAL).screen, Screen.EYES)
        m.tap(10.0, (400, 240), NORMAL)
        self.assertEqual(m.tick(29.9, NORMAL), Screen.MENU)
        self.assertEqual(m.tick(30.0, NORMAL), Screen.EYES)

    def test_timeout_counts_from_last_touch(self) -> None:
        m = MenuState(timeout_sec=20)
        m.tap(0.0, (400, 240), NORMAL)
        m.tap(15.0, (5, 5), NORMAL)  # 何もない所でも、触れば時間は延びる
        self.assertEqual(m.tick(34.0, NORMAL), Screen.MENU)
        self.assertEqual(m.tick(35.0, NORMAL), Screen.EYES)

    def test_busy_disables_talk_and_keeps_menu(self) -> None:
        m = MenuState(timeout_sec=20)
        m.tap(0.0, (400, 240), NORMAL)
        self.assertIsNone(m.tap(1.0, center(TALK_BUTTON), BUSY).command)  # 会話の最中は二重に始めない
        self.assertEqual(m.tick(100.0, BUSY), Screen.MENU)  # 会話の最中は、時間がたってもメニューのまま

    def test_talk_button_stops_recording_while_listening(self) -> None:
        m = MenuState(timeout_sec=20)
        m.tap(0.0, (400, 240), NORMAL)
        self.assertEqual(m.tap(1.0, center(TALK_BUTTON), LISTENING).command, COMMAND_STOP_RECORDING)
        self.assertIsNone(m.tap(2.0, center(TALK_BUTTON), THINKING).command)  # 返事待ちは何もしない

    def test_talk_phase_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "display.json"
            write_state(path, LISTENING, now=1000.0)
            self.assertEqual(read_state(path, now=1001.0, stale_sec=10), LISTENING)
            write_state(path, NORMAL, now=1000.0)
            self.assertIsNone(read_state(path, now=1001.0, stale_sec=10).talk_phase)

    def test_alarm_ringing_blocks_touch_and_closes_menu(self) -> None:
        m = MenuState(timeout_sec=20)
        self.assertEqual(m.tap(0.0, (400, 240), RINGING).screen, Screen.EYES)  # メニューを開かない
        m.tap(1.0, (400, 240), NORMAL)
        self.assertEqual(m.tick(2.0, RINGING), Screen.EYES)  # メニューを開いたままアラームが鳴ったら閉じる
        self.assertIsNone(m.tap(3.0, center(TALK_BUTTON), RINGING).command)


if __name__ == "__main__":
    unittest.main()
