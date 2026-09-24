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
| `app/` | Webアプリ（スマホ向け） | Next.js App Router / TypeScript | 田村 |
| `server/supabase/migrations/` | DBスキーマ（SQL） | PostgreSQL | 浅井 |
| `server/supabase/functions/` | Edge Functions | Deno / TypeScript | 浅井 |
| `firmware/egg/` | たまごFW | C++ / PlatformIO / NimBLE-Arduino | 岡田（実機検証は SW 担当で分担） |
| `firmware/chicken/` | 鶏ユニット | Python 3 / bleak / acconeer-exptool | 岡田（実機検証は SW 担当で分担） |
| `docs/` | 仕様書・設計資料・レビュー記録 | Markdown | 全員 |

- 当面の進め方：Webアプリ・バックエンド・鶏／たまごのソフトは、まず Claude が全体の叩き台（動く完成形）を作る。その後、直す箇所を担当者で分けて修正する。
- 担当外ディレクトリの変更は最小限にし、PR本文に「どこを・なぜ変えたか」を書いて担当者にレビューを依頼する。

### 3-1. AI と人の役割分担

- **コードは AI（Claude Code）が書く。実機での検証・調整はソフトウェア担当の人が分担して行う。**
- 実機検証の一覧と手順は `docs/hw-verification.md`（E1〜E5・C1〜C8・I1〜I4）。
- Claude は実機を動かせないので、次を守る。
  - 実機でしか確かめられない動作を「動く」「確認済み」と書かない。PR の「動作確認」には、机上で確認したこと（ビルド・構文チェック・テスト）と、実機で確認が必要なこと（`docs/hw-verification.md` の ID）を分けて書く。
  - しきい値・ピン番号・送信間隔など、実機で調整する値は、1か所（`PinConfig.h`、`integration_config.py` など）に集め、コメントで「実機で調整する（hw-verification の ID）」と書く。
  - 検証した人が Issue や PR に残した測定値やログがあれば、それを根拠にコードを直す。推測で値を決めない。
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
- **`main` 上では絶対にコミットしない。** 作業者の個人ブランチ（`aryu`・`ren` など）か、そこから切った `<名前>-<トピック>` ブランチ（例：`aryu-login-page`）で作業する。`aryu` があると Git の仕様で `aryu/〜` という名前は作れないので、区切りは `/` ではなく `-` にする。今どのブランチで作業すべきか分からなければ作業者に聞く。
- 作業前に最新化する：`git fetch origin && git merge origin/main`（rebase・force push はしない）。コンフリクトしたら内容を報告してから解消する。
- タスクが完了するごとに小さくコミットする。メッセージは `<type>(<scope>): <日本語の要約>`
  - type：`feat` `fix` `docs` `refactor` `test` `chore`
  - scope：`app` `server` `egg` `chicken` `docs`
  - 例：`feat(app): 設定画面にアラーム編集フォームを追加`
- **push と PR 作成は作業者に確認してから行う。** 他人のブランチへの push（§5-1 の軽微な修正を除く）、`main` への直接 push、force push、ブランチ削除はしない。
- PR は「個人ブランチ → `main`」。マージ方法は **Create a merge commit**（個人ブランチを使い続けるので squash しない）。

### 5-1. PR のレビューとマージ（Claude が担当する）

メンバーの PR は、田村（PM）が Claude Code のセッションで「PR #N をレビューして」と指示したときに、Claude がレビューする。**Claude は PR を自動では監視しないので、指示があったときだけ動く。** レビューは Opus で行う。

1. **中身を確認する**：`gh pr view N` と `gh pr diff N` で読む。ビルドやテストを実行するときは、作業者のブランチを切り替えずに、スクラッチ用のディレクトリに `git worktree` を作ってそこで確認し、終わったら消す。
2. **観点**
   - PR テンプレートの「概要・理由・動作確認」が書かれているか（FW は実機で何を確認したか）
   - `main` と競合していないか
   - 秘密情報（キー・パスワード・Wi-Fi情報・メールアドレス）が含まれていないか
   - 通信の契約（`docs/api-spec.md`・`docs/ble-protocol.md`・マイグレーション）を変えた場合、相手側のコードとドキュメントも揃っているか
   - 仕様（§4）と矛盾していないか
   - ビルド・lint・型チェック・`py_compile`・`pio run` が通るか
   - 明らかなバグ、担当外ディレクトリの不要な変更がないか
3. **指摘を3段階に分ける**
   - **M（マージ前に必須）**：壊れる・危険・契約違反・秘密情報
   - **S（あとで直す）**：実機確認が必要なもの、改善したほうがよいもの → Issue にして作者に割り当てる
   - **提案**：任意
4. **結果を PR にコメントする**（`gh pr review N --comment`）。M・S・提案を分けて、日本語で具体的に書く。
5. **判断する**
   - **M がない** → マージする（`gh pr merge N --merge`）。S は Issue にする。
   - **M があるが軽微**（誤字、ドキュメントの不整合、書式、実機がなくても確実に直せる1〜数行の修正）→ PR のブランチに修正コミットを追加し（force push はしない）、何を直したかを PR にコメントしてからマージする。
   - **M が設計の判断や実機での確認を必要とする**（FW のロジック、センサーの読み方、通信の契約の変更など）→ マージせず、作者に修正を依頼するコメントを書き、田村に報告する。
6. **マージしてよいのは、田村が「レビューして問題なければマージして」のようにマージまで指示したときだけ。** そうでなければ、レビュー結果を報告して指示を待つ。
7. マージ後：作業者のブランチに `origin/main` を取り込み、`docs/dev-plan.md` のタスク状態と決定ログを更新する。大きな PR（契約の変更や数百行の追加など）は、レビュー記録を `docs/reviews/YYYY-MM-DD_<ブランチ名>-review.md` に残す。
8. 田村自身（`aryu`）の PR も同じ手順でレビューする。Claude が書いたコードは、できれば担当メンバー（Web：田村、バックエンド：浅井）にも目を通してもらう。

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

```bash
# --- バックエンド（server/） ---
cd server && npm install          # 初回のみ（Supabase CLI と DB テスト用の PGlite が入る）
npm run test:db                   # マイグレーションを PGlite に適用して制約・RLS・RPC をテスト（Docker 不要）
npx supabase migration new <名前>  # 新しいマイグレーションを作る（既存のマイグレーションは書き換えない）
npx supabase start                # ローカルの Supabase 一式を起動（Docker が必要）
npx supabase db reset             # ローカル DB を作り直してマイグレーションと seed を適用

# --- 鶏ユニット（Python）の構文チェック ---
python3 -m py_compile firmware/chicken/*.py

# --- たまごFWのビルド（PlatformIO CLI） ---
cd firmware/egg && pio run
```

Webアプリ（`app/`）のコマンドは雛形を作ったら追記する（`docs/dev-plan.md` の T-006）。

- マイグレーションを追加・変更したら、`npm run test:db` を通し、必要ならテスト（`server/tests/db/schema.test.mjs`）も追加する。
- 適用済みのマイグレーションファイルは書き換えず、変更は新しいファイルで行う（本番 DB と履歴がずれるため）。

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
