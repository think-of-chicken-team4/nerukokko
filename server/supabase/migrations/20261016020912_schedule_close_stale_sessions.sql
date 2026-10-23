-- 巣に戻らないまま起床予定から3時間たった睡眠セッションを、10分ごとに締める（T-209、docs/api-spec.md §5）。
-- pg_cron が Edge Function「close-stale-sessions」を secret キーで呼ぶ（pg_net）。
--
-- 呼び先の URL と secret キーは、リポジトリ（PUBLIC）に書かず、DB の Vault に入れる（手順は server/CLAUDE.md）。
--   project_url：関数の URL の元（ローカルは http://host.docker.internal:54321、本番は https://<project>.supabase.co）
--   secret_key ：secret キー（sb_secret_...）
-- どちらかが入っていなければ、ジョブは何もしない。
-- pg_cron・pg_net がない環境（DB のテストに使う PGlite など）では、ジョブを作らずに飛ばす。
do $migration$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron または pg_net がないので、close-stale-sessions の定期実行は作りません';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;

  -- 同じ名前のジョブがあれば上書きされる
  perform cron.schedule(
    'close-stale-sessions',
    '*/10 * * * *',
    $job$
      select net.http_post(
        url := s.url || '/functions/v1/close-stale-sessions',
        headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', s.secret_key),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      )
      from (
        select
          (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as url,
          (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key') as secret_key
      ) s
      where s.url is not null and s.secret_key is not null
    $job$
  );
end
$migration$;
