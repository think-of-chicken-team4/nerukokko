"""Supabaseへの統合レコード送信。"""

from __future__ import annotations

import logging

from supabase import create_client

import integration_config as config

logger = logging.getLogger(__name__)


class SupabaseSender:
    def __init__(self) -> None:
        if not config.SUPABASE_URL or not config.SUPABASE_KEY:
            logger.warning("SUPABASE_URL/SUPABASE_KEYが未設定のため、Supabase送信は無効です。")
            self._client = None
        else:
            self._client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)

    def send(self, record: dict) -> None:
        if self._client is None:
            logger.info("Supabase未接続のためレコードを送信せずログのみ出力します: %s", record)
            return

        self._client.table(config.SUPABASE_TABLE).insert(record).execute()
