"""鶏本体の温湿度・照度センサー（F-05、Issue #4。環境センサーは鶏に搭載と決定）。

I2C バスを調べて、つながっているチップに合わせて読む（hwtest/env_sensor_test.py と同じ読み方）。
  照度：BH1750（0x23 / 0x5C。SEN0097）
  温湿度：SHT3x（0x44 / 0x45）、AHT10・AHT20・DHT20（0x38）、SHT20・HTU21D・Si7021（0x40）
ラズパイ自体の熱で温度が高めに出るので、市販の温湿度計と比べた差を ENV_TEMP_OFFSET_C で直す（実機で調整：C3）。
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple

import integration_config as config

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EnvironmentReading:
    temperature_c: Optional[float]
    humidity_pct: Optional[float]
    illuminance_lux: Optional[float]

    def is_empty(self) -> bool:
        return self.temperature_c is None and self.humidity_pct is None and self.illuminance_lux is None


def _write(bus, address: int, data: List[int]) -> None:
    from smbus2 import i2c_msg

    bus.i2c_rdwr(i2c_msg.write(address, data))


def _read(bus, address: int, length: int) -> List[int]:
    from smbus2 import i2c_msg

    message = i2c_msg.read(address, length)
    bus.i2c_rdwr(message)
    return list(message)


def read_bh1750(bus, address: int) -> float:
    _write(bus, address, [0x01])  # 電源オン
    _write(bus, address, [0x20])  # 1回だけ高分解能で測る
    time.sleep(0.18)
    high, low = _read(bus, address, 2)
    return ((high << 8) | low) / 1.2


def read_sht3x(bus, address: int) -> Tuple[float, float]:
    _write(bus, address, [0x24, 0x00])
    time.sleep(0.02)
    d = _read(bus, address, 6)
    return -45 + 175 * ((d[0] << 8) | d[1]) / 65535, 100 * ((d[3] << 8) | d[4]) / 65535


AHT_STATUS_BUSY = 0x80
AHT_STATUS_CALIBRATED = 0x08


def aht_crc8(data: List[int]) -> int:
    """AHT20・DHT20 の CRC（多項式 0x31、初期値 0xFF）"""
    crc = 0xFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = ((crc << 1) ^ 0x31) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


def aht_initialize(bus, address: int) -> None:
    """電源を入れたあと、校正済み（status の bit3）でなければ初期化する（AHT20・DHT20 のデータシートの手順）"""
    _write(bus, address, [0x71])
    status = _read(bus, address, 1)[0]
    if not status & AHT_STATUS_CALIBRATED:
        _write(bus, address, [0xBE, 0x08, 0x00])
        time.sleep(0.01)


def read_aht(bus, address: int) -> Tuple[float, float]:
    """AHT10・AHT20・DHT20（Grove Temperature & Humidity Sensor V2.0。Issue #17）。
    測定開始 → 80ms 待つ → 測定中（busy）なら少し待って読み直す → CRC を確かめる"""
    _write(bus, address, [0xAC, 0x33, 0x00])
    time.sleep(0.08)
    for _ in range(5):
        d = _read(bus, address, 7)
        if not d[0] & AHT_STATUS_BUSY:
            break
        time.sleep(0.02)
    else:
        raise OSError("AHT: 測定が終わりません")
    # AHT10 は CRC を返さない（7バイト目が 0xFF のまま）ので、CRC が合わなくても 0xFF なら受け入れる
    if d[6] != 0xFF and aht_crc8(d[:6]) != d[6]:
        raise OSError("AHT: CRC が合いません")
    humidity_raw = (d[1] << 12) | (d[2] << 4) | (d[3] >> 4)
    temperature_raw = ((d[3] & 0x0F) << 16) | (d[4] << 8) | d[5]
    return temperature_raw / 2**20 * 200 - 50, humidity_raw / 2**20 * 100


def read_sht2x(bus, address: int) -> Tuple[float, float]:
    def measure(command: int) -> int:
        _write(bus, address, [command])
        time.sleep(0.085)
        d = _read(bus, address, 3)
        return ((d[0] << 8) | d[1]) & 0xFFFC

    return -46.85 + 175.72 * measure(0xF3) / 65536, -6 + 125 * measure(0xF5) / 65536


TEMP_SENSORS: List[Tuple[int, str, Callable]] = [
    (0x44, "SHT3x", read_sht3x),
    (0x45, "SHT3x", read_sht3x),
    (0x38, "AHT10/AHT20/DHT20", read_aht),
    (0x40, "SHT20/HTU21D/Si7021", read_sht2x),
]
LIGHT_ADDRESSES = [0x23, 0x5C]


class EnvironmentSensor:
    def __init__(self) -> None:
        self._bus = None
        self._temp: Optional[Tuple[int, str, Callable]] = None
        self._light: Optional[int] = None
        try:
            from smbus2 import SMBus

            self._bus = SMBus(config.I2C_BUS_NUMBER)
        except Exception as error:
            logger.warning("I2C を使えません（%s）。温湿度・照度なしで続けます", type(error).__name__)
            return

        found = [a for a in range(0x03, 0x78) if self._present(a)]
        if not found:
            # Issue #17：センサーが SDA を lo に保持すると、バスのすべての機器が見えなくなる
            logger.warning("I2C に何も見つかりません。配線と、SDA が lo に固定されていないか（pinctrl get 2,3）を確かめてください")
        self._temp = next((t for t in TEMP_SENSORS if t[0] in found), None)
        if self._temp is not None and self._temp[2] is read_aht:
            try:
                aht_initialize(self._bus, self._temp[0])
            except OSError:
                logger.warning("温湿度センサー（AHT）を初期化できませんでした")
        self._light = next((a for a in LIGHT_ADDRESSES if a in found), None)
        logger.info(
            "環境センサー：温湿度 %s／照度 %s",
            f"{self._temp[1]}（0x{self._temp[0]:02X}）" if self._temp else "なし",
            f"BH1750（0x{self._light:02X}）" if self._light is not None else "なし",
        )

    def _present(self, address: int) -> bool:
        try:
            self._bus.read_byte(address)
            return True
        except OSError:
            return False

    def read(self) -> EnvironmentReading:
        """いまの値。読めなかった値は None（ふつうは60秒ごとに呼ぶ）"""
        temperature = humidity = lux = None
        if self._bus is None:
            return EnvironmentReading(None, None, None)
        if self._temp is not None:
            try:
                t, h = self._temp[2](self._bus, self._temp[0])
                temperature = round(t + config.ENV_TEMP_OFFSET_C, 1)
                humidity = round(max(0.0, min(100.0, h + config.ENV_HUMIDITY_OFFSET_PCT)), 1)
            except OSError:
                logger.warning("温湿度センサーを読めませんでした")
        if self._light is not None:
            try:
                lux = round(read_bh1750(self._bus, self._light), 1)
            except OSError:
                logger.warning("照度センサーを読めませんでした")
        return EnvironmentReading(temperature, humidity, lux)
