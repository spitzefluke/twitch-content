-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Win-Challenge – nur für Dave: eine Leiter aus Stufen, die Dave der Reihe nach
-- gewinnen muss:
--   · game  – Games gewinnen (z. B. „Gewinne ein Solo-Game“)
--   · round – Runden gewinnen (z. B. „3 Zone-Wars-Runden“)
--   · fight – Fights gegen Mods (z. B. „1v1 Box-Fight gegen Mod X, first to 2“)
-- Jede Stufe hat ein Ziel (so viele Siege braucht es). Optional hat die Challenge
-- Leben: jede Niederlage kostet eins, sind alle weg, ist sie gescheitert.
-- Eintragen darf nur Dave – und die Admins, wenn Dave es erlaubt.
-- Alle sehen den Stand (Webseite und OBS-Overlay, auch ohne Login).
-- Braucht 20260930000000_live_overlay.sql (is_owner). Mehrfach ausführbar.
-- ============================================================

-- ---------- Kachel ----------
alter table public.tiles drop constraint if exists tiles_kind_check;
alter table public.tiles add constraint tiles_kind_check
  check (kind in ('wheel', 'countdown', 'prank', 'bingo', 'questions', 'pet', 'shop', 'challenge'));

do $$
begin
  if not exists (select 1 from public.tiles where id = 'challenge') then
    update public.tiles set position = position + 1 where kind = 'countdown';
    insert into public.tiles (id, position, kind, title, description, theme) values
      ('challenge', (select coalesce(max(position), 1) + 1 from public.tiles where kind <> 'countdown'), 'challenge',
       'Win-Challenge',
       'Games, Runden und Fights gegen die Mods – schafft Dave alle Stufen, bevor ihm die Leben ausgehen?',
       'challenge');
  end if;
end;
$$;

-- ---------- Die Challenge (eine Zeile) ----------
create table if not exists public.win_challenge (
  id int primary key default 1 check (id = 1),
  title text not null default 'Win-Challenge' check (char_length(title) between 1 and 60),
  lives int not null default 3 check (lives between 0 and 10),          -- 0 = ohne Leben
  lives_left int not null default 3 check (lives_left between 0 and 10),
  -- [{id, kind, title, opponent, target, wins, losses}]
  stages jsonb not null default '[
    {"id":"s1","kind":"game","title":"Gewinne ein Solo-Game","opponent":"","target":1,"wins":0,"losses":0},
    {"id":"s2","kind":"round","title":"Gewinne 3 Zone-Wars-Runden","opponent":"","target":3,"wins":0,"losses":0},
    {"id":"s3","kind":"fight","title":"1v1 Box-Fight","opponent":"Mod","target":2,"wins":0,"losses":0},
    {"id":"s4","kind":"game","title":"Gewinne ein Duo-Game","opponent":"","target":1,"wins":0,"losses":0},
    {"id":"s5","kind":"fight","title":"1v1 Build-Fight – Endgegner","opponent":"Mod","target":3,"wins":0,"losses":0}
  ]'::jsonb check (jsonb_typeof(stages) = 'array' and jsonb_array_length(stages) between 1 and 30),
  current int not null default 0 check (current >= 0),
  status text not null default 'ready' check (status in ('ready', 'running', 'won', 'failed')),
  admins_can_edit boolean not null default false,
  -- Letztes Ereignis für die Animation im Overlay: {n, type, stage, title, at}
  last_event jsonb not null default '{}'::jsonb,
  -- Für „Rückgängig“: frühere Stände (höchstens 20)
  history jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.win_challenge (id) values (1) on conflict (id) do nothing;
alter table public.win_challenge enable row level security;

drop policy if exists "win_challenge: lesen für alle" on public.win_challenge;
create policy "win_challenge: lesen für alle" on public.win_challenge
  for select to anon, authenticated using (true);
grant select on public.win_challenge to anon;
-- Schreiben nur über die Funktionen unten.

create or replace function public.challenge_can_edit()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_owner()
    or (public.is_admin() and coalesce((select admins_can_edit from public.win_challenge where id = 1), false));
