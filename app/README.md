# ねるコッコ Webアプリ

Next.js（App Router）＋ Supabase で作っているスマホ向けの Webアプリです。

- 開発のルール・構成・コマンド：[CLAUDE.md](CLAUDE.md)
- チーム全体のルール：[../CONTRIBUTING.md](../CONTRIBUTING.md)
- 要件・画面仕様・タスク：[../docs/dev-plan.md](../docs/dev-plan.md)

```bash
npm install
cp .env.example .env.local   # 値は ../server で `npx supabase status` を実行して入れる
npm run dev                  # http://localhost:3000
```
