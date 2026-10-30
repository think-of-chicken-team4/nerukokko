"""鶏のプログラム本体（F-01〜F-05）。センサー・たまご・サーバー・アラーム・声をまとめて動かす。

    30秒ごと：device-sync（たまご・部屋の状態を報告 → 次のアラーム・キャラボイス・話す内容を受け取る）
    1秒ごと ：アラームを鳴らすか、寝返り・いびき・呼吸・在床の判定、送るタイミングなら ingest-sensor-data
    60秒ごと：温湿度・照度
    たまごが巣に戻ったら：アラームを止め、charge_start をすぐ送る（起床。サーバーが朝の振り返りを作る）
    画面で「話す」をタップ（eyes プロセスから届く）：録音 → voice-chat → 返事を流す
    0.3秒ごと：状態（表情・会話中・アラーム中）を画面に渡し、画面からの操作を受け取る

docs/api-spec.md §3・§6、docs/ble-protocol.md。設定は integration_config.py（環境変数）。
"""

from __future__ import annotations

import asyncio
import datetime
import hashlib
import logging
import time
from pathlib import Path
from typing import Optional

import integration_config as config
from alarm import AlarmAction, AlarmClock
from api_client import ApiClient, Outcome
from detectors import BreathingAggregator, SoundConfig, SoundDetector, TurnConfig, TurnDetector
from egg_link import EggLink
from environment_sensor import EnvironmentReading, EnvironmentSensor
from eyes.ipc import COMMAND_TALK, CommandReceiver, DisplayState, write_state
from eyes.mood import TALK_LISTEN, TALK_THINK, choose_expression
from hardware import GOLD, LISTENING, OFF, Led, Recorder, Speaker, tone_wav
from outbox import Outbox, iso
from uplink import Uplink

logger = logging.getLogger(__name__)

RETRY_PHRASE = "ごめんコケ、うまく聞き取れなかったコケ。もう一回、画面にさわって話してほしいコケ。"
OFFLINE_PHRASE = "いまインターネットにつながっていないコケ…。少しあとでまた話しかけてほしいコケ。"


