#include "DockSensor.h"
#include "PinConfig.h"

#include <Arduino.h>

namespace {
// 巣からの 5V を分圧して読む：DOCK_PRESENT_VOLTS 以上 = 巣にある（巣に戻した＝起床）、未満 = 巣から出た
uint8_t readDocked() {
    float volts = analogReadMilliVolts(DOCK_VIN_PIN) / 1000.0f * DOCK_DIVIDER_RATIO;
    return volts >= DOCK_PRESENT_VOLTS ? 1 : 0;
}
} // namespace

void DockSensor::begin() {
    analogSetPinAttenuation(DOCK_VIN_PIN, ADC_11db);  // 0〜約3.1V を読めるようにする
    stable_ = candidate_ = readDocked();
    candidateSinceMs_ = millis();
}

bool DockSensor::pollEvent(DockEventData& out) {
    uint32_t now = millis();
    uint8_t level = readDocked();
    if (level != candidate_) {
        candidate_ = level;
        candidateSinceMs_ = now;
        return false;
    }
    if (candidate_ != stable_ && now - candidateSinceMs_ >= DOCK_DEBOUNCE_MS) {
        stable_ = candidate_;
        out.docked = stable_;
        return true;
    }
    return false;
}

DockEventData DockSensor::current() const {
    return DockEventData{stable_};
}
