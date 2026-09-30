-- ============================================================
-- Chat-Bot: !watchtime und eigene Befehle
--   1) Watchtime: Während der Stream live ist, holt die Edge Function stream-tools
--      alle paar Minuten die Zuschauer im Chat (Twitch „Get Chatters“) und schreibt
--      jedem die vergangene Zeit gut. Angestoßen wird das vom OBS-Overlay, das genau
--      während des Streams läuft. Ohne das Twitch-Recht moderator:read:chatters
--      zählen die, die in den letzten 10 Minuten geschrieben haben.
--   2) Eigene Befehle (bot_commands): Streamer, Admins und freigegebene Mods legen
--      im Dashboard Befehle mit fester Antwort an, z. B. !discord → „Unser Discord: …“.
--      Platzhalter: {user} {count} {watchtime} {streamer}
--   3) chat_command kennt zusätzlich !watchtime, !watchtime @name und !befehle
-- Der Bot wiederholt nie eingetippten Text: Antworten stammen aus der Datenbank,
-- Namen nur von Twitch (Anzeigename des Schreibers bzw. aus der Watchtime-Liste).
-- Braucht 20261016000000_streamhelp.sql. Mehrfach ausführbar.
-- ============================================================

-- ---------- 1) Watchtime ----------
create table if not exists public.watchtime (
  twitch_id text primary key check (twitch_id ~ '^[0-9]{1,20}$'),
  login text not null default '' check (char_length(login) <= 40),
  display_name text not null default '' check (char_length(display_name) <= 60),
  seconds bigint not null default 0 check (seconds >= 0),
  last_seen_at timestamptz,
  last_chat_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists watchtime_login_idx on public.watchtime (login);
create index if not exists watchtime_seconds_idx on public.watchtime (seconds desc);
alter table public.watchtime enable row level security;
drop policy if exists "watchtime: lesen für admins" on public.watchtime;
create policy "watchtime: lesen für admins" on public.watchtime
  for select to authenticated using ((select public.is_admin()));

create table if not exists public.watch_state (
  id int primary key default 1 check (id = 1),
  last_tick_at timestamptz,
  live boolean not null default false,
  source text not null default '',
  viewers int not null default 0
);
insert into public.watch_state (id) values (1) on conflict (id) do nothing;
alter table public.watch_state enable row level security;
drop policy if exists "watch_state: lesen für admins" on public.watch_state;
create policy "watch_state: lesen für admins" on public.watch_state
  for select to authenticated using ((select public.is_admin()));

-- „3 Std 12 Min“ – für Chat und Dashboard
create or replace function public.watch_fmt(p_seconds bigint)
returns text language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_seconds, 0) < 60 then 'weniger als 1 Min'
    else concat_ws(' ',
      case when p_seconds >= 86400 then (p_seconds / 86400)::text || case when p_seconds / 86400 = 1 then ' Tag' else ' Tage' end end,
      case when p_seconds % 86400 >= 3600 then ((p_seconds % 86400) / 3600)::text || ' Std' end,
      case when p_seconds % 3600 >= 60 then ((p_seconds % 3600) / 60)::text || ' Min' end)
  end;
$$;

-- Nur für die Edge Function (Service-Rolle): höchstens alle 4,5 Minuten ein Durchgang
create or replace function public.watch_tick_claim()
returns json language plpgsql security definer set search_path = '' as $$
declare
  prev timestamptz;
  was_live boolean;
begin
  select last_tick_at, live into prev, was_live from public.watch_state where id = 1 for update;
  if prev is not null and prev > now() - interval '270 seconds' then
    return null;
  end if;
  update public.watch_state set last_tick_at = now() where id = 1;
  return json_build_object('prev', prev, 'was_live', coalesce(was_live, false));
end;
$$;

create or replace function public.watch_add(p_users jsonb, p_seconds int, p_source text default '')
returns int language plpgsql security definer set search_path = '' as $$
declare
  secs int := greatest(0, least(coalesce(p_seconds, 0), 900));
  n int;
begin
  insert into public.watchtime (twitch_id, login, display_name, seconds, last_seen_at)
  select u ->> 'id', left(coalesce(u ->> 'login', ''), 40), left(coalesce(u ->> 'name', ''), 60), secs, now()
  from jsonb_array_elements(coalesce(p_users, '[]'::jsonb)) u
  where (u ->> 'id') ~ '^[0-9]{1,20}$'
  on conflict (twitch_id) do update set
    seconds = public.watchtime.seconds + excluded.seconds,
    login = case when excluded.login <> '' then excluded.login else public.watchtime.login end,
    display_name = case when excluded.display_name <> '' then excluded.display_name else public.watchtime.display_name end,
    last_seen_at = now(),
    updated_at = now();
  get diagnostics n = row_count;
  update public.watch_state set live = true, source = left(coalesce(p_source, ''), 20), viewers = n where id = 1;
  return n;
