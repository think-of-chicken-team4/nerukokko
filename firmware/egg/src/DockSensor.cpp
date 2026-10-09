#include "DockSensor.h"
#include "PinConfig.h"

#include <Arduino.h>

namespace {
volatile bool edgePending = false;
volatile uint8_t pendingLevel = 0;
volatile uint32_t lastEdgeMs = 0;

void IRAM_ATTR handleStatChange() {
    uint32_t now = millis();
    if (now - lastEdgeMs < DOCK_DEBOUNCE_MS) {
        return;
    }
    lastEdgeMs = now;

    // STATはオープンドレイン+プルアップ: LOW=充電中(docked=起床), HIGH=非充電(undocked=就寝開始)
    pendingLevel = (digitalRead(DOCK_STAT_PIN) == LOW) ? 1 : 0;
    edgePending = true;
}
} // namespace

void DockSensor::begin() {
    pinMode(DOCK_STAT_PIN, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(DOCK_STAT_PIN), handleStatChange, CHANGE);
}

bool DockSensor::pollEvent(DockEventData& out) {
    if (!edgePending) {
        return false;
    }

    noInterrupts();
    out.docked = pendingLevel;
    edgePending = false;
    interrupts();

    return true;
}
