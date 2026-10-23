"""鶏のプログラムの設定。すべて環境変数から読む（ラズパイでは /etc/nerukokko/chicken.env。見本は .env.example）。
値の行にコメントを書かない（systemd では値の一部になる）。コメントは上の行に書く。

「実機で調整」と書いた値は、docs/hw-verification.md の検証（C1〜C8・E1〜E5）の結果で決める。
値を変えたら、測った値を Issue に残す（CLAUDE.md §3-1）。
"""

from __future__ import annotations

import os
from pathlib import Path


def _raw(name: str) -> str:
    # systemd の EnvironmentFile は行の途中の「#」をコメントとして扱わないので、# で始まる値は空とみなす
    value = os.environ.get(name, "").strip()
    return "" if value.startswith("#") else value


def _str(name: str, default: str = "") -> str:
    return _raw(name) or default


def _float(name: str, default: float) -> float:
    value = _raw(name)
    return float(value) if value else default


def _int(name: str, default: int) -> int:
    value = _raw(name)
    return int(value) if value else default


def _bool(name: str, default: bool) -> bool:
    value = _raw(name).lower()
    return default if not value else value in ("1", "true", "yes", "on")


FIRMWARE_VERSION = "chicken-0.3.0"

# ===== サーバー（docs/api-spec.md §1-3）=====
SUPABASE_URL = _str("SUPABASE_URL")  # 例：https://xxxx.supabase.co（ローカルなら http://<PC の IP>:54321）
SUPABASE_PUBLISHABLE_KEY = _str("SUPABASE_PUBLISHABLE_KEY")  # sb_publishable_…（公開してよい値）
DEVICE_TOKEN = _str("DEVICE_TOKEN")  # Webアプリの「デバイス」で鶏を登録したときに出た値（秘密）

# ===== データの置き場（送信待ちのデータ・アラーム・音声のキャッシュ）=====
DATA_DIR = Path(_str("DATA_DIR", str(Path.home() / ".local/share/nerukokko")))

# ===== 通信の間隔 =====
SYNC_INTERVAL_SEC = _float("SYNC_INTERVAL_SEC", 30)  # device-sync（api-spec §3-2）
SEND_INTERVAL_SEC = _float("SEND_INTERVAL_SEC", 60)  # ingest-sensor-data（§3-1。起床はすぐ送る）
ENVIRONMENT_INTERVAL_SEC = _float("ENVIRONMENT_INTERVAL_SEC", 60)  # 温湿度・照度を測る間隔

# ===== アラーム（F-01・F-02）=====
ALARM_MAX_RING_SEC = _float("ALARM_MAX_RING_SEC", 30 * 60)  # 巣に戻らなくても、この時間で止める
ALARM_SUNRISE_SEC = _float("ALARM_SUNRISE_SEC", 60)  # LED をだんだん明るくする時間
ALARM_PHRASE = _str("ALARM_PHRASE", "コケコッコー！おはようコケ！起きる時間だコケ！たまごを巣に戻してほしいコケ！")

# ===== 寝返り（detectors.TurnDetector。実機で調整：E1・Issue #33）=====
TURN_MIN_CHANGE_G = _float("TURN_MIN_CHANGE_G", 0.05)  # たまごの加速度がこれ（g）以上変わったら「動きあり」
TURN_MERGE_SEC = _float("TURN_MERGE_SEC", 10)  # この時間以内の動きは寝返り1回

# ===== いびき・寝言（detectors.SoundDetector。たまごのマイクの音量で判定。実機で調整：E2）=====
SOUND_LOUD_RATIO = _float("SOUND_LOUD_RATIO", 3.0)  # 背景の音量のこの倍を超えたら「大きな音」
SOUND_MIN_LOUD_LEVEL = _float("SOUND_MIN_LOUD_LEVEL", 300)  # 静かな部屋で小さな音を拾わないための下限

