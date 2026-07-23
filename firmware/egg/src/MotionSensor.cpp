#include "MotionSensor.h"
#include "PinConfig.h"

#include <Arduino.h>
#include <cstdlib>

void MotionSensor::begin() {
    analogReadResolution(12); // ESP32 ADC: 0-4095
    lastReading_ = read();
}

MotionEventData MotionSensor::read() {
    MotionEventData data;
    // ADC値(0-4095)を中心0のint16レンジに変換
    data.x = static_cast<int16_t>(analogRead(ACCEL_X_PIN) - 2048);
    data.y = static_cast<int16_t>(analogRead(ACCEL_Y_PIN) - 2048);
    data.z = static_cast<int16_t>(analogRead(ACCEL_Z_PIN) - 2048);
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
