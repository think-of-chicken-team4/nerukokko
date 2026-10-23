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


if __name__ == "__main__":
    unittest.main()
