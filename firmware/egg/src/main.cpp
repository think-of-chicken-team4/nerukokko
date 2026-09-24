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

    Serial.println("[Setup] complete. Advertising as NeruKokko-Tamago.");
}

void loop() {
    uint32_t now = millis();

    if (now - lastAudioNotifyMs >= AUDIO_NOTIFY_INTERVAL_MS) {
        lastAudioNotifyMs = now;
        AudioLevelData audio{audioSensor.readLevel()};
        bleManager.notifyAudio(audio);
        Serial.printf("[Audio] level=%u\n", audio.level);
    }

    if (now - lastMotionPollMs >= MOTION_POLL_INTERVAL_MS) {
        lastMotionPollMs = now;
        MotionEventData motion;
        if (motionSensor.checkThresholdEvent(motion)) {
            bleManager.notifyMotion(motion);
            lastMotionFallbackMs = now;
            Serial.printf("[Motion] threshold event x=%d y=%d z=%d\n", motion.x, motion.y, motion.z);
        } else if (now - lastMotionFallbackMs >= MOTION_FALLBACK_INTERVAL_MS) {
            lastMotionFallbackMs = now;
            MotionEventData fallback = motionSensor.read();
            bleManager.notifyMotion(fallback);
            Serial.printf("[Motion] fallback x=%d y=%d z=%d\n", fallback.x, fallback.y, fallback.z);
        }
    }

    if (now - lastEnvNotifyMs >= ENV_NOTIFY_INTERVAL_MS) {
        lastEnvNotifyMs = now;
        EnvironmentData env = environmentSensor.read();
        bleManager.notifyEnvironment(env);
        Serial.printf("[Environment] temp=%.2f humidity=%.2f lux=%u\n", env.temperature, env.humidity, env.lux);
    }

    DockEventData dock;
    if (dockSensor.pollEvent(dock)) {
        bleManager.notifyDock(dock);
        Serial.printf("[Dock] docked=%u\n", dock.docked);
    }
}
