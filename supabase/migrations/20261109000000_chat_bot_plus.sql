-- ============================================================
-- StreamHelp: Chat-Bot mit mehr Funktionen
--   1) Stream-Infos: !uptime, !followage, !game, !title und (Mods) !so @name – die Antworten holt die Edge
--      Function bei Twitch; hier nur An/Aus, Abklingzeit und der Text fürs Shoutout.
--   2) Auto-Nachrichten (bot_timers): kommen nur, wenn im Chat etwas los ist (mind. N Nachrichten seit dem
--      letzten Mal) und frühestens nach X Minuten; zwischen zwei Auto-Nachrichten liegt eine Pause für alle.
--   3) Begrüßung (neue Zuschauer oder einmal je Stream) und Danke für Follow, Abo, Resub, verschenkte Abos,
--      Bits und Raids – dazu auf Wunsch automatisch ein Shoutout für den Raider.
--   4) Moderation: Links (mit erlaubten Seiten und !permit), GROSSBUCHSTABEN, Spam (Zeichen-Wiederholung,
--      zu viele Emotes), gesperrte Wörter. Folge: Nachricht löschen oder Timeout; Mods und Streamer immer
--      ausgenommen, VIPs und Abonnenten auf Wunsch.
--   5) Eigene Befehle mit mehr Einstellungen: Aliase, wer darf (alle, Abos, VIPs, Mods, Streamer),
--      Pause je Zuschauer, Antwortart (normal, als Antwort, mit @), nur im Stream; neue Platzhalter
--      {touser} {random} {random:1-6} {uptime} {game} {title} {followage}.
--   6) Song-Wünsche: !sr <YouTube-Link> → Warteschlange (bot_songs). Abgespielt wird im Dashboard
--      (Bot & Chat → Song-Wünsche), das Overlay zeigt den laufenden Song und die nächsten.
--      Im Chat außerdem !song, !queue, !wrongsong und (Mods) !skip.
-- Der Bot wiederholt weiter keinen eingetippten Text: Namen kommen von Twitch oder aus der Watchtime-Liste,
-- Songtitel von YouTube.
-- Braucht 20261108000000_overlay_usage.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.overlay_usage') is null then
    raise exception 'Erst die Migration 20261108000000_overlay_usage.sql ausführen.';
  end if;
end;
$$;

-- ---------- Edge Functions (Service-Rolle) dürfen alle Kanal-Tabellen lesen und schreiben ----------
-- Tabellen, die direkt in core angelegt wurden (Umfragen, Zähler, Chat-Kommandos …), hatten dafür keine Rechte –
-- in public gibt Supabase sie automatisch, in eigenen Schemas nicht. Ab jetzt auch für spätere Tabellen.
grant all on all tables in schema core to service_role;
grant all on all sequences in schema core to service_role;
alter default privileges in schema core grant all on tables to service_role;
alter default privileges in schema core grant all on sequences to service_role;

-- ---------- Einstellungen (eine Zeile je Kanal, nur für Streamer und freigegebene Mods) ----------
create table if not exists core.bot_settings (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  id int not null default 1 check (id = 1),
  -- Stream-Infos
  info_on boolean not null default true,
  info_cooldown int not null default 15 check (info_cooldown between 0 and 600),
  so_text text not null default 'Schaut unbedingt bei {target} vorbei – zuletzt lief {game}: https://twitch.tv/{login} 💜'
    check (char_length(btrim(so_text)) between 1 and 300),
  -- Begrüßung
  greet_mode text not null default 'off' check (greet_mode in ('off', 'new', 'stream')),
  greet_text text not null default 'Willkommen im Chat, {user}! Schön, dass du da bist 💜'
    check (char_length(btrim(greet_text)) between 1 and 300),
  greet_back_text text not null default 'Hey {user}, schön dass du wieder da bist! 👋'
    check (char_length(btrim(greet_back_text)) between 1 and 300),
  -- Danke für Ereignisse
  thank_follow boolean not null default false,
  thank_follow_text text not null default 'Danke fürs Folgen, {user}! 💜' check (char_length(btrim(thank_follow_text)) between 1 and 300),
  thank_sub boolean not null default true,
  thank_sub_text text not null default 'Danke für dein Abo, {user}! 🎉' check (char_length(btrim(thank_sub_text)) between 1 and 300),
  thank_resub_text text not null default 'Danke für {months} Monate, {user}! 🎉' check (char_length(btrim(thank_resub_text)) between 1 and 300),
  thank_gift_text text not null default '{user} verschenkt {amount} Abos – vielen Dank! 🎁' check (char_length(btrim(thank_gift_text)) between 1 and 300),
  thank_bits boolean not null default true,
  thank_bits_min int not null default 100 check (thank_bits_min between 1 and 1000000),
  thank_bits_text text not null default 'Danke für {amount} Bits, {user}! 💎' check (char_length(btrim(thank_bits_text)) between 1 and 300),
  thank_raid boolean not null default true,
  thank_raid_text text not null default 'RAID! Willkommen {user} und alle {amount} Leute! 🚀' check (char_length(btrim(thank_raid_text)) between 1 and 300),
  raid_shoutout boolean not null default true,
  -- Moderation
  mod_on boolean not null default false,
  mod_links boolean not null default true,
  mod_link_allow text[] not null default array['twitch.tv', 'clips.twitch.tv', 'youtube.com', 'youtu.be']
    check (cardinality(mod_link_allow) <= 30),
  mod_caps boolean not null default true,
  mod_caps_pct int not null default 70 check (mod_caps_pct between 30 and 100),
  mod_caps_min int not null default 15 check (mod_caps_min between 5 and 200),
  mod_spam boolean not null default true,
  mod_repeat int not null default 12 check (mod_repeat between 4 and 100),     -- gleiches Zeichen so oft hintereinander
  mod_emotes int not null default 15 check (mod_emotes between 3 and 100),     -- so viele Emotes in einer Nachricht
  mod_words text[] not null default '{}' check (cardinality(mod_words) <= 200),
  mod_action text not null default 'delete' check (mod_action in ('delete', 'timeout')),
  mod_timeout int not null default 60 check (mod_timeout between 1 and 1209600),
  mod_warn boolean not null default true,
  mod_exempt_vip boolean not null default true,
  mod_exempt_sub boolean not null default false,
  mod_permit_seconds int not null default 60 check (mod_permit_seconds between 10 and 600),
  -- Song-Wünsche
  song_on boolean not null default false,
  song_who text not null default 'everyone' check (song_who in ('everyone', 'sub', 'vip', 'mod')),
  song_max_user int not null default 2 check (song_max_user between 1 and 20),
  song_max_queue int not null default 30 check (song_max_queue between 1 and 200),
  song_max_minutes int not null default 8 check (song_max_minutes between 1 and 60),
  song_cooldown int not null default 30 check (song_cooldown between 0 and 3600),
  -- Auto-Nachrichten: Pause zwischen zwei Nachrichten (für alle Timer zusammen)
  timer_gap int not null default 120 check (timer_gap between 30 and 3600),
  timer_last_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (channel_id, id)
);
alter table core.bot_settings enable row level security;
drop policy if exists "bot_settings: lesen für admins" on core.bot_settings;
create policy "bot_settings: lesen für admins" on core.bot_settings for select to authenticated using ((select public.is_admin()));
revoke all on core.bot_settings from anon, authenticated;
grant select on core.bot_settings to authenticated;
select public.channel_view('bot_settings');

