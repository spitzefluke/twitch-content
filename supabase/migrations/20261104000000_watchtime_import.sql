-- ============================================================
-- StreamHelp: Watchtime – alte Zahlen importieren, Twitch-Daten, „zählt seit“
--   Twitch gibt die bisherige Zuschauzeit nicht heraus (es gibt keine Schnittstelle dafür) – jedes Tool
--   zählt erst ab dem Moment, ab dem es mitläuft. Darum:
--   1) core.watch_imports: Watchtime aus einem früheren Bot (StreamElements, Streamlabs …), per CSV im
--      Dashboard eingelesen. Gezählt wird beides zusammen (verknüpft über den Twitch-Namen).
--   2) core.watchtime bekommt „Follower seit“ und „Twitch-Konto seit“ – die liefert Twitch wirklich
--      (die Edge Functions holen sie bei !watchtime und für die Rangliste im Dashboard nach).
--   3) core.watch_state.counting_since: ab wann StreamHelp in diesem Kanal mitzählt.
--   4) !watchtime und {watchtime} rechnen den Import mit; !watchtime nennt „Follower seit …“.
-- Braucht 20261028000000_platform.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.watchtime') is null then
    raise exception 'Erst die Plattform-Migration 20261028000000_platform.sql ausführen.';
  end if;
end;
$$;

-- ---------- 1) Import ----------
create table if not exists core.watch_imports (
  channel_id uuid not null default public.current_channel() references public.channels (id) on delete cascade,
  login text not null check (login ~ '^[a-z0-9_]{1,25}$'),
  display_name text not null default '' check (char_length(display_name) <= 60),
  seconds bigint not null check (seconds between 0 and 3153600000),
  source text not null default '' check (char_length(source) <= 40),
  imported_at timestamptz not null default now(),
  primary key (channel_id, login)
);
alter table core.watch_imports enable row level security;
revoke all on core.watch_imports from anon, authenticated;
-- keine Policy: nur über die Funktionen unten (security definer)

-- ---------- 2) Twitch-Daten ----------
alter table core.watchtime add column if not exists followed_at timestamptz;
alter table core.watchtime add column if not exists account_created_at timestamptz;
alter table core.watchtime add column if not exists twitch_checked_at timestamptz;
select public.channel_view('watchtime');

-- ---------- 3) Zählt seit ----------
alter table core.watch_state add column if not exists counting_since timestamptz;
select public.channel_view('watch_state');
-- Bestehende Kanäle: frühester bekannter Zeitpunkt (eine Schätzung – genauer weiß es niemand)
update core.watch_state s set counting_since = (
  select least(min(w.last_seen_at), min(w.last_chat_at), min(w.updated_at)) from core.watchtime w where w.channel_id = s.channel_id)
where s.counting_since is null;

create or replace function core.watch_counting_start()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update core.watch_state set counting_since = now() where channel_id = new.channel_id and counting_since is null;
  return null;
end;
$$;
revoke execute on function core.watch_counting_start() from public, anon, authenticated;
drop trigger if exists watch_counting_start on core.watchtime;
create trigger watch_counting_start after insert on core.watchtime
  for each row execute function core.watch_counting_start();

-- ---------- Summen ----------
-- Gesamte Watchtime eines Zuschauers im aktuellen Kanal: StreamHelp + Import (über den Namen)
create or replace function public.watch_total(p_twitch_id text, p_login text default null)
returns bigint language sql stable security definer set search_path = '' as $$
  with w as (select login, seconds from public.watchtime where twitch_id = p_twitch_id)
  select coalesce((select seconds from w), 0)
       + coalesce((select i.seconds from core.watch_imports i
                    where i.channel_id = public.current_channel()
                      and i.login = lower(coalesce((select nullif(login, '') from w), p_login, ''))), 0);
$$;
revoke execute on function public.watch_total(text, text) from public, anon, authenticated;

