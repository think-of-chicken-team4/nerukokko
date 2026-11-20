"""目の画面とメニュー画面の切り替え（描画に依存しない状態管理）。

    [目の画面] ──タッチ──> [メニュー画面] ──「話す」をタップ──> 会話を始める（操作 talk を返す）
                                   │ 何もしないで MENU_TIMEOUT_SEC たつ／「もどる」をタップ
                                   ▼
                              [目の画面]

アラーム中は、タッチでメニューを開かない（アラームはたまごを巣に戻したときだけ止まる。docs/dsi-display-spec.md §4）。
時刻・タッチ位置は引数で受け取るだけなので、画面なしでテストできる。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Tuple

from .ipc import COMMAND_STOP_RECORDING, COMMAND_TALK, COMMAND_VOLUME_DOWN, COMMAND_VOLUME_UP, DisplayState

Point = Tuple[int, int]
Rect = Tuple[int, int, int, int]  # x, y, 幅, 高さ


class Screen(Enum):
    EYES = "eyes"
    MENU = "menu"


# 実機で調整する値は、integration_config.py（MENU_TIMEOUT_SEC）。ボタンの位置・大きさは、指で押しやすい大きさにする（D3）
# 操作を送った直後は、「話す」ボタンのタッチを受け付けない（指が同じ場所をもう一度押した判定や、本体の状態が届くまでの二重押しを防ぐ）。
# 実機で調整する（D3）。「話し終わった」が一瞬で消える問題の対策
TALK_LOCKOUT_SEC = 1.0
SCREEN_SIZE = (800, 480)
TALK_BUTTON: Rect = (150, 110, 500, 150)
BACK_BUTTON: Rect = (300, 310, 200, 100)
VOLUME_DOWN_BUTTON: Rect = (150, 310, 120, 100)
VOLUME_UP_BUTTON: Rect = (530, 310, 120, 100)


def contains(rect: Rect, point: Point) -> bool:
    x, y, w, h = rect
    return x <= point[0] < x + w and y <= point[1] < y + h


@dataclass
class MenuResult:
    screen: Screen
    command: Optional[str] = None  # 本体に送る操作（talk など）


class MenuState:
    def __init__(self, timeout_sec: float) -> None:
        self._timeout = timeout_sec
        self.screen = Screen.EYES
        self._last_touch = 0.0
        self._talk_locked_until = 0.0

    def tap(self, now: float, point: Point, state: DisplayState) -> MenuResult:
        """タッチ（指を置いた瞬間）を渡す。返り値で、画面と、本体に送る操作が分かる"""
        if state.alarm_ringing:
            self.screen = Screen.EYES  # アラーム中はタッチを受け付けない
            return MenuResult(self.screen)
        self._last_touch = now
        if self.screen is Screen.EYES:
            self.screen = Screen.MENU
            return MenuResult(self.screen)
        if contains(BACK_BUTTON, point):
            self.screen = Screen.EYES
            return MenuResult(self.screen)
        if contains(VOLUME_DOWN_BUTTON, point):
            return MenuResult(self.screen, COMMAND_VOLUME_DOWN)  # 音量は、続けて押せるように、二重押しの防止は付けない
        if contains(VOLUME_UP_BUTTON, point):
            return MenuResult(self.screen, COMMAND_VOLUME_UP)
        if contains(TALK_BUTTON, point):
            if now < self._talk_locked_until:
                return MenuResult(self.screen)  # 操作を送った直後の、二重のタッチは無視する
            if not state.busy:
                self._talk_locked_until = now + TALK_LOCKOUT_SEC
                return MenuResult(self.screen, COMMAND_TALK)
            if state.talk_phase == "listen":
                self._talk_locked_until = now + TALK_LOCKOUT_SEC
                return MenuResult(self.screen, COMMAND_STOP_RECORDING)  # 録音中は、同じボタンが「話し終わった」になる
            # 返事待ちのあいだは、メニューに残して何もしない
        return MenuResult(self.screen)

    def tick(self, now: float, state: DisplayState) -> Screen:
        """時間が進んだ。何もしないまま長くたったら、目の画面に戻る（会話の最中は戻さない）"""
        if state.alarm_ringing:
            self.screen = Screen.EYES
        elif self.screen is Screen.MENU and not state.busy and now - self._last_touch >= self._timeout:
            self.screen = Screen.EYES
        return self.screen
