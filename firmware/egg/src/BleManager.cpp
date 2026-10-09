#include "BleManager.h"
#include "BleConfig.h"

namespace {

class ServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* server) override {
        // 鶏側は1台のみ接続想定。切断時のみ再アドバタイズする。
    }

    void onDisconnect(NimBLEServer* server) override {
        NimBLEDevice::startAdvertising();
    }
};

ServerCallbacks serverCallbacks;

} // namespace

void BleManager::begin() {
    NimBLEDevice::init(NERUKOKKO_DEVICE_NAME);

    server_ = NimBLEDevice::createServer();
    server_->setCallbacks(&serverCallbacks);

    NimBLEService* service = server_->createService(NERUKOKKO_SERVICE_UUID);

    audioChar_ = service->createCharacteristic(
        NERUKOKKO_CHAR_AUDIO_UUID,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

    motionChar_ = service->createCharacteristic(
        NERUKOKKO_CHAR_MOTION_UUID,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

    envChar_ = service->createCharacteristic(
        NERUKOKKO_CHAR_ENV_UUID,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

    dockChar_ = service->createCharacteristic(
        NERUKOKKO_CHAR_DOCK_UUID,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

    service->start();

    NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
    advertising->addServiceUUID(NERUKOKKO_SERVICE_UUID);
    advertising->setScanResponse(true);
    NimBLEDevice::startAdvertising();
}

bool BleManager::isConnected() const {
    return server_ != nullptr && server_->getConnectedCount() > 0;
}

void BleManager::notifyAudio(const AudioLevelData& data) {
    audioChar_->setValue(reinterpret_cast<const uint8_t*>(&data), sizeof(data));
    if (isConnected()) {
        audioChar_->notify();
    }
}

void BleManager::notifyMotion(const MotionEventData& data) {
    motionChar_->setValue(reinterpret_cast<const uint8_t*>(&data), sizeof(data));
    if (isConnected()) {
        motionChar_->notify();
    }
}

void BleManager::notifyEnvironment(const EnvironmentData& data) {
    envChar_->setValue(reinterpret_cast<const uint8_t*>(&data), sizeof(data));
    if (isConnected()) {
        envChar_->notify();
    }
}

void BleManager::notifyDock(const DockEventData& data) {
    dockChar_->setValue(reinterpret_cast<const uint8_t*>(&data), sizeof(data));
    if (isConnected()) {
        dockChar_->notify();
    }
}
