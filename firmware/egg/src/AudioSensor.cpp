#include "AudioSensor.h"
#include "PinConfig.h"

#include <driver/i2s.h>
#include <cmath>

namespace {
constexpr i2s_port_t I2S_PORT = I2S_NUM_0;
constexpr int DMA_BUF_COUNT = 4;
constexpr int DMA_BUF_LEN = 256;
int16_t sampleBuffer[DMA_BUF_LEN];
} // namespace

void AudioSensor::begin() {
    i2s_config_t config = {};
    config.mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_PDM);
    config.sample_rate = AUDIO_SAMPLE_RATE_HZ;
    config.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
    config.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
    config.communication_format = I2S_COMM_FORMAT_STAND_I2S;
    config.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
    config.dma_buf_count = DMA_BUF_COUNT;
    config.dma_buf_len = DMA_BUF_LEN;

    i2s_driver_install(I2S_PORT, &config, 0, nullptr);

    i2s_pin_config_t pins = {};
    pins.ws_io_num = PDM_CLK_PIN;
    pins.data_in_num = PDM_DATA_PIN;
    pins.bck_io_num = I2S_PIN_NO_CHANGE;
    pins.data_out_num = I2S_PIN_NO_CHANGE;

    i2s_set_pin(I2S_PORT, &pins);
}

uint16_t AudioSensor::readLevel() {
    size_t bytesRead = 0;
    i2s_read(I2S_PORT, sampleBuffer, sizeof(sampleBuffer), &bytesRead, portMAX_DELAY);

    size_t sampleCount = bytesRead / sizeof(int16_t);
    if (sampleCount == 0) {
        return 0;
    }

    double sumSquares = 0.0;
    for (size_t i = 0; i < sampleCount; ++i) {
        double s = sampleBuffer[i];
        sumSquares += s * s;
    }
    double rms = std::sqrt(sumSquares / sampleCount);

    // int16振幅の実効値(0〜32767)をuint16レンジ(0〜65535)にスケーリング
    double scaled = rms * 2.0;
    if (scaled > 65535.0) {
        scaled = 65535.0;
    }
    return static_cast<uint16_t>(scaled);
}
