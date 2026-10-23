#pragma once

#include <NimBLEDevice.h>
#include "SensorData.h"

// たまご → 鶏の BLE（Peripheral）。docs/ble-protocol.md
class BleManager {
public:
    // initialDock：起動したときの充電の状態（鶏がつないだときに Read で読めるよう、最初から値を入れておく）
    void begin(const DockEventData& initialDock);
    void notifyAudio(const AudioLevelData& data);
    void notifyMotion(const MotionEventData& data);
    void notifyDock(const DockEventData& data);
    // バッテリー残量（%）。BATTERY_ADC_PIN を設定したときだけ有効
    void notifyBattery(uint8_t percent);
    bool isConnected() const;

private:
    void setAndNotify(NimBLECharacteristic* characteristic, const uint8_t* data, size_t length);

    NimBLEServer* server_ = nullptr;
    NimBLECharacteristic* audioChar_ = nullptr;
    NimBLECharacteristic* motionChar_ = nullptr;
    NimBLECharacteristic* dockChar_ = nullptr;
    NimBLECharacteristic* batteryChar_ = nullptr;
};
