"""本体（app.py）と表示（eyes）のあいだのやりとり。ファイルだけを使う（表示が落ちても本体は止まらない）。

    本体 ──書く──> 状態ファイル（display.json）   ──読む──> 表示（表情・メニュー）
    本体 <──読む── 操作ファイル（display_command.json） <──書く── 表示（タッチで「話す」など）

どちらも、一時ファイルに書いてから置き換える（読みかけの壊れたファイルを読まない）。
本体（root）と画面（デスクトップのユーザー）は別のユーザーで動くので、置き場所は共通のフォルダにする（DISPLAY_DIR）。
pygame に依存しないので、本体からも使える。docs/dsi-display-spec.md §4。
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

COMMAND_TALK = "talk"  # 会話を始める（録音 → voice-chat → 返事を再生）
COMMAND_STOP_RECORDING = "stop_recording"  # 話し終わった（録音をすぐ止めて、返事を待つ）


def write_json_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.chmod(tmp, 0o666)  # 本体（root）と画面（ふつうのユーザー）の両方が読めるように。秘密の値は入れない
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_json(path: Path) -> Optional[dict]:
    """読めない・壊れている・まだない、は None（呼ぶ側は前の状態のまま続ける）"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


@dataclass(frozen=True)
class DisplayState:
    """本体 → 表示。表示が知りたいことだけ"""

    expression: str = "normal"  # normal / sleepy / happy / wake（eye_state.Expression の値）
    busy: bool = False  # 会話の最中（録音・返事待ち・再生）。メニューの「話す」を押せなくする
    alarm_ringing: bool = False  # アラーム中。タッチでは止めない（二度寝防止）ので、メニューも開かない
    talk_phase: Optional[str] = None  # 会話の段階：listen（録音中）・think（返事待ち）・None（会話していない）


def write_state(path: Path, state: DisplayState, now: Optional[float] = None) -> None:
    write_json_atomic(path, {
        "updated": time.time() if now is None else now,
        "expression": state.expression,
        "busy": state.busy,
        "alarm_ringing": state.alarm_ringing,
        "talk_phase": state.talk_phase,
    })


def read_state(path: Path, now: float, stale_sec: float) -> Optional[DisplayState]:
    """状態ファイルを読む。ない・壊れている・stale_sec より古いときは None（本体が止まっている）"""
    data = read_json(path)
    if data is None:
        return None
    try:
        if now - float(data["updated"]) > stale_sec:
            return None
        return DisplayState(
            expression=str(data.get("expression", "normal")),
            busy=bool(data.get("busy", False)),
            alarm_ringing=bool(data.get("alarm_ringing", False)),
            talk_phase=str(data["talk_phase"]) if data.get("talk_phase") else None,
        )
    except (KeyError, TypeError, ValueError):
        return None


class CommandSender:
    """表示側：操作を、通し番号つきで操作ファイルに書く"""

    def __init__(self, path: Path) -> None:
        self._path = path
        previous = read_json(path)
        self._seq = int(previous["seq"]) if previous and "seq" in previous else 0

    def send(self, command: str, now: Optional[float] = None) -> int:
        self._seq += 1
        write_json_atomic(self._path, {"seq": self._seq, "command": command, "at": time.time() if now is None else now})
        return self._seq


class CommandReceiver:
    """本体側：新しい操作だけを受け取る。起動前に書かれた古い操作は捨てる（再起動で二重に実行しない）"""

    def __init__(self, path: Path) -> None:
        self._path = path
        previous = read_json(path)
        self._last_seq = int(previous["seq"]) if previous and "seq" in previous else 0

    def poll(self) -> Optional[str]:
        data = read_json(self._path)
        if data is None:
            return None
        try:
            seq = int(data["seq"])
            command = str(data["command"])
        except (KeyError, TypeError, ValueError):
            return None
        if seq <= self._last_seq:
            return None
        self._last_seq = seq
        return command
