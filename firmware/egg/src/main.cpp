// たまご（ESP32）：寝返り（加速度）・音量（マイク）・充電（巣に置いた／取り出した）を鶏へ BLE で送る。
// 実機で調整する値は include/PinConfig.h に集めてある。docs/ble-protocol.md
#include <Arduino.h>

#include "AudioSensor.h"
#include "BatterySensor.h"
#include "BleManager.h"
#include "DockSensor.h"
#include "Log.h"
#include "MotionSensor.h"
#include "PinConfig.h"
#include "SensorData.h"

#ifdef NERUKOKKO_UPTIME_LOG
#include "hwtest/UptimeLog.h"  // E5：バッテリーの持ちの測定用（hwtest_battery 環境だけ）
#endif

namespace {
BleManager bleManager;
AudioSensor audioSensor;
MotionSensor motionSensor;
DockSensor dockSensor;
BatterySensor batterySensor;

uint32_t lastAudioNotifyMs = 0;
uint32_t lastMotionPollMs = 0;
uint32_t lastMotionFallbackMs = 0;
uint32_t lastBatteryNotifyMs = 0;

#ifdef NERUKOKKO_UPTIME_LOG
UptimeLog uptimeLog;
#endif
} // namespace

void setup() {
    Serial.begin(115200);

    audioSensor.begin();
    motionSensor.begin();
    dockSensor.begin();
    batterySensor.begin();
    bleManager.begin(dockSensor.current());

    LOGF("[Setup] 準備完了。NeruKokko-Tamago としてアドバタイズ中（巣に%s）\n", dockSensor.current().docked ? "ある" : "ない");

#ifdef NERUKOKKO_UPTIME_LOG
    uptimeLog.begin();
#endif
}

void loop() {
    uint32_t now = millis();

    if (now - lastAudioNotifyMs >= AUDIO_NOTIFY_INTERVAL_MS) {
        lastAudioNotifyMs = now;
        AudioLevelData audio{audioSensor.readLevel()};
        bleManager.notifyAudio(audio);
        LOGF("[Audio] level=%u\n", audio.level);
    }

    if (now - lastMotionPollMs >= MOTION_POLL_INTERVAL_MS) {
        lastMotionPollMs = now;
        MotionEventData motion;
        if (motionSensor.checkThresholdEvent(motion)) {
            bleManager.notifyMotion(motion);
            lastMotionFallbackMs = now;
            LOGF("[Motion] 動きあり x=%d y=%d z=%d\n", motion.x, motion.y, motion.z);
        } else if (now - lastMotionFallbackMs >= MOTION_FALLBACK_INTERVAL_MS) {
            lastMotionFallbackMs = now;
            if (motionSensor.read(motion)) {
                bleManager.notifyMotion(motion);
                LOGF("[Motion] 定期 x=%d y=%d z=%d\n", motion.x, motion.y, motion.z);
            } else {
                LOGF("[Motion] I2C の読み取りに失敗\n");
            }
        }
    }

    DockEventData dock;
    if (dockSensor.pollEvent(dock)) {
        bleManager.notifyDock(dock);
        LOGF("[Dock] %s\n", dock.docked ? "巣に置いた（起床）" : "巣から取り出した");
    }

    if (batterySensor.enabled() && now - lastBatteryNotifyMs >= BATTERY_NOTIFY_INTERVAL_MS) {
        lastBatteryNotifyMs = now;
        uint8_t percent = batterySensor.readPercent();
        bleManager.notifyBattery(percent);
        LOGF("[Battery] %u%%\n", percent);
    }

#ifdef NERUKOKKO_UPTIME_LOG
    uptimeLog.update(now);
#endif
}
