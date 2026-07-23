#pragma once

#include <cstdint>

#pragma pack(push, 1)

struct AudioLevelData {
    uint16_t level; // 0-65535
};
static_assert(sizeof(AudioLevelData) == 2, "AudioLevelData must be 2 bytes");

struct MotionEventData {
    int16_t x;
    int16_t y;
    int16_t z;
};
static_assert(sizeof(MotionEventData) == 6, "MotionEventData must be 6 bytes");

struct EnvironmentData {
    float temperature; // °C
    float humidity;    // %RH
    uint16_t lux;
};
static_assert(sizeof(EnvironmentData) == 10, "EnvironmentData must be 10 bytes");

struct DockEventData {
    uint8_t docked; // 0 = undocked(就寝開始), 1 = docked(起床)
};
static_assert(sizeof(DockEventData) == 1, "DockEventData must be 1 byte");

#pragma pack(pop)
