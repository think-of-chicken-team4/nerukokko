import unittest
from unittest.mock import Mock

import requests

from api_client import ApiClient, Outcome, classify


class ApiClientTest(unittest.TestCase):
    def test_classify_http_status(self):
        cases = [
            (200, Outcome.OK),
            (400, Outcome.DROP),
            (401, Outcome.AUTH),
            (403, Outcome.AUTH),
            (404, Outcome.AUTH),
            (413, Outcome.TOO_LARGE),
            (429, Outcome.RETRY),
            (500, Outcome.RETRY),
            (None, Outcome.RETRY),
        ]

        for status, expected in cases:
            with self.subTest(status=status):
                self.assertIs(classify(status), expected)

    def test_ingest_uses_expected_url_and_headers(self):
        client = ApiClient(
            base_url="https://example.supabase.co/",
            publishable_key="test-public-key",
            device_token="test-device-token",
        )

        response = Mock()
        response.status_code = 200
        response.json.return_value = {
            "accepted": {},
            "skipped": [],
        }
        client._session.post = Mock(return_value=response)

        payload = {"firmware_version": "test"}
        result = client.ingest(payload)

        self.assertIs(result.outcome, Outcome.OK)

        client._session.post.assert_called_once_with(
            "https://example.supabase.co/functions/v1/ingest-sensor-data",
            json=payload,
            data=None,
            headers={
                "apikey": "test-public-key",
                "x-device-token": "test-device-token",
                "Content-Type": "application/json",
            },
            params=None,
            timeout=15.0,
        )

    def test_connection_error_returns_retry(self):
        client = ApiClient(
            base_url="https://example.supabase.co",
            publishable_key="test-public-key",
            device_token="test-device-token",
        )
        client._session.post = Mock(
            side_effect=requests.ConnectionError("offline")
        )

        result = client.ingest({"firmware_version": "test"})

        self.assertIs(result.outcome, Outcome.RETRY)
        self.assertIsNone(result.status)


if __name__ == "__main__":
    unittest.main()