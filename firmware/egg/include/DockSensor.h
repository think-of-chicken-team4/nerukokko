#pragma once

#include "SensorData.h"

// 充電検知（MCP73831 の STAT ピン）。割り込みではなく loop() で読み、
// DOCK_DEBOUNCE_MS のあいだ同じ状態が続いたら確定する（ポゴピンの接触のゆれ対策。Issue #5）
class DockSensor {
public:
    void begin();

    // 状態が確定して変わったら true を返し、out に入れる
    bool pollEvent(DockEventData& out);

    // いま確定している状態（鶏がつなぎ直したときに読めるよう、BLE の値にも入れておく）
    DockEventData current() const;

private:
    uint8_t stable_ = 0;   // 1 = 巣にある（充電中）
    uint8_t candidate_ = 0;
    uint32_t candidateSinceMs_ = 0;
};
