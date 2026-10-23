"""鶏のハードウェア：LED（WS2812B）・スピーカー・トサカボタン・マイクの録音。

ライブラリやハードウェアがない環境（Mac・CI・まだ配線していないラズパイ）では、何もしない部品に切り替わる。
そのため、ラズパイがなくても app.py 全体を動かして確かめられる。
ピンや音量などの値は integration_config.py（環境変数）で変える（hw-verification C4〜C7）。
"""

from __future__ import annotations

import asyncio
import io
import logging
import math
import shutil
import subprocess
import threading
import time
import wave
from typing import Callable, Optional, Tuple

import integration_config as config

logger = logging.getLogger(__name__)

Color = Tuple[int, int, int]

GOLD: Color = (255, 170, 40)
SUNRISE_END: Color = (255, 160, 60)
LISTENING: Color = (60, 140, 255)
OFF: Color = (0, 0, 0)


# ---------------------------------------------------------------- LED（WS2812B、C6）


class Led:
    def __init__(self) -> None:
        self._strip = None
        try:
            from rpi_ws281x import PixelStrip  # ラズパイで sudo（または /dev/mem の権限）が必要

            channel = 1 if config.LED_PIN in (13, 19) else 0
            self._strip = PixelStrip(config.LED_COUNT, config.LED_PIN, 800000, 10, False, config.LED_BRIGHTNESS, channel)
            self._strip.begin()
        except Exception as error:  # ライブラリがない・権限がない
            logger.warning("LED を使えません（%s）。光らせずに続けます", type(error).__name__)
            self._strip = None

    def set(self, color: Color) -> None:
        if self._strip is None:
            return
        from rpi_ws281x import Color as WsColor

        for i in range(config.LED_COUNT):
            self._strip.setPixelColor(i, WsColor(*color))
        self._strip.show()

    async def sunrise(self, stop: asyncio.Event, seconds: float) -> None:
        """アラーム：だんだん明るくして、そのあと点滅する（stop が立つまで）"""
        steps = 60
        for step in range(steps + 1):
            if stop.is_set():
                break
            r = step / steps
            self.set((int(SUNRISE_END[0] * r), int(SUNRISE_END[1] * r**1.5), int(SUNRISE_END[2] * r**2)))
            await asyncio.sleep(seconds / steps)
        on = True
        while not stop.is_set():
            self.set(GOLD if on else OFF)
            on = not on
            await asyncio.sleep(0.6)
        self.set(OFF)


# ---------------------------------------------------------------- スピーカー（MAX98357A、C5）


def scale_wav(data: bytes, volume: float) -> bytes:
    """16bit の WAV の音量を volume 倍にする（0〜1）"""
    try:
        import numpy as np

        with wave.open(io.BytesIO(data)) as src:
            params = src.getparams()
            frames = src.readframes(src.getnframes())
        if params.sampwidth != 2:
            return data
        samples = (np.frombuffer(frames, dtype="<i2").astype(np.float32) * max(0.0, min(volume, 1.0))).astype("<i2")
        out = io.BytesIO()
        with wave.open(out, "wb") as dst:
            dst.setparams(params)
            dst.writeframes(samples.tobytes())
        return out.getvalue()
    except Exception:
        logger.exception("音量を変えられませんでした。そのまま流します")
        return data


def tone_wav(freq: float = 880.0, seconds: float = 0.4, rate: int = 24000) -> bytes:
    """声が用意できないときの合図の音（ピッ）"""
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(int(seconds * rate)):
            v = int(12000 * math.sin(2 * math.pi * freq * i / rate) * min(1.0, (seconds * rate - i) / 800))
            frames += v.to_bytes(2, "little", signed=True)
        w.writeframes(bytes(frames))
    return out.getvalue()


