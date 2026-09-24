// E3：充電検知（巣に置いた・取り出した）の確認（docs/hw-verification.md）
//   pio run -e hwtest_dock -t upload -t monitor
//
// 充電モジュール（MCP73831）の STAT ピンを1msごとに読み、次を表示する。
//   ・ピンが変化した瞬間（チャタリングも1回ずつ数える）
//   ・200ms 安定したあとの判定（本番と同じデバウンス時間）
//   ・2秒ごとの状態
// STAT は「充電中＝LOW」「充電していない＝HIGH（プルアップ）」。満充電のときも HIGH になるので、
// 「巣に置いたまま満充電になったとき」「満充電で巣に置いたとき」にどう表示されるかを必ず確認する。
//
// 巣からの 5V を分圧して ADC で読む回路を試す場合は、platformio.ini の hwtest_dock に
//   build_flags = ${env.build_flags} -D VIN_SENSE_PIN=35 -D VIN_DIVIDER_RATIO=2.0
// のように追加すると、その電圧も表示する（VIN_DIVIDER_RATIO は 分圧前の電圧 ÷ ピンの電圧）。
//
// シリアルモニタで入力できるコマンド：r … 回数をリセット
#include <Arduino.h>

#include "PinConfig.h"

#ifndef VIN_SENSE_PIN
#define VIN_SENSE_PIN -1
#endif
#ifndef VIN_DIVIDER_RATIO
#define VIN_DIVIDER_RATIO 2.0f
#endif

namespace {

constexpr uint32_t STATUS_INTERVAL_MS = 2000;
constexpr float VIN_PRESENT_VOLTS = 4.0f;  // これ以上なら「巣から給電されている」とみなす

int rawLevel = HIGH;
int stableLevel = HIGH;
uint32_t lastRawChangeMs = 0;
uint32_t rawEdgesSinceStable = 0;
uint32_t dockCount = 0;
uint32_t undockCount = 0;
uint32_t lastStatusMs = 0;
String command;

const char* describe(int level) {
    return level == LOW ? "LOW（充電中＝巣にある）" : "HIGH（充電していない＝巣にない or 満充電）";
}

float readVinVolts() {
    if (VIN_SENSE_PIN < 0) {
        return -1;
    }
    return analogReadMilliVolts(VIN_SENSE_PIN) / 1000.0f * VIN_DIVIDER_RATIO;
}

void printStatus(uint32_t now) {
    Serial.printf("t=%7.1fs  STAT=%s  巣に置いた=%lu回 取り出した=%lu回", now / 1000.0, describe(stableLevel),
                  static_cast<unsigned long>(dockCount), static_cast<unsigned long>(undockCount));
    float vin = readVinVolts();
    if (vin >= 0) {
        Serial.printf("  VIN=%.2fV（%s）", vin, vin >= VIN_PRESENT_VOLTS ? "巣から給電あり" : "給電なし");
    }
    Serial.println();
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
    pinMode(DOCK_STAT_PIN, INPUT_PULLUP);
    rawLevel = stableLevel = digitalRead(DOCK_STAT_PIN);
    Serial.printf("\n[E3] 充電検知の確認（STAT=GPIO%d、デバウンス=%lums）\n", DOCK_STAT_PIN,
                  static_cast<unsigned long>(DOCK_DEBOUNCE_MS));
    if (VIN_SENSE_PIN >= 0) {
        Serial.printf("VIN の検知：GPIO%d（分圧比 %.2f）\n", VIN_SENSE_PIN, VIN_DIVIDER_RATIO);
    }
    Serial.printf("起動時の状態：%s\n", describe(stableLevel));
    Serial.println("巣に置く／取り出すを10回ずつ行い、毎回1回だけ判定が出るか確認してください。");
}

void loop() {
    readSerialCommand();
    uint32_t now = millis();

    int level = digitalRead(DOCK_STAT_PIN);
    if (level != rawLevel) {
        rawLevel = level;
        lastRawChangeMs = now;
        ++rawEdgesSinceStable;
        Serial.printf("  (ピン変化) t=%.3fs → %s\n", now / 1000.0, level == LOW ? "LOW" : "HIGH");
    }

    if (rawLevel != stableLevel && now - lastRawChangeMs >= DOCK_DEBOUNCE_MS) {
        stableLevel = rawLevel;
        if (stableLevel == LOW) {
            ++dockCount;
            Serial.printf("【判定】巣に置いた（充電開始） #%lu", static_cast<unsigned long>(dockCount));
        } else {
            ++undockCount;
            Serial.printf("【判定】取り出した（充電停止） #%lu", static_cast<unsigned long>(undockCount));
        }
        Serial.printf("  ※ 確定までのピン変化=%lu回（2回以上ならチャタリングあり）\n",
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
