-- Schneller und für mehr Streamer:
--   1) Sofort-Alerts: twitch-eventsub schickt jeden Alert zusätzlich per Realtime-Broadcast (Thema
--      alerts:<Kanal-ID>, privat). Lesen darf jeder (das Overlay hat keinen Login), senden nur der Server.
--   2) Kanäle ohne Affiliate/Partner: Twitch-Status (broadcaster_type) am Kanal – die Seite zeigt bei
--      Kanalpunkten, Abos, Bits und Vorhersagen einen Hinweis statt Fehlern.
--   3) YouTube verbinden: Zugang (geheim, nur Edge Functions), Einstellungen (mit Twitch live gehen
--      und beenden) und die laufende Sendung (Video-ID für den kombinierten Chat, ohne Suchen).
-- Ohne diese Migration läuft alles wie bisher (Alerts über die Tabelle, kein YouTube-Abgleich).

-- ---------- 1) Sofort-Alerts ----------
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "alerts: sofort lesen" on realtime.messages';
    execute $p$create policy "alerts: sofort lesen" on realtime.messages for select to anon, authenticated
      using (realtime.messages.extension = 'broadcast' and (select realtime.topic()) like 'alerts:%')$p$;
  end if;
end;
$$;

-- ---------- 2) Affiliate ----------
-- '' = normaler Kanal, 'affiliate', 'partner'; null = noch nicht bekannt (gilt wie Affiliate – nichts sperren)
alter table public.channels add column if not exists broadcaster_type text
  check (broadcaster_type is null or broadcaster_type in ('', 'affiliate', 'partner'));

create or replace function public.channel_public(c public.channels)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('id', c.id, 'login', c.login, 'display_name', c.display_name,
    'avatar_url', c.avatar_url, 'is_default', c.is_default, 'status', c.status,
    'is_owner', c.owner_id is not null and c.owner_id = auth.uid(),
    'affiliate', case when c.broadcaster_type is null then null else c.broadcaster_type <> '' end);
$$;
revoke execute on function public.channel_public(public.channels) from public, anon, authenticated;

-- Mein Kanal: dazu, ob Twitch schon verbunden ist (Anmelden und Verbinden sind jetzt ein Schritt –
-- wer auf Twitch abbricht, bekommt den Knopf noch einmal angeboten)
create or replace function public.channel_mine()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('id', c.id, 'login', c.login, 'display_name', c.display_name, 'avatar_url', c.avatar_url,
    'status', c.status, 'is_default', c.is_default, 'note', c.note, 'admin_note', c.admin_note,
    'created_at', c.created_at, 'approved_at', c.approved_at,
    'blocked_until', case when c.blocked_until > now() then c.blocked_until end,
    'overlay_off_until', case when c.overlay_off_until > now() then c.overlay_off_until end,
    'overlay_off_reason', case when c.overlay_off_until > now() then c.overlay_off_reason end,
    'platform_overlays_off', public.platform_overlays_off(),
    'warning', nullif(c.warning, ''), 'warning_at', c.warning_at,
    'warning_open', c.warning <> '' and (c.warning_seen_at is null or c.warning_seen_at < c.warning_at),
    'twitch_connected', exists (select 1 from core.twitch_connection t where t.channel_id = c.id),
    'affiliate', case when c.broadcaster_type is null then null else c.broadcaster_type <> '' end)
  from public.channels c where auth.uid() is not null and c.owner_id = auth.uid();
$$;

-- ---------- 3) YouTube ----------
-- Zugang zum YouTube-Kanal des Streamers (Google-Login mit Recht „youtube“). Geheim: nur die Service-Rolle.
create table if not exists core.youtube_connection (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  id int not null default 1 check (id = 1),
  yt_channel_id text not null,
  yt_title text not null default '',
  yt_handle text not null default '',
  access_token text,
  refresh_token text not null,
  expires_at timestamptz,
  -- Stream-Schlüssel, an den die Sendung gebunden wird (von StreamHelp angelegt: „StreamHelp“)
  stream_id text,
  -- Mit Twitch live gehen / beenden, YouTube-Chat im Overlay dazu, Sichtbarkeit neuer Sendungen
  auto_start boolean not null default false,
  auto_stop boolean not null default false,
  chat_merge boolean not null default true,
  privacy text not null default 'public' check (privacy in ('public', 'unlisted', 'private')),
  connected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (channel_id, id)
);
alter table core.youtube_connection enable row level security;
revoke all on core.youtube_connection from anon, authenticated;
select public.channel_view('youtube_connection');
revoke all on public.youtube_connection from anon, authenticated;