-- ---------- Auto-Nachrichten ----------
create table if not exists core.bot_timers (
  id bigint generated always as identity primary key,
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 400),
  interval_min int not null default 15 check (interval_min between 5 and 240),
  min_lines int not null default 5 check (min_lines between 0 and 200),
  enabled boolean not null default true,
  lines int not null default 0,
  sent int not null default 0,
  last_at timestamptz,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists bot_timers_channel_idx on core.bot_timers (channel_id, position);
alter table core.bot_timers enable row level security;
drop policy if exists "bot_timers: lesen für admins" on core.bot_timers;
create policy "bot_timers: lesen für admins" on core.bot_timers for select to authenticated using ((select public.is_admin()));
drop policy if exists "bot_timers: anlegen für admins" on core.bot_timers;
create policy "bot_timers: anlegen für admins" on core.bot_timers for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "bot_timers: ändern für admins" on core.bot_timers;
create policy "bot_timers: ändern für admins" on core.bot_timers for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "bot_timers: löschen für admins" on core.bot_timers;
create policy "bot_timers: löschen für admins" on core.bot_timers for delete to authenticated using ((select public.is_admin()));
revoke all on core.bot_timers from anon, authenticated;
grant select, delete on core.bot_timers to authenticated;
grant insert (text, interval_min, min_lines, enabled, position) on core.bot_timers to authenticated;
grant update (text, interval_min, min_lines, enabled, position) on core.bot_timers to authenticated;
select public.channel_view('bot_timers');

-- Wer schon begrüßt wurde (nur solange die Begrüßung an ist)
create table if not exists core.bot_seen (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  twitch_id text not null check (twitch_id ~ '^[0-9]{1,20}$'),
  first_at timestamptz not null default now(),
  greeted_at timestamptz,
  primary key (channel_id, twitch_id)
);
alter table core.bot_seen enable row level security;
revoke all on core.bot_seen from anon, authenticated;

-- !permit: diese Person darf kurz einen Link posten
create table if not exists core.bot_permits (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  login text not null check (login ~ '^[a-z0-9_]{3,25}$'),
  until timestamptz not null,
  primary key (channel_id, login)
);
alter table core.bot_permits enable row level security;
revoke all on core.bot_permits from anon, authenticated;

-- ---------- Song-Wünsche (für alle lesbar: das Overlay zeigt sie) ----------
create table if not exists core.bot_songs (
  id bigint generated always as identity primary key,
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (char_length(title) between 1 and 200),
  seconds int not null default 0 check (seconds between 0 and 86400),
  who text not null default '' check (char_length(who) <= 40),
  twitch_id text not null default '' check (twitch_id = '' or twitch_id ~ '^[0-9]{1,20}$'),
  source text not null default 'chat' check (source in ('chat', 'web')),
  status text not null default 'queued' check (status in ('queued', 'playing', 'done', 'skipped')),
  position bigint not null default 0,
  created_at timestamptz not null default now(),
  played_at timestamptz
);
create index if not exists bot_songs_channel_idx on core.bot_songs (channel_id, status, position, id);
alter table core.bot_songs enable row level security;
drop policy if exists "bot_songs: lesen für alle" on core.bot_songs;
create policy "bot_songs: lesen für alle" on core.bot_songs for select to anon, authenticated using (true);
revoke all on core.bot_songs from anon, authenticated;
-- Die Twitch-ID des Wünschenden ist bei Twitch ohnehin öffentlich (für !wrongsong und die Grenze je Zuschauer)
grant select on core.bot_songs to anon, authenticated;
select public.channel_view('bot_songs');
select public.realtime_add('bot_songs');

