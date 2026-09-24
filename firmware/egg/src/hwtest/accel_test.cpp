// E1：加速度センサーの確認と、寝返り検知のしきい値の調整（docs/hw-verification.md）
//   pio run -e hwtest_accel -t upload -t monitor
//
// 起動時に I2C で MPU-6050（0x68 / 0x69）を探す。見つからなければ、今の本番コードと同じ
// アナログ3軸（GPIO34/35/36）として読む。どちらで動いたかを最初に表示するので、Issue に書いてください。
//
// シリアルモニタで入力できるコマンド（入力して Enter）
//   t0.08 … しきい値を 0.08 に変える（MPU-6050 なら g、アナログなら ADC の値）
//   r     … 回数をリセット
//   s     … いまの設定と回数を表示
#include <Arduino.h>
#include <Wire.h>

#include <algorithm>
#include <cmath>

#include "PinConfig.h"

namespace {

constexpr uint32_t SAMPLE_INTERVAL_MS = 100;  // 本番の MOTION_POLL_INTERVAL_MS と同じ
constexpr uint32_t PRINT_INTERVAL_MS = 500;
constexpr uint32_t TURN_WINDOW_MS = 10000;    // 10秒以内の動きは1回の寝返りとして数える（api-spec §6-1）
constexpr float MPU_LSB_PER_G = 16384.0f;     // MPU-6050 を ±2g で使うとき

constexpr uint8_t MPU_REG_CONFIG = 0x1A;
constexpr uint8_t MPU_REG_ACCEL_CONFIG = 0x1C;
constexpr uint8_t MPU_REG_ACCEL_XOUT_H = 0x3B;
constexpr uint8_t MPU_REG_PWR_MGMT_1 = 0x6B;
constexpr uint8_t MPU_REG_WHO_AM_I = 0x75;

enum class Mode { Mpu6050, Analog };

Mode mode = Mode::Analog;
uint8_t mpuAddress = 0;
float threshold = 0.10f;  // MPU-6050 の初期値（g）。アナログのときは setup で 400 にする

float last[3] = {0, 0, 0};
bool hasLast = false;
float windowMaxDelta = 0;  // 表示間隔のあいだの変化量の最大値

uint32_t movementCount = 0;
uint32_t turnCount = 0;
bool turnActive = false;
uint32_t turnStartMs = 0;
float turnMaxDelta = 0;

uint32_t lastSampleMs = 0;
uint32_t lastPrintMs = 0;
String command;

bool mpuWrite(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(mpuAddress);
    Wire.write(reg);
    Wire.write(value);
    return Wire.endTransmission() == 0;
}

bool mpuRead(uint8_t reg, uint8_t* buffer, size_t length) {
    Wire.beginTransmission(mpuAddress);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) {
        return false;
    }
    if (Wire.requestFrom(static_cast<int>(mpuAddress), static_cast<int>(length)) != static_cast<int>(length)) {
        return false;
    }
    for (size_t i = 0; i < length; ++i) {
        buffer[i] = Wire.read();
    }
    return true;
}

bool findMpu() {
    for (uint8_t address : {0x68, 0x69}) {
        Wire.beginTransmission(address);
        if (Wire.endTransmission() == 0) {
            mpuAddress = address;
            return true;
        }
    }
    return false;
}

bool readSample(float out[3]) {
    if (mode == Mode::Mpu6050) {
        uint8_t raw[6];
        if (!mpuRead(MPU_REG_ACCEL_XOUT_H, raw, sizeof(raw))) {
            return false;
        }
        for (int axis = 0; axis < 3; ++axis) {
            int16_t value = static_cast<int16_t>((raw[axis * 2] << 8) | raw[axis * 2 + 1]);
            out[axis] = value / MPU_LSB_PER_G;
        }
        return true;
    }
    out[0] = analogRead(ACCEL_X_PIN);
    out[1] = analogRead(ACCEL_Y_PIN);
    out[2] = analogRead(ACCEL_Z_PIN);
    return true;
}

const char* unit() { return mode == Mode::Mpu6050 ? "g" : "(ADC)"; }

void printSettings() {
    Serial.printf("[設定] モード=%s しきい値=%.3f%s  動き=%lu回 寝返り=%lu回\n",
                  mode == Mode::Mpu6050 ? "MPU-6050(I2C)" : "アナログ3軸", threshold, unit(),
                  static_cast<unsigned long>(movementCount), static_cast<unsigned long>(turnCount));
}

