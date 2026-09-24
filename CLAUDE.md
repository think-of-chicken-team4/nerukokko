# CLAUDE.md — ねるコッコ 開発ガイド（Claude Code 向け・チーム共通）

このファイルは Claude Code がセッション開始時に必ず読み込む「開発の憲法」です。人間のメンバーが読んでも同じルールです。

- 要件・画面仕様・タスク一覧・決定ログ → `docs/dev-plan.md`
- チーム開発ルール（人間向けの手順） → `CONTRIBUTING.md`

## 1. プロジェクト概要

- 製品：**ねるコッコ**（沼津高専 制御情報工学科 創造設計 4班「THINK OF CHICKEN」）
- 内容：睡眠を計測・記録し、にわとりキャラクターが就寝時刻の提案・起床サポート・朝の振り返りをする睡眠アシスタント
- 構成：🐔鶏（Raspberry Pi 3B / Python）＋ 🥚たまご（ESP32 / PlatformIO）＋ 🪺巣（充電台）＋ Supabase ＋ Next.js Webアプリ
- 授業の条件：「音・時間・光」のうち2つ以上を使う／HW材料費3万円以内／HW必須
- スケジュール：10〜11月 実装 → 11〜12月 結合テスト → 12月 中間発表 → 2月 作品発表

## 2. システム構成（確定版）

```
[Webアプリ Next.js] ──supabase-js(RLS)/Realtime──┐
                    ──fetch──> Edge Functions ────┤
                                                  ▼
                          [Supabase: PostgreSQL / Auth / Edge Functions / Realtime / Storage]
                                                  ▲            └──> Gemini / Google Calendar / 音声API
                                     HTTPS POST   │
[🐔 鶏: Raspberry Pi 3B / Python] ────────────────┘   ミリ波(A111)・マイク・LED・スピーカー・ボタン
        ▲ BLE Notify（たまご→鶏の一方向）
[🥚 たまご: ESP32 / NimBLE] 加速度・マイク・充電検知(STAT)
        ▲ 充電（ポゴピン）
[🪺 巣]
```

- たまご → 鶏：BLE（`docs/ble-protocol.md`）
- 鶏 → Supabase：Edge Function への HTTPS POST（`docs/api-spec.md`）
- Webアプリ ⇔ Supabase：supabase-js による CRUD（RLS 前提）＋ Edge Functions（AI・外部API）＋ Realtime
- **外部API（Gemini / Google Calendar / 音声）は必ず Edge Function 経由で呼ぶ**。ブラウザやデバイスに外部APIキーを置かない。

## 3. リポジトリ構成と担当

| パス | 内容 | 言語・ツール | 担当 |
|---|---|---|---|
| `app/` | Webアプリ（スマホ向け） | Next.js App Router / TypeScript | Web担当 |
| `server/supabase/migrations/` | DBスキーマ（SQL） | PostgreSQL | バックエンド担当 |
| `server/supabase/functions/` | Edge Functions | Deno / TypeScript | バックエンド担当 |
| `firmware/egg/` | たまごFW | C++ / PlatformIO / NimBLE-Arduino | 組み込み担当（岡田） |
| `firmware/chicken/` | 鶏ユニット | Python 3 / bleak / acconeer-exptool | 組み込み担当（岡田） |
| `docs/` | 仕様書・設計資料・レビュー記録 | Markdown | 全員 |

- 担当外ディレクトリの変更は最小限にし、PR本文に「どこを・なぜ変えたか」を書いて担当者にレビューを依頼する。
- **共有の契約**（`docs/api-spec.md`・`docs/ble-protocol.md`・`server/supabase/migrations/`）を変えるときは、影響を受ける側（Web／バックエンド／組み込み）に必ず知らせる。

## 4. 仕様の優先順位（矛盾したら上が正）

1. `server/supabase/migrations/*.sql` — DBスキーマの唯一の正
2. `docs/api-spec.md` — 鶏⇔サーバー、Webアプリ⇔Edge Function の通信契約
3. `docs/ble-protocol.md` — 鶏⇔たまごの通信契約
4. `docs/dev-plan.md` — 要件・画面仕様・タスク・決定ログ
5. `docs/software-spec.md`・`docs/full-spec.md` — 設計時点の仕様書（変更点は dev-plan の決定ログに残す）

仕様を変えたら、同じPRで該当ドキュメントも更新する。仕様に書かれていないことや矛盾を見つけたら、**推測で埋めずに作業者に質問する**。

## 5. Git・ブランチ運用（Claude は必ず守る）