# ===== A111 ミリ波レーダー（呼吸・在床。radar_filter.py。実機で調整：C2・Issue #16）=====
RADAR_ENABLED = _bool("RADAR_ENABLED", True)
RADAR_USE_MOCK = _bool("RADAR_USE_MOCK", False)  # レーダーなしで試すとき true（ランダムな値になる）
# 実機（ラズパイ＋A111）で動いたのは、exploration server（acc_exploration_server_a111）に socket でつなぐ方式（C2）
RADAR_LINK = _str("RADAR_LINK", "socket")  # "socket" | "spi" | "uart"
RADAR_HOST = _str("RADAR_HOST", "127.0.0.1")
RADAR_SERIAL_PORT = _str("RADAR_SERIAL_PORT") or None
RADAR_SENSOR_ID = _int("RADAR_SENSOR_ID", 1)
RADAR_PRESENCE_ENV_MAX = _float("RADAR_PRESENCE_ENV_MAX", 100)  # これ以上の反射で「人がいる」（人なし 42.5／人あり 252）
RADAR_BREATHING_STD_MM = _float("RADAR_BREATHING_STD_MM", 0.5)  # ばらつきがこれ以上で「呼吸している」（胸 1.46／息止め 0.14）
RADAR_WINDOW_SEC = _float("RADAR_WINDOW_SEC", 10)
RADAR_PRESENCE_HOLD_SEC = _float("RADAR_PRESENCE_HOLD_SEC", 60)  # いる／いないが変わったと判断するまで（api-spec §6-3：1分）

# ===== 温湿度・照度（environment_sensor.py。実機で調整：C3）=====
I2C_BUS_NUMBER = _int("I2C_BUS_NUMBER", 1)
ENV_TEMP_OFFSET_C = _float("ENV_TEMP_OFFSET_C", 0.0)  # 市販の温湿度計との差（ラズパイの熱で高めに出る分を引く。例：-1.5）
ENV_HUMIDITY_OFFSET_PCT = _float("ENV_HUMIDITY_OFFSET_PCT", 0.0)

# ===== マイク（SPH0645、ボタンで話すときの録音。実機で調整：C4）=====
MIC_DEVICE = _str("MIC_DEVICE") or None  # sounddevice のデバイス名か番号（hwtest/audio_test.py devices で確認）
MIC_SAMPLE_RATE = _int("MIC_SAMPLE_RATE", 16000)
MIC_GAIN = _float("MIC_GAIN", 1.0)  # 声が小さいときは上げる
MIC_VOICE_LEVEL = _float("MIC_VOICE_LEVEL", 500)  # これより大きい音を「話している」とみなす（16bit の実効値）
MIC_SILENCE_SEC = _float("MIC_SILENCE_SEC", 1.5)  # 話し終わってこの時間静かなら録音を止める
MIC_MAX_SEC = _float("MIC_MAX_SEC", 12)  # 録音の最長（サーバーは約15秒・512KB まで）

# ===== スピーカー（MAX98357A。実機で調整：C5）=====
AUDIO_OUTPUT_DEVICE = _str("AUDIO_OUTPUT_DEVICE") or None  # aplay -D に渡す名前（例：plughw:CARD=sndrpihifiberry）。空なら既定
SPEAKER_VOLUME = _float("SPEAKER_VOLUME", 0.8)  # 0〜1

# ===== LED（WS2812B。実機で調整：C6）=====
LED_PIN = _int("LED_PIN", 12)  # GPIO 番号（GPIO18 は I2S と重なるので使わない）
LED_COUNT = _int("LED_COUNT", 2)
LED_BRIGHTNESS = _int("LED_BRIGHTNESS", 180)  # 0〜255

# ===== 画面（DSI。本体と別プロセスの eyes とファイルでやりとりする。実機で調整：D1〜D3）=====
DISPLAY_STATE_PATH = DATA_DIR / "display.json"  # 本体 → 画面（表情・会話中・アラーム中）
DISPLAY_COMMAND_PATH = DATA_DIR / "display_command.json"  # 画面 → 本体（タッチで「話す」）
DISPLAY_POLL_SEC = _float("DISPLAY_POLL_SEC", 0.3)  # 状態を書く・操作を読む間隔
DISPLAY_STALE_SEC = _float("DISPLAY_STALE_SEC", 5.0)  # 状態がこれより古いと、本体が止まったとみなす
MENU_TIMEOUT_SEC = _float("MENU_TIMEOUT_SEC", 20.0)  # 何も触らないとメニューから目の画面へ戻る
