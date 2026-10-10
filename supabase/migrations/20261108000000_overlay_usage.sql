-- ============================================================
-- StreamHelp: Datenverbrauch des OBS-Overlays
--   · Jede Browserquelle (ganzes Overlay oder ein Modul, js/overlay-modules.js) misst, was sie lädt
--     (js/overlay-usage.js) und meldet alle 5 Minuten, was dazukam: Dateien (Seite, Bilder, Sounds),
--     Datenbank (Abfragen, Edge Functions), Live (Realtime-Verbindung), Chat (Twitch-Chat) und Sonstiges,
--     dazu wie lange sie lief.
--   · core.overlay_usage: Summen je Kanal, Tag (Berliner Zeit) und Modul – 90 Tage.
--   · overlay_usage_stats(p_days): für die Statistik im Dashboard (Streamer und freigegebene Mods).
-- Melden darf das Overlay ohne Anmeldung (wie die Watchtime). Damit niemand die Zahlen aufbläht: je Modul
-- höchstens eine Meldung pro Minute, Werte gedeckelt. Es sind nur Zahlen, keine Daten über Zuschauer.
-- Braucht 20261028000000_platform.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('public.channels') is null then
    raise exception 'Erst die Plattform-Migration 20261028000000_platform.sql ausführen.';
  end if;
end;
$$;

create table if not exists core.overlay_usage (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  day date not null,
  module text not null check (module ~ '^[a-z0-9-]{1,24}$'),   -- „all“ = ganzes Overlay
  files bigint not null default 0 check (files >= 0),
  db bigint not null default 0 check (db >= 0),
  live bigint not null default 0 check (live >= 0),
  chat bigint not null default 0 check (chat >= 0),
  other bigint not null default 0 check (other >= 0),
  seconds int not null default 0 check (seconds >= 0),       -- so lange lief die Quelle
  reports int not null default 0,
  last_at timestamptz not null default now(),
  primary key (channel_id, day, module)
);
alter table core.overlay_usage enable row level security;
revoke all on core.overlay_usage from anon, authenticated;
-- keine Policy: lesen nur über overlay_usage_stats, schreiben über overlay_usage_add

-- Meldung einer Browserquelle (Bytes seit der letzten Meldung)
create or replace function public.overlay_usage_add(p_module text, p_files bigint, p_db bigint, p_live bigint, p_chat bigint,
  p_other bigint, p_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_day date := (now() at time zone 'Europe/Berlin')::date;
  v_mod text := case when coalesce(p_module, '') ~ '^[a-z0-9-]{1,24}$' then p_module else 'all' end;
  cap constant bigint := 500 * 1024 * 1024;   -- mehr als 500 MB in 5 Minuten ist kein Overlay
  n int;
begin
  if v_ch is null then return false; end if;
  -- höchstens eine Meldung pro Minute und Modul (gegen Aufblähen)
  if exists (select 1 from core.overlay_usage where channel_id = v_ch and day = v_day and module = v_mod
             and last_at > now() - interval '50 seconds') then
    return false;
  end if;
  insert into core.overlay_usage as u (channel_id, day, module, files, db, live, chat, other, seconds, reports, last_at)
  values (v_ch, v_day, v_mod,
          least(greatest(coalesce(p_files, 0), 0), cap), least(greatest(coalesce(p_db, 0), 0), cap),
          least(greatest(coalesce(p_live, 0), 0), cap), least(greatest(coalesce(p_chat, 0), 0), cap),
          least(greatest(coalesce(p_other, 0), 0), cap), least(greatest(coalesce(p_seconds, 0), 0), 900), 1, now())
  on conflict (channel_id, day, module) do update set
    files = u.files + excluded.files, db = u.db + excluded.db, live = u.live + excluded.live,
    chat = u.chat + excluded.chat, other = u.other + excluded.other, seconds = u.seconds + excluded.seconds,
    reports = u.reports + 1, last_at = now();
  get diagnostics n = row_count;
  -- alte Tage aufräumen (selten genug, dass es nicht stört)
  if random() < 0.02 then
    delete from core.overlay_usage where channel_id = v_ch and day < v_day - 90;
  end if;
  return n > 0;
end;
$$;
revoke execute on function public.overlay_usage_add(text, bigint, bigint, bigint, bigint, bigint, int) from public;
grant execute on function public.overlay_usage_add(text, bigint, bigint, bigint, bigint, bigint, int) to anon, authenticated;

-- Statistik: je Tag (alle Module zusammen), je Modul und gesamt für die letzten p_days Tage (1–90)
create or replace function public.overlay_usage_stats(p_days int default 7)
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_days int := least(greatest(coalesce(p_days, 7), 1), 90);
  v_from date := (now() at time zone 'Europe/Berlin')::date - (v_days - 1);
  r json;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Nur für Streamer und freigegebene Mods.' using errcode = '42501';
  end if;
  with u as (select * from core.overlay_usage where channel_id = v_ch and day >= v_from),
  days as (select d::date as day from generate_series(v_from, (now() at time zone 'Europe/Berlin')::date, interval '1 day') d)
  select json_build_object(
    'days', v_days,
    'series', (select coalesce(json_agg(json_build_object(
                  'day', x.day, 'files', x.files, 'db', x.db, 'live', x.live, 'chat', x.chat, 'other', x.other, 'seconds', x.seconds) order by x.day), '[]')
               from (select d.day, coalesce(sum(u.files), 0) as files, coalesce(sum(u.db), 0) as db, coalesce(sum(u.live), 0) as live,
                            coalesce(sum(u.chat), 0) as chat, coalesce(sum(u.other), 0) as other, coalesce(sum(u.seconds), 0) as seconds
                     from days d left join u on u.day = d.day group by d.day) x),
    'modules', (select coalesce(json_agg(m order by m.total desc), '[]') from (
                  select module, sum(files + db + live + chat + other) as total, sum(seconds) as seconds, max(last_at) as last_at
                  from u group by module) m),
    'totals', (select json_build_object('files', coalesce(sum(files), 0), 'db', coalesce(sum(db), 0), 'live', coalesce(sum(live), 0),
                  'chat', coalesce(sum(chat), 0), 'other', coalesce(sum(other), 0), 'seconds', coalesce(sum(seconds), 0)) from u)
  ) into r;
  return r;
end;
$$;
revoke execute on function public.overlay_usage_stats(int) from public, anon;
grant execute on function public.overlay_usage_stats(int) to authenticated;

notify pgrst, 'reload schema';
