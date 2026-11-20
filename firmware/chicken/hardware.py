"""鶏のハードウェア：LED（WS2812B）・スピーカー・マイクの録音。

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
from typing import Optional, Tuple

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


DB_PER_VOLUME_STEP = 2.5  # 音量を 0.1 変えるごとに、何 dB 変えるか（音量 1.0 が最大で、そのまま）。実機で調整する（C5）
SOFT_KNEE = 0.6  # これ以下の大きさは、そのまま。これを超えた分だけ、ゆるやかに抑える（割れにくくする）


def volume_to_gain(volume: float) -> float:
    """画面の音量（0.1〜1.0）を、倍率にする。1 段（0.1）ごとに DB_PER_VOLUME_STEP dB ずつ、耳に自然な変わり方にする"""
    v = max(0.0, min(volume, 1.0))
    if v <= 0.0:
        return 0.0
    return 10.0 ** (-(1.0 - v) * 10.0 * DB_PER_VOLUME_STEP / 20.0)


def boost_loudness(data: bytes, target_rms: float) -> bytes:
    """16bit の WAV の平均の大きさ（RMS、0〜1）が target_rms より小さければ、そこまで大きくする。
    ピークは、SOFT_KNEE を超えた分をゆるやかに抑えて、割れにくくする。target_rms が 0 なら何もしない。
    声の合成音は、最大値が大きく平均が小さいので、そのままだと、小さなスピーカーで小さく聞こえる"""
    if target_rms <= 0:
        return data
    try:
        import numpy as np

        with wave.open(io.BytesIO(data)) as src:
            params = src.getparams()
            frames = src.readframes(src.getnframes())
        if params.sampwidth != 2 or not frames:
            return data
        x = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(x * x)))
        if rms <= 1e-6 or rms >= target_rms:
            return data
        y = x * (target_rms / rms)
        mag = np.abs(y)
        over = mag > SOFT_KNEE
        room = 1.0 - SOFT_KNEE
        y = np.where(over, np.sign(y) * (SOFT_KNEE + room * np.tanh((mag - SOFT_KNEE) / room)), y)
        out = io.BytesIO()
        with wave.open(out, "wb") as dst:
            dst.setparams(params)
            dst.writeframes((np.clip(y, -1.0, 1.0) * 32767.0).astype("<i2").tobytes())
        return out.getvalue()
    except Exception:
        logger.exception("音の大きさをそろえられませんでした。そのまま流します")
        return data


def scale_wav(data: bytes, volume: float) -> bytes:
    """16bit の WAV の大きさを volume 倍にする（0〜1。画面の音量ではなく、倍率。画面の音量は volume_to_gain で倍率にする）"""
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
        self.volume = config.SPEAKER_VOLUME  # 会話の返事・合図の音量。画面で変わる（app.py が保存した値で上書きする）
        if not self._aplay:
            logger.warning("aplay が見つかりません。音を流さずに続けます（ラズパイでは alsa-utils に入っている）")

    async def play(self, wav: bytes, stop: Optional[asyncio.Event] = None, volume: Optional[float] = None) -> None:
        """volume を指定しなければ、いまの会話の音量（self.volume）で流す。アラームは ALARM_VOLUME を指定する"""
        async with self._lock:
            gain = volume_to_gain(self.volume if volume is None else volume)
            loud = boost_loudness(wav, config.VOICE_TARGET_RMS)
            await asyncio.to_thread(self._play_blocking, scale_wav(loud, gain), stop)

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


# ---------------------------------------------------------------- マイクの録音（SPH0645、C4）


class Recorder:
    """画面で「話す」をタップしたら録音する。話し終わって MIC_SILENCE_SEC 静かになるか、MIC_MAX_SEC で止める。WAV（16kHz・モノラル・16bit）を返す"""

    def record(self, stop: Optional[threading.Event] = None) -> Optional[bytes]:
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
            if (
                (config.MIC_AUTO_STOP and quiet_since is not None and now - quiet_since >= config.MIC_SILENCE_SEC)
                or now - started >= config.MIC_MAX_SEC
                or (stop is not None and stop.is_set())  # 画面の「話し終わった」
            ):
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
