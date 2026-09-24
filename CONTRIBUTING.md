# チーム開発ルール

ねるコッコは6人（SW 3人・HW 3人）で開発しています。お互いの作業を壊さないために、次のルールを守ってください。
Claude Code を使う場合のルールは `CLAUDE.md`、要件・タスク一覧は `docs/dev-plan.md` にあります。

## 1. ブランチ

| ブランチ | 用途 |
|---|---|
| `main` | 全員の成果をまとめる、常に動く状態のブランチ。**直接 push はできない**（保護設定済み） |
| 個人ブランチ（`aryu`、`ren` など） | 各自の作業用。自分のブランチ以外には push しない |
| `<名前>/<トピック>`（例：`aryu/login-page`） | 大きめの作業を分けたいときに個人ブランチから切る（任意） |

## 2. 毎日の作業の流れ

**初回だけ**

```bash
git clone https://github.com/think-of-chicken-team4/nerukokko.git
cd nerukokko
git switch -c <自分の名前> origin/main
git push -u origin <自分の名前>
```

**作業を始めるとき**（main の最新を取り込む）

```bash
git switch <自分の名前>
git fetch origin
git merge origin/main
```

**作業が一区切りしたとき**

```bash
git add <変更したファイル>
git commit -m "feat(app): 設定画面にアラーム編集フォームを追加"
git push origin <自分の名前>
```

GitHub で Pull Request（`<自分の名前>` → `main`）を作ります。

**PR がマージされたあと**：もう一度「作業を始めるとき」の手順で main を取り込みます。

## 3. コミットメッセージ

`<種類>(<範囲>): <日本語の要約>` の形で書きます。

| 種類 | 使うとき | 範囲 | 対象 |
|---|---|---|---|
| `feat` | 機能の追加 | `app` | Webアプリ |
| `fix` | バグ修正 | `server` | Supabase（DB・Edge Functions） |
| `docs` | ドキュメント | `egg` | たまごFW |
| `refactor` | 動作を変えない整理 | `chicken` | 鶏ユニット |
| `test` | テスト | `docs` | 仕様書など |
| `chore` | 設定・雑務 | | |

例：`fix(egg): 充電検知のチャタリング対策を修正`

## 4. Pull Request

- 1つの PR には1つの目的（機能・修正）だけを入れる。大きくなりすぎたら分ける。
- PR テンプレートに沿って「何を・なぜ・どう確認したか」を書く。
- **マージ前に最低1人にレビューしてもらう**。担当外のディレクトリを変えた場合は、その担当者にレビューを依頼する。
- マージ方法は **Create a merge commit** を選ぶ（個人ブランチを使い続けるため、Squash は使わない）。
- 通信の契約（`docs/api-spec.md`・`docs/ble-protocol.md`・DBマイグレーション）を変える PR は、影響を受ける担当者全員に知らせる。

## 5. 担当ディレクトリ

| ディレクトリ | 内容 | 担当 |
|---|---|---|
| `app/` | Webアプリ（Next.js） | Web担当 |
| `server/` | Supabase（DB・Edge Functions） | バックエンド担当 |
| `firmware/egg/` | たまごFW（ESP32） | 組み込み担当 |
| `firmware/chicken/` | 鶏ユニット（Raspberry Pi） | 組み込み担当 |
| `docs/` | 仕様書・設計資料 | 全員 |

## 6. 秘密情報（このリポジトリは公開されています）

- APIキー、パスワード、トークン、Wi-Fi の SSID・パスワード、個人のメールアドレスは**絶対にコミットしない**。
- 秘密情報は `.env` や `.env.local` に書く（`.gitignore` 済み）。必要な変数名は `.env.example` にキー名だけ書いて共有する。
- 間違ってコミットしたら、すぐにチームに連絡し、そのキーを無効化して作り直す（履歴から消すだけでは不十分）。

## 7. タスク管理

- タスクは `docs/dev-plan.md` のタスク一覧（`T-xxx`）と GitHub Issue で管理する。
- Issue にはラベル `frontend` / `backend` / `firmware` を付ける。
- 仕様について決めたことは `docs/dev-plan.md` の「決定ログ」に日付付きで残す。
