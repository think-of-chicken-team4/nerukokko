"""計測データを Outbox からサーバーへ送る（ingest-sensor-data）。docs/api-spec.md §3-1。

- ふだんは60秒ごと。充電イベント（起床）があればすぐ
- 送れたら消す。400（形式の誤り）は送り直しても直らないので消す。413 は半分ずつに分けて送り直す
- 401・404（トークンの設定ミス）は消さずに5分おき、混雑・障害は消さずに次の回で送り直す
"""

from __future__ import annotations

import logging
from typing import Callable, Dict, List, Optional

from api_client import ApiClient, ApiResult, Outcome
from outbox import Outbox, iso

logger = logging.getLogger(__name__)

AUTH_RETRY_SEC = 300.0


class Uplink:
    def __init__(self, outbox: Outbox, api: ApiClient, firmware_version: str, egg_info: Callable[[], Optional[dict]]) -> None:
        self._outbox = outbox
        self._api = api
        self._firmware = firmware_version
        self._egg_info = egg_info
        self._auth_blocked_until = 0.0

    def should_send(self, now: float, last_sent: float, interval_sec: float) -> bool:
        if self._outbox.count() == 0 or now < self._auth_blocked_until:
            return False
        return self._outbox.has_urgent() or now - last_sent >= interval_sec

    def send(self, now: float) -> Outcome:
        batch = self._outbox.take_batch(now)
        if not batch:
            return Outcome.OK
        return self._send_batch(now, batch)

    def _send_batch(self, now: float, batch: Dict[str, List[dict]]) -> Outcome:
        payload: dict = {"sent_at": iso(now), "firmware_version": self._firmware, **batch}
        egg = self._egg_info()
        if egg:
            payload["egg"] = egg
        result: ApiResult = self._api.ingest(payload)

        if result.outcome is Outcome.OK:
            self._outbox.ack(batch)
            skipped = (result.body or {}).get("skipped") if isinstance(result.body, dict) else None
            if skipped:
                reasons = {s.get("reason") for s in skipped}
                logger.info("サーバーが %d件を保存しませんでした（%s）。寝ていない時間のデータなどはこうなります", len(skipped), ", ".join(map(str, reasons)))
        elif result.outcome is Outcome.DROP:
            logger.error("送信データの形式が受け付けられませんでした。捨てます：%s", result.body)
            self._outbox.ack(batch)
        elif result.outcome is Outcome.TOO_LARGE:
            halves = _split(batch)
            if halves is None:
                self._outbox.ack(batch)
                return Outcome.DROP
            for half in halves:
                self._send_batch(now, half)
        elif result.outcome is Outcome.AUTH:
            self._auth_blocked_until = now + AUTH_RETRY_SEC
        return result.outcome


def _split(batch: Dict[str, List[dict]]) -> Optional[List[Dict[str, List[dict]]]]:
    """種類ごとの配列を半分ずつに分ける。1件しかなければ分けられない（None）"""
    if sum(len(v) for v in batch.values()) <= 1:
        return None
    first: Dict[str, List[dict]] = {}
    second: Dict[str, List[dict]] = {}
    for kind, items in batch.items():
        mid = (len(items) + 1) // 2
        if items[:mid]:
            first[kind] = items[:mid]
        if items[mid:]:
            second[kind] = items[mid:]
    return [b for b in (first, second) if b]
