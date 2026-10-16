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

- **純粋な関数**（DB を使わない）：`score.ts`（睡眠スコア）・`ingest-payload.ts`（届いたデータの検証）・`comment.ts`（にわとりの定型コメント）。`import` は相対パスの `.ts` だけにし、Node のテストから直接呼べるようにする。**ロジックはできるだけここに書いてテストする。**
- **DB を使う部品**：`http.ts`（エラー形式・CORS・JSON の読み込み・`fetchAll`・`runInBackground`）・`devices.ts`（鶏の認証・たまごの自動登録）・`morning-summary.ts`（朝の振り返り）。

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

## 定期実行（Supabase Cron）

関数を決まった時刻に動かすときは、マイグレーションで `cron.schedule()` を作り、`net.http_post()`（pg_net）で関数を secret キー付きで呼ぶ（例：`migrations/20261016020912_schedule_close_stale_sessions.sql`）。

- 呼び先の URL と secret キーは**リポジトリに書かず**、DB の Vault に入れる。ジョブは、どちらかがなければ何もしない。
- pg_cron・pg_net がない環境（DB のテストに使う PGlite）では、ジョブを作らずに飛ばすように書く（`pg_available_extensions` で確かめる）。

| ジョブ | 間隔 | 関数 |
|---|---|---|
| `close-stale-sessions` | 10分ごと | 巣に戻らないまま起床予定から3時間たった記録を締めて採点する（T-209） |

**Vault の設定（環境ごとに1回。`npx supabase db reset` をしたらやり直す）**

ローカル：Studio（http://127.0.0.1:54323）の SQL Editor で実行する。secret キーは `npx supabase status` の `SECRET_KEY`。

```sql
select vault.create_secret('http://host.docker.internal:54321', 'project_url');
select vault.create_secret('<SECRET_KEY の値>', 'secret_key');
```

本番：Supabase のダッシュボードの SQL Editor で、`project_url` に `https://<プロジェクト>.supabase.co`、`secret_key` に本番の secret キーを入れる（公開の手順 T-004 で行う）。
動いたかは `select * from cron.job_run_details order by start_time desc limit 5;` と `select status_code, content from net._http_response order by created desc limit 5;` で確かめる。

## 動作確認

- `npm run test:db`・`npm run test:functions`・`deno check` が通ること（CI でも実行される）。
- 関数を変えたら `npx supabase functions serve` で動かし、curl かデバイスシミュレーター（Webアプリの `/dev/simulator`）から実際に呼んで確かめる。
- 鶏から呼ぶ関数は、ローカル共通の publishable キーを `apikey` ヘッダーに、`register_device` で発行したトークンを `x-device-token` ヘッダーに付けて呼ぶ（手順は `docs/api-spec.md` §2）。