void handleCommand(const String& line) {
    if (line.startsWith("t")) {
        float value = line.substring(1).toFloat();
        if (value > 0) {
            threshold = value;
        }
        printSettings();
    } else if (line == "r") {
        movementCount = 0;
        turnCount = 0;
        turnActive = false;
        Serial.println("[リセット] 回数を0にしました");
    } else if (line == "s") {
        printSettings();
    } else if (line.length() > 0) {
        Serial.println("コマンド：t<しきい値>（例 t0.08）、r（リセット）、s（設定表示）");
    }
}

void readSerialCommand() {
    while (Serial.available() > 0) {
        char c = static_cast<char>(Serial.read());
        if (c == '\n' || c == '\r') {
            command.trim();
            handleCommand(command);
            command = "";
        } else {
            command += c;
        }
    }
}

}  // namespace

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n[E1] 加速度センサーの確認");
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

    if (findMpu()) {
        mode = Mode::Mpu6050;
        uint8_t whoAmI = 0;
        mpuRead(MPU_REG_WHO_AM_I, &whoAmI, 1);
        mpuWrite(MPU_REG_PWR_MGMT_1, 0x00);    // スリープ解除
        mpuWrite(MPU_REG_ACCEL_CONFIG, 0x00);  // ±2g
        mpuWrite(MPU_REG_CONFIG, 0x03);        // ローパスフィルタ（約44Hz）でノイズを減らす
        Serial.printf("MPU-6050 を I2C アドレス 0x%02X で見つけました（WHO_AM_I=0x%02X）\n", mpuAddress, whoAmI);
    } else {
        mode = Mode::Analog;
        threshold = MOTION_THRESHOLD;
        analogReadResolution(12);
        Serial.println("I2C の加速度センサーが見つからないため、アナログ3軸（GPIO34/35/36）として読みます。");
        Serial.println("※ 値がほとんど変わらない場合は、配線かセンサーの種類を確認してください。");
    }
    printSettings();
    Serial.println("たまごを静かに置いた状態 → 傾ける → ベッドの上で寝返り、の順に値を見てください。");
}

void loop() {
    readSerialCommand();
    uint32_t now = millis();

    if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
        lastSampleMs = now;
        float current[3];
        if (!readSample(current)) {
            Serial.println("[エラー] センサーの読み取りに失敗しました");
            return;
        }
        if (hasLast) {
            float delta = 0;
            for (int axis = 0; axis < 3; ++axis) {
                delta = std::max(delta, std::fabs(current[axis] - last[axis]));
            }
            windowMaxDelta = std::max(windowMaxDelta, delta);

            if (delta > threshold) {
                ++movementCount;
                Serial.printf(">>> 動きあり  変化量=%.3f%s\n", delta, unit());
                if (!turnActive) {
                    turnActive = true;
                    turnStartMs = now;
                    turnMaxDelta = delta;
                    ++turnCount;
                    Serial.printf("=== 寝返り #%lu 検知 ===\n", static_cast<unsigned long>(turnCount));
                } else {
                    turnMaxDelta = std::max(turnMaxDelta, delta);
                }
            }
        }
        for (int axis = 0; axis < 3; ++axis) {
            last[axis] = current[axis];
        }
        hasLast = true;

        if (turnActive && now - turnStartMs >= TURN_WINDOW_MS) {
            turnActive = false;
            Serial.printf("=== 寝返り #%lu 終了（10秒間の最大変化量=%.3f%s）===\n",
                          static_cast<unsigned long>(turnCount), turnMaxDelta, unit());
        }
    }

    if (now - lastPrintMs >= PRINT_INTERVAL_MS && hasLast) {
        lastPrintMs = now;
        Serial.printf("t=%7.1fs  x=%8.3f y=%8.3f z=%8.3f %s  変化量の最大=%.3f  しきい値=%.3f  動き=%lu 寝返り=%lu\n",
                      now / 1000.0, last[0], last[1], last[2], unit(), windowMaxDelta, threshold,
                      static_cast<unsigned long>(movementCount), static_cast<unsigned long>(turnCount));
        windowMaxDelta = 0;
    }
}
