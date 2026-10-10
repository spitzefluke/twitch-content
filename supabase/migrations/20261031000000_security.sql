-- ============================================================
-- StreamHelp: Sicherheits-Paket
--   1. Härtung (Ergebnis des Supabase-Checks): Tabellen mit Geheimnissen (Twitch-Tokens,
--      Quiz-/Pausen-Lösungen, OAuth-Anfragen …) haben keine Tabellenrechte mehr für anon und
--      authenticated – bisher schützte sie allein Row Level Security ohne Policy.
--      is_site_admin_user() ist nicht mehr öffentlich aufrufbar.
--   2. Rate-Limits: rate_hit() für die Edge Functions und eine Grenze für alle schreibenden
--      API-Anfragen der Webseite (PostgREST „db-pre-request“: api_guard(), 300 je Minute und
--      Konto bzw. IP-Adresse).
--   3. Zwei-Faktor-Anmeldung: Hat ein Konto 2FA eingerichtet, gelten Streamer-, Mod- und
--      Admin-Rechte nur nach bestätigtem Code (Sitzung „aal2“) – ein geklautes Passwort reicht nicht.
--   4. Feinere Mod-Rechte: Der Streamer sperrt je Mod einzelne Bereiche (core.mod_rights).
--      Welcher Bereich gemeint ist, ergibt sich aus der Anfrage (Funktion bzw. Tabelle).
--   5. Mod-Protokoll: Wer mit Streamer-/Mod-Rechten etwas ändert, landet in core.audit_log
--      (90 Tage). Zuschauer-Aktionen werden nicht protokolliert.
--   6. Sitzungen: eigene Anmeldungen ansehen und einzeln beenden.
--   7. Export: alle Daten des eigenen Kanals als JSON (ohne Tokens und Lösungen).
--   8. Sicherheits-Check für den Plattform-Admin (security_report).
-- Braucht 20261028000000_platform.sql. Mehrfach ausführbar.
-- Wird …_platform.sql später noch einmal ausgeführt, überschreibt sie die Rechte-Funktionen
-- (is_admin_of, is_owner …) – danach diese Datei einfach erneut ausführen.
--
-- Rate-Limit wieder ausschalten (falls nötig):
--   alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';
-- ============================================================

do $$
begin
  if to_regclass('public.channels') is null then
    raise exception 'Erst die Plattform-Migration 20261028000000_platform.sql ausführen.';
  end if;
end;
$$;

-- ============================================================
-- 1. Härtung
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'core.twitch_connection', 'core.pause_secret', 'core.quiz_secret', 'core.bot_outbox',
    'public.twitch_connection', 'public.pause_secret', 'public.quiz_secret', 'public.bot_outbox',
    'public.twitch_bot', 'public.oauth_states', 'public.admin_login_failures'] loop
    if to_regclass(t) is not null then
      execute format('revoke all on %s from anon, authenticated', t);
    end if;
  end loop;
end;
$$;
revoke execute on function public.is_site_admin_user(uuid) from public, anon, authenticated;

-- ============================================================
-- 2. Rate-Limits
-- ============================================================
-- Zähler je Schlüssel und Zeitfenster. unlogged: schnell, geht bei einem Neustart verloren (egal).
create unlogged table if not exists public.rate_hits (
  key text not null,
  bucket timestamptz not null,
  n int not null default 1,
  primary key (key, bucket)
);
alter table public.rate_hits enable row level security;
revoke all on public.rate_hits from anon, authenticated;

-- true: noch erlaubt. p_window in Sekunden (feste Fenster).
create or replace function public.rate_hit(p_key text, p_max int, p_window int default 60)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  w int := greatest(coalesce(p_window, 60), 1);
  b timestamptz := to_timestamp(floor(extract(epoch from now()) / w) * w);
  v int;
begin
  insert into public.rate_hits (key, bucket) values (left(coalesce(p_key, ''), 200), b)
    on conflict (key, bucket) do update set n = public.rate_hits.n + 1
    returning n into v;
  if random() < 0.01 then
    delete from public.rate_hits where bucket < now() - interval '1 day';
  end if;
  return v <= p_max;
