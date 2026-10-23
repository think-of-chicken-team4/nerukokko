#include "DockSensor.h"
#include "PinConfig.h"

#include <Arduino.h>

namespace {
// STAT はオープンドレイン＋プルアップ：LOW = 充電中（巣にある＝起床）、HIGH = 充電していない（巣から出た）
uint8_t readDocked() {
    return digitalRead(DOCK_STAT_PIN) == LOW ? 1 : 0;
}
} // namespace

void DockSensor::begin() {
    pinMode(DOCK_STAT_PIN, INPUT_PULLUP);
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
