#pragma once

#include "SensorData.h"

class MotionSensor {
public:
    void begin();

    // 現在値を読み取る(定期送信用)
    MotionEventData read();

    // 前回読み取り値との差分が閾値を超えていればtrueを返し、outに現在値を格納する
    bool checkThresholdEvent(MotionEventData& out);

private:
    MotionEventData lastReading_ = {0, 0, 0};
};
