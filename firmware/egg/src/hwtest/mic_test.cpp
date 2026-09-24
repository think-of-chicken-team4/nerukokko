// E2：たまごのマイク（PDM）の音量レベルの測定（docs/hw-verification.md）
//   pio run -e hwtest_mic -t upload -t monitor
//
// 本番と同じ AudioSensor で、約0.3秒ごとの音量レベルを表示する。
// 状況に合わせてラベルを切り替え、最後に s でラベルごとの集計を出して Issue #6 に貼ってください。
//
// シリアルモニタで入力できるコマンド（入力して Enter）
//   1 … ラベル「静か」   2 … ラベル「話し声」   3 … ラベル「いびき」   0 … ラベルなし
//   s … ラベルごとの集計（件数・最小・10%・中央値・90%・最大）を表示
//   r … 集計をリセット
#include <Arduino.h>

#include <algorithm>
#include <vector>

#include "AudioSensor.h"
#include "PinConfig.h"

namespace {

constexpr uint32_t SUMMARY_INTERVAL_MS = 10000;
constexpr size_t MAX_SAMPLES_PER_LABEL = 3000;  // 約15分ぶん
constexpr int LABEL_COUNT = 4;
const char* const LABEL_NAMES[LABEL_COUNT] = {"ラベルなし", "静か", "話し声", "いびき"};

AudioSensor audioSensor;
int currentLabel = 0;
std::vector<uint16_t> samples[LABEL_COUNT];
std::vector<uint16_t> recent;  // 直近10秒ぶん
uint32_t lastReadMs = 0;
uint32_t lastSummaryMs = 0;
String command;

uint16_t percentile(std::vector<uint16_t> values, int percent) {
    if (values.empty()) {
        return 0;
    }
    std::sort(values.begin(), values.end());
    size_t index = (values.size() - 1) * percent / 100;
    return values[index];
}

void printStats(const char* title, const std::vector<uint16_t>& values) {
    if (values.empty()) {
        Serial.printf("  %-8s : データなし\n", title);
        return;
    }
    Serial.printf("  %-8s : 件数=%4u  最小=%5u  10%%=%5u  中央値=%5u  90%%=%5u  最大=%5u\n", title,
                  static_cast<unsigned>(values.size()), percentile(values, 0), percentile(values, 10),
                  percentile(values, 50), percentile(values, 90), percentile(values, 100));
}

void handleCommand(const String& line) {
    if (line == "0" || line == "1" || line == "2" || line == "3") {
        currentLabel = line.toInt();
        Serial.printf("[ラベル] %s に切り替えました\n", LABEL_NAMES[currentLabel]);
    } else if (line == "s") {
        Serial.println("==== ラベルごとの集計（この結果を Issue に貼ってください）====");
        for (int label = 0; label < LABEL_COUNT; ++label) {
            printStats(LABEL_NAMES[label], samples[label]);
        }
    } else if (line == "r") {
        for (auto& values : samples) {
            values.clear();
        }
        Serial.println("[リセット] 集計を消しました");
    } else if (line.length() > 0) {
        Serial.println("コマンド：1=静か 2=話し声 3=いびき 0=ラベルなし s=集計 r=リセット");
    }
}

void readSerialCommand() {
    while (Serial.available() > 0) {
        char c = static_cast<char>(Serial.read());
        if (c == '\n' || c == '\r') {
            command.trim();
            handleCommand(command);
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
    Serial.printf("\n[E2] マイクの音量レベル（CLK=GPIO%d DATA=GPIO%d）\n", PDM_CLK_PIN, PDM_DATA_PIN);
    audioSensor.begin();
    Serial.println("1=静か 2=話し声 3=いびき でラベルを切り替えて、それぞれ30秒以上測ってください。");
}

void loop() {
    readSerialCommand();
    uint32_t now = millis();

    if (now - lastReadMs >= AUDIO_NOTIFY_INTERVAL_MS) {
        lastReadMs = now;
        uint16_t level = audioSensor.readLevel();
        if (samples[currentLabel].size() < MAX_SAMPLES_PER_LABEL) {
            samples[currentLabel].push_back(level);
        }
        recent.push_back(level);
        Serial.printf("t=%7.1fs  [%s]  level=%5u\n", now / 1000.0, LABEL_NAMES[currentLabel], level);
    }

    if (now - lastSummaryMs >= SUMMARY_INTERVAL_MS) {
        lastSummaryMs = now;
        printStats("直近10秒", recent);
        recent.clear();
    }
}
