# バックエンド（server/）のルール

チーム共通のルールはリポジトリ直下の `CLAUDE.md`。ここには Supabase（DB・Edge Functions）だけの決まりを書く。
通信の決まりは `docs/api-spec.md`。関数の入出力を変えるときは、先に api-spec を更新する。

## 構成

| パス | 内容 |
|---|---|
| `supabase/migrations/` | DB スキーマ（SQL）。**適用済みのファイルは書き換えず**、変更は `npx supabase migration new <名前>` で新しいファイルにする |
| `supabase/functions/<関数名>/index.ts` | Edge Function 本体（Deno / TypeScript）。`deno.json` に import の対応表 |
| `supabase/functions/_shared/` | 関数どうしで使う部品 |
| `supabase/functions/_shared/database.types.ts` | DB の型。**自動生成なので手で編集しない**（`npm run gen:types`） |
| `tests/db/` | DB のテスト（PGlite。制約・RLS・RPC） |
| `tests/functions/` | `_shared/` の純粋な関数のテスト（Node のテストランナー） |

`_shared/` の部品は2種類に分ける。

- **純粋な関数**（DB を使わない）：`score.ts`（睡眠スコア）・`ingest-payload.ts`（届いたデータの検証）・`comment.ts`（にわとりの定型コメントと Gemini への指示）・`character.ts`（キャラクター設定）・`chat.ts`（テキスト会話の決まりと指示）・`evening.ts`（就寝提案の計算と指示）・`announcements.ts`（鶏が話す内容の選び方）・`google-calendar.ts`（Google の OAuth と予定の読み取り。fetch を差し替えてテスト）・`jst.ts`（日本時間の表示）・`stale-session.ts`。`gemini.ts` も fetch を差し替えればテストできる。`import` は相対パスの `.ts` だけにし、Node のテストから直接呼べるようにする。**ロジックはできるだけここに書いてテストする。**
- **DB を使う部品**：`http.ts`（エラー形式・CORS・JSON の読み込み・`fetchAll`・`runInBackground`）・`devices.ts`（鶏の認証・たまごの自動登録）・`morning-summary.ts`（朝の振り返り）・`calendar-store.ts`（カレンダーのトークンの更新と予定の読み込み）。

## Edge Function の書き方

```ts
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { CORS, type Db, jsonError, readJson } from "../_shared/http.ts";

export default {
  fetch: withSupabase({ auth: "user", cors: CORS }, async (req, ctx) => {
    const body = await readJson(req, 4 * 1024);
    if (body instanceof Response) return body;
    // ctx.supabase：呼び出したユーザーの権限（RLS が効く）
    // ctx.supabaseAdmin：RLS を通らない。使う前に、本人のデータか・鶏のトークンが正しいかを必ず確かめる
    const db = ctx.supabaseAdmin as Db;
    ...
    return Response.json({ ... });
  }),
};
```

- **認証**（`auth`）：Webアプリから呼ぶ関数は `"user"`、鶏から呼ぶ関数は `"publishable"` ＋ `authenticateChicken()`（`x-device-token`）、定期実行など内部からは `"secret"`。どれも `supabase/config.toml` で `verify_jwt = false`（認証は `withSupabase` が行う）。
- **エラー**は `jsonError(status, code, message)` で `docs/api-spec.md` §1-4 の形にそろえる。メッセージは日本語。
- **CORS** は `_shared/http.ts` の `CORS` を使う（ブラウザのデバイスシミュレーターから `x-device-token` を送れるようにしてある）。
- レスポンスを返したあとに続けたい重い処理は `runInBackground(promise, "名前")`。
- 1000件を超えるかもしれない読み込みは `fetchAll()`（PostgREST は1回1000件まで）。
- 外部 API のキー（Gemini など）は `Deno.env.get("GEMINI_API_KEY")`。ローカルは `supabase/functions/.env`（コミットしない）、本番は `npx supabase secrets set`。キーがないときは定型の返答にする（`comment.ts` のように）。

## コマンド

```bash
cd server
npm run test:db          # DB のテスト
npm run test:functions   # _shared の純粋な関数のテスト
npm run gen:types        # DB の型を作り直す（Webアプリ用と関数用の両方）
npx supabase functions serve   # 関数をローカルで動かす（http://127.0.0.1:54321/functions/v1/<関数名>）
deno check --config supabase/functions/<関数名>/deno.json supabase/functions/<関数名>/index.ts   # 型チェック（CI でも実行される）
# Deno が入っていなければ `npx --yes deno@2 check ...` でもよい。各関数の deno.lock（依存の版の記録）はコミットする。
# functions serve の最中に deno check をすると、書きかけの deno.lock を読んで関数が一度だけ起動エラー（503）になることがある。もう一度呼べば直る
```

## Gemini（AI）