def parse_time(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


class PhraseCache:
    """よく使う声（アラーム・聞き返し）を、サーバーで一度作ってラズパイに保存する（Wi-Fi が切れても鳴るように）"""

    def __init__(self, directory: Path, api: ApiClient) -> None:
        self._dir = directory
        self._api = api

    def _path(self, text: str, voice: str) -> Path:
        key = hashlib.sha1(f"{voice}:{text}".encode()).hexdigest()[:16]
        return self._dir / f"{key}.wav"

    def get(self, text: str, voice: str) -> Optional[bytes]:
        path = self._path(text, voice)
        return path.read_bytes() if path.exists() else None

    def ensure(self, text: str, voice: str) -> None:
        path = self._path(text, voice)
        if path.exists() or not self._api.configured:
            return
        wav = self._api.speak(text)
        if wav:
            self._dir.mkdir(parents=True, exist_ok=True)
            path.write_bytes(wav)
            logger.info("声を保存しました：%s", text[:20])


class ChickenApp:
    def __init__(self) -> None:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.api = ApiClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, config.DEVICE_TOKEN)
        if not self.api.configured:
            logger.error("SUPABASE_URL・SUPABASE_PUBLISHABLE_KEY・DEVICE_TOKEN が設定されていません。サーバーとは通信しません")
        self.outbox = Outbox(config.DATA_DIR / "outbox.json")
        self.alarm = AlarmClock(config.DATA_DIR / "alarm.json", config.ALARM_MAX_RING_SEC)
        self.phrases = PhraseCache(config.DATA_DIR / "voice", self.api)
        self.turns = TurnDetector(TurnConfig(min_change_g=config.TURN_MIN_CHANGE_G, merge_sec=config.TURN_MERGE_SEC))
        self.sounds = SoundDetector(SoundConfig(loud_ratio=config.SOUND_LOUD_RATIO, min_loud_level=config.SOUND_MIN_LOUD_LEVEL))
        self.breathing = BreathingAggregator()
        self.environment = EnvironmentSensor()
        self.latest_env = EnvironmentReading(None, None, None)
        self.radar = self._start_radar()
        self.led = Led()
        self.speaker = Speaker()
        self.recorder = Recorder()

        self.voice = "rooster"
        self.egg_connected = False
        self.egg_mac: Optional[str] = None
        self.egg_battery: Optional[int] = None
        self.chat_session_id: Optional[str] = None
        self._ring_stop: Optional[asyncio.Event] = None
        self._busy_talking = False
        self._talk_phase: Optional[str] = None  # 会話の段階（表情用）：録音中・返事待ち
        self._speaking_kind: Optional[str] = None  # お知らせを話している間の kind（表情用）
        self._session_active = False  # 睡眠を記録中か（device-sync の session）
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        self.uplink = Uplink(self.outbox, self.api, config.FIRMWARE_VERSION, self._egg_info)
        self.egg = EggLink(self._on_audio, self._on_motion, self._on_dock, self._on_connection, self._on_battery)

    # ------------------------------------------------------------ 起動

    def _start_radar(self):
        if not config.RADAR_ENABLED:
            return None
        try:
            from radar_sensor import RadarSensor  # acconeer-exptool が入っていないと読み込めない

            radar = RadarSensor()
            radar.start()
            return radar
        except Exception as error:
            logger.warning("レーダーを使えません（%s）。呼吸・在床なしで続けます", type(error).__name__)
            return None

    async def run(self) -> None:
        self._loop = asyncio.get_running_loop()
        self.led.set(OFF)
        logger.info("ねるコッコ（鶏）を起動しました：%s", config.FIRMWARE_VERSION)
        await asyncio.gather(self.egg.run_forever(), self._sync_loop(), self._tick_loop(), self._environment_loop(), self._display_loop())

    # ------------------------------------------------------------ たまご（BLE）から

    def _on_connection(self, connected: bool, mac: Optional[str]) -> None:
        self.egg_connected = connected
        if mac:
            self.egg_mac = mac
        self.turns.reset_baseline()

    def _on_battery(self, percent: int) -> None:
        self.egg_battery = percent

    def _on_audio(self, level: int) -> None:
        for e in self.sounds.add(time.time(), level):
            self.outbox.add("audio_events", {
                "timestamp": iso(e.timestamp), "type": e.type, "duration_ms": max(1, e.duration_ms),
                "confidence": e.confidence, "device": "egg",
            })
            logger.info("%s を検出（%d ms）", "いびき" if e.type == "snore" else "寝言", e.duration_ms)

    def _on_motion(self, x: int, y: int, z: int) -> None:
        self._record_turns(self.turns.add(time.time(), x, y, z))

    def _record_turns(self, events) -> None:
        for e in events:
            self.outbox.add("motion_events", {"timestamp": iso(e.timestamp), "intensity": e.intensity, "source": "accelerometer"})
            logger.info("寝返りを検出（%.2f g）", e.intensity)

    def _on_dock(self, docked: bool) -> None:
        now = time.time()
        self.outbox.add("charge_events", {"timestamp": iso(now), "type": "charge_start" if docked else "charge_stop"})
        if docked:
            logger.info("たまごが巣に戻りました（起床）")
            if self.alarm.dock():
                self._stop_ringing()
        else:
            logger.info("たまごが巣から出ました")

    def _egg_info(self) -> Optional[dict]:
        if not self.egg_mac:
            return None
        info: dict = {"mac_address": self.egg_mac}
        if self.egg_battery is not None:
            info["battery_level"] = self.egg_battery
        return info

    # ------------------------------------------------------------ サーバーとの同期（api-spec §3-2）

    async def _sync_loop(self) -> None:
        while True:
            try:
                await self._sync_once()
            except Exception:
                logger.exception("同期でエラーが起きました")
            await asyncio.sleep(config.SYNC_INTERVAL_SEC)

    async def _sync_once(self) -> None:
        if not self.api.configured:
            return
        status = {
            "alarm_ringing": self.alarm.ringing,
            "egg_connected": self.egg_connected,
            **({"egg_docked": self.egg.docked} if self.egg.docked is not None else {}),
            **({"egg_battery_level": self.egg_battery} if self.egg_battery is not None else {}),
            **{k: v for k, v in (
                ("temperature_c", self.latest_env.temperature_c),
                ("humidity_pct", self.latest_env.humidity_pct),
                ("illuminance_lux", self.latest_env.illuminance_lux),
            ) if v is not None},
        }
        body = {"firmware_version": config.FIRMWARE_VERSION, "status": status}
        if self.egg_mac:
            body["egg_mac_address"] = self.egg_mac
        result = await asyncio.to_thread(self.api.device_sync, body)
        if result.outcome is not Outcome.OK or not isinstance(result.body, dict):
            return  # 前に受け取ったアラームのまま（Wi-Fi が切れても鳴る）

        session = result.body.get("session")
        self._session_active = isinstance(session, dict) and session.get("status") == "in_progress"
        alarm = result.body.get("alarm") or {}
        self.alarm.set_target(parse_time(alarm.get("ring_at")))
        self.voice = (result.body.get("settings") or {}).get("character_voice") or "rooster"
        # アラームと聞き返しの声を、まだなければ作って保存しておく
        await asyncio.to_thread(self.phrases.ensure, config.ALARM_PHRASE, self.voice)
        await asyncio.to_thread(self.phrases.ensure, RETRY_PHRASE, self.voice)
        await asyncio.to_thread(self.phrases.ensure, OFFLINE_PHRASE, self.voice)

        for announcement in result.body.get("announcements") or []:
            text = announcement.get("text")
            if text:
                asyncio.create_task(self._say(text, announcement.get("kind")))

    async def _say(self, text: str, kind: Optional[str] = None) -> None:
        """サーバーで声にして流す（夕方の提案・朝のコメント）。作れなければ合図の音"""
        self._speaking_kind = kind
        try:
            wav = await asyncio.to_thread(self.api.speak, text)
            self.led.set(GOLD)
            await self.speaker.play(wav or tone_wav())
            self.led.set(OFF)
        finally:
            self._speaking_kind = None

    # ------------------------------------------------------------ 1秒ごと

    async def _tick_loop(self) -> None:
        last_sent = 0.0
        while True:
            now = time.time()
            try:
                action = self.alarm.tick(now)
                if action is AlarmAction.START:
                    self._start_ringing()
                elif action is AlarmAction.STOP:
                    self._stop_ringing()

                self._record_turns(self.turns.flush(now))
                for e in self.sounds.flush(now):
                    self.outbox.add("audio_events", {
                        "timestamp": iso(e.timestamp), "type": e.type, "duration_ms": max(1, e.duration_ms),
                        "confidence": e.confidence, "device": "egg",
                    })
                if self.radar is not None:
                    for t, bpm in self.breathing.add(now, self.radar.get_latest_breathing_rate()):
                        self.outbox.add("breathing", {"timestamp": iso(t), "breaths_per_min": bpm, "source": "mmwave"})
                    for t, state in self.radar.pop_presence_changes():
                        self.outbox.add("presence_events", {"timestamp": iso(t), "state": state})

                if self.api.configured and self.uplink.should_send(now, last_sent, config.SEND_INTERVAL_SEC):
                    last_sent = now
                    await asyncio.to_thread(self.uplink.send, now)
            except Exception:
                logger.exception("定期処理でエラーが起きました")
            await asyncio.sleep(1.0)

    async def _environment_loop(self) -> None:
        while True:
            reading = await asyncio.to_thread(self.environment.read)
            if not reading.is_empty():
                self.latest_env = reading
                item = {"timestamp": iso(time.time())}
                for key in ("temperature_c", "humidity_pct", "illuminance_lux"):
                    value = getattr(reading, key)
                    if value is not None:
                        item[key] = value
                self.outbox.add("environment", item)
            await asyncio.sleep(config.ENVIRONMENT_INTERVAL_SEC)

    # ------------------------------------------------------------ アラーム（F-02）

    def _start_ringing(self) -> None:
        logger.info("アラームを鳴らします")
        self._ring_stop = asyncio.Event()
        stop = self._ring_stop
        asyncio.create_task(self.led.sunrise(stop, config.ALARM_SUNRISE_SEC))
        asyncio.create_task(self._ring_sound(stop))

    async def _ring_sound(self, stop: asyncio.Event) -> None:
        wav = self.phrases.get(config.ALARM_PHRASE, self.voice) or tone_wav(880, 0.6)
        while not stop.is_set():
            await self.speaker.play(wav, stop)
            try:
                await asyncio.wait_for(stop.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                pass

    def _stop_ringing(self) -> None:
        if self._ring_stop is not None:
            self._ring_stop.set()
            self._ring_stop = None
            logger.info("アラームを止めました")

    # ------------------------------------------------------------ 画面（eyes）との連携・タッチで話す（F-04・F-10）

    def _display_state(self) -> DisplayState:
        ringing = self.alarm.ringing
        expression = choose_expression(
            alarm_ringing=ringing,
            talk_phase=self._talk_phase,
            speaking_kind=self._speaking_kind,
            session_active=self._session_active,
            hour=datetime.datetime.now().hour,
            evening_hour=config.EVENING_SLEEPY_HOUR,
        )
        return DisplayState(expression=expression, busy=self._busy_talking, alarm_ringing=ringing)

    async def _display_loop(self) -> None:
        """状態を画面（別プロセス）に渡し、画面から届いた操作を受け取る。画面が動いていなくても本体は止まらない"""
        receiver = CommandReceiver(config.DISPLAY_COMMAND_PATH)
        while True:
            try:
                write_state(config.DISPLAY_STATE_PATH, self._display_state())
                command = receiver.poll()
                if command is not None:
                    logger.info("画面から操作を受け取りました：%s", command)
                if command == COMMAND_TALK:
                    self._on_talk_requested()
            except Exception:
                logger.exception("画面との連携でエラーが起きました")
            await asyncio.sleep(config.DISPLAY_POLL_SEC)

    def _on_talk_requested(self) -> None:
        if self.alarm.ringing:
            logger.info("アラーム中の会話は始めません（たまごを巣に戻すと止まる）")
            return
        if self._busy_talking:
            logger.info("会話の最中なので、新しい「話す」は始めません")
            return
        asyncio.create_task(self._talk())

    async def _talk(self) -> None:
        self._busy_talking = True
        logger.info("会話を始めます（録音）")
        self._talk_phase = TALK_LISTEN
        try:
            self.led.set(LISTENING)
            wav = await asyncio.to_thread(self.recorder.record)
            if wav is None:
                return
            self._talk_phase = TALK_THINK
            self.led.set(GOLD)
            reply = await asyncio.to_thread(self.api.voice_chat, wav, self.chat_session_id) if self.api.configured else None
            if reply is None:
                await self.speaker.play(self.phrases.get(OFFLINE_PHRASE, self.voice) or tone_wav(440, 0.5))
                return
            self.chat_session_id = reply.get("chat_session_id")
            logger.info("あなた：%s／にわとり：%s", reply.get("user_text"), reply.get("reply_text"))
            audio = reply.get("audio") or self.phrases.get(RETRY_PHRASE, self.voice) or tone_wav()
            await self.speaker.play(audio)
        except Exception:
            logger.exception("会話でエラーが起きました")
        finally:
            self.led.set(OFF)
            self._talk_phase = None
            self._busy_talking = False
