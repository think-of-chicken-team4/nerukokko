# 鶏（Raspberry Pi）のプログラム

たまごとの BLE、レーダー・温湿度・照度センサー、アラーム（LED・スピーカー）、会話（録音→返事の再生）、サーバーとの通信をまとめて動かします。

> **10/23 の変更**：トサカボタンは廃止し、会話は**タッチディスプレイ（DSI）**から始めます（`docs/dsi-display-spec.md`）。画面（`eyes/`）は本体とは別のプロセスで動き、状態と操作をファイルでやりとりします（`eyes/ipc.py`）。画面が落ちても、アラーム・BLE・送信は止まりません。
通信の決まりは `docs/api-spec.md`（§3・§6）、たまごとの BLE は `docs/ble-protocol.md`。

**実機で調整する値は、すべて設定ファイル（`/etc/nerukokko/chicken.env`）に書くだけで変えられます。** コードを直す必要はありません（下の「調整する値」）。

## ファイル

| ファイル | 役割 |
|---|---|
| `main.py` | 入口（`python3 main.py`） |
| `app.py` | 全体の動き（30秒ごとの同期、1秒ごとの判定と送信、アラーム、ボタンの会話） |
| `integration_config.py` | 設定（環境変数）。値の意味と既定値はここと `.env.example` |
| `api_client.py`・`uplink.py`・`outbox.py` | サーバーとの通信。送れなかったデータはファイルに残して送り直す（24時間分） |
| `egg_link.py`・`sensor_data.py`・`ble_config.py` | たまごとの BLE。充電の状態は15秒ごとにも読み直す |
| `detectors.py` | 寝返り・いびき・寝言・呼吸数の判定（ハードウェアに依存しない） |
| `alarm.py` | アラームの時刻（ファイルに保存。Wi-Fi が切れても鳴る） |
| `radar_sensor.py`・`radar_filter.py` | A111 レーダー（呼吸・在床）。誤検知を防ぐフィルタ |
| `environment_sensor.py` | 温湿度・照度（つながっているチップを自動で見分ける） |
| `hardware.py` | LED・スピーカー・録音。ないときは何もしない部品になる |
| `deploy/` | 自動起動（systemd）の設定とインストール用のスクリプト |
| `tests/` | ハードウェアなしで動くテスト（`python3 -m unittest discover -s tests`） |
| `hwtest/` | 実機検証のツール（`docs/hw-verification.md`） |

## セットアップ（ラズパイ1台につき1回）

1. **OS と Python**：`docs/hw-verification.md` §3-3 のとおり（32bit の Raspberry Pi OS、SSH・I2C・SPI を有効、つまずく点の対処も §3-3）。
2. **リポジトリを置く**：
   ```bash
   sudo git clone https://github.com/think-of-chicken-team4/nerukokko.git /opt/nerukokko
   cd /opt/nerukokko/firmware/chicken
   sudo apt install -y libportaudio2 alsa-utils i2c-tools libhdf5-103 libopenblas0
   sudo python3 -m venv --system-site-packages .venv
   sudo .venv/bin/pip install -r requirements.txt
   ```
3. **音（マイク・スピーカー）**：C4・C5 で確かめた設定（`/boot/firmware/config.txt` の I2S の dtoverlay）にする。`aplay -L` と `.venv/bin/python hwtest/audio_test.py devices` で名前を確かめ、あとで `AUDIO_OUTPUT_DEVICE`・`MIC_DEVICE` に書く。
4. **鶏をアカウントに登録する**：鶏で `cat /sys/class/net/wlan0/address` を実行して MAC アドレスを調べ、Webアプリの「デバイス」→「登録してトークンを発行」。表示されたトークンを控える（**一度しか表示されない**）。
5. **自動起動を入れる**（レーダーの exploration server の場所も指定する）。画面（目・タッチ）は、デスクトップにログインしているふつうのユーザーで `sudo` を付けて実行すると、そのユーザーで自動起動する（日本語の文字は `sudo apt install -y fonts-noto-cjk`）：
   ```bash
   sudo ./deploy/install.sh /home/pi/acconeer/out/acc_exploration_server_a111
   sudo nano /etc/nerukokko/chicken.env   # SUPABASE_URL・SUPABASE_PUBLISHABLE_KEY・DEVICE_TOKEN を書く
   sudo systemctl restart nerukokko-chicken nerukokko-eyes
   journalctl -u nerukokko-chicken -f     # 動いているかを見る（画面は nerukokko-eyes）
   ```