-- ---------- Eigene Befehle: mehr Einstellungen ----------
create or replace function public.bot_aliases_ok(p text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(cardinality(p), 0) <= 5
     and not exists (select 1 from unnest(coalesce(p, '{}')) a where a !~ '^![a-z0-9äöüß_]{2,25}$');
$$;
alter table core.bot_commands add column if not exists aliases text[] not null default '{}';
alter table core.bot_commands add column if not exists permission text not null default 'everyone';
alter table core.bot_commands add column if not exists user_cooldown int not null default 0;
alter table core.bot_commands add column if not exists reply_type text not null default 'say';
alter table core.bot_commands add column if not exists live_only boolean not null default false;
alter table core.bot_commands drop constraint if exists bot_commands_aliases_check;
alter table core.bot_commands add constraint bot_commands_aliases_check check (public.bot_aliases_ok(aliases));
alter table core.bot_commands drop constraint if exists bot_commands_permission_check;
alter table core.bot_commands add constraint bot_commands_permission_check
  check (permission in ('everyone', 'sub', 'vip', 'mod', 'streamer'));
alter table core.bot_commands drop constraint if exists bot_commands_user_cooldown_check;
alter table core.bot_commands add constraint bot_commands_user_cooldown_check check (user_cooldown between 0 and 3600);
alter table core.bot_commands drop constraint if exists bot_commands_reply_type_check;
alter table core.bot_commands add constraint bot_commands_reply_type_check check (reply_type in ('say', 'reply', 'mention'));
-- Früher gab es nur „Nur Mods“
update core.bot_commands set permission = 'mod' where mod_only and permission = 'everyone';
grant insert (aliases, permission, user_cooldown, reply_type, live_only) on core.bot_commands to authenticated;
grant update (aliases, permission, user_cooldown, reply_type, live_only) on core.bot_commands to authenticated;
select public.channel_view('bot_commands');

-- ---------- Hilfen ----------
-- Darf diese Person (Abzeichen aus dem Chat)?
create or replace function public.bot_allowed(p_who text, p_badges text[])
returns boolean language sql immutable set search_path = '' as $$
  select case coalesce(p_who, 'everyone')
    when 'everyone' then true
    when 'sub' then coalesce(p_badges && array['subscriber', 'founder', 'vip', 'moderator', 'broadcaster'], false)
    when 'vip' then coalesce(p_badges && array['vip', 'moderator', 'broadcaster'], false)
    when 'mod' then coalesce(p_badges && array['moderator', 'broadcaster'], false)
    when 'streamer' then coalesce(p_badges && array['broadcaster'], false)
    else false end;
$$;

-- Einstellungen des Kanals (legt die Zeile beim ersten Mal an)
create or replace function public.bot_cfg()
returns core.bot_settings language plpgsql security definer set search_path = '' as $$
declare
  s core.bot_settings;
  v_ch uuid := public.current_channel();
begin
  select * into s from core.bot_settings where channel_id = v_ch and id = 1;
  if not found then
    insert into core.bot_settings (channel_id, id) values (v_ch, 1) on conflict (channel_id, id) do nothing;
    select * into s from core.bot_settings where channel_id = v_ch and id = 1;
  end if;
  return s;
end;
$$;
revoke execute on function public.bot_cfg() from public, anon, authenticated;

-- Abklingzeit: true = darf jetzt (und merkt sich den Zeitpunkt)
create or replace function public.bot_slot(p_slot text, p_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_seconds, 0) <= 0 then return true; end if;
  if exists (select 1 from public.chat_cooldowns where slot = p_slot and at > now() - make_interval(secs => p_seconds)) then
    return false;
  end if;
  insert into public.chat_cooldowns (slot, at) values (left(p_slot, 80), now())
    on conflict (channel_id, slot) do update set at = now();
  return true;
end;
$$;
revoke execute on function public.bot_slot(text, int) from public, anon, authenticated;

-- Platzhalter einsetzen. Namen nur aus Twitch-Daten (p_name kommt von Twitch, nicht aus dem Text).
create or replace function public.bot_fill(p_text text, p_name text, p_extra jsonb default '{}'::jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  t text := coalesce(p_text, '');
  k text;
  v text;
begin
  t := replace(t, '{user}', coalesce(public.safe_name(p_name, nullif(p_name, '')), 'jemand'));
  t := replace(t, '{streamer}', coalesce((select nullif(display_name, '') from public.twitch_connection where id = 1), 'der Streamer'));
  for k, v in select * from jsonb_each_text(coalesce(p_extra, '{}'::jsonb)) loop
    t := replace(t, '{' || k || '}', coalesce(v, ''));
  end loop;
  return left(t, 480);
end;
$$;
revoke execute on function public.bot_fill(text, text, jsonb) from public, anon, authenticated;

-- ---------- Jede Chat-Nachricht (Edge Function, vor allem anderen) ----------
-- p_plain: Text ohne Emotes, p_emotes: Zahl der Emotes, p_hosts: Seiten aus Links (erkennt die Edge Function).
-- Antwort: {stop, mod:{action, seconds, reason, warn}, replies:[…], info, song, target}
create or replace function public.bot_chat(p_user_id text, p_login text, p_name text, p_badges text[], p_text text,
  p_plain text default null, p_emotes int default 0, p_hosts text[] default '{}')
returns json language plpgsql security definer set search_path = '' as $$
declare
  s core.bot_settings;
  v_ch uuid := public.current_channel();
  msg text := btrim(coalesce(p_text, ''));
  plain text := coalesce(p_plain, msg);
  cmd text := '';
  arg text := '';
  is_mod boolean := coalesce(p_badges && array['moderator', 'broadcaster'], false);
  is_streamer boolean := coalesce(p_badges && array['broadcaster'], false);
  paused boolean := public.viewer_paused();
  replies jsonb := '[]'::jsonb;
  reason text;
  letters int;
  uppers int;
  w text;
  bad text;
  seen core.bot_seen;
  known boolean;
  since timestamptz;
  t core.bot_timers;
  target text;
  song core.bot_songs;
  n int;
  pos int;
begin
  if coalesce(p_user_id, '') !~ '^[0-9]{1,20}$' or v_ch is null then return json_build_object('stop', false); end if;
  s := public.bot_cfg();
  if msg ~ '^!' then
    cmd := lower(split_part(msg, ' ', 1));
    arg := btrim(substr(msg, char_length(cmd) + 1));
  end if;

  -- 1) Moderation (Mods und Streamer nie; VIPs und Abos je nach Einstellung)
  if s.mod_on and not is_mod
     and not (s.mod_exempt_vip and coalesce(p_badges && array['vip'], false))
     and not (s.mod_exempt_sub and coalesce(p_badges && array['subscriber', 'founder'], false)) then
    if s.mod_links and cardinality(coalesce(p_hosts, '{}')) > 0
       and exists (select 1 from unnest(p_hosts) h
                   where not exists (select 1 from unnest(s.mod_link_allow) a
                                     where lower(h) = lower(a) or lower(h) like '%.' || lower(a))) then
      if exists (select 1 from core.bot_permits where channel_id = v_ch and login = lower(coalesce(p_login, '')) and until > now()) then
        delete from core.bot_permits where channel_id = v_ch and login = lower(coalesce(p_login, ''));
      else
        reason := 'link';
      end if;
    end if;
    if reason is null and cardinality(s.mod_words) > 0 then
      foreach w in array s.mod_words loop
        w := lower(btrim(w));
        continue when w = '';
        if lower(plain) ~ ('(^|[^[:alnum:]])' || regexp_replace(w, '([.\\+*?\[^\]$(){}=!<>|:#/-])', '\\\1', 'g') || '($|[^[:alnum:]])') then
          reason := 'word';
          exit;
        end if;
      end loop;
    end if;
    if reason is null and s.mod_caps then
      letters := char_length(regexp_replace(plain, '[^[:alpha:]]', '', 'g'));
      uppers := char_length(regexp_replace(plain, '[^A-ZÄÖÜ]', '', 'g'));
      if letters >= s.mod_caps_min and uppers * 100 >= letters * s.mod_caps_pct then reason := 'caps'; end if;
    end if;
    if reason is null and s.mod_spam then
      if coalesce(p_emotes, 0) > s.mod_emotes then reason := 'emotes';
      elsif plain ~ ('(.)\1{' || (s.mod_repeat - 1) || ',}') then reason := 'spam';
      end if;
    end if;
    if reason is not null then
      return json_build_object('stop', true, 'mod', json_build_object(
        'action', s.mod_action, 'seconds', s.mod_timeout, 'reason', reason,
        'warn', case when s.mod_warn and public.bot_slot('mw:' || p_user_id, 30) then
          public.bot_fill(case reason
            when 'link' then '{user}, bitte keine Links – frag einen Mod nach !permit.'
            when 'word' then '{user}, dieses Wort ist hier nicht erlaubt.'
            when 'caps' then '{user}, bitte nicht so viele GROSSBUCHSTABEN.'
            when 'emotes' then '{user}, bitte nicht so viele Emotes auf einmal.'
            else '{user}, bitte kein Spam.' end, p_name) end));
    end if;
  end if;

  -- !permit @name (Mods): der nächste Link dieser Person geht durch
  if cmd = '!permit' and is_mod then
    target := lower(ltrim(split_part(arg, ' ', 1), '@'));
    if target !~ '^[a-z0-9_]{3,25}$' then return json_build_object('stop', true); end if;
    insert into core.bot_permits (channel_id, login, until) values (v_ch, target, now() + make_interval(secs => s.mod_permit_seconds))
      on conflict (channel_id, login) do update set until = excluded.until;
    delete from core.bot_permits where channel_id = v_ch and until < now() - interval '1 hour';
    -- Bekannte Namen nennen, sonst allgemein (eingetippter Text wird nie wiederholt)
    select coalesce(nullif(display_name, ''), login) into w from public.watchtime where login = target limit 1;
    return json_build_object('stop', true, 'replies', json_build_array(json_build_object('text',
      case when w is not null then format('✅ %s darf in den nächsten %s s einen Link posten.', w, s.mod_permit_seconds)
           else format('✅ Erlaubt: Der nächste Link dieser Person geht in den nächsten %s s durch.', s.mod_permit_seconds) end)));
  end if;

  -- 2) Begrüßung (nicht im Raid-Schutz, nicht den Streamer)
  if s.greet_mode <> 'off' and not paused and not is_streamer then
    select * into seen from core.bot_seen where channel_id = v_ch and twitch_id = p_user_id;
    -- „Neu“: weder begrüßt noch je in der Watchtime-Liste (die Edge Function fragt vor dem Eintragen)
    known := seen.twitch_id is not null or exists (select 1 from public.watchtime where twitch_id = p_user_id);
    since := coalesce((select started_at from public.watch_state where id = 1 and live), now() - interval '8 hours');
    if (s.greet_mode = 'new' and not known)
       or (s.greet_mode = 'stream' and (seen.greeted_at is null or seen.greeted_at < since)) then
      if public.bot_slot('greet', 3) then
        replies := replies || jsonb_build_object('text', public.bot_fill(case when known then s.greet_back_text else s.greet_text end, p_name));
        insert into core.bot_seen (channel_id, twitch_id, greeted_at) values (v_ch, p_user_id, now())
          on conflict (channel_id, twitch_id) do update set greeted_at = now();
      end if;
    elsif seen.twitch_id is null then
      insert into core.bot_seen (channel_id, twitch_id) values (v_ch, p_user_id) on conflict do nothing;
    end if;
  end if;

  -- 3) Auto-Nachrichten: zählen, dann höchstens eine fällige verschicken
  update core.bot_timers set lines = lines + 1 where channel_id = v_ch and enabled;
  if not paused and (s.timer_last_at is null or s.timer_last_at < now() - make_interval(secs => s.timer_gap)) then
    select * into t from core.bot_timers
     where channel_id = v_ch and enabled and lines >= min_lines
       and (last_at is null or last_at < now() - make_interval(mins => interval_min))
     order by last_at nulls first, position, id limit 1 for update skip locked;
    if t.id is not null then
      update core.bot_timers set lines = 0, last_at = now(), sent = sent + 1 where id = t.id;
      update core.bot_settings set timer_last_at = now() where channel_id = v_ch and id = 1;
      replies := replies || jsonb_build_object('text', public.bot_fill(t.text, p_name, '{"user": ""}'::jsonb));
    end if;
  end if;

  if cmd = '' then return json_build_object('stop', false, 'replies', replies); end if;

  -- 4) Stream-Infos: die Edge Function holt die Daten bei Twitch
  if s.info_on and cmd in ('!uptime', '!followage', '!game', '!title', '!so', '!shoutout') then
    if paused and not is_mod then return json_build_object('stop', true, 'replies', replies); end if;
    if cmd in ('!so', '!shoutout') then
      if not is_mod then return json_build_object('stop', true, 'replies', replies); end if;
      target := lower(ltrim(split_part(arg, ' ', 1), '@'));
      if target !~ '^[a-z0-9_]{3,25}$' then return json_build_object('stop', true, 'replies', replies); end if;
      return json_build_object('stop', true, 'replies', replies, 'info', 'so', 'target', target, 'text', s.so_text);
    end if;
    if not public.bot_slot(case when cmd = '!followage' then 'info:fa:' || p_user_id else 'info:' || cmd end, s.info_cooldown) then
      return json_build_object('stop', true, 'replies', replies);
    end if;
    return json_build_object('stop', true, 'replies', replies, 'info', ltrim(cmd, '!'));
  end if;

  -- 5) Song-Wünsche
  if s.song_on and cmd in ('!sr', '!songrequest', '!song', '!currentsong', '!queue', '!songs', '!wrongsong', '!skip') then
    if paused and not is_mod then return json_build_object('stop', true, 'replies', replies); end if;
    if cmd in ('!sr', '!songrequest') then
      if not public.bot_allowed(s.song_who, p_badges) then
        return json_build_object('stop', true, 'replies', replies);
      end if;
      if not is_mod and not public.bot_slot('sr:' || p_user_id, s.song_cooldown) then
        return json_build_object('stop', true, 'replies', replies);
      end if;
      return json_build_object('stop', true, 'replies', replies, 'song', 'request');
    end if;
    if cmd in ('!song', '!currentsong') then
      if not public.bot_slot('songnow', 10) then return json_build_object('stop', true, 'replies', replies); end if;
      select * into song from core.bot_songs where channel_id = v_ch and status = 'playing' order by played_at desc nulls last limit 1;
      replies := replies || jsonb_build_object('text', case when song.id is null then '🎵 Gerade läuft kein Wunsch-Song.'
        else left(format('🎵 Gerade läuft: %s%s', song.title, case when song.who <> '' then ' – gewünscht von ' || song.who else '' end), 480) end);
      return json_build_object('stop', true, 'replies', replies);
    end if;
    if cmd in ('!queue', '!songs') then
      if not public.bot_slot('songq:' || p_user_id, 15) then return json_build_object('stop', true, 'replies', replies); end if;
      select count(*) into n from core.bot_songs where channel_id = v_ch and status = 'queued';
      select x.rn into pos from (
        select twitch_id, row_number() over (order by position, id) as rn from core.bot_songs where channel_id = v_ch and status = 'queued'
      ) x where x.twitch_id = p_user_id order by x.rn limit 1;
      replies := replies || jsonb_build_object('text', public.bot_fill(format('🎶 %s Songs warten%s.', n,
        case when pos is not null then format(' – dein nächster ist auf Platz %s, {user}', pos) else '' end), p_name));
      return json_build_object('stop', true, 'replies', replies);
    end if;
    if cmd = '!wrongsong' then
      select * into song from core.bot_songs where channel_id = v_ch and status = 'queued' and twitch_id = p_user_id
       order by id desc limit 1;
      if song.id is not null then
        update core.bot_songs set status = 'skipped' where id = song.id;
        replies := replies || jsonb_build_object('text', public.bot_fill('🗑️ {user}, dein letzter Wunsch ist raus.', p_name));
      end if;
      return json_build_object('stop', true, 'replies', replies);
    end if;
    if cmd = '!skip' then
      if is_mod then perform public.bot_song_step(v_ch, 'skipped'); end if;
      return json_build_object('stop', true, 'replies', replies);
    end if;
  end if;

  return json_build_object('stop', false, 'replies', replies);
