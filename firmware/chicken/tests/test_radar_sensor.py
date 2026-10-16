import pytest

from radar_sensor import RadarSensor


def test_parse_bpm_integer():
    assert RadarSensor._parse_bpm("BPM 15") == 15.0


def test_parse_bpm_decimal():
    assert RadarSensor._parse_bpm("BPM 15.5") == 15.5


def test_parse_bpm_returns_none_for_empty_text():
    assert RadarSensor._parse_bpm(None) is None
    assert RadarSensor._parse_bpm("") is None


def test_parse_bpm_returns_none_without_bpm():
    assert RadarSensor._parse_bpm("No breathing detected") is None

def test_latest_breathing_rate_initially_none():
    sensor = RadarSensor()

    assert sensor.get_latest_breathing_rate() is None


def test_latest_breathing_rate_returns_updated_value():
    sensor = RadarSensor()

    with sensor._lock:
        sensor._latest_bpm = 18.5

    assert sensor.get_latest_breathing_rate() == 18.5