$$;

create or replace function public.challenge_access()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'can_edit', public.challenge_can_edit(),
    'is_owner', public.is_owner(),
    'admins_can_edit', coalesce((select admins_can_edit from public.win_challenge where id = 1), false)
  );
$$;

-- Wer darf, sonst Fehler; sperrt die Zeile für die Änderung
create or replace function public.challenge_lock()
returns public.win_challenge language plpgsql security definer set search_path = '' as $$
declare
  c public.win_challenge;
begin
  if not public.challenge_can_edit() then
    raise exception 'Die Win-Challenge trägt nur Dave ein (oder Admins, wenn Dave es erlaubt).';
  end if;
  select * into c from public.win_challenge where id = 1 for update;
  return c;
end;
$$;

-- Stufen aufräumen: bekannte Art, Titel, Gegner nur beim Fight, Ziel 1–99.
-- Siege/Niederlagen bleiben an der Stufe (gleiche id), neue Stufen fangen bei 0 an.
create or replace function public.challenge_clean(p_stages jsonb, p_old jsonb)
returns jsonb language sql volatile set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', sid,
      'kind', kind,
      'title', coalesce(nullif(left(btrim(coalesce(e ->> 'title', '')), 60), ''),
                        case kind when 'round' then 'Runde gewinnen' when 'fight' then 'Fight gegen einen Mod' else 'Game gewinnen' end),
      'opponent', case when kind = 'fight' then left(btrim(coalesce(e ->> 'opponent', '')), 30) else '' end,
      'target', target,
      'wins', least(target, greatest(0, coalesce((o ->> 'wins')::int, 0))),
      'losses', greatest(0, coalesce((o ->> 'losses')::int, 0))
    ) order by ord), '[]'::jsonb)
  from (
    select e, ord,
      case when e ->> 'kind' in ('game', 'round', 'fight') then e ->> 'kind' else 'game' end as kind,
      least(99, greatest(1, coalesce(case when (e ->> 'target') ~ '^\d{1,3}$' then (e ->> 'target')::int end, 1))) as target,
      case when coalesce(e ->> 'id', '') ~ '^[a-z0-9]{1,12}$' then e ->> 'id' else substr(md5(random()::text || ord), 1, 8) end as sid
    from jsonb_array_elements(case when jsonb_typeof(p_stages) = 'array' then p_stages else '[]'::jsonb end)
      with ordinality as t(e, ord)
    where jsonb_typeof(e) = 'object'
    limit 30
  ) s
  left join lateral (
    select o from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) o where o ->> 'id' = s.sid limit 1
  ) old on true;
$$;
revoke execute on function public.challenge_clean(jsonb, jsonb) from public, anon, authenticated;

-- Erste Stufe, die noch nicht geschafft ist (sonst die Anzahl = alle geschafft)
create or replace function public.challenge_first_open(p_stages jsonb)
returns int language sql immutable set search_path = '' as $$
  select coalesce(min(ord - 1)::int, jsonb_array_length(p_stages))
  from jsonb_array_elements(p_stages) with ordinality as t(e, ord)
  where (e ->> 'wins')::int < (e ->> 'target')::int;
$$;

create or replace function public.challenge_event(c public.win_challenge, p_type text, p_stage int)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'n', coalesce((c.last_event ->> 'n')::int, 0) + 1,
    'type', p_type,
    'stage', p_stage,
    'title', coalesce(c.stages -> p_stage ->> 'title', ''),
    'by', public.my_name(),
    'at', now()
  );
$$;

create or replace function public.challenge_snapshot(c public.win_challenge)
returns jsonb language sql immutable set search_path = '' as $$
  select (jsonb_build_array(jsonb_build_object(
    'stages', c.stages, 'current', c.current, 'lives_left', c.lives_left, 'status', c.status,
    'started_at', c.started_at, 'finished_at', c.finished_at
  )) || c.history) - 20;
$$;

