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
- センサー：SEN0142（中身は **MPU-6050**。I2C、アドレス 0x68、SDA=GPIO21・SCL=GPIO22。2026-10-16 確定、PR #30）
- データ型：int16_t × 3（x, y, z軸）→ 6 bytes
- 値の単位：MPU-6050 の加速度の生の値（測定範囲 ±2g のとき **16384 = 1g**）。静止して水平に置くと z ≈ 16384。鶏の寝返り判定（F-03）はこの単位を前提にする
- 送信方式：Notify
- 頻度：イベント発生時（閾値超え）＋ 保険として数秒に1回の定期送信

### Characteristic 3: Environment（温湿度・照度）→ **廃止**（2026-10-17）
- 環境センサーは鶏に搭載すると決めた（Issue #4、`docs/spec-changes.md` X-01）。たまごはこの Characteristic を出さない。UUID（`d5c10a03-…`）は使い回さない

### Characteristic 4: Dock Event（起床/就寝検知）
- 検知元：**巣からポゴピンを通って来る 5V**（2026-10-30 に、充電モジュールの STAT ピンから変更。`docs/spec-changes.md` X-13）。5V を抵抗2本（5V 側 10kΩ・GND 側 15kΩ）で分圧し、ESP32 の ADC（GPIO35、`PinConfig.h` の `DOCK_*`）で読む
- 検知方式：巣の電圧が `DOCK_PRESENT_VOLTS`（既定 4.0V）以上なら「巣から給電されている」とみなす（実測：巣にあるとき 4.95V、出したとき 0.24V）。
  - 給電あり＝たまごが巣にある（巣に戻した＝起床）
  - 給電なし＝たまごが巣から離れた
  - 充電モジュールの STAT は、満充電のときも「充電していない」と同じ表示になり（満充電で巣に戻すと検知できない）、基板の LED にしかつながっていないため使わない。5V の有無なら、満充電でも検知できる
  - たまごは `loop()` で電圧を読み、**`DOCK_DEBOUNCE_MS`（既定300ms）同じ状態が続いたら確定**する（ポゴピンの接触のゆれ対策。実機で調整：E3）
- データ型：uint8_t（0 = 巣にない、1 = 巣にある）→ 1 byte
- 送信方式：**Read と Notify**。値には常に「いま確定している状態」が入っている（起動時の状態も入れておく）
- 頻度：状態が確定して変わったときに Notify
- **取りこぼし対策（Issue #5）**：鶏は、つないだときと **15秒ごと**に Read して、前に知っている状態と違えば「変わった」と扱う（BLE が切れていたあいだに巣に戻した、Notify を取りこぼした、を補う）。鶏が起動して最初に読んだ値は「変化」とは扱わない
- 用途：鶏は「巣にある」に変わったらアラームを止め、サーバーへ `charge_start` をすぐ送る（起床。`docs/api-spec.md` §3-1）

### Battery Service（バッテリー残量、任意）
- BLE 標準の Battery Service（`0x180F`）・Battery Level（`0x2A19`、uint8_t 0〜100 %）。Read と Notify、60秒ごと
- たまごの `PinConfig.h` の `BATTERY_ADC_PIN` を設定したとき（配線が決まったとき：E5）だけ出す。ないときは鶏は読まない
- 鶏は `ingest-sensor-data` の `egg.battery_level` として送る

## データフォーマット方針
- JSON文字列ではなく、バイナリ構造体（struct）をそのままbytesにパックする形式とする（省電力・通信量削減のため）。

## 実装対象
1. たまご側（ESP32/PlatformIO/NimBLE-Arduino）：Peripheral実装
   - 上記のキャラクタリスティック（Audio・Motion・Dock、任意で Battery）のサービス定義
   - 検証用の出力（シリアル）は `esp32dev_debug` などのビルドだけで出す（本番の `esp32dev` は出さない。Issue #34）
   - アドバタイズ設定
   - 各センサーの読み取り→Notify送信処理
2. 鶏側（Raspberry Pi/Python/bleak）：Central実装
   - たまごのスキャン→接続
   - Audio・Motion・Dock の Notify 受信・パース処理、Dock の Read（つないだとき・15秒ごと）
   - 鶏本体のセンサー（A111ミリ波レーダーによる呼吸検知、SPH0645LM4Hマイク）は本仕様の対象外（BLEを介さず鶏内部のPythonで直接処理し、後段でたまごからのBLE受信データと統合する）

## 補足
- たまごユニットはバッテリー駆動（リポ DTP603450 + 充電モジュール SFE-PRT-14380）のため、通信頻度は電力消費を考慮して上記の通り3段階に分けている。

## 鶏側：受け取ったデータの使い方

**（2026-10-17 更新）** 以前ここにあった「1分ごとに1レコードの JSON にまとめて送る」形式は使わない（`docs/spec-changes.md` X-02）。
鶏は、たまごの Motion・Audio から寝返り・いびき・寝言を判定し（`firmware/chicken/detectors.py`、`docs/api-spec.md` §6）、
判定したイベントを1件ずつ計測時刻つきで `ingest-sensor-data` に送る（`docs/api-spec.md` §3-1）。いびき・寝言はたまごのマイクで判定する（鶏のマイクはボタンで話すときの録音に使う）。

### A111呼吸検知の実装方針
Acconeer公式SDK（acconeer-python-exploration）に含まれる `acconeer.exptool.a111.algo.sleep_breathing`（パッケージでは `breathing` に改名）をベースに実装する。何もなくても呼吸数を出す誤検知があるため、反射の強さとピーク位置のばらつきで「人がいて呼吸しているとき」だけ採用する（`radar_filter.py`、Issue #16）。
- このモジュールは「就寝時のようにほぼ静止している人物の呼吸のみを検知する」ことを想定した公式サンプルで、(1)呼吸による体動の抽出 (2)フーリエ変換 (3)判定、の3段階で構成されている。
- レーダーは胸部をカバーする範囲でIQスイープを取得する構成を想定しており、枕元に設置するねるコッコの鶏ユニットの使い方と一致する。
- 閾値は少数の被験者データセットをもとに設定された初期値のため、実機到着後は鶏ユニットの実際の設置位置（枕元からの距離など）に合わせた閾値調整が必要になる見込み。
