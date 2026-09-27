-- ============================================================
-- Content-Stellwerk
-- Streamer statt „Dave“, Streameransicht und Freigabe für Mods.
--   · streamer_info(): Name und Login des verbundenen Twitch-Kanals – öffentlich
--     (auch fürs OBS-Overlay ohne Anmeldung), ohne Tokens
--   · channel_mods: die Mods des Kanals von Twitch (twitch-oauth holt sie, Recht
--     moderation:read – dafür Twitch einmal neu verbinden)
--   · overlay_config.mods_enabled: „Für Mods freigeben“ – nur der Streamer schaltet das
--   · Ist es an, gelten Mods, die sich mit Twitch auf der Seite anmelden, als Admins
--     für die Inhalte: OBS steuern, Kacheln freischalten, Glücksrad, Bingo, Fragen, Dino …
--     Twitch trennen und Kanalpunkte-Kosten bleiben beim Streamer (Edge Functions prüfen
--     dafür weiter profiles.is_admin).
--   · my_access(): wer bin ich? (Admin, Mod, Streamer, Freigabe an?)
-- Braucht 20260930000000_live_overlay.sql. Mehrfach ausführbar.
-- ============================================================

-- ---------- Mods des Kanals (von Twitch) ----------
create table if not exists public.channel_mods (
  twitch_user_id text primary key check (twitch_user_id ~ '^[0-9]{1,20}$'),
  login text not null default '',
  display_name text not null default '',
  synced_at timestamptz not null default now()
);
alter table public.channel_mods enable row level security;
-- Schreiben nur twitch-oauth (Service-Rolle); lesen siehe Policy unten (nach is_admin)

alter table public.overlay_config add column if not exists mods_enabled boolean not null default false;

-- Hat sich dieser Nutzer mit dem Twitch-Konto eines Mods angemeldet?
create or replace function public.is_twitch_mod_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from auth.identities i
    join public.channel_mods m on m.twitch_user_id = i.provider_id
    where i.user_id = p_user and i.provider = 'twitch'
  );
$$;

-- Mod mit Rechten: Mod bei Twitch und vom Streamer freigegeben
create or replace function public.is_mod_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select mods_enabled from public.overlay_config where id = 1), false)
    and public.is_twitch_mod_user(p_user);
$$;

-- Admin für die Inhalte: Admin-Häkchen im Admin-Bereich oder freigegebener Mod.
-- Auch für die Edge Functions (Service-Rolle) mit einer Nutzer-ID.
create or replace function public.is_admin_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and (
    coalesce((select is_admin from public.profiles where id = p_user), false)
    or public.is_mod_user(p_user)
  );
$$;
revoke execute on function public.is_twitch_mod_user(uuid) from public, anon, authenticated;
revoke execute on function public.is_mod_user(uuid) from public, anon, authenticated;
revoke execute on function public.is_admin_user(uuid) from public, anon, authenticated;

-- is_admin() gilt überall (Policies, Funktionen) – jetzt inklusive freigegebener Mods
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin_user(auth.uid());
$$;

create or replace function public.is_mod()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_mod_user(auth.uid());
$$;

drop policy if exists "channel_mods: lesen für admins" on public.channel_mods;
create policy "channel_mods: lesen für admins" on public.channel_mods
  for select to authenticated using ((select public.is_admin()) or (select public.is_owner()));

-- ---------- OBS-Overlay: Mods dürfen, wenn freigegeben ----------
create or replace function public.overlay_can_edit()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_owner()
    or public.is_mod()
    or (coalesce((select is_admin from public.profiles where id = auth.uid()), false)
        and coalesce((select admins_can_edit from public.overlay_config where id = 1), false));
$$;

create or replace function public.overlay_access()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'can_edit', public.overlay_can_edit(),
    'is_owner', public.is_owner(),
    'admins_can_edit', coalesce((select admins_can_edit from public.overlay_config where id = 1), false),
    'mods_enabled', coalesce((select mods_enabled from public.overlay_config where id = 1), false),
    'is_mod', public.is_mod()
  );
$$;

create or replace function public.overlay_save(p_params text)
returns public.overlay_config language plpgsql security definer set search_path = '' as $$
declare
  result public.overlay_config;
begin
  if not public.overlay_can_edit() then
    raise exception 'Das OBS-Overlay dürfen nur der Streamer, freigegebene Mods und freigeschaltete Admins ändern.';
  end if;
  update public.overlay_config
    set params = coalesce(p_params, ''), updated_by = public.my_name(), updated_at = now()
    where id = 1
    returning * into result;
  return result;
end;
$$;

create or replace function public.overlay_allow_admins(p_on boolean)
returns public.overlay_config language plpgsql security definer set search_path = '' as $$
declare
  result public.overlay_config;
begin
  if not public.is_owner() then
    raise exception 'Nur der Streamer darf das erlauben.';
  end if;
  update public.overlay_config set admins_can_edit = coalesce(p_on, false), updated_at = now()
    where id = 1 returning * into result;
  return result;
end;
$$;

-- „Für Mods freigeben“ – nur der Streamer
create or replace function public.overlay_allow_mods(p_on boolean)
returns public.overlay_config language plpgsql security definer set search_path = '' as $$
declare
  result public.overlay_config;
