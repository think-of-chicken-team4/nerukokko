"""A111ミリ波レーダーによる呼吸検知。

acconeer-exptool の acconeer.exptool.a111.algo.breathing
(仕様書で言及されている sleep_breathing はパッケージ側で breathing に改名されている)
の公式アルゴリズムで呼吸数を出し、radar_filter.BreathingFilter で
「人がいて呼吸しているときだけ」採用する（何もなくても呼吸数を出してしまうため。Issue #16）。
"""

from __future__ import annotations

import logging
import re
import threading
import time
from typing import List, Optional, Tuple

import acconeer.exptool as et
import numpy as np
from acconeer.exptool.a111.algo.breathing import (
    Processor,
    ProcessingConfiguration,
    get_sensor_config,
)

import integration_config as config
from radar_filter import BreathingFilter, RadarFilterConfig

logger = logging.getLogger(__name__)

_BPM_PATTERN = re.compile(r"BPM ([\d.]+)")


class RadarSensor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest_bpm: Optional[float] = None
        self._present = False
        # (時刻 UTC の epoch 秒, "in_bed" | "out_of_bed")。presence_events として送る（F-03）
        self._presence_changes: List[Tuple[float, str]] = []
        self._filter = BreathingFilter(
            RadarFilterConfig(
                presence_env_max=config.RADAR_PRESENCE_ENV_MAX,
                breathing_std_mm=config.RADAR_BREATHING_STD_MM,
                window_sec=config.RADAR_WINDOW_SEC,
                presence_hold_sec=config.RADAR_PRESENCE_HOLD_SEC,
            )
        )
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="RadarSensor", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def get_latest_breathing_rate(self) -> Optional[float]:
        """人がいて呼吸しているときの呼吸数。そうでなければ None"""
        with self._lock:
            return self._latest_bpm

    def is_present(self) -> bool:
        """レーダーの前（ベッド）に人がいるか"""
        with self._lock:
            return self._present

    def pop_presence_changes(self) -> List[Tuple[float, str]]:
        """前回呼んでから「いる／いない」が変わった記録を取り出す（在床・離床のイベント）"""
        with self._lock:
            changes, self._presence_changes = self._presence_changes, []
            return changes

    def _run(self) -> None:
        client_kwargs = {"mock": config.RADAR_USE_MOCK}
        if not config.RADAR_USE_MOCK:
            client_kwargs["link"] = config.RADAR_LINK
            if config.RADAR_LINK == "socket":
                client_kwargs["host"] = config.RADAR_HOST
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

                self._handle(processed)
        except Exception:
            logger.exception("A111レーダー処理でエラーが発生しました。")
        finally:
            client.disconnect()

    def _handle(self, processed: dict) -> None:
        """掃引1回分の処理結果をフィルタに通して、呼吸数と在床の状態を更新する"""
        env_ampl = processed.get("env_ampl")
        if env_ampl is None:
            return
        env_max = float(np.max(env_ampl))
        raw_std = processed.get("peak_std_mm")
        peak_std_mm = float(raw_std) if raw_std is not None else None
        bpm = self._parse_bpm(processed.get("breathing_text"))

        reading = self._filter.update(time.monotonic(), env_max, peak_std_mm, bpm)
        with self._lock:
            self._latest_bpm = reading.bpm
            self._present = reading.present
            if reading.presence_changed:
                state = "in_bed" if reading.present else "out_of_bed"
                self._presence_changes.append((time.time(), state))
                logger.info("レーダー：%s", "在床" if reading.present else "離床")

    @staticmethod
    def _parse_bpm(text: Optional[str]) -> Optional[float]:
        if not text:
            return None
        match = _BPM_PATTERN.search(text)
        if not match:
            return None
        return float(match.group(1))
