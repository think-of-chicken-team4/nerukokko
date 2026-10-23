"""outbox.py・uplink.py・api_client.classify のテスト（サーバーは偽物）。実行：cd firmware/chicken && python3 -m unittest discover -s tests"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from api_client import ApiResult, Outcome, classify
from outbox import Outbox, iso
from uplink import Uplink

NOW = 1_800_000_000.0


class FakeApi:
    def __init__(self, statuses):
        self.statuses = list(statuses)
        self.payloads = []

    def ingest(self, payload):
        self.payloads.append(payload)
        status = self.statuses.pop(0)
        return ApiResult(classify(status), status, {"accepted": {}, "skipped": []})


def item(t: float, **extra) -> dict:
    return {"timestamp": iso(t), **extra}


class ClassifyTest(unittest.TestCase):
    def test_api_spec_rules(self) -> None:
        self.assertEqual(classify(200), Outcome.OK)
        self.assertEqual(classify(400), Outcome.DROP)
        self.assertEqual(classify(401), Outcome.AUTH)
        self.assertEqual(classify(404), Outcome.AUTH)
        self.assertEqual(classify(413), Outcome.TOO_LARGE)
        self.assertEqual(classify(429), Outcome.RETRY)
        self.assertEqual(classify(503), Outcome.RETRY)
        self.assertEqual(classify(None), Outcome.RETRY)


class OutboxTest(unittest.TestCase):
    def test_survives_restart(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "outbox.json"
            Outbox(path).add("motion_events", item(NOW, source="accelerometer"))
            self.assertEqual(Outbox(path).count(), 1)

    def test_drops_data_older_than_24h(self) -> None:
        box = Outbox()
        box.add("breathing", item(NOW - 25 * 3600, breaths_per_min=14, source="mmwave"))
        box.add("breathing", item(NOW - 60, breaths_per_min=14, source="mmwave"))
        batch = box.take_batch(NOW)
        self.assertEqual(len(batch["breathing"]), 1)


class UplinkTest(unittest.TestCase):
    def make(self, statuses):
        box = Outbox()
        api = FakeApi(statuses)
        return box, api, Uplink(box, api, "chicken-test", lambda: {"mac_address": "AA:BB:CC:DD:EE:FF"})

    def test_sent_items_are_removed_and_timestamps_kept(self) -> None:
        box, api, up = self.make([200])
        box.add("motion_events", item(NOW - 30, source="accelerometer"))
        self.assertEqual(up.send(NOW), Outcome.OK)
        self.assertEqual(box.count(), 0)
        payload = api.payloads[0]
        self.assertEqual(payload["motion_events"][0]["timestamp"], iso(NOW - 30))
        self.assertEqual(payload["egg"]["mac_address"], "AA:BB:CC:DD:EE:FF")
        self.assertEqual(payload["firmware_version"], "chicken-test")

    def test_server_error_keeps_items_for_retry(self) -> None:
        box, api, up = self.make([503, 200])
        box.add("environment", item(NOW, temperature_c=24.0))
        self.assertEqual(up.send(NOW), Outcome.RETRY)
        self.assertEqual(box.count(), 1)
        self.assertEqual(up.send(NOW + 60), Outcome.OK)
        self.assertEqual(box.count(), 0)
        self.assertEqual(api.payloads[0]["environment"], api.payloads[1]["environment"])  # 同じ時刻で送り直す

    def test_bad_request_is_dropped(self) -> None:
        box, _, up = self.make([400])
        box.add("environment", item(NOW, temperature_c=24.0))
        self.assertEqual(up.send(NOW), Outcome.DROP)
        self.assertEqual(box.count(), 0)

    def test_auth_error_waits_5_minutes(self) -> None:
        box, _, up = self.make([401])
        box.add("environment", item(NOW, temperature_c=24.0))
        up.send(NOW)
        self.assertEqual(box.count(), 1)
        self.assertFalse(up.should_send(NOW + 60, NOW, 60))
        self.assertTrue(up.should_send(NOW + 301, NOW, 60))

    def test_too_large_is_split(self) -> None:
        box, api, up = self.make([413, 200, 200])
        for i in range(4):
            box.add("audio_events", item(NOW - i, type="snore", duration_ms=1000))
        up.send(NOW)
        self.assertEqual(box.count(), 0)
        self.assertEqual([len(p["audio_events"]) for p in api.payloads], [4, 2, 2])

    def test_charge_event_is_sent_right_away(self) -> None:
        box, _, up = self.make([])
        box.add("environment", item(NOW, temperature_c=24.0))
        self.assertFalse(up.should_send(NOW + 10, NOW, 60))
        box.add("charge_events", item(NOW + 10, type="charge_start"))
        self.assertTrue(up.should_send(NOW + 10, NOW, 60))

    def test_payload_matches_api_spec(self) -> None:
        box, api, up = self.make([200])

        # API仕様に合わせた各種データを送信待ちに登録
        box.add(
            "environment",
            item(
                NOW - 1,
                temperature_c=24.5,
                humidity_pct=52.0,
                illuminance_lux=3.2,
            ),
        )
        box.add(
            "breathing",
            item(NOW - 2, breaths_per_min=14.2, source="mmwave"),
        )
        box.add(
            "motion_events",
            item(NOW - 3, intensity=0.82, source="accelerometer"),
        )
        box.add(
            "audio_events",
            item(
                NOW - 4,
                type="snore",
                duration_ms=1200,
                confidence=0.70,
                device="egg",
            ),
        )
        box.add(
            "presence_events",
            item(NOW - 5, state="in_bed"),
        )
        box.add(
            "charge_events",
            item(NOW - 6, type="charge_start"),
        )

        # 送信を実行
        self.assertEqual(up.send(NOW), Outcome.OK)

        payload = api.payloads[0]

        # 必須項目とトップレベルの構造を確認
        self.assertEqual(
            set(payload.keys()),
            {
                "sent_at",
                "firmware_version",
                "egg",
                "environment",
                "breathing",
                "motion_events",
                "audio_events",
                "presence_events",
                "charge_events",
            },
        )
        self.assertEqual(payload["sent_at"], iso(NOW))
        self.assertTrue(payload["sent_at"].endswith("Z"))
        self.assertEqual(payload["firmware_version"], "chicken-test")
        self.assertEqual(
            payload["egg"]["mac_address"],
            "AA:BB:CC:DD:EE:FF",
        )

        # 各イベントのフィールド名・値・計測時刻を確認
        self.assertEqual(
            payload["environment"][0],
            item(
                NOW - 1,
                temperature_c=24.5,
                humidity_pct=52.0,
                illuminance_lux=3.2,
            ),
        )
        self.assertEqual(
            payload["breathing"][0],
            item(NOW - 2, breaths_per_min=14.2, source="mmwave"),
        )
        self.assertEqual(
            payload["motion_events"][0],
            item(NOW - 3, intensity=0.82, source="accelerometer"),
        )
        self.assertEqual(
            payload["audio_events"][0],
            item(
                NOW - 4,
                type="snore",
                duration_ms=1200,
                confidence=0.70,
                device="egg",
            ),
        )
        self.assertEqual(
            payload["presence_events"][0],
            item(NOW - 5, state="in_bed"),
        )
        self.assertEqual(
            payload["charge_events"][0],
            item(NOW - 6, type="charge_start"),
        )

if __name__ == "__main__":
    unittest.main()