- 作業開始時に `git branch --show-current` と `git status` を確認する。
- **`main` 上では絶対にコミットしない。** 作業者の個人ブランチ（`aryu`・`ren` など）か、そこから切った `<名前>/<トピック>` ブランチで作業する。今どのブランチで作業すべきか分からなければ作業者に聞く。
- 作業前に最新化する：`git fetch origin && git merge origin/main`（rebase・force push はしない）。コンフリクトしたら内容を報告してから解消する。
- タスクが完了するごとに小さくコミットする。メッセージは `<type>(<scope>): <日本語の要約>`
  - type：`feat` `fix` `docs` `refactor` `test` `chore`
  - scope：`app` `server` `egg` `chicken` `docs`
  - 例：`feat(app): 設定画面にアラーム編集フォームを追加`
- **push と PR 作成は作業者に確認してから行う。** 他人のブランチへの push、`main` への直接 push、force push、ブランチ削除はしない。
- PR は「個人ブランチ → `main`」。マージ方法は **Create a merge commit**（個人ブランチを使い続けるので squash しない）。

## 6. セキュリティ（リポジトリは PUBLIC）

- APIキー・パスワード・トークン・Wi-Fi情報・個人のメールアドレスはコミットしない。`.env*` は `.gitignore` 済み。必要な変数は `.env.example` にキー名だけ書く。
- `SUPABASE_SERVICE_ROLE_KEY`・`GEMINI_API_KEY`・Google OAuth のシークレットは Edge Function のシークレット（`supabase secrets set`）にだけ置く。Next.js で使ってよいのは Supabase の URL と anon（publishable）キーだけ。
- 鶏ユニットはデバイス専用トークンで認証する（service_role キーをデバイスに載せない）。方式は `docs/api-spec.md` に従う。
- 全テーブルで RLS を有効にする。RLS なしのテーブルを作らない。

## 7. コーディング規約

**共通**
- 識別子（変数・関数・ファイル名）は英語、コメントとUI文言は日本語。
- 既存コードの書き方（命名・コメント量・構成）に合わせる。
- 時刻は DB では `timestamptz`（UTC）で保存し、表示は `Asia/Tokyo` に変換する。

**Webアプリ（app/）**
- TypeScript strict。`any` は使わない。DB の型は Supabase CLI で生成した型を使う。
- Server Components を基本とし、状態やイベントが必要な部品だけ `"use client"` にする。
- Supabase へのアクセスは `app/src/lib/supabase/` のクライアント生成関数を経由する（雛形作成時に用意）。
- スマホ（幅 390px）を基準にデザインする。見た目は `資料/nerukokko_prototype.html`（リポジトリ外）と `docs/dev-plan.md` の画面仕様に合わせる。

**Edge Functions（server/supabase/functions/）**
- 共通処理（CORS、認証、Gemini 呼び出し、キャラ設定）は `_shared/` に置く。
- 入力は必ずバリデーションし、エラーは `{ "error": "..." }` と適切な HTTP ステータスで返す。

**鶏（firmware/chicken/）**：Python 3.11 以上、型ヒントを付ける、出力は `logging` を使う（`print` は使わない）。
**たまご（firmware/egg/）**：既存のクラス構成（`XxxSensor` / `BleManager`）とピン定義（`PinConfig.h`）に従う。

**にわとりキャラクターの口調**：明るく親しみやすい。語尾に時々「コケ」を付ける。返答は2〜3文。専門用語を使わず、やさしく励ます。

## 8. よく使うコマンド

雛形を作ったら、ここにコマンドを追記する（`docs/dev-plan.md` の T-004・T-006）。

```bash
# 鶏ユニット（Python）の構文チェック
python3 -m py_compile firmware/chicken/*.py
# たまごFWのビルド（PlatformIO CLI）
cd firmware/egg && pio run
```

## 9. 作業の進め方（Claude 向け手順）

1. `docs/dev-plan.md` から対象タスク（`T-xxx`）を確認する。**受け入れ条件を満たすことがゴール。**
2. 関連する仕様（§4）を読む。不明点や矛盾があれば、実装を止めて作業者に質問する。
3. 実装したら、型チェック・lint・ビルドを通し、可能なら画面で動作確認する。
4. `docs/dev-plan.md` のタスクの状態を更新してコミットする。
5. 新しく決めたことや仕様の変更は、`docs/dev-plan.md` の「決定ログ」に日付付きで追記する。

## 10. モデルの使い分け（トークン節約）

- **Opus**：設計、DBスキーマ・RLS、API契約、新しい外部API連携（OAuth・音声など）、原因の分からないバグ、PRレビュー
- **Sonnet**：`docs/dev-plan.md` で受け入れ条件まで決まっているタスクの実装（画面、コンポーネント、CRUD、既存パターンに沿った Edge Function）
- Sonnet で作業中に仕様にない判断が必要になったら、実装を止めて作業者に報告する（Opus で設計してから再開する）。
