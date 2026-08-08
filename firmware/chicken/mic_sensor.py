"""SPH0645LM4H I2Sマイク(鶏本体)の音量レベル取得。"""

from __future__ import annotations

import logging
import threading
from typing import Optional

import numpy as np
import sounddevice as sd

import integration_config as config

logger = logging.getLogger(__name__)


class MicSensor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest_level: Optional[int] = None
        self._stream: Optional[sd.InputStream] = None

    def start(self) -> None:
        self._stream = sd.InputStream(
            device=config.MIC_DEVICE,
            channels=1,
            samplerate=config.MIC_SAMPLE_RATE,
            blocksize=config.MIC_BLOCK_SIZE,
            dtype="int16",
            callback=self._on_audio,
        )
        self._stream.start()

    def stop(self) -> None:
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()

    def get_latest_level(self) -> Optional[int]:
        with self._lock:
            return self._latest_level

    def _on_audio(self, indata, frames, time_info, status) -> None:
        if status:
            logger.warning("マイク入力ステータス: %s", status)

        samples = indata[:, 0].astype(np.float64)
        rms = float(np.sqrt(np.mean(samples**2))) if len(samples) else 0.0
        scaled = min(rms * 2.0, 65535.0)

        with self._lock:
            self._latest_level = int(scaled)
