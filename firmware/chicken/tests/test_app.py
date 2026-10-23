import time
import unittest
from unittest.mock import Mock

from app import ChickenApp
from api_client import ApiClient, Outcome
from outbox import Outbox
from uplink import Uplink


class ChickenAppIntegrationTest(unittest.TestCase):
    def test_charge_event_flows_from_app_to_api(self):
        # 実際のハードウェアを起動せずにアプリの一部を用意
        app = ChickenApp.__new__(ChickenApp)
        app.outbox = Outbox()
        app.alarm = Mock()
        app.alarm.dock.return_value = True
        app._stop_ringing = Mock()

        # たまごが巣に戻ったイベントを発生させる
        app._on_dock(True)

        app._stop_ringing.assert_called_once()
        self.assertEqual(app.outbox.count(), 1)

        # 実際のHTTP通信は模擬し、送信処理を検証
        api = ApiClient(
            base_url="https://example.supabase.co",
            publishable_key="test-public-key",
            device_token="test-device-token",
        )

        response = Mock()
        response.status_code = 200
        response.json.return_value = {
            "accepted": {"charge_events": 1},
            "skipped": [],
        }
        api._session.post = Mock(return_value=response)

        uplink = Uplink(
            app.outbox,
            api,
            "test-version",
            lambda: None,
        )

        now = time.time() + 1

        # 起床イベントなら通常の送信間隔を待たない
        self.assertTrue(uplink.should_send(now, now, 60))

        # API送信が成功したことを確認
        result = uplink.send(now)
        self.assertIs(result, Outcome.OK)

        api._session.post.assert_called_once()
        request = api._session.post.call_args.kwargs

        self.assertEqual(
            request["json"]["charge_events"][0]["type"],
            "charge_start",
        )
        self.assertEqual(
            request["json"]["firmware_version"],
            "test-version",
        )
        self.assertEqual(
            request["headers"]["x-device-token"],
            "test-device-token",
        )

        # 送信成功後、送信待ちデータが消えることを確認
        self.assertEqual(app.outbox.count(), 0)


if __name__ == "__main__":
    unittest.main()