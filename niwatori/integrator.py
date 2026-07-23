"""鶏本体センサー(A111/SPH0645)とたまごBLE受信データを統合し、一定間隔でSupabaseへ送信する。"""

from __future__ import annotations

import asyncio
import datetime
import logging

import integration_config as config
from egg_state import EggState
from mic_sensor import MicSensor
from radar_sensor import RadarSensor
from supabase_client import SupabaseSender

logger = logging.getLogger(__name__)


class Integrator:
    def __init__(
        self,
        egg_state: EggState,
        radar_sensor: RadarSensor,
        mic_sensor: MicSensor,
        sender: SupabaseSender,
    ) -> None:
        self._egg_state = egg_state
        self._radar_sensor = radar_sensor
        self._mic_sensor = mic_sensor
        self._sender = sender

    async def run_forever(self) -> None:
        while True:
            await asyncio.sleep(config.AGGREGATION_INTERVAL_SEC)
            record = self._build_record()
            try:
                await asyncio.to_thread(self._sender.send, record)
                logger.info("統合レコードを送信しました: %s", record)
            except Exception:
                logger.exception("Supabaseへのレコード送信に失敗しました。")

    def _build_record(self) -> dict:
        timestamp = (
            datetime.datetime.now(datetime.timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z")
        )
        return {
            "timestamp": timestamp,
            "chicken": {
                "breathing_rate": self._radar_sensor.get_latest_breathing_rate(),
                "mic_level": self._mic_sensor.get_latest_level(),
            },
            "egg": self._egg_state.snapshot(),
        }
