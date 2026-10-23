#include "BatterySensor.h"
#include "PinConfig.h"

#include <Arduino.h>

void BatterySensor::begin() {
    if (!enabled()) {
        return;
    }
    analogReadResolution(12);
    analogSetPinAttenuation(BATTERY_ADC_PIN, ADC_11db); // 0〜約3.1V を読めるようにする
}

bool BatterySensor::enabled() const {
    return BATTERY_ADC_PIN >= 0;
}

uint8_t BatterySensor::readPercent() {
    if (!enabled()) {
        return 0;
    }
    // ノイズを減らすため、8回の平均をとる。analogReadMilliVolts は ESP32 の補正値を使う
    uint32_t sum = 0;
    for (int i = 0; i < 8; ++i) {
        sum += analogReadMilliVolts(BATTERY_ADC_PIN);
    }
    float batteryMv = (sum / 8.0f) * BATTERY_DIVIDER_RATIO;
    if (batteryMv <= BATTERY_EMPTY_MV) {
        return 0;
    }
    if (batteryMv >= BATTERY_FULL_MV) {
        return 100;
    }
    return static_cast<uint8_t>((batteryMv - BATTERY_EMPTY_MV) * 100.0f / (BATTERY_FULL_MV - BATTERY_EMPTY_MV));
}
