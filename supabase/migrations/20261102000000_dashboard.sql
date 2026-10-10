-- ============================================================
-- StreamHelp: Dashboard aufräumen + Stream-Statistik
--   1) Die Countdown-Kachel „Subathon“ heißt jetzt „Countdown zum Subathon“ – sonst stehen zwei
--      Kacheln „Subathon“ nebeneinander (die andere ist der Subathon-Timer).
--   2) core.stream_days: je Kanal und Tag Sendeminuten, Höchst- und Durchschnitts-Zuschauerzahl.
--      Gefüllt von einem Trigger auf core.watch_state (die Watchtime-Zählung tickt dort alle ~5 Min).
--   3) public.channel_stats(p_days): Statistik des aktuellen Kanals für Streamer und freigegebene Mods.
-- Braucht 20261028000000_platform.sql und 20261031000000_security.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('public.channels') is null then
    raise exception 'Erst die Plattform-Migration 20261028000000_platform.sql ausführen.';
  end if;
end;
$$;

-- ---------- 1) Doppelte „Subathon“-Kachel ----------
update core.tiles set title = 'Countdown zum Subathon',
       description = 'Der nächste Subathon kommt! Jeder Sub verlängert den Stream – wie lange geht es diesmal?'
 where id = 'idea-4' and kind = 'countdown' and title = 'Subathon';

-- ---------- 2) Sendetage ----------
create table if not exists core.stream_days (
  channel_id uuid not null references public.channels (id) on delete cascade,
  day date not null,
  live_minutes int not null default 0 check (live_minutes >= 0),
  peak_viewers int not null default 0 check (peak_viewers >= 0),
  viewer_sum bigint not null default 0 check (viewer_sum >= 0),   -- Summe der Messungen (für den Durchschnitt)
  samples int not null default 0 check (samples >= 0),
  primary key (channel_id, day)
);
alter table core.stream_days enable row level security;
revoke all on core.stream_days from anon, authenticated;
-- keine Policy: gelesen wird nur über public.channel_stats (security definer)

create or replace function core.stream_days_track()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'Europe/Berlin')::date;
  v_min int := 0;
begin
  if not new.live or new.last_tick_at is null then return new; end if;
  -- Sendezeit: Abstand zum letzten Tick, wenn der Stream dazwischen schon lief (Lücken > 15 Min zählen nicht)
  if old.live and old.last_tick_at is not null and new.last_tick_at > old.last_tick_at
     and new.last_tick_at - old.last_tick_at < interval '15 minutes' then
    v_min := round(extract(epoch from new.last_tick_at - old.last_tick_at) / 60);
  end if;
  insert into core.stream_days as d (channel_id, day, live_minutes, peak_viewers, viewer_sum, samples)
  values (new.channel_id, v_day, v_min, greatest(new.viewer_count, 0), greatest(new.viewer_count, 0), 1)
  on conflict (channel_id, day) do update set
    live_minutes = d.live_minutes + excluded.live_minutes,
    peak_viewers = greatest(d.peak_viewers, excluded.peak_viewers),
    viewer_sum = d.viewer_sum + excluded.viewer_sum,
    samples = d.samples + 1;
  return new;
end;
$$;
revoke execute on function core.stream_days_track() from public, anon, authenticated;

drop trigger if exists stream_days_track on core.watch_state;
create trigger stream_days_track after update of last_tick_at on core.watch_state
  for each row execute function core.stream_days_track();

