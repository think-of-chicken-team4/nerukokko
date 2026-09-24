#pragma once

#include <Preferences.h>

#include <cstdint>

// E5：バッテリーの持ちを測るため、稼働時間（分）を1分ごとに内蔵フラッシュ（NVS）へ記録する。
// 電池が切れたあとに USB につないで起動すると、前回どれだけ動いていたかをシリアルに表示する。
// hwtest_battery 環境（-D NERUKOKKO_UPTIME_LOG）でだけ使う。
class UptimeLog {
public:
    void begin();
    void update(uint32_t nowMs);

private:
    Preferences prefs_;
    uint32_t previousMinutes_ = 0;
    uint32_t lastSavedMinute_ = 0;
};