-- ---------- Einrichten ----------
create or replace function public.challenge_save(p_title text, p_lives int, p_stages jsonb)
returns public.win_challenge language plpgsql security definer set search_path = '' as $$
declare
  c public.win_challenge := public.challenge_lock();
  next_stages jsonb := public.challenge_clean(p_stages, c.stages);
  v_lives int := least(10, greatest(0, coalesce(p_lives, c.lives)));
  open_at int;
  result public.win_challenge;
begin
  if jsonb_array_length(next_stages) = 0 then
    raise exception 'Die Challenge braucht mindestens eine Stufe.';
  end if;
  open_at := public.challenge_first_open(next_stages);
  update public.win_challenge set
    title = coalesce(nullif(left(btrim(coalesce(p_title, '')), 60), ''), 'Win-Challenge'),
    lives = v_lives,
    lives_left = case
      when c.status = 'ready' or c.lives = 0 then v_lives
      else least(v_lives, greatest(0, c.lives_left + v_lives - c.lives)) end,
    stages = next_stages,
    current = least(open_at, jsonb_array_length(next_stages) - 1),
    status = case
      when c.status = 'ready' then 'ready'
      when c.status = 'failed' then 'failed'
      when open_at >= jsonb_array_length(next_stages) then 'won'
      else 'running' end,
    last_event = public.challenge_event(c, 'edit', least(open_at, jsonb_array_length(next_stages) - 1)),
    updated_by = public.my_name(),
    updated_at = now()
  where id = 1
  returning * into result;
  return result;
end;
$$;

-- ---------- Sieg oder Niederlage auf der aktuellen Stufe ----------
create or replace function public.challenge_result(p_win boolean)
returns public.win_challenge language plpgsql security definer set search_path = '' as $$
declare
  c public.win_challenge := public.challenge_lock();
  stage jsonb;
  wins int;
  losses int;
  last int;
  ev text;
  result public.win_challenge;
begin
  if c.status in ('won', 'failed') then
    raise exception 'Die Challenge ist vorbei – starte sie neu, um weiterzuspielen.';
  end if;
  last := jsonb_array_length(c.stages) - 1;
  stage := c.stages -> c.current;
  wins := (stage ->> 'wins')::int;
  losses := (stage ->> 'losses')::int;
  c.history := public.challenge_snapshot(c);
  if c.status = 'ready' then
    c.status := 'running';
    c.started_at := now();
  end if;
  if coalesce(p_win, false) then
    wins := wins + 1;
    c.stages := jsonb_set(c.stages, array[c.current::text, 'wins'], to_jsonb(wins));
    ev := 'win';
    if wins >= (stage ->> 'target')::int then
      if c.current >= last then
        c.status := 'won';
        c.finished_at := now();
        ev := 'won';
      else
        ev := 'stage';
      end if;
    end if;
  else
    losses := losses + 1;
    c.stages := jsonb_set(c.stages, array[c.current::text, 'losses'], to_jsonb(losses));
    ev := 'loss';
    if c.lives > 0 then
      c.lives_left := greatest(0, c.lives_left - 1);
      if c.lives_left = 0 then
        c.status := 'failed';
        c.finished_at := now();
        ev := 'failed';
      end if;
    end if;
  end if;
  update public.win_challenge set
    stages = c.stages,
    current = case when ev = 'stage' then c.current + 1 else c.current end,
    lives_left = c.lives_left,
    status = c.status,
    started_at = c.started_at,
    finished_at = c.finished_at,
    history = c.history,
    last_event = public.challenge_event(c, ev, c.current),
    updated_by = public.my_name(),
    updated_at = now()
  where id = 1
  returning * into result;
  return result;
end;
$$;

create or replace function public.challenge_undo()
returns public.win_challenge language plpgsql security definer set search_path = '' as $$
declare
  c public.win_challenge := public.challenge_lock();
  snap jsonb := c.history -> 0;
  result public.win_challenge;