end;
$$;

-- ---------- Songs: weiterschalten, hinzufügen, steuern ----------
-- Laufenden Song beenden (done/skipped) und den nächsten starten. Liefert den neuen laufenden Song.
create or replace function public.bot_song_step(p_ch uuid, p_end text default 'done')
returns core.bot_songs language plpgsql security definer set search_path = '' as $$
declare
  nxt core.bot_songs;
begin
  update core.bot_songs set status = case when p_end = 'skipped' then 'skipped' else 'done' end
   where channel_id = p_ch and status = 'playing';
  select * into nxt from core.bot_songs where channel_id = p_ch and status = 'queued' order by position, id limit 1 for update;
  if nxt.id is not null then
    update core.bot_songs set status = 'playing', played_at = now() where id = nxt.id returning * into nxt;
  end if;
  -- Alte Einträge aufräumen: gespielte nach 2 Tagen, alles nach 30 Tagen
  delete from core.bot_songs where channel_id = p_ch
    and ((status in ('done', 'skipped') and coalesce(played_at, created_at) < now() - interval '2 days') or created_at < now() - interval '30 days');
  return nxt;
end;
$$;
revoke execute on function public.bot_song_step(uuid, text) from public, anon, authenticated;

-- Wunsch eintragen (Edge Function nach dem Nachschlagen bei YouTube). p_source 'web': Streamer/Mods im Dashboard –
-- ohne Grenzen je Zuschauer. Liefert {ok, reason?, reply?, position?}
create or replace function public.bot_song_add(p_user_id text, p_name text, p_video text, p_title text, p_seconds int,
  p_source text default 'chat')
