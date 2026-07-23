#pragma once

#include <NimBLEDevice.h>
#include "SensorData.h"

class BleManager {
public:
    void begin();
    void notifyAudio(const AudioLevelData& data);
    void notifyMotion(const MotionEventData& data);
    void notifyEnvironment(const EnvironmentData& data);
    void notifyDock(const DockEventData& data);
    bool isConnected() const;

private:
    NimBLEServer* server_ = nullptr;
    NimBLECharacteristic* audioChar_ = nullptr;
    NimBLECharacteristic* motionChar_ = nullptr;
    NimBLECharacteristic* envChar_ = nullptr;
    NimBLECharacteristic* dockChar_ = nullptr;
};
