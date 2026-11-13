# ねるコッコ開発ガイド（Codex・AI共通）

このリポジトリは、沼津高専「創造設計」4班のチーム開発です。リポジトリは **PUBLIC** です。

## 作業開始時に必ず行うこと

1. `git branch --show-current` と `git status` を確認する。
2. `docs/dev-plan.md` §0「現在の状況と次にやること」を読む。
3. `CLAUDE.md` と `CONTRIBUTING.md` を読む。ファイル名は過去の経緯によるもので、内容は Codex を含む全AI・全開発者に適用する。
4. 対象に応じて次を読む。
   - Webアプリ：`app/CLAUDE.md` と `app/AGENTS.md`
   - バックエンド：`server/CLAUDE.md` と `server/AGENTS.md`
   - 鶏・たまご：`firmware/chicken/README.md`、`docs/hw-verification.md`、`docs/ble-protocol.md`
5. 関連仕様を確認する。正しい仕様の優先順位は次のとおり。
   1. `server/supabase/migrations/`
   2. `docs/api-spec.md`
   3. `docs/ble-protocol.md`
   4. `docs/dev-plan.md`
   5. `docs/full-spec.md`・`docs/software-spec.md`

## Git・チーム開発

- `main` では作業・コミットしない。田村の作業は `aryu` または `aryu-<トピック>` ブランチで行う。
- 作業前に `git fetch origin` し、作業ブランチへ `origin/main` を取り込む。rebase・force push はしない。
- コミットは `<type>(<scope>): <日本語の要約>`。詳細は `CONTRIBUTING.md`。
- push、PR作成、他人のブランチへの修正、マージは、田村の明示的な許可を得てから行う。
- メンバーのPRをレビューするときは `CLAUDE.md` §5-1のM・S・提案の区分に従う。
- 担当者が決まっている機能（例：DSIディスプレイは岡田）へ新機能を勝手に実装しない。必要ならIssueで提案する。

## セキュリティ

- APIキー、パスワード、トークン、Wi-Fi情報、個人メールアドレスをコミット・Issue・PR・チャットへ載せない。
- `.env*` はローカル専用。`.env.example` には変数名と説明だけを書く。
- ブラウザとデバイスへ service role / secret キーを置かない。
- SupabaseのURLとpublishable keyは公開可能だが、secret key・DBパスワード・Geminiキー・OAuth secretは非公開。
- 適用済みのDBマイグレーションは編集せず、新しいマイグレーションを追加する。

## 実装・仕様変更

- 識別子は英語、コメント・UI・ドキュメントは日本語。
- 時刻はDBでUTCの`timestamptz`、表示は`Asia/Tokyo`。
- 仕様書と異なる実装、または仕様書にない決定は、同じ変更で `docs/spec-changes.md` に記録する。
- 決定事項は `docs/dev-plan.md` の決定ログ、進捗はタスク表と§0へ反映する。
- 実機を使った検証は人が担当する。AIはテストプログラム、手順、判定基準、設定箇所を用意する。
- 作業終了時は `docs/dev-plan.md` §0を更新する。

## 最低限の検証

変更範囲に応じて実行する。PR前は可能な限り全て通す。

```bash
# Webアプリ
cd app && npm run lint && npx tsc --noEmit && npm run build

# DB・Edge Functions
cd server && npm run test:db && npm run test:functions

# 鶏
python3 -m py_compile firmware/chicken/*.py firmware/chicken/hwtest/*.py firmware/chicken/tests/*.py
cd firmware/chicken && python3 -m unittest discover -s tests -v

# たまご
cd firmware/egg && pio run -e esp32dev -e esp32dev_debug -e hwtest_i2c_scan -e hwtest_accel -e hwtest_mic -e hwtest_dock -e hwtest_battery
```

Edge Functionsを変更した場合は、各関数の`deno check`も実行する。CIの正確な手順は `.github/workflows/ci.yml` を正とする。

