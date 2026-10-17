#pragma once

// 共通ベースUUID: d5c10a-- - 3e9a-4baa-9c2e-9f1a2b3c0000 の末尾2桁のみ変更
#define NERUKOKKO_SERVICE_UUID      "d5c10a00-3e9a-4baa-9c2e-9f1a2b3c0000"
#define NERUKOKKO_CHAR_AUDIO_UUID   "d5c10a01-3e9a-4baa-9c2e-9f1a2b3c0000"
#define NERUKOKKO_CHAR_MOTION_UUID  "d5c10a02-3e9a-4baa-9c2e-9f1a2b3c0000"
// d5c10a03（Environment）は廃止（環境センサーは鶏に搭載。Issue #4）。番号は使い回さない
#define NERUKOKKO_CHAR_DOCK_UUID    "d5c10a04-3e9a-4baa-9c2e-9f1a2b3c0000"

#define NERUKOKKO_DEVICE_NAME       "NeruKokko-Tamago"

// バッテリー残量は BLE 標準の Battery Service（BATTERY_ADC_PIN を設定したときだけ出す）
#define BLE_BATTERY_SERVICE_UUID    "180F"
#define BLE_BATTERY_LEVEL_UUID      "2A19"