-- ---------- 3) Statistik für das Dashboard ----------
-- Letzte p_days Tage (1–90) des aktuellen Kanals: Tageswerte, Summen und die treuesten Zuschauer.
create or replace function public.channel_stats(p_days int default 7)
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_days int := least(greatest(coalesce(p_days, 7), 1), 90);
  v_from date := (now() at time zone 'Europe/Berlin')::date - (v_days - 1);
  v_since timestamptz := v_from::timestamp at time zone 'Europe/Berlin';
  r json;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Nur für Streamer und freigegebene Mods.' using errcode = '42501';
  end if;
  with days as (
    select d::date as day from generate_series(v_from, (now() at time zone 'Europe/Berlin')::date, interval '1 day') d
  ),
  local as (  -- Zeitpunkte als Berliner Kalendertag
    select 'alert' as src, a.kind, a.amount, (a.created_at at time zone 'Europe/Berlin')::date as day
      from core.stream_alerts a where a.channel_id = v_ch and not a.test and a.created_at >= v_since
    union all select 'spin', null, 0, (s.created_at at time zone 'Europe/Berlin')::date from core.spins s where s.channel_id = v_ch and s.created_at >= v_since
    union all select 'prank', null, 0, (p.created_at at time zone 'Europe/Berlin')::date from core.pranks p where p.channel_id = v_ch and p.created_at >= v_since
    union all select 'winner', null, 0, (w.created_at at time zone 'Europe/Berlin')::date from core.giveaway_winners w where w.channel_id = v_ch and w.created_at >= v_since
    union all select 'tts', null, 0, (t.created_at at time zone 'Europe/Berlin')::date from core.tts_messages t where t.channel_id = v_ch and t.status = 'approved' and t.created_at >= v_since
    union all select 'card', null, 0, (c.created_at at time zone 'Europe/Berlin')::date from core.card_pulls c where c.channel_id = v_ch and c.created_at >= v_since
  ),
  per_day as (
    select d.day,
      coalesce(sd.live_minutes, 0) as live_minutes,
      coalesce(sd.peak_viewers, 0) as peak_viewers,
      case when coalesce(sd.samples, 0) > 0 then round(sd.viewer_sum::numeric / sd.samples)::int else 0 end as avg_viewers,
      count(l.*) filter (where l.src = 'alert' and l.kind = 'follow') as follows,
      count(l.*) filter (where l.src = 'alert' and l.kind in ('sub', 'resub')) +
        coalesce(sum(greatest(l.amount, 1)) filter (where l.src = 'alert' and l.kind = 'gift'), 0) as subs,
      coalesce(sum(l.amount) filter (where l.src = 'alert' and l.kind = 'bits'), 0) as bits,
      count(l.*) filter (where l.src = 'alert' and l.kind = 'redeem') as redeems,
      count(l.*) filter (where l.src = 'spin') as spins,
      count(l.*) filter (where l.src = 'prank') as pranks,
      count(l.*) filter (where l.src in ('winner', 'tts', 'card')) as actions
    from days d
    left join core.stream_days sd on sd.channel_id = v_ch and sd.day = d.day
    left join local l on l.day = d.day
    group by d.day, sd.live_minutes, sd.peak_viewers, sd.viewer_sum, sd.samples
  )
  select json_build_object(
    'days', v_days,
    'series', (select coalesce(json_agg(row_to_json(p) order by p.day), '[]') from per_day p),
    'totals', (select json_build_object(
        'live_minutes', coalesce(sum(live_minutes), 0), 'peak_viewers', coalesce(max(peak_viewers), 0),
        'avg_viewers', coalesce(round(avg(nullif(avg_viewers, 0))), 0),
        'follows', coalesce(sum(follows), 0), 'subs', coalesce(sum(subs), 0), 'bits', coalesce(sum(bits), 0),
        'redeems', coalesce(sum(redeems), 0), 'spins', coalesce(sum(spins), 0), 'pranks', coalesce(sum(pranks), 0),
        'actions', coalesce(sum(actions), 0)) from per_day),
    'top_viewers', (select coalesce(json_agg(json_build_object('name', coalesce(nullif(w.display_name, ''), w.login), 'seconds', w.seconds)), '[]')
        from (select display_name, login, seconds from core.watchtime where channel_id = v_ch and seconds > 0
              order by seconds desc limit 5) w),
    'chatters', (select count(*) from core.watchtime where channel_id = v_ch and last_chat_at >= v_since)
  ) into r;
  return r;
end;
$$;
revoke execute on function public.channel_stats(int) from public, anon;
grant execute on function public.channel_stats(int) to authenticated;

notify pgrst, 'reload schema';
