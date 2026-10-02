-- ============================================================================
-- ねるコッコ 初期スキーマ
--   元の仕様：docs/software-spec.md ver4（全14テーブル）
--   変更点　：docs/api-spec.md §7（device_tokens の追加、一意制約、列の追加など）
-- このファイルを適用したあとの変更は、新しいマイグレーションファイルで行うこと。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 共通：updated_at を自動更新するトリガー関数
-- ----------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ============================================================================
-- 1. 基本管理：users / devices / device_tokens
-- ============================================================================

-- 1. users：アプリ利用者（auth.users と 1対1）
create table public.users (
  id           uuid        primary key references auth.users (id) on delete cascade,
  email        text        not null unique,
  display_name text        not null,
  created_at   timestamptz not null default now()
);
comment on table public.users is 'アプリ利用者。id は auth.users.id と同じ値（サインアップ時にトリガーで作成）';

-- 2. devices：鶏・たまご（1ユーザーにつき各1台）
create table public.devices (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references public.users (id) on delete cascade,
  type             text        not null check (type in ('chicken', 'egg')),
  mac_address      text        not null unique
                               check (mac_address ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  firmware_version text        not null default 'unknown',
  battery_level    integer     check (battery_level between 0 and 100),
  last_seen        timestamptz,
  status           jsonb,
  paired_at        timestamptz not null default now(),
  constraint devices_one_per_type unique (user_id, type),
  constraint devices_battery_egg_only check (type = 'egg' or battery_level is null)
);
create index devices_user_id_idx on public.devices (user_id);
comment on column public.devices.mac_address is '大文字・コロン区切り（例：AA:BB:CC:DD:EE:FF）。鶏は Raspberry Pi の MAC、たまごは ESP32 の BLE MAC';
comment on column public.devices.status is '鶏からの最新の状態報告（device-sync の status）。デバイス画面の表示用';

-- device_tokens：鶏の認証用トークンのハッシュ。クライアントからは一切読めない（ポリシーなし）
create table public.device_tokens (
  device_id  uuid        primary key references public.devices (id) on delete cascade,
  token_hash text        not null unique,
  created_at timestamptz not null default now()
);
comment on table public.device_tokens is 'デバイストークンの SHA-256（16進）。平文は登録時に一度だけ返す';


-- ============================================================================
-- 2. 睡眠計測：sleep_sessions と計測系6テーブル
-- ============================================================================

-- 3. sleep_sessions：就寝〜起床の1回分
create table public.sleep_sessions (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references public.users (id) on delete cascade,
  chicken_device_id uuid        references public.devices (id) on delete set null,
  egg_device_id     uuid        references public.devices (id) on delete set null,
  start_time        timestamptz not null,
  end_time          timestamptz,
  planned_wake_time timestamptz not null,
  actual_wake_time  timestamptz,
  status            text        not null default 'in_progress'
                                check (status in ('in_progress', 'completed', 'aborted')),
  score             integer     check (score between 0 and 100),
  score_details     jsonb,
  constraint sleep_sessions_end_after_start check (end_time is null or end_time >= start_time),
  constraint sleep_sessions_wake_after_start check (planned_wake_time > start_time),
  constraint sleep_sessions_end_iff_finished check ((status = 'in_progress') = (end_time is null))
);
create index sleep_sessions_user_start_idx on public.sleep_sessions (user_id, start_time desc);
create index sleep_sessions_status_idx on public.sleep_sessions (status);
-- 進行中のセッションは1ユーザーにつき1つまで
create unique index sleep_sessions_one_in_progress_idx
  on public.sleep_sessions (user_id) where status = 'in_progress';
comment on column public.sleep_sessions.score_details is 'スコアの内訳（docs/dev-plan.md §6）';

-- セッションに紐づけるデバイスが、同じユーザーの正しい種類のデバイスかを確認する
create function public.check_sleep_session_devices()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.chicken_device_id is not null and not exists (
    select 1 from public.devices d
    where d.id = new.chicken_device_id and d.user_id = new.user_id and d.type = 'chicken'
  ) then
    raise exception 'chicken_device_id が不正です' using errcode = '23514';
  end if;
  if new.egg_device_id is not null and not exists (
    select 1 from public.devices d
    where d.id = new.egg_device_id and d.user_id = new.user_id and d.type = 'egg'
  ) then
    raise exception 'egg_device_id が不正です' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger sleep_sessions_check_devices
  before insert or update of user_id, chicken_device_id, egg_device_id on public.sleep_sessions
  for each row execute function public.check_sleep_session_devices();

-- 4. environment_readings：温湿度・照度（鶏）
create table public.environment_readings (
  id              bigint      generated always as identity primary key,
  session_id      uuid        not null references public.sleep_sessions (id) on delete cascade,
  device_id       uuid        not null references public.devices (id) on delete cascade,
  timestamp       timestamptz not null,
  temperature_c   numeric(4,1) check (temperature_c between -40 and 85),
  humidity_pct    numeric(4,1) check (humidity_pct between 0 and 100),
  illuminance_lux numeric(6,1) check (illuminance_lux >= 0),
  constraint environment_readings_dedup unique (device_id, timestamp)
);
create index environment_readings_session_ts_idx on public.environment_readings (session_id, timestamp);

-- 5. breathing_readings：呼吸数（ミリ波が主、マイクが補助）
create table public.breathing_readings (
  id              bigint      generated always as identity primary key,
  session_id      uuid        not null references public.sleep_sessions (id) on delete cascade,
  device_id       uuid        not null references public.devices (id) on delete cascade,
  timestamp       timestamptz not null,
  breaths_per_min numeric(4,1) not null check (breaths_per_min between 0 and 60),
  signal_source   text        not null check (signal_source in ('mmwave', 'mic')),
  constraint breathing_readings_dedup unique (device_id, timestamp, signal_source)
);
create index breathing_readings_session_ts_idx on public.breathing_readings (session_id, timestamp);

-- 6. motion_events：寝返り1回＝1行
create table public.motion_events (
  id               bigint      generated always as identity primary key,
  session_id       uuid        not null references public.sleep_sessions (id) on delete cascade,
  device_id        uuid        not null references public.devices (id) on delete cascade,
  timestamp        timestamptz not null,
  intensity        numeric(5,2) check (intensity >= 0),
  detection_source text        not null check (detection_source in ('accelerometer', 'mmwave')),
  constraint motion_events_dedup unique (device_id, timestamp, detection_source)
);
create index motion_events_session_ts_idx on public.motion_events (session_id, timestamp);

-- 7. audio_events：いびき・寝言1回＝1行
create table public.audio_events (
  id          bigint      generated always as identity primary key,
  session_id  uuid        not null references public.sleep_sessions (id) on delete cascade,
  device_id   uuid        not null references public.devices (id) on delete cascade,
  timestamp   timestamptz not null,
  event_type  text        not null check (event_type in ('snore', 'sleep_talk')),
  duration_ms integer     not null check (duration_ms > 0),
  confidence  numeric(3,2) check (confidence between 0 and 1),
  constraint audio_events_dedup unique (device_id, timestamp, event_type)
);
create index audio_events_session_ts_idx on public.audio_events (session_id, timestamp);

-- 8. presence_events：在床・離床の変化
create table public.presence_events (
  id         bigint      generated always as identity primary key,
  session_id uuid        not null references public.sleep_sessions (id) on delete cascade,
  device_id  uuid        not null references public.devices (id) on delete cascade,
  timestamp  timestamptz not null,
  state      text        not null check (state in ('in_bed', 'out_of_bed')),
  constraint presence_events_dedup unique (device_id, timestamp)
);
create index presence_events_session_ts_idx on public.presence_events (session_id, timestamp);

-- 9. charge_events：たまごの充電開始（巣に戻った）・停止（巣から離れた）
create table public.charge_events (
  id            bigint      generated always as identity primary key,
  egg_device_id uuid        not null references public.devices (id) on delete cascade,
  session_id    uuid        references public.sleep_sessions (id) on delete set null,
  timestamp     timestamptz not null,
  event_type    text        not null check (event_type in ('charge_start', 'charge_stop')),
  constraint charge_events_dedup unique (egg_device_id, timestamp, event_type)
);
create index charge_events_egg_ts_idx on public.charge_events (egg_device_id, timestamp desc);


-- ============================================================================
-- 3. アラーム・提案：alarms / sleep_recommendations
-- ============================================================================

-- 10. alarms：起床アラーム（time は日本時間）
create table public.alarms (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.users (id) on delete cascade,
  time        time        not null,
  repeat_days smallint[]  not null default '{0,1,2,3,4,5,6}'
                          check (cardinality(repeat_days) > 0
                                 and repeat_days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  enabled     boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index alarms_user_id_idx on public.alarms (user_id);
comment on column public.alarms.time is '日本時間（Asia/Tokyo）の時刻';
comment on column public.alarms.repeat_days is '鳴らす曜日（0=日〜6=土）。1つ以上';

create trigger alarms_set_updated_at
  before update on public.alarms
  for each row execute function public.set_updated_at();

-- 11. sleep_recommendations：今夜の推奨就寝時刻（日付ごとに1件）
create table public.sleep_recommendations (
  id                     uuid        primary key default gen_random_uuid(),
  user_id                uuid        not null references public.users (id) on delete cascade,
  target_date            date        not null,
  recommended_bedtime    timestamptz not null,
  recommended_wake_time  timestamptz,
  required_sleep_minutes integer     not null check (required_sleep_minutes between 60 and 900),
  first_event_title      text,
  first_event_start      timestamptz,
  reasoning              text,
  generated_at           timestamptz not null default now(),
  constraint sleep_recommendations_one_per_day unique (user_id, target_date)
);
comment on column public.sleep_recommendations.target_date is '起きる日（日本時間）。例：10/1 の夜の提案なら 10/2';


-- ============================================================================
-- 4. 会話：chat_sessions / chat_messages
-- ============================================================================

-- 12. chat_sessions：会話1回分
create table public.chat_sessions (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references public.users (id) on delete cascade,
  sleep_session_id uuid        references public.sleep_sessions (id) on delete set null,
  trigger          text        not null
                               check (trigger in ('button', 'app', 'scheduled_evening', 'scheduled_morning')),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz
);
create index chat_sessions_user_started_idx on public.chat_sessions (user_id, started_at desc);
comment on column public.chat_sessions.trigger is 'button=鶏のトサカボタン、app=Webアプリのテキスト会話、scheduled_*=夕方の提案・朝の振り返り';

-- 13. chat_messages：発言1つ＝1行
create table public.chat_messages (
  id              bigint      generated always as identity primary key,
  chat_session_id uuid        not null references public.chat_sessions (id) on delete cascade,
  role            text        not null check (role in ('user', 'assistant')),
  content         text        not null,
  audio_url       text,
  created_at      timestamptz not null default now()
);
create index chat_messages_session_created_idx on public.chat_messages (chat_session_id, created_at);


-- ============================================================================
-- 5. 設定：notification_settings
-- ============================================================================

-- 14. notification_settings：通知とキャラクターボイス
create table public.notification_settings (
  id                 uuid    primary key default gen_random_uuid(),
  user_id            uuid    not null unique references public.users (id) on delete cascade,
  evening_suggestion boolean not null default true,
  morning_score      boolean not null default true,
  character_voice    text    not null default 'rooster' check (character_voice in ('rooster', 'chick'))
);


-- ============================================================================
-- 6. サインアップ時に users と notification_settings を作る
-- ============================================================================
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@unknown.invalid'),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'ユーザー'
    )
  );
  insert into public.notification_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- 7. RPC
-- ============================================================================

-- デバイスの登録（docs/api-spec.md §2・§4-2）
--   鶏：トークンを作り直して平文を1回だけ返す（DB にはハッシュだけ保存）
--   たまご：トークンは返さない（null）
--   同じ種類のデバイスがすでにあれば、MAC アドレスを置き換える（1ユーザー各1台）
create function public.register_device(
  p_type             text,
  p_mac_address      text,
  p_firmware_version text default null
)
returns table (device_id uuid, device_token text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_mac     text := upper(trim(coalesce(p_mac_address, '')));
  v_device  public.devices%rowtype;
  v_token   text;
begin
  if v_user_id is null then
    raise exception 'ログインが必要です' using errcode = '28000';
  end if;
  if p_type is null or p_type not in ('chicken', 'egg') then
    raise exception 'デバイスの種類は chicken か egg です' using errcode = '22023';
  end if;
  if v_mac !~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$' then
    raise exception 'MACアドレスの形式が正しくありません（例：AA:BB:CC:DD:EE:FF）' using errcode = '22023';
  end if;

  select * into v_device from public.devices d where d.mac_address = v_mac;

  if found then
    if v_device.user_id <> v_user_id then
      raise exception 'このデバイスは別のユーザーに登録されています' using errcode = '42501';
    end if;
    if v_device.type <> p_type then
      raise exception 'このMACアドレスは別の種類のデバイスとして登録されています' using errcode = '22023';
    end if;
    if p_firmware_version is not null then
      update public.devices set firmware_version = p_firmware_version
      where id = v_device.id
      returning * into v_device;
    end if;
  else
    select * into v_device from public.devices d where d.user_id = v_user_id and d.type = p_type;
    if found then
      update public.devices
      set mac_address = v_mac,
          firmware_version = coalesce(p_firmware_version, 'unknown'),
          battery_level = null,
          last_seen = null,
          status = null,
          paired_at = now()
      where id = v_device.id
      returning * into v_device;
    else
      insert into public.devices (user_id, type, mac_address, firmware_version)
      values (v_user_id, p_type, v_mac, coalesce(p_firmware_version, 'unknown'))
      returning * into v_device;
    end if;
  end if;

  device_id := v_device.id;
  device_token := null;

  if p_type = 'chicken' then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.device_tokens (device_id, token_hash)
    values (v_device.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
    on conflict on constraint device_tokens_pkey
    do update set token_hash = excluded.token_hash, created_at = now();
    device_token := v_token;
  end if;

  return next;
end;
$$;

revoke execute on function public.register_device(text, text, text) from public, anon;
grant execute on function public.register_device(text, text, text) to authenticated;

-- 次に鳴らすアラームの時刻（日本時間の曜日・時刻から計算。7日以内）
--   呼び出したユーザーの権限で動くので、RLS により自分のアラームしか見えない
create function public.next_alarm_at(p_user_id uuid, p_from timestamptz default now())
returns table (alarm_id uuid, ring_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select a.id, (d.day + a.time) at time zone 'Asia/Tokyo' as ring_at
  from public.alarms a
  cross join lateral (
    select (p_from at time zone 'Asia/Tokyo')::date + g.n as day
    from generate_series(0, 7) as g(n)
  ) d
  where a.user_id = p_user_id
    and a.enabled
    and extract(dow from d.day)::smallint = any (a.repeat_days)
    and (d.day + a.time) at time zone 'Asia/Tokyo' > p_from
  order by ring_at
  limit 1;
$$;

revoke execute on function public.next_alarm_at(uuid, timestamptz) from public, anon;
grant execute on function public.next_alarm_at(uuid, timestamptz) to authenticated, service_role;


-- ============================================================================
-- 8. Row Level Security
--   クライアント（authenticated）は自分のデータだけ読める。
--   計測データ・会話・提案の書き込みは Edge Function（secret キー＝RLSを通らない）だけが行う。
-- ============================================================================
alter table public.users                 enable row level security;
alter table public.devices               enable row level security;
alter table public.device_tokens         enable row level security;
alter table public.sleep_sessions        enable row level security;
alter table public.environment_readings  enable row level security;
alter table public.breathing_readings    enable row level security;
alter table public.motion_events         enable row level security;
alter table public.audio_events          enable row level security;
alter table public.presence_events       enable row level security;
alter table public.charge_events         enable row level security;
alter table public.alarms                enable row level security;
alter table public.sleep_recommendations enable row level security;
alter table public.chat_sessions         enable row level security;
alter table public.chat_messages         enable row level security;
alter table public.notification_settings enable row level security;

-- device_tokens はポリシーを作らない（＝クライアントからは読み書き不可）。念のため権限も外す
revoke all on table public.device_tokens from anon, authenticated;

-- users
create policy "users_select_own" on public.users
  for select to authenticated using ((select auth.uid()) = id);
create policy "users_update_own" on public.users
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- devices（追加・付け替えは register_device 経由）
--   デバイスを削除すると計測データも消えるため、クライアントからの削除は許可しない。
--   別の機体に付け替えるときは register_device で MAC アドレスを置き換える（計測データは残る）。
create policy "devices_select_own" on public.devices
  for select to authenticated using ((select auth.uid()) = user_id);

-- sleep_sessions
create policy "sleep_sessions_select_own" on public.sleep_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "sleep_sessions_insert_own" on public.sleep_sessions
  for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'in_progress' and score is null);
create policy "sleep_sessions_update_own" on public.sleep_sessions
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 計測系：自分のセッションのデータだけ読める
create policy "environment_readings_select_own" on public.environment_readings
  for select to authenticated using (exists (
    select 1 from public.sleep_sessions s
    where s.id = session_id and s.user_id = (select auth.uid())));
create policy "breathing_readings_select_own" on public.breathing_readings
  for select to authenticated using (exists (
    select 1 from public.sleep_sessions s
    where s.id = session_id and s.user_id = (select auth.uid())));
create policy "motion_events_select_own" on public.motion_events
  for select to authenticated using (exists (
    select 1 from public.sleep_sessions s
    where s.id = session_id and s.user_id = (select auth.uid())));
create policy "audio_events_select_own" on public.audio_events
  for select to authenticated using (exists (
    select 1 from public.sleep_sessions s
    where s.id = session_id and s.user_id = (select auth.uid())));
create policy "presence_events_select_own" on public.presence_events
  for select to authenticated using (exists (
    select 1 from public.sleep_sessions s
    where s.id = session_id and s.user_id = (select auth.uid())));
create policy "charge_events_select_own" on public.charge_events
  for select to authenticated using (exists (
    select 1 from public.devices d
    where d.id = egg_device_id and d.user_id = (select auth.uid())));

-- alarms：自分のものは自由に編集できる
create policy "alarms_select_own" on public.alarms
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "alarms_insert_own" on public.alarms
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "alarms_update_own" on public.alarms
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "alarms_delete_own" on public.alarms
  for delete to authenticated using ((select auth.uid()) = user_id);

-- sleep_recommendations
create policy "sleep_recommendations_select_own" on public.sleep_recommendations
  for select to authenticated using ((select auth.uid()) = user_id);

-- chat_sessions / chat_messages
create policy "chat_sessions_select_own" on public.chat_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "chat_messages_select_own" on public.chat_messages
  for select to authenticated using (exists (
    select 1 from public.chat_sessions c
    where c.id = chat_session_id and c.user_id = (select auth.uid())));

-- notification_settings
create policy "notification_settings_select_own" on public.notification_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "notification_settings_update_own" on public.notification_settings
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);


-- ============================================================================
-- 9. Realtime（docs/api-spec.md §4-6）
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.sleep_sessions,
      public.environment_readings,
      public.breathing_readings,
      public.motion_events,
      public.audio_events,
      public.chat_messages;
  end if;
end;
$$;
