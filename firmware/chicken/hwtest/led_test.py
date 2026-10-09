"""C6：LED（WS2812B）の色・明るさを確かめる（docs/hw-verification.md）。

    sudo python3 hwtest/led_test.py --mode colors             # 赤・緑・青・白・オレンジを順に点灯
    sudo python3 hwtest/led_test.py --mode sunrise --seconds 30   # 光アラーム（だんだん明るく）
    sudo python3 hwtest/led_test.py --mode blink               # アラーム中の点滅
    sudo python3 hwtest/led_test.py --mode off                 # 消灯

LED の制御ライブラリ（rpi_ws281x）は root 権限が必要なので sudo で実行する。
データ線は GPIO12（PWM0）を想定。GPIO18 は I2S（マイク・アンプ）と重なるので使わない（C1 を参照）。
"""

from __future__ import annotations

import argparse
import time

from rpi_ws281x import Color, PixelStrip

# ピンごとの PWM チャンネル（rpi_ws281x の仕様）
PWM_CHANNEL = {12: 0, 18: 0, 13: 1, 19: 1}

COLORS = [
    ("赤", (255, 0, 0)),
    ("緑", (0, 255, 0)),
    ("青", (0, 0, 255)),
    ("白", (255, 255, 255)),
    ("朝焼けのオレンジ", (255, 120, 20)),
]


def fill(strip: PixelStrip, rgb: tuple[int, int, int]) -> None:
    for i in range(strip.numPixels()):
        strip.setPixelColor(i, Color(*rgb))
    strip.show()


def mode_colors(strip: PixelStrip, _args: argparse.Namespace) -> None:
    for name, rgb in COLORS:
        print(f"{name} {rgb}")
        fill(strip, rgb)
        time.sleep(2)


def mode_sunrise(strip: PixelStrip, args: argparse.Namespace) -> None:
    print(f"{args.seconds:.0f}秒かけて明るくします（光アラーム）")
    steps = 100
    for step in range(steps + 1):
        ratio = step / steps
        # 暗いうちは赤っぽく、明るくなるにつれて白っぽくする
        rgb = (int(255 * ratio), int(160 * ratio**1.5), int(60 * ratio**2))
        strip.setBrightness(int(args.brightness * ratio))
        fill(strip, rgb)
        if step % 10 == 0:
            print(f"  {step:3d}%  明るさ {int(args.brightness * ratio)}/255  色 {rgb}")
        time.sleep(args.seconds / steps)


def mode_blink(strip: PixelStrip, args: argparse.Namespace) -> None:
    print(f"{args.seconds:.0f}秒間 点滅します（アラーム中の表示）")
    end = time.time() + args.seconds
    on = True
    while time.time() < end:
        fill(strip, (255, 140, 0) if on else (0, 0, 0))
        on = not on
        time.sleep(0.5)


def mode_off(strip: PixelStrip, _args: argparse.Namespace) -> None:
    fill(strip, (0, 0, 0))


MODES = {"colors": mode_colors, "sunrise": mode_sunrise, "blink": mode_blink, "off": mode_off}


def main() -> None:
    parser = argparse.ArgumentParser(description="LED（WS2812B）を確かめる（C6）")
    parser.add_argument("--mode", choices=MODES, default="colors")
    parser.add_argument("--pin", type=int, default=12, help="データ線の GPIO 番号（既定：12）")
    parser.add_argument("--count", type=int, default=2, help="LED の数（既定：2）")
    parser.add_argument("--brightness", type=int, default=128, help="最大の明るさ 0〜255（既定：128）")
    parser.add_argument("--seconds", type=float, default=30, help="sunrise・blink の時間（秒）")
    args = parser.parse_args()

    channel = PWM_CHANNEL.get(args.pin, 0)
    strip = PixelStrip(args.count, args.pin, 800000, 10, False, args.brightness, channel)
    try:
        strip.begin()
    except RuntimeError as error:
        raise SystemExit(
            f"LED を初期化できません：{error}\n"
            "sudo で実行しているか、config.txt に dtparam=audio=off があるか、ピン番号が正しいかを確認してください。"
        ) from error

    try:
        MODES[args.mode](strip, args)
    except KeyboardInterrupt:
        pass
    finally:
        if args.mode != "off":
            time.sleep(1)
            mode_off(strip, args)


if __name__ == "__main__":
    main()