end;
$$;

create or replace function public.watch_offline()
returns void language sql security definer set search_path = '' as $$
  update public.watch_state set live = false, viewers = 0 where id = 1;
$$;

-- Jede Chat-Nachricht: zuletzt geschrieben (für die Zählung ohne Chatters-Recht)
create or replace function public.watch_seen(p_id text, p_login text, p_name text)
returns void language sql security definer set search_path = '' as $$
  insert into public.watchtime (twitch_id, login, display_name, last_chat_at)
  select p_id, left(coalesce(p_login, ''), 40), left(coalesce(p_name, ''), 60), now()
  where coalesce(p_id, '') ~ '^[0-9]{1,20}$'
  on conflict (twitch_id) do update set
    last_chat_at = now(),
    login = case when excluded.login <> '' then excluded.login else public.watchtime.login end,
    display_name = case when excluded.display_name <> '' then excluded.display_name else public.watchtime.display_name end;
$$;

revoke execute on function public.watch_tick_claim() from public, anon, authenticated;
revoke execute on function public.watch_add(jsonb, int, text) from public, anon, authenticated;
revoke execute on function public.watch_offline() from public, anon, authenticated;
revoke execute on function public.watch_seen(text, text, text) from public, anon, authenticated;

-- ---------- 2) Eigene Befehle ----------
create table if not exists public.bot_commands (
  id bigint generated always as identity primary key,
  command text not null unique
    check (command ~ '^![a-z0-9äöüß_]{2,25}$'
      and command not in ('!join', '!leave', '!a', '!b', '!c', '!d', '!change', '!watchtime', '!befehle', '!commands',
                          '!füttern', '!fuettern', '!erwischt', '!rate')),
  response text not null check (char_length(btrim(response)) between 1 and 400),
  enabled boolean not null default true,
  mod_only boolean not null default false,
  cooldown_seconds int not null default 10 check (cooldown_seconds between 0 and 3600),
  uses int not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bot_commands enable row level security;
drop policy if exists "bot_commands: lesen für admins" on public.bot_commands;
create policy "bot_commands: lesen für admins" on public.bot_commands
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "bot_commands: anlegen für admins" on public.bot_commands;
create policy "bot_commands: anlegen für admins" on public.bot_commands
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "bot_commands: ändern für admins" on public.bot_commands;
create policy "bot_commands: ändern für admins" on public.bot_commands
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "bot_commands: löschen für admins" on public.bot_commands;
create policy "bot_commands: löschen für admins" on public.bot_commands
  for delete to authenticated using ((select public.is_admin()));
-- Zähler und Zeitpunkt setzt nur der Bot: Angemeldete dürfen nur diese Spalten schreiben
revoke insert, update on public.bot_commands from anon, authenticated;
grant insert (command, response, enabled, mod_only, cooldown_seconds) on public.bot_commands to authenticated;
grant update (command, response, enabled, mod_only, cooldown_seconds, updated_at) on public.bot_commands to authenticated;
grant select, delete on public.bot_commands to authenticated;
do $$ begin perform public.realtime_add('bot_commands'); end $$;

-- Einmal ein paar Beispiele (nur wenn noch keine da sind)
insert into public.bot_commands (command, response, enabled)
select * from (values
  ('!lurk', '{user} macht es sich gemütlich und lurkt mit. Danke fürs Dabeibleiben! 💜', true),
  ('!hydrate', 'Trinkpause! {streamer} und alle im Chat: einmal Wasser trinken 💧', true),
  ('!socials', 'Alle Links von {streamer} stehen unten im Laufband 🔗', false)
) v(command, response, enabled)
where not exists (select 1 from public.bot_commands);

-- Abklingzeit je Zuschauer für !watchtime
create table if not exists public.chat_cooldowns (
  slot text primary key check (char_length(slot) <= 80),
  at timestamptz not null default now()
);
alter table public.chat_cooldowns enable row level security;

-- ---------- 3) chat_command: neue Befehle ----------
-- Unverändert aus …_stream_extras.sql, dazu am Ende: !watchtime, !befehle, eigene Befehle
create or replace function public.chat_command(p_user_id text, p_name text, p_badges text[], p_text text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  msg text := btrim(coalesce(p_text, ''));
  cmd text;
  arg text;
  key text;
  res json;
  is_mod boolean := coalesce(p_badges && array['moderator', 'broadcaster'], false);
  who text := left(coalesce(nullif(btrim(p_name), ''), 'Zuschauer'), 60);
  w public.watchtime;
  c public.bot_commands;
  streamer text;
  reply text;
  mine bigint;
begin
  if msg !~ '^!' or coalesce(p_user_id, '') !~ '^[0-9]{1,20}$' then return null; end if;
  cmd := lower(split_part(msg, ' ', 1));
  arg := btrim(substr(msg, char_length(cmd) + 1));
  key := 'tw:' || p_user_id;
  if cmd = (select report_command from public.forbidden_word where id = 1) then
    perform public.forbidden_report(key, p_name);
    return null;
  end if;
  if cmd in ('!a', '!b', '!c', '!d') then
    perform public.quiz_answer(key, p_name, ascii(substr(cmd, 2, 1)) - ascii('a'));
    return null;
  end if;
  if cmd = (select guess_command from public.pause_screen where id = 1) then
    perform public.pause_guess(key, p_name, split_part(arg, ' ', 1));
    return null;
  end if;
  if cmd = '!join' then
    res := public.queue_join(key, p_name, arg, coalesce(p_badges && array['subscriber', 'founder'], false), 'chat');
    return case when res is null then null else json_build_object('reply', res ->> 'reply') end;
  end if;
  if cmd = '!leave' then
    res := public.queue_leave(key, p_name);
    return case when res is null then null else json_build_object('reply', res ->> 'reply') end;
  end if;

  -- Ab hier: Bot-Befehle. Raid-Schutz: nur Mods bekommen noch Antworten.
  if public.viewer_paused() and not is_mod then return null; end if;

  if cmd = '!watchtime' then
    -- 30 Sekunden Pause je Zuschauer
    if exists (select 1 from public.chat_cooldowns where chat_cooldowns.slot = 'wt:' || p_user_id and at > now() - interval '30 seconds') then
      return null;
    end if;
    insert into public.chat_cooldowns (slot, at) values ('wt:' || p_user_id, now())
      on conflict (slot) do update set at = now();
    delete from public.chat_cooldowns where at < now() - interval '1 day';
    if arg ~ '^@?[a-zA-Z0-9_]{3,25}$' then
      -- Nur bekannte Namen – sonst keine Antwort (der Bot wiederholt nie eingetippten Text)
      select * into w from public.watchtime where login = lower(ltrim(arg, '@')) limit 1;
      if w.twitch_id is null or w.seconds < 60 then return null; end if;
      return json_build_object('reply', format('%s schaut schon %s zu 👀', coalesce(nullif(w.display_name, ''), w.login), public.watch_fmt(w.seconds)));
    end if;
    select * into w from public.watchtime where twitch_id = p_user_id;
    if w.twitch_id is null or w.seconds < 60 then
      return json_build_object('reply', format('@%s, bei dir ist noch keine Watchtime erfasst – sie zählt, solange der Stream live ist und du im Chat bist.', who));
    end if;
    return json_build_object('reply', format('@%s schaut schon %s zu 💜', who, public.watch_fmt(w.seconds)));
  end if;

  if cmd in ('!befehle', '!commands') then
    if exists (select 1 from public.chat_cooldowns where chat_cooldowns.slot = 'cmds' and at > now() - interval '30 seconds') then
      return null;
    end if;
    insert into public.chat_cooldowns (slot, at) values ('cmds', now()) on conflict (slot) do update set at = now();
    select string_agg(command, ' ' order by command) into reply
      from public.bot_commands where enabled and (not mod_only or is_mod);
    return json_build_object('reply', left('Befehle: !watchtime ' || coalesce(reply, ''), 480));
  end if;

  -- Eigene Befehle
  select * into c from public.bot_commands where command = cmd and enabled;
  if c.id is null then return null; end if;
  if c.mod_only and not is_mod then return null; end if;
  if c.last_used_at is not null and c.last_used_at > now() - make_interval(secs => c.cooldown_seconds) then
    return null;
  end if;
  update public.bot_commands set uses = uses + 1, last_used_at = now() where id = c.id;
  streamer := coalesce((select nullif(display_name, '') from public.twitch_connection where id = 1), 'der Streamer');
  select seconds into mine from public.watchtime where twitch_id = p_user_id;
  reply := c.response;
  reply := replace(reply, '{user}', '@' || who);
  reply := replace(reply, '{count}', (c.uses + 1)::text);
  reply := replace(reply, '{streamer}', streamer);
  reply := replace(reply, '{watchtime}', public.watch_fmt(coalesce(mine, 0)));
  return json_build_object('reply', left(reply, 480));
end;
$$;
revoke execute on function public.chat_command(text, text, text[], text) from public, anon, authenticated;

-- Watchtime-Rangliste fürs Dashboard (Team)
create or replace function public.watch_top(p_limit int default 20)
returns table (display_name text, login text, seconds bigint, pretty text, last_seen_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select w.display_name, w.login, w.seconds, public.watch_fmt(w.seconds), w.last_seen_at
  from public.watchtime w
  where public.is_admin() and w.seconds > 0
  order by w.seconds desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;
revoke execute on function public.watch_top(int) from public, anon;
grant execute on function public.watch_top(int) to authenticated;
