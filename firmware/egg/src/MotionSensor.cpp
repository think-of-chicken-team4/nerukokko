#include "MotionSensor.h"
#include "PinConfig.h"

#include <Arduino.h>
#include <Wire.h>
#include <cstdlib>

namespace {
constexpr uint8_t MPU6050_ADDR = 0x68;
constexpr uint8_t REG_PWR_MGMT_1 = 0x6B;
constexpr uint8_t REG_ACCEL_XOUT_H = 0x3B;

void writeRegister(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(MPU6050_ADDR);
    Wire.write(reg);
    Wire.write(value);
    Wire.endTransmission();
}
} // namespace

void MotionSensor::begin() {
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
    writeRegister(REG_PWR_MGMT_1, 0x00); // スリープ解除
    lastReading_ = read();
}

MotionEventData MotionSensor::read() {
    MotionEventData data{0, 0, 0};

    Wire.beginTransmission(MPU6050_ADDR);
    Wire.write(REG_ACCEL_XOUT_H);
    if (Wire.endTransmission(false) != 0) {
        return data;
    }
    if (Wire.requestFrom(static_cast<int>(MPU6050_ADDR), 6) < 6) {
        return data;
    }

    // MPU-6050はビッグエンディアンでACCEL_XOUT_H/L, YOUT_H/L, ZOUT_H/Lの順
    data.x = static_cast<int16_t>((Wire.read() << 8) | Wire.read());
    data.y = static_cast<int16_t>((Wire.read() << 8) | Wire.read());
    data.z = static_cast<int16_t>((Wire.read() << 8) | Wire.read());
    return data;
}

bool MotionSensor::checkThresholdEvent(MotionEventData& out) {
    MotionEventData current = read();

    int dx = std::abs(current.x - lastReading_.x);
    int dy = std::abs(current.y - lastReading_.y);
    int dz = std::abs(current.z - lastReading_.z);

    bool exceeded = dx > MOTION_THRESHOLD || dy > MOTION_THRESHOLD || dz > MOTION_THRESHOLD;

    lastReading_ = current;

    if (exceeded) {
        out = current;
    }
    return exceeded;
}