-- Antwort auf !watchtime bzw. !watchtime @name (Pause und Raid-Schutz prüft chat_command)
create or replace function public.watch_reply(p_user_id text, p_who text, p_arg text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  ch uuid := public.current_channel();
  v_login text;
  w public.watchtime;
  imp core.watch_imports;
  total bigint;
  follow text := '';
begin
  if coalesce(p_arg, '') ~ '^@?[a-zA-Z0-9_]{3,25}$' then
    -- Nur bekannte Namen – sonst keine Antwort (der Bot wiederholt nie eingetippten Text)
    v_login := lower(ltrim(p_arg, '@'));
    select * into w from public.watchtime where login = v_login limit 1;
    select * into imp from core.watch_imports where channel_id = ch and login = v_login;
    total := coalesce(w.seconds, 0) + coalesce(imp.seconds, 0);
    if total < 60 then return null; end if;
    if w.followed_at is not null then follow := ' · Follower seit ' || to_char(w.followed_at at time zone 'Europe/Berlin', 'DD.MM.YYYY'); end if;
    return format('%s schaut schon %s zu 👀%s', coalesce(nullif(w.display_name, ''), nullif(imp.display_name, ''), v_login),
                  public.watch_fmt(total), follow);
  end if;
  select * into w from public.watchtime where twitch_id = p_user_id;
  total := public.watch_total(p_user_id, case when lower(p_who) ~ '^[a-z0-9_]{1,25}$' then lower(p_who) end);
  if total < 60 then
    return format('@%s, bei dir ist noch keine Watchtime erfasst – sie zählt, solange der Stream live ist und du im Chat bist.', p_who);
  end if;
  if w.followed_at is not null then follow := ' · Follower seit ' || to_char(w.followed_at at time zone 'Europe/Berlin', 'DD.MM.YYYY'); end if;
  return format('@%s schaut schon %s zu 💜%s', p_who, public.watch_fmt(total), follow);
end;
$$;
revoke execute on function public.watch_reply(text, text, text) from public, anon, authenticated;

-- ---------- 4) !watchtime und {watchtime} mit Import ----------
CREATE OR REPLACE FUNCTION public.chat_command(p_user_id text, p_name text, p_badges text[], p_text text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      on conflict (channel_id, slot) do update set at = now();
    delete from public.chat_cooldowns where at < now() - interval '1 day';
    reply := public.watch_reply(p_user_id, who, arg);
    return case when reply is null then null else json_build_object('reply', reply) end;
  end if;

  if cmd in ('!befehle', '!commands') then
    if exists (select 1 from public.chat_cooldowns where chat_cooldowns.slot = 'cmds' and at > now() - interval '30 seconds') then
      return null;
    end if;
    insert into public.chat_cooldowns (slot, at) values ('cmds', now()) on conflict (channel_id, slot) do update set at = now();
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
  mine := public.watch_total(p_user_id, lower(p_name));
  reply := c.response;
  reply := replace(reply, '{user}', '@' || who);
  reply := replace(reply, '{count}', (c.uses + 1)::text);
  reply := replace(reply, '{streamer}', streamer);
  reply := replace(reply, '{watchtime}', public.watch_fmt(coalesce(mine, 0)));
  return json_build_object('reply', left(reply, 480));
end;
$function$;

-- ---------- Rangliste im Dashboard (mit Import und Twitch-Daten) ----------
drop function if exists public.watch_top(int);
create function public.watch_top(p_limit int default 20)
returns table (display_name text, login text, seconds bigint, pretty text, last_seen_at timestamptz,
               twitch_id text, imported bigint, followed_at timestamptz, account_created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with w as (select * from public.watchtime),
  i as (select * from core.watch_imports where channel_id = public.current_channel()),
  t as (
    select coalesce(nullif(w.display_name, ''), nullif(i.display_name, ''), w.login, i.login) as display_name,
           coalesce(nullif(w.login, ''), i.login) as login,
           coalesce(w.seconds, 0) + coalesce(i.seconds, 0) as seconds,
           w.last_seen_at, w.twitch_id, coalesce(i.seconds, 0) as imported, w.followed_at, w.account_created_at
    from w full join i on i.login = lower(w.login)
  )
  select t.display_name, t.login, t.seconds, public.watch_fmt(t.seconds), t.last_seen_at,
         t.twitch_id, t.imported, t.followed_at, t.account_created_at
  from t
  where public.is_admin() and t.seconds > 0
  order by t.seconds desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;
revoke execute on function public.watch_top(int) from public, anon;
grant execute on function public.watch_top(int) to authenticated;

-- ---------- Import verwalten (nur der Streamer) ----------
-- p_rows: [{"login": "name", "name": "Anzeigename", "seconds": 3600}, …] – ersetzt den bisherigen Import.
create or replace function public.watch_import(p_rows jsonb, p_source text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  ch uuid := public.current_channel();
  n int;
  s bigint;
begin
  if ch is null or not public.is_owner() then
    raise exception 'Den Import macht nur der Streamer.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 50000 then
    raise exception 'Höchstens 50.000 Zeilen auf einmal.';
  end if;
  delete from core.watch_imports where channel_id = ch;
  insert into core.watch_imports (channel_id, login, display_name, seconds, source)
  select ch, x.login, left(max(coalesce(x.name, '')), 60), least(sum(greatest(x.seconds, 0)), 3153600000), left(coalesce(p_source, ''), 40)
  from jsonb_to_recordset(p_rows) as x(login text, name text, seconds bigint)
  where x.login ~ '^[a-z0-9_]{1,25}$' and x.seconds > 0
  group by x.login;
  get diagnostics n = row_count;
  select coalesce(sum(seconds), 0) into s from core.watch_imports where channel_id = ch;
  return json_build_object('count', n, 'seconds', s);
end;
$$;
revoke execute on function public.watch_import(jsonb, text) from public, anon;
grant execute on function public.watch_import(jsonb, text) to authenticated;

create or replace function public.watch_import_clear()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_channel() is null or not public.is_owner() then
    raise exception 'Den Import löscht nur der Streamer.' using errcode = '42501';
  end if;
  delete from core.watch_imports where channel_id = public.current_channel();
end;
$$;
revoke execute on function public.watch_import_clear() from public, anon;
grant execute on function public.watch_import_clear() to authenticated;

-- Stand fürs Dashboard: zählt seit, Import (Anzahl, Summe, Quelle, wann)
create or replace function public.watch_info()
returns json language sql stable security definer set search_path = '' as $$
  select case when public.is_admin() then json_build_object(
    'counting_since', (select counting_since from core.watch_state where channel_id = public.current_channel() limit 1),
    'imported', (select json_build_object('count', count(*), 'seconds', coalesce(sum(seconds), 0),
                        'source', max(source), 'at', max(imported_at))
                 from core.watch_imports where channel_id = public.current_channel()),
    'viewers', (select count(*) from public.watchtime where seconds > 0)
  ) end;
$$;
revoke execute on function public.watch_info() from public, anon;
grant execute on function public.watch_info() to authenticated;

notify pgrst, 'reload schema';
