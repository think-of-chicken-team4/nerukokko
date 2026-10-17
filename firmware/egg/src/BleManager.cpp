#include "BleManager.h"
#include "BleConfig.h"
#include "Log.h"
#include "PinConfig.h"

namespace {

class ServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* server) override {
        LOGF("[BLE] 鶏とつながった\n");
    }

    void onDisconnect(NimBLEServer* server) override {
        LOGF("[BLE] 切れた。アドバタイズを再開\n");
        NimBLEDevice::startAdvertising();
    }
};

ServerCallbacks serverCallbacks;

} // namespace

void BleManager::begin(const DockEventData& initialDock) {
    NimBLEDevice::init(NERUKOKKO_DEVICE_NAME);

    server_ = NimBLEDevice::createServer();
    server_->setCallbacks(&serverCallbacks);

    NimBLEService* service = server_->createService(NERUKOKKO_SERVICE_UUID);
    audioChar_ = service->createCharacteristic(NERUKOKKO_CHAR_AUDIO_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
    motionChar_ = service->createCharacteristic(NERUKOKKO_CHAR_MOTION_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
    dockChar_ = service->createCharacteristic(NERUKOKKO_CHAR_DOCK_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
    // 鶏は、つないだときと定期的に Dock を Read して、Notify の取りこぼしを補う（Issue #5）
    dockChar_->setValue(reinterpret_cast<const uint8_t*>(&initialDock), sizeof(initialDock));
    service->start();

    if (BATTERY_ADC_PIN >= 0) {
        NimBLEService* battery = server_->createService(BLE_BATTERY_SERVICE_UUID);
        batteryChar_ = battery->createCharacteristic(BLE_BATTERY_LEVEL_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
        battery->start();
    }

    NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
    advertising->addServiceUUID(NERUKOKKO_SERVICE_UUID);
    advertising->setScanResponse(true);
    NimBLEDevice::startAdvertising();
}

bool BleManager::isConnected() const {
    return server_ != nullptr && server_->getConnectedCount() > 0;
}

void BleManager::setAndNotify(NimBLECharacteristic* characteristic, const uint8_t* data, size_t length) {
    if (characteristic == nullptr) {
        return;
    }
    characteristic->setValue(data, length);
    if (isConnected()) {
        characteristic->notify();
    }
}

void BleManager::notifyAudio(const AudioLevelData& data) {
    setAndNotify(audioChar_, reinterpret_cast<const uint8_t*>(&data), sizeof(data));
}

void BleManager::notifyMotion(const MotionEventData& data) {
    setAndNotify(motionChar_, reinterpret_cast<const uint8_t*>(&data), sizeof(data));
}

void BleManager::notifyDock(const DockEventData& data) {
    setAndNotify(dockChar_, reinterpret_cast<const uint8_t*>(&data), sizeof(data));
}

void BleManager::notifyBattery(uint8_t percent) {
    setAndNotify(batteryChar_, &percent, sizeof(percent));
}