- 呼び出しは `_shared/gemini.ts` の `generateText()` を使う。キャラクター設定は `_shared/character.ts` の `CHICKEN_PERSONA`。
- **キー**：`GEMINI_API_KEY`。Google AI Studio の「Get API key」で作る（田村さんのアカウント）。**2026-05-28 以降に作ったキーは `AQ.` で始まる auth key**（`AIza` で始まる古い形式ではない）。REST では `x-goog-api-key` ヘッダーで送る。
  - ローカル：`cp supabase/functions/.env.example supabase/functions/.env` して値を入れ、`npx supabase functions serve` を起動し直す（`.env` は Git に入らない）
  - 本番：`npx supabase secrets set GEMINI_API_KEY=...`（`docs/cloud-setup.md` §4）
- **モデル**：`GEMINI_MODELS`（カンマ区切り。既定 `gemini-3.6-flash,gemini-3.8-flash`）を上から試す。混雑（503）・上限（429）・タイムアウト（10秒）なら次へ、全部だめなら `null` を返すので、呼び出し側は**必ず定型文を用意する**（`comment.ts` など）。2026-10-16 時点で `gemini-2.5-flash` は新しいユーザーには使えない。
- 「考える量」（`thinkingLevel`）はモデルごとに決めてある（3.6 は `minimal`、3.8 は `low`）。短い返事で考えさせると、文字数の枠を使い切って返事が途中で切れる。
- 返事は改行や空行が入るので、画面や吹き出しに出すときは `toOneParagraph()` でつなぐ。
- **声（TTS）**は `_shared/tts.ts` の `synthesizeSpeech()`。Interactions API（`/v1beta/interactions`）で WAV（24kHz・モノラル・16bit）が返る。モデルは `GEMINI_TTS_MODELS`（既定 `gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts`）。声はキャラボイスで選ぶ（にわとり＝`Puck`、ひよこ＝`Leda`。サンプルは田村さんの PC の `音声サンプル/`）。20秒ほどの文章で10秒くらいかかる。
- **無料枠では、送った内容が Google の製品の改善に使われる**。個人を特定できる情報（メールアドレスなど）は送らない（表示名だけ送る）。
- テストでは本物の API を呼ばず、`fetchImpl` を差し替える（`tests/functions/gemini.test.ts`）。

## Google カレンダー（T-205）

- 関数 `calendar-connect`（連携の開始・完了・解除）と、`_shared/google-calendar.ts`・`calendar-store.ts`。夕方の提案（`evening-suggestion.ts`）が明日の最初の予定を読む。
- 環境変数：`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`（Google Cloud の OAuth クライアント。作り方は `docs/cloud-setup.md` §3）、`GOOGLE_REDIRECT_URIS`（戻り先。空ならローカルの `http://localhost:3000/settings/calendar/callback`）。**ないときは連携が「準備中」になるだけで、ほかの機能は動く**。
- トークンは `google_credentials`（クライアントから読めない）。連携が切れた（`invalid_grant`）ら消す。Google に届かないときは、予定なしで提案を作る。
- 予定の名前は Gemini に送らない（時刻だけ。spec-changes A-28）。

## 定期実行（Supabase Cron）

関数を決まった時刻に動かすときは、マイグレーションで `cron.schedule()` を作り、`net.http_post()`（pg_net）で関数を secret キー付きで呼ぶ（例：`migrations/20261016020912_schedule_close_stale_sessions.sql`）。

- 呼び先の URL と secret キーは**リポジトリに書かず**、DB の Vault に入れる。ジョブは、どちらかがなければ何もしない。
- pg_cron・pg_net がない環境（DB のテストに使う PGlite）では、ジョブを作らずに飛ばすように書く（`pg_available_extensions` で確かめる）。

| ジョブ | 間隔 | 関数 |
|---|---|---|
| `close-stale-sessions` | 10分ごと | 巣に戻らないまま起床予定から3時間たった記録を締めて採点する（T-209） |
| `evening-suggestion` | 毎日 10:00 UTC（19:00 日本時間） | 全ユーザーの今夜の就寝提案を作る（T-206） |

**Vault の設定（環境ごとに1回。`npx supabase db reset` をしたらやり直す）**

ローカル：Studio（http://127.0.0.1:54323）の SQL Editor で実行する。secret キーは `npx supabase status` の `SECRET_KEY`。

```sql
select vault.create_secret('http://host.docker.internal:54321', 'project_url');
select vault.create_secret('<SECRET_KEY の値>', 'secret_key');
```

本番：Supabase のダッシュボードの SQL Editor で、`project_url` に `https://<プロジェクト>.supabase.co`、`secret_key` に本番の secret キーを入れる（`docs/cloud-setup.md` §4）。
動いたかは `select * from cron.job_run_details order by start_time desc limit 5;` と `select status_code, content from net._http_response order by created desc limit 5;` で確かめる。

## 動作確認

- `npm run test:db`・`npm run test:functions`・`deno check` が通ること（CI でも実行される）。
- 関数を変えたら `npx supabase functions serve` で動かし、curl かデバイスシミュレーター（Webアプリの `/dev/simulator`）から実際に呼んで確かめる。
- 鶏から呼ぶ関数は、ローカル共通の publishable キーを `apikey` ヘッダーに、`register_device` で発行したトークンを `x-device-token` ヘッダーに付けて呼ぶ（手順は `docs/api-spec.md` §2）。
