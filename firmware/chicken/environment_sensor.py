"""鶏本体の環境センサー(温湿度 M0235-1747, 照度 SEN0097)読み取り。

たまご側から受信するEnvironment(BLE)とは別に、鶏本体にも同種のセンサーが
搭載されている(docs/full-spec.md 2-1)。device_idで区別してenvironment_readings
に記録する想定(docs/software-spec.md)。

SEN0097はBH1750チップのI2C照度センサーで、Luxを直接デジタル出力する。
M0235-1747は現物/データシート未確認のため、チップ型番が判明するまでは
温湿度読み取りはプレースホルダ(None)とする。
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Optional

import integration_config as config

logger = logging.getLogger(__name__)

_BH1750_ADDR = 0x23
_BH1750_CONT_HIRES_MODE = 0x10


class EnvironmentSensor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest_temperature: Optional[float] = None
        self._latest_humidity: Optional[float] = None
        self._latest_lux: Optional[float] = None
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._bus = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="EnvironmentSensor", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def get_latest(self) -> dict:
        with self._lock:
            return {
                "temperature": self._latest_temperature,
                "humidity": self._latest_humidity,
                "lux": self._latest_lux,
            }

    def _run(self) -> None:
        try:
            import smbus2

            self._bus = smbus2.SMBus(config.I2C_BUS_NUMBER)
        except Exception:
            logger.exception("I2Cバスのオープンに失敗しました。環境センサーを無効化します。")
            return

        while not self._stop_event.is_set():
            lux = self._read_lux()
            if lux is not None:
                with self._lock:
                    self._latest_lux = lux

            # TODO(M0235-1747のチップ型番確定後): 温湿度の読み取りを実装する。
            # 現状は _latest_temperature / _latest_humidity は None のまま。

            time.sleep(config.ENVIRONMENT_POLL_INTERVAL_SEC)

    def _read_lux(self) -> Optional[float]:
        if self._bus is None:
            return None
        try:
            data = self._bus.read_i2c_block_data(_BH1750_ADDR, _BH1750_CONT_HIRES_MODE, 2)
            raw = (data[0] << 8) | data[1]
            return raw / 1.2
        except Exception:
            logger.exception("照度センサーの読み取りに失敗しました。")
            return None
