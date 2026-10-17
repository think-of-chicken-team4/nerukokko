"""たまごとの共通の BLE の定義。firmware/egg/include/BleConfig.h と docs/ble-protocol.md に合わせる。"""

DEVICE_NAME = "NeruKokko-Tamago"

SERVICE_UUID = "d5c10a00-3e9a-4baa-9c2e-9f1a2b3c0000"
CHAR_AUDIO_UUID = "d5c10a01-3e9a-4baa-9c2e-9f1a2b3c0000"
CHAR_MOTION_UUID = "d5c10a02-3e9a-4baa-9c2e-9f1a2b3c0000"
# d5c10a03（Environment）は廃止（環境センサーは鶏に搭載。Issue #4）
CHAR_DOCK_UUID = "d5c10a04-3e9a-4baa-9c2e-9f1a2b3c0000"

SCAN_TIMEOUT_SEC = 10.0
RECONNECT_WAIT_SEC = 3.0

# バッテリー残量（BLE 標準の Battery Service。たまごで BATTERY_ADC_PIN を設定したときだけある）
BATTERY_LEVEL_UUID = "00002a19-0000-1000-8000-00805f9b34fb"

# 充電の状態を Read で読み直す間隔（Notify を取りこぼしても気づけるように。Issue #5）
DOCK_POLL_SEC = 15.0
