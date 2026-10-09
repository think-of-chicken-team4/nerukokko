@AGENTS.md

# Webアプリ（app/）のルール

チーム共通のルールはリポジトリ直下の `CLAUDE.md`。ここには Webアプリだけの決まりを書く。
Next.js は 16 系。書き方に迷ったら、上の AGENTS.md のとおり `node_modules/next/dist/docs/` を読む（`middleware.ts` は `proxy.ts` に名前が変わっている、など）。

## 構成

| パス | 内容 |
|---|---|
| `src/app/(main)/` | ログイン後の画面。`layout.tsx` でログイン確認・時間帯の背景・ステータスバー・下部タブを出す |
| `src/app/login/` | ログイン・新規登録（`actions.ts` が Server Action） |
| `src/app/(main)/actions.ts` | ホームの Server Action（「眠りにつく」・記録の中止） |
| `src/app/(main)/dev/simulator/` | デバイスシミュレーター（鶏の代わりに API へデータを送る開発・デモ用） |
| `src/components/` | 画面の枠の部品（`StatusBar`・`Clock`・`BottomNav`・`PhaseDial`・`ErrorView`） |
| `src/components/ui/` | どの画面でも使う部品：`Switch`（ON/OFF）・`SegmentedControl`（今夜／週間などの切り替え、URL で切り替える）・`ChickenBubble`（にわとりのセリフ）・`Stat`/`StatGrid`（数値のタイル）・`ScoreRing`（スコアの円）・`LogItem`（履歴の1行） |
| `src/components/device/` | デバイスの部品（`ChickenRegistration`＝鶏の登録・トークンの再発行・交換。登録は `src/app/(main)/device/actions.ts`） |
| `src/components/settings/` | 設定の部品（`AlarmSettings`＝アラームの一覧・編集。保存は `src/app/(main)/settings/actions.ts`） |
| `src/app/(main)/loading.tsx`・`error.tsx`、`src/app/error.tsx` | 読み込み中の表示と、エラーのときの表示（「もう一度読み込む」） |
| `src/components/home/` | ホームの部品（`SleepMonitor`＝睡眠中の即時更新、`SessionWatcher`＝セッションの変化で画面を読み直す、`MorningView`＝朝のスコア） |
| `src/lib/supabase/` | Supabase クライアント（`client.ts`＝ブラウザ、`server.ts`＝サーバー、`proxy.ts`＝セッション更新） |
| `src/lib/data/` | DB から読んで判定する処理（今のフェーズ、睡眠中・朝の表示データ、デバイスのオンライン判定・たまごの場所・MAC アドレスの整形） |
| `src/lib/supabase/realtime.ts` | Realtime の購読（`subscribeAsUser`） |
| `src/types/score.ts` | スコアの内訳の型（サーバーの `_shared/score.ts` と合わせる） |
| `src/lib/format.ts` | 日時の表示（すべて日本時間） |
| `src/lib/alarm.ts` | アラームの曜日の表示（「平日」など）と入力チェック。曜日は 0=日〜6=土、時刻は日本時間 |
| `src/types/database.ts` | DB の型。**自動生成なので手で編集しない**（作り方は下のコマンド） |
| `src/proxy.ts` | 全ページの前にセッションを更新し、未ログインならログイン画面へ移動する |

## 書き方

- **読む**：Server Component で `createClient()`（`@/lib/supabase/server`）を使う。RLS で本人のデータだけが返る。
- **書く**：フォームは Server Action（ページと同じフォルダの `actions.ts`、先頭に `"use server"`）。書いたあとは `revalidatePath()` で画面を更新する。
- **画面の操作に応じた処理**：`"use client"` のコンポーネントで `createClient()`（`@/lib/supabase/client`）を使う。
- **Realtime（即時更新）は必ず `subscribeAsUser()`（`@/lib/supabase/realtime`）で購読する。** `supabase.channel()` を直接使うと、ログインが Realtime に渡らず RLS で通知が届かない。`useEffect` の中で呼び、戻り値をそのまま返せば後片付けになる。
- 別の端末で起きた変化（鶏からのデータ・起床・スコア確定）で画面を更新したいときは、`SessionWatcher` を置く（変化があると `router.refresh()` でサーバーから読み直す）。
- ログイン中のユーザー ID は `getUserId()`（`@/lib/supabase/server`）。サーバーでは `getSession()` を使わない。
- 外部 API（Gemini・カレンダーなど）は Webアプリから直接呼ばず、Edge Function を `supabase.functions.invoke()` で呼ぶ。
- 見た目はプロトタイプ（`資料/nerukokko_prototype.html`）に合わせる。`src/components/ui/` に部品があるものはそれを使い、なければ `src/app/globals.css` の部品クラス（`card`・`card-title`・`btn btn-primary`・`btn-row`・`row`・`pill pill-gold`・`input`・`hint`・`dev-card-head`・`device-icon` など）を使う。新しい部品が必要なら globals.css にクラスを足し、2画面以上で使うなら `components/ui/` に部品を作る。
- DB の読み込みでエラーが返ったら、空のデータとして扱わずに `throw` する（`error.tsx` がエラー画面を出す）。データが「ない」場合と「読めなかった」場合を混ぜない。
- 色は CSS 変数（`var(--fg)`・`var(--fg-dim)`・`var(--card-bg)`・`var(--inset)`・`var(--track)`）を使う。時間帯ごとに自動で切り替わる。朝（`morning`）だけ背景が明るいので、色を足したら朝と夜の両方で読めるか確かめる。
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
- パッケージを追加・更新したら、`npm ci --dry-run` が通ることも確認する（`package-lock.json` が食い違っていると CI の `npm ci` が失敗する）。失敗したら `node_modules` を消して `npm install` し直す。Node.js は 22 以上を使う。
- 画面を変えたら、`npm run dev` でブラウザから実際に操作して確認する（スマホ幅 390px で見る）。
- 鶏・たまごがなくても、デバイスシミュレーター（設定 →「デバイスシミュレーターを開く」、`/dev/simulator`）で1日の流れを試せる。「仮想の鶏・たまごを登録」→「今から眠る」か「8時間前に寝たことにする」→ データを送る →「巣に戻す（起床）」。関数（`npx supabase functions serve`）を起動しておくこと。
- ローカルのテスト用ユーザーは、ログイン画面の「新規登録」で作れる（ローカルではメール確認なし）。
  - 例：名前「テスト」、`tamago@example.com`／`kokekokko123`（ローカルの Supabase にだけ存在するテスト用。`npx supabase db reset` で消えるので、そのときは作り直す）
- テスト用のデータ（アラーム・睡眠記録など）は、管理画面 Studio（http://127.0.0.1:54323）から入れられる。
