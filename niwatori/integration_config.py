"""鶏側センサー統合処理の設定。環境変数から読み込む。"""

from __future__ import annotations

import os

# --- Supabase ---
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
SUPABASE_TABLE = os.environ.get("SUPABASE_TABLE", "sleep_records")

# --- 統合レコード送信間隔("一定間隔(例:1分ごと)") ---
AGGREGATION_INTERVAL_SEC = float(os.environ.get("AGGREGATION_INTERVAL_SEC", "60"))

# --- A111ミリ波レーダー(呼吸検知) ---
# 実機・配線方式が未確定のため、既定ではモック(シミュレーション)クライアントを使用する。
# 実機接続後は RADAR_USE_MOCK=false とし、配線方式に応じて RADAR_LINK を設定すること。
RADAR_USE_MOCK = os.environ.get("RADAR_USE_MOCK", "true").lower() == "true"
RADAR_LINK = os.environ.get("RADAR_LINK", "spi")  # "spi" | "uart" | "socket"
RADAR_SERIAL_PORT = os.environ.get("RADAR_SERIAL_PORT")  # RADAR_LINK="uart" の場合に使用
RADAR_SENSOR_ID = int(os.environ.get("RADAR_SENSOR_ID", "1"))

# --- SPH0645LM4H マイク(I2S) ---
MIC_DEVICE = os.environ.get("MIC_DEVICE")  # sounddeviceのデバイス名/インデックス。未指定ならシステム既定入力
MIC_SAMPLE_RATE = int(os.environ.get("MIC_SAMPLE_RATE", "16000"))
MIC_BLOCK_SIZE = int(os.environ.get("MIC_BLOCK_SIZE", "1024"))
