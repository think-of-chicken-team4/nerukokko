#pragma once

#include <cstdint>

// バッテリー残量（分圧した電池の電圧を ADC で読む）。BATTERY_ADC_PIN が -1 なら何もしない（F-09・E5）
class BatterySensor {
public:
    void begin();
    bool enabled() const;
    // 0〜100（%）
    uint8_t readPercent();
};
