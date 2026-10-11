-- ============================================================
-- StreamHelp: Kanäle moderieren (Plattform-Admin)
--   · Timeout: Kanal auf Zeit sperren (15 Min bis 30 Tage). Solange ist er für Zuschauer, Overlay, Panel und
--     Chat-Bot weg wie ein gesperrter Kanal – danach automatisch wieder da (keine Aufräum-Aufgabe nötig:
--     alle Prüfungen vergleichen mit der Uhrzeit). Dauerhaft sperren gibt es schon (Status „blocked“).
--   · OBS-Overlay auf Zeit aus: Das Overlay des Kanals zeigt nichts (leeres Bild, kein Ton), der Rest läuft.
--   · Verwarnung: Text, den der Streamer im Dashboard sieht, bis er „Verstanden“ klickt.
--   · Notfall-Schalter für alle Kanäle: alle Overlays aus und/oder Chat-Bot still – auf Zeit oder bis zum
--     Aufheben (platform_state).
--   · Updates: Wartungsmodus (Hinweis in Dashboard, Overlays auf Wunsch leer), „Alle neu laden“ (offene
--     Overlays und Dashboards holen sich die neue Version) und „Was ist neu“ – Neuigkeiten, die Streamer und
--     ihre Mods einmal im Dashboard sehen (platform_updates).
-- Ausführen darf das nur der Plattform-Admin (Admin-Bereich → Edge Function admin, Service-Rolle).
-- Braucht 20261109000000_chat_bot_plus.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.bot_settings') is null then
    raise exception 'Erst die Migration 20261109000000_chat_bot_plus.sql ausführen.';
  end if;
end;
$$;

alter table public.channels add column if not exists blocked_until timestamptz;        -- Timeout bis
alter table public.channels add column if not exists overlay_off_until timestamptz;    -- Overlay aus bis
alter table public.channels add column if not exists overlay_off_reason text not null default '';
alter table public.channels add column if not exists warning text not null default '';
alter table public.channels add column if not exists warning_at timestamptz;
alter table public.channels add column if not exists warning_seen_at timestamptz;
alter table public.channels drop constraint if exists channels_overlay_off_reason_check;
alter table public.channels add constraint channels_overlay_off_reason_check check (char_length(overlay_off_reason) <= 300);
alter table public.channels drop constraint if exists channels_warning_check;
alter table public.channels add constraint channels_warning_check check (char_length(warning) <= 500);

-- Ist der Kanal gerade offen? (freigeschaltet und nicht im Timeout)
create or replace function public.channel_open(c public.channels)
returns boolean language sql stable set search_path = '' as $$
  select c.status = 'active' and (c.blocked_until is null or c.blocked_until <= now());
$$;

-- ---------- Notfall-Schalter (eine Zeile für die ganze Plattform) ----------
create table if not exists public.platform_state (
  id int primary key default 1 check (id = 1),
  overlays_off boolean not null default false,
  overlays_until timestamptz,          -- null = bis zum Aufheben
  overlays_reason text not null default '' check (char_length(overlays_reason) <= 300),
  bots_off boolean not null default false,
  bots_until timestamptz,
  bots_reason text not null default '' check (char_length(bots_reason) <= 300),
  updated_at timestamptz not null default now()
);
insert into public.platform_state (id) values (1) on conflict (id) do nothing;
alter table public.platform_state add column if not exists reload_at timestamptz;          -- „Alle neu laden“
alter table public.platform_state add column if not exists maint_on boolean not null default false;
alter table public.platform_state add column if not exists maint_until timestamptz;
alter table public.platform_state add column if not exists maint_message text not null default '';
alter table public.platform_state add column if not exists maint_overlays_off boolean not null default false;
alter table public.platform_state drop constraint if exists platform_state_maint_message_check;
alter table public.platform_state add constraint platform_state_maint_message_check check (char_length(maint_message) <= 300);
alter table public.platform_state enable row level security;
revoke all on public.platform_state from anon, authenticated;

