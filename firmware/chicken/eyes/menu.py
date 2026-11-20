"""目の画面とオプション画面の切り替え・タッチの判定（描画に依存しない状態管理）。

    [目の画面] ── 中央あたりをタップ ──> 会話が始まる（操作 talk）
        │                                  聞いている間は、画面のどこをタップしても話し終わり（操作 stop_recording）
        │ 左上の歯車をタップ
        ▼
    [オプション画面]（会話とアラームの音量の「−」「＋」・「もどる」）── 何もしないで MENU_TIMEOUT_SEC たつ／「もどる」──> [目の画面]

- 眠っている目（記録中）のときは、1 回目のタップは目を覚ますだけで、WAKE_TAP_WINDOW_SEC 以内の 2 回目のタップで会話を始める
  （寝ている間に手や物が当たって、会話が始まるのを防ぐ）。
- アラーム中は、タッチを受け付けない（アラームはたまごを巣に戻したときだけ止まる。docs/dsi-display-spec.md §4）。
- 時刻・タッチ位置は引数で受け取るだけなので、画面なしでテストできる。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Tuple

from .ipc import (
    COMMAND_ALARM_VOLUME_DOWN,
    COMMAND_ALARM_VOLUME_UP,
    COMMAND_STOP_RECORDING,
    COMMAND_TALK,
    COMMAND_VOLUME_DOWN,
    COMMAND_VOLUME_UP,
    DisplayState,
)

Point = Tuple[int, int]
Rect = Tuple[int, int, int, int]  # x, y, 幅, 高さ


class Screen(Enum):
    EYES = "eyes"
    OPTIONS = "options"


# 実機で調整する値（D3）。ボタンの位置・大きさは、指で押しやすい大きさにする。メニューから戻るまでの時間は integration_config.py（MENU_TIMEOUT_SEC）
SCREEN_SIZE = (800, 480)
TALK_ZONE: Rect = (160, 96, 480, 288)  # 目の画面の中央あたり。ここをタップすると会話が始まる。端は反応させない（誤って触れたとき対策）
GEAR_BUTTON: Rect = (30, 30, 100, 100)  # 左上の歯車。端から離す（画面の端のタッチは、誤って反応することがある）
# オプション画面は 2 行：会話の音量、アラームの音量。各行は「ラベル  [−]  数字  [＋]」
VOLUME_DOWN_BUTTON: Rect = (270, 50, 130, 100)  # 会話の音量（1 行目）
VOLUME_UP_BUTTON: Rect = (590, 50, 130, 100)
ALARM_VOLUME_DOWN_BUTTON: Rect = (270, 185, 130, 100)  # アラームの音量（2 行目）
ALARM_VOLUME_UP_BUTTON: Rect = (590, 185, 130, 100)
BACK_BUTTON: Rect = (300, 335, 200, 100)
# 操作（話す・話し終わった）を送った直後は、次の操作を受け付けない。指が同じ場所をもう一度押した判定や、本体の状態が届くまでの二重押しを防ぐ
TALK_LOCKOUT_SEC = 1.0
# 眠っている目のとき、1 回目のタップから、この時間のうちに 2 回目をタップすると会話が始まる
WAKE_TAP_WINDOW_SEC = 4.0
SLEEP_EXPRESSION = "sleep"


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
        self._locked_until = 0.0
        self._awake_until = 0.0

    def eyes_awake(self, now: float) -> bool:
        """眠っている目を、1 回目のタップで、一時的に開けておく時間か"""
        return now < self._awake_until

    def tap(self, now: float, point: Point, state: DisplayState) -> MenuResult:
        """タッチ（指を置いた瞬間）を渡す。返り値で、画面と、本体に送る操作が分かる"""
        if state.alarm_ringing:
            self.screen = Screen.EYES  # アラーム中はタッチを受け付けない
            return MenuResult(self.screen)
        self._last_touch = now
        if self.screen is Screen.OPTIONS:
            return self._tap_options(point)
        return self._tap_eyes(now, point, state)

    def _tap_options(self, point: Point) -> MenuResult:
        if contains(BACK_BUTTON, point):
            self.screen = Screen.EYES
            return MenuResult(self.screen)
        if contains(VOLUME_DOWN_BUTTON, point):
            return MenuResult(self.screen, COMMAND_VOLUME_DOWN)  # 音量は、続けて押せるように、二重押しの防止は付けない
        if contains(VOLUME_UP_BUTTON, point):
            return MenuResult(self.screen, COMMAND_VOLUME_UP)
        if contains(ALARM_VOLUME_DOWN_BUTTON, point):
            return MenuResult(self.screen, COMMAND_ALARM_VOLUME_DOWN)
        if contains(ALARM_VOLUME_UP_BUTTON, point):
            return MenuResult(self.screen, COMMAND_ALARM_VOLUME_UP)
        return MenuResult(self.screen)

    def _tap_eyes(self, now: float, point: Point, state: DisplayState) -> MenuResult:
        if state.talk_phase == "listen":
            if now < self._locked_until:
                return MenuResult(self.screen)  # 話し始めの指が、もう一度反応したもの
            self._locked_until = now + TALK_LOCKOUT_SEC
            return MenuResult(self.screen, COMMAND_STOP_RECORDING)  # 聞いている間は、どこをタップしても話し終わり
        if state.busy:
            return MenuResult(self.screen)  # 考え中・返事を話している間は、何もしない
        if contains(GEAR_BUTTON, point):
            self.screen = Screen.OPTIONS
            return MenuResult(self.screen)
        if contains(TALK_ZONE, point):
            if now < self._locked_until:
                return MenuResult(self.screen)
            if state.expression == SLEEP_EXPRESSION and not self.eyes_awake(now):
                self._awake_until = now + WAKE_TAP_WINDOW_SEC  # 1 回目は、目を覚ますだけ
                return MenuResult(self.screen)
            self._locked_until = now + TALK_LOCKOUT_SEC
            self._awake_until = 0.0
            return MenuResult(self.screen, COMMAND_TALK)
        return MenuResult(self.screen)

    def tick(self, now: float, state: DisplayState) -> Screen:
        """時間が進んだ。オプション画面のまま長くたったら、目の画面に戻る（アラーム中は、すぐ戻す）"""
        if state.alarm_ringing:
            self.screen = Screen.EYES
        elif self.screen is Screen.OPTIONS and now - self._last_touch >= self._timeout:
            self.screen = Screen.EYES
        return self.screen