6. **確かめる**：Webアプリの「デバイス」で鶏が「オンライン」になる。たまごの電源を入れると、たまごも出てくる。

**設定ファイルの書き方**：`名前=値` を1行に1つ。**値の行の後ろにコメントを書かない**（systemd では値の一部になる）。秘密の値（`DEVICE_TOKEN`）が入るので、他人に見せたり Git に入れたりしない。

## 調整する値（実機検証の結果を入れる）

| 検証 | 設定（`/etc/nerukokko/chicken.env`） | 既定値 | 決め方 |
|---|---|---|---|
| E1 寝返り | `TURN_MIN_CHANGE_G`・`TURN_MERGE_SEC` | 0.05・10 | 寝返り10回をきちんと数え、呼吸で反応しない値（たまご側の `MOTION_THRESHOLD_G` と合わせる） |
| E2 いびき・寝言 | `SOUND_LOUD_RATIO`・`SOUND_MIN_LOUD_LEVEL` | 3.0・300 | `hwtest_mic` の音量の記録から、静かなとき・いびきのときの値を見て決める |
| C2 レーダー | `RADAR_PRESENCE_ENV_MAX`・`RADAR_BREATHING_STD_MM`・`RADAR_PRESENCE_HOLD_SEC` | 100・0.5・60 | ベッドの置き場所で「人なし・呼吸・息止め」を測って決める（#16） |
| C3 温湿度 | `ENV_TEMP_OFFSET_C`・`ENV_HUMIDITY_OFFSET_PCT` | 0・0 | 市販の温湿度計との差 |
| C4 マイク | `MIC_DEVICE`・`MIC_GAIN`・`MIC_VOICE_LEVEL`・`MIC_SILENCE_SEC` | 既定・1.0・500・1.5 | 会話を始めて話し、話し終わりで録音が止まる値 |
| C5 スピーカー | `AUDIO_OUTPUT_DEVICE`・`SPEAKER_VOLUME` | 既定・0.8 | 枕元でちょうどよく聞こえる音量 |
| C6 LED | `LED_PIN`・`LED_COUNT`・`LED_BRIGHTNESS` | 12・2・180 | 配線と、まぶしすぎない明るさ |
| D1〜D3 ディスプレイ | `DISPLAY_POLL_SEC`・`DISPLAY_STALE_SEC`・`MENU_TIMEOUT_SEC` | 0.3・5・20 | メニューのボタンの大きさ・位置（`eyes/menu.py`）は指で押しやすいか確かめる。`docs/dsi-display-spec.md` §5 |
| — アラーム | `ALARM_MAX_RING_SEC`・`ALARM_SUNRISE_SEC` | 1800・60 | 好みで |

値を変えたら `sudo systemctl restart nerukokko-chicken`。測った値と決めた値は Issue に残す。

## Mac・PC で動かす（ハードウェアなし）

```bash
cd firmware/chicken
python3 -m unittest discover -s tests          # 判定・送信・アラームのテスト
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=… DEVICE_TOKEN=… RADAR_ENABLED=false python3 main.py
```

LED・ボタン・録音・レーダーは、ライブラリやハードウェアがなければ何もしない部品になります（ログに「使えません」と出る）。BLE（bleak）は PC の Bluetooth を使います。