create or replace function public.platform_overlays_off()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select overlays_off and (overlays_until is null or overlays_until > now()) from public.platform_state where id = 1), false);
$$;
create or replace function public.platform_bots_off()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select bots_off and (bots_until is null or bots_until > now()) from public.platform_state where id = 1), false);
$$;
create or replace function public.platform_maint_on()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select maint_on and (maint_until is null or maint_until > now()) from public.platform_state where id = 1), false);
$$;
revoke execute on function public.platform_maint_on() from public, anon, authenticated;
revoke execute on function public.platform_overlays_off() from public, anon, authenticated;
revoke execute on function public.platform_bots_off() from public, anon, authenticated;

-- ---------- Kanal dieser Anfrage: Timeout zählt wie gesperrt ----------
-- Unverändert aus …_platform.sql bis auf channel_open statt status = 'active'.
create or replace function public.current_channel()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v text := nullif(btrim(current_setting('app.channel', true)), '');
  c public.channels;
begin
  if v is not null then return v::uuid; end if;
  begin
    v := nullif(btrim(nullif(current_setting('request.headers', true), '')::json ->> 'x-channel'), '');
  exception when others then
    v := null;
  end;
  if v is null then return public.default_channel(); end if;
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into c from public.channels where id = v::uuid;
  else
    select * into c from public.channels where login = lower(v);
  end if;
  if c.id is null then return null; end if;
  if public.channel_open(c)
     or (c.status = 'pending' and c.owner_id is not null and c.owner_id = auth.uid())
     or public.is_site_admin()
     or coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return c.id;
  end if;
  return null;
end;
$$;

create or replace function public.channels_list()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(public.channel_public(c) order by c.is_default desc, lower(c.display_name)), '[]'::json)
  from public.channels c where public.channel_open(c);
$$;

create or replace function public.channel_info(p_key text default null)
returns json language sql stable security definer set search_path = '' as $$
  select public.channel_public(c) from public.channels c
  where case
      when nullif(btrim(p_key), '') is null then c.is_default
      when p_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then c.id = p_key::uuid
      else c.login = lower(btrim(p_key)) end
    and (public.channel_open(c) or (c.owner_id is not null and c.owner_id = auth.uid()) or public.is_site_admin());
$$;

-- EventSub: Kanal im Timeout bekommt nichts (Alerts, Chat-Bot, Kanalpunkte ruhen)
create or replace function public.channel_by_twitch(p_twitch_id text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.channels c where c.twitch_id = p_twitch_id and public.channel_open(c);
$$;

create or replace function public.showcase_list()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(x order by x.live desc, lower(x.display_name)), '[]'::json) from (
    select c.login, c.display_name, c.avatar_url,
      coalesce(g.live_at > now() - interval '15 minutes', false) as live,
      case when g.live_at > now() - interval '15 minutes' then left(coalesce(g.live_category, ''), 60) else '' end as category
    from public.channels c
    left join core.stream_games g on g.channel_id = c.id and g.id = 1
    where public.channel_open(c) and c.showcase and c.login is not null
    limit 48
  ) x;
$$;

-- Mein Kanal: dazu Timeout, Overlay-Pause und Verwarnung (das Dashboard zeigt sie an)
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
    'warning_open', c.warning <> '' and (c.warning_seen_at is null or c.warning_seen_at < c.warning_at))
  from public.channels c where auth.uid() is not null and c.owner_id = auth.uid();
$$;

-- Streamer: Verwarnung gelesen
create or replace function public.channel_warning_seen()
returns void language sql security definer set search_path = '' as $$
  update public.channels set warning_seen_at = now() where auth.uid() is not null and owner_id = auth.uid();
$$;
revoke execute on function public.channel_warning_seen() from public, anon;
grant execute on function public.channel_warning_seen() to authenticated;

-- ---------- Overlay: darf es gerade etwas zeigen? (ohne Anmeldung, je Kanal aus dem Header) ----------
create or replace function public.overlay_gate()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  c public.channels;
  p public.platform_state;
