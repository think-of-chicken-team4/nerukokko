"""hardware.py の音量の段階（対数）と、声の大きさをそろえる処理のテスト。numpy がないときは飛ばす。
実行：cd firmware/chicken && python3 -m unittest discover -s tests"""

from __future__ import annotations

import io
import math
import unittest
import wave

import hardware

try:
    import numpy as np
except ImportError:  # CI などで numpy がないとき
    np = None


def make_wav(samples, rate: int = 24000) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.asarray(samples, dtype="<i2").tobytes())
    return out.getvalue()


def read_samples(data: bytes):
    with wave.open(io.BytesIO(data)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32768.0


def rms(x) -> float:
    return float(np.sqrt(np.mean(np.asarray(x) ** 2)))


class VolumeToGainTest(unittest.TestCase):
    def test_max_is_unity_and_steps_are_db(self) -> None:
        self.assertAlmostEqual(hardware.volume_to_gain(1.0), 1.0)
        step_db = 20 * math.log10(hardware.volume_to_gain(0.9) / hardware.volume_to_gain(1.0))
        self.assertAlmostEqual(step_db, -hardware.DB_PER_VOLUME_STEP, places=3)
        for v in (0.2, 0.5, 0.8):  # どの段でも、1 段あたりの変わり方は同じ
            db = 20 * math.log10(hardware.volume_to_gain(v + 0.1) / hardware.volume_to_gain(v))
            self.assertAlmostEqual(db, hardware.DB_PER_VOLUME_STEP, places=3)

    def test_monotonic_and_clamped(self) -> None:
        gains = [hardware.volume_to_gain(v / 10) for v in range(1, 11)]
        self.assertEqual(gains, sorted(gains))
        self.assertEqual(hardware.volume_to_gain(2.0), 1.0)
        self.assertEqual(hardware.volume_to_gain(0.0), 0.0)

    def test_alarm_minimum_is_not_too_quiet(self) -> None:
        db = 20 * math.log10(hardware.volume_to_gain(0.5))
        self.assertGreater(db, -15.0)  # アラームの下限（0.5）が、最大より 15 dB 以上は下がらない


@unittest.skipUnless(np is not None, "numpy がない")
class BoostLoudnessTest(unittest.TestCase):
    def speech_like(self):
        # 平均は小さく、ところどころ大きなピークがある（声の合成音に近い形）
        rng = np.random.default_rng(0)
        x = rng.normal(0, 0.12, 24000)
        x[::2000] = 0.93
        return (np.clip(x, -1, 1) * 32767).astype(int)

    def test_quiet_voice_becomes_louder_without_clipping(self) -> None:
        wav = make_wav(self.speech_like())
        before = rms(read_samples(wav))
        out = read_samples(hardware.boost_loudness(wav, 0.26))
        self.assertGreater(rms(out), before * 1.3)
        self.assertLessEqual(float(np.max(np.abs(out))), 1.0)

    def test_already_loud_is_untouched(self) -> None:
        wav = make_wav((np.sin(np.linspace(0, 2000, 24000)) * 0.9 * 32767).astype(int))
        self.assertEqual(hardware.boost_loudness(wav, 0.26), wav)

    def test_zero_target_disables(self) -> None:
        wav = make_wav(self.speech_like())
        self.assertEqual(hardware.boost_loudness(wav, 0), wav)

    def test_silence_and_non_16bit_are_untouched(self) -> None:
        silent = make_wav([0] * 1000)
        self.assertEqual(hardware.boost_loudness(silent, 0.26), silent)
        self.assertEqual(hardware.boost_loudness(b"not a wav", 0.26), b"not a wav")

    def test_small_samples_stay_linear(self) -> None:
        wav = make_wav((np.sin(np.linspace(0, 300, 24000)) * 0.1 * 32767).astype(int))
        out = read_samples(hardware.boost_loudness(wav, 0.26))
        gain = 0.26 / rms(read_samples(wav))
        self.assertAlmostEqual(float(np.max(np.abs(out))), float(np.max(np.abs(read_samples(wav)))) * gain, delta=0.02)


if __name__ == "__main__":
    unittest.main()
