"""たまごユニットへのBLE接続・Notify受信を扱うCentral実装(bleak使用)。"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable

from bleak import BleakClient, BleakScanner
from bleak.backends.device import BLEDevice

import ble_config
from sensor_data import AudioLevel, DockEvent, Environment, MotionEvent

logger = logging.getLogger(__name__)

AudioCallback = Callable[[AudioLevel], None]
MotionCallback = Callable[[MotionEvent], None]
EnvironmentCallback = Callable[[Environment], None]
DockCallback = Callable[[DockEvent], None]


class TamagoClient:
    def __init__(
        self,
        on_audio: AudioCallback,
        on_motion: MotionCallback,
        on_environment: EnvironmentCallback,
        on_dock: DockCallback,
    ) -> None:
        self._on_audio = on_audio
        self._on_motion = on_motion
        self._on_environment = on_environment
        self._on_dock = on_dock
        self._disconnected_event = asyncio.Event()

    async def run_forever(self) -> None:
        """スキャン→接続→Notify購読を切断のたびに繰り返す。"""
        while True:
            try:
                device = await self._scan()
                if device is None:
                    logger.info("たまごユニットが見つかりません。再スキャンします。")
                    await asyncio.sleep(ble_config.RECONNECT_WAIT_SEC)
                    continue

                await self._connect_and_listen(device)
            except Exception:
                logger.exception("BLE接続中にエラーが発生しました。再試行します。")
                await asyncio.sleep(ble_config.RECONNECT_WAIT_SEC)

    async def _scan(self) -> BLEDevice | None:
        logger.info("たまごユニットをスキャン中...")
        return await BleakScanner.find_device_by_name(
            ble_config.DEVICE_NAME, timeout=ble_config.SCAN_TIMEOUT_SEC
        )

    async def _connect_and_listen(self, device: BLEDevice) -> None:
        self._disconnected_event.clear()

        def handle_disconnect(_: BleakClient) -> None:
            logger.warning("たまごユニットが切断されました。")
            self._disconnected_event.set()

        async with BleakClient(device, disconnected_callback=handle_disconnect) as client:
            logger.info("たまごユニットに接続しました: %s", device.address)

            await client.start_notify(ble_config.CHAR_AUDIO_UUID, self._handle_audio)
            await client.start_notify(ble_config.CHAR_MOTION_UUID, self._handle_motion)
            await client.start_notify(ble_config.CHAR_ENV_UUID, self._handle_environment)
            await client.start_notify(ble_config.CHAR_DOCK_UUID, self._handle_dock)

            await self._disconnected_event.wait()

    def _handle_audio(self, _sender, data: bytearray) -> None:
        self._on_audio(AudioLevel.from_bytes(bytes(data)))

    def _handle_motion(self, _sender, data: bytearray) -> None:
        self._on_motion(MotionEvent.from_bytes(bytes(data)))

    def _handle_environment(self, _sender, data: bytearray) -> None:
        self._on_environment(Environment.from_bytes(bytes(data)))

    def _handle_dock(self, _sender, data: bytearray) -> None:
        self._on_dock(DockEvent.from_bytes(bytes(data)))
