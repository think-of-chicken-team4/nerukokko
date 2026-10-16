from datetime import datetime
from unittest.mock import Mock

from integrator import Integrator


def test_build_record():
    # センサーや送信処理の代わりにテスト用データを設定
    egg_state = Mock()
    egg_state.snapshot.return_value = {
        "connected": True,
        "motion": "still",
    }

    radar_sensor = Mock()
    radar_sensor.get_latest_breathing_rate.return_value = 15.0

    mic_sensor = Mock()
    mic_sensor.get_latest_level.return_value = 0.25

    environment_sensor = Mock()
    environment_sensor.get_latest.return_value = {
        "temperature": 25.0,
        "humidity": 60.0,
        "lux": 120.0,
    }

    sender = Mock()

    integrator = Integrator(
        egg_state,
        radar_sensor,
        mic_sensor,
        environment_sensor,
        sender,
    )

    # データをまとめる処理を実行
    record = integrator._build_record()

    # 必要なデータが含まれているか確認
    assert "timestamp" in record
    assert "chicken" in record
    assert "egg" in record

    # 鶏本体のセンサーデータを確認
    assert record["chicken"]["breathing_rate"] == 15.0
    assert record["chicken"]["mic_level"] == 0.25
    assert record["chicken"]["temperature"] == 25.0
    assert record["chicken"]["humidity"] == 60.0
    assert record["chicken"]["lux"] == 120.0

    # たまごのデータを確認
    assert record["egg"] == {
        "connected": True,
        "motion": "still",
    }

    # タイムスタンプがUTC形式か確認
    timestamp = datetime.fromisoformat(
        record["timestamp"].replace("Z", "+00:00")
    )
    assert timestamp.utcoffset().total_seconds() == 0