returns json language plpgsql security definer set search_path = '' as $$
declare
  s core.bot_settings := public.bot_cfg();
  v_ch uuid := public.current_channel();
  web boolean := p_source = 'web';
  n int;
  song core.bot_songs;
  pos int;
  who text := left(coalesce(nullif(btrim(p_name), ''), ''), 40);
  mention text := coalesce(public.safe_name(p_name), '');
begin
  if v_ch is null or coalesce(p_video, '') !~ '^[A-Za-z0-9_-]{11}$' then
    return json_build_object('ok', false, 'reason', 'video');
  end if;
  if not web and not s.song_on then return json_build_object('ok', false, 'reason', 'off'); end if;
  if not web and coalesce(p_seconds, 0) > s.song_max_minutes * 60 then
    return json_build_object('ok', false, 'reason', 'long',
      'reply', ltrim(format('%s Der Song ist zu lang (höchstens %s Min).', mention, s.song_max_minutes)));
  end if;
  select count(*) into n from core.bot_songs where channel_id = v_ch and status = 'queued';
  if n >= s.song_max_queue then
    return json_build_object('ok', false, 'reason', 'full', 'reply', ltrim(format('%s Die Warteschlange ist gerade voll.', mention)));
  end if;
  if exists (select 1 from core.bot_songs where channel_id = v_ch and video_id = p_video and status in ('queued', 'playing')) then
    return json_build_object('ok', false, 'reason', 'dupe', 'reply', ltrim(format('%s Der Song ist schon in der Warteschlange.', mention)));
  end if;
  if not web then
    select count(*) into n from core.bot_songs where channel_id = v_ch and status = 'queued' and twitch_id = coalesce(p_user_id, '');
    if n >= s.song_max_user then
      return json_build_object('ok', false, 'reason', 'user', 'reply',
        ltrim(format('%s Du hast schon %s Wünsche in der Warteschlange.', mention, n)));
    end if;
  end if;
  insert into core.bot_songs (channel_id, video_id, title, seconds, who, twitch_id, source, position)
  values (v_ch, p_video, left(coalesce(nullif(btrim(p_title), ''), 'YouTube-Video'), 200), greatest(0, least(coalesce(p_seconds, 0), 86400)),
          who, case when coalesce(p_user_id, '') ~ '^[0-9]{1,20}$' then p_user_id else '' end,
          case when web then 'web' else 'chat' end,
          coalesce((select max(position) from core.bot_songs where channel_id = v_ch), 0) + 1)
  returning * into song;
  select count(*) into pos from core.bot_songs where channel_id = v_ch and status = 'queued' and (position, id) <= (song.position, song.id);
  return json_build_object('ok', true, 'position', pos, 'id', song.id,
    'reply', left(ltrim(format('%s 🎵 „%s“ ist auf Platz %s.', mention, song.title, pos)), 480));
