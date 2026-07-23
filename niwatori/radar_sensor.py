"""A111ミリ波レーダーによる呼吸検知。

acconeer-exptool の acconeer.exptool.a111.algo.breathing
(仕様書で言及されている sleep_breathing はパッケージ側で breathing に改名されている)
の公式アルゴリズムをそのまま使用する。
"""

from __future__ import annotations

import logging
import re
import threading
from typing import Optional

import acconeer.exptool as et
from acconeer.exptool.a111.algo.breathing import (
    Processor,
    ProcessingConfiguration,
    get_sensor_config,
)

import integration_config as config

logger = logging.getLogger(__name__)

_BPM_PATTERN = re.compile(r"BPM ([\d.]+)")


class RadarSensor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest_bpm: Optional[float] = None
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="RadarSensor", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def get_latest_breathing_rate(self) -> Optional[float]:
        with self._lock:
            return self._latest_bpm

    def _run(self) -> None:
        client_kwargs = {"mock": config.RADAR_USE_MOCK}
        if not config.RADAR_USE_MOCK:
            client_kwargs["link"] = config.RADAR_LINK
            if config.RADAR_LINK == "uart" and config.RADAR_SERIAL_PORT:
                client_kwargs["serial_port"] = config.RADAR_SERIAL_PORT

        client = et.a111.Client(**client_kwargs)

        sensor_config = get_sensor_config()
        sensor_config.sensor = [config.RADAR_SENSOR_ID]
        processing_config = ProcessingConfiguration()

        try:
            session_info = client.setup_session(sensor_config)
            client.start_session()
            processor = Processor(sensor_config, processing_config, session_info)

            while not self._stop_event.is_set():
                info, sweep = client.get_next()
                processed = processor.process(sweep, info)
                if processed is None:
                    continue

                bpm = self._parse_bpm(processed.get("breathing_text"))
                if bpm is not None:
                    with self._lock:
                        self._latest_bpm = bpm
        except Exception:
            logger.exception("A111レーダー処理でエラーが発生しました。")
        finally:
            client.disconnect()

    @staticmethod
    def _parse_bpm(text: Optional[str]) -> Optional[float]:
        if not text:
            return None
        match = _BPM_PATTERN.search(text)
        if not match:
            return None
        return float(match.group(1))