end;
$$;
revoke execute on function public.rate_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_hit(text, int, int) to service_role;

-- Läuft vor jeder API-Anfrage (PostgREST db-pre-request). Nur schreibende Anfragen zählen
-- (POST/PATCH/DELETE), die Edge Functions (Service-Rolle) gar nicht. Ist die Prüfung selbst
-- kaputt, lässt sie die Anfrage durch – sie darf die Seite nie lahmlegen.
create or replace function public.api_guard()
returns void language plpgsql security definer set search_path = '' as $$
declare
  m text := upper(coalesce(current_setting('request.method', true), ''));
  h json;
  who text;
  ip text;
begin
  if m in ('', 'GET', 'HEAD', 'OPTIONS') then return; end if;
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return; end if;
  who := auth.uid()::text;
  if who is null then
    begin
      h := nullif(current_setting('request.headers', true), '')::json;
    exception when others then
      h := null;
    end;
    ip := coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1));
    who := 'ip:' || coalesce(nullif(btrim(ip), ''), 'unbekannt');
  end if;
  if not public.rate_hit('api:' || who, 300, 60) then
    raise sqlstate 'PT429' using message = 'Zu viele Anfragen – bitte kurz warten.';
  end if;
exception
  when sqlstate 'PT429' then raise;
  when others then return;
end;
$$;
revoke execute on function public.api_guard() from public;
grant execute on function public.api_guard() to anon, authenticated, service_role;

do $$
begin
  execute 'alter role authenticator set pgrst.db_pre_request to ''public.api_guard''';
exception when others then
  raise warning 'Rate-Limit für die API nicht aktiviert (%). Die Edge Functions begrenzen trotzdem.', sqlerrm;
end;
$$;
notify pgrst, 'reload config';

-- ============================================================
-- 3. Zwei-Faktor-Anmeldung
-- ============================================================
-- true: Diese Anfrage darf Rechte nutzen. Ohne eingerichtete 2FA immer; mit 2FA nur, wenn
-- der Code in dieser Sitzung bestätigt wurde (aal2). Ohne Anmeldung (anon, Edge Functions)
-- ebenfalls true – dort entscheiden die anderen Prüfungen.
create or replace function public.mfa_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is null
    or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified');
$$;
grant execute on function public.mfa_ok() to anon, authenticated, service_role;

-- ============================================================
-- 4. Feinere Mod-Rechte
-- ============================================================
create or replace function public.mod_areas()
returns text[] language sql immutable set search_path = '' as $$
  select array['ideas', 'wheel', 'bingo', 'games', 'giveaway', 'pranks', 'pet', 'overlay', 'chat', 'points', 'guard'];
$$;
grant execute on function public.mod_areas() to anon, authenticated, service_role;

-- Bereich dieser Anfrage: app.area (Edge Functions über is_admin_user_in) oder die aufgerufene
-- Funktion bzw. Tabelle (PostgREST setzt request.path, z. B. /rpc/giveaway_draw oder /tiles).
-- Unbekannt (Realtime, Storage, Lesen der eigenen Rechte …): NULL – dann gilt keine Sperre.
create or replace function public.request_area()
returns text language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('app.area', true), ''), case
    when p ~ '^giveaway' then 'giveaway'
    when p ~ '^(spins?($|_)|wheel|overlay_spins)' then 'wheel'
    when p ~ '^bingo' then 'bingo'
    when p ~ '^(tiles?($|_)|ideas?($|_)|idea_votes|feature_open|games_|questions?($|_)|question_)' then 'ideas'
    when p ~ '^(quiz|shop|challenge|win_challenge|queue|cards?_|forbidden|hotword|pause)' then 'games'
    when p ~ '^(send_prank|prank|sounds($|_)|tts)' then 'pranks'
    when p ~ '^pet' then 'pet'
    when p ~ '^(overlay|alert|ticker|stream_alerts|subathon|anniversary)' then 'overlay'
    when p ~ '^(bot_|chat_)' then 'chat'
    when p ~ '^stream_reward' then 'points'
    when p ~ '^site_guard' then 'guard'
  end)
  from (select lower(regexp_replace(coalesce(current_setting('request.path', true), ''), '^/(rpc/)?', '')) as p) x;
