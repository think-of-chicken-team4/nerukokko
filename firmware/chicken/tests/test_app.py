import asyncio
import time
import unittest
from unittest.mock import AsyncMock, Mock, patch

from hardware import OFF
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app import ChickenApp
from api_client import ApiClient, Outcome
from environment_sensor import EnvironmentReading
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

    def test_audio_event_is_saved_to_outbox(self):
        app = ChickenApp.__new__(ChickenApp)
        app.outbox = Outbox()

        timestamp = time.time()
        app.sounds = Mock()
        app.sounds.add.return_value = [
            SimpleNamespace(
                timestamp=timestamp,
                type="snore",
                duration_ms=850,
                confidence=0.92,
            )
        ]

        app._on_audio(123)

        batch = app.outbox.take_batch(time.time())
        self.assertEqual(len(batch["audio_events"]), 1)

        event = batch["audio_events"][0]
        self.assertEqual(event["type"], "snore")
        self.assertEqual(event["duration_ms"], 850)
        self.assertEqual(event["confidence"], 0.92)
        self.assertEqual(event["device"], "egg")
        self.assertIn("timestamp", event)

    def test_motion_event_is_saved_to_outbox(self):
        app = ChickenApp.__new__(ChickenApp)
        app.outbox = Outbox()

        timestamp = time.time()
        app.turns = Mock()
        app.turns.add.return_value = [
            SimpleNamespace(
                timestamp=timestamp,
                intensity=1.4,
            )
        ]

        app._on_motion(120, -40, 990)

        batch = app.outbox.take_batch(time.time())
        self.assertEqual(len(batch["motion_events"]), 1)

        event = batch["motion_events"][0]
        self.assertEqual(event["intensity"], 1.4)
        self.assertEqual(event["source"], "accelerometer")
        self.assertIn("timestamp", event)

    def test_tick_loop_records_breathing_and_presence(self):
        app = ChickenApp.__new__(ChickenApp)
        app.outbox = Mock()
        app.alarm = Mock()
        app.alarm.tick.return_value = None
        app.turns = Mock()
        app.turns.flush.return_value = []
        app.sounds = Mock()
        app.sounds.flush.return_value = []
        app.breathing = Mock()

        event_time = 1_800_000_000.0
        app.breathing.add.return_value = [(event_time, 14.0)]

        app.radar = Mock()
        app.radar.get_latest_breathing_rate.return_value = 14.0
        app.radar.pop_presence_changes.return_value = [
            (event_time, "in_bed")
        ]

        app.api = Mock()
        app.api.configured = False

        async def stop_after_one_cycle(_seconds):
            raise asyncio.CancelledError

        with patch("app.asyncio.sleep", new=stop_after_one_cycle):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(app._tick_loop())

        records = {
            call.args[0]: call.args[1]
            for call in app.outbox.add.call_args_list
        }

        self.assertIn("breathing", records)
        self.assertEqual(
            records["breathing"]["breaths_per_min"], 14.0
        )
        self.assertEqual(records["breathing"]["source"], "mmwave")

        self.assertIn("presence_events", records)
        self.assertEqual(
            records["presence_events"]["state"], "in_bed"
        )

    def test_environment_loop_records_reading(self):
        app = ChickenApp.__new__(ChickenApp)
        app.outbox = Mock()
        app.environment = Mock()

        reading = EnvironmentReading(24.5, 55.0, 120.0)
        app.environment.read.return_value = reading
        app.latest_env = EnvironmentReading(None, None, None)

        async def fake_to_thread(func, *args, **kwargs):
            return func(*args, **kwargs)

        async def stop_after_one_cycle(_seconds):
            raise asyncio.CancelledError

        with (
            patch("app.asyncio.to_thread", new=fake_to_thread),
            patch("app.asyncio.sleep", new=stop_after_one_cycle),
        ):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(app._environment_loop())

        app.environment.read.assert_called_once()
        self.assertEqual(app.latest_env, reading)
        app.outbox.add.assert_called_once()

        kind, item = app.outbox.add.call_args.args
        self.assertEqual(kind, "environment")
        self.assertIn("timestamp", item)
        self.assertEqual(item["temperature_c"], 24.5)
        self.assertEqual(item["humidity_pct"], 55.0)
        self.assertEqual(item["illuminance_lux"], 120.0)

    def test_audio_event_is_kept_after_failure_and_removed_after_retry(self):
        app = ChickenApp.__new__(ChickenApp)
        app.outbox = Outbox()
        app.sounds = Mock()

        timestamp = time.time()
        app.sounds.add.return_value = [
            SimpleNamespace(
                timestamp=timestamp,
                type="snore",
                duration_ms=850,
                confidence=0.92,
            )
        ]

        # いびきイベントを送信待ちに登録
        app._on_audio(123)
        self.assertEqual(app.outbox.count(), 1)

        # 1回目はサーバーエラー、2回目は成功を返す
        api = Mock()
        api.ingest.side_effect = [
            SimpleNamespace(
                outcome=Outcome.RETRY,
                status=503,
                body={},
            ),
            SimpleNamespace(
                outcome=Outcome.OK,
                status=200,
                body={"accepted": {}, "skipped": []},
            ),
        ]

        uplink = Uplink(app.outbox, api, "test-version", lambda: None)
        now = time.time()

        # 送信失敗：データは残る
        self.assertIs(uplink.send(now), Outcome.RETRY)
        self.assertEqual(app.outbox.count(), 1)

        first_payload = api.ingest.call_args_list[0].args[0]

        # 再送成功：データが削除される
        self.assertIs(uplink.send(now + 60), Outcome.OK)
        self.assertEqual(app.outbox.count(), 0)

        second_payload = api.ingest.call_args_list[1].args[0]

        # 再送前後で、計測時刻とイベント内容が変わらない
        self.assertEqual(
            first_payload["audio_events"],
            second_payload["audio_events"],
        )
        self.assertEqual(
            second_payload["audio_events"][0]["type"],
            "snore",
        )

    def test_radar_disabled_returns_none(self):
        app = ChickenApp.__new__(ChickenApp)

        with patch("app.config.RADAR_ENABLED", False):
            self.assertIsNone(app._start_radar())

    def test_radar_start_failure_is_nonfatal(self):
        app = ChickenApp.__new__(ChickenApp)
        fake_module = Mock()
        fake_module.RadarSensor.side_effect = RuntimeError(
            "radar startup failed"
        )

        with (
            patch("app.config.RADAR_ENABLED", True),
            patch.dict("sys.modules", {"radar_sensor": fake_module}),
        ):
            self.assertIsNone(app._start_radar())

    def test_radar_starts_when_available(self):
        app = ChickenApp.__new__(ChickenApp)
        fake_radar = Mock()
        fake_module = Mock()
        fake_module.RadarSensor.return_value = fake_radar

        with (
            patch("app.config.RADAR_ENABLED", True),
            patch.dict("sys.modules", {"radar_sensor": fake_module}),
        ):
            result = app._start_radar()

        self.assertIs(result, fake_radar)
        fake_radar.start.assert_called_once()

    def test_run_cleans_up_resources_after_task_failure(self):
        app = ChickenApp.__new__(ChickenApp)
        app._loop = None
        app.egg = Mock()
        app.egg.run_forever = AsyncMock(
            side_effect=RuntimeError("test error")
        )

        async def wait_forever():
            await asyncio.Event().wait()

        app._sync_loop = AsyncMock(side_effect=wait_forever)
        app._tick_loop = AsyncMock(side_effect=wait_forever)
        app._environment_loop = AsyncMock(side_effect=wait_forever)

        app.environment = Mock()
        app.radar = Mock()
        app.led = Mock()
        app._stop_ringing = Mock()

        with patch("app.config.BUTTON_ENABLED", False):
            with self.assertRaisesRegex(RuntimeError, "test error"):
                asyncio.run(app.run())

        app.environment.close.assert_called_once_with()
        app.radar.stop.assert_called_once_with()
        app._stop_ringing.assert_called_once_with()
        app.led.set.assert_called_with(OFF)

if __name__ == "__main__":
    unittest.main()