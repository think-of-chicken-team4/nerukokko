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

import asyncio
from unittest.mock import Mock, patch

from integrator import Integrator


def test_run_forever_sends_record():
    # 1回目の待機後に送信し、次の待機で終了させる
    egg_state = Mock()
    egg_state.snapshot.return_value = {"connected": True}

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

    sleep_count = 0

    async def fake_sleep(_seconds):
        nonlocal sleep_count
        sleep_count += 1
        if sleep_count >= 2:
            raise asyncio.CancelledError

    async def fake_to_thread(func, *args):
        return func(*args)

    with (
        patch("integrator.asyncio.sleep", side_effect=fake_sleep),
        patch("integrator.asyncio.to_thread", side_effect=fake_to_thread),
    ):
        try:
            asyncio.run(integrator.run_forever())
        except asyncio.CancelledError:
            pass

    sender.send.assert_called_once()

def test_run_forever_continues_after_send_failure():
    egg_state = Mock()
    egg_state.snapshot.return_value = {"connected": True}

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
    sender.send.side_effect = [
        RuntimeError("通信エラー"),
        None,
    ]

    integrator = Integrator(
        egg_state,
        radar_sensor,
        mic_sensor,
        environment_sensor,
        sender,
    )

    sleep_count = 0

    async def fake_sleep(_seconds):
        nonlocal sleep_count
        sleep_count += 1
        if sleep_count >= 3:
            raise asyncio.CancelledError

    async def fake_to_thread(func, *args):
        return func(*args)

    with (
        patch("integrator.asyncio.sleep", side_effect=fake_sleep),
        patch("integrator.asyncio.to_thread", side_effect=fake_to_thread),
    ):
        try:
            asyncio.run(integrator.run_forever())
        except asyncio.CancelledError:
            pass

    assert sender.send.call_count == 2