$$;
grant execute on function public.request_area() to anon, authenticated, service_role;

create table if not exists core.mod_rights (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  twitch_user_id text not null check (twitch_user_id ~ '^[0-9]{1,20}$'),
  denied text[] not null default '{}' check (cardinality(denied) <= 20),
  updated_at timestamptz not null default now(),
  primary key (channel_id, twitch_user_id)
);
alter table core.mod_rights enable row level security;
revoke all on core.mod_rights from anon, authenticated;
-- Lesen und Ändern nur über mod_rights_list() / mod_rights_set()

-- Hat der Streamer diesem Mod den Bereich gesperrt?
create or replace function public.mod_area_denied(p_channel uuid, p_user uuid, p_area text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_area is not null and p_channel is not null and p_user is not null and exists (
    select 1 from core.mod_rights r
    join auth.identities i on i.provider = 'twitch' and i.provider_id = r.twitch_user_id
    where r.channel_id = p_channel and i.user_id = p_user and p_area = any(r.denied));
$$;
revoke execute on function public.mod_area_denied(uuid, uuid, text) from public, anon, authenticated;

-- ---------- Rechte-Funktionen neu: 2FA und Mod-Bereiche ----------
create or replace function public.is_site_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'stellwerk_site_admin')::boolean, false) and public.mfa_ok();
$$;

create or replace function public.is_mod_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select mods_enabled from public.overlay_config where id = 1), false)
    and public.is_twitch_mod_user(p_user)
    and not public.mod_area_denied(public.current_channel(), p_user, public.request_area());
$$;
revoke execute on function public.is_mod_user(uuid) from public, anon, authenticated;

create or replace function public.is_admin_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null
    -- Eigene Anfrage mit 2FA: nur nach bestätigtem Code (Edge Functions prüfen das selbst)
    and (p_user is distinct from auth.uid() or public.mfa_ok())
    and (
      public.is_site_admin_user(p_user)
      or exists (select 1 from public.channels where id = public.current_channel() and owner_id = p_user)
      or (public.current_channel() = public.default_channel()
          and coalesce((select is_admin from public.profiles where id = p_user), false))
      or public.is_mod_user(p_user)
    );
$$;
revoke execute on function public.is_admin_user(uuid) from public, anon, authenticated;

-- Edge Functions: Admin für einen bestimmten Bereich (Mods können dafür gesperrt sein)
create or replace function public.is_admin_user_in(p_user uuid, p_area text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_area is not null and not (p_area = any(public.mod_areas())) then
    raise exception 'Unbekannter Bereich %', p_area;
  end if;
  perform set_config('app.area', coalesce(p_area, ''), true);
  return public.is_admin_user(p_user);
end;
$$;
revoke execute on function public.is_admin_user_in(uuid, text) from public, anon, authenticated;
grant execute on function public.is_admin_user_in(uuid, text) to service_role;

create or replace function public.is_admin_of(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_channel is not null and public.mfa_ok() and (
    public.is_site_admin()
    or exists (select 1 from public.channels where id = p_channel and owner_id = auth.uid())
    -- Admin-Häkchen von früher: gilt nur im Standard-Kanal
    or (exists (select 1 from public.channels where id = p_channel and is_default)
        and coalesce((select is_admin from public.profiles where id = auth.uid()), false))
    -- freigegebene Mods des Kanals (ohne gesperrte Bereiche)
    or (coalesce((select mods_enabled from core.overlay_config where channel_id = p_channel and id = 1), false)
        and exists (select 1 from auth.identities i
                    join core.channel_mods m on m.twitch_user_id = i.provider_id and m.channel_id = p_channel
                    where i.user_id = auth.uid() and i.provider = 'twitch')
        and not public.mod_area_denied(p_channel, auth.uid(), public.request_area()))
  );
$$;

create or replace function public.is_owner_of(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_channel is not null and public.mfa_ok() and (
    public.is_site_admin()
    or exists (select 1 from public.channels where id = p_channel and owner_id = auth.uid())
    or exists (select 1 from core.twitch_connection where channel_id = p_channel and connected_by = auth.uid())
  );
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.mfa_ok() and (
    public.is_site_admin()
    or exists (select 1 from public.channels where id = public.current_channel() and owner_id = auth.uid())
    or exists (select 1 from public.twitch_connection where connected_by = auth.uid())
  );
$$;

-- Streamer: alle Mods mit ihren gesperrten Bereichen. Mod: nur die eigene Zeile.
create or replace function public.mod_rights_list()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
      'twitch_user_id', m.twitch_user_id, 'login', m.login, 'display_name', m.display_name,
      'denied', coalesce(r.denied, '{}'), 'updated_at', r.updated_at) order by lower(coalesce(nullif(m.display_name, ''), m.login))), '[]')
  from core.channel_mods m
  left join core.mod_rights r on r.channel_id = m.channel_id and r.twitch_user_id = m.twitch_user_id
  where m.channel_id = public.current_channel()
    and (public.is_owner_of(m.channel_id)
         or exists (select 1 from auth.identities i where i.user_id = auth.uid() and i.provider = 'twitch'
                    and i.provider_id = m.twitch_user_id));
