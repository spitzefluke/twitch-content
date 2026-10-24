-- ============================================================
-- StreamHelp: Chat-Bot – Clips, Werbepausen, Hype-Train & Ziele, Stichwort-Antworten, Statistik
--   1) !clip: Zuschauer machen einen Twitch-Clip, der Bot postet den Link (Edge Function, Recht clips:edit).
--      Einstellbar: an/aus, wer darf, Pause für alle und je Person. Die letzten Clips stehen im Dashboard.
--   2) Werbepausen (Recht channel:read:ads): Vorwarnung kurz vor der geplanten Werbung, Ansage beim
--      Start (EventSub channel.ad_break.begin) und „Werbung vorbei“ nach Ablauf (bot_outbox.send_after).
--   3) Hype-Train (channel:read:hype_train, EventSub v2) und Ziele (channel:read:goals): Start, jede neue
--      Stufe, Ende und erreichte Follower-/Abo-/Bits-Ziele im Chat – jede Meldung genau einmal.
--   4) Stichwort-Antworten (core.bot_faq): Schreibt jemand z. B. „wann streamst du“, antwortet der Bot mit
--      dem hinterlegten Text. Ganze Wörter/Wortfolgen, „eins davon“ oder „alle“, Pause je Antwort und für alle.
--   5) Statistik im Chat: !stats (laufender bzw. letzter Stream), !topchatter (Nachrichten), !topwatch
--      (Watchtime). Dafür zählt core.chat_counts Nachrichten je Zuschauer (gesamt und im laufenden Stream).
--   bot_chat2 ruft bot_chat auf und erledigt danach 1), 4), 5) – die Edge Function nimmt bot_chat2, wenn es
--   die Funktion gibt, sonst wie bisher bot_chat.
-- Braucht 20261109000000_chat_bot_plus.sql, 20261116000000_bot_stats.sql, 20261117000000_live_welcome.sql.
-- Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.bot_settings') is null or to_regclass('core.stream_sessions') is null then
    raise exception 'Erst die Migrationen 20261109000000_chat_bot_plus.sql und 20261116000000_bot_stats.sql ausführen.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'core' and table_name = 'bot_settings' and column_name = 'live_on') then
    raise exception 'Erst die Migration 20261117000000_live_welcome.sql ausführen.';
  end if;
end;
$$;

-- ---------- Einstellungen ----------
alter table core.bot_settings add column if not exists clip_on boolean not null default true;
alter table core.bot_settings add column if not exists clip_who text not null default 'everyone';
alter table core.bot_settings add column if not exists clip_cooldown int not null default 30;
alter table core.bot_settings add column if not exists clip_user_cooldown int not null default 120;
alter table core.bot_settings add column if not exists ads_on boolean not null default true;
alter table core.bot_settings add column if not exists ads_warn_text text not null
  default '⏰ In {in} kommt Werbung ({duration}) – kurz Getränk holen! Mit Abo seht ihr keine Werbung 💜';
alter table core.bot_settings add column if not exists ads_start_text text not null
  default '📺 Werbepause ({duration}) – wir sind gleich zurück!';
alter table core.bot_settings add column if not exists ads_end_text text not null
  default '✅ Die Werbung ist vorbei – weiter geht''s!';
alter table core.bot_settings add column if not exists hype_on boolean not null default true;
alter table core.bot_settings add column if not exists hype_start_text text not null
  default '🚂 HYPE-TRAIN! Alle einsteigen – jedes Abo und jedes Bit bringt uns weiter!';
alter table core.bot_settings add column if not exists hype_level_text text not null
  default '🚂 Hype-Train Stufe {level} erreicht! Weiter so! 🔥';
alter table core.bot_settings add column if not exists hype_end_text text not null
  default '🚂 Der Hype-Train ist angekommen: Stufe {level}! Danke an alle, die mitgefahren sind 💜';
alter table core.bot_settings add column if not exists goal_on boolean not null default true;
alter table core.bot_settings add column if not exists goal_text text not null
  default '🎯 Ziel erreicht: {goal} ({current}/{target}) – danke euch allen! 🎉';
