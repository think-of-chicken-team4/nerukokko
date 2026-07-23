#include <Arduino.h>

#include "PinConfig.h"
#include "SensorData.h"
#include "BleManager.h"
#include "AudioSensor.h"
#include "MotionSensor.h"
#include "EnvironmentSensor.h"
#include "DockSensor.h"

namespace {
BleManager bleManager;
AudioSensor audioSensor;
MotionSensor motionSensor;
EnvironmentSensor environmentSensor;
DockSensor dockSensor;

uint32_t lastAudioNotifyMs = 0;
uint32_t lastMotionPollMs = 0;
uint32_t lastMotionFallbackMs = 0;
uint32_t lastEnvNotifyMs = 0;
} // namespace

void setup() {
    Serial.begin(115200);

    audioSensor.begin();
    motionSensor.begin();
    environmentSensor.begin();
    dockSensor.begin();
    bleManager.begin();
}

void loop() {
    uint32_t now = millis();

    if (now - lastAudioNotifyMs >= AUDIO_NOTIFY_INTERVAL_MS) {
        lastAudioNotifyMs = now;
        AudioLevelData audio{audioSensor.readLevel()};
        bleManager.notifyAudio(audio);
    }

    if (now - lastMotionPollMs >= MOTION_POLL_INTERVAL_MS) {
        lastMotionPollMs = now;
        MotionEventData motion;
        if (motionSensor.checkThresholdEvent(motion)) {
            bleManager.notifyMotion(motion);
            lastMotionFallbackMs = now;
        } else if (now - lastMotionFallbackMs >= MOTION_FALLBACK_INTERVAL_MS) {
            lastMotionFallbackMs = now;
            bleManager.notifyMotion(motionSensor.read());
        }
    }

    if (now - lastEnvNotifyMs >= ENV_NOTIFY_INTERVAL_MS) {
        lastEnvNotifyMs = now;
        bleManager.notifyEnvironment(environmentSensor.read());
    }

    DockEventData dock;
    if (dockSensor.pollEvent(dock)) {
        bleManager.notifyDock(dock);
    }
}