$$;
revoke execute on function public.mod_rights_list() from public, anon;
grant execute on function public.mod_rights_list() to authenticated;

create or replace function public.mod_rights_set(p_twitch_user_id text, p_denied text[])
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_denied text[];
begin
  if not public.is_owner_of(v_ch) then
    raise exception 'Mod-Rechte vergibt nur der Streamer.';
  end if;
  if not exists (select 1 from core.channel_mods where channel_id = v_ch and twitch_user_id = p_twitch_user_id) then
    raise exception 'Diesen Mod gibt es in deinem Kanal nicht (Mods von Twitch neu holen).';
  end if;
  select coalesce(array_agg(distinct a order by a), '{}') into v_denied
    from unnest(coalesce(p_denied, '{}')) a where a = any(public.mod_areas());
  insert into core.mod_rights (channel_id, twitch_user_id, denied, updated_at)
    values (v_ch, p_twitch_user_id, v_denied, now())
  on conflict (channel_id, twitch_user_id) do update set denied = excluded.denied, updated_at = now();
  return json_build_object('twitch_user_id', p_twitch_user_id, 'denied', v_denied);
end;
$$;
revoke execute on function public.mod_rights_set(text, text[]) from public, anon;
grant execute on function public.mod_rights_set(text, text[]) to authenticated;

-- ============================================================
-- 5. Mod-Protokoll
-- ============================================================
create table if not exists core.audit_log (
  id bigint generated always as identity primary key,
  channel_id uuid not null,               -- ohne Fremdschlüssel: Einträge überleben Löschungen im selben Schritt
  at timestamptz not null default now(),
  actor uuid,
  actor_name text not null default '',
  role text not null default '' check (role in ('owner', 'mod', 'admin', '')),
  action text not null default '' check (char_length(action) <= 80),
  tables text[] not null default '{}',
  ops text[] not null default '{}',
  detail jsonb not null default '{}'
);
create index if not exists audit_log_channel_at_idx on core.audit_log (channel_id, at desc);
alter table core.audit_log enable row level security;
revoke all on core.audit_log from anon, authenticated;