alter table core.bot_settings add column if not exists faq_on boolean not null default true;
alter table core.bot_settings add column if not exists faq_gap int not null default 15;
alter table core.bot_settings add column if not exists stats_on boolean not null default true;
alter table core.bot_settings add column if not exists stats_cooldown int not null default 30;

alter table core.bot_settings drop constraint if exists bot_settings_more_check;
alter table core.bot_settings add constraint bot_settings_more_check check (
  clip_who in ('everyone', 'sub', 'vip', 'mod')
  and clip_cooldown between 0 and 3600 and clip_user_cooldown between 0 and 3600
  and faq_gap between 0 and 600 and stats_cooldown between 0 and 600
  and char_length(btrim(ads_warn_text)) between 1 and 300 and char_length(btrim(ads_start_text)) between 1 and 300
  and char_length(btrim(ads_end_text)) between 1 and 300
  and char_length(btrim(hype_start_text)) between 1 and 300 and char_length(btrim(hype_level_text)) between 1 and 300
  and char_length(btrim(hype_end_text)) between 1 and 300 and char_length(btrim(goal_text)) between 1 and 300);
select public.channel_view('bot_settings');

-- Unverändert aus …_live_welcome.sql, dazu die neuen Spalten
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
    live_on = s.live_on, live_text = s.live_text,
    clip_on = s.clip_on, clip_who = s.clip_who, clip_cooldown = s.clip_cooldown, clip_user_cooldown = s.clip_user_cooldown,
    ads_on = s.ads_on, ads_warn_text = s.ads_warn_text, ads_start_text = s.ads_start_text, ads_end_text = s.ads_end_text,
    hype_on = s.hype_on, hype_start_text = s.hype_start_text, hype_level_text = s.hype_level_text, hype_end_text = s.hype_end_text,
    goal_on = s.goal_on, goal_text = s.goal_text, faq_on = s.faq_on, faq_gap = s.faq_gap,
    stats_on = s.stats_on, stats_cooldown = s.stats_cooldown,
    updated_at = now()
  where channel_id = v_ch and id = 1;
  return public.bot_settings_get();
end;
$$;
revoke execute on function public.bot_settings_save(jsonb) from public, anon;
grant execute on function public.bot_settings_save(jsonb) to authenticated;

-- Wie in …_chat_bot_plus.sql, dazu die Rechte für Clips, Werbung, Hype-Train und Ziele
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
      'followage', sc is null or not (sc @> array['moderator:read:followers']),
      'clip', sc is null or not (sc @> array['clips:edit']),
      'ads', sc is null or not (sc @> array['channel:read:ads']),
      'hype', sc is null or not (sc @> array['channel:read:hype_train']),
      'goals', sc is null or not (sc @> array['channel:read:goals'])));
end;
$$;
revoke execute on function public.bot_settings_get() from public, anon;
grant execute on function public.bot_settings_get() to authenticated;

-- ---------- Hilfen ----------
-- „2 Std 5 Min“ / „45 Min“ / „90 s“
create or replace function core.fmt_span(p_seconds bigint)
returns text language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_seconds, 0) < 120 then greatest(coalesce(p_seconds, 0), 0) || ' s'
    when p_seconds < 3600 then (p_seconds / 60) || ' Min'
    else (p_seconds / 3600) || ' Std' || case when (p_seconds % 3600) / 60 > 0 then ' ' || ((p_seconds % 3600) / 60) || ' Min' else '' end
  end;
$$;

