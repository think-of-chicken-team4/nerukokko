"""C4（マイク）・C5（スピーカー）：I2S のマイクとスピーカーを確かめる（docs/hw-verification.md）。

    python3 hwtest/audio_test.py devices                      # 音声デバイスの一覧
    python3 hwtest/audio_test.py record --seconds 5           # 録音して rec.wav に保存し、音量を表示（C4）
    python3 hwtest/audio_test.py meter --seconds 30           # マイクの音量を0.2秒ごとに表示（C4）
    python3 hwtest/audio_test.py play rec.wav                 # WAV を再生（C4 の聞き取り確認）
    python3 hwtest/audio_test.py rooster --volume 0.5         # アラーム音（コケコッコー風）を鳴らす（C5）
    python3 hwtest/audio_test.py tone --freq 1000 --volume 0.3

--device で使うデバイスを番号か名前の一部で指定できる（devices で確認）。
SPH0645 マイクは 32bit・ステレオ（左右の片方だけに音が入る）で出力するので、録音は 32bit で行い、
音が入っている方のチャンネルを自動で選んで 16bit・モノラルで保存する。
"""

from __future__ import annotations

import argparse
import sys
import time
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd

DEFAULT_RATE = 48000


def to_dbfs(samples: np.ndarray) -> tuple[float, float]:
    """-1.0〜1.0 の波形から RMS と ピーク を dBFS で返す（0 dBFS が最大）。"""
    if samples.size == 0:
        return float("-inf"), float("-inf")
    rms = float(np.sqrt(np.mean(samples**2)))
    peak = float(np.max(np.abs(samples)))
    as_db = lambda value: 20 * np.log10(value) if value > 0 else float("-inf")  # noqa: E731
    return as_db(rms), as_db(peak)


def parse_device(value: str | None) -> int | str | None:
    if value is None:
        return None
    return int(value) if value.isdigit() else value


def cmd_devices(_args: argparse.Namespace) -> None:
    print(sd.query_devices())
    print("\n> が既定の入力、< が既定の出力です。I2S のデバイス名（例：googlevoicehat）を --device で指定してください。")


def record_float(seconds: float, device: int | str | None, rate: int) -> np.ndarray:
    """32bit で録音し、-1.0〜1.0 の float（サンプル数 × チャンネル数）で返す。"""
    info = sd.query_devices(device, "input")
    channels = min(2, int(info["max_input_channels"])) or 1
    print(f"録音中…（{seconds:.0f}秒、{info['name']}、{rate}Hz、{channels}ch）")
    frames = sd.rec(int(seconds * rate), samplerate=rate, channels=channels, dtype="int32", device=device)
    sd.wait()
    return frames.astype(np.float64) / 2**31


def pick_channel(frames: np.ndarray) -> tuple[int, np.ndarray]:
    levels = [to_dbfs(frames[:, ch])[0] for ch in range(frames.shape[1])]
    best = int(np.argmax(levels))
    for ch, level in enumerate(levels):
        print(f"  チャンネル{ch + 1}：RMS {level:6.1f} dBFS{'  ← 使用' if ch == best else ''}")
    return best, frames[:, best]


