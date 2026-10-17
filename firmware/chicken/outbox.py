"""サーバーへ送る計測データの置き場（送れなかったら手元に残して送り直す。docs/api-spec.md §1-4・§1-5）。

- 計測した時刻（timestamp）を付けて入れる。送り直しても時刻は変えない（サーバーが重複を無視するため）
- ファイルにも保存するので、鶏を再起動しても消えない
- 24時間より古いデータは捨てる（サーバーも48時間より前は受け付けない）
ハードウェアに依存しない。tests/test_outbox.py でテストしている。
"""

from __future__ import annotations

import calendar
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

KINDS = ("environment", "breathing", "motion_events", "audio_events", "presence_events", "charge_events")
MAX_PER_KIND = 1000  # 1回の送信で1種類あたりの上限（api-spec §3-1）
MAX_AGE_SEC = 24 * 60 * 60


def iso(t: float) -> str:
    """epoch 秒 → "2026-10-01T21:05:00.123Z" """
    ms = int(round(t * 1000))
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms // 1000)) + f".{ms % 1000:03d}Z"


def parse_iso(value: str) -> float:
    base, _, frac = value.rstrip("Z").partition(".")
    seconds = calendar.timegm(time.strptime(base, "%Y-%m-%dT%H:%M:%S"))
    return seconds + (int(frac[:3].ljust(3, "0")) / 1000 if frac else 0)


class Outbox:
    def __init__(self, path: Optional[Path] = None) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._items: Dict[str, List[dict]] = {k: [] for k in KINDS}
        self._load()

    def add(self, kind: str, item: dict) -> None:
        if kind not in KINDS:
            raise ValueError(kind)
        with self._lock:
            self._items[kind].append(item)
            self._save()

    def has_urgent(self) -> bool:
        """充電イベント（起床）があるときは、60秒を待たずにすぐ送る"""
        with self._lock:
            return bool(self._items["charge_events"])

    def count(self) -> int:
        with self._lock:
            return sum(len(v) for v in self._items.values())

    def take_batch(self, now: float) -> Dict[str, List[dict]]:
        """送る分を取り出す（まだ消さない）。古すぎるものは捨てる"""
        with self._lock:
            self._prune(now)
            return {k: list(v[:MAX_PER_KIND]) for k, v in self._items.items() if v}

    def ack(self, batch: Dict[str, List[dict]]) -> None:
        """送れた（またはサーバーが受け付けなかった）分を消す"""
        with self._lock:
            for kind, sent in batch.items():
                ids = {id(x) for x in sent}
                self._items[kind] = [x for x in self._items[kind] if id(x) not in ids]
            self._save()

    def _prune(self, now: float) -> None:
        dropped = 0
        for kind in KINDS:
            kept = [x for x in self._items[kind] if now - parse_iso(x["timestamp"]) <= MAX_AGE_SEC]
            dropped += len(self._items[kind]) - len(kept)
            self._items[kind] = kept
        if dropped:
            logger.warning("24時間より古い計測データ %d件を捨てました（ずっと送れていません）", dropped)
            self._save()

    def _load(self) -> None:
        if not self._path or not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            for kind in KINDS:
                self._items[kind] = [x for x in data.get(kind, []) if isinstance(x, dict) and "timestamp" in x]
        except (ValueError, OSError):
            logger.exception("送信待ちのデータを読めませんでした。空から始めます")

    def _save(self) -> None:
        if not self._path:
            return
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._items, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self._path)  # 書き込み中に電源が切れても壊れないように、置き換える
        except OSError:
            logger.exception("送信待ちのデータを保存できませんでした")
