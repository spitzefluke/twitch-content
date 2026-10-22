-- ============================================================
-- StreamHelp: zweiter Chat-Bot, Bot-Protokoll, Watchtime und Statistik live
--   1) Zwei Plattform-Bots: twitch_bot hat Platz 1 und 2 (der Plattform-Admin verbindet beide).
--      Jeder Kanal wählt in channels.bot_slot, welcher in seinem Chat schreibt; ist der gewählte
--      nicht verbunden, springt der andere ein.
--   2) Bot-Protokoll (core.bot_log): jede Nachricht mit Status – gesendet, von Twitch blockiert (mit
--      Grund), Fehler, kein Bot, Notfall-Schalter. Lesen: Streamer und Mods (bot_log_list), der
--      Plattform-Admin über alle Kanäle (admin_bot_log, nur über die Edge Function admin).
--   3) Watchtime: Durchgänge höchstens jede Minute statt alle 4,5 Minuten. Angestoßen auch vom
--      Chat, vom Twitch-Panel und von stream.online – nicht mehr nur vom OBS-Overlay.
--   4) Stream-Sitzungen (core.stream_sessions): eine Zeile je Stream (Twitch-Startzeit), laufend
--      aktualisiert; beim Ende (stream.offline oder der nächste Durchgang sieht „offline“) kommen
--      Follows, Abos, Bits, Einlösungen und Chatter dazu. channel_sessions liefert die
--      letzten Streams und den laufenden für das Dashboard (live per Realtime auf watch_state).
-- Braucht 20261028000000_platform.sql, 20261031000000_security.sql, 20261102000000_dashboard.sql.
-- Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('public.channels') is null then
    raise exception 'Erst die Plattform-Migration 20261028000000_platform.sql ausführen.';
  end if;
end;
$$;

-- ---------- 1) Zwei Bots ----------
alter table public.twitch_bot drop constraint if exists twitch_bot_id_check;
alter table public.twitch_bot add constraint twitch_bot_id_check check (id in (1, 2));
alter table public.oauth_states add column if not exists bot_slot int check (bot_slot is null or bot_slot in (1, 2));
alter table public.channels add column if not exists bot_slot int not null default 1;
alter table public.channels drop constraint if exists channels_bot_slot_check;
alter table public.channels add constraint channels_bot_slot_check check (bot_slot in (1, 2));

-- Welcher Bot schreibt im aktuellen Kanal? Gewählter Platz, sonst der andere verbundene.
create or replace function public.channel_bot_id(p_ch uuid default null)
returns int language sql stable security definer set search_path = '' as $$
  select b.id from public.twitch_bot b
  order by (b.id = coalesce((select c.bot_slot from public.channels c where c.id = coalesce(p_ch, public.current_channel())), 1)) desc, b.id
  limit 1;
$$;
revoke execute on function public.channel_bot_id(uuid) from public, anon, authenticated;

-- Stand für das Dashboard: wie bisher, der Bot ist jetzt der des Kanals; dazu die Auswahl
create or replace function public.twitch_status()
returns json language sql stable security definer set search_path = '' as $$
  select (
    coalesce(
      (select jsonb_build_object(
        'connected', true,
        'login', broadcaster_login,
        'display_name', display_name,
        'reward_active', reward_id is not null,
        'reward_title', reward_title,
        'reward_cost', reward_cost,
        'subscription_active', subscription_id is not null,
        'bot_scope', 'channel:bot' = any(scopes),
        'prank_rewards', prank_throw_reward_id is not null and prank_sound_reward_id is not null,
        'prank_rewards_active', prank_rewards_active,
        'predictions_scope', 'channel:manage:predictions' = any(scopes)
      ) from public.twitch_connection where id = 1),
      jsonb_build_object('connected', false)
    )
    || coalesce(
      (select jsonb_build_object('bot_connected', true, 'bot_login', login, 'bot_name', display_name,
                                 'bot_chat', 'user:read:chat' = any(scopes), 'bot_id', id)
       from public.twitch_bot where id = public.channel_bot_id()),
      jsonb_build_object('bot_connected', false)
    )
    || jsonb_build_object(
      'bot_slot', coalesce((select bot_slot from public.channels where id = public.current_channel()), 1),
      'bots', coalesce((select jsonb_agg(jsonb_build_object('slot', id, 'name', display_name, 'login', login) order by id) from public.twitch_bot), '[]'::jsonb),
      'can_choose_bot', public.is_owner()
    )
  )::json;
