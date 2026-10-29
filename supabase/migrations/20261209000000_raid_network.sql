-- ============================================================
-- StreamHelp: Raid-Netzwerk und Freunde werben (nach …_discord.sql einspielen)
--   Raid-Netzwerk: Streamer schalten „Im Raid-Netzwerk sichtbar“ selbst ein. Wer mitmacht, sieht die
--   anderen Mitglieder, die gerade live sind – passendes Spiel und Sprache zuerst, kleinere Kanäle vor
--   großen – und raidet mit einem Klick (Edge Function stream-tools, Twitch-Recht channel:manage:raids).
--   Auf Wunsch sagt der Bot vorher im Chat an, wohin es geht; kommt ein Raid aus dem Netzwerk, begrüßt
--   der Bot ihn mit dem Kurztext des Kanals.
--   Freunde werben: Link mit ?ref=<login>. Wer sich danach als Streamer anmeldet, wird dem werbenden
--   Kanal zugeordnet. Geworbene Kanäle stehen bei der Freischaltung vorne; der Werber bekommt ein
--   Abzeichen (ab 1, 3 und 10 freigeschalteten Kanälen) im Dashboard und auf dem öffentlichen Profil.
-- Mehrfach ausführbar.
-- ============================================================

-- ---------- Raid-Netzwerk ----------
create table if not exists core.raid_network (
  channel_id uuid primary key references public.channels on delete cascade,
  enabled boolean not null default false,
  language text not null default 'de' check (language in ('de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'tr', 'ru', 'other')),
  note text not null default '' check (char_length(note) <= 120),          -- Kurztext: was es bei dir gibt
  announce boolean not null default true,                                  -- Bot sagt den Raid im Chat an
  raid_text text not null default '🚀 Gleich geht''s rüber zu {target}! Bleibt dabei und sagt Hallo 💜'
    check (char_length(raid_text) <= 300),
  welcome boolean not null default true,                                   -- Raids aus dem Netzwerk begrüßen
  updated_at timestamptz not null default now()
);
alter table core.raid_network enable row level security;
revoke all on core.raid_network from anon, authenticated;

create table if not exists core.raid_log (
  id bigint generated always as identity primary key,
  from_channel uuid not null references public.channels on delete cascade,
  to_channel uuid not null references public.channels on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists raid_log_from on core.raid_log (from_channel, created_at desc);
alter table core.raid_log enable row level security;
revoke all on core.raid_log from anon, authenticated;

-- Mod-Rechte: Raid gehört zu „Bot & Chat“
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
    when p ~ '^(bot_|chat_|discord_|raid_)' then 'chat'
    when p ~ '^stream_reward' then 'points'
    when p ~ '^site_guard' then 'guard'
  end)
  from (select lower(regexp_replace(coalesce(current_setting('request.path', true), ''), '^/(rpc/)?', '')) as p) x;
$$;

-- Wer gerade live ist (Watchtime/Statistik melden alle paar Minuten, …_games.sql)
create or replace function public.raid_is_live(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select g.live_at > now() - interval '12 minutes' from core.stream_games g where g.channel_id = p_channel and g.id = 1), false);
$$;
revoke execute on function public.raid_is_live(uuid) from public, anon, authenticated;

-- Dashboard: eigene Einstellungen und – wenn man selbst mitmacht – wer aus dem Netzwerk gerade live ist
create or replace function public.raid_network_get()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  s core.raid_network;
  v_cat text;
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  select * into s from core.raid_network where channel_id = v_ch;
  select live_category into v_cat from core.stream_games where channel_id = v_ch and id = 1;
  return json_build_object(
    'enabled', coalesce(s.enabled, false), 'language', coalesce(s.language, 'de'), 'note', coalesce(s.note, ''),
    'announce', coalesce(s.announce, true), 'welcome', coalesce(s.welcome, true),
    'raid_text', coalesce(s.raid_text, '🚀 Gleich geht''s rüber zu {target}! Bleibt dabei und sagt Hallo 💜'),
    'live', public.raid_is_live(v_ch), 'category', case when public.raid_is_live(v_ch) then coalesce(v_cat, '') else '' end,
    'members', (select count(*) from core.raid_network n join public.channels c on c.id = n.channel_id where n.enabled and c.status = 'active'),
    'suggestions', case when coalesce(s.enabled, false) then coalesce((
      select json_agg(x order by x.same_game desc, x.same_lang desc, x.viewers asc, x.login) from (
        select c.login, c.display_name, c.avatar_url, n.language, n.note,
          left(coalesce(g.live_category, ''), 120) as category,
          coalesce((select case when ss.samples > 0 then round(ss.viewer_sum::numeric / ss.samples) else 0 end
                    from core.stream_sessions ss where ss.channel_id = c.id and ss.ended_at is null
                    order by ss.started_at desc limit 1), 0)::int as viewers,
          (v_cat is not null and v_cat <> '' and lower(g.live_category) = lower(v_cat)) as same_game,
          (n.language = s.language) as same_lang,
          exists (select 1 from core.raid_log l where l.from_channel = v_ch and l.to_channel = c.id and l.created_at > now() - interval '7 days') as raided_recently
        from core.raid_network n
        join public.channels c on c.id = n.channel_id and c.status = 'active'
        join core.stream_games g on g.channel_id = c.id and g.id = 1 and g.live_at > now() - interval '12 minutes'
        where n.enabled and c.id <> v_ch
        limit 60) x), '[]'::json) else '[]'::json end);
end;
$$;
revoke execute on function public.raid_network_get() from public, anon;
grant execute on function public.raid_network_get() to authenticated;

create or replace function public.raid_network_save(p_enabled boolean, p_language text, p_note text, p_announce boolean, p_welcome boolean, p_raid_text text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_lang text := lower(btrim(coalesce(p_language, 'de')));
  v_text text := left(btrim(coalesce(p_raid_text, '')), 300);
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  if v_lang not in ('de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'tr', 'ru', 'other') then v_lang := 'other'; end if;
  if v_text = '' then v_text := '🚀 Gleich geht''s rüber zu {target}! Bleibt dabei und sagt Hallo 💜'; end if;
  insert into core.raid_network (channel_id, enabled, language, note, announce, welcome, raid_text)
    values (v_ch, coalesce(p_enabled, false), v_lang, left(btrim(coalesce(p_note, '')), 120), coalesce(p_announce, true), coalesce(p_welcome, true), v_text)
  on conflict (channel_id) do update set enabled = excluded.enabled, language = excluded.language, note = excluded.note,
    announce = excluded.announce, welcome = excluded.welcome, raid_text = excluded.raid_text, updated_at = now();
  return public.raid_network_get();
end;
$$;
revoke execute on function public.raid_network_save(boolean, text, text, boolean, boolean, text) from public, anon;
grant execute on function public.raid_network_save(boolean, text, text, boolean, boolean, text) to authenticated;

-- Edge Function (Service-Rolle): Ziel prüfen – nur Mitglieder, die gerade live sind, und nur wenn man selbst
-- mitmacht. Höchstens ein Raid je 2 Minuten. Liefert Twitch-ID des Ziels und den Ansage-Text.
create or replace function public.raid_target(p_login text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  me core.raid_network;
  t public.channels;
  n core.raid_network;
begin
  select * into me from core.raid_network where channel_id = v_ch;
  if not found or not me.enabled then raise exception 'Schalte zuerst „Im Raid-Netzwerk sichtbar“ ein.'; end if;
  select * into t from public.channels where login = lower(btrim(coalesce(p_login, ''))) and status = 'active';
  if t.id is null or t.id = v_ch then raise exception 'Diesen Kanal gibt es im Netzwerk nicht.'; end if;
  select * into n from core.raid_network where channel_id = t.id;
  if not found or not n.enabled then raise exception 'Dieser Kanal macht gerade nicht beim Raid-Netzwerk mit.'; end if;
  if not public.raid_is_live(t.id) then raise exception 'Dieser Kanal ist gerade nicht live.'; end if;
  if exists (select 1 from core.raid_log where from_channel = v_ch and created_at > now() - interval '2 minutes') then
    raise exception 'Du hast gerade erst geraidet – bitte kurz warten.';
  end if;
  return json_build_object('id', t.id, 'twitch_id', t.twitch_id, 'login', t.login, 'display_name', coalesce(nullif(t.display_name, ''), t.login),
    'announce', me.announce, 'raid_text', me.raid_text);
end;
$$;
revoke execute on function public.raid_target(text) from public, anon, authenticated;

create or replace function public.raid_logged(p_to uuid)
returns void language sql security definer set search_path = '' as $$
  insert into core.raid_log (from_channel, to_channel) select public.current_channel(), p_to where public.current_channel() is not null;
  delete from core.raid_log where created_at < now() - interval '90 days';
$$;
revoke execute on function public.raid_logged(uuid) from public, anon, authenticated;

-- twitch-eventsub channel.raid: Kommt der Raid aus dem Netzwerk? Dann Name und Kurztext für die Begrüßung.
create or replace function public.raid_welcome(p_from_twitch_id text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('display_name', coalesce(nullif(c.display_name, ''), c.login), 'login', c.login, 'note', n.note)
  from public.channels c
  join core.raid_network n on n.channel_id = c.id and n.enabled
  join core.raid_network me on me.channel_id = public.current_channel() and me.enabled and me.welcome
  where c.twitch_id = p_from_twitch_id and c.status = 'active' and c.id <> public.current_channel()
  limit 1;
$$;
revoke execute on function public.raid_welcome(text) from public, anon, authenticated;

-- ---------- Freunde werben ----------
create table if not exists core.referrals (
  channel_id uuid primary key references public.channels on delete cascade,   -- der geworbene Kanal
  referrer_id uuid not null references public.channels on delete cascade,      -- wer geworben hat
  created_at timestamptz not null default now(),
  check (channel_id <> referrer_id)
);
create index if not exists referrals_referrer on core.referrals (referrer_id);
alter table core.referrals enable row level security;
revoke all on core.referrals from anon, authenticated;

-- Nach der Anmeldung als Streamer: den Link merken, über den man kam (?ref=<login>). Nur für den eigenen,
-- noch nicht freigeschalteten Kanal, nur einmal und höchstens 14 Tage nach der Anmeldung.
create or replace function public.referral_claim(p_ref text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  mine public.channels;
  v_ref uuid;
begin
  if uid is null then return false; end if;
  select * into mine from public.channels where owner_id = uid;
  if mine.id is null or mine.status <> 'pending' or mine.created_at < now() - interval '14 days' then return false; end if;
  select id into v_ref from public.channels where login = lower(btrim(coalesce(p_ref, ''))) and status = 'active' and id <> mine.id;
  if v_ref is null then return false; end if;
  insert into core.referrals (channel_id, referrer_id) values (mine.id, v_ref) on conflict (channel_id) do nothing;
  return found;
end;
$$;
revoke execute on function public.referral_claim(text) from public, anon;
grant execute on function public.referral_claim(text) to authenticated;

-- Abzeichen: ab 1, 3 und 10 geworbenen Kanälen, die freigeschaltet wurden
create or replace function public.referral_badge(p_count int)
returns text language sql immutable set search_path = '' as $$
  select case when p_count >= 10 then 'botschafter' when p_count >= 3 then 'netzwerker' when p_count >= 1 then 'werber' else '' end;
$$;

create or replace function public.referral_count(p_channel uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from core.referrals r join public.channels c on c.id = r.channel_id and c.status = 'active' where r.referrer_id = p_channel;
$$;
revoke execute on function public.referral_count(uuid) from public, anon, authenticated;

-- Dashboard (Team des Kanals): eigener Link-Name, Zahl, Abzeichen, die geworbenen Kanäle
create or replace function public.referral_get()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_n int;
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  v_n := public.referral_count(v_ch);
  return json_build_object(
    'login', (select login from public.channels where id = v_ch),
    'active', v_n, 'badge', public.referral_badge(v_n),
    'pending', (select count(*) from core.referrals r join public.channels c on c.id = r.channel_id and c.status = 'pending' where r.referrer_id = v_ch),
    'channels', coalesce((select json_agg(json_build_object('login', c.login, 'display_name', c.display_name, 'avatar_url', c.avatar_url,
                            'status', c.status, 'since', r.created_at) order by r.created_at desc)
                          from core.referrals r join public.channels c on c.id = r.channel_id
                          where r.referrer_id = v_ch and c.status in ('pending', 'active')), '[]'::json));
end;
$$;
revoke execute on function public.referral_get() from public, anon;
grant execute on function public.referral_get() to authenticated;

-- Admin-Liste wie in …_channel_moderation.sql, dazu „geworben von“; geworbene Bewerbungen zuerst
create or replace function public.channels_admin()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_site_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Nur für den Plattform-Admin.';
  end if;
  return (select coalesce(json_agg(json_build_object(
      'id', c.id, 'login', c.login, 'display_name', c.display_name, 'avatar_url', c.avatar_url,
      'status', c.status, 'is_default', c.is_default, 'note', c.note, 'admin_note', c.admin_note,
      'created_at', c.created_at, 'approved_at', c.approved_at,
      'owner', coalesce((select username from public.profiles where id = c.owner_id), ''),
      'connected', exists (select 1 from core.twitch_connection t where t.channel_id = c.id),
      'blocked_until', case when c.blocked_until > now() then c.blocked_until end,
      'overlay_off_until', case when c.overlay_off_until > now() then c.overlay_off_until end,
      'overlay_off_reason', c.overlay_off_reason,
      'warning', nullif(c.warning, ''), 'warning_at', c.warning_at, 'warning_seen_at', c.warning_seen_at,
      'referred_by', (select coalesce(nullif(rc.display_name, ''), rc.login) from core.referrals r join public.channels rc on rc.id = r.referrer_id where r.channel_id = c.id),
      'referrals', public.referral_count(c.id))
    order by (c.status = 'pending') desc, (c.status = 'pending' and exists (select 1 from core.referrals r where r.channel_id = c.id)) desc, c.created_at desc), '[]'::json)
    from public.channels c);
end;
$$;

-- Öffentliches Profil wie in …_brand_color.sql, dazu das Werber-Abzeichen
create or replace function public.public_profile(p_login text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'login', c.login, 'display_name', c.display_name, 'avatar_url', c.avatar_url,
    'live', coalesce(g.live_at > now() - interval '15 minutes', false),
    'category', case when g.live_at > now() - interval '15 minutes' then left(coalesce(g.live_category, ''), 60) else '' end,
    'bio', cp.bio, 'links', cp.links, 'tz', cp.tz, 'accent', cp.accent,
    'away_until', case when cp.away_until >= (now() at time zone cp.tz)::date then cp.away_until end,
    'away_note', case when cp.away_until >= (now() at time zone cp.tz)::date then cp.away_note else '' end,
    'slots', coalesce((select json_agg(json_build_object('weekday', s.weekday, 'start', to_char(s.start_time, 'HH24:MI'),
                        'minutes', s.minutes, 'title', s.title, 'game', s.game) order by s.weekday, s.start_time)
                       from core.stream_schedule s where s.channel_id = c.id), '[]'::json),
    'upcoming', public.schedule_upcoming(c.id, 8),
    'badge', public.referral_badge(public.referral_count(c.id)))
  from public.channels c
  join core.channel_profile cp on cp.channel_id = c.id and cp.is_public
  left join core.stream_games g on g.channel_id = c.id and g.id = 1
  where c.status = 'active' and c.login = lower(btrim(coalesce(p_login, '')))
  limit 1;
$$;
grant execute on function public.public_profile(text) to anon, authenticated;

notify pgrst, 'reload schema';