begin
  if snap is null then
    raise exception 'Es gibt nichts zum Rückgängigmachen.';
  end if;
  -- Die Stufen selbst können inzwischen bearbeitet worden sein: Stand je id übernehmen
  update public.win_challenge set
    stages = public.challenge_clean(c.stages, snap -> 'stages'),
    current = least((snap ->> 'current')::int, jsonb_array_length(c.stages) - 1),
    lives_left = least(c.lives, (snap ->> 'lives_left')::int),
    status = snap ->> 'status',
    started_at = (snap ->> 'started_at')::timestamptz,
    finished_at = (snap ->> 'finished_at')::timestamptz,
    history = c.history - 0,
    last_event = public.challenge_event(c, 'undo', least((snap ->> 'current')::int, jsonb_array_length(c.stages) - 1)),
    updated_by = public.my_name(),
    updated_at = now()
  where id = 1
  returning * into result;
  return result;
end;
$$;

-- Zu einer Stufe springen (überspringen oder zurück)
create or replace function public.challenge_goto(p_index int)
returns public.win_challenge language plpgsql security definer set search_path = '' as $$
declare
  c public.win_challenge := public.challenge_lock();
  v_to int := least(jsonb_array_length(c.stages) - 1, greatest(0, coalesce(p_index, 0)));
  result public.win_challenge;
begin
  update public.win_challenge set
    current = v_to,
    status = case when c.status = 'ready' then 'ready' else 'running' end,
    finished_at = null,
    history = public.challenge_snapshot(c),
    last_event = public.challenge_event(c, 'goto', v_to),
    updated_by = public.my_name(),
    updated_at = now()
  where id = 1
  returning * into result;
  return result;
end;
$$;

create or replace function public.challenge_reset()
returns public.win_challenge language plpgsql security definer set search_path = '' as $$
declare
  c public.win_challenge := public.challenge_lock();
  result public.win_challenge;
begin
  update public.win_challenge set
    stages = (select jsonb_agg(e || '{"wins":0,"losses":0}'::jsonb order by ord) from jsonb_array_elements(c.stages) with ordinality t(e, ord)),
    current = 0,
    lives_left = c.lives,
    status = 'ready',
    started_at = null,
    finished_at = null,
    history = '[]'::jsonb,
    last_event = public.challenge_event(c, 'reset', 0),
    updated_by = public.my_name(),
    updated_at = now()
  where id = 1
  returning * into result;
  return result;
end;
$$;

create or replace function public.challenge_allow_admins(p_on boolean)
returns public.win_challenge language plpgsql security definer set search_path = '' as $$
declare
  result public.win_challenge;
begin
  if not public.is_owner() then
    raise exception 'Nur Dave darf das erlauben.';
  end if;
  update public.win_challenge set admins_can_edit = coalesce(p_on, false), updated_at = now()
    where id = 1 returning * into result;
  return result;
end;
$$;

revoke execute on function public.challenge_lock() from public, anon, authenticated;
revoke execute on function public.challenge_event(public.win_challenge, text, int) from public, anon, authenticated;
revoke execute on function public.challenge_snapshot(public.win_challenge) from public, anon, authenticated;
revoke execute on function public.challenge_access() from public, anon;
revoke execute on function public.challenge_save(text, int, jsonb) from public, anon;
revoke execute on function public.challenge_result(boolean) from public, anon;
revoke execute on function public.challenge_undo() from public, anon;
revoke execute on function public.challenge_goto(int) from public, anon;
revoke execute on function public.challenge_reset() from public, anon;
revoke execute on function public.challenge_allow_admins(boolean) from public, anon;
grant execute on function public.challenge_access() to authenticated;
grant execute on function public.challenge_save(text, int, jsonb) to authenticated;
grant execute on function public.challenge_result(boolean) to authenticated;
grant execute on function public.challenge_undo() to authenticated;
grant execute on function public.challenge_goto(int) to authenticated;
grant execute on function public.challenge_reset() to authenticated;
grant execute on function public.challenge_allow_admins(boolean) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'win_challenge'
  ) then
    alter publication supabase_realtime add table public.win_challenge;
  end if;
end;
$$;