-- Rolle eines Kontos im Kanal: owner, admin (Plattform/früheres Häkchen), mod – sonst NULL
create or replace function public.audit_role(p_channel uuid, p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_user is null or p_channel is null then null
    when public.is_site_admin_user(p_user) then 'admin'
    when exists (select 1 from public.channels where id = p_channel and owner_id = p_user)
      or exists (select 1 from core.twitch_connection where channel_id = p_channel and connected_by = p_user) then 'owner'
    when exists (select 1 from public.channels where id = p_channel and is_default)
      and coalesce((select is_admin from public.profiles where id = p_user), false) then 'admin'
    when coalesce((select mods_enabled from core.overlay_config where channel_id = p_channel and id = 1), false)
      and exists (select 1 from auth.identities i
                  join core.channel_mods m on m.twitch_user_id = i.provider_id and m.channel_id = p_channel
                  where i.user_id = p_user and i.provider = 'twitch') then 'mod'
  end;
$$;
revoke execute on function public.audit_role(uuid, uuid) from public, anon, authenticated;

-- Ein Eintrag je Anfrage und Kanal; weitere geänderte Tabellen kommen in denselben Eintrag.
create or replace function core.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ch uuid;
  v_key text;
  v_id text;
  v_role text;
  v_new bigint;
begin
  if v_uid is null then return null; end if;            -- Edge Functions protokollieren selbst (audit_add)
  v_ch := case when tg_op = 'DELETE' then old.channel_id else new.channel_id end;
  if v_ch is null then return null; end if;
  v_key := txid_current()::text || ':' || v_ch::text;
  if current_setting('app.audit_key', true) is not distinct from v_key then
    v_id := current_setting('app.audit_id', true);
    if coalesce(v_id, '') = '' then return null; end if; -- Zuschauer: kein Eintrag
    update core.audit_log set
      tables = case when tg_table_name::text = any(tables) then tables else tables || tg_table_name::text end,
      ops = case when lower(tg_op) = any(ops) then ops else ops || lower(tg_op) end
    where id = v_id::bigint;
    return null;
  end if;
  v_role := public.audit_role(v_ch, v_uid);
  if v_role is null then
    perform set_config('app.audit_key', v_key, true);
    perform set_config('app.audit_id', '', true);
    return null;
  end if;
  insert into core.audit_log (channel_id, actor, actor_name, role, action, tables, ops)
    values (v_ch, v_uid, left(coalesce((select username from public.profiles where id = v_uid), ''), 40), v_role,
            left(regexp_replace(coalesce(current_setting('request.path', true), ''), '^/(rpc/)?', ''), 80),
            array[tg_table_name::text], array[lower(tg_op)])
    returning id into v_new;
  perform set_config('app.audit_key', v_key, true);
  perform set_config('app.audit_id', v_new::text, true);
  return null;
end;
$$;
revoke execute on function core.audit_row() from public, anon, authenticated;

-- Trigger auf allen Kanal-Tabellen außer Zählern, Abklingzeiten und internen Warteschlangen.
-- Spätere Migrationen mit neuen Kanal-Tabellen: diesen Block dort einfach wiederholen.
do $$
declare
  r record;
  skip text[] := array['audit_log', 'chat_cooldowns', 'pet_cooldowns', 'pet_chat_cooldowns', 'prank_cooldowns',
    'pause_cooldowns', 'watchtime', 'watch_state', 'hotword_hits', 'hotword_counts', 'bot_outbox', 'twitch_health',
    'platform_stats_cache', 'quiz_answers', 'card_players', 'idea_votes', 'stream_days', 'watch_imports'];
begin
  for r in
    select c.relname from pg_class c
    where c.relnamespace = 'core'::regnamespace and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'channel_id' and not a.attisdropped)
  loop
    if exists (select 1 from pg_trigger where tgrelid = ('core.' || quote_ident(r.relname))::regclass and tgname = 'zz_audit') then
      execute format('drop trigger zz_audit on core.%I', r.relname);
    end if;
    continue when r.relname = any(skip);
    execute format('create trigger zz_audit after insert or update or delete on core.%I for each row execute function core.audit_row()', r.relname);
  end loop;
end;
$$;

