# バックエンド作業時の追加指示

共通ルールはリポジトリ直下の `AGENTS.md` に従う。作業前に `server/CLAUDE.md` と `docs/api-spec.md` を読む。

- 適用済みの `supabase/migrations/` は編集しない。変更は新しいマイグレーションで行う。
- マイグレーション変更後は `npm run test:db` と `npm run gen:types` を実行する。
- Edge Functionの共通ロジックは `_shared/` に置き、可能な限り純粋関数としてテストする。
- Webアプリはユーザー認証、鶏はpublishable keyとデバイストークン、定期実行はsecret keyを使う。service role / secret keyをクライアントへ渡さない。
- 外部APIが失敗・未設定でも主要機能が止まらないよう、定型文などのフォールバックを維持する。
- APIの入出力を変える場合は `docs/api-spec.md`、仕様変更は `docs/spec-changes.md` も同じ変更で更新する。

