// I2C スキャン：たまごの I2C バスにつながっている機器のアドレスを5秒ごとに一覧表示する。
//   配線の確認と、センサーの種類の見当をつけるために使う（docs/hw-verification.md E1）。
//   pio run -e hwtest_i2c_scan -t upload -t monitor
#include <Arduino.h>
#include <Wire.h>

#include "PinConfig.h"

namespace {

const char* guessDevice(uint8_t address) {
    switch (address) {
        case 0x68:
        case 0x69: return "MPU-6050 などの加速度・ジャイロセンサー";
        case 0x23:
        case 0x5C: return "BH1750 照度センサー";
        case 0x40: return "SHT20 / HTU21D / Si7021 温湿度センサー";
        case 0x44:
        case 0x45: return "SHT3x 温湿度センサー";
        case 0x38: return "AHT10 / AHT20 温湿度センサー";
        default: return "不明";
    }
}

}  // namespace

void setup() {
    Serial.begin(115200);
    delay(500);
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
    Serial.printf("\n[I2C スキャン] SDA=GPIO%d SCL=GPIO%d\n", I2C_SDA_PIN, I2C_SCL_PIN);
}

void loop() {
    int found = 0;
    Serial.println("---- スキャン開始 ----");
    for (uint8_t address = 0x08; address < 0x78; ++address) {
        Wire.beginTransmission(address);
        if (Wire.endTransmission() == 0) {
            Serial.printf("  0x%02X : %s\n", address, guessDevice(address));
            ++found;
        }
    }
    if (found == 0) {
        Serial.println("  見つかりません。配線（SDA/SCL/VCC/GND）と電源電圧を確認してください。");
    }
    Serial.printf("---- %d 台見つかりました（5秒後に再スキャン）----\n\n", found);
    delay(5000);
}