-- Edge Functions (Service-Rolle): Aktion eines Kontos im Kanal der Anfrage festhalten
create or replace function public.audit_add(p_user uuid, p_action text, p_detail jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_role text := public.audit_role(v_ch, p_user);
begin
  if v_role is null then return; end if;
  insert into core.audit_log (channel_id, actor, actor_name, role, action, detail)
  values (v_ch, p_user, left(coalesce((select username from public.profiles where id = p_user), ''), 40), v_role,
          left(coalesce(p_action, ''), 80), coalesce(p_detail, '{}'));
end;
$$;
revoke execute on function public.audit_add(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.audit_add(uuid, text, jsonb) to service_role;

-- Streamer (und Plattform-Admin): die letzten Einträge des Kanals, ältere als 90 Tage fliegen raus
create or replace function public.audit_list(p_limit int default 100, p_before bigint default null, p_role text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  result json;
begin
  if not public.is_owner_of(v_ch) then
    raise exception 'Das Protokoll sieht nur der Streamer.';
  end if;
  delete from core.audit_log where channel_id = v_ch and at < now() - interval '90 days';
  select coalesce(json_agg(x order by x.id desc), '[]') into result from (
    select id, at, actor_name, role, action, tables, ops, detail
    from core.audit_log
    where channel_id = v_ch
      and (p_before is null or id < p_before)
      and (p_role is null or role = p_role)
    order by id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ) x;
  return result;
end;
$$;
revoke execute on function public.audit_list(int, bigint, text) from public, anon;
grant execute on function public.audit_list(int, bigint, text) to authenticated;

-- ============================================================
-- 6. Sitzungen
-- ============================================================
-- Eigene Anmeldungen (Geräte). Spalten über to_jsonb, weil Supabase sie je Version ergänzt.
create or replace function public.my_sessions()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
      'id', s.id,
      'created_at', s.created_at,
      'last_at', coalesce((j ->> 'refreshed_at')::timestamp at time zone 'utc', s.updated_at, s.created_at),
      'user_agent', left(coalesce(j ->> 'user_agent', ''), 300),
      'ip', coalesce(host((j ->> 'ip')::inet), ''),
      'aal', coalesce(j ->> 'aal', 'aal1'),
      'current', s.id::text = coalesce(auth.jwt() ->> 'session_id', ''))
    order by coalesce((j ->> 'refreshed_at')::timestamp at time zone 'utc', s.updated_at, s.created_at) desc), '[]')
  from auth.sessions s, lateral to_jsonb(s) j
  where s.user_id = auth.uid() and (s.not_after is null or s.not_after > now());
$$;
revoke execute on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated;

-- Eine andere eigene Sitzung beenden (sie kann sich danach nicht mehr erneuern;
-- ein schon ausgestellter Zugang läuft spätestens nach einer Stunde ab)
create or replace function public.session_revoke(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Bitte anmelden.'; end if;
  if p_id::text = coalesce(auth.jwt() ->> 'session_id', '') then
    raise exception 'Die eigene Sitzung beendest du mit „Abmelden“.';
  end if;
  delete from auth.sessions where id = p_id and user_id = auth.uid();
  return found;
exception when insufficient_privilege then
  raise exception 'Einzelne Sitzungen lassen sich hier gerade nicht beenden – nimm „Alle anderen abmelden“.';
end;
$$;
revoke execute on function public.session_revoke(uuid) from public, anon;
grant execute on function public.session_revoke(uuid) to authenticated;

-- ============================================================
-- 7. Export
-- ============================================================
-- Alle Tabellen des Kanals als JSON. Ohne Tokens, Lösungen und interne Warteschlangen.
create or replace function public.channel_export()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  r record;
  rows jsonb;
  tables jsonb := '{}';
  skip text[] := array['pause_secret', 'quiz_secret', 'bot_outbox', 'twitch_health', 'platform_stats_cache',
    'chat_cooldowns', 'pet_cooldowns', 'pet_chat_cooldowns', 'prank_cooldowns', 'pause_cooldowns'];
begin
  if not public.is_owner_of(v_ch) then
    raise exception 'Den Export macht nur der Streamer.';
  end if;
  for r in
    select c.relname from pg_class c
    where c.relnamespace = 'core'::regnamespace and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'channel_id' and not a.attisdropped)
    order by c.relname
  loop
    continue when r.relname = any(skip);
    execute format('select coalesce(jsonb_agg(to_jsonb(t) - %L - %L - %L), %L::jsonb) from core.%I t where channel_id = $1',
                   'access_token', 'refresh_token', 'channel_id', '[]', r.relname)
      into rows using v_ch;
    tables := tables || jsonb_build_object(r.relname, rows);
  end loop;
  return jsonb_build_object(
    'format', 'streamhelp-export-1',
    'exported_at', now(),
    'channel', (select jsonb_build_object('id', id, 'login', login, 'display_name', display_name, 'status', status, 'created_at', created_at)
                from public.channels where id = v_ch),
    'tables', tables);
end;
$$;
revoke execute on function public.channel_export() from public, anon;
grant execute on function public.channel_export() to authenticated;

