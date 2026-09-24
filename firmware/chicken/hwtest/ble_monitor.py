"""E4：たまごとの BLE 通信の安定性を測る（docs/hw-verification.md）。E1・E2・E5 の確認にも使える。

    python3 hwtest/ble_monitor.py --minutes 30

たまご（本番のファームウェア）に接続し、届いたデータをすべて CSV に記録する。
1分ごとに受信数・取りこぼし率・最大の途切れ時間を表示し、終了時にまとめを表示する。
切断されたら自動で再接続し、再接続にかかった時間を測る。Ctrl+C で途中終了してもまとめを表示する。
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import datetime
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bleak import BleakClient, BleakScanner  # noqa: E402
from bleak.exc import BleakError  # noqa: E402

import ble_config  # noqa: E402
from sensor_data import AudioLevel, DockEvent, Environment, MotionEvent  # noqa: E402

AUDIO_INTERVAL_SEC = 0.3  # たまごの AUDIO_NOTIFY_INTERVAL_MS と同じ
AUDIO_GAP_WARN_SEC = 2.0  # これ以上 Audio Level が途切れたら表示する

CHARACTERISTICS = {
    "audio": (ble_config.CHAR_AUDIO_UUID, AudioLevel),
    "motion": (ble_config.CHAR_MOTION_UUID, MotionEvent),
    "environment": (ble_config.CHAR_ENV_UUID, Environment),
    "dock": (ble_config.CHAR_DOCK_UUID, DockEvent),
}


@dataclass
class Stats:
    started: float = field(default_factory=time.monotonic)
    counts: dict[str, int] = field(default_factory=lambda: {name: 0 for name in CHARACTERISTICS})
    minute_counts: dict[str, int] = field(default_factory=lambda: {name: 0 for name in CHARACTERISTICS})
    connected_seconds: float = 0.0
    connected_since: float | None = None
    disconnects: int = 0
    reconnect_seconds: list[float] = field(default_factory=list)
    disconnected_at: float | None = None
    last_audio: float | None = None
    max_audio_gap: float = 0.0
    minute_max_audio_gap: float = 0.0
    last_packet_wall: str = "-"


def now_iso() -> str:
    return datetime.datetime.now().isoformat(timespec="milliseconds")


class Monitor:
    def __init__(self, csv_path: Path, verbose: bool) -> None:
        self.stats = Stats()
        self.verbose = verbose
        self.csv_file = csv_path.open("w", newline="", encoding="utf-8")
        self.writer = csv.writer(self.csv_file)
        self.writer.writerow(["time", "elapsed_s", "kind", "value1", "value2", "value3"])
        self.disconnected = asyncio.Event()

    def elapsed(self) -> float:
        return time.monotonic() - self.stats.started

    def log(self, kind: str, *values: object) -> None:
        self.writer.writerow([now_iso(), f"{self.elapsed():.3f}", kind, *values])

    def make_handler(self, name: str, parser: type):
        def handle(_sender: object, data: bytearray) -> None:
            now = time.monotonic()
            self.stats.last_packet_wall = now_iso()
            try:
                value = parser.from_bytes(bytes(data))
            except Exception as error:  # noqa: BLE001  形式が違うデータも記録して先へ進む
                print(f"[形式エラー] {name}: {data.hex()}（{error}）")
                self.log(name, "parse_error", data.hex())
                return
            self.stats.counts[name] += 1
            self.stats.minute_counts[name] += 1

            if name == "audio":
                if self.stats.last_audio is not None:
                    gap = now - self.stats.last_audio
                    self.stats.max_audio_gap = max(self.stats.max_audio_gap, gap)
                    self.stats.minute_max_audio_gap = max(self.stats.minute_max_audio_gap, gap)
                    if gap >= AUDIO_GAP_WARN_SEC:
                        print(f"[途切れ] Audio Level が {gap:.1f} 秒届きませんでした")
                self.stats.last_audio = now
                self.log(name, value.level)
                if self.verbose:
                    print(f"audio level={value.level}")
            elif name == "motion":
                self.log(name, value.x, value.y, value.z)
                print(f"[Motion] x={value.x} y={value.y} z={value.z}")
            elif name == "environment":
                self.log(name, f"{value.temperature:.2f}", f"{value.humidity:.2f}", value.lux)
                print(f"[Environment] {value.temperature:.1f}℃ {value.humidity:.1f}% {value.lux}lx")
            elif name == "dock":
                self.log(name, int(value.docked))
                print(f"[Dock] {'巣に置いた（docked=1）' if value.docked else '取り出した（docked=0）'}")

        return handle

    async def find_egg(self) -> object | None:
        found = await BleakScanner.discover(timeout=ble_config.SCAN_TIMEOUT_SEC, return_adv=True)
        for device, advertisement in found.values():
            if device.name == ble_config.DEVICE_NAME or advertisement.local_name == ble_config.DEVICE_NAME:
                print(f"たまごを見つけました：{device.address}  電波の強さ RSSI={advertisement.rssi} dBm")
                self.log("scan", device.address, advertisement.rssi)
                return device
        return None

    def on_disconnect(self, _client: BleakClient) -> None:
        now = time.monotonic()
        if self.stats.connected_since is not None:
            self.stats.connected_seconds += now - self.stats.connected_since
            self.stats.connected_since = None
        self.stats.disconnects += 1
        self.stats.disconnected_at = now
        self.stats.last_audio = None
        print(f"[切断] {now_iso()}（{self.stats.disconnects}回目）")
        self.log("disconnect")
        self.disconnected.set()

    async def run_connection_loop(self) -> None:
        while True:
            device = await self.find_egg()
            if device is None:
                print(f"たまご（{ble_config.DEVICE_NAME}）が見つかりません。再スキャンします。")
                await asyncio.sleep(ble_config.RECONNECT_WAIT_SEC)
                continue
            self.disconnected.clear()
            try:
                async with BleakClient(device, disconnected_callback=self.on_disconnect) as client:
                    now = time.monotonic()
                    self.stats.connected_since = now
                    if self.stats.disconnected_at is not None:
                        took = now - self.stats.disconnected_at
                        self.stats.reconnect_seconds.append(took)
                        print(f"[再接続] {took:.1f} 秒で再接続しました")
                        self.stats.disconnected_at = None
                    print(f"[接続] {now_iso()}")
                    self.log("connect", device.address)
                    for name, (uuid, parser) in CHARACTERISTICS.items():
                        try:
                            await client.start_notify(uuid, self.make_handler(name, parser))
                        except (BleakError, ValueError) as error:
                            print(f"[注意] {name} を購読できません（たまご側にない可能性）：{error}")
                    await self.disconnected.wait()
            except (BleakError, asyncio.TimeoutError, OSError) as error:
                print(f"[接続エラー] {error}。再試行します。")
                if self.stats.disconnected_at is None:
                    self.stats.disconnected_at = time.monotonic()
                await asyncio.sleep(ble_config.RECONNECT_WAIT_SEC)

    async def report_every_minute(self) -> None:
        expected = 60 / AUDIO_INTERVAL_SEC
        minute = 0
        while True:
            await asyncio.sleep(60)
            minute += 1
            counts = self.stats.minute_counts
            rate = counts["audio"] / expected * 100
            print(
                f"--- {minute}分目：Audio {counts['audio']}件（受信率 {rate:.0f}%）"
                f" Motion {counts['motion']}件 Environment {counts['environment']}件 Dock {counts['dock']}件"
                f" 最大の途切れ {self.stats.minute_max_audio_gap:.1f}秒 ---"
            )
            self.stats.minute_counts = {name: 0 for name in CHARACTERISTICS}
            self.stats.minute_max_audio_gap = 0.0
            self.csv_file.flush()

    def print_summary(self) -> None:
        stats = self.stats
        total = self.elapsed()
        connected = stats.connected_seconds
        if stats.connected_since is not None:
            connected += time.monotonic() - stats.connected_since
        expected_audio = connected / AUDIO_INTERVAL_SEC if connected > 0 else 0
        audio_rate = stats.counts["audio"] / expected_audio * 100 if expected_audio else 0
        average_reconnect = (
            sum(stats.reconnect_seconds) / len(stats.reconnect_seconds) if stats.reconnect_seconds else 0
        )
        print("\n==== まとめ（この結果を Issue に貼ってください）====")
        print(f"計測時間：{total / 60:.1f}分　接続していた時間：{connected / 60:.1f}分（{connected / total * 100 if total else 0:.0f}%）")
        print(f"Audio Level：{stats.counts['audio']}件（接続中の受信率 {audio_rate:.1f}%、取りこぼし {max(0.0, 100 - audio_rate):.1f}%）")
        print(f"Motion：{stats.counts['motion']}件　Environment：{stats.counts['environment']}件　Dock：{stats.counts['dock']}件")
        print(f"Audio Level の最大の途切れ：{stats.max_audio_gap:.1f}秒")
        print(f"切断：{stats.disconnects}回　再接続にかかった時間の平均：{average_reconnect:.1f}秒")
        print(f"最後にデータが届いた時刻：{stats.last_packet_wall}（E5 のバッテリー測定で使う）")


async def main_async(args: argparse.Namespace) -> None:
    csv_path = Path(args.csv or f"ble_monitor_{datetime.datetime.now():%Y%m%d_%H%M}.csv")
    monitor = Monitor(csv_path, args.verbose)
    print(f"記録ファイル：{csv_path}　計測時間：{args.minutes}分（Ctrl+C で途中終了）")
    tasks = [
        asyncio.create_task(monitor.run_connection_loop()),
        asyncio.create_task(monitor.report_every_minute()),
    ]
    try:
        await asyncio.wait_for(asyncio.gather(*tasks), timeout=args.minutes * 60)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        monitor.print_summary()
        monitor.csv_file.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="たまごとの BLE 通信の安定性を測る（E4）")
    parser.add_argument("--minutes", type=float, default=30, help="計測する時間（分）。既定は30分")
    parser.add_argument("--csv", help="記録する CSV ファイル名（既定：ble_monitor_日時.csv）")
    parser.add_argument("--verbose", action="store_true", help="Audio Level を1件ずつ表示する")
    args = parser.parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
