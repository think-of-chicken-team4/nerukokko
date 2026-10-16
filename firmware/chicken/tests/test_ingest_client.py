from unittest.mock import Mock, patch

import ingest_client
from ingest_client import IngestClient


def test_send_skips_request_when_config_is_missing():
    # 接続設定がない場合はHTTP通信を行わない
    with (
        patch.object(ingest_client.config, "SUPABASE_URL", ""),
        patch.object(ingest_client.config, "SUPABASE_KEY", ""),
        patch("ingest_client.requests.post") as post,
    ):
        client = IngestClient()
        client.send({"test": "data"})

        post.assert_not_called()


def test_send_posts_record_to_supabase():
    # 接続設定がある場合、正しいURLとデータでPOSTする
    record = {"timestamp": "2026-10-16T00:00:00Z"}
    response = Mock()

    with (
        patch.object(
            ingest_client.config,
            "SUPABASE_URL",
            "https://example.supabase.co/",
        ),
        patch.object(ingest_client.config, "SUPABASE_KEY", "test-key"),
        patch.object(
            ingest_client.config,
            "INGEST_FUNCTION_NAME",
            "ingest-sensor-data",
        ),
        patch("ingest_client.requests.post", return_value=response) as post,
    ):
        client = IngestClient()
        client.send(record)

        post.assert_called_once_with(
            "https://example.supabase.co/functions/v1/ingest-sensor-data",
            json=record,
            headers={
                "apikey": "test-key",
                "Authorization": "Bearer test-key",
                "Content-Type": "application/json",
            },
            timeout=10,
        )
        response.raise_for_status.assert_called_once()


def test_send_raises_when_http_request_fails():
    # HTTP通信が失敗したらエラーを呼び出し元に伝える
    with (
        patch.object(
            ingest_client.config,
            "SUPABASE_URL",
            "https://example.supabase.co",
        ),
        patch.object(ingest_client.config, "SUPABASE_KEY", "test-key"),
        patch("ingest_client.requests.post") as post,
    ):
        response = Mock()
        response.raise_for_status.side_effect = RuntimeError("HTTP error")
        post.return_value = response

        client = IngestClient()

        try:
            client.send({"test": "data"})
        except RuntimeError as error:
            assert str(error) == "HTTP error"
        else:
            raise AssertionError("HTTPエラーが呼び出し元に伝わっていません")