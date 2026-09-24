"""C2：ミリ波レーダー（A111）で呼吸数がとれるかを確かめる（docs/hw-verification.md）。

事前に、同じラズパイで Acconeer の exploration server（acc_exploration_server_a111）を起動しておく。

    python3 hwtest/radar_test.py                    # 5秒ごとに呼吸数を表示（Ctrl+C で終了）
    python3 hwtest/radar_test.py --count            # 自分で数えた呼吸数と比べる（合格の目安 ±3回/分）
    python3 hwtest/radar_test.py --link mock        # 実機なしで動作だけ確認する

呼吸の処理には、本番（radar_sensor.py）と同じ Acconeer 公式の breathing アルゴリズムを使う。
"""

from __future__ import annotations

import argparse
import csv
import datetime
import re
import statistics
import threading
import time
from pathlib import Path

import acconeer.exptool as et
from acconeer.exptool.a111.algo.breathing import Processor, ProcessingConfiguration, get_sensor_config

BPM_PATTERN = re.compile(r"BPM ([\d.]+), depth ([\d.]+) mm")
PRINT_INTERVAL_SEC = 5
NO_BREATH_WARN_SEC = 30
COUNT_SECONDS = 60
PASS_TOLERANCE_BPM = 3.0
RECORD_INTERVAL_SEC = 1.0  # 呼吸数はほぼ毎回の掃引（約80回/秒）で出るので、1秒に1件に間引いて記録する


class RadarReader:
    """別スレッドでレーダーを読み続け、呼吸数（BPM）を時刻付きでためる。"""

    def __init__(self, args: argparse.Namespace, csv_path: Path) -> None:
        self.args = args
        self.readings: list[tuple[float, float, float]] = []  # (時刻, BPM, 深さmm)
        self.sweeps = 0
        self.error: Exception | None = None
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.csv_file = csv_path.open("w", newline="", encoding="utf-8")
        self.writer = csv.writer(self.csv_file)
        self.writer.writerow(["time", "bpm", "depth_mm"])
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.thread.join(timeout=5)
        self.csv_file.close()

    def bpm_since(self, since: float) -> list[float]:
        with self.lock:
            return [bpm for t, bpm, _ in self.readings if t >= since]

    def last_reading_time(self) -> float | None:
        with self.lock:
            return self.readings[-1][0] if self.readings else None

    def _make_client(self) -> et.a111.Client:
        if self.args.link == "mock":
            return et.a111.Client(mock=True)
        kwargs: dict[str, object] = {"link": self.args.link}
        if self.args.link == "socket":
            kwargs["host"] = self.args.host
        if self.args.link == "uart" and self.args.serial_port:
            kwargs["serial_port"] = self.args.serial_port
        return et.a111.Client(**kwargs)

    def _run(self) -> None:
        client = None
        try:
            client = self._make_client()
            sensor_config = get_sensor_config()
            sensor_config.sensor = [self.args.sensor]
            if self.args.range:
                sensor_config.range_interval = self.args.range
            session_info = client.setup_session(sensor_config)
            client.start_session()
            processor = Processor(sensor_config, ProcessingConfiguration(), session_info)
            last_recorded = 0.0
            print(f"計測を始めました（範囲 {sensor_config.range_interval[0]:.2f}〜{sensor_config.range_interval[1]:.2f} m）")

            while not self.stop_event.is_set():
                info, sweep = client.get_next()
                self.sweeps += 1
                processed = processor.process(sweep, info)
                text = processed.get("breathing_text") if processed else None
                match = BPM_PATTERN.search(text) if text else None
                now = time.time()
                if match and now - last_recorded >= RECORD_INTERVAL_SEC:
                    last_recorded = now
                    bpm, depth = float(match.group(1)), float(match.group(2))
                    with self.lock:
                        self.readings.append((now, bpm, depth))
                    self.writer.writerow([datetime.datetime.fromtimestamp(now).isoformat(timespec="seconds"), bpm, depth])
        except Exception as error:  # noqa: BLE001  接続できないなどの原因を画面に出すため
            self.error = error
        finally:
            if client is not None:
                try:
                    client.disconnect()
                except Exception:  # noqa: BLE001
                    pass


