"""会話の返事・合図の音量（タッチパネルで調整。アラームの音量は別で、ここでは変えない）。

pygame に依存しない。値は 0.1 刻みの 0.1〜1.0。画面（eyes）が「上げる・下げる」を本体へ送り、本体が値を持って保存する。
"""

from __future__ import annotations

import json
from pathlib import Path

VOLUME_MIN = 0.1
VOLUME_MAX = 1.0
VOLUME_STEP = 0.1


def clamp(volume: float) -> float:
    return round(min(VOLUME_MAX, max(VOLUME_MIN, volume)), 1)


def step(volume: float, direction: int) -> float:
    """direction が正なら 1 段上げ、負なら 1 段下げる。範囲の外には出ない"""
    return clamp(volume + (VOLUME_STEP if direction > 0 else -VOLUME_STEP))


def load(path: Path, default: float) -> float:
    """保存した音量を読む。ない・壊れているときは default（環境変数の SPEAKER_VOLUME）"""
    try:
        return clamp(float(json.loads(path.read_text(encoding="utf-8"))["volume"]))
    except (OSError, ValueError, KeyError, TypeError):
        return clamp(default)


def save(path: Path, volume: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"volume": clamp(volume)}), encoding="utf-8")
