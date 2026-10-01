"""C7：トサカボタンの押下検知とチャタリングを確かめる（docs/hw-verification.md）。

    python3 hwtest/button_test.py --pin 16 --seconds 60

ボタンの片側を GPIO、もう片側を GND につなぐ（内部プルアップを使う）。
押すたびに「押していた時間」と「1回押す間にピンが何回変化したか（チャタリング）」を表示する。
変化が2回（押す・離す）より多ければチャタリングがあるので、その最大の時間を本番のデバウンス時間の参考にする。
"""

from __future__ import annotations

import argparse
import threading
import time

from gpiozero import Button

SETTLE_SEC = 0.15  # 最後の変化からこの時間なにもなければ「1回の操作が終わった」とみなす


def main() -> None:
    parser = argparse.ArgumentParser(description="トサカボタンを確かめる（C7）")
    parser.add_argument("--pin", type=int, default=16, help="ボタンをつないだ GPIO 番号（既定：16）")
    parser.add_argument("--seconds", type=float, default=60, help="計測する時間（秒）")
    args = parser.parse_args()

    # bounce_time=None にして、チャタリングも含めてすべての変化を受け取る
    button = Button(args.pin, pull_up=True, bounce_time=None)
    lock = threading.Lock()
    edges: list[tuple[float, bool]] = []  # (時刻, 押されている)

    def on_change(pressed: bool) -> None:
        with lock:
            edges.append((time.monotonic(), pressed))

    button.when_pressed = lambda: on_change(True)
    button.when_released = lambda: on_change(False)

    print(f"GPIO{args.pin} のボタンを {args.seconds:.0f}秒間 何回か押してください（Ctrl+C で終了）。")
    presses = 0
    chatter_presses = 0
    max_bounce_ms = 0.0
    end = time.monotonic() + args.seconds
    try:
        while time.monotonic() < end:
            time.sleep(0.05)
            with lock:
                # ボタンが離されて、変化が落ち着いてから1回分としてまとめる（長押し中は待つ）
                if not edges or edges[-1][1] or time.monotonic() - edges[-1][0] < SETTLE_SEC:
                    continue
                burst = list(edges)
                edges.clear()
            first_press = next((t for t, pressed in burst if pressed), None)
            last_release = next((t for t, pressed in reversed(burst) if not pressed), None)
            if first_press is None:
                continue
            presses += 1
            held = (last_release - first_press) if last_release else 0.0
            extra = len(burst) - 2
            press_times = [t for t, pressed in burst if pressed]
            bounce_ms = (press_times[-1] - press_times[0]) * 1000 if len(press_times) > 1 else 0.0
            max_bounce_ms = max(max_bounce_ms, bounce_ms)
            if extra > 0:
                chatter_presses += 1
            print(
                f"押した #{presses}：押していた時間 {held:.2f}秒  ピンの変化 {len(burst)}回"
                + (f"（チャタリングあり、揺れ {bounce_ms:.0f}ms）" if extra > 0 else "（チャタリングなし）")
            )
    except KeyboardInterrupt:
        pass

    print("\n==== まとめ（Issue に貼ってください）====")
    print(f"押した回数：{presses}回　チャタリングがあった回数：{chatter_presses}回　最大の揺れ：{max_bounce_ms:.0f}ms")
    print("→ 本番のデバウンス時間は、最大の揺れより長め（例：その2倍、最低50ms）にする。")


if __name__ == "__main__":
    main()
