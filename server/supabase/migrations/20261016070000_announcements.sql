-- 鶏が話して知らせた（夕方の就寝提案・朝のスコア）ことを覚える列（決定ログ 2026-10-16 Q9、docs/api-spec.md §3-2）。
-- device-sync が「話す内容」を鶏に渡したときに入れ、同じ内容を二度話さないようにする。
alter table public.sleep_recommendations add column announced_at timestamptz;
comment on column public.sleep_recommendations.announced_at is '鶏が夕方の提案を話した（device-sync で渡した）時刻';

alter table public.sleep_sessions add column morning_announced_at timestamptz;
comment on column public.sleep_sessions.morning_announced_at is '鶏が朝のコメントを話した（device-sync で渡した）時刻';
