#pragma once

// たまご（ESP32）のピンと、実機で調整する値をここに集める。
// 「実機で調整」と書いた値は、docs/hw-verification.md の検証（E1〜E5）の結果で決める。値を変えたら Issue に測定値を残す。

#include <cstdint>

// ===== PDM マイク（ADA-4346）=====
// ESPr Developer 32 は、GPIO32・33 が発振子専用で使えない（スイッチサイエンスの製品ページ）。そのため 25・26 を使う（E2）
constexpr int PDM_CLK_PIN = 25;
constexpr int PDM_DATA_PIN = 26;
constexpr uint32_t AUDIO_SAMPLE_RATE_HZ = 16000;
constexpr uint32_t AUDIO_NOTIFY_INTERVAL_MS = 300;  // 音量を鶏へ送る間隔（0.2〜0.5秒ごと）

// ===== I2C（加速度センサー）=====
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;

// ===== 加速度センサー（SEN0142 = MPU-6050、I2C 0x68）=====
constexpr uint8_t MPU6050_I2C_ADDR = 0x68;           // AD0 を GND（未配線）にしたときのアドレス
constexpr float MPU6050_LSB_PER_G = 16384.0f;        // 測定範囲 ±2g のとき 16384 = 1g
constexpr uint32_t MOTION_POLL_INTERVAL_MS = 100;     // 加速度を読む間隔
constexpr uint32_t MOTION_FALLBACK_INTERVAL_MS = 5000; // 動きがなくても、この間隔で今の値を送る（つながっている確認用）
// 【実機で調整：E1・Issue #33】前回の値からの変化がこれ（g）を超えたら「動きあり」として送る。
// 静止時のノイズは 0.004〜0.007g（2026-10 の測定）。寝返り10回をきちんと数え、呼吸や小さな動きで反応しない値にする
constexpr float MOTION_THRESHOLD_G = 0.05f;
constexpr int16_t MOTION_THRESHOLD = static_cast<int16_t>(MOTION_THRESHOLD_G * MPU6050_LSB_PER_G);

// アナログ3軸だった頃のピン。本番では使わない（hwtest/accel_test.cpp のアナログ確認用に残している）
constexpr int ACCEL_X_PIN = 34;
constexpr int ACCEL_Y_PIN = 35;
constexpr int ACCEL_Z_PIN = 36;

// ===== 充電検知（巣からの 5V を分圧して ADC で読む。2026-10-30 に STAT 方式から変更：E3・Issue #12）=====
// 充電モジュールの STAT は、満充電のときも「充電していない」と同じ表示になり、基板の LED にしかつながっていない（取り出せない）。
// そのため、巣に置いたときにポゴピンから来る 5V を、抵抗2本で分圧して読む。満充電でも 5V は来るので、取りこぼさない。
//   ポゴピンの 5V ──[DOCK_DIVIDER_UPPER_OHM]──┬──[DOCK_DIVIDER_LOWER_OHM]── GND
//                                              └── DOCK_VIN_PIN
constexpr int DOCK_VIN_PIN = 35;                      // ADC1 のピン（GPIO34〜39。ESPr Developer 32 の「35」）
constexpr float DOCK_DIVIDER_UPPER_OHM = 10000.0f;    // 5V 側の抵抗
constexpr float DOCK_DIVIDER_LOWER_OHM = 15000.0f;    // GND 側の抵抗（ピンの電圧 = 5V × 15k ÷ 25k = 3.0V。ADC の上限約 3.1V に近い）
constexpr float DOCK_DIVIDER_RATIO = (DOCK_DIVIDER_UPPER_OHM + DOCK_DIVIDER_LOWER_OHM) / DOCK_DIVIDER_LOWER_OHM;  // ピンの電圧 × これ = 巣の電圧
// 【実機で調整：E3】この電圧以上なら「巣から給電されている＝巣にある」とみなす（巣の 5V は 4.95V、出したときは 0.24V だった）
constexpr float DOCK_PRESENT_VOLTS = 4.0f;
// 【実機で調整：E3・Issue #5】この時間、同じ状態が続いたら「巣に置いた／取り出した」と確定する（ポゴピンのチャタリング対策）
constexpr uint32_t DOCK_DEBOUNCE_MS = 300;

// ===== バッテリー残量（F-09。配線が決まったら使う：E5）=====
// 電池の電圧を抵抗で分圧して ADC で読む。-1 のときは読まない（BLE の Battery も出さない）
constexpr int BATTERY_ADC_PIN = -1;
constexpr float BATTERY_DIVIDER_RATIO = 2.0f;      // 分圧比（電池の電圧 = ADC の電圧 × この値）
constexpr uint32_t BATTERY_FULL_MV = 4200;         // 満充電の電圧
constexpr uint32_t BATTERY_EMPTY_MV = 3300;        // これで 0%（保護回路が切れる少し前）
constexpr uint32_t BATTERY_NOTIFY_INTERVAL_MS = 60000;
