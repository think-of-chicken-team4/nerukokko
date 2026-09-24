#include "EnvironmentSensor.h"
#include "PinConfig.h"

#include <Arduino.h>
#include <Wire.h>

namespace {
constexpr uint8_t CMD_TRIGGER_TEMP_NO_HOLD = 0xF3;
constexpr uint8_t CMD_TRIGGER_HUMIDITY_NO_HOLD = 0xF5;
constexpr uint32_t MEASURE_WAIT_MS = 85; // SHT20最大変換時間(14bit)に対する余裕

uint16_t readRawSht20(uint8_t command) {
    Wire.beginTransmission(SHT20_I2C_ADDR);
    Wire.write(command);
    Wire.endTransmission();

    delay(MEASURE_WAIT_MS);

    Wire.requestFrom(static_cast<int>(SHT20_I2C_ADDR), 3);
    if (Wire.available() < 3) {
        return 0;
    }
    uint8_t msb = Wire.read();
    uint8_t lsb = Wire.read();
    Wire.read(); // CRC(未検証)

    // 下位2bitはステータスビットのためマスク
    return (static_cast<uint16_t>(msb) << 8 | lsb) & 0xFFFC;
}
} // namespace

void EnvironmentSensor::begin() {
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
}

float EnvironmentSensor::readTemperature() {
    uint16_t raw = readRawSht20(CMD_TRIGGER_TEMP_NO_HOLD);
    return -46.85f + 175.72f * (static_cast<float>(raw) / 65536.0f);
}

float EnvironmentSensor::readHumidity() {
    uint16_t raw = readRawSht20(CMD_TRIGGER_HUMIDITY_NO_HOLD);
    return -6.0f + 125.0f * (static_cast<float>(raw) / 65536.0f);
}

uint16_t EnvironmentSensor::readLux() {
    int raw = analogRead(LUX_ANALOG_PIN); // 0-4095
    // SEN0097の特性に応じて要調整の簡易線形マッピング
    return static_cast<uint16_t>((raw * 65535L) / 4095);
}

EnvironmentData EnvironmentSensor::read() {
    EnvironmentData data;
    data.temperature = readTemperature();
    data.humidity = readHumidity();
    data.lux = readLux();
    return data;
}
