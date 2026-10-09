#include "UptimeLog.h"

#include <Arduino.h>

namespace {
constexpr const char* NVS_NAMESPACE = "uptime";
constexpr const char* KEY_CURRENT = "current";
constexpr const char* KEY_PREVIOUS = "previous";
constexpr uint32_t MS_PER_MINUTE = 60000;
}  // namespace

void UptimeLog::begin() {
    prefs_.begin(NVS_NAMESPACE, false);

    // 前回の起動で記録された稼働時間を「前回」として残し、今回の記録を0から始める
    uint32_t lastRun = prefs_.getUInt(KEY_CURRENT, 0);
    if (lastRun > 0) {
        prefs_.putUInt(KEY_PREVIOUS, lastRun);
    }
    previousMinutes_ = prefs_.getUInt(KEY_PREVIOUS, 0);
    prefs_.putUInt(KEY_CURRENT, 0);

    Serial.printf("[E5] 前回の稼働時間：%lu分（約%.1f時間）\n", static_cast<unsigned long>(previousMinutes_),
                  previousMinutes_ / 60.0);
    Serial.println("[E5] 今回の稼働時間の記録を始めます（1分ごとに保存）");
}

void UptimeLog::update(uint32_t nowMs) {
    uint32_t minute = nowMs / MS_PER_MINUTE;
    if (minute == lastSavedMinute_) {
        return;
    }
    lastSavedMinute_ = minute;
    prefs_.putUInt(KEY_CURRENT, minute);
    Serial.printf("[E5] 稼働 %lu分（前回 %lu分）\n", static_cast<unsigned long>(minute),
                  static_cast<unsigned long>(previousMinutes_));
}
