import numpy as np

from mic_sensor import MicSensor


def test_latest_level_initially_none():
    sensor = MicSensor()

    assert sensor.get_latest_level() is None


def test_on_audio_silence_sets_level_to_zero():
    sensor = MicSensor()
    samples = np.zeros((4, 1), dtype=np.int16)

    sensor._on_audio(samples, 4, None, None)

    assert sensor.get_latest_level() == 0


def test_on_audio_updates_level():
    sensor = MicSensor()
    samples = np.array([[100], [100], [100], [100]], dtype=np.int16)

    sensor._on_audio(samples, 4, None, None)

    assert sensor.get_latest_level() == 200
