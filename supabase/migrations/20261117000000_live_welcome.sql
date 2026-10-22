-- ============================================================
-- StreamHelp: Der Bot meldet sich von selbst
--   1) Live-Start: Geht der Streamer live (EventSub stream.online), schreibt der Bot sofort eine
--      Willkommensnachricht mit dem Spiel. Einstellbar unter Bot & Chat → Begrüßung & Danke
--      (bot_settings.live_on, live_text; Platzhalter {streamer} {game} {title}). Standard: an.
--      bot_live_start() lässt höchstens eine Nachricht je 30 Minuten zu – Twitch stellt manchmal
--      doppelt zu, und ein kurzer Abbruch mit Neustart soll den Chat nicht zuschreiben.
--   2) Bot-Protokoll: neue Quelle „system“ für Nachrichten, die der Bot von selbst schreibt
--      (Live-Start, Hallo nach dem Bot-Wechsel).
-- Braucht 20261109000000_chat_bot_plus.sql und 20261116000000_bot_stats.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.bot_settings') is null then
    raise exception 'Erst die Migration 20261109000000_chat_bot_plus.sql ausführen.';
  end if;
  if to_regclass('core.bot_log') is null then
    raise exception 'Erst die Migration 20261116000000_bot_stats.sql ausführen.';
  end if;
end;
$$;

-- ---------- 1) Live-Start ----------
alter table core.bot_settings add column if not exists live_on boolean not null default true;
alter table core.bot_settings add column if not exists live_text text not null
  default '🔴 {streamer} ist jetzt live mit {game}! Willkommen im Stream – schön, dass ihr da seid 💜'
  check (char_length(btrim(live_text)) between 1 and 300);
select public.channel_view('bot_settings');

-- Unverändert aus …_chat_bot_plus.sql, dazu live_on und live_text
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
    updated_at = now()
  where channel_id = v_ch and id = 1;
  return public.bot_settings_get();
end;
$$;
revoke execute on function public.bot_settings_save(jsonb) from public, anon;
grant execute on function public.bot_settings_save(jsonb) to authenticated;

-- Nur Edge Functions (twitch-eventsub bei stream.online): Text mit Platzhaltern oder send = false.
-- Die Sperre (30 Minuten) setzt dieselbe Anweisung, die sie prüft – zwei gleichzeitige Zustellungen
-- ergeben so höchstens eine Nachricht.
create or replace function public.bot_live_start()
returns json language plpgsql security definer set search_path = '' as $$
declare
  s core.bot_settings;
  v_ch uuid := public.current_channel();
  v_ok boolean;
begin
  if v_ch is null then return json_build_object('send', false, 'reason', 'no_channel'); end if;
  s := public.bot_cfg();
  if not s.live_on then return json_build_object('send', false, 'reason', 'off'); end if;
  insert into core.chat_cooldowns as c (channel_id, slot, at) values (v_ch, 'live:welcome', now())
  on conflict (channel_id, slot) do update set at = now() where c.at <= now() - interval '30 minutes'
  returning true into v_ok;
  if v_ok is null then return json_build_object('send', false, 'reason', 'cooldown'); end if;
  return json_build_object('send', true, 'text', s.live_text);
end;
$$;
revoke execute on function public.bot_live_start() from public, anon, authenticated;
grant execute on function public.bot_live_start() to service_role;

-- ---------- 2) Bot-Protokoll: Quelle „system“ ----------
alter table core.bot_log drop constraint if exists bot_log_source_check;
alter table core.bot_log add constraint bot_log_source_check check (source in ('chat', 'outbox', 'test', 'mod', 'system'));

-- Unverändert aus …_bot_stats.sql, dazu die Quelle „system“
create or replace function public.bot_log_add(p_text text, p_status text, p_reason text default '', p_source text default 'chat',
                                              p_bot text default '', p_ms int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if v_ch is null then return; end if;
  insert into core.bot_log (channel_id, bot, text, status, reason, source, ms)
  values (v_ch, left(coalesce(p_bot, ''), 40), left(coalesce(p_text, ''), 500),
          case when p_status in ('sent', 'dropped', 'error', 'no_bot', 'off') then p_status else 'error' end,
          left(coalesce(p_reason, ''), 300),
          case when p_source in ('chat', 'outbox', 'test', 'mod', 'system') then p_source else 'chat' end,
          case when p_ms between 0 and 600000 then p_ms end);
  if random() < 0.02 then delete from core.bot_log where created_at < now() - interval '7 days'; end if;
end;
$$;
revoke execute on function public.bot_log_add(text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.bot_log_add(text, text, text, text, text, int) to service_role;