-- Die Sendung auf YouTube (für das Overlay: welcher Chat gehört dazu?). Lesen darf jeder – die Video-ID
-- ist ohnehin öffentlich, sobald die Sendung läuft. Schreiben nur die Edge Functions.
create table if not exists core.youtube_live (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  id int not null default 1 check (id = 1),
  video_id text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$'),
  status text not null default 'idle' check (status in ('idle', 'starting', 'live', 'ended', 'error')),
  chat_merge boolean not null default true,
  message text not null default '',
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (channel_id, id)
);
alter table core.youtube_live enable row level security;
drop policy if exists "youtube_live: lesen für alle" on core.youtube_live;
create policy "youtube_live: lesen für alle" on core.youtube_live for select to anon, authenticated using (true);
revoke all on core.youtube_live from anon, authenticated;
grant select on core.youtube_live to anon, authenticated;
select public.channel_view('youtube_live');
revoke insert, update, delete on public.youtube_live from anon, authenticated;
select public.realtime_add('youtube_live');

-- Google-Login für YouTube läuft über dieselben OAuth-Anfragen wie Twitch
alter table public.oauth_states drop constraint if exists oauth_states_kind_check;
alter table public.oauth_states add constraint oauth_states_kind_check check (kind in ('broadcaster', 'bot', 'youtube'));

-- Stand für das Dashboard (Streamer und freigegebene Mods) – ohne Tokens
create or replace function public.youtube_status()
returns json language sql stable security definer set search_path = '' as $$
  select case when not public.is_admin() then json_build_object('connected', false, 'allowed', false)
  else coalesce(
    (select json_build_object('connected', true, 'allowed', true, 'can_edit', public.is_owner(),
       'title', y.yt_title, 'handle', nullif(y.yt_handle, ''), 'yt_channel_id', y.yt_channel_id,
       'stream_ready', y.stream_id is not null,
       'auto_start', y.auto_start, 'auto_stop', y.auto_stop, 'chat_merge', y.chat_merge, 'privacy', y.privacy,
       'live', (select json_build_object('video_id', l.video_id, 'status', l.status, 'message', nullif(l.message, ''),
                                         'started_at', l.started_at, 'ended_at', l.ended_at)
                from core.youtube_live l where l.channel_id = y.channel_id and l.id = 1))
     from core.youtube_connection y where y.channel_id = public.current_channel() and y.id = 1),
    json_build_object('connected', false, 'allowed', true, 'can_edit', public.is_owner()))
  end;
$$;
revoke execute on function public.youtube_status() from public, anon;
grant execute on function public.youtube_status() to authenticated;

-- Einstellungen ändern: nur der Streamer selbst (und der Plattform-Admin)
create or replace function public.youtube_settings_save(p jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if not public.is_owner() then raise exception 'Nur der Streamer selbst ändert die YouTube-Einstellungen.'; end if;
  if not exists (select 1 from core.youtube_connection where channel_id = v_ch and id = 1) then
    raise exception 'YouTube ist noch nicht verbunden.';
  end if;
  if p ? 'privacy' and p ->> 'privacy' not in ('public', 'unlisted', 'private') then
    raise exception 'Sichtbarkeit: public, unlisted oder private.';
  end if;
  update core.youtube_connection set
    auto_start = coalesce((p ->> 'auto_start')::boolean, auto_start),
    auto_stop = coalesce((p ->> 'auto_stop')::boolean, auto_stop),
    chat_merge = coalesce((p ->> 'chat_merge')::boolean, chat_merge),
    privacy = coalesce(p ->> 'privacy', privacy),
    updated_at = now()
  where channel_id = v_ch and id = 1;
  -- Das Overlay liest nur youtube_live: dort steht, ob der YouTube-Chat dazukommt
  insert into core.youtube_live (channel_id, id, chat_merge)
    select v_ch, 1, y.chat_merge from core.youtube_connection y where y.channel_id = v_ch and y.id = 1
  on conflict (channel_id, id) do update set chat_merge = excluded.chat_merge, updated_at = now();
  return public.youtube_status();
end;
$$;
revoke execute on function public.youtube_settings_save(jsonb) from public, anon;
grant execute on function public.youtube_settings_save(jsonb) to authenticated;

-- Audit-Protokoll: Einstellungen festhalten (die Sendung schreibt nur der Server)
do $$
begin
  if to_regprocedure('core.audit_row()') is not null then
    drop trigger if exists zz_audit on core.youtube_connection;
    create trigger zz_audit after insert or update or delete on core.youtube_connection for each row execute function core.audit_row();
    drop trigger if exists zz_audit on core.youtube_live;
  end if;
end;
$$;

notify pgrst, 'reload schema';
