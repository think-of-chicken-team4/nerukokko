// E3：充電検知（巣に置いた・取り出した）の確認（docs/hw-verification.md）
//   pio run -e hwtest_dock -t upload -t monitor
//
// 巣からの 5V を分圧して ADC で読み（本番の DockSensor と同じ。PinConfig.h の DOCK_*）、次を表示する。
//   ・判定が変化した瞬間（チャタリングも1回ずつ数える）
//   ・DOCK_DEBOUNCE_MS 安定したあとの判定（本番と同じデバウンス時間）
//   ・2秒ごとの状態と、巣の電圧
// 満充電のときも 5V は来るので、「満充電の電池で巣に置いたとき」も検知できることを確認する。
//
// シリアルモニタで入力できるコマンド：r … 回数をリセット
#include <Arduino.h>

#include "PinConfig.h"

namespace {

constexpr uint32_t STATUS_INTERVAL_MS = 2000;

int rawLevel = HIGH;     // LOW = 巣にある、HIGH = 巣にない
int stableLevel = HIGH;
uint32_t lastRawChangeMs = 0;
uint32_t rawEdgesSinceStable = 0;
uint32_t dockCount = 0;
uint32_t undockCount = 0;
uint32_t lastStatusMs = 0;
String command;

float readDockVolts() {
    return analogReadMilliVolts(DOCK_VIN_PIN) / 1000.0f * DOCK_DIVIDER_RATIO;
}

int readDockLevel() {
    return readDockVolts() >= DOCK_PRESENT_VOLTS ? LOW : HIGH;
}

const char* describe(int level) {
    return level == LOW ? "巣にある（巣から給電あり）" : "巣にない（給電なし）";
}

void printStatus(uint32_t now) {
    Serial.printf("t=%7.1fs  %s  巣に置いた=%lu回 取り出した=%lu回  巣の電圧=%.2fV\n", now / 1000.0,
                  describe(stableLevel), static_cast<unsigned long>(dockCount),
                  static_cast<unsigned long>(undockCount), readDockVolts());
}

void readSerialCommand() {
    while (Serial.available() > 0) {
        char c = static_cast<char>(Serial.read());
        if (c == '\n' || c == '\r') {
            command.trim();
            if (command == "r") {
                dockCount = 0;
                undockCount = 0;
                Serial.println("[リセット] 回数を0にしました");
            }
            command = "";
        } else {
            command += c;
        }
    }
}

}  // namespace

void setup() {
    Serial.begin(115200);
    delay(500);
    analogSetPinAttenuation(DOCK_VIN_PIN, ADC_11db);
    rawLevel = stableLevel = readDockLevel();
    Serial.printf("\n[E3] 充電検知の確認（巣の 5V を GPIO%d で読む、分圧比 %.3f、%.1fV 以上で「巣にある」、デバウンス=%lums）\n",
                  DOCK_VIN_PIN, DOCK_DIVIDER_RATIO, DOCK_PRESENT_VOLTS, static_cast<unsigned long>(DOCK_DEBOUNCE_MS));
    Serial.printf("起動時の状態：%s\n", describe(stableLevel));
    Serial.println("巣に置く／取り出すを10回ずつ行い、毎回1回だけ判定が出るか確認してください。");
}

void loop() {
    readSerialCommand();
    uint32_t now = millis();

    int level = readDockLevel();
    if (level != rawLevel) {
        rawLevel = level;
        lastRawChangeMs = now;
        ++rawEdgesSinceStable;
        Serial.printf("  (判定の変化) t=%.3fs → %s\n", now / 1000.0, level == LOW ? "巣にある" : "巣にない");
    }

    if (rawLevel != stableLevel && now - lastRawChangeMs >= DOCK_DEBOUNCE_MS) {
        stableLevel = rawLevel;
        if (stableLevel == LOW) {
            ++dockCount;
            Serial.printf("【判定】巣に置いた #%lu", static_cast<unsigned long>(dockCount));
        } else {
            ++undockCount;
            Serial.printf("【判定】取り出した #%lu", static_cast<unsigned long>(undockCount));
        }
        Serial.printf("  ※ 確定までの変化=%lu回（2回以上ならチャタリングあり）\n",
                      static_cast<unsigned long>(rawEdgesSinceStable));
        rawEdgesSinceStable = 0;
    } else if (rawLevel == stableLevel && now - lastRawChangeMs >= DOCK_DEBOUNCE_MS) {
        rawEdgesSinceStable = 0;
    }

    if (now - lastStatusMs >= STATUS_INTERVAL_MS) {
        lastStatusMs = now;
        printStatus(now);
    }
    delay(1);
}
