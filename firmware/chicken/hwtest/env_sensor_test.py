"""C3：温湿度センサー・照度センサーの読み取りを確かめる（docs/hw-verification.md）。

    python3 hwtest/env_sensor_test.py              # 5秒ごとに表示（Ctrl+C で終了）
    python3 hwtest/env_sensor_test.py --count 12   # 12回測って終了

I2C バス1 を調べ、見つかったセンサーの種類に合わせて読む。対応している種類：
  照度：BH1750（0x23 / 0x5C）
  温湿度：SHT3x（0x44 / 0x45）、AHT10・AHT20（0x38）、SHT20・HTU21D・Si7021（0x40）
温湿度センサーが見つからないときは、I2C ではない種類（DHT22 など1線式）の可能性がある。
型番を Issue #4 に書けば、AI が読み取りのコードを書く。
"""

from __future__ import annotations

import argparse
import csv
import datetime
import time
from pathlib import Path

from smbus2 import SMBus, i2c_msg

I2C_BUS = 1


def read_raw(bus: SMBus, address: int, length: int) -> list[int]:
    """レジスタを指定せずに length バイト読む。"""
    message = i2c_msg.read(address, length)
    bus.i2c_rdwr(message)
    return list(message)


def write_raw(bus: SMBus, address: int, data: list[int]) -> None:
    bus.i2c_rdwr(i2c_msg.write(address, data))


def is_present(bus: SMBus, address: int) -> bool:
    try:
        bus.read_byte(address)
        return True
    except OSError:
        return False


def read_bh1750(bus: SMBus, address: int) -> float:
    # 電源オン → 1回だけ高分解能で測定 → 測定時間（最大180ms）を待ってから読む
    write_raw(bus, address, [0x01])
    write_raw(bus, address, [0x20])
    time.sleep(0.18)
    high, low = read_raw(bus, address, 2)
    return ((high << 8) | low) / 1.2


def read_sht3x(bus: SMBus, address: int) -> tuple[float, float]:
    write_raw(bus, address, [0x24, 0x00])  # 1回測定・高精度・クロックストレッチなし
    time.sleep(0.02)
    data = read_raw(bus, address, 6)
    temperature = -45 + 175 * ((data[0] << 8) | data[1]) / 65535
    humidity = 100 * ((data[3] << 8) | data[4]) / 65535
    return temperature, humidity


def read_aht(bus: SMBus, address: int) -> tuple[float, float]:
    write_raw(bus, address, [0xAC, 0x33, 0x00])  # 測定開始
    time.sleep(0.08)
    data = read_raw(bus, address, 6)
    humidity_raw = (data[1] << 12) | (data[2] << 4) | (data[3] >> 4)
    temperature_raw = ((data[3] & 0x0F) << 16) | (data[4] << 8) | data[5]
    return temperature_raw / 2**20 * 200 - 50, humidity_raw / 2**20 * 100


def read_sht2x(bus: SMBus, address: int) -> tuple[float, float]:
    def measure(command: int) -> int:
        write_raw(bus, address, [command])
        time.sleep(0.085)
        data = read_raw(bus, address, 3)
        return ((data[0] << 8) | data[1]) & 0xFFFC

    temperature = -46.85 + 175.72 * measure(0xF3) / 65536
    humidity = -6 + 125 * measure(0xF5) / 65536
    return temperature, humidity


TEMP_HUMIDITY_SENSORS = [
    (0x44, "SHT3x", read_sht3x),
    (0x45, "SHT3x", read_sht3x),
    (0x38, "AHT10/AHT20", read_aht),
    (0x40, "SHT20/HTU21D/Si7021", read_sht2x),
]
LIGHT_SENSORS = [(0x23, "BH1750"), (0x5C, "BH1750")]


def main() -> None:
    parser = argparse.ArgumentParser(description="温湿度・照度センサーの読み取りを確かめる（C3）")
    parser.add_argument("--interval", type=float, default=5, help="測る間隔（秒）")
    parser.add_argument("--count", type=int, default=0, help="測る回数。0 は Ctrl+C まで")
    parser.add_argument("--csv", help="記録する CSV ファイル名（既定：env_日時.csv）")
    args = parser.parse_args()

    with SMBus(I2C_BUS) as bus:
        found = [address for address in range(0x03, 0x78) if is_present(bus, address)]
        print("I2C バス1 で見つかったアドレス：" + (", ".join(f"0x{a:02X}" for a in found) or "なし"))

        light = next(((a, name) for a, name in LIGHT_SENSORS if a in found), None)
        temp = next(((a, name, fn) for a, name, fn in TEMP_HUMIDITY_SENSORS if a in found), None)
        print(f"照度センサー　：{f'{light[1]}（0x{light[0]:02X}）' if light else '見つかりません'}")
        print(f"温湿度センサー：{f'{temp[1]}（0x{temp[0]:02X}）' if temp else '見つかりません'}")
        if temp is None:
            print("→ I2C ではない種類（DHT22 など）の可能性があります。センサーの型番を Issue #4 に書いてください。")
        if light is None and temp is None:
            print("どちらも見つからないため終了します。配線と I2C の有効化（C1）を確認してください。")
            return

        csv_path = Path(args.csv or f"env_{datetime.datetime.now():%Y%m%d_%H%M}.csv")
        with csv_path.open("w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(["time", "temperature_c", "humidity_pct", "illuminance_lux"])
            print(f"記録ファイル：{csv_path}（市販の温湿度計の値もメモしておき、差を Issue に書いてください）")
            measured = 0
            try:
                while args.count == 0 or measured < args.count:
                    temperature = humidity = lux = None
                    try:
                        if temp is not None:
                            temperature, humidity = temp[2](bus, temp[0])
                        if light is not None:
                            lux = read_bh1750(bus, light[0])
                    except OSError as error:
                        print(f"[読み取りエラー] {error}")
                    now = datetime.datetime.now()
                    writer.writerow([now.isoformat(timespec="seconds"),
                                     f"{temperature:.1f}" if temperature is not None else "",
                                     f"{humidity:.1f}" if humidity is not None else "",
                                     f"{lux:.1f}" if lux is not None else ""])
                    file.flush()
                    parts = []
                    if temperature is not None:
                        parts.append(f"温度 {temperature:5.1f}℃  湿度 {humidity:5.1f}%")
                    if lux is not None:
                        parts.append(f"照度 {lux:8.1f} lx")
                    print(f"{now:%H:%M:%S}  " + "  ".join(parts))
                    measured += 1
                    time.sleep(args.interval)
            except KeyboardInterrupt:
                pass


if __name__ == "__main__":
    main()