end;
$$;
revoke execute on function public.bot_song_add(text, text, text, text, int, text) from public, anon, authenticated;

-- Dashboard: Player und Warteschlange. p_action: next (Song zu Ende), skip, play (p_id sofort), remove (p_id),
-- up/down (p_id verschieben), clear (alle wartenden raus), stop (laufenden beenden, nichts Neues)
create or replace function public.bot_song_control(p_action text, p_id bigint default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  song core.bot_songs;
  other core.bot_songs;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Nur für Streamer und freigegebene Mods.' using errcode = '42501';
  end if;
  if p_action in ('next', 'skip') then
    song := public.bot_song_step(v_ch, case when p_action = 'skip' then 'skipped' else 'done' end);
  elsif p_action = 'stop' then
    update core.bot_songs set status = 'done' where channel_id = v_ch and status = 'playing';
  elsif p_action = 'play' then
    select * into song from core.bot_songs where channel_id = v_ch and id = p_id and status in ('queued', 'done', 'skipped');
    if song.id is null then raise exception 'Song nicht gefunden.'; end if;
    update core.bot_songs set status = 'done' where channel_id = v_ch and status = 'playing';
    update core.bot_songs set status = 'playing', played_at = now() where id = song.id returning * into song;
  elsif p_action = 'remove' then
    update core.bot_songs set status = 'skipped' where channel_id = v_ch and id = p_id and status = 'queued';
  elsif p_action in ('up', 'down') then
    select * into song from core.bot_songs where channel_id = v_ch and id = p_id and status = 'queued';
    if song.id is not null then
      if p_action = 'up' then
        select * into other from core.bot_songs where channel_id = v_ch and status = 'queued' and (position, id) < (song.position, song.id)
         order by position desc, id desc limit 1;
      else
        select * into other from core.bot_songs where channel_id = v_ch and status = 'queued' and (position, id) > (song.position, song.id)
         order by position, id limit 1;
      end if;
      if other.id is not null then
        update core.bot_songs set position = other.position where id = song.id;
        update core.bot_songs set position = song.position where id = other.id;
        if other.position = song.position then
          update core.bot_songs set position = position + case when p_action = 'up' then -1 else 1 end where id = song.id;
        end if;
      end if;
    end if;
  elsif p_action = 'clear' then
    update core.bot_songs set status = 'skipped' where channel_id = v_ch and status = 'queued';
  else
    raise exception 'Unbekannte Aktion.';
  end if;
  return json_build_object('ok', true, 'playing', (select row_to_json(x) from (
    select id, video_id, title, seconds, who from core.bot_songs where channel_id = v_ch and status = 'playing'
     order by played_at desc nulls last limit 1) x));
end;
$$;
revoke execute on function public.bot_song_control(text, bigint) from public, anon;
grant execute on function public.bot_song_control(text, bigint) to authenticated;

-- ---------- Danke für Ereignisse (Edge Function) ----------
-- p_kind: follow, sub, resub, gift, bits, raid. Liefert {text, shoutout} oder null.
create or replace function public.bot_event(p_kind text, p_name text, p_amount int default 0, p_months int default 0)
returns json language plpgsql security definer set search_path = '' as $$
declare
  s core.bot_settings := public.bot_cfg();
  tpl text;
  extra jsonb := jsonb_build_object('amount', coalesce(p_amount, 0)::text, 'months', coalesce(p_months, 0)::text);
begin
  if public.viewer_paused() and p_kind in ('follow', 'raid') then return null; end if;
  tpl := case p_kind
    when 'follow' then case when s.thank_follow and public.bot_slot('thx:follow', 5) then s.thank_follow_text end
    when 'sub' then case when s.thank_sub then s.thank_sub_text end
    when 'resub' then case when s.thank_sub then s.thank_resub_text end
    when 'gift' then case when s.thank_sub then s.thank_gift_text end
    when 'bits' then case when s.thank_bits and coalesce(p_amount, 0) >= s.thank_bits_min then s.thank_bits_text end
    when 'raid' then case when s.thank_raid then s.thank_raid_text end
  end;
  if tpl is null and not (p_kind = 'raid' and s.raid_shoutout) then return null; end if;
  return json_build_object('text', case when tpl is not null then public.bot_fill(tpl, p_name, extra) end,
                           'shoutout', p_kind = 'raid' and s.raid_shoutout);
end;
$$;
revoke execute on function public.bot_event(text, text, int, int) from public, anon, authenticated;
revoke execute on function public.bot_chat(text, text, text, text[], text, text, int, text[]) from public, anon, authenticated;

-- ---------- Dashboard: Einstellungen lesen und speichern ----------
-- Dazu, welche Twitch-Rechte für Moderation, Shoutout und !followage fehlen (dann Twitch neu verbinden).
create or replace function public.bot_settings_get()
returns json language plpgsql security definer set search_path = '' as $$
declare
  sc text[];
begin
  if public.current_channel() is null or not public.is_admin() then
    raise exception 'Nur für Streamer und freigegebene Mods.' using errcode = '42501';
  end if;
  select scopes into sc from public.twitch_connection where id = 1;
  return json_build_object(
    'settings', (select to_jsonb(s) - 'channel_id' - 'id' - 'timer_last_at' from public.bot_cfg() s),
    'connected', sc is not null,
    'missing', json_build_object(
      'moderation', sc is null or not (sc @> array['moderator:manage:chat_messages', 'moderator:manage:banned_users']),
      'shoutout', sc is null or not (sc @> array['moderator:manage:shoutouts']),
      'followage', sc is null or not (sc @> array['moderator:read:followers'])));
end;
$$;
revoke execute on function public.bot_settings_get() from public, anon;
grant execute on function public.bot_settings_get() to authenticated;

create or replace function public.bot_settings_save(p jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  s core.bot_settings;
  v_ch uuid := public.current_channel();
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Nur für Streamer und freigegebene Mods.' using errcode = '42501';
  end if;
  s := public.bot_cfg();
  s := jsonb_populate_record(s, coalesce(p, '{}'::jsonb) - 'channel_id' - 'id' - 'timer_last_at' - 'updated_at');
  -- Listen säubern: erlaubte Seiten und gesperrte Wörter klein, ohne Leere und Doppelte
  s.mod_link_allow := coalesce((select array_agg(distinct x) from (
      select lower(regexp_replace(btrim(a), '^(https?://)?(www\.)?|/.*$', '', 'g')) as x from unnest(s.mod_link_allow) a) y
    where x ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'), '{}');
  s.mod_words := coalesce((select array_agg(distinct x) from (
      select lower(left(btrim(a), 40)) as x from unnest(s.mod_words) a) y where x <> ''), '{}');
  update core.bot_settings set
    info_on = s.info_on, info_cooldown = s.info_cooldown, so_text = s.so_text,
    greet_mode = s.greet_mode, greet_text = s.greet_text, greet_back_text = s.greet_back_text,
    thank_follow = s.thank_follow, thank_follow_text = s.thank_follow_text, thank_sub = s.thank_sub, thank_sub_text = s.thank_sub_text,
    thank_resub_text = s.thank_resub_text, thank_gift_text = s.thank_gift_text, thank_bits = s.thank_bits,
    thank_bits_min = s.thank_bits_min, thank_bits_text = s.thank_bits_text, thank_raid = s.thank_raid,
    thank_raid_text = s.thank_raid_text, raid_shoutout = s.raid_shoutout,
    mod_on = s.mod_on, mod_links = s.mod_links, mod_link_allow = s.mod_link_allow, mod_caps = s.mod_caps,
    mod_caps_pct = s.mod_caps_pct, mod_caps_min = s.mod_caps_min, mod_spam = s.mod_spam, mod_repeat = s.mod_repeat,
    mod_emotes = s.mod_emotes, mod_words = s.mod_words, mod_action = s.mod_action, mod_timeout = s.mod_timeout,
    mod_warn = s.mod_warn, mod_exempt_vip = s.mod_exempt_vip, mod_exempt_sub = s.mod_exempt_sub,
    mod_permit_seconds = s.mod_permit_seconds,
    song_on = s.song_on, song_who = s.song_who, song_max_user = s.song_max_user, song_max_queue = s.song_max_queue,
    song_max_minutes = s.song_max_minutes, song_cooldown = s.song_cooldown, timer_gap = s.timer_gap,
    updated_at = now()
  where channel_id = v_ch and id = 1;
  return public.bot_settings_get();
end;
$$;
revoke execute on function public.bot_settings_save(jsonb) from public, anon;
grant execute on function public.bot_settings_save(jsonb) to authenticated;

-- ---------- chat_command: eigene Befehle mit Aliasen, Rechten, Pausen und Platzhaltern ----------
-- Unverändert aus …_watchtime_import.sql bis auf !befehle und den Teil „Eigene Befehle“.
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
  s core.bot_settings;
  streamer text;
  reply text;
  mine bigint;
  touser text;
  lo int;
  hi int;
  m text[];
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
    s := public.bot_cfg();
    select string_agg(command, ' ' order by command) into reply
      from public.bot_commands where enabled and public.bot_allowed(permission, p_badges);
    return json_build_object('reply', left('Befehle: !watchtime '
      || case when s.info_on then '!uptime !followage !game !title ' else '' end
      || case when s.song_on and public.bot_allowed(s.song_who, p_badges) then '!sr !song !queue !wrongsong ' else '' end
      || coalesce(reply, ''), 480));
  end if;

  -- Eigene Befehle (Befehl oder Alias)
  select * into c from public.bot_commands where enabled and (command = cmd or cmd = any(aliases))
   order by (command = cmd) desc, id limit 1;
  if c.id is null then return null; end if;
  if not public.bot_allowed(c.permission, p_badges) then return null; end if;
  if c.live_only and not coalesce((select live from public.watch_state where id = 1), false) then return null; end if;
  if c.last_used_at is not null and c.last_used_at > now() - make_interval(secs => c.cooldown_seconds) then
    return null;
  end if;
  if c.user_cooldown > 0 and not is_mod and not public.bot_slot('cu:' || c.id || ':' || p_user_id, c.user_cooldown) then
    return null;
  end if;
  update public.bot_commands set uses = uses + 1, last_used_at = now() where id = c.id;
  streamer := coalesce((select nullif(display_name, '') from public.twitch_connection where id = 1), 'der Streamer');
  mine := public.watch_total(p_user_id, lower(p_name));
  -- {touser}: nur bekannte Namen aus der Watchtime-Liste, sonst der Schreiber selbst
  if arg ~ '^@?[a-zA-Z0-9_]{3,25}' then
    select coalesce(nullif(display_name, ''), login) into touser from public.watchtime
     where login = lower(ltrim(split_part(arg, ' ', 1), '@')) limit 1;
  end if;
  reply := c.response;
  reply := replace(reply, '{user}', '@' || who);
  reply := replace(reply, '{touser}', '@' || coalesce(touser, who));
  reply := replace(reply, '{count}', (c.uses + 1)::text);
  reply := replace(reply, '{streamer}', streamer);
  reply := replace(reply, '{watchtime}', public.watch_fmt(coalesce(mine, 0)));
  reply := replace(reply, '{random}', (1 + floor(random() * 100))::int::text);
  -- {random:1-6}
  loop
    m := regexp_match(reply, '\{random:(\d{1,6})-(\d{1,6})\}');
    exit when m is null;
    lo := least(m[1]::int, m[2]::int);
    hi := greatest(m[1]::int, m[2]::int);
    reply := regexp_replace(reply, '\{random:\d{1,6}-\d{1,6}\}', (lo + floor(random() * (hi - lo + 1)))::int::text);
  end loop;
  -- {uptime} {game} {title} {followage} setzt die Edge Function ein (Twitch-Daten)
  return json_build_object('reply', left(reply, 480), 'reply_type', c.reply_type);
end;
$function$;

-- Audit-Protokoll: Änderungen an Einstellungen und Auto-Nachrichten festhalten (Begrüßte, !permit und
-- Songs nicht – die stehen in der Ausnahmeliste von 20261031000000_security.sql)
do $$
begin
  if to_regprocedure('core.audit_row()') is not null then
    drop trigger if exists zz_audit on core.bot_settings;
    create trigger zz_audit after insert or update or delete on core.bot_settings for each row execute function core.audit_row();
    drop trigger if exists zz_audit on core.bot_timers;
    create trigger zz_audit after insert or update or delete on core.bot_timers for each row execute function core.audit_row();
  end if;
end;
$$;

notify pgrst, 'reload schema';
