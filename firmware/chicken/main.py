"""鶏ユニット: たまごユニットからのBLE Notify受信、鶏本体センサー(A111/SPH0645)処理、
統合レコードのSupabase送信をまとめて起動するエントリポイント。
"""

from __future__ import annotations

import asyncio
import logging

from ble_client import TamagoClient
from egg_state import EggState
from environment_sensor import EnvironmentSensor
from integrator import Integrator
from mic_sensor import MicSensor
from radar_sensor import RadarSensor
from sensor_data import AudioLevel, DockEvent, Environment, MotionEvent
from ingest_client import IngestClient

egg_state = EggState()


def on_audio(data: AudioLevel) -> None:
    egg_state.update_audio(data)


def on_motion(data: MotionEvent) -> None:
    egg_state.update_motion(data)


def on_environment(data: Environment) -> None:
    egg_state.update_environment(data)


def on_dock(data: DockEvent) -> None:
    egg_state.update_dock(data)
    if data.docked:
        logging.info("Dock event: docked(起床)")
        # ここで睡眠スコア計算処理(B担当)をトリガーする想定
    else:
        logging.info("Dock event: undocked(就寝開始)")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    radar_sensor = RadarSensor()
    mic_sensor = MicSensor()
    environment_sensor = EnvironmentSensor()
    sender = IngestClient()
    integrator = Integrator(egg_state, radar_sensor, mic_sensor, environment_sensor, sender)

    radar_sensor.start()
    mic_sensor.start()
    environment_sensor.start()

    ble_client = TamagoClient(
        on_audio=on_audio,
        on_motion=on_motion,
        on_environment=on_environment,
        on_dock=on_dock,
    )

    await asyncio.gather(
        ble_client.run_forever(),
        integrator.run_forever(),
    )


if __name__ == "__main__":
    asyncio.run(main())
