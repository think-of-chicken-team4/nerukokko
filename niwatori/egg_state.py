"""たまごユニットからのBLE Notify受信データの最新値を保持する。"""

from __future__ import annotations

import threading
from typing import Optional

from sensor_data import AudioLevel, DockEvent, Environment, MotionEvent


class EggState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._audio: Optional[AudioLevel] = None
        self._motion: Optional[MotionEvent] = None
        self._environment: Optional[Environment] = None
        self._dock: Optional[DockEvent] = None

    def update_audio(self, data: AudioLevel) -> None:
        with self._lock:
            self._audio = data

    def update_motion(self, data: MotionEvent) -> None:
        with self._lock:
            self._motion = data

    def update_environment(self, data: Environment) -> None:
        with self._lock:
            self._environment = data

    def update_dock(self, data: DockEvent) -> None:
        with self._lock:
            self._dock = data

    def snapshot(self) -> dict:
        """統合レコード用のスナップショットを返す。

        dock_eventはイベント駆動のため、取得後にクリアし次回以降はnullとする。
        """
        with self._lock:
            snap = {
                "audio_level": self._audio.level if self._audio else None,
                "motion": (
                    {"x": self._motion.x, "y": self._motion.y, "z": self._motion.z}
                    if self._motion
                    else None
                ),
                "temperature": self._environment.temperature if self._environment else None,
                "humidity": self._environment.humidity if self._environment else None,
                "lux": self._environment.lux if self._environment else None,
                "dock_event": int(self._dock.docked) if self._dock else None,
            }
            self._dock = None
            return snap