-- Einmal-Marke (true = zum ersten Mal): gegen doppelte Zustellung und doppelte Ansagen
create or replace function core.bot_once(p_slot text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  insert into public.chat_cooldowns (slot, at) values (left(p_slot, 80), now())
    on conflict (channel_id, slot) do nothing
    returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;
revoke execute on function core.bot_once(text) from public, anon, authenticated;

-- ---------- Nachrichten zählen (für !topchatter und !stats) ----------
create table if not exists core.chat_counts (
  channel_id uuid not null references public.channels on delete cascade,
  twitch_id text not null check (twitch_id ~ '^[0-9]{1,20}$'),
  name text not null default '' check (char_length(name) <= 60),
  total bigint not null default 0,
  stream int not null default 0,          -- Nachrichten im Stream, der stream_start begonnen hat
  stream_start timestamptz,
  last_at timestamptz not null default now(),
  primary key (channel_id, twitch_id)
);
create index if not exists chat_counts_stream_idx on core.chat_counts (channel_id, stream_start, stream desc);
create index if not exists chat_counts_total_idx on core.chat_counts (channel_id, total desc);
alter table core.chat_counts enable row level security;
revoke all on core.chat_counts from anon, authenticated;

create or replace function core.chat_count(p_ch uuid, p_user_id text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := (select started_at from core.watch_state where channel_id = p_ch and id = 1 and live);
begin
  insert into core.chat_counts as c (channel_id, twitch_id, name, total, stream, stream_start, last_at)
  values (p_ch, p_user_id, left(coalesce(p_name, ''), 60), 1, case when v_start is not null then 1 else 0 end, v_start, now())
  on conflict (channel_id, twitch_id) do update set
    name = case when excluded.name <> '' then excluded.name else c.name end,
    total = c.total + 1,
    stream = case when v_start is null then c.stream
                  when c.stream_start is not distinct from v_start then c.stream + 1 else 1 end,
    stream_start = coalesce(v_start, c.stream_start),
    last_at = now();
  if random() < 0.001 then delete from core.chat_counts where channel_id = p_ch and last_at < now() - interval '365 days'; end if;
end;
$$;
revoke execute on function core.chat_count(uuid, text, text) from public, anon, authenticated;

-- ---------- Stichwort-Antworten ----------
create table if not exists core.bot_faq (
  id bigint generated always as identity primary key,
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  keywords text[] not null check (cardinality(keywords) between 1 and 10),
  answer text not null check (char_length(btrim(answer)) between 1 and 400),
  match_all boolean not null default false,      -- false: eins der Stichwörter reicht, true: alle müssen vorkommen
  cooldown int not null default 120 check (cooldown between 0 and 3600),
  enabled boolean not null default true,
  hits int not null default 0,
  last_at timestamptz,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists bot_faq_channel_idx on core.bot_faq (channel_id, position);

-- Stichwörter vereinheitlichen: klein, nur Buchstaben/Ziffern mit einem Leerzeichen dazwischen, ohne Doppelte
create or replace function core.faq_norm(p text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(lower(coalesce(p, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;
create or replace function core.bot_faq_clean()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.keywords := coalesce((select array_agg(k order by k) from (
      select distinct left(core.faq_norm(x), 60) as k from unnest(new.keywords) x) y where char_length(k) >= 2), '{}');
  if cardinality(new.keywords) = 0 then raise exception 'Bitte mindestens ein Stichwort (2+ Zeichen).' using errcode = '23514'; end if;
  new.answer := btrim(new.answer);
  return new;
end;
$$;
drop trigger if exists bot_faq_clean on core.bot_faq;
create trigger bot_faq_clean before insert or update of keywords, answer on core.bot_faq for each row execute function core.bot_faq_clean();

alter table core.bot_faq enable row level security;
drop policy if exists "bot_faq: lesen für admins" on core.bot_faq;
create policy "bot_faq: lesen für admins" on core.bot_faq for select to authenticated
  using (channel_id = (select public.current_channel()) and (select public.is_admin()));
drop policy if exists "bot_faq: anlegen für admins" on core.bot_faq;
create policy "bot_faq: anlegen für admins" on core.bot_faq for insert to authenticated
  with check (channel_id = (select public.current_channel()) and (select public.is_admin()));
drop policy if exists "bot_faq: ändern für admins" on core.bot_faq;
create policy "bot_faq: ändern für admins" on core.bot_faq for update to authenticated
  using (channel_id = (select public.current_channel()) and (select public.is_admin()))
  with check (channel_id = (select public.current_channel()) and (select public.is_admin()));
drop policy if exists "bot_faq: löschen für admins" on core.bot_faq;
create policy "bot_faq: löschen für admins" on core.bot_faq for delete to authenticated
  using (channel_id = (select public.current_channel()) and (select public.is_admin()));
revoke all on core.bot_faq from anon, authenticated;
grant select, delete on core.bot_faq to authenticated;
grant insert (keywords, answer, match_all, cooldown, enabled, position) on core.bot_faq to authenticated;
grant update (keywords, answer, match_all, cooldown, enabled, position) on core.bot_faq to authenticated;
select public.channel_view('bot_faq');

-- Passt eine Stichwort-Antwort zu dieser Nachricht? Liefert den Text (oder null) und merkt sich die Zeit.
create or replace function core.bot_faq_hit(p_ch uuid, p_text text, p_name text, p_gap int)
returns text language plpgsql security definer set search_path = '' as $$
declare
  hay text := ' ' || core.faq_norm(p_text) || ' ';
  f core.bot_faq;
begin
  if char_length(hay) < 4 then return null; end if;
  select * into f from core.bot_faq b
   where b.channel_id = p_ch and b.enabled
     and (b.last_at is null or b.last_at < now() - make_interval(secs => b.cooldown))
     and case when b.match_all
              then not exists (select 1 from unnest(b.keywords) k where position(' ' || k || ' ' in hay) = 0)
              else exists (select 1 from unnest(b.keywords) k where position(' ' || k || ' ' in hay) > 0) end
   order by b.position, b.id limit 1 for update skip locked;
  if f.id is null then return null; end if;
  -- Pause für alle Stichwort-Antworten zusammen (damit der Bot nicht bei jeder Nachricht antwortet)
  if not public.bot_slot('faq', p_gap) then return null; end if;
  update core.bot_faq set last_at = now(), hits = hits + 1 where id = f.id;
  return public.bot_fill(f.answer, p_name);
end;
$$;
revoke execute on function core.bot_faq_hit(uuid, text, text, int) from public, anon, authenticated;

-- ---------- Clips (für die Liste im Dashboard) ----------
create table if not exists core.bot_clips (
  id bigint generated always as identity primary key,
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  clip_id text not null check (char_length(clip_id) between 1 and 200),
  who text not null default '' check (char_length(who) <= 60),
  created_at timestamptz not null default now()
);
create index if not exists bot_clips_channel_idx on core.bot_clips (channel_id, created_at desc);
alter table core.bot_clips enable row level security;
drop policy if exists "bot_clips: lesen für admins" on core.bot_clips;
create policy "bot_clips: lesen für admins" on core.bot_clips for select to authenticated
  using (channel_id = (select public.current_channel()) and (select public.is_admin()));
revoke all on core.bot_clips from anon, authenticated;
grant select on core.bot_clips to authenticated;
select public.channel_view('bot_clips');

-- ---------- Statistik-Texte ----------
create or replace function core.bot_stats_text(p_ch uuid, p_cmd text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  ws core.watch_state;
  sess core.stream_sessions;
  c json;
  msgs bigint;
  me text := (select broadcaster_id from core.twitch_connection where channel_id = p_ch and id = 1);
  top text;
begin
  select * into ws from core.watch_state where channel_id = p_ch and id = 1;
  if p_cmd = 'stats' then
    if ws.live and ws.started_at is not null then
      c := core.session_counts(p_ch, ws.started_at, now());
      select coalesce(sum(stream), 0) into msgs from core.chat_counts where channel_id = p_ch and stream_start = ws.started_at;
      select * into sess from core.stream_sessions where channel_id = p_ch and started_at = ws.started_at;
      return left(format('📊 Live seit %s · %s Chatter · %s Nachrichten · %s neue Follower · %s Abos · %s Bits%s',
        core.fmt_span(extract(epoch from now() - ws.started_at)::bigint), c ->> 'chatters', msgs, c ->> 'follows', c ->> 'subs',
        c ->> 'bits', case when coalesce(sess.peak_viewers, 0) > 0 then format(' · bis zu %s Zuschauer', sess.peak_viewers) else '' end), 480);
    end if;
    select * into sess from core.stream_sessions where channel_id = p_ch and ended_at is not null order by started_at desc limit 1;
    if sess.id is null then return '📊 Noch keine Statistik – sie entsteht beim nächsten Stream.'; end if;
    return left(format('📊 Letzter Stream (%s, %s): %s Chatter · %s neue Follower · %s Abos · %s Bits · bis zu %s Zuschauer',
      to_char(sess.started_at at time zone 'Europe/Berlin', 'DD.MM.'), core.fmt_span(extract(epoch from sess.ended_at - sess.started_at)::bigint),
      coalesce(sess.chatters, 0), coalesce(sess.follows, 0), coalesce(sess.subs, 0), coalesce(sess.bits, 0), sess.peak_viewers), 480);
  end if;

  if p_cmd = 'topchatter' then
    if ws.live and ws.started_at is not null then
      select string_agg(format('%s. %s (%s)', rn, name, n), ' · ' order by rn) into top from (
        select row_number() over (order by stream desc, last_at) as rn, coalesce(nullif(name, ''), 'jemand') as name, stream as n
          from core.chat_counts
         where channel_id = p_ch and stream_start = ws.started_at and stream > 0 and twitch_id is distinct from me
         order by stream desc, last_at limit 5) x;
      return coalesce('💬 Top-Chatter in diesem Stream: ' || top, '💬 In diesem Stream hat noch niemand geschrieben.');
    end if;
    select string_agg(format('%s. %s (%s)', rn, name, n), ' · ' order by rn) into top from (
      select row_number() over (order by total desc, last_at) as rn, coalesce(nullif(name, ''), 'jemand') as name, total as n
        from core.chat_counts where channel_id = p_ch and twitch_id is distinct from me
       order by total desc, last_at limit 5) x;
    return coalesce('💬 Top-Chatter insgesamt: ' || top, '💬 Noch keine Nachrichten gezählt.');
  end if;

  if p_cmd = 'topwatch' then
    select string_agg(format('%s. %s (%s)', rn, name, public.watch_fmt(seconds)), ' · ' order by rn) into top from (
      select row_number() over (order by seconds desc, twitch_id) as rn,
             coalesce(nullif(display_name, ''), login) as name, seconds
        from core.watchtime where channel_id = p_ch and seconds > 0 and twitch_id is distinct from me
       order by seconds desc, twitch_id limit 5) x;
    return coalesce(left('⏱️ Watchtime-Bestenliste: ' || top, 480), '⏱️ Noch keine Watchtime gezählt.');
  end if;
  return null;
end;
$$;
revoke execute on function core.bot_stats_text(uuid, text) from public, anon, authenticated;

-- ---------- Jede Chat-Nachricht: bot_chat und danach Clips, Statistik, Stichwort-Antworten ----------
-- Antwort wie bot_chat, dazu clip:true (Edge Function macht den Clip)
create or replace function public.bot_chat2(p_user_id text, p_login text, p_name text, p_badges text[], p_text text,
  p_plain text default null, p_emotes int default 0, p_hosts text[] default '{}')
returns json language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := public.bot_chat(p_user_id, p_login, p_name, p_badges, p_text, p_plain, p_emotes, p_hosts)::jsonb;
  v_ch uuid := public.current_channel();
  s core.bot_settings;
  msg text := btrim(coalesce(p_text, ''));
  cmd text := '';
  is_mod boolean := coalesce(p_badges && array['moderator', 'broadcaster'], false);
  paused boolean;
  reply text;
  stat text;
begin
  if coalesce(p_user_id, '') !~ '^[0-9]{1,20}$' or v_ch is null or r ? 'mod' then return r; end if;
  perform core.chat_count(v_ch, p_user_id, p_name);
  if coalesce((r ->> 'stop')::boolean, false) then return r; end if;
  s := public.bot_cfg();
  paused := public.viewer_paused();
  if msg ~ '^!' then cmd := lower(split_part(msg, ' ', 1)); end if;

  -- !clip
  if s.clip_on and cmd in ('!clip', '!clipit') then
    if (paused and not is_mod) or not public.bot_allowed(s.clip_who, p_badges) then
      return r || jsonb_build_object('stop', true);
    end if;
    if not exists (select 1 from core.watch_state where channel_id = v_ch and id = 1 and live) then
      if public.bot_slot('clip:offline', 30) then reply := '🎬 Clips gehen nur, während der Stream läuft.'; end if;
    elsif not is_mod and not public.bot_slot('clip:u:' || p_user_id, s.clip_user_cooldown) then
      reply := null;
    elsif not public.bot_slot('clip', s.clip_cooldown) then
      if public.bot_slot('clip:busy', 10) then reply := '🎬 Gerade wurde schon ein Clip gemacht – kurz warten.'; end if;
    else
      return r || jsonb_build_object('stop', true, 'clip', true);
    end if;
    return r || jsonb_build_object('stop', true, 'replies', coalesce(r -> 'replies', '[]'::jsonb)
      || case when reply is not null then jsonb_build_array(jsonb_build_object('text', reply)) else '[]'::jsonb end);
  end if;

  -- !stats, !topchatter, !topwatch
  stat := case
    when cmd in ('!stats', '!statistik') then 'stats'
    when cmd in ('!topchatter', '!topchat', '!chatter') then 'topchatter'
    when cmd in ('!topwatch', '!topwatchtime', '!watchtop', '!toptime') then 'topwatch' end;
  if s.stats_on and stat is not null then
    if (paused and not is_mod) or not public.bot_slot('stats:' || stat, s.stats_cooldown) then
      return r || jsonb_build_object('stop', true);
    end if;
    reply := core.bot_stats_text(v_ch, stat);
    return r || jsonb_build_object('stop', true, 'replies', coalesce(r -> 'replies', '[]'::jsonb)
      || case when reply is not null then jsonb_build_array(jsonb_build_object('text', reply)) else '[]'::jsonb end);
  end if;

  -- !befehle: wie in chat_command (…_chat_bot_plus.sql), dazu die neuen Befehle
  if cmd in ('!befehle', '!commands') then
    if not public.bot_slot('cmds', 30) then return r || jsonb_build_object('stop', true); end if;
    select string_agg(command, ' ' order by command) into reply
      from public.bot_commands where enabled and public.bot_allowed(permission, p_badges);
    return r || jsonb_build_object('stop', true, 'replies', coalesce(r -> 'replies', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('text',
      left('Befehle: !watchtime '
        || case when s.info_on then '!uptime !followage !game !title ' else '' end
        || case when s.song_on and public.bot_allowed(s.song_who, p_badges) then '!sr !song !queue !wrongsong ' else '' end
        || case when s.clip_on and public.bot_allowed(s.clip_who, p_badges) then '!clip ' else '' end
        || case when s.stats_on then '!stats !topchatter !topwatch ' else '' end
        || coalesce(reply, ''), 480))));
  end if;

  -- Stichwort-Antworten: nur normale Nachrichten, nicht im Raid-Schutz, nicht der Streamer selbst
  if cmd = '' and s.faq_on and not paused and not coalesce(p_badges && array['broadcaster'], false) then
    reply := core.bot_faq_hit(v_ch, coalesce(p_plain, msg), p_name, s.faq_gap);
    if reply is not null then
      return r || jsonb_build_object('replies', coalesce(r -> 'replies', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('text', reply)));
    end if;
  end if;
  return r;
end;
$$;
revoke execute on function public.bot_chat2(text, text, text, text[], text, text, int, text[]) from public, anon, authenticated;
grant execute on function public.bot_chat2(text, text, text, text[], text, text, int, text[]) to service_role;

-- Edge Function: gemachten Clip merken (Liste im Dashboard, 30 Tage)
create or replace function public.bot_clip_add(p_clip_id text, p_who text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if v_ch is null or coalesce(p_clip_id, '') !~ '^[A-Za-z0-9_-]{1,200}$' then return; end if;
  insert into core.bot_clips (channel_id, clip_id, who) values (v_ch, p_clip_id, left(coalesce(p_who, ''), 60));
  delete from core.bot_clips where channel_id = v_ch and created_at < now() - interval '30 days';
end;
$$;
revoke execute on function public.bot_clip_add(text, text) from public, anon, authenticated;
grant execute on function public.bot_clip_add(text, text) to service_role;

-- ---------- Ansagen: Werbung, Hype-Train, Ziele (Edge Functions) ----------
-- p_kind: ad_warn {at, duration, seconds} · ad_start {at, duration} · hype_start/hype_level/hype_end {id, level}
--         goal {id, goal, current, target}
-- Antwort: {text, end_text?, end_after?} oder null (aus, schon gemeldet, unbekannt)
create or replace function public.bot_notice(p_kind text, p_data jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  s core.bot_settings;
  d jsonb := coalesce(p_data, '{}'::jsonb);
  v_dur int := greatest(0, least(coalesce((d ->> 'duration')::int, 0), 3600));
  v_secs int := greatest(0, least(coalesce((d ->> 'seconds')::int, 0), 3600));
  v_level int := greatest(1, least(coalesce((d ->> 'level')::int, 1), 1000));
  v_id text := left(regexp_replace(coalesce(d ->> 'id', d ->> 'at', ''), '[^A-Za-z0-9:._-]', '', 'g'), 60);
  extra jsonb;
begin
  if public.current_channel() is null then return null; end if;
  s := public.bot_cfg();
  extra := jsonb_build_object(
    'duration', core.fmt_span(v_dur),
    'in', case when v_secs < 45 then 'wenigen Sekunden' when v_secs < 90 then 'etwa einer Minute'
               else format('etwa %s Minuten', round(v_secs / 60.0)) end,
    'level', v_level,
    'goal', left(coalesce(nullif(btrim(d ->> 'goal'), ''), 'Unser Ziel'), 100),
    'current', coalesce((d ->> 'current')::bigint, 0),
    'target', coalesce((d ->> 'target')::bigint, 0));
  case p_kind
    when 'ad_warn' then
      if not s.ads_on or v_id = '' or not core.bot_once('ad:warn:' || v_id) then return null; end if;
      return json_build_object('text', public.bot_fill(s.ads_warn_text, '', extra));
    when 'ad_start' then
      if not s.ads_on or (v_id <> '' and not core.bot_once('ad:start:' || v_id)) then return null; end if;
      return json_build_object('text', public.bot_fill(s.ads_start_text, '', extra),
                               'end_text', public.bot_fill(s.ads_end_text, '', extra), 'end_after', v_dur);
    when 'hype_start' then
      if not s.hype_on or not core.bot_once('hype:' || v_id || ':start') then return null; end if;
      perform core.bot_once('hype:' || v_id || ':l' || v_level);
      return json_build_object('text', public.bot_fill(s.hype_start_text, '', extra));
    when 'hype_level' then
      -- Stufe 1 gehört zum Start; jede höhere Stufe genau einmal
      if not s.hype_on or v_level < 2 or not core.bot_once('hype:' || v_id || ':l' || v_level) then return null; end if;
      return json_build_object('text', public.bot_fill(s.hype_level_text, '', extra));
    when 'hype_end' then
      if not s.hype_on or not core.bot_once('hype:' || v_id || ':end') then return null; end if;
      return json_build_object('text', public.bot_fill(s.hype_end_text, '', extra));
    when 'goal' then
      if not s.goal_on or v_id = '' or (extra ->> 'target')::bigint <= 0
         or (extra ->> 'current')::bigint < (extra ->> 'target')::bigint
         or not core.bot_once('goal:' || v_id) then return null; end if;
      return json_build_object('text', public.bot_fill(s.goal_text, '', extra));
    else
      return null;
  end case;
end;
$$;
revoke execute on function public.bot_notice(text, jsonb) from public, anon, authenticated;
grant execute on function public.bot_notice(text, jsonb) to service_role;

-- Ansage später schicken („Werbung vorbei“): die Warteschlange bekommt einen Sendezeitpunkt
alter table core.bot_outbox add column if not exists send_after timestamptz;
select public.channel_view('bot_outbox');

notify pgrst, 'reload schema';
