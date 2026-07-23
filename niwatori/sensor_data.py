"""たまごユニットから受信するバイナリ構造体のパース。

tamago/include/SensorData.h の #pragma pack(1) 構造体とバイト列を一致させること。
"""

from __future__ import annotations

import struct
from dataclasses import dataclass


@dataclass(frozen=True)
class AudioLevel:
    level: int  # 0-65535

    _FORMAT = "<H"

    @classmethod
    def from_bytes(cls, data: bytes) -> "AudioLevel":
        (level,) = struct.unpack(cls._FORMAT, data)
        return cls(level=level)


@dataclass(frozen=True)
class MotionEvent:
    x: int
    y: int
    z: int

    _FORMAT = "<hhh"

    @classmethod
    def from_bytes(cls, data: bytes) -> "MotionEvent":
        x, y, z = struct.unpack(cls._FORMAT, data)
        return cls(x=x, y=y, z=z)


@dataclass(frozen=True)
class Environment:
    temperature: float  # °C
    humidity: float  # %RH
    lux: int

    _FORMAT = "<ffH"

    @classmethod
    def from_bytes(cls, data: bytes) -> "Environment":
        temperature, humidity, lux = struct.unpack(cls._FORMAT, data)
        return cls(temperature=temperature, humidity=humidity, lux=lux)


@dataclass(frozen=True)
class DockEvent:
    docked: bool  # False = undocked(就寝開始), True = docked(起床)

    _FORMAT = "<B"

    @classmethod
    def from_bytes(cls, data: bytes) -> "DockEvent":
        (docked,) = struct.unpack(cls._FORMAT, data)
        return cls(docked=bool(docked))
