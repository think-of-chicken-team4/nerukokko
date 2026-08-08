"""Supabase Edge Function（ingest-sensor-data）への統合レコード送信。

鶏→サーバーはHTTP REST（docs/software-spec.md 3-1参照）。Supabase Clientでの
テーブル直接insertではなく、Edge Functionへの素朴なHTTP POSTとする。
"""

from __future__ import annotations

import logging

import requests

import integration_config as config

logger = logging.getLogger(__name__)


class IngestClient:
    def __init__(self) -> None:
        if not config.SUPABASE_URL or not config.SUPABASE_KEY:
            logger.warning("SUPABASE_URL/SUPABASE_KEYが未設定のため、送信は無効です。")
            self._endpoint = None
        else:
            self._endpoint = (
                f"{config.SUPABASE_URL.rstrip('/')}/functions/v1/{config.INGEST_FUNCTION_NAME}"
            )

    def send(self, record: dict) -> None:
        if self._endpoint is None:
            logger.info("送信先未設定のためレコードを送信せずログのみ出力します: %s", record)
            return

        headers = {
            "apikey": config.SUPABASE_KEY,
            "Authorization": f"Bearer {config.SUPABASE_KEY}",
            "Content-Type": "application/json",
        }
        response = requests.post(self._endpoint, json=record, headers=headers, timeout=10)
        response.raise_for_status()
