@AGENTS.md

# Webアプリ（app/）のルール

チーム共通のルールはリポジトリ直下の `CLAUDE.md`。ここには Webアプリだけの決まりを書く。
Next.js は 16 系。書き方に迷ったら、上の AGENTS.md のとおり `node_modules/next/dist/docs/` を読む（`middleware.ts` は `proxy.ts` に名前が変わっている、など）。

## 構成

| パス | 内容 |
|---|---|
| `src/app/(main)/` | ログイン後の画面。`layout.tsx` でログイン確認・時間帯の背景・ステータスバー・下部タブを出す |
| `src/app/login/` | ログイン・新規登録（`actions.ts` が Server Action） |
| `src/components/` | 画面をまたいで使う部品（`StatusBar`・`BottomNav`・`PhaseDial`） |
| `src/lib/supabase/` | Supabase クライアント（`client.ts`＝ブラウザ、`server.ts`＝サーバー、`proxy.ts`＝セッション更新） |
| `src/lib/data/` | DB から読んで判定する処理（今のフェーズ、デバイスのオンライン判定など） |
| `src/lib/format.ts` | 日時の表示（すべて日本時間） |
| `src/types/database.ts` | DB の型。**自動生成なので手で編集しない**（作り方は下のコマンド） |
| `src/proxy.ts` | 全ページの前にセッションを更新し、未ログインならログイン画面へ移動する |

## 書き方

- **読む**：Server Component で `createClient()`（`@/lib/supabase/server`）を使う。RLS で本人のデータだけが返る。
- **書く**：フォームは Server Action（ページと同じフォルダの `actions.ts`、先頭に `"use server"`）。書いたあとは `revalidatePath()` で画面を更新する。
- **Realtime・画面の操作に応じた処理**：`"use client"` のコンポーネントで `createClient()`（`@/lib/supabase/client`）を使う。
- ログイン中のユーザー ID は `getUserId()`（`@/lib/supabase/server`）。サーバーでは `getSession()` を使わない。
- 外部 API（Gemini・カレンダーなど）は Webアプリから直接呼ばず、Edge Function を `supabase.functions.invoke()` で呼ぶ。
- 見た目は `src/app/globals.css` の部品クラス（`card`・`card-title`・`btn btn-primary`・`stat-grid`・`row`・`pill`・`input`・`hint`・`chat-bubble` など）を使い、プロトタイプ（`資料/nerukokko_prototype.html`）に合わせる。新しい部品が必要なら globals.css に追加する。
- 色は CSS 変数（`var(--fg)`・`var(--fg-dim)`・`var(--card-bg)`・`var(--inset)`）を使う。時間帯ごとに自動で切り替わる。
- 文言は日本語。にわとりのセリフは「〜コケ」の口調。
- 日時は `src/lib/format.ts` の関数で日本時間にして表示する。

## コマンド

```bash
cd app
npm install
cp .env.example .env.local     # 値は server/ で `npx supabase status` を実行して入れる
npm run dev                    # http://localhost:3000（ローカルの Supabase を起動しておく）
npm run lint && npx tsc --noEmit && npm run build   # PR を出す前に通す

# DB のマイグレーションを変えたら、型を作り直す
cd ../server && npm run gen:types
```

## 動作確認

- `npm run lint`・`npx tsc --noEmit`・`npm run build` が通ること。
- 画面を変えたら、`npm run dev` でブラウザから実際に操作して確認する（スマホ幅 390px で見る）。
- ローカルのテスト用ユーザーは、ログイン画面の「新規登録」で作れる（ローカルではメール確認なし）。
  - 例：名前「テスト」、`tamago@example.com`／`kokekokko123`（ローカルの Supabase にだけ存在するテスト用。`npx supabase db reset` で消えるので、そのときは作り直す）
- テスト用のデータ（アラーム・睡眠記録など）は、管理画面 Studio（http://127.0.0.1:54323）から入れられる。
