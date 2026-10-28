-- ============================================================
-- StreamHelp: Discord-Anbindung je Kanal (nach …_brand_color.sql einspielen)
--   Der Streamer legt in seinem Discord-Server einen Webhook an (Kanal-Einstellungen → Integrationen)
--   und fügt die Adresse im Dashboard ein. StreamHelp postet dann in diesen Kanal:
--     · Live-Benachrichtigung beim Stream-Start (Titel, Game, Link; optional @here/@everyone/Rolle)
--     · Rückblick nach dem Stream (Dauer, Zuschauer, Follower, Abos, Bits, Chatter)
--     · Ankündigungen: Wochenplan und Content-Ideen mit Termin (auf Knopfdruck oder neue Termine automatisch)
--   Die Webhook-Adresse ist geheim (wer sie kennt, kann in den Kanal schreiben): Sie liegt nur in der
--   Datenbank, die Webseite sieht nur den Namen des Webhooks. Gepostet wird von den Edge Functions
--   (stream-tools, twitch-eventsub, _shared/discord.ts) – nur an discord.com/api/webhooks/…
-- Mehrfach ausführbar.
-- ============================================================

create table if not exists core.discord_settings (
  channel_id uuid primary key references public.channels on delete cascade,
  webhook_url text check (webhook_url is null or webhook_url ~ '^https://(ptb\.|canary\.)?discord(app)?\.com/api/webhooks/[0-9]{5,25}/[A-Za-z0-9_-]{20,100}$'),
  webhook_name text not null default '' check (char_length(webhook_name) <= 80),
  on_live boolean not null default true,
  on_recap boolean not null default true,
  on_ideas boolean not null default false,             -- neue Termine (Content-Ideen mit Datum) automatisch ankündigen
  live_text text not null default '🔴 {streamer} ist jetzt live: {title}' check (char_length(live_text) <= 300),
  mention text not null default '' check (mention ~ '^(|here|everyone|[0-9]{5,25})$'),  -- '' / @here / @everyone / Rollen-ID
  last_live_at timestamptz,                            -- doppelte Live-Meldungen vermeiden
  announced jsonb not null default '{}'::jsonb,        -- automatisch angekündigte Termine: Kachel → Datum
  last_ok_at timestamptz,
  last_error text not null default '' check (char_length(last_error) <= 300),
  updated_at timestamptz not null default now()
);
alter table core.discord_settings add column if not exists announced jsonb not null default '{}'::jsonb;
alter table core.discord_settings enable row level security;
revoke all on core.discord_settings from anon, authenticated;

-- Mod-Rechte: Discord gehört zu „Bot & Chat“
create or replace function public.request_area()
returns text language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('app.area', true), ''), case
    when p ~ '^giveaway' then 'giveaway'
    when p ~ '^(spins?($|_)|wheel|overlay_spins)' then 'wheel'
    when p ~ '^bingo' then 'bingo'
    when p ~ '^(tiles?($|_)|ideas?($|_)|idea_votes|feature_open|games_|questions?($|_)|question_)' then 'ideas'
    when p ~ '^(quiz|shop|challenge|win_challenge|queue|cards?_|forbidden|hotword|pause|poll|bet|scratch)' then 'games'
    when p ~ '^(send_prank|prank|sounds($|_)|tts)' then 'pranks'
    when p ~ '^pet' then 'pet'
    when p ~ '^(overlay|alert|ticker|stream_alerts|subathon|anniversary)' then 'overlay'
    when p ~ '^(bot_|chat_|discord_)' then 'chat'
    when p ~ '^stream_reward' then 'points'
    when p ~ '^site_guard' then 'guard'
  end)
  from (select lower(regexp_replace(coalesce(current_setting('request.path', true), ''), '^/(rpc/)?', '')) as p) x;
$$;

-- ---------- Dashboard (Streamer, Admins, freigegebene Mods) ----------
create or replace function public.discord_get()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  s core.discord_settings;
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  select * into s from core.discord_settings where channel_id = v_ch;
  return json_build_object(
    'connected', s.webhook_url is not null, 'webhook_name', coalesce(s.webhook_name, ''),
    'on_live', coalesce(s.on_live, true), 'on_recap', coalesce(s.on_recap, true), 'on_ideas', coalesce(s.on_ideas, false),
    'live_text', coalesce(s.live_text, '🔴 {streamer} ist jetzt live: {title}'), 'mention', coalesce(s.mention, ''),
    'last_ok_at', s.last_ok_at, 'last_error', coalesce(s.last_error, ''));
end;
$$;
revoke execute on function public.discord_get() from public, anon;
grant execute on function public.discord_get() to authenticated;

