#pragma once

#include "SensorData.h"

class EnvironmentSensor {
public:
    void begin();
    EnvironmentData read();

private:
    float readTemperature();
    float readHumidity();
    uint16_t readLux();
};
