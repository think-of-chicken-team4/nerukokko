// DBスキーマのテスト：supabase/migrations/*.sql を PGlite（WASM版PostgreSQL）に順に適用し、
// 制約・RLS・RPC が仕様どおりに動くかを確認する。Docker も Supabase のアカウントも不要。
//   実行：cd server && npm install && npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const db = new PGlite();
let failures = 0;
const ok = (name) => console.log(`  ✅ ${name}`);
const ng = (name, detail) => { failures++; console.log(`  ❌ ${name}: ${detail}`); };

async function expectOk(name, fn) {
  try { const r = await fn(); ok(name); return r; } catch (e) { ng(name, e.message); }
}
async function expectError(name, fn, pattern) {
  try { await fn(); ng(name, "エラーにならなかった"); }
  catch (e) { (pattern && !pattern.test(e.message)) ? ng(name, `想定外のエラー: ${e.message}`) : ok(`${name}（${e.message}）`); }
}
async function as(role, uid) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${role};`);
}

// --- Supabase 環境のスタブ（ロール・auth スキーマ・既定の権限）。本物の Supabase に合わせてある ---
await db.exec(`
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);

console.log("1. マイグレーション適用");
for (const file of migrationFiles) {
  await expectOk(`${file} を適用できる`, () => db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8")));
}

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

console.log("2. サインアップ時のトリガー");
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${U1}', 'u1@example.com', '{"full_name":"田村 愛琉"}'),
  ('${U2}', 'u2@example.com', '{}')`);
{
  const r = await db.query(`select u.display_name, n.character_voice from public.users u join public.notification_settings n on n.user_id = u.id order by u.email`);
  r.rows.length === 2 && r.rows[0].display_name === "田村 愛琉" && r.rows[1].display_name === "u2"
    ? ok(`users と notification_settings が作られる（${r.rows.map(x => x.display_name).join(", ")}）`)
    : ng("トリガー", JSON.stringify(r.rows));
}

console.log("3. デバイス登録（ユーザー1）");
await as("authenticated", U1);
const reg = await expectOk("鶏を登録できる（小文字MACも可）", () =>
  db.query(`select * from public.register_device('chicken', 'b8:27:eb:12:34:56')`));
const token = reg?.rows[0]?.device_token;
/^[0-9a-f]{64}$/.test(token ?? "") ? ok("トークンは64文字の16進") : ng("トークン形式", token);
const egg = await expectOk("たまごを登録できる", () =>
  db.query(`select * from public.register_device('egg', 'AA:BB:CC:DD:EE:FF')`));
egg?.rows[0]?.device_token === null ? ok("たまごのトークンは null") : ng("たまごのトークン", egg?.rows[0]?.device_token);
await expectError("MACの形式違いは拒否", () => db.query(`select * from public.register_device('chicken', 'xyz')`), /MACアドレス/);
await expectError("device_tokens は読めない", () => db.query(`select * from public.device_tokens`), /permission denied/);
const devs = await db.query(`select id, type, mac_address from public.devices order by type`);
devs.rows.length === 2 && devs.rows[0].mac_address === "B8:27:EB:12:34:56" ? ok("自分のデバイスが2台見える（MACは大文字）") : ng("devices", JSON.stringify(devs.rows));
{
  const r = await db.query(`delete from public.devices returning id`);
  r.rows.length === 0 ? ok("クライアントからデバイスは削除できない（0件）") : ng("デバイス削除", JSON.stringify(r.rows));
}
const chickenId = devs.rows.find(d => d.type === "chicken").id;
const eggId = devs.rows.find(d => d.type === "egg").id;

console.log("4. トークンのハッシュ");
await db.exec("reset role");
{
  const h = createHash("sha256").update(token).digest("hex");
  const r = await db.query(`select device_id from public.device_tokens where token_hash = $1`, [h]);
  r.rows[0]?.device_id === chickenId ? ok("Node の SHA-256 と一致し、鶏を特定できる") : ng("ハッシュ", JSON.stringify(r.rows));
}
await as("authenticated", U1);
const reg2 = await db.query(`select * from public.register_device('chicken', 'B8:27:EB:12:34:56')`);
reg2.rows[0].device_id === chickenId && reg2.rows[0].device_token !== token ? ok("再登録でトークンが作り直される（同じデバイスID）") : ng("再登録", JSON.stringify(reg2.rows));

console.log("5. アラームと次の鳴動時刻");
await expectOk("アラームを追加できる（平日 07:00）", () =>
  db.query(`insert into public.alarms (user_id, time, repeat_days) values ($1, '07:00', '{1,2,3,4,5}')`, [U1]));
await expectError("曜日が空は拒否", () =>
  db.query(`insert into public.alarms (user_id, time, repeat_days) values ($1, '07:00', '{}')`, [U1]), /check constraint/);
await expectError("他人の user_id では追加できない", () =>
  db.query(`insert into public.alarms (user_id, time) values ($1, '07:00')`, [U2]), /row-level security/);
{
  // 2026-10-02(金) 21:00 JST = 12:00Z → 次は 10/05(月) 07:00 JST = 10/04 22:00Z
  const r = await db.query(`select ring_at from public.next_alarm_at($1, '2026-10-02T12:00:00Z')`, [U1]);
  const got = r.rows[0]?.ring_at?.toISOString();
  got === "2026-10-04T22:00:00.000Z" ? ok(`金曜夜 → 月曜 07:00 JST（${got}）`) : ng("next_alarm_at", got);
  const r2 = await db.query(`select ring_at from public.next_alarm_at($1, '2026-10-01T12:00:00Z')`, [U1]);
  const got2 = r2.rows[0]?.ring_at?.toISOString();
  got2 === "2026-10-01T22:00:00.000Z" ? ok(`木曜夜 → 金曜 07:00 JST（${got2}）`) : ng("next_alarm_at 2", got2);
}

console.log("6. 睡眠セッション");
const ses = await expectOk("「眠りにつく」でセッションを作れる", () =>
  db.query(`insert into public.sleep_sessions (user_id, chicken_device_id, egg_device_id, start_time, planned_wake_time)
            values ($1, $2, $3, '2026-10-01T14:00:00Z', '2026-10-01T22:00:00Z') returning id`, [U1, chickenId, eggId]));
const sessionId = ses?.rows[0]?.id;
await expectError("進行中は1つまで", () =>
  db.query(`insert into public.sleep_sessions (user_id, start_time, planned_wake_time)
            values ($1, '2026-10-01T14:05:00Z', '2026-10-01T22:00:00Z')`, [U1]), /duplicate key/);
await expectError("完了にするなら end_time が必要", () =>
  db.query(`update public.sleep_sessions set status = 'completed' where id = $1`, [sessionId]), /check constraint/);
await expectError("計測データはクライアントから書けない", () =>
  db.query(`insert into public.environment_readings (session_id, device_id, timestamp, temperature_c)
            values ($1, $2, now(), 24.0)`, [sessionId, chickenId]), /row-level security/);

console.log("7. 他人のデータ（ユーザー2）");
await as("authenticated", U2);
await expectError("他人の鶏のMACは登録できない", () =>
  db.query(`select * from public.register_device('chicken', 'B8:27:EB:12:34:56')`), /別のユーザー/);
await expectError("他人のデバイスをセッションに紐付けられない", () =>
  db.query(`insert into public.sleep_sessions (user_id, chicken_device_id, start_time, planned_wake_time)
            values ($1, $2, '2026-10-01T14:00:00Z', '2026-10-01T22:00:00Z')`, [U2, chickenId]), /chicken_device_id/);

console.log("8. サーバー（Edge Function）からの書き込み");
await db.exec("reset role");
await expectOk("計測データを書ける", () => db.query(`
  insert into public.environment_readings (session_id, device_id, timestamp, temperature_c, humidity_pct, illuminance_lux)
  values ($1, $2, '2026-10-01T14:10:00Z', 24.5, 52.0, 3.2)`, [sessionId, chickenId]));
await expectOk("寝返り・いびき・充電イベントを書ける", () => db.query(`
  with m as (insert into public.motion_events (session_id, device_id, timestamp, intensity, detection_source)
             values ($1, $2, '2026-10-01T15:00:00Z', 0.8, 'accelerometer')),
       a as (insert into public.audio_events (session_id, device_id, timestamp, event_type, duration_ms, confidence)
             values ($1, $2, '2026-10-01T16:00:00Z', 'snore', 1200, 0.7))
  insert into public.charge_events (egg_device_id, session_id, timestamp, event_type)
  values ($2, $1, '2026-10-01T22:05:00Z', 'charge_start')`, [sessionId, eggId]));
{
  const r = await db.query(`
    insert into public.environment_readings (session_id, device_id, timestamp, temperature_c)
    values ($1, $2, '2026-10-01T14:10:00Z', 24.5) on conflict do nothing returning id`, [sessionId, chickenId]);
  r.rows.length === 0 ? ok("再送された重複データは無視される（on conflict do nothing）") : ng("重複", JSON.stringify(r.rows));
}
await expectError("湿度が範囲外なら拒否", () => db.query(`
  insert into public.environment_readings (session_id, device_id, timestamp, humidity_pct)
  values ($1, $2, '2026-10-01T14:20:00Z', 120)`, [sessionId, chickenId]), /check constraint/);
await expectOk("起床でセッションを完了にできる", () => db.query(`
  update public.sleep_sessions set status = 'completed', end_time = '2026-10-01T22:05:00Z', actual_wake_time = '2026-10-01T22:05:00Z'
  where id = $1`, [sessionId]));

console.log("9. 読み取り権限");
await as("authenticated", U1);
{
  const r = await db.query(`select
    (select count(*) from public.environment_readings)::int as env,
    (select count(*) from public.motion_events)::int as motion,
    (select count(*) from public.audio_events)::int as audio,
    (select count(*) from public.charge_events)::int as charge`);
  const c = r.rows[0];
  c.env === 1 && c.motion === 1 && c.audio === 1 && c.charge === 1 ? ok(`本人は自分の計測データを読める（${JSON.stringify(c)}）`) : ng("本人の読み取り", JSON.stringify(c));
}
await as("authenticated", U2);
{
  const r = await db.query(`select
    (select count(*) from public.sleep_sessions)::int as sessions,
    (select count(*) from public.environment_readings)::int as env,
    (select count(*) from public.charge_events)::int as charge,
    (select count(*) from public.devices)::int as devices,
    (select count(*) from public.alarms)::int as alarms,
    (select count(*) from public.users)::int as users`);
  const c = r.rows[0];
  c.sessions === 0 && c.env === 0 && c.charge === 0 && c.devices === 0 && c.alarms === 0 && c.users === 1
    ? ok(`他人のデータは見えない（${JSON.stringify(c)}）`) : ng("他人の読み取り", JSON.stringify(c));
}
await as("anon");
{
  const r = await db.query(`select (select count(*) from public.users)::int as users, (select count(*) from public.sleep_sessions)::int as sessions`);
  r.rows[0].users === 0 && r.rows[0].sessions === 0 ? ok("未ログイン（anon）は何も見えない") : ng("anon", JSON.stringify(r.rows[0]));
}
await expectError("未ログイン（anon）はデバイス登録できない", () =>
  db.query(`select * from public.register_device('chicken', 'B8:27:EB:00:00:01')`), /permission denied/);

console.log("10. ユーザー削除");
await db.exec("reset role");
await expectOk("auth.users を消すと関連データも消える", () => db.query(`delete from auth.users where id = $1`, [U1]));
{
  const r = await db.query(`select (select count(*) from public.devices)::int as d, (select count(*) from public.sleep_sessions)::int as s,
                                   (select count(*) from public.device_tokens)::int as t, (select count(*) from public.charge_events)::int as c`);
  const c = r.rows[0];
  c.d === 0 && c.s === 0 && c.t === 0 && c.c === 0 ? ok("devices・sessions・tokens・charge_events が残らない") : ng("カスケード", JSON.stringify(c));
}

console.log(failures === 0 ? "\n結果：すべて成功" : `\n結果：${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