class Speaker:
    """WAV を aplay で流す。一度に1つだけ（話し中は待つ）"""

    def __init__(self) -> None:
        self._aplay = shutil.which("aplay")
        self._lock = asyncio.Lock()
        if not self._aplay:
            logger.warning("aplay が見つかりません。音を流さずに続けます（ラズパイでは alsa-utils に入っている）")

    async def play(self, wav: bytes, stop: Optional[asyncio.Event] = None) -> None:
        async with self._lock:
            await asyncio.to_thread(self._play_blocking, scale_wav(wav, config.SPEAKER_VOLUME), stop)

    def _play_blocking(self, wav: bytes, stop: Optional[asyncio.Event]) -> None:
        if not self._aplay:
            time.sleep(min(1.0, len(wav) / 48000))
            return
        args = [self._aplay, "-q"] + (["-D", config.AUDIO_OUTPUT_DEVICE] if config.AUDIO_OUTPUT_DEVICE else []) + ["-"]
        proc = subprocess.Popen(args, stdin=subprocess.PIPE)
        try:
            assert proc.stdin is not None
            proc.stdin.write(wav)
            proc.stdin.close()
            while proc.poll() is None:
                if stop is not None and stop.is_set():
                    proc.terminate()
                    break
                time.sleep(0.05)
        except BrokenPipeError:
            pass
        finally:
            if proc.poll() is None:
                proc.kill()


# ---------------------------------------------------------------- トサカボタン（C7）


class Button:
    def __init__(self, on_press: Callable[[], None]) -> None:
        self._button = None
        try:
            from gpiozero import Button as GpioButton

            self._button = GpioButton(config.BUTTON_PIN, pull_up=True, bounce_time=0.05)
            self._button.when_pressed = on_press
        except Exception as error:
            logger.warning("トサカボタンを使えません（%s）。ボタンなしで続けます", type(error).__name__)


# ---------------------------------------------------------------- マイクの録音（SPH0645、C4）


class Recorder:
    """ボタンを押したら録音する。話し終わって MIC_SILENCE_SEC 静かになるか、MIC_MAX_SEC で止める。WAV（16kHz・モノラル・16bit）を返す"""

    def record(self) -> Optional[bytes]:
        try:
            import numpy as np
            import sounddevice as sd
        except Exception as error:
            logger.warning("録音できません（%s）", type(error).__name__)
            return None

        rate = config.MIC_SAMPLE_RATE
        block = int(rate * 0.1)
        chunks = []
        heard_voice = False
        quiet_since: Optional[float] = None
        started = time.monotonic()
        done = threading.Event()

        def callback(indata, frames, time_info, status) -> None:
            nonlocal heard_voice, quiet_since
            # SPH0645 は 32bit で、片方のチャンネルだけに音が入る。音の大きいチャンネルを使い、16bit にする
            data = indata.astype(np.float32)
            channel = int(np.argmax(np.abs(data).mean(axis=0))) if data.shape[1] > 1 else 0
            mono = data[:, channel] / 65536.0 if indata.dtype == np.int32 else data[:, channel]
            chunks.append(np.clip(mono * config.MIC_GAIN, -32768, 32767).astype("<i2"))
            level = float(np.sqrt(np.mean((mono * config.MIC_GAIN) ** 2))) if len(mono) else 0.0
            now = time.monotonic()
            if level >= config.MIC_VOICE_LEVEL:
                heard_voice = True
                quiet_since = None
            elif heard_voice and quiet_since is None:
                quiet_since = now
            if (quiet_since is not None and now - quiet_since >= config.MIC_SILENCE_SEC) or now - started >= config.MIC_MAX_SEC:
                done.set()

        device = config.MIC_DEVICE
        try:
            channels = min(2, int(sd.query_devices(device, "input")["max_input_channels"]) or 1)
            with sd.InputStream(samplerate=rate, channels=channels, dtype="int32", device=device, blocksize=block, callback=callback):
                done.wait(config.MIC_MAX_SEC + 1)
        except Exception:
            logger.exception("録音に失敗しました")
            return None
        if not heard_voice:
            logger.info("声が聞こえなかったので送りません")
            return None

        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(b"".join(c.tobytes() for c in chunks))
        return out.getvalue()
