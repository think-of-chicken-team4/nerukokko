-- カレンダーの予定より何分前に起きるかを、ユーザーごとに変更できるようにする。
-- 初期値90分は、これまでの固定値と同じ。

alter table public.notification_settings
  add column calendar_prep_minutes smallint not null default 90
  check (calendar_prep_minutes between 15 and 360);

comment on column public.notification_settings.calendar_prep_minutes is
  '明日の最初の予定より何分前に起きるか（15〜360分）';
