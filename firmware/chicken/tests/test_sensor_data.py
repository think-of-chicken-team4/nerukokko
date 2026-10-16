import struct

import pytest

from sensor_data import AudioLevel, MotionEvent, Environment, DockEvent


def test_audio_level_from_bytes():
    data = struct.pack("<H", 4660)

    result = AudioLevel.from_bytes(data)

    assert result.level == 4660


def test_motion_event_from_bytes():
    data = struct.pack("<hhh", 100, -200, 300)

    result = MotionEvent.from_bytes(data)

    assert result.x == 100
    assert result.y == -200
    assert result.z == 300


def test_environment_from_bytes():
    data = struct.pack("<ffH", 25.5, 60.0, 120)

    result = Environment.from_bytes(data)

    assert result.temperature == pytest.approx(25.5)
    assert result.humidity == pytest.approx(60.0)
    assert result.lux == 120


def test_dock_event_from_bytes():
    result_undocked = DockEvent.from_bytes(struct.pack("<B", 0))
    result_docked = DockEvent.from_bytes(struct.pack("<B", 1))

    assert result_undocked.docked is False
    assert result_docked.docked is True

def test_audio_level_rejects_invalid_length():
    with pytest.raises(struct.error):
        AudioLevel.from_bytes(b"\x01")


def test_motion_event_rejects_invalid_length():
    with pytest.raises(struct.error):
        MotionEvent.from_bytes(b"\x01\x02")


def test_environment_rejects_invalid_length():
    with pytest.raises(struct.error):
        Environment.from_bytes(b"\x01\x02")


def test_dock_event_rejects_invalid_length():
    with pytest.raises(struct.error):
        DockEvent.from_bytes(b"")