$$;
revoke execute on function public.twitch_status() from public, anon;
grant execute on function public.twitch_status() to authenticated;

-- ---------- 2) Bot-Protokoll ----------
create table if not exists core.bot_log (
  id bigint generated always as identity primary key,
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  created_at timestamptz not null default now(),
  bot text not null default '',                       -- Login des Bots, der geschrieben hat
  text text not null default '' check (char_length(text) <= 500),
  status text not null check (status in ('sent', 'dropped', 'error', 'no_bot', 'off')),
  reason text not null default '' check (char_length(reason) <= 300),
  source text not null default 'chat' check (source in ('chat', 'outbox', 'test', 'mod')),
  ms int                                              -- Antwortzeit von Twitch in Millisekunden
);
create index if not exists bot_log_channel_idx on core.bot_log (channel_id, created_at desc);
create index if not exists bot_log_status_idx on core.bot_log (created_at desc) where status <> 'sent';
alter table core.bot_log enable row level security;
revoke all on core.bot_log from anon, authenticated;

-- Eintrag schreiben (nur Edge Functions); älter als 7 Tage fliegt raus
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
          case when p_source in ('chat', 'outbox', 'test', 'mod') then p_source else 'chat' end,
          case when p_ms between 0 and 600000 then p_ms end);
  if random() < 0.02 then delete from core.bot_log where created_at < now() - interval '7 days'; end if;
