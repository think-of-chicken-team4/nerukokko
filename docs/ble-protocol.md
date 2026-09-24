# ねるコッコ BLE通信仕様書（鶏⇔たまご）

## プロジェクト概要
睡眠サポートデバイス「ねるコッコ」の鶏(にわとり)ユニットとたまごユニット間のBLE通信仕様。
- 鶏ユニット：Raspberry Pi 3 Model B V1.2、Python、BLE通信は bleak ライブラリを使用（Central役）
- たまごユニット：ESPr Developer 32（ESP-WROOM-32）、PlatformIO、BLE通信は NimBLE-Arduino を使用（Peripheral役）

## 通信方向
- 一方向のみ：たまご → 鶏
- 鶏からたまごへのコマンド送信（Write）は不要。GATTキャラクタリスティックは Read/Notify のみで構成する。

## GATTサービス構成
カスタムUUID（128bit、共通ベースUUIDの末尾のみ変更）で1サービス・4キャラクタリスティックを構成する。

### Characteristic 1: Audio Level（マイク音量レベル）
- センサー：PDMマイク ADA-4346
- データ型：uint16_t（音量値 0–65535）→ 2 bytes
- 送信方式：Notify
- 頻度：0.2〜0.5秒ごと（高頻度）

### Characteristic 2: Motion Event（加速度）
- センサー：SEN0142
- データ型：int16_t × 3（x, y, z軸）→ 6 bytes
- 送信方式：Notify
- 頻度：イベント発生時（閾値超え）＋ 保険として数秒に1回の定期送信

### Characteristic 3: Environment（温湿度・照度）
- センサー：温湿度 M0235-1747、照度 SEN0097
- データ型：float temperature, float humidity, uint16_t lux → 10 bytes（まとめて1キャラクタリスティックに格納）
- 送信方式：Notify
- 頻度：30秒〜1分ごと（低頻度）

### Characteristic 4: Dock Event（起床/就寝検知）
- 検知元：充電モジュール SFE-PRT-14380（MCP73831搭載）のSTATピン
- 検知方式：STATピンはオープンドレイン出力。充電中はLOW、充電していない時はHi-Z（プルアップ抵抗で外部からHIGHに引き上げる）。
  - HIGH→LOW（立ち下がりエッジ）＝充電開始＝たまごが巣に戻った＝起床
  - LOW→HIGH（立ち上がりエッジ）＝充電停止＝たまごが巣から離れた＝就寝開始
  - ESP32のGPIOで割り込み検知する（プルアップ抵抗 4.7k〜47kΩ程度を追加）
- データ型：uint8_t（0 = undocked/就寝開始、1 = docked/起床）→ 1 byte
- 送信方式：Notify
- 頻度：エッジ検知時のみ（イベント駆動、消費電力への影響はほぼゼロ）
- 用途：鶏側でこのイベントを受け取り、起床タイミングでB担当の睡眠スコア計算処理を発火させるトリガーとして使う想定

## データフォーマット方針
- JSON文字列ではなく、バイナリ構造体（struct）をそのままbytesにパックする形式とする（省電力・通信量削減のため）。

## 実装対象
1. たまご側（ESP32/PlatformIO/NimBLE-Arduino）：Peripheral実装
   - 上記4キャラクタリスティックのサービス定義
   - アドバタイズ設定
   - 各センサーの読み取り→Notify送信処理
2. 鶏側（Raspberry Pi/Python/bleak）：Central実装
   - たまごのスキャン→接続
   - 4キャラクタリスティックのNotify受信・パース処理
   - 鶏本体のセンサー（A111ミリ波レーダーによる呼吸検知、SPH0645LM4Hマイク）は本仕様の対象外（BLEを介さず鶏内部のPythonで直接処理し、後段でたまごからのBLE受信データと統合する）

## 補足
- たまごユニットはバッテリー駆動（リポ DTP603450 + 充電モジュール SFE-PRT-14380）のため、通信頻度は電力消費を考慮して上記の通り3段階に分けている。

## 鶏側：センサー統合処理の設計

### データソース
1. 鶏本体で直接処理：A111ミリ波レーダー（呼吸検知）、SPH0645LM4Hマイク（I2S）
2. BLE経由でたまごから受信：Audio Level, Motion Event, Environment, Dock Event（本仕様書で定義済み）

### 統合フォーマット
1レコード（JSON）にまとめて、一定間隔（例：1分ごと）でSupabaseに送信する方式とする。

```json
{
  "timestamp": "2026-07-23T02:15:00Z",
  "chicken": {
    "breathing_rate": 14.2,
    "mic_level": 320
  },
  "egg": {
    "audio_level": 12345,
    "motion": {"x": -100, "y": 250, "z": 16000},
    "temperature": 26.5,
    "humidity": 55.2,
    "lux": 300,
    "dock_event": null
  }
}
```

### A111呼吸検知の実装方針
Acconeer公式SDK（acconeer-python-exploration）に含まれる `acconeer.exptool.a111.algo.sleep_breathing` モジュールをベースに実装する。
- このモジュールは「就寝時のようにほぼ静止している人物の呼吸のみを検知する」ことを想定した公式サンプルで、(1)呼吸による体動の抽出 (2)フーリエ変換 (3)判定、の3段階で構成されている。
- レーダーは胸部をカバーする範囲でIQスイープを取得する構成を想定しており、枕元に設置するねるコッコの鶏ユニットの使い方と一致する。
- 閾値は少数の被験者データセットをもとに設定された初期値のため、実機到着後は鶏ユニットの実際の設置位置（枕元からの距離など）に合わせた閾値調整が必要になる見込み。
