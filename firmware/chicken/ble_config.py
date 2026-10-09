"""たまごユニットとの共通BLE定義。tamago/include/BleConfig.h と一致させること。"""

DEVICE_NAME = "NeruKokko-Tamago"

SERVICE_UUID = "d5c10a00-3e9a-4baa-9c2e-9f1a2b3c0000"
CHAR_AUDIO_UUID = "d5c10a01-3e9a-4baa-9c2e-9f1a2b3c0000"
CHAR_MOTION_UUID = "d5c10a02-3e9a-4baa-9c2e-9f1a2b3c0000"
CHAR_ENV_UUID = "d5c10a03-3e9a-4baa-9c2e-9f1a2b3c0000"
CHAR_DOCK_UUID = "d5c10a04-3e9a-4baa-9c2e-9f1a2b3c0000"

SCAN_TIMEOUT_SEC = 10.0
RECONNECT_WAIT_SEC = 3.0
