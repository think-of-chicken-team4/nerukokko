"""C2：条件別（人なし・普通に呼吸・息止め）に、レーダーの反射の強さと呼吸の検出を記録する（docs/hw-verification.md）。

事前に、同じラズパイで Acconeer の exploration server（acc_exploration_server_a111）を起動しておく。

    python3 hwtest/radar_conditions.py                # 3条件を順に測る（各60秒）
    python3 hwtest/radar_conditions.py --seconds 90

条件：
  nothing     何もない方向（天井など）に向けて固定。人はセンサーから1m以上離れる
  chest       胸に向けて固定（30〜50cm）。普通に呼吸
  breath_hold 胸に向けたまま、息を止める

Enter で開始し、最初の WARMUP_SEC 秒は集計から除く。結果は radar_conditions_日時.csv と画面の集計（Issue に貼る）。
本番のフィルタのしきい値（integration_config.py の RADAR_PRESENCE_ENV_MAX・RADAR_BREATHING_STD_MM）を、
置き場所ごとに決め直すときに使う。env_max が「人がいる」、peak_std_mm が「呼吸している」の判定に使われる。
2026-10-16 の測定（Issue #16）：人なし env_max 最大 42.5／人あり 最小 約252、peak_std_mm は胸 1.46／息止め 0.14。
"""

import argparse
import csv
import datetime
import re
import statistics
import time

import numpy as np

import acconeer.exptool as et
from acconeer.exptool.a111.algo.breathing import Processor, ProcessingConfiguration, get_sensor_config

BPM_PATTERN = re.compile(r"BPM ([\d.]+), depth ([\d.]+) mm")
WARMUP_SEC = 10
CONDITIONS = [
    ("nothing", "何もない方向（天井など）に向けて固定。人は離れる"),
    ("chest", "胸に向けて固定（30〜50cm）。普通に呼吸"),
    ("breath_hold", "胸に向けたまま、息を止める（苦しければ止めずに少しずつ吐く）"),
]


def measure(label, seconds, writer):
    client = et.a111.Client(link="socket", host="127.0.0.1")
    sensor_config = get_sensor_config()
    sensor_config.sensor = [1]
    session_info = client.setup_session(sensor_config)
    client.start_session()
    processor = Processor(sensor_config, ProcessingConfiguration(), session_info)
    started = time.time()
    rows = []
    try:
        while time.time() - started < seconds:
            info, sweep = client.get_next()
            processed = processor.process(sweep, info)
            if not processed:
                continue
            elapsed = time.time() - started
            env = np.asarray(processed["env_ampl"], dtype=float)
            idx = int(processed["peak_idx"])
            text = processed.get("breathing_text")
            match = BPM_PATTERN.search(text) if text else None
            row = {
                "label": label,
                "t": round(elapsed, 2),
                "env_max": float(env.max()),
                "env_at_peak": float(env[min(idx, len(env) - 1)]),
                "peak_idx": idx,
                "peak_std_mm": float(processed["peak_std_mm"]),
                "detected": 1 if match else 0,
                "bpm": float(match.group(1)) if match else "",
                "depth_mm": float(match.group(2)) if match else "",
            }
            writer.writerow(row.values())
            if elapsed >= WARMUP_SEC:
                rows.append(row)
    finally:
        client.disconnect()
    return rows


def summarize(label, rows):
    if not rows:
        print(f"[{label}] データなし")
        return
    det = [r for r in rows if r["detected"]]
    q = lambda key: statistics.median([r[key] for r in rows])
    print(f"[{label}] 掃引{len(rows)}件  呼吸検出 {len(det)}/{len(rows)} ({100 * len(det) / len(rows):.0f}%)")
    print(f"    env_at_peak 中央値 {q('env_at_peak'):8.2f}   env_max 中央値 {q('env_max'):8.2f}")
    print(f"    peak_std_mm 中央値 {q('peak_std_mm'):8.4f}   peak_idx 中央値 {q('peak_idx'):6.0f}")
    if det:
        bpms = [r["bpm"] for r in det]
        print(f"    BPM 中央値 {statistics.median(bpms):5.1f}  最小 {min(bpms):5.1f}  最大 {max(bpms):5.1f}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=int, default=60, help="1条件あたりの測定秒数")
    args = parser.parse_args()
    path = f"radar_conditions_{datetime.datetime.now():%Y%m%d_%H%M}.csv"
    summaries = []
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["label", "t", "env_max", "env_at_peak", "peak_idx", "peak_std_mm", "detected", "bpm", "depth_mm"])
        for label, instruction in CONDITIONS:
            print(f"\n=== 条件 {label} ===\n{instruction}")
            input(f"準備できたら Enter（{args.seconds}秒測定、最初の{WARMUP_SEC}秒は集計に入れません）")
            rows = measure(label, args.seconds, writer)
            f.flush()
            summaries.append((label, rows))
            summarize(label, rows)
    print("\n==== まとめ（Issue #16 に貼ってください）====")
    for label, rows in summaries:
        summarize(label, rows)
    print(f"\n記録ファイル：{path}")


if __name__ == "__main__":
    main()