def monitor_mode(reader: RadarReader, minutes: float) -> None:
    print(f"{PRINT_INTERVAL_SEC}秒ごとに表示します（Ctrl+C で終了）。")
    started = time.time()
    while reader.error is None and (minutes <= 0 or time.time() - started < minutes * 60):
        time.sleep(PRINT_INTERVAL_SEC)
        now = time.time()
        recent = reader.bpm_since(now - 30)
        last = reader.last_reading_time()
        if recent:
            print(
                f"[{now - started:6.0f}s] 呼吸数（直近30秒の中央値）{statistics.median(recent):5.1f} 回/分"
                f"  検出 {len(recent)} 件  掃引 {reader.sweeps} 回"
            )
        elif last is None or now - last >= NO_BREATH_WARN_SEC:
            print(f"[{now - started:6.0f}s] 呼吸を検出できていません（人がいない／向き・距離が合っていない）  掃引 {reader.sweeps} 回")


def count_mode(reader: RadarReader) -> None:
    print("ベッドに横になり、準備ができたら Enter を押してください。")
    input()
    for remaining in (3, 2, 1):
        print(f"{remaining}...")
        time.sleep(1)
    print(f"スタート！ {COUNT_SECONDS}秒間、自分の呼吸（吸って吐いて＝1回）を数えてください。")
    started = time.time()
    time.sleep(COUNT_SECONDS)
    print("ストップ！ 数えた回数を入力して Enter：", end="", flush=True)
    counted = float(input().strip())
    values = reader.bpm_since(started)
    if not values:
        print("この60秒間、レーダーは呼吸を検出できませんでした。置き場所・向きを変えてもう一度試してください。")
        return
    radar = statistics.median(values)
    diff = radar - counted
    result = "合格" if abs(diff) <= PASS_TOLERANCE_BPM else "不合格"
    print("==== 結果（Issue に貼ってください）====")
    print(f"自分で数えた呼吸数：{counted:.0f} 回/分")
    print(f"レーダーの呼吸数　：{radar:.1f} 回/分（60秒間の中央値、検出 {len(values)} 件）")
    print(f"差：{diff:+.1f} 回/分 → {result}（目安 ±{PASS_TOLERANCE_BPM:.0f} 回/分）")


def main() -> None:
    parser = argparse.ArgumentParser(description="ミリ波レーダー（A111）の呼吸検知を確かめる（C2）")
    parser.add_argument("--link", default="socket", choices=["socket", "spi", "uart", "mock"],
                        help="接続方法。ラズパイで exploration server を動かすときは socket（既定）")
    parser.add_argument("--host", default="127.0.0.1", help="exploration server の IP アドレス（既定：同じラズパイ）")
    parser.add_argument("--serial-port", help="--link uart のときのシリアルポート")
    parser.add_argument("--sensor", type=int, default=1, help="センサーの番号（既定：1）")
    parser.add_argument("--range", type=float, nargs=2, metavar=("START_M", "END_M"),
                        help="測る距離の範囲（m）。既定は 0.3〜0.8 m。ベッドまでの距離に合わせて変える")
    parser.add_argument("--count", action="store_true", help="自分で数えた呼吸数と比べるモード")
    parser.add_argument("--minutes", type=float, default=0, help="表示モードで計測する時間（分）。0 は Ctrl+C まで")
    parser.add_argument("--csv", help="記録する CSV ファイル名（既定：radar_日時.csv）")
    args = parser.parse_args()

    csv_path = Path(args.csv or f"radar_{datetime.datetime.now():%Y%m%d_%H%M}.csv")
    reader = RadarReader(args, csv_path)
    reader.start()
    print(f"記録ファイル：{csv_path}")
    try:
        time.sleep(3)
        if reader.error is None:
            if args.count:
                count_mode(reader)
            else:
                monitor_mode(reader, args.minutes)
    except KeyboardInterrupt:
        pass
    finally:
        reader.stop()
    if reader.error is not None:
        print(f"[エラー] レーダーに接続できません：{reader.error}")
        print("exploration server が起動しているか、--link と --host が正しいかを確認してください。")


if __name__ == "__main__":
    main()