end;
$$;
revoke execute on function public.bot_log_add(text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.bot_log_add(text, text, text, text, text, int) to service_role;

-- Für Streamer und Mods: die letzten Nachrichten des Kanals und eine Zusammenfassung (24 Stunden)
create or replace function public.bot_log_list(p_limit int default 50)
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Das Bot-Protokoll sehen nur der Streamer und freigegebene Mods.' using errcode = '42501';
  end if;
  return json_build_object(
    'items', coalesce((select json_agg(row_to_json(x) order by x.id desc) from (
      select id, created_at, bot, text, status, reason, source, ms from core.bot_log
      where channel_id = v_ch order by id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'::json),
    'day', (select json_build_object(
      'sent', count(*) filter (where status = 'sent'),
      'failed', count(*) filter (where status <> 'sent'),
      'avg_ms', round(avg(ms) filter (where status = 'sent')))
      from core.bot_log where channel_id = v_ch and created_at > now() - interval '24 hours'));
end;
$$;
revoke execute on function public.bot_log_list(int) from public, anon;
grant execute on function public.bot_log_list(int) to authenticated;

-- Plattform-Admin: über alle Kanäle (nur die Edge Function admin ruft das auf, nach Login und 2FA)
create or replace function public.admin_bot_log(p_limit int default 100, p_problems boolean default false)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'items', coalesce((select json_agg(row_to_json(x) order by x.id desc) from (
      select l.id, l.created_at, l.bot, l.text, l.status, l.reason, l.source, l.ms,
             coalesce(c.display_name, c.login, '?') as channel
      from core.bot_log l left join public.channels c on c.id = l.channel_id
      where not coalesce(p_problems, false) or l.status <> 'sent'
      order by l.id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::json),
    'channels', coalesce((select json_agg(row_to_json(s) order by s.failed desc, s.channel) from (
      select coalesce(c.display_name, c.login, '?') as channel, c.bot_slot,
             count(*) filter (where l.status = 'sent') as sent,
             count(*) filter (where l.status <> 'sent') as failed,
             round(avg(l.ms) filter (where l.status = 'sent')) as avg_ms,
             max(l.created_at) as last_at
      from core.bot_log l join public.channels c on c.id = l.channel_id
      where l.created_at > now() - interval '24 hours'
      group by c.id, c.display_name, c.login, c.bot_slot) s), '[]'::json));
$$;
revoke execute on function public.admin_bot_log(int, boolean) from public, anon, authenticated;
grant execute on function public.admin_bot_log(int, boolean) to service_role;

-- ---------- 3) Watchtime: höchstens jede Minute ein Durchgang ----------
create or replace function public.watch_tick_claim()
returns json language plpgsql security definer set search_path = '' as $$
declare
  prev timestamptz;
  was_live boolean;
begin
  select last_tick_at, live into prev, was_live from public.watch_state where id = 1 for update;
  if not found then
    insert into public.watch_state (id) values (1) on conflict do nothing;
  end if;
  if prev is not null and prev > now() - interval '55 seconds' then
    return null;
  end if;
  update public.watch_state set last_tick_at = now() where id = 1;
  return json_build_object('prev', prev, 'was_live', coalesce(was_live, false));
end;
$$;
revoke execute on function public.watch_tick_claim() from public, anon, authenticated;

-- Dashboard: Watchtime und Statistik live – jede Zählung meldet sich per Realtime (nur für Admins lesbar)
select public.realtime_add('watch_state');

-- ---------- 4) Stream-Sitzungen ----------
create table if not exists core.stream_sessions (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.channels on delete cascade,
  started_at timestamptz not null,                    -- Startzeit laut Twitch
  last_at timestamptz not null default now(),         -- letzte Zählung während des Streams
  ended_at timestamptz,                               -- null: läuft noch
  peak_viewers int not null default 0,
  viewer_sum bigint not null default 0,
  samples int not null default 0,
  game text not null default '',
  -- beim Ende festgehalten (Alerts und Chatter werden später aufgeräumt)
  follows int, subs int, bits int, redeems int, chatters int,
  unique (channel_id, started_at)
);
create index if not exists stream_sessions_channel_idx on core.stream_sessions (channel_id, started_at desc);
alter table core.stream_sessions enable row level security;
revoke all on core.stream_sessions from anon, authenticated;

-- Zahlen eines Zeitraums aus den Alerts und dem Chat (für laufende und beendete Streams)
create or replace function core.session_counts(p_ch uuid, p_from timestamptz, p_to timestamptz)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'follows', count(*) filter (where a.kind = 'follow'),
    'subs', count(*) filter (where a.kind in ('sub', 'resub')) + coalesce(sum(greatest(a.amount, 1)) filter (where a.kind = 'gift'), 0),
    'bits', coalesce(sum(a.amount) filter (where a.kind = 'bits'), 0),
    'redeems', count(*) filter (where a.kind = 'redeem'),
    'chatters', (select count(*) from core.watchtime w where w.channel_id = p_ch and w.last_chat_at >= p_from and w.last_chat_at <= p_to))
  from core.stream_alerts a
  where a.channel_id = p_ch and not a.test and a.created_at >= p_from and a.created_at <= p_to;
$$;
revoke execute on function core.session_counts(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Laufende Sitzungen abschließen (bis auf die mit p_keep, den gerade laufenden Stream)
create or replace function core.session_finish(p_ch uuid, p_at timestamptz default null, p_keep timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s record;
  c json;
  v_end timestamptz;
begin
  for s in select * from core.stream_sessions where channel_id = p_ch and ended_at is null
                                                  and started_at is distinct from p_keep for update loop
    -- Ende: Zeitpunkt des Offline-Ereignisses (wenn es zur letzten Zählung passt), sonst die letzte Zählung
    v_end := case when p_at is not null and p_at > s.last_at and p_at < s.last_at + interval '15 minutes' then p_at else s.last_at end;
    c := core.session_counts(p_ch, s.started_at, v_end + interval '1 minute');
    update core.stream_sessions set ended_at = v_end,
      follows = (c ->> 'follows')::int, subs = (c ->> 'subs')::int, bits = (c ->> 'bits')::int,
      redeems = (c ->> 'redeems')::int, chatters = (c ->> 'chatters')::int
    where id = s.id;
  end loop;
end;
$$;
revoke execute on function core.session_finish(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Jede Zählung während des Streams: Zuschauer, Startzeit, Sitzung fortschreiben
create or replace function public.watch_stream_info(p_viewers int, p_started_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v int := greatest(0, least(coalesce(p_viewers, 0), 10000000));
begin
  update public.watch_state set viewer_count = v, started_at = p_started_at where id = 1;
  if v_ch is null or p_started_at is null then return; end if;
  -- Ein neuer Stream ohne Offline-Meldung dazwischen: den alten abschließen
  perform core.session_finish(v_ch, null, p_started_at);
  insert into core.stream_sessions as s (channel_id, started_at, last_at, peak_viewers, viewer_sum, samples, game)
  values (v_ch, p_started_at, now(), v, v, 1,
          coalesce((select live_category from public.stream_games where id = 1), ''))
  on conflict (channel_id, started_at) do update set
    last_at = now(), ended_at = null,
    peak_viewers = greatest(s.peak_viewers, excluded.peak_viewers),
    viewer_sum = s.viewer_sum + excluded.viewer_sum,
    samples = s.samples + 1,
    game = case when excluded.game <> '' then excluded.game else s.game end;
end;
$$;
revoke execute on function public.watch_stream_info(int, timestamptz) from public, anon, authenticated;

-- Durchgang sieht „offline“: Zustand zurücksetzen und den Stream abschließen
create or replace function public.watch_offline()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  update public.watch_state set live = false, viewers = 0 where id = 1;
  if v_ch is not null then perform core.session_finish(v_ch, null, null); end if;
end;
$$;
revoke execute on function public.watch_offline() from public, anon, authenticated;

-- stream.offline von Twitch: genau jetzt beendet
create or replace function public.stream_offline_event()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  update public.watch_state set live = false, viewers = 0, last_tick_at = now() where id = 1;
  if v_ch is not null then perform core.session_finish(v_ch, now(), null); end if;
end;
$$;
revoke execute on function public.stream_offline_event() from public, anon, authenticated;
grant execute on function public.stream_offline_event() to service_role;

-- Dashboard: der laufende Stream (live gerechnet) und die letzten beendeten
create or replace function public.channel_sessions(p_limit int default 10)
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  st record;
  cur core.stream_sessions;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Nur für Streamer und freigegebene Mods.' using errcode = '42501';
  end if;
  select live, viewer_count, last_tick_at, viewers into st from core.watch_state where channel_id = v_ch and id = 1;
  select * into cur from core.stream_sessions where channel_id = v_ch and ended_at is null order by started_at desc limit 1;
  return json_build_object(
    'live', case when coalesce(st.live, false) and cur.id is not null then
      json_build_object('started_at', cur.started_at, 'last_at', cur.last_at,
        'minutes', round(extract(epoch from now() - cur.started_at) / 60),
        'viewers', coalesce(st.viewer_count, 0), 'in_chat', coalesce(st.viewers, 0),
        'peak_viewers', cur.peak_viewers,
        'avg_viewers', case when cur.samples > 0 then round(cur.viewer_sum::numeric / cur.samples) else 0 end,
        'game', cur.game)::jsonb || core.session_counts(v_ch, cur.started_at, now())::jsonb
    end,
    'last_tick_at', st.last_tick_at,
    'sessions', coalesce((select json_agg(json_build_object(
        'started_at', s.started_at, 'ended_at', s.ended_at,
        'minutes', round(extract(epoch from s.ended_at - s.started_at) / 60),
        'peak_viewers', s.peak_viewers,
        'avg_viewers', case when s.samples > 0 then round(s.viewer_sum::numeric / s.samples) else 0 end,
        'game', s.game, 'follows', s.follows, 'subs', s.subs, 'bits', s.bits, 'redeems', s.redeems,
        'chatters', s.chatters) order by s.started_at desc)
      from (select * from core.stream_sessions where channel_id = v_ch and ended_at is not null
            order by started_at desc limit least(greatest(coalesce(p_limit, 10), 1), 50)) s), '[]'::json));
end;
$$;
revoke execute on function public.channel_sessions(int) from public, anon;
grant execute on function public.channel_sessions(int) to authenticated;

notify pgrst, 'reload schema';
