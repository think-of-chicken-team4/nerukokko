# nerukokko
# ねるコッコ

光・声・卵で睡眠をやさしく整える、鶏型スリープアシスタント

創造設計 4班

## 目次

- [コンセプト](#コンセプト)
- [製品概要](#製品概要)
- [システム構成](#システム構成)
- [開発環境・技術スタック](#開発環境技術スタック)
- [ディレクトリ構成](#ディレクトリ構成)
- [ドキュメント](#ドキュメント)
- [開発の進め方](#開発の進め方)
- [メンバー](#メンバー)

## コンセプト

にわとりと一緒に整える朝と夜

睡眠不足は現代人の大きな課題です。既存の睡眠トラッカーは無機質で続けにくく、計測から改善提案までを一体化した製品は多くありません。「ねるコッコ」は、計測・記録・改善提案・朝の会話を1台で完結し、装着不要で毎日楽しく続けられる睡眠改善体験を提供することを目標にしています。

- **利用対象者**：睡眠に悩みを抱える10〜30代の学生・社会人
- **キーワード**：睡眠改善 / キャラクター / 生活習慣
- **制限事項**：小児への光刺激に注意、Wi-Fi環境が必要（鶏ユニット）、カメラは非搭載（プライバシー配慮）

## 製品概要

にわとり型デバイスと枕元の卵センサーが睡眠を自動計測。朝は光と声でやさしく起こし、夕方には会話で今夜の睡眠改善を提案するスマート睡眠アシスタントです。

3ユニット構成：

| ユニット | 役割 |
|---|---|
| 🐔 にわとり本体 | LED光目覚まし、スピーカー・マイクによる音声会話、温湿度・照度・ミリ波レーダー計測、たまごとのBLE受信・クラウドとの通信を担う中枢 |
| 🥚 たまごセンサー | 加速度センサーによる寝返り検出、マイクによるいびき・寝言検出、装着不要でベッドに置くだけ |
| 🪺 巣（充電ステーション） | たまごの充電。充電開始検知＝アラーム停止（二度寝防止） |

主な機能：起床アシスト／音声会話／睡眠計測（寝返り・呼吸）／音響パターン検出（いびき・寝言）／環境モニタリング／睡眠提案（カレンダー連携）／二度寝防止／睡眠総括（アプリでグラフ・履歴確認）

## システム構成

鶏ユニットが中枢（ゲートウェイ）となり、たまごとはBLEで、クラウドとはHTTP RESTで通信する構成です。

```
[Webアプリ (Next.js)]
        ↕ HTTP REST
[バックエンド / DB (Supabase)]
   ├─ Edge Functions（センサー取込・AI会話・就寝提案・朝サマリー）
   ├─ PostgreSQL
   └─ 外部API連携（Gemini / Google Calendar / Google STT・TTS）
        ↕ Wi-Fi (HTTP REST)
[鶏ユニット (Raspberry Pi 3 Model B / Python)]
   ├─ ミリ波レーダー（Acconeer A111、公式SDKで呼吸検知）
   ├─ マイク（SPH0645LM4H, I2S）、LED、スピーカー、温湿度・照度センサー
   └─ BLE Central（bleakでたまごからのNotify受信）
        ↕ BLE（たまご→鶏の一方向、Notifyのみ）
[たまごユニット (ESP32 / PlatformIO / NimBLE-Arduino, BLE Peripheral)]
   ├─ 加速度センサー、PDMマイク（ADA-4346）、温湿度・照度センサー
   └─ 充電モジュールのSTATピンでドック検知（起床/就寝）
        ↕ 物理接続（充電）
[巣（充電ステーション）]
```

### BLE通信仕様（鶏⇔たまご）
- 通信方向：たまご→鶏の一方向のみ（鶏からたまごへのWrite/コマンド送信はなし）
- GATT Characteristicは4種類（詳細は `docs/ble-protocol.md` を参照）：
  - **Audio Level**：マイク音量レベル（uint16_t、0.2〜0.5秒ごとNotify）
  - **Motion Event**：加速度x/y/z（int16_t×3、イベント時＋数秒に1回Notify）
  - **Environment**：温湿度・照度（float×2+uint16_t、30秒〜1分ごとNotify）
  - **Dock Event**：起床/就寝検知（uint8_t、充電モジュールSTATピンのエッジ検知時のみNotify）
- データ形式：JSONではなくバイナリ構造体（struct）をそのままパックする方式

### 起床・二度寝防止の設計思想
「ユーザーがベッド上にいるか」ではなく「たまごが巣に戻ったか（充電開始＝Dock Event）」をBLE経由で検知してアラームを停止する。

睡眠スコアは以下の重み付けで算出（詳細は `docs/software-spec.md` を参照）：

```
睡眠スコア = 40×睡眠効率 + 15×寝返りバランス + 15×静音度 + 15×呼吸安定性 + 15×環境適合度
```

## 開発環境・技術スタック

| 領域 | 決定内容 |
|---|---|
| Webアプリ | Next.js（React + TypeScript） |
| 鶏ユニット | Raspberry Pi 3 Model B、Python、Acconeer公式SDK（A111制御）、bleak（BLE Central） |
| たまごファームウェア開発ツール | PlatformIO（VSCode拡張） |
| BLE通信ライブラリ（たまご側） | NimBLE-Arduino |
| バックエンド／DB | Supabase（PostgreSQL + Edge Functions + Realtime + Auth + Storage） |
| 鶏⇔サーバー通信 | HTTP REST |
| AI連携 | Gemini API（Edge Function経由） |
| カレンダー連携 | Google Calendar API（Edge Function経由） |
| 音声認識／音声合成 | Google Cloud Speech-to-Text ／ Text-to-Speech |

## ディレクトリ構成

```
nerukokko/
├── README.md
├── CONTRIBUTING.md        # チーム開発ルール（ブランチ・コミット・PR）
├── CLAUDE.md              # Claude Code 向けの開発ガイド
├── docs/                  # 仕様書・設計資料
│   ├── full-spec.md       # 完全仕様書
│   ├── software-spec.md   # ソフトウェア仕様書（DB設計・データフロー・フローチャート）
│   ├── ble-protocol.md    # 鶏⇔たまご BLE仕様
│   ├── api-spec.md        # 鶏・Webアプリ⇔サーバー API仕様
│   ├── hw-verification.md # 実機検証・調整の一覧と手順
│   ├── dev-plan.md        # ソフトウェアの開発計画（要件・タスク・決定ログ）
│   └── reviews/           # PR レビューの記録
├── app/                   # スマホ/Webアプリ（Next.js）
├── server/                # バックエンド（Supabase Edge Functions）
└── firmware/
    ├── chicken/           # 鶏ユニット（Raspberry Pi / Python）
    └── egg/                # たまごユニット（ESP32 / PlatformIO）
```

## ドキュメント

- [完全仕様書](docs/full-spec.md)：製品コンセプト・ハードウェア構成・ソフトウェア構成の全体像
- [ソフトウェア仕様書](docs/software-spec.md)：DBスキーマ、データフロー図、フローチャート（1日の状態遷移／起床・二度寝防止シーケンス／音声対話フロー）
- [BLE仕様書](docs/ble-protocol.md)：鶏⇔たまご間のGATT Characteristic構成・データフォーマット
- [開発計画書](docs/dev-plan.md)：ソフトウェアの要件、画面仕様、タスク一覧、決定ログ、未決事項
- [API仕様書](docs/api-spec.md)：鶏・Webアプリとサーバーの通信の決まり
- [実機検証の一覧](docs/hw-verification.md)：実機での検証・調整の項目と手順（ソフトウェア担当で分担）

創造設計デザインレビュー資料（予算・ガントチャート・担当分担）、部品購入リスト、動作フロー図（drawio）の原本は、リポジトリの外（チームの共有フォルダ）で管理しています。このリポジトリは公開されているため、学校の資料や個人情報を含むファイルはアップロードしないでください。

## 開発の進め方

**作業を始める前に [CONTRIBUTING.md](CONTRIBUTING.md) を必ず読んでください。** 要点は次のとおりです。

- `main` ブランチは保護されていて、直接 push できません。各自の個人ブランチ（例：`aryu`、`ren`）で作業し、Pull Request で `main` に入れます
- 作業を始める前に `git pull` と `git merge origin/main` で最新にします
- コミットメッセージは `<種類>(<範囲>): <日本語の要約>`（例：`feat(app): 設定画面にアラーム編集フォームを追加`）
- PR は田村（PM）が Claude Code でレビューしてマージします。FW の PR には、実機で何を確認したかを書いてください
- APIキー・パスワード・Wi-Fi情報は絶対にコミットしないでください（このリポジトリは公開されています）
- タスク管理は [開発計画書](docs/dev-plan.md) と GitHub Issue で行います。ラベルは `frontend` `backend` `firmware` を使います
- 開発スケジュールは創造設計デザインレビュー資料のガントチャートを参照してください（4月〜2月、30週間）
- コードは AI（Claude Code など）に書かせてかまいません。AI には最初に [CLAUDE.md](CLAUDE.md) と [CONTRIBUTING.md](CONTRIBUTING.md) を読ませてください（Claude Code はリポジトリのフォルダで起動すれば自動で読み込みます）
- 実機での検証・調整は AI にはできないので、ソフトウェア担当で分担します（[実機検証の一覧](docs/hw-verification.md)）

## メンバー

- リーダー：松島 蓮
- サブリーダー：内海 圭吾
- HW担当：松島 蓮、田村 愛琉、浅井 蒼輝
- SW担当：内海 圭吾、岡田 蓮、渡邉 健太
  - 組み込み（鶏・たまごFW）：岡田 蓮
