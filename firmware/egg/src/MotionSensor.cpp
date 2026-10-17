#include "MotionSensor.h"
#include "PinConfig.h"

#include <Arduino.h>
#include <Wire.h>
#include <cstdlib>

namespace {
constexpr uint8_t REG_ACCEL_CONFIG = 0x1C;
constexpr uint8_t REG_PWR_MGMT_1 = 0x6B;
constexpr uint8_t REG_ACCEL_XOUT_H = 0x3B;

void writeRegister(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(MPU6050_I2C_ADDR);
    Wire.write(reg);
    Wire.write(value);
    Wire.endTransmission();
}
} // namespace

void MotionSensor::begin() {
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
    writeRegister(REG_PWR_MGMT_1, 0x00);   // スリープ解除
    writeRegister(REG_ACCEL_CONFIG, 0x00); // 測定範囲 ±2g（16384 = 1g）
    hasLastReading_ = read(lastReading_);
}

bool MotionSensor::read(MotionEventData& out) {
    Wire.beginTransmission(MPU6050_I2C_ADDR);
    Wire.write(REG_ACCEL_XOUT_H);
    if (Wire.endTransmission(false) != 0) {
        return false;
    }
    if (Wire.requestFrom(static_cast<int>(MPU6050_I2C_ADDR), 6) < 6) {
        return false;
    }
    // ACCEL_XOUT_H/L, YOUT_H/L, ZOUT_H/L の順（ビッグエンディアン）
    out.x = static_cast<int16_t>((Wire.read() << 8) | Wire.read());
    out.y = static_cast<int16_t>((Wire.read() << 8) | Wire.read());
    out.z = static_cast<int16_t>((Wire.read() << 8) | Wire.read());
    return true;
}

bool MotionSensor::checkThresholdEvent(MotionEventData& out) {
    MotionEventData current;
    if (!read(current)) {
        return false; // 読めなかったら前回の値を保つ
    }
    if (!hasLastReading_) {
        lastReading_ = current;
        hasLastReading_ = true;
        return false;
    }

    int dx = std::abs(current.x - lastReading_.x);
    int dy = std::abs(current.y - lastReading_.y);
    int dz = std::abs(current.z - lastReading_.z);
    lastReading_ = current;

    if (dx > MOTION_THRESHOLD || dy > MOTION_THRESHOLD || dz > MOTION_THRESHOLD) {
        out = current;
        return true;
    }
    return false;
}
