-- Stream-Zeitplan und öffentliches Streamer-Profil (nach …_bot_pacing.sql einspielen). Ändert keine Daten.
--
--   · core.stream_schedule: Wochenplan je Kanal (Wochentag, Uhrzeit, Dauer, Titel, Game). Bearbeiten
--     dürfen Streamer, Admins und freigegebene Mods (schedule_save).
--   · core.channel_profile: Profil je Kanal – Kurztext, Links, Zeitzone, „Pause bis …“ und ob die
--     Seite öffentlich ist. Öffentlich machen entscheidet nur der Streamer (profile_save).
--   · public_profile(login): die öffentliche Seite profil.html?c=<login> – nur für aktive Kanäle,
--     deren Streamer zugestimmt hat. Liefert die nächsten Termine schon in echter Zeit (Zeitzone,
--     Sommerzeit und „Pause bis …“ eingerechnet).
--   · showcase_list(): zusätzlich „profile“, damit die Startseite aufs Profil verlinken kann.

-- ---------- Tabellen ----------
create table if not exists core.stream_schedule (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),          -- ISO: 1 = Montag … 7 = Sonntag
  start_time time not null,
  minutes int not null default 120 check (minutes between 15 and 1440),
  title text not null default '' check (char_length(title) <= 80),
  game text not null default '' check (char_length(game) <= 60),
  created_at timestamptz not null default now()
);
create index if not exists stream_schedule_channel on core.stream_schedule (channel_id, weekday, start_time);
alter table core.stream_schedule enable row level security;
revoke all on core.stream_schedule from anon, authenticated;

create table if not exists core.channel_profile (
  channel_id uuid primary key references public.channels on delete cascade,
  is_public boolean not null default false,
  bio text not null default '' check (char_length(bio) <= 300),
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 8),
  tz text not null default 'Europe/Berlin' check (char_length(tz) <= 60),
  away_until date,
  away_note text not null default '' check (char_length(away_note) <= 120),
  updated_at timestamptz not null default now()
);
alter table core.channel_profile enable row level security;
revoke all on core.channel_profile from anon, authenticated;

