#pragma once

#include <cstdint>

class AudioSensor {
public:
    void begin();
    uint16_t readLevel();
};
