"""C1：ラズパイのセットアップ状況を確認する（docs/hw-verification.md）。

    python3 hwtest/check_setup.py

OS・インターフェース（I2C / SPI / I2S / Bluetooth）・音声デバイス・I2C の機器・GPIO の割り当て・
Python パッケージを調べて一覧にする。設定は変更しない（読むだけ）。
結果をそのまま Issue に貼ってください（Wi-Fi の名前やパスワードは表示しない）。
"""

from __future__ import annotations

import importlib
import platform
import shutil
import subprocess
import sys
from pathlib import Path

OK = "✅"
WARN = "⚠️ "
NG = "❌"

# I2C でよく使うアドレスと機器の候補
I2C_GUESSES = {
    0x23: "BH1750 照度センサー",
    0x5C: "BH1750 照度センサー（ADDR=H）",
    0x40: "SHT20 / HTU21D / Si7021 温湿度センサー",
    0x44: "SHT3x 温湿度センサー",
    0x45: "SHT3x 温湿度センサー",
    0x38: "AHT10 / AHT20 温湿度センサー",
}

# 使う予定の GPIO（docs/hw-verification.md C1 のピン割り当て案）
PLANNED_GPIOS = "2,3,8-12,16,18-21"

PYTHON_PACKAGES = {
    "bleak": "BLE（たまごとの通信）",
    "numpy": "計算",
    "sounddevice": "マイク・スピーカー",
    "smbus2": "I2C センサー",
    "gpiozero": "トサカボタン",
    "rpi_ws281x": "LED（WS2812B）",
    "acconeer.exptool": "ミリ波レーダー（A111）",
    "requests": "サーバー通信",
}


def run(command: list[str]) -> str:
    """コマンドを実行して出力を返す。コマンドがなければ空文字。"""
    if shutil.which(command[0]) is None:
        return ""
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return (result.stdout + result.stderr).strip()


def section(title: str) -> None:
    print(f"\n==== {title} ====")


def check_system() -> None:
    section("本体・OS")
    model_path = Path("/proc/device-tree/model")
    model = model_path.read_text(errors="ignore").strip("\x00\n") if model_path.exists() else "不明"
    print(f"本体：{model}")
    os_release = Path("/etc/os-release")
    if os_release.exists():
        for line in os_release.read_text().splitlines():
            if line.startswith("PRETTY_NAME="):
                print(f"OS：{line.split('=', 1)[1].strip(chr(34))}")
    print(f"カーネル：{platform.release()}  アーキテクチャ：{platform.machine()}（{run(['getconf', 'LONG_BIT']) or '?'}bit）")
    version_ok = sys.version_info >= (3, 11)
    print(f"{OK if version_ok else NG} Python {platform.python_version()}（3.11 以上が必要）")


def find_config_txt() -> Path | None:
    for candidate in (Path("/boot/firmware/config.txt"), Path("/boot/config.txt")):
        if candidate.exists():
            return candidate
    return None


def check_config_txt() -> None:
    section("config.txt の設定")
    path = find_config_txt()
    if path is None:
        print(f"{NG} config.txt が見つかりません")
        return
    lines = [line.strip() for line in path.read_text(errors="ignore").splitlines()]
    active = [line for line in lines if line and not line.startswith("#")]
    print(f"場所：{path}")

    def has(setting: str) -> bool:
        return any(line.replace(" ", "") == setting for line in active)

    print(f"{OK if has('dtparam=i2c_arm=on') else NG} dtparam=i2c_arm=on（I2C：照度・温湿度センサー）")
    print(f"{OK if has('dtparam=spi=on') else NG} dtparam=spi=on（SPI：ミリ波レーダー A111）")
    print(f"{OK if has('dtparam=audio=off') else WARN} dtparam=audio=off（本体のアナログ音声を止める。LED を PWM で動かすときに必要）")
    overlays = [line for line in active if line.startswith("dtoverlay=")]
    print("dtoverlay の一覧：" + (", ".join(overlays) if overlays else "なし"))
    if not any("googlevoicehat" in o or "i2s" in o or "hifiberry" in o or "max98357" in o for o in overlays):
        print(f"{WARN} I2S の音声用 dtoverlay が見当たりません（マイク・アンプを使うには必要。C4・C5 を参照）")


def check_devices() -> None:
    section("デバイスファイル")
    for path, purpose in (
        ("/dev/i2c-1", "I2C バス1"),
        ("/dev/spidev0.0", "SPI0（A111）"),
        ("/dev/gpiochip0", "GPIO"),
    ):
        print(f"{OK if Path(path).exists() else NG} {path}（{purpose}）")


def check_audio() -> None:
    section("音声デバイス（I2S のマイク・アンプ）")
    playback = run(["aplay", "-l"])
    capture = run(["arecord", "-l"])
    print("再生（aplay -l）：")
    print("  " + (playback.replace("\n", "\n  ") if playback else "取得できません"))
    print("録音（arecord -l）：")
    print("  " + (capture.replace("\n", "\n  ") if capture else "取得できません"))


def check_bluetooth_and_network() -> None:
    section("Bluetooth・ネットワーク")
    show = run(["bluetoothctl", "show"])
    powered = "Powered: yes" in show
    print(f"{OK if powered else NG} Bluetooth（{'オン' if powered else 'オフ、または bluetoothctl がない'}）")
    wifi = run(["iwgetid", "-r"])
    print(f"{OK if wifi else WARN} Wi-Fi に接続{'しています' if wifi else 'していない（有線なら問題なし）'}")


def check_i2c_bus() -> None:
    section("I2C バス1 の機器")
    try:
        import smbus2
    except ImportError:
        print(f"{NG} smbus2 が入っていないため調べられません（pip install -r hwtest/requirements.txt）")
        return
    try:
        bus = smbus2.SMBus(1)
    except OSError as error:
        print(f"{NG} I2C バスを開けません：{error}")
        return
    found = []
    with bus:
        for address in range(0x03, 0x78):
            try:
                bus.read_byte(address)
            except OSError:
                continue
            found.append(address)
    if not found:
        print(f"{WARN} 機器が見つかりません（配線・電源・I2C の有効化を確認）")
    for address in found:
        print(f"  0x{address:02X}：{I2C_GUESSES.get(address, '不明')}")


def check_gpio() -> None:
    section(f"GPIO の現在の機能（予定しているピン：{PLANNED_GPIOS}）")
    output = run(["pinctrl", "get", PLANNED_GPIOS]) or run(["raspi-gpio", "get"])
    print(output if output else f"{WARN} pinctrl / raspi-gpio がないため取得できません")


def check_python_packages() -> None:
    section("Python パッケージ")
    for module, purpose in PYTHON_PACKAGES.items():
        try:
            importlib.import_module(module)
            print(f"{OK} {module}（{purpose}）")
        except Exception as error:  # noqa: BLE001  import 時のエラーはすべて「使えない」として表示する
            print(f"{NG} {module}（{purpose}）：{type(error).__name__}")


def main() -> None:
    print("ねるコッコ 鶏ユニット セットアップ確認（C1）")
    check_system()
    check_config_txt()
    check_devices()
    check_audio()
    check_bluetooth_and_network()
    check_i2c_bus()
    check_gpio()
    check_python_packages()
    print("\n結果を Issue にそのまま貼ってください。")


if __name__ == "__main__":
    main()
