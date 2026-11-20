<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ねるコッコ Webアプリの追加指示

共通ルールはリポジトリ直下の `AGENTS.md` に従う。作業前に `app/CLAUDE.md` も読む。

- Next.js 16 App Routerを使用する。迷った場合は上記のローカルNext.jsドキュメントを確認する。
- Server Componentを基本とし、操作・状態が必要な部分だけClient Componentにする。
- Realtimeは必ず `src/lib/supabase/realtime.ts` の `subscribeAsUser()` を使う。
- Supabaseへのアクセスは `src/lib/supabase/` のクライアント生成関数を通す。
- DB型 `src/types/database.ts` は手で編集しない。`server/` で `npm run gen:types` を実行する。
- スマートフォン幅390pxを基準にし、朝と夜の両方の配色で可読性を確認する。
- APIキーやsecret keyを `NEXT_PUBLIC_*` に入れない。ブラウザで使えるのはSupabase URLとpublishable keyだけ。
