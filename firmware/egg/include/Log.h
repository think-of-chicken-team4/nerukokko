#pragma once

// 検証用のシリアル出力。本番（esp32dev）では何も出さず、esp32dev_debug などで -D NERUKOKKO_DEBUG_LOG を付けたときだけ出す（Issue #34）
#include <Arduino.h>

#ifdef NERUKOKKO_DEBUG_LOG
#define LOGF(...) Serial.printf(__VA_ARGS__)
#else
#define LOGF(...) \
    do {          \
    } while (0)
#endif
