"""たまごとの BLE（鶏が Central、bleak）。docs/ble-protocol.md。

- たまごを名前で探してつなぎ、Audio Level・Motion Event・Dock Event を Notify で受け取る
- 充電の状態（Dock）は、つないだときと DOCK_POLL_SEC ごとに Read でも読み、変わっていれば on_dock を呼ぶ
  （BLE が切れていたあいだに巣に戻した、Notify を取りこぼした、を補う。Issue #5）
- バッテリー残量の Service があれば読む（たまごの設定しだい）
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable, Optional

from bleak import BleakClient, BleakScanner

import ble_config
from sensor_data import AudioLevel, DockEvent, MotionEvent

logger = logging.getLogger(__name__)


class EggLink:
    def __init__(
        self,
        on_audio: Callable[[int], None],
        on_motion: Callable[[int, int, int], None],
        on_dock: Callable[[bool], None],
        on_connection: Callable[[bool, Optional[str]], None],
        on_battery: Callable[[int], None],
    ) -> None:
        self._on_audio = on_audio
        self._on_motion = on_motion
        self._on_dock = on_dock
        self._on_connection = on_connection
        self._on_battery = on_battery
        self._docked: Optional[bool] = None

    @property
    def docked(self) -> Optional[bool]:
        return self._docked

    async def run_forever(self) -> None:
        while True:
            try:
                device = await BleakScanner.find_device_by_name(ble_config.DEVICE_NAME, timeout=ble_config.SCAN_TIMEOUT_SEC)
                if device is None:
                    await asyncio.sleep(ble_config.RECONNECT_WAIT_SEC)
                    continue
                await self._session(device)
            except Exception:
                logger.exception("たまごとの BLE でエラーが起きました。つなぎ直します")
            self._on_connection(False, None)
            await asyncio.sleep(ble_config.RECONNECT_WAIT_SEC)

    async def _session(self, device) -> None:
        disconnected = asyncio.Event()
        loop = asyncio.get_running_loop()

        async with BleakClient(device, disconnected_callback=lambda _: loop.call_soon_threadsafe(disconnected.set)) as client:
            mac = device.address.upper() if ":" in device.address else None
            logger.info("たまごとつながりました：%s", device.address)
            self._on_connection(True, mac)

            await client.start_notify(ble_config.CHAR_AUDIO_UUID, lambda _, d: self._on_audio(AudioLevel.from_bytes(bytes(d)).level))
            await client.start_notify(
                ble_config.CHAR_MOTION_UUID,
                lambda _, d: self._handle_motion(MotionEvent.from_bytes(bytes(d))),
            )
            await client.start_notify(ble_config.CHAR_DOCK_UUID, lambda _, d: self._set_docked(DockEvent.from_bytes(bytes(d)).docked))
            await self._read_dock(client)

            has_battery = any(c.uuid == ble_config.BATTERY_LEVEL_UUID for s in client.services for c in s.characteristics)
            if has_battery:
                await client.start_notify(ble_config.BATTERY_LEVEL_UUID, lambda _, d: self._on_battery(int(d[0])))
                self._on_battery(int((await client.read_gatt_char(ble_config.BATTERY_LEVEL_UUID))[0]))

            while not disconnected.is_set():
                try:
                    await asyncio.wait_for(disconnected.wait(), timeout=ble_config.DOCK_POLL_SEC)
                except asyncio.TimeoutError:
                    await self._read_dock(client)
        logger.warning("たまごとの接続が切れました")

    async def _read_dock(self, client: BleakClient) -> None:
        try:
            self._set_docked(DockEvent.from_bytes(bytes(await client.read_gatt_char(ble_config.CHAR_DOCK_UUID))).docked)
        except Exception:
            logger.warning("充電の状態を読めませんでした")

    def _handle_motion(self, event: MotionEvent) -> None:
        self._on_motion(event.x, event.y, event.z)

    def _set_docked(self, docked: bool) -> None:
        if docked != self._docked:
            previous, self._docked = self._docked, docked
            # 起動して最初に読んだ値は「変化」ではないので知らせない（巣に置いたまま鶏を再起動しても起床扱いにしない）
            if previous is not None:
                self._on_dock(docked)
