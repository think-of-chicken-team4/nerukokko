import asyncio
from unittest.mock import Mock

from egg_state import EggState
from environment_sensor import EnvironmentSensor
from ingest_client import IngestClient
from integrator import Integrator
from mic_sensor import MicSensor
from radar_sensor import RadarSensor


def test_sensor_data_is_combined_and_sent():
    egg_state = Mock(spec=EggState)
    radar_sensor = Mock(spec=RadarSensor)
    mic_sensor = Mock(spec=MicSensor)
    environment_sensor = Mock(spec=EnvironmentSensor)
    sender = Mock(spec=IngestClient)

    egg_state.snapshot.return_value = {
        "state": "incubating",
        "battery": 85,
    }
    radar_sensor.get_latest_breathing_rate.return_value = 24.5
    mic_sensor.get_latest_level.return_value = 120
    environment_sensor.get_latest.return_value = {
        "temperature": None,
        "humidity": None,
        "lux": 250.0,
    }

    integrator = Integrator(
        egg_state,
        radar_sensor,
        mic_sensor,
        environment_sensor,
        sender,
    )

    record = integrator._build_record()

    assert record["chicken"]["breathing_rate"] == 24.5
    assert record["chicken"]["mic_level"] == 120
    assert record["chicken"]["temperature"] is None
    assert record["chicken"]["humidity"] is None
    assert record["chicken"]["lux"] == 250.0
    assert record["egg"] == {
        "state": "incubating",
        "battery": 85,
    }
    assert record["timestamp"].endswith("Z")

    sender.send(record)

    sender.send.assert_called_once_with(record)


def test_sensor_values_are_read_when_building_record():
    egg_state = Mock(spec=EggState)
    radar_sensor = Mock(spec=RadarSensor)
    mic_sensor = Mock(spec=MicSensor)
    environment_sensor = Mock(spec=EnvironmentSensor)
    sender = Mock(spec=IngestClient)

    egg_state.snapshot.return_value = {}
    radar_sensor.get_latest_breathing_rate.return_value = None
    mic_sensor.get_latest_level.return_value = None
    environment_sensor.get_latest.return_value = {
        "temperature": None,
        "humidity": None,
        "lux": None,
    }

    integrator = Integrator(
        egg_state,
        radar_sensor,
        mic_sensor,
        environment_sensor,
        sender,
    )

    record = integrator._build_record()

    radar_sensor.get_latest_breathing_rate.assert_called_once_with()
    mic_sensor.get_latest_level.assert_called_once_with()
    environment_sensor.get_latest.assert_called_once_with()
    egg_state.snapshot.assert_called_once_with()

    assert record["chicken"]["breathing_rate"] is None
    assert record["chicken"]["mic_level"] is None
    assert record["chicken"]["lux"] is None
    sender.send.assert_not_called()
    