begin
  select * into p from public.platform_state where id = 1;
  if public.platform_overlays_off() then
    return json_build_object('off', true, 'until', p.overlays_until, 'by', 'platform', 'reload_at', p.reload_at);
  end if;
  if public.platform_maint_on() and p.maint_overlays_off then
    return json_build_object('off', true, 'until', p.maint_until, 'by', 'maintenance', 'reload_at', p.reload_at);
  end if;
  if v_ch is not null then
    select * into c from public.channels where id = v_ch;
    if c.overlay_off_until > now() then
      return json_build_object('off', true, 'until', c.overlay_off_until, 'by', 'channel', 'reload_at', p.reload_at);
    end if;
  end if;
  return json_build_object('off', false, 'reload_at', p.reload_at);
end;
$$;
revoke execute on function public.overlay_gate() from public;
grant execute on function public.overlay_gate() to anon, authenticated, service_role;

-- Edge Functions: ist der Chat-Bot plattformweit still?
create or replace function public.bot_gate()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('off', public.platform_bots_off());
$$;
revoke execute on function public.bot_gate() from public, anon, authenticated;
grant execute on function public.bot_gate() to service_role;

-- Dashboard: alle 60 s – neu laden? Wartung? (ohne Anmeldung lesbar, nichts Geheimes)
create or replace function public.platform_ping()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('reload_at', p.reload_at,
    'maintenance', case when public.platform_maint_on() then json_build_object('until', p.maint_until, 'message', p.maint_message,
      'overlays_off', p.maint_overlays_off) end)
  from public.platform_state p where p.id = 1;
$$;
revoke execute on function public.platform_ping() from public;
grant execute on function public.platform_ping() to anon, authenticated;

-- ---------- „Was ist neu“: Neuigkeiten für Streamer und ihre Mods ----------
create table if not exists public.platform_updates (
  id bigint generated always as identity primary key,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
alter table public.platform_updates enable row level security;
revoke all on public.platform_updates from anon, authenticated;

create table if not exists public.platform_update_reads (
  user_id uuid not null references auth.users on delete cascade,
  update_id bigint not null references public.platform_updates on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, update_id)
);
alter table public.platform_update_reads enable row level security;
revoke all on public.platform_update_reads from anon, authenticated;

-- Wer bekommt sie? Inhaber eines Kanals und alle, die im aktuellen Kanal Streamer-/Mod-Rechte haben
create or replace function public.platform_updates_for_me()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists (select 1 from public.channels where owner_id = auth.uid()) or public.is_admin());
$$;
revoke execute on function public.platform_updates_for_me() from public, anon, authenticated;

-- Die letzten Neuigkeiten (180 Tage, höchstens 10) mit „gelesen“
create or replace function public.platform_updates_mine()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', u.id, 'title', u.title, 'body', u.body, 'created_at', u.created_at,
           'read', exists (select 1 from public.platform_update_reads r where r.update_id = u.id and r.user_id = auth.uid()))
         order by u.id desc), '[]'::json)
  from (select * from public.platform_updates where created_at > now() - interval '180 days' order by id desc limit 10) u
  where public.platform_updates_for_me();
$$;
revoke execute on function public.platform_updates_mine() from public, anon;
grant execute on function public.platform_updates_mine() to authenticated;

