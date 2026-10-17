-- Google カレンダー連携（T-205、docs/api-spec.md §4-7）。
-- トークンはサーバー（Edge Function の secret キー）だけが読み書きする。クライアントからは読めない（RLS を有効にしてポリシーを作らない）。
-- クライアントは calendar_status() で「つながっているか」だけを知る。

create table public.google_credentials (
  user_id        uuid        primary key references public.users (id) on delete cascade,
  refresh_token  text        not null,
  access_token   text,
  expires_at     timestamptz,
  scope          text,
  connected_at   timestamptz not null default now()
);
comment on table public.google_credentials is 'Google カレンダーのトークン（サーバーだけが使う）';
alter table public.google_credentials enable row level security;
revoke all on table public.google_credentials from anon, authenticated;

-- OAuth の state（同意画面から戻ってきたのが、その人の操作か確かめる。10分で使えなくなる）
create table public.oauth_states (
  state         text        primary key,
  user_id       uuid        not null references public.users (id) on delete cascade,
  redirect_uri  text        not null,
  created_at    timestamptz not null default now()
);
alter table public.oauth_states enable row level security;
revoke all on table public.oauth_states from anon, authenticated;

-- ログイン中のユーザーのカレンダーがつながっているか
create function public.calendar_status()
returns table (connected boolean, connected_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.google_credentials g where g.user_id = auth.uid()),
         (select g.connected_at from public.google_credentials g where g.user_id = auth.uid());
$$;
revoke execute on function public.calendar_status() from public, anon;
grant execute on function public.calendar_status() to authenticated;
