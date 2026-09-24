#pragma once

#include "SensorData.h"

class DockSensor {
public:
    void begin();

    // 未処理のエッジイベントがあればtrueを返しoutに格納する(イベント駆動)
    bool pollEvent(DockEventData& out);
};
