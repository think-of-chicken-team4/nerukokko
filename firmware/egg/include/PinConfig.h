#pragma once

#include <cstdint>

// --- PDM mic (ADA-4346) ---
constexpr int PDM_CLK_PIN = 32;
constexpr int PDM_DATA_PIN = 33;
constexpr uint32_t AUDIO_SAMPLE_RATE_HZ = 16000;
constexpr uint32_t AUDIO_NOTIFY_INTERVAL_MS = 300; // 0.2〜0.5秒ごと

// --- Accelerometer (SEN0142, analog triple axis) ---
constexpr int ACCEL_X_PIN = 34;
constexpr int ACCEL_Y_PIN = 35;
constexpr int ACCEL_Z_PIN = 36;
constexpr uint32_t MOTION_POLL_INTERVAL_MS = 100;     // 閾値監視の周期
constexpr uint32_t MOTION_FALLBACK_INTERVAL_MS = 5000; // 保険の定期送信
constexpr int16_t MOTION_THRESHOLD = 400;              // 前回値との差分がこれを超えたらイベント送信

// --- Temperature & Humidity (SEN0137, I2C SHT20 protocol) ---
constexpr uint8_t SHT20_I2C_ADDR = 0x40;
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;

// --- Illuminance (SEN0097, analog) ---
constexpr int LUX_ANALOG_PIN = 39;

constexpr uint32_t ENV_NOTIFY_INTERVAL_MS = 30000; // 30秒〜1分ごと

// --- Dock Event (充電モジュール SFE-PRT-14380 / MCP73831 STATピン) ---
// STATはオープンドレイン: 外付けプルアップ抵抗(4.7k〜47kΩ)でHIGHに引き上げる
constexpr int DOCK_STAT_PIN = 27;
constexpr uint32_t DOCK_DEBOUNCE_MS = 200; // チャタリング対策