def save_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    pcm = np.clip(samples, -1.0, 1.0)
    pcm16 = (pcm * 32767).astype("<i2")
    with wave.open(str(path), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(rate)
        file.writeframes(pcm16.tobytes())


def cmd_record(args: argparse.Namespace) -> None:
    frames = record_float(args.seconds, parse_device(args.device), args.rate)
    _, mono = pick_channel(frames)
    rms, peak = to_dbfs(mono)
    save_wav(Path(args.out), mono, args.rate)
    print(f"保存しました：{args.out}")
    print(f"音量：RMS {rms:.1f} dBFS、ピーク {peak:.1f} dBFS")
    if peak == float("-inf"):
        print("→ まったく音が入っていません。配線（DOUT・BCLK・LRCLK）と dtoverlay の設定を確認してください。")
    elif rms < -50:
        print("→ かなり小さい音です。話しかける距離を変えて、声が聞き取れるか play で確認してください。")


def cmd_meter(args: argparse.Namespace) -> None:
    device = parse_device(args.device)
    info = sd.query_devices(device, "input")
    channels = min(2, int(info["max_input_channels"])) or 1
    block = int(args.rate * 0.2)
    print("マイクの音量（0.2秒ごと、Ctrl+C で終了）")
    started = time.time()
    try:
        with sd.InputStream(samplerate=args.rate, channels=channels, dtype="int32", device=device, blocksize=block) as stream:
            while time.time() - started < args.seconds:
                data, _ = stream.read(block)
                frames = data.astype(np.float64) / 2**31
                level = max(to_dbfs(frames[:, ch])[0] for ch in range(channels))
                bar = "#" * max(0, int((level + 90) / 2))
                print(f"{level:6.1f} dBFS |{bar}")
    except KeyboardInterrupt:
        pass


def play(samples: np.ndarray, rate: int, device: int | str | None, volume: float) -> None:
    sd.play(np.clip(samples * volume, -1.0, 1.0).astype(np.float32), samplerate=rate, device=device)
    sd.wait()


def cmd_play(args: argparse.Namespace) -> None:
    with wave.open(args.file, "rb") as file:
        rate = file.getframerate()
        width = file.getsampwidth()
        channels = file.getnchannels()
        raw = file.readframes(file.getnframes())
    if width != 2:
        sys.exit("16bit の WAV だけ再生できます")
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    samples = samples.reshape(-1, channels)
    print(f"再生中：{args.file}（{rate}Hz、{channels}ch、音量 {args.volume}）")
    play(samples, rate, parse_device(args.device), args.volume)


def tone(freq: float, seconds: float, rate: int) -> np.ndarray:
    t = np.arange(int(seconds * rate)) / rate
    fade = np.minimum(1, np.minimum(t, seconds - t) / 0.01)  # プツッという音を防ぐ
    return np.sin(2 * np.pi * freq * t) * fade


def rooster(rate: int) -> np.ndarray:
    """「コ・ケ・コッ・コー」風の4音。本番のアラーム音ができるまでの音量確認用。"""
    notes = [(700, 900, 0.12), (900, 1100, 0.12), (800, 1000, 0.15), (1100, 1500, 0.7)]
    parts = []
    for start, end, seconds in notes:
        t = np.arange(int(seconds * rate)) / rate
        freq = np.linspace(start, end, t.size)
        phase = 2 * np.pi * np.cumsum(freq) / rate
        fade = np.minimum(1, np.minimum(t, seconds - t) / 0.01)
        wave_ = (np.sin(phase) + 0.3 * np.sin(2 * phase)) / 1.3 * fade
        parts += [wave_, np.zeros(int(0.05 * rate))]
    return np.concatenate(parts)


def cmd_rooster(args: argparse.Namespace) -> None:
    sound = np.tile(rooster(args.rate), args.repeat)
    if args.out:
        save_wav(Path(args.out), sound * args.volume, args.rate)
        print(f"保存しました：{args.out}")
        return
    print(f"アラーム音を {args.repeat} 回鳴らします（音量 {args.volume}）")
    play(sound, args.rate, parse_device(args.device), args.volume)


def cmd_tone(args: argparse.Namespace) -> None:
    print(f"{args.freq:.0f}Hz を {args.seconds}秒 鳴らします（音量 {args.volume}）")
    play(tone(args.freq, args.seconds, args.rate), args.rate, parse_device(args.device), args.volume)


def main() -> None:
    parser = argparse.ArgumentParser(description="I2S のマイク（C4）とスピーカー（C5）を確かめる")
    parser.add_argument("--device", help="使うデバイス（番号か名前の一部）")
    parser.add_argument("--rate", type=int, default=DEFAULT_RATE, help="サンプリング周波数（既定：48000）")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("devices", help="音声デバイスの一覧").set_defaults(func=cmd_devices)

    p = sub.add_parser("record", help="録音して保存（C4）")
    p.add_argument("--seconds", type=float, default=5)
    p.add_argument("--out", default="rec.wav")
    p.set_defaults(func=cmd_record)

    p = sub.add_parser("meter", help="マイクの音量を表示（C4）")
    p.add_argument("--seconds", type=float, default=30)
    p.set_defaults(func=cmd_meter)

    p = sub.add_parser("play", help="WAV を再生")
    p.add_argument("file")
    p.add_argument("--volume", type=float, default=1.0)
    p.set_defaults(func=cmd_play)

    p = sub.add_parser("rooster", help="アラーム音を鳴らす（C5）")
    p.add_argument("--volume", type=float, default=0.5, help="0.0〜1.0")
    p.add_argument("--repeat", type=int, default=3)
    p.add_argument("--out", help="鳴らさずに WAV に保存する")
    p.set_defaults(func=cmd_rooster)

    p = sub.add_parser("tone", help="正弦波を鳴らす（C5）")
    p.add_argument("--freq", type=float, default=1000)
    p.add_argument("--seconds", type=float, default=3)
    p.add_argument("--volume", type=float, default=0.3, help="0.0〜1.0")
    p.set_defaults(func=cmd_tone)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
