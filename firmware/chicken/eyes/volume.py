"""音量（会話の返事・合図と、アラームは、別々に、タッチパネルのオプション画面で調整する）。

pygame に依存しない。値は 0.1 刻み。会話は 0.1〜1.0、アラームは、小さくしすぎて起きられなくなるのを防ぐため、0.5〜1.0。
画面（eyes）が「上げる・下げる」を本体へ送り、本体が値を持って保存する。
"""

from __future__ import annotations

import json
from pathlib import Path

VOLUME_MIN = 0.1
ALARM_VOLUME_MIN = 0.5  # アラームの下限。音量は 1 段 2.5 dB の対数（hardware.volume_to_gain）なので、0.5 は最大より約 12 dB 小さい（実機で決める：C5）
VOLUME_MAX = 1.0
VOLUME_STEP = 0.1


def clamp(volume: float, minimum: float = VOLUME_MIN) -> float:
    return round(min(VOLUME_MAX, max(minimum, volume)), 1)


def step(volume: float, direction: int, minimum: float = VOLUME_MIN) -> float:
    """direction が正なら 1 段上げ、負なら 1 段下げる。範囲の外には出ない"""
    return clamp(volume + (VOLUME_STEP if direction > 0 else -VOLUME_STEP), minimum)


def load(path: Path, default: float, minimum: float = VOLUME_MIN) -> float:
    """保存した音量を読む。ない・壊れているときは default（環境変数の値）"""
    try:
        return clamp(float(json.loads(path.read_text(encoding="utf-8"))["volume"]), minimum)
    except (OSError, ValueError, KeyError, TypeError):
        return clamp(default, minimum)


def save(path: Path, volume: float, minimum: float = VOLUME_MIN) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"volume": clamp(volume, minimum)}), encoding="utf-8")
