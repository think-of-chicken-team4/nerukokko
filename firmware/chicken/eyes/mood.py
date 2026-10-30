"""鶏の状態から、目の表情を選ぶ（描画に依存しない）。docs/dsi-display-spec.md §3。

優先順位：アラーム > 会話（聞いている・考え中） > 朝のコメント（うれしい） > 記録中（眠り） > 夕方以降（眠い） > 通常
"""

from __future__ import annotations

from typing import Optional

TALK_LISTEN = "listen"  # 録音中
TALK_THINK = "think"  # 送信〜返事を待っている

KIND_MORNING_SUMMARY = "morning_summary"  # announcements の kind（api-spec §6）


def choose_expression(
    *,
    alarm_ringing: bool,
    talk_phase: Optional[str],
    speaking_kind: Optional[str],
    session_active: bool,
    hour: int,
    evening_hour: int,
) -> str:
    """eye_state.Expression の値（文字列）を返す。hour は 0〜23（鶏の時計の現地時刻）"""
    if alarm_ringing:
        return "wake"
    if talk_phase == TALK_LISTEN:
        return "listen"
    if talk_phase == TALK_THINK:
        return "think"
    if speaking_kind == KIND_MORNING_SUMMARY:
        return "happy"
    if session_active:
        return "sleep"
    if hour >= evening_hour:
        return "sleepy"
    return "normal"
