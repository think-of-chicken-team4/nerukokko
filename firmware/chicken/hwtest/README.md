# 鶏ユニットの実機検証ツール

実機検証（`docs/hw-verification.md`）で使うツールです。本番のプログラムではありません。
準備（OS・Python の仮想環境）は `docs/hw-verification.md` §3-3 を参照してください。

| ファイル | 検証 | 使い方の例 |
|---|---|---|
| `check_setup.py` | C1 セットアップ・ピン | `python3 hwtest/check_setup.py` |
| `radar_test.py` | C2 ミリ波レーダー | `python3 hwtest/radar_test.py --count` |
| `env_sensor_test.py` | C3 温湿度・照度 | `python3 hwtest/env_sensor_test.py --count 12` |
| `audio_test.py` | C4 マイク・C5 スピーカー | `python3 hwtest/audio_test.py record` / `rooster --volume 0.5` |
| `led_test.py` | C6 LED | `sudo .venv/bin/python hwtest/led_test.py --mode sunrise` |
| `button_test.py` | C7 トサカボタン | `python3 hwtest/button_test.py --seconds 60` |
| `ble_monitor.py` | E4 BLE（E1・E2・E5 にも使える） | `python3 hwtest/ble_monitor.py --minutes 30` |

どれも `firmware/chicken` フォルダで実行します。`-h` を付けると使い方が表示されます。
結果（画面の「まとめ」や作られた CSV）は、項目ごとの Issue に貼ってください。