-- ============================================================
-- 8. Sicherheits-Check (Admin-Bereich, über die Edge Function admin)
-- ============================================================
create or replace function public.security_report()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  out jsonb := '[]';
  items jsonb;
begin
  -- Tabellen ohne Row Level Security
  select coalesce(jsonb_agg(n.nspname || '.' || c.relname order by 1), '[]') into items
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'core') and not c.relrowsecurity;
  out := out || jsonb_build_object('id', 'rls', 'title', 'Tabellen ohne Row Level Security', 'level', case when items = '[]' then 'ok' else 'error' end, 'items', items);

  -- Funktionen ohne festen search_path
  select coalesce(jsonb_agg(p.oid::regprocedure::text order by 1), '[]') into items
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'core') and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  out := out || jsonb_build_object('id', 'search_path', 'title', 'Funktionen ohne festen search_path', 'level', case when items = '[]' then 'ok' else 'warn' end, 'items', items);

  -- Geheimnisse mit Tabellenrechten für Besucher
  select coalesce(jsonb_agg(t order by 1), '[]') into items
    from unnest(array['core.twitch_connection', 'core.pause_secret', 'core.quiz_secret', 'core.bot_outbox',
                      'public.twitch_bot', 'public.oauth_states', 'public.admin_login_failures']) t
    where to_regclass(t) is not null
      and (has_table_privilege('anon', t, 'SELECT') or has_table_privilege('authenticated', t, 'SELECT'));
  out := out || jsonb_build_object('id', 'secrets', 'title', 'Geheime Tabellen für Besucher lesbar (nur RLS schützt)', 'level', case when items = '[]' then 'ok' else 'error' end, 'items', items);

  -- Sichten mit Besitzer-Rechten (erlaubt: die sechs mit Spaltenmaske)
  select coalesce(jsonb_agg(c.relname order by 1), '[]') into items
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
      and not coalesce('security_invoker=true' = any(c.reloptions) or 'security_invoker=on' = any(c.reloptions), false)
      and c.relname not in ('giveaway_entries', 'pranks', 'queue_entries', 'quiz_scores', 'shop_runs', 'tts_messages');
  out := out || jsonb_build_object('id', 'views', 'title', 'Sichten mit Besitzer-Rechten (unerwartet)', 'level', case when items = '[]' then 'ok' else 'warn' end, 'items', items);

  -- Rate-Limit der API aktiv?
  select coalesce(jsonb_agg(cfg), '[]') into items
    from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) cfg
    where r.rolname = 'authenticator' and cfg like 'pgrst.db_pre_request=%';
  out := out || jsonb_build_object('id', 'rate_limit', 'title', 'Rate-Limit für die API (db-pre-request)', 'level', case when items = '[]' then 'warn' else 'ok' end, 'items', items);

  -- Kanal-Inhaber ohne 2FA (nur Anzahl)
  select jsonb_build_array(count(*)::text || ' von ' || (select count(*) from public.channels where owner_id is not null)::text) into items
    from public.channels c
    where c.owner_id is not null
      and not exists (select 1 from auth.mfa_factors f where f.user_id = c.owner_id and f.status::text = 'verified');
  out := out || jsonb_build_object('id', 'mfa', 'title', 'Streamer ohne Zwei-Faktor-Anmeldung', 'level', 'info', 'items', items);

  return out;
end;
$$;
revoke execute on function public.security_report() from public, anon, authenticated;
grant execute on function public.security_report() to service_role;

-- ============================================================
-- Admin-Bereich: Zwei-Faktor-Code (TOTP) für das Admin-Passwort
-- ============================================================
-- Nur die Edge Function admin (Service-Rolle) liest und schreibt hier.
create table if not exists public.admin_mfa (
  id int primary key default 1 check (id = 1),
  secret text not null check (secret ~ '^[A-Z2-7]{32}$'),
  enabled boolean not null default false,
  last_step bigint not null default 0,      -- zuletzt genutztes 30-Sekunden-Fenster (kein Code zweimal)
  created_at timestamptz not null default now(),
  enabled_at timestamptz
);
alter table public.admin_mfa enable row level security;
revoke all on public.admin_mfa from anon, authenticated;

notify pgrst, 'reload schema';
