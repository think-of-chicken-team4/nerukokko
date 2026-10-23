"""温湿度センサー（AHT10・AHT20・DHT20）の読み取りのテスト。I2C はにせものに差し替える。

    cd firmware/chicken && python3 -m unittest tests.test_environment_sensor
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import List
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import environment_sensor as env  # noqa: E402


def aht_frame(temperature_c: float, humidity_pct: float, status: int = 0x1C, crc: bool = True) -> List[int]:
    """センサーが返す7バイト（status・湿度20bit・温度20bit・CRC）を作る"""
    h = round(humidity_pct / 100 * 2**20)
    t = round((temperature_c + 50) / 200 * 2**20)
    data = [status, h >> 12, (h >> 4) & 0xFF, ((h & 0x0F) << 4) | (t >> 16), (t >> 8) & 0xFF, t & 0xFF]
    return data + [env.aht_crc8(data) if crc else 0x00]


class FakeAht:
    """書き込まれたコマンドを記録し、読み出しには用意した応答を順に返す"""

    def __init__(self, responses: List[List[int]]) -> None:
        self.responses = responses
        self.writes: List[List[int]] = []

    def write(self, _bus, _address: int, data: List[int]) -> None:
        self.writes.append(data)

    def read(self, _bus, _address: int, length: int) -> List[int]:
        return self.responses.pop(0)[:length]


class AhtTest(unittest.TestCase):
    def run_with(self, fake: FakeAht, fn, *args):
        with mock.patch.object(env, "_write", fake.write), mock.patch.object(env, "_read", fake.read), \
                mock.patch.object(env.time, "sleep"):
            return fn(None, 0x38, *args)

    def test_crc8_matches_datasheet_example(self):
        # AHT20 のデータシートの CRC8（0x31、初期値 0xFF）。0x00 1バイトなら 0xAC
        self.assertEqual(env.aht_crc8([0x00]), 0xAC)

    def test_reads_temperature_and_humidity(self):
        t, h = self.run_with(FakeAht([aht_frame(25.0, 50.0)]), env.read_aht)
        self.assertAlmostEqual(t, 25.0, places=2)
        self.assertAlmostEqual(h, 50.0, places=2)

    def test_waits_while_busy(self):
        fake = FakeAht([aht_frame(0, 0, status=0x9C), aht_frame(20.0, 40.0)])
        t, _ = self.run_with(fake, env.read_aht)
        self.assertAlmostEqual(t, 20.0, places=2)
        self.assertEqual(fake.writes, [[0xAC, 0x33, 0x00]])

    def test_gives_up_when_always_busy(self):
        with self.assertRaises(OSError):
            self.run_with(FakeAht([aht_frame(0, 0, status=0x9C)] * 5), env.read_aht)

    def test_rejects_bad_crc(self):
        with self.assertRaises(OSError):
            self.run_with(FakeAht([aht_frame(25.0, 50.0, crc=False)]), env.read_aht)

    def test_accepts_aht10_without_crc(self):
        frame = aht_frame(25.0, 50.0)
        frame[6] = 0xFF
        t, _ = self.run_with(FakeAht([frame]), env.read_aht)
        self.assertAlmostEqual(t, 25.0, places=2)

    def test_initializes_only_when_not_calibrated(self):
        fake = FakeAht([[0x18]])
        self.run_with(fake, env.aht_initialize)
        self.assertEqual(fake.writes, [[0x71]])
        fake = FakeAht([[0x10]])
        self.run_with(fake, env.aht_initialize)
        self.assertEqual(fake.writes, [[0x71], [0xBE, 0x08, 0x00]])


if __name__ == "__main__":
    unittest.main()