begin
  if not public.is_owner() then
    raise exception 'Nur der Streamer darf Mods freigeben.';
  end if;
  update public.overlay_config set mods_enabled = coalesce(p_on, false), updated_at = now()
    where id = 1 returning * into result;
  return result;
end;
$$;
revoke execute on function public.overlay_allow_mods(boolean) from public, anon;
grant execute on function public.overlay_allow_mods(boolean) to authenticated;

-- ---------- Wer ist der Streamer? (öffentlich, ohne Tokens) ----------
create or replace function public.streamer_info()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select json_build_object('connected', true, 'login', broadcaster_login, 'name', display_name)
       from public.twitch_connection where id = 1),
    json_build_object('connected', false)
  );
$$;
grant execute on function public.streamer_info() to anon, authenticated;

-- ---------- Meine Rechte ----------
create or replace function public.my_access()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'is_admin', public.is_admin(),
    'is_site_admin', coalesce((select is_admin from public.profiles where id = auth.uid()), false),
    'is_owner', public.is_owner(),
    'is_mod', public.is_mod(),
    'is_twitch_mod', public.is_twitch_mod_user(auth.uid()),
    'mods_enabled', coalesce((select mods_enabled from public.overlay_config where id = 1), false),
    'mods_scope', coalesce((select 'moderation:read' = any(scopes) from public.twitch_connection where id = 1), false),
    'mods_count', (select count(*) from public.channel_mods)
  );
$$;
revoke execute on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

-- ---------- Standardtexte: „der Streamer“ statt „Dave“ ----------
-- Nur die mitgelieferten Texte; selbst geschriebene bleiben, wie sie sind.
update public.tiles set
  title = replace(replace(title, 'Ärgere den Dave', 'Ärgere den Streamer'), 'Daves Dino', 'Stream-Dino'),
  description = replace(replace(replace(replace(replace(replace(replace(description,
    'Daves nächste Runde', 'die nächste Runde des Streamers'),
    'Zuschauer gegen Dave', 'Zuschauer gegen den Streamer'),
    'wirf was auf Dave', 'wirf was auf den Streamer'),
    'Welche Items findet Dave', 'Welche Items findet der Streamer'),
    'Stell Dave die Fragen', 'Stell dem Streamer die Fragen'),
    'wohnt in Daves Stream', 'wohnt im Stream'),
    'schafft Dave alle Stufen', 'schafft der Streamer alle Stufen')
where title like '%Dave%' or description like '%Dave%';

update public.wheel_variants set
  description = replace(replace(replace(description,
    'womit Dave kämpfen', 'womit der Streamer kämpfen'),
    'wie Dave in die Runde', 'wie der Streamer in die Runde'),
    'Lost Daves einzige Waffe', 'Lost die einzige Waffe des Streamers'),
  segments = replace(segments::text, 'ist Daves einzige Waffe', 'ist die einzige Waffe des Streamers')::jsonb
where description like '%Dave%' or segments::text like '%Daves einzige Waffe%';

-- Dino-Sprüche: {streamer} setzt die Seite und das Overlay durch den Kanalnamen
update public.pet set phrases = array(
    select replace(p, 'Dave', '{streamer}') from unnest(phrases) with ordinality as t(p, n) order by n)
  where exists (select 1 from unnest(phrases) as p where p like '%Dave%');

-- Probe-Alert ohne Namen (sonst wie in …_alert_bits_sounds.sql)
create or replace function public.alert_test(p_kind text)
returns public.stream_alerts language plpgsql security definer set search_path = '' as $$
declare
  names text[] := array['Lokfuehrer_Lena', 'SchienenSeb', 'TTV_Weichensteller', 'Bahnhofskater', 'ICE_Irina', 'Gleis9dreiviertel'];
  who text := names[1 + floor(random() * array_length(names, 1))::int];
  result public.stream_alerts;
begin
  if not public.is_admin() then
    raise exception 'Test-Alerts dürfen nur Admins schicken.';
  end if;
  if p_kind not in ('follow', 'sub', 'resub', 'gift', 'bits') then
    raise exception 'Diese Alert-Art gibt es nicht.';
  end if;
  if (select count(*) from public.stream_alerts where test and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Genug getestet – kurz warten.';
  end if;
  insert into public.stream_alerts (kind, user_name, tier, months, amount, message, test)
  values (
    p_kind, who, case when p_kind = 'bits' then '' else '1000' end,
    case when p_kind = 'resub' then 3 + floor(random() * 20)::int else 0 end,
    case when p_kind = 'gift' then (array[1, 5, 10])[1 + floor(random() * 3)::int]
         when p_kind = 'bits' then (array[100, 500, 1000])[1 + floor(random() * 3)::int]
         else 0 end,
    case when p_kind = 'resub' then 'Test-Nachricht: Weiter so!'
         when p_kind = 'bits' then 'Test-Cheer: Volle Fahrt voraus!'
         else '' end,
    true
  )
  returning * into result;
  delete from public.stream_alerts where test and created_at < now() - interval '1 day';
  return result;
end;
$$;
revoke execute on function public.alert_test(text) from public, anon;
grant execute on function public.alert_test(text) to authenticated;
