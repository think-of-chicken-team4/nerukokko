-- 夕方の就寝提案を、毎日 10:00 UTC（＝19:00 日本時間）に全ユーザーぶん作る（T-206、docs/api-spec.md §4-5・§5）。
-- 仕組みは close-stale-sessions と同じ：pg_cron が Edge Function「evening-suggestion」を secret キーで呼ぶ（pg_net）。
-- 呼び先の URL と secret キーは Vault（project_url・secret_key）から読む。入っていなければ何もしない（server/CLAUDE.md）。
-- pg_cron・pg_net がない環境（PGlite のテスト）では作らない。
do $migration$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron または pg_net がないので、evening-suggestion の定期実行は作りません';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;

  perform cron.schedule(
    'evening-suggestion',
    '0 10 * * *',
    $job$
      select net.http_post(
        url := s.url || '/functions/v1/evening-suggestion',
        headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', s.secret_key),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
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