create or replace function public.discord_save(p_on_live boolean, p_on_recap boolean, p_on_ideas boolean, p_live_text text, p_mention text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_text text := left(btrim(coalesce(p_live_text, '')), 300);
  v_mention text := lower(btrim(coalesce(p_mention, '')));
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  v_mention := regexp_replace(v_mention, '^<@&([0-9]+)>$', '\1');
  v_mention := regexp_replace(v_mention, '^@', '');
  if v_mention !~ '^(|here|everyone|[0-9]{5,25})$' then raise exception 'Erwähnung: leer, here, everyone oder eine Rollen-ID.'; end if;
  if v_text = '' then v_text := '🔴 {streamer} ist jetzt live: {title}'; end if;
  insert into core.discord_settings (channel_id, on_live, on_recap, on_ideas, live_text, mention)
    values (v_ch, coalesce(p_on_live, true), coalesce(p_on_recap, true), coalesce(p_on_ideas, false), v_text, v_mention)
  on conflict (channel_id) do update set on_live = excluded.on_live, on_recap = excluded.on_recap, on_ideas = excluded.on_ideas,
    live_text = excluded.live_text, mention = excluded.mention, updated_at = now();
  return public.discord_get();
end;
$$;
revoke execute on function public.discord_save(boolean, boolean, boolean, text, text) from public, anon;
grant execute on function public.discord_save(boolean, boolean, boolean, text, text) to authenticated;

-- Webhook speichern: nur über die Edge Function stream-tools (prüft das Recht „Bot & Chat“ und fragt
-- vorher bei Discord nach, ob es den Webhook gibt – von dort kommt auch der Name)
create or replace function public.discord_connect(p_url text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_url text := btrim(coalesce(p_url, ''));
begin
  if v_ch is null then raise exception 'Kanal unbekannt.'; end if;
  if v_url !~ '^https://(ptb\.|canary\.)?discord(app)?\.com/api/webhooks/[0-9]{5,25}/[A-Za-z0-9_-]{20,100}$' then
    raise exception 'Das ist keine Discord-Webhook-Adresse (https://discord.com/api/webhooks/…).';
  end if;
  insert into core.discord_settings (channel_id, webhook_url, webhook_name) values (v_ch, v_url, left(btrim(coalesce(p_name, '')), 80))
  on conflict (channel_id) do update set webhook_url = excluded.webhook_url, webhook_name = excluded.webhook_name,
    last_error = '', updated_at = now();
end;
$$;
revoke execute on function public.discord_connect(text, text) from public, anon, authenticated;

create or replace function public.discord_disconnect()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  update core.discord_settings set webhook_url = null, webhook_name = '', last_error = '', updated_at = now() where channel_id = v_ch;
  return public.discord_get();
end;
$$;
revoke execute on function public.discord_disconnect() from public, anon;
grant execute on function public.discord_disconnect() to authenticated;

-- ---------- Edge Functions (nur Service-Rolle) ----------
-- Ziel und Einstellungen für eine Art Nachricht (live, recap, ideas, manual) – null, wenn aus oder ohne Webhook.
-- „live“ höchstens einmal je 30 Minuten (Twitch schickt stream.online manchmal doppelt).
create or replace function public.discord_target(p_kind text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  s core.discord_settings;
begin
  select * into s from core.discord_settings where channel_id = v_ch for update;
  if not found or s.webhook_url is null then return null; end if;
  if p_kind = 'live' then
    if not s.on_live or (s.last_live_at is not null and s.last_live_at > now() - interval '30 minutes') then return null; end if;
    update core.discord_settings set last_live_at = now() where channel_id = v_ch;
  elsif p_kind = 'recap' and not s.on_recap then return null;
  elsif p_kind = 'ideas' and not s.on_ideas then return null;
  end if;
  return json_build_object('url', s.webhook_url, 'live_text', s.live_text, 'mention', s.mention,
    'login', (select login from public.channels where id = v_ch), 'display_name', (select display_name from public.channels where id = v_ch));
end;
$$;
revoke execute on function public.discord_target(text) from public, anon, authenticated;

create or replace function public.discord_mark(p_ok boolean, p_error text default '')
returns void language sql security definer set search_path = '' as $$
  update core.discord_settings set
    last_ok_at = case when p_ok then now() else last_ok_at end,
    last_error = case when p_ok then '' else left(coalesce(p_error, ''), 300) end
  where channel_id = public.current_channel();
$$;
revoke execute on function public.discord_mark(boolean, text) from public, anon, authenticated;

-- Rückblick: der zuletzt beendete Stream (aus …_bot_stats.sql)
create or replace function public.discord_recap()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('started_at', s.started_at, 'ended_at', s.ended_at, 'game', s.game, 'peak', s.peak_viewers,
    'avg', case when s.samples > 0 then round(s.viewer_sum::numeric / s.samples) else 0 end,
    'follows', coalesce(s.follows, 0), 'subs', coalesce(s.subs, 0), 'bits', coalesce(s.bits, 0), 'chatters', coalesce(s.chatters, 0))
  from core.stream_sessions s
  where s.channel_id = public.current_channel() and s.ended_at is not null and s.ended_at > now() - interval '2 hours'
  order by s.ended_at desc limit 1;
$$;
revoke execute on function public.discord_recap() from public, anon, authenticated;

-- Automatische Ankündigung eines Termins: true nur beim ersten Mal je Kachel und Datum
create or replace function public.discord_idea_claim(p_tile text, p_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_key text := left(coalesce(p_tile, ''), 80);
begin
  if v_key = '' or p_at is null then return false; end if;
  update core.discord_settings set announced = (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(announced) e(k, v)
      where (v #>> '{}')::timestamptz > now() - interval '7 days'      -- alte Termine vergessen
    ) || jsonb_build_object(v_key, p_at)
  where channel_id = v_ch and webhook_url is not null and coalesce(announced ->> v_key, '') is distinct from to_jsonb(p_at) #>> '{}';
  return found;
end;
$$;
revoke execute on function public.discord_idea_claim(text, timestamptz) from public, anon, authenticated;

-- Ankündigungen: nächste Termine aus dem Wochenplan und Content-Ideen mit Datum (Kacheln)
create or replace function public.discord_announce_data(p_tile text default null)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'upcoming', public.schedule_upcoming(public.current_channel(), 7),
    'tz', coalesce((select tz from core.channel_profile where channel_id = public.current_channel()), 'Europe/Berlin'),
    'ideas', coalesce((select json_agg(json_build_object('id', t.id, 'title', t.title, 'description', t.description, 'target_at', t.target_at) order by t.target_at)
                       from core.tiles t
                       where t.channel_id = public.current_channel() and t.target_at > now() and t.target_at < now() + interval '60 days'
                         and (p_tile is null or t.id = p_tile)), '[]'::json));
$$;
revoke execute on function public.discord_announce_data(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
