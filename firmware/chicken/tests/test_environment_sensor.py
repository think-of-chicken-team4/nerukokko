import pytest

from environment_sensor import EnvironmentSensor


def test_latest_values_initially_none():
    sensor = EnvironmentSensor()

    assert sensor.get_latest() == {
        "temperature": None,
        "humidity": None,
        "lux": None,
    }


def test_read_lux_converts_raw_value_to_lux():
    sensor = EnvironmentSensor()

    class FakeBus:
        def read_i2c_block_data(self, address, mode, length):
            assert address == 0x23
            assert mode == 0x10
            assert length == 2
            return [0x01, 0x2C]

    sensor._bus = FakeBus()

    # 0x012C は10進数で300。300 / 1.2 = 250 lux
    assert sensor._read_lux() == pytest.approx(250.0)


def test_read_lux_returns_none_without_bus():
    sensor = EnvironmentSensor()

    assert sensor._read_lux() is None


def test_read_lux_returns_none_when_read_fails():
    sensor = EnvironmentSensor()

    class FakeBus:
        def read_i2c_block_data(self, address, mode, length):
            raise OSError("I2C read failed")

    sensor._bus = FakeBus()

    assert sensor._read_lux() is None