-- ---------- Hilfen ----------
-- Nur https-Links mit kurzem Namen; alles andere fällt raus
create or replace function public.profile_clean_links(p_links jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', left(btrim(coalesce(l->>'label', '')), 30), 'url', btrim(l->>'url')) order by o), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_links) = 'array' then p_links else '[]'::jsonb end) with ordinality as x(l, o)
  where o <= 8 and jsonb_typeof(l) = 'object' and coalesce(l->>'url', '') ~ '^https://[^\s<>"''\\]{3,}$' and char_length(l->>'url') <= 300;
$$;
revoke execute on function public.profile_clean_links(jsonb) from public, anon, authenticated;

-- Nächste Termine (bis 14 Tage) in echter Zeit
create or replace function public.schedule_upcoming(p_channel uuid, p_limit int default 8)
returns json language sql stable security definer set search_path = '' as $$
  with p as (
    select coalesce(cp.tz, 'Europe/Berlin') as tz, cp.away_until
    from (select 1) one left join core.channel_profile cp on cp.channel_id = p_channel
  ), d as (
    select ((now() at time zone p.tz)::date + g) as day, p.tz, p.away_until
    from p, generate_series(-1, 14) g
  ), t as (
    select (d.day + s.start_time) at time zone d.tz as start_at, s.minutes, s.title, s.game
    from d join core.stream_schedule s on s.channel_id = p_channel and s.weekday = extract(isodow from d.day)
    where d.away_until is null or d.day > d.away_until
  )
  select coalesce(json_agg(json_build_object('at', t.start_at, 'minutes', t.minutes, 'title', t.title, 'game', t.game) order by t.start_at), '[]'::json)
  from (select * from t where t.start_at + make_interval(mins => t.minutes) > now() order by t.start_at limit greatest(1, least(coalesce(p_limit, 8), 20))) t;
$$;
revoke execute on function public.schedule_upcoming(uuid, int) from public, anon, authenticated;

-- ---------- Dashboard ----------
-- Profil und Plan des Kanals der Anfrage (Team des Kanals)
create or replace function public.profile_get()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.'; end if;
  return (
    select json_build_object(
      'login', c.login, 'display_name', c.display_name, 'can_publish', public.is_owner_of(v_ch),
      'is_public', coalesce(cp.is_public, false), 'bio', coalesce(cp.bio, ''), 'links', coalesce(cp.links, '[]'::jsonb),
      'tz', coalesce(cp.tz, 'Europe/Berlin'), 'away_until', cp.away_until, 'away_note', coalesce(cp.away_note, ''),
      'slots', coalesce((select json_agg(json_build_object('weekday', s.weekday, 'start', to_char(s.start_time, 'HH24:MI'),
                          'minutes', s.minutes, 'title', s.title, 'game', s.game) order by s.weekday, s.start_time)
                         from core.stream_schedule s where s.channel_id = v_ch), '[]'::json),
      'upcoming', public.schedule_upcoming(v_ch, 6))
    from public.channels c left join core.channel_profile cp on cp.channel_id = c.id
    where c.id = v_ch
  );
end;
$$;
revoke execute on function public.profile_get() from public, anon;
grant execute on function public.profile_get() to authenticated;

-- Wochenplan ersetzen: [{weekday, start: 'HH:MM', minutes, title, game}, …] – höchstens 21 Termine
create or replace function public.schedule_save(p_slots jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  s jsonb;
  n int := 0;
begin
  if not public.is_admin_of(v_ch) then raise exception 'Den Zeitplan dürfen Streamer, Admins und freigegebene Mods ändern.'; end if;
  if jsonb_typeof(coalesce(p_slots, '[]'::jsonb)) <> 'array' then raise exception 'Ungültiger Zeitplan.'; end if;
  if jsonb_array_length(coalesce(p_slots, '[]'::jsonb)) > 21 then raise exception 'Höchstens 21 Termine pro Woche.'; end if;
  delete from core.stream_schedule where channel_id = v_ch;
  for s in select * from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) loop
    if coalesce(s->>'weekday', '') !~ '^[1-7]$' or coalesce(s->>'start', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
      raise exception 'Ungültiger Termin: Wochentag 1–7 und Uhrzeit HH:MM.';
    end if;
    insert into core.stream_schedule (channel_id, weekday, start_time, minutes, title, game)
    values (v_ch, (s->>'weekday')::smallint, (s->>'start')::time,
            greatest(15, least(coalesce(nullif(s->>'minutes', '')::int, 120), 1440)),
            left(btrim(coalesce(s->>'title', '')), 80), left(btrim(coalesce(s->>'game', '')), 60));
    n := n + 1;
  end loop;
  return public.profile_get();
end;
$$;
revoke execute on function public.schedule_save(jsonb) from public, anon;
grant execute on function public.schedule_save(jsonb) to authenticated;

-- Profil speichern. Text, Links und Zeitzone: Team; öffentlich machen: nur der Streamer
create or replace function public.profile_save(p_bio text, p_links jsonb, p_tz text, p_away_until date, p_away_note text, p_public boolean default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_tz text := coalesce(nullif(btrim(p_tz), ''), 'Europe/Berlin');
begin
  if not public.is_admin_of(v_ch) then raise exception 'Das Profil dürfen Streamer, Admins und freigegebene Mods ändern.'; end if;
  if p_public is not null and not public.is_owner_of(v_ch) then raise exception 'Ob das Profil öffentlich ist, entscheidet nur der Streamer.'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then raise exception 'Unbekannte Zeitzone.'; end if;
  insert into core.channel_profile as cp (channel_id, is_public, bio, links, tz, away_until, away_note, updated_at)
  values (v_ch, coalesce(p_public, false), left(btrim(coalesce(p_bio, '')), 300), public.profile_clean_links(p_links), v_tz,
          p_away_until, left(btrim(coalesce(p_away_note, '')), 120), now())
  on conflict (channel_id) do update set
    is_public = coalesce(p_public, cp.is_public), bio = excluded.bio, links = excluded.links, tz = excluded.tz,
    away_until = excluded.away_until, away_note = excluded.away_note, updated_at = now();
  return public.profile_get();
end;
$$;
revoke execute on function public.profile_save(text, jsonb, text, date, text, boolean) from public, anon;
grant execute on function public.profile_save(text, jsonb, text, date, text, boolean) to authenticated;

-- ---------- Öffentliche Seite ----------
create or replace function public.public_profile(p_login text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'login', c.login, 'display_name', c.display_name, 'avatar_url', c.avatar_url,
    'live', coalesce(g.live_at > now() - interval '15 minutes', false),
    'category', case when g.live_at > now() - interval '15 minutes' then left(coalesce(g.live_category, ''), 60) else '' end,
    'bio', cp.bio, 'links', cp.links, 'tz', cp.tz,
    'away_until', case when cp.away_until >= (now() at time zone cp.tz)::date then cp.away_until end,
    'away_note', case when cp.away_until >= (now() at time zone cp.tz)::date then cp.away_note else '' end,
    'slots', coalesce((select json_agg(json_build_object('weekday', s.weekday, 'start', to_char(s.start_time, 'HH24:MI'),
                        'minutes', s.minutes, 'title', s.title, 'game', s.game) order by s.weekday, s.start_time)
                       from core.stream_schedule s where s.channel_id = c.id), '[]'::json),
    'upcoming', public.schedule_upcoming(c.id, 8))
  from public.channels c
  join core.channel_profile cp on cp.channel_id = c.id and cp.is_public
  left join core.stream_games g on g.channel_id = c.id and g.id = 1
  where c.status = 'active' and c.login = lower(btrim(coalesce(p_login, '')))
  limit 1;
$$;
grant execute on function public.public_profile(text) to anon, authenticated;

-- Startseite: wie in …_contact_showcase.sql, dazu „profile“ (öffentliches Profil vorhanden)
create or replace function public.showcase_list()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(x order by x.live desc, lower(x.display_name)), '[]'::json) from (
    select c.login, c.display_name, c.avatar_url,
      coalesce(g.live_at > now() - interval '15 minutes', false) as live,
      case when g.live_at > now() - interval '15 minutes' then left(coalesce(g.live_category, ''), 60) else '' end as category,
      coalesce(cp.is_public, false) as profile
    from public.channels c
    left join core.stream_games g on g.channel_id = c.id and g.id = 1
    left join core.channel_profile cp on cp.channel_id = c.id
    where c.status = 'active' and c.showcase and c.login is not null
    limit 48
  ) x;
$$;
grant execute on function public.showcase_list() to anon, authenticated;

notify pgrst, 'reload schema';
