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

from .ipc import COMMAND_TALK, DisplayState

Point = Tuple[int, int]
Rect = Tuple[int, int, int, int]  # x, y, 幅, 高さ


class Screen(Enum):
    EYES = "eyes"
    MENU = "menu"


# 実機で調整する値は、integration_config.py（MENU_TIMEOUT_SEC）。ボタンの位置・大きさは、指で押しやすい大きさにする（D3）
SCREEN_SIZE = (800, 480)
TALK_BUTTON: Rect = (150, 110, 500, 150)
BACK_BUTTON: Rect = (300, 310, 200, 100)


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
        if contains(TALK_BUTTON, point) and not state.busy:
            return MenuResult(self.screen, COMMAND_TALK)  # 会話の最中は、メニューに残して「話す」だけ無効にする
        return MenuResult(self.screen)

    def tick(self, now: float, state: DisplayState) -> Screen:
        """時間が進んだ。何もしないまま長くたったら、目の画面に戻る（会話の最中は戻さない）"""
        if state.alarm_ringing:
            self.screen = Screen.EYES
        elif self.screen is Screen.MENU and not state.busy and now - self._last_touch >= self._timeout:
            self.screen = Screen.EYES
        return self.screen