-- Gelesen: eine (p_id) oder alle (null)
create or replace function public.platform_updates_read(p_id bigint default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.platform_update_reads (user_id, update_id)
  select auth.uid(), u.id from public.platform_updates u
   where auth.uid() is not null and public.platform_updates_for_me() and (p_id is null or u.id = p_id)
  on conflict do nothing;
$$;
revoke execute on function public.platform_updates_read(bigint) from public, anon;
grant execute on function public.platform_updates_read(bigint) to authenticated;

-- ---------- Plattform-Admin ----------
create or replace function public.platform_state_get()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  p public.platform_state;
begin
  if not (public.is_site_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Nur für den Plattform-Admin.';
  end if;
  select * into p from public.platform_state where id = 1;
  return json_build_object(
    'overlays_off', public.platform_overlays_off(), 'overlays_until', case when public.platform_overlays_off() then p.overlays_until end,
    'overlays_reason', p.overlays_reason,
    'bots_off', public.platform_bots_off(), 'bots_until', case when public.platform_bots_off() then p.bots_until end,
    'bots_reason', p.bots_reason,
    'maint_on', public.platform_maint_on(), 'maint_until', case when public.platform_maint_on() then p.maint_until end,
    'maint_message', p.maint_message, 'maint_overlays_off', p.maint_overlays_off,
    'reload_at', p.reload_at, 'updated_at', p.updated_at,
    'updates', (select coalesce(json_agg(json_build_object('id', u.id, 'title', u.title, 'body', u.body, 'created_at', u.created_at,
                  'reads', (select count(*) from public.platform_update_reads r where r.update_id = u.id)) order by u.id desc), '[]'::json)
                from (select * from public.platform_updates order by id desc limit 30) u));
end;
$$;
revoke execute on function public.platform_state_get() from public, anon;
grant execute on function public.platform_state_get() to authenticated;

-- p_what: overlays oder bots. p_minutes: > 0 auf Zeit, null = bis zum Aufheben, 0 = aufheben.
create or replace function public.platform_switch(p_what text, p_minutes int, p_reason text default '')
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_on boolean := p_minutes is null or p_minutes > 0;
  v_until timestamptz := case when p_minutes > 0 then now() + make_interval(mins => least(p_minutes, 60 * 24 * 30)) end;
  v_reason text := left(btrim(coalesce(p_reason, '')), 300);
begin
  if not (public.is_site_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Nur für den Plattform-Admin.';
  end if;
  if p_what = 'overlays' then
    update public.platform_state set overlays_off = v_on, overlays_until = v_until,
      overlays_reason = case when v_on then v_reason else '' end, updated_at = now() where id = 1;
  elsif p_what = 'bots' then
    update public.platform_state set bots_off = v_on, bots_until = v_until,
      bots_reason = case when v_on then v_reason else '' end, updated_at = now() where id = 1;
  else
    raise exception 'Unbekannter Schalter.';
  end if;
  return public.platform_state_get();
end;
$$;
revoke execute on function public.platform_switch(text, int, text) from public, anon;
grant execute on function public.platform_switch(text, int, text) to authenticated;

-- Wartungsmodus: p_minutes > 0 auf Zeit, null = bis zum Aufheben, 0 = aus. Overlays wahlweise leer.
create or replace function public.platform_maintenance(p_minutes int, p_message text default '', p_overlays_off boolean default false)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_on boolean := p_minutes is null or p_minutes > 0;
begin
  if not (public.is_site_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Nur für den Plattform-Admin.';
  end if;
  update public.platform_state set maint_on = v_on,
    maint_until = case when p_minutes > 0 then now() + make_interval(mins => least(p_minutes, 60 * 24 * 7)) end,
    maint_message = case when v_on then left(btrim(coalesce(p_message, '')), 300) else '' end,
    maint_overlays_off = v_on and coalesce(p_overlays_off, false),
    -- Ende der Wartung: alle laden die neue Version
    reload_at = case when not v_on and maint_on then now() else reload_at end,
    updated_at = now()
  where id = 1;
  return public.platform_state_get();
end;
$$;
revoke execute on function public.platform_maintenance(int, text, boolean) from public, anon;
grant execute on function public.platform_maintenance(int, text, boolean) to authenticated;

-- Alle offenen Overlays und Dashboards laden neu (holen sich die neue Version)
create or replace function public.platform_reload()
returns json language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_site_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Nur für den Plattform-Admin.';
  end if;
  update public.platform_state set reload_at = now(), updated_at = now() where id = 1;
  return public.platform_state_get();
end;
$$;
revoke execute on function public.platform_reload() from public, anon;
grant execute on function public.platform_reload() to authenticated;

-- Neuigkeit veröffentlichen oder löschen
create or replace function public.platform_update_post(p_title text, p_body text)
returns json language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_site_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Nur für den Plattform-Admin.';
  end if;
  insert into public.platform_updates (title, body) values (btrim(coalesce(p_title, '')), btrim(coalesce(p_body, '')));
  return public.platform_state_get();
end;
$$;
revoke execute on function public.platform_update_post(text, text) from public, anon;
grant execute on function public.platform_update_post(text, text) to authenticated;

create or replace function public.platform_update_delete(p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_site_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Nur für den Plattform-Admin.';
  end if;
  delete from public.platform_updates where id = p_id;
  return public.platform_state_get();
end;
$$;
revoke execute on function public.platform_update_delete(bigint) from public, anon;
grant execute on function public.platform_update_delete(bigint) to authenticated;

-- Einen oder mehrere Kanäle moderieren.
--   timeout (p_minutes 15 … 43200, Grund sieht der Streamer) · untimeout
--   overlay_off (p_minutes, null = bis zum Aufheben) · overlay_on
--   warn (Text = p_reason) · unwarn
-- Der Standard-Kanal bekommt keinen Timeout. Liefert die Kanal-Liste wie channels_admin.
create or replace function public.channel_moderate(p_channels uuid[], p_action text, p_minutes int default null, p_reason text default '')
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  n int;
begin
  if not (public.is_site_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Nur für den Plattform-Admin.';
  end if;
  if coalesce(cardinality(p_channels), 0) = 0 then raise exception 'Keinen Kanal ausgewählt.'; end if;
  if cardinality(p_channels) > 500 then raise exception 'Zu viele Kanäle auf einmal.'; end if;
  if p_action = 'timeout' then
    if p_minutes is null or p_minutes < 15 or p_minutes > 60 * 24 * 30 then
      raise exception 'Timeout: 15 Minuten bis 30 Tage.';
    end if;
    update public.channels set blocked_until = now() + make_interval(mins => p_minutes),
      admin_note = case when v_reason <> '' then left(v_reason, 300) else admin_note end
     where id = any(p_channels) and not is_default;
  elsif p_action = 'untimeout' then
    update public.channels set blocked_until = null where id = any(p_channels);
  elsif p_action = 'overlay_off' then
    if p_minutes is not null and (p_minutes < 1 or p_minutes > 60 * 24 * 30) then
      raise exception 'Overlay aus: 1 Minute bis 30 Tage (oder bis zum Aufheben).';
    end if;
    update public.channels set overlay_off_until = coalesce(now() + make_interval(mins => p_minutes), '9999-12-31 00:00:00+00'::timestamptz),
      overlay_off_reason = left(v_reason, 300)
     where id = any(p_channels);
  elsif p_action = 'overlay_on' then
    update public.channels set overlay_off_until = null, overlay_off_reason = '' where id = any(p_channels);
  elsif p_action = 'warn' then
    if v_reason = '' then raise exception 'Bitte einen Text für die Verwarnung eingeben.'; end if;
    update public.channels set warning = v_reason, warning_at = now(), warning_seen_at = null where id = any(p_channels);
  elsif p_action = 'unwarn' then
    update public.channels set warning = '', warning_at = null, warning_seen_at = null where id = any(p_channels);
  else
    raise exception 'Unbekannte Aktion.';
  end if;
  get diagnostics n = row_count;
  return public.channels_admin();
end;
$$;
revoke execute on function public.channel_moderate(uuid[], text, int, text) from public, anon;
grant execute on function public.channel_moderate(uuid[], text, int, text) to authenticated;

-- Kanal-Liste für den Admin-Bereich: dazu Timeout, Overlay-Pause und Verwarnung
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
      'warning', nullif(c.warning, ''), 'warning_at', c.warning_at, 'warning_seen_at', c.warning_seen_at)
    order by (c.status = 'pending') desc, c.created_at desc), '[]'::json)
    from public.channels c);
end;
$$;

notify pgrst, 'reload schema';
