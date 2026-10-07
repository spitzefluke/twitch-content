-- ============================================================
-- StreamHelp: Zahlen für den Balken auf der Startseite („Auf einen Blick“)
--   public.platform_stats() – für alle lesbar (auch ohne Anmeldung), nur Summen über alle
--   freigeschalteten Kanäle, keine Namen. Die Startseite fragt alle 30 Sekunden nach.
--   Damit viele Besucher die Datenbank nicht ständig zählen lassen, merkt sich die Funktion das
--   Ergebnis 20 Sekunden lang (core.platform_stats_cache).
-- Braucht 20261028000000_platform.sql (Tabellen je Kanal). Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('public.channels') is null then
    raise exception 'Erst die Plattform-Migration 20261028000000_platform.sql ausführen.';
  end if;
end;
$$;

create table if not exists core.platform_stats_cache (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  at timestamptz not null default now()
);
alter table core.platform_stats_cache enable row level security;
revoke all on core.platform_stats_cache from anon, authenticated;
-- keine Policy: nur die Funktion unten (security definer) liest und schreibt

-- Zählt neu (ohne Zwischenspeicher)
create or replace function core.platform_stats_count()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
  r jsonb;
begin
  with ch as (select id from public.channels where status = 'active'),
  live as (
    select w.channel_id, w.viewer_count from core.watch_state w
    where w.channel_id in (select id from ch) and w.live and w.last_tick_at > now() - interval '15 minutes'
  )
  select jsonb_build_object(
    'streamers',       (select count(*) from ch),
    'live',            (select count(*) from live),
    'viewers_now',     (select coalesce(sum(viewer_count), 0) from live),
    'watch_hours',     (select floor(coalesce(sum(seconds), 0) / 3600)::bigint from core.watchtime where channel_id in (select id from ch)),
    'viewers_total',   (select count(*) from core.watchtime where channel_id in (select id from ch)),
    'spins',           (select count(*) from core.spins where channel_id in (select id from ch)),
    'spins_today',     (select count(*) from core.spins where channel_id in (select id from ch) and created_at >= v_today),
    'pranks',          (select count(*) from core.pranks where channel_id in (select id from ch)),
    'pranks_today',    (select count(*) from core.pranks where channel_id in (select id from ch) and created_at >= v_today),
    'questions',       (select count(*) from core.questions where channel_id in (select id from ch)),
    'ideas',           (select count(*) from core.ideas where channel_id in (select id from ch)),
    'winners',         (select count(*) from core.giveaway_winners where channel_id in (select id from ch)),
    'alerts',          (select count(*) from core.stream_alerts where channel_id in (select id from ch) and not test),
    'alerts_today',    (select count(*) from core.stream_alerts where channel_id in (select id from ch) and not test and created_at >= v_today),
    'pet_moments',     (select count(*) from core.pet_events where channel_id in (select id from ch)),
    'tts',             (select count(*) from core.tts_messages where channel_id in (select id from ch) and status = 'approved'),
    'cards',           (select count(*) from core.card_pulls where channel_id in (select id from ch)),
    'quiz_answers',    (select count(*) from core.quiz_answers where channel_id in (select id from ch)),
    'hotwords',        (select coalesce(sum(n), 0) from core.hotword_counts where channel_id in (select id from ch)),
    'players',         (select count(*) from core.queue_entries where channel_id in (select id from ch) and status in ('picked', 'done')),
    'at',              now()
  ) into r;
  return r;
end;
$$;
revoke execute on function core.platform_stats_count() from public, anon, authenticated;

create or replace function public.platform_stats()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c core.platform_stats_cache;
  v jsonb;
begin
  select * into c from core.platform_stats_cache where id = 1;
  if found and c.at > now() - interval '20 seconds' then return c.data; end if;
  -- Nur einer zählt neu, alle anderen nehmen so lange den letzten Stand
  if not pg_try_advisory_xact_lock(hashtext('streamhelp.platform_stats')) then
    return coalesce(c.data, '{}'::jsonb);
  end if;
  v := core.platform_stats_count();
  insert into core.platform_stats_cache (id, data, at) values (1, v, now())
    on conflict (id) do update set data = excluded.data, at = excluded.at;
  return v;
end;
$$;
revoke execute on function public.platform_stats() from public;
grant execute on function public.platform_stats() to anon, authenticated;

notify pgrst, 'reload schema';
