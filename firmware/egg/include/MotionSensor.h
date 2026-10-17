#pragma once

#include "SensorData.h"

// 加速度センサー（MPU-6050、I2C）
class MotionSensor {
public:
    void begin();

    // 今の値を読む。I2C の読み取りに失敗したら false（out は変えない）
    bool read(MotionEventData& out);

    // 前回の値からの変化が MOTION_THRESHOLD を超えたら true を返し、out に今の値を入れる。
    // 読み取りに失敗したときは false で、前回の値も変えない（誤って寝返りを数えないため。Issue #32）
    bool checkThresholdEvent(MotionEventData& out);

private:
    MotionEventData lastReading_ = {0, 0, 0};
    bool hasLastReading_ = false;
};
