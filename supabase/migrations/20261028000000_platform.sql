-- ============================================================
-- StreamHelp: Plattform für viele Streamer
--   · Jeder Streamer bekommt einen eigenen Kanal (public.channels). Alle Inhalte – Kacheln,
--     Glücksrad, Ärgern, Dino, Overlay, Verlosung, Hot Words … – gehören ab jetzt zu genau
--     einem Kanal. Die bisherigen Daten werden dem bisherigen Kanal (Standard-Kanal) zugeordnet;
--     alte Links und das OBS-Overlay ohne ?c= funktionieren deshalb weiter wie bisher.
--   · Neue Streamer melden sich mit Twitch an und bewerben sich (channel_apply). Erst nach der
--     Freischaltung durch den Seiten-Admin (Admin-Bereich, channel_set_status) ist der Kanal aktiv.
--   · Alle Kanäle nutzen denselben StreamHelp-Chat-Bot (twitch_bot bleibt eine Zeile für alle).
--   · Welcher Kanal gemeint ist, sagt der Header x-channel (Kanal-ID oder Twitch-Login), den die
--     Webseite, das Overlay und die Edge Functions mitschicken. Ohne Header: der Standard-Kanal.
--
-- Technik:
--   · Die Tabellen ziehen in das Schema „core“ und bekommen die Spalte channel_id. Unter dem alten
--     Namen in „public“ steht jetzt eine Sicht (View), die nur die Zeilen des aktuellen Kanals zeigt
--     und neue Zeilen automatisch dem aktuellen Kanal zuordnet. So arbeiten alle bisherigen
--     Datenbank-Funktionen und die Webseite unverändert weiter – nur eben je Kanal.
--   · Schlüssel, die bisher für die ganze Seite galten (z. B. „Zeile 1“ der Einstellungen,
--     Befehle, Kacheln), gelten jetzt je Kanal.
--   · Realtime (Live-Aktualisierung) läuft über die Tabellen in „core“, gefiltert nach channel_id.
--
-- WICHTIG – vor dem Ausführen:
--   · Vorher ein Backup machen (Supabase → Database → Backups). Der Umbau lässt sich nicht einfach
--     rückgängig machen.
--   · Alle älteren Migrationen müssen vorher gelaufen sein (zuletzt …_overlay_presets.sql).
--   · Ältere Migrationen danach NICHT erneut ausführen – sie kennen die neue Struktur nicht.
--   · Mehrfach ausführbar (schon umgezogene Tabellen werden übersprungen).
-- ============================================================

begin;

-- ---------- Voraussetzungen ----------
do $$
declare
  t text;
begin
  foreach t in array array['hotwords', 'overlay_presets', 'prank_sound_rewards', 'giveaway_entries', 'tiles'] loop
    if to_regclass('public.' || t) is null and to_regclass('core.' || t) is null then
      raise exception 'Erst die älteren Migrationen ausführen – es fehlt die Tabelle %.', t;
    end if;
  end loop;
end;
$$;

create schema if not exists core;
revoke all on schema core from public;
grant usage on schema core to anon, authenticated, service_role;
comment on schema core is 'StreamHelp: Tabellen je Kanal. Zugriff über die gleichnamigen Sichten in public.';

-- ---------- Kanäle ----------
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  login text unique check (login ~ '^[a-z0-9_]{1,25}$'),          -- Twitch-Login, auch der Link: #/c/<login>
  twitch_id text unique,
  display_name text not null default '' check (char_length(display_name) <= 40),
  avatar_url text not null default '' check (char_length(avatar_url) <= 500),
  owner_id uuid unique references auth.users on delete set null,   -- ein Kanal je Konto
  status text not null default 'pending' check (status in ('pending', 'active', 'blocked')),
  is_default boolean not null default false,
  note text not null default '' check (char_length(note) <= 300),  -- Nachricht bei der Bewerbung
  admin_note text not null default '' check (char_length(admin_note) <= 300),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users on delete set null
);
create unique index if not exists channels_one_default on public.channels (is_default) where is_default;
alter table public.channels enable row level security;
-- Kein direkter Zugriff: Lesen und Ändern nur über die Funktionen unten
revoke all on public.channels from anon, authenticated;

-- Den bisherigen Kanal als Standard-Kanal anlegen (aus der Twitch-Verbindung, wenn es eine gibt)
do $$
declare
  v_id text;
  v_login text;
  v_name text;
  v_owner uuid;
begin
  if exists (select 1 from public.channels where is_default) then return; end if;
  if to_regclass('public.twitch_connection') is not null then
    execute $q$select broadcaster_id, lower(broadcaster_login), display_name, connected_by
               from public.twitch_connection where id = 1$q$ into v_id, v_login, v_name, v_owner;
  end if;
  insert into public.channels (login, twitch_id, display_name, owner_id, status, is_default, approved_at)
  values (case when v_login ~ '^[a-z0-9_]{1,25}$' then v_login end, v_id,
          left(coalesce(nullif(v_name, ''), 'StreamHelp'), 40), v_owner, 'active', true, now());
end;
$$;

-- Plattform-Admin (du): das StreamHelp-Admin-Konto aus dem Admin-Bereich
create or replace function public.is_site_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'stellwerk_site_admin')::boolean, false);
$$;

create or replace function public.is_site_admin_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from auth.users
    where id = p_user and coalesce((raw_app_meta_data ->> 'stellwerk_site_admin')::boolean, false));
$$;

create or replace function public.default_channel()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.channels where is_default;
$$;

-- Der Kanal dieser Anfrage:
--   1. app.channel (setzen nur Funktionen dieser Datenbank, z. B. beim Einrichten eines Kanals)
--   2. Header x-channel (Kanal-ID oder Twitch-Login) – aktive Kanäle für alle, sonst nur
--      Inhaber und Plattform-Admin (freigeschaltet wird erst danach) und die Edge Functions
--   3. sonst der Standard-Kanal
-- Unbekannter oder gesperrter Kanal: NULL – dann ist einfach nichts zu sehen.
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
  if c.status = 'active'
     or (c.status = 'pending' and c.owner_id is not null and c.owner_id = auth.uid())
     or public.is_site_admin()
     or coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return c.id;
  end if;
  return null;
end;
$$;
grant execute on function public.current_channel() to anon, authenticated, service_role;

-- ---------- Tabellen je Kanal: nach core umziehen, channel_id dazu ----------
-- Global bleiben: profiles (Konten), twitch_bot (ein Bot für alle), oauth_states, admin_login_failures
do $$
declare
  t text;
  tables text[] := array[
    'alert_config', 'alert_media', 'alert_sounds', 'bingo_card', 'bingo_items', 'bingo_player_cards',
    'bot_commands', 'bot_outbox', 'card_defs', 'card_owned', 'card_packs', 'card_players', 'card_pulls',
    'card_settings', 'card_trades', 'channel_mods', 'chat_cooldowns', 'forbidden_reports', 'forbidden_word',
    'giveaway', 'giveaway_entries', 'giveaway_winners', 'hotword_blocks', 'hotword_counts', 'hotword_hits',
    'hotwords', 'idea_votes', 'ideas', 'overlay_config', 'overlay_presets', 'overlay_spins', 'pause_cooldowns',
    'pause_screen', 'pause_secret', 'pet', 'pet_chat_cooldowns', 'pet_cooldowns', 'pet_events',
    'prank_cooldowns', 'prank_settings', 'prank_sound_rewards', 'pranks', 'question_stage', 'questions',
    'queue_entries', 'queue_players', 'queue_settings', 'quiz_answers', 'quiz_questions', 'quiz_round',
    'quiz_scores', 'quiz_secret', 'shop_lobbies', 'shop_runs', 'shop_settings', 'site_guard', 'sounds',
    'spins', 'stream_alerts', 'stream_rewards', 'subathon', 'subathon_log', 'ticker', 'tiles',
    'tts_messages', 'tts_settings', 'tts_state', 'twitch_connection', 'twitch_health', 'watch_state',
    'watchtime', 'wheel_variants', 'win_challenge'];
begin
  -- Die zwei alten Sichten hängen an ideas und shop_lobbies – sie werden unten neu gebaut
  foreach t in array tables loop
    if to_regclass('core.' || t) is not null then continue; end if;
    if to_regclass('public.' || t) is null then
      raise exception 'Tabelle public.% fehlt – erst die älteren Migrationen ausführen.', t;
    end if;
    execute format('alter table public.%I set schema core', t);
    -- Bestehende Zeilen bekommen den Standard-Kanal (current_channel() ohne Header)
    execute format('alter table core.%I add column channel_id uuid not null default public.current_channel()
                    references public.channels on delete cascade', t);
    execute format('grant select (channel_id) on core.%I to anon, authenticated', t);
  end loop;
end;
$$;

-- ---------- Schlüssel je Kanal ----------
do $$
declare
  r record;
  pk text;
begin
  for r in select * from (values
    -- Einstellungen und Zustände („Zeile 1“) – jetzt Zeile 1 je Kanal
    ('alert_config', 'id'), ('bingo_card', 'id'), ('card_settings', 'id'), ('forbidden_word', 'id'),
    ('giveaway', 'id'), ('hotwords', 'id'), ('overlay_config', 'id'), ('pause_screen', 'id'),
    ('pause_secret', 'id'), ('pet', 'id'), ('prank_settings', 'id'), ('question_stage', 'id'),
    ('queue_settings', 'id'), ('quiz_round', 'id'), ('quiz_secret', 'id'), ('shop_settings', 'id'),
    ('site_guard', 'id'), ('subathon', 'id'), ('ticker', 'id'), ('tts_settings', 'id'), ('tts_state', 'id'),
    ('twitch_connection', 'id'), ('twitch_health', 'id'), ('watch_state', 'id'), ('win_challenge', 'id'),
    -- Zuschauer, Wörter, Befehle, Kacheln … je Kanal
    ('bingo_player_cards', 'user_id'), ('card_players', 'player_key'), ('channel_mods', 'twitch_user_id'),
    ('chat_cooldowns', 'slot'), ('hotword_blocks', 'word'), ('hotword_counts', 'word'),
    ('hotword_hits', 'player, word'), ('pause_cooldowns', 'player_key'), ('pet_chat_cooldowns', 'twitch_user_id'),
    ('pet_cooldowns', 'user_id, kind'), ('prank_cooldowns', 'user_id'), ('queue_players', 'player_key'),
    ('quiz_answers', 'round_n, player_key'), ('quiz_scores', 'player_key'), ('stream_rewards', 'key'),
    ('tiles', 'id'), ('watchtime', 'twitch_id'), ('wheel_variants', 'id')
  ) v(tbl, cols) loop
    select conname into pk from pg_constraint where conrelid = ('core.' || r.tbl)::regclass and contype = 'p';
    if pg_get_constraintdef((select oid from pg_constraint where conrelid = ('core.' || r.tbl)::regclass and contype = 'p'))
       like 'PRIMARY KEY (channel_id,%' then continue; end if;
    execute format('alter table core.%I drop constraint %I, add constraint %I primary key (channel_id, %s)',
                   r.tbl, pk, pk, r.cols);
  end loop;

  for r in select * from (values
    ('bot_commands', 'bot_commands_command_key', 'command'),
    ('giveaway_entries', 'giveaway_entries_round_player_key_key', 'round, player_key'),
    ('prank_sound_rewards', 'prank_sound_rewards_board_key', 'board')
  ) v(tbl, con, cols) loop
    if exists (select 1 from pg_constraint where conrelid = ('core.' || r.tbl)::regclass and conname = r.con
               and pg_get_constraintdef(oid) like 'UNIQUE (channel_id,%') then continue; end if;
    execute format('alter table core.%I drop constraint if exists %I, add constraint %I unique (channel_id, %s)',
                   r.tbl, r.con, r.con, r.cols);
  end loop;
end;
$$;

-- Admin-Dateien liegen jetzt im Kanal-Ordner (<Kanal-ID>/datei.mp3)
alter table core.alert_sounds drop constraint if exists alert_sounds_path_check;
alter table core.alert_sounds add constraint alert_sounds_path_check
  check (path ~ '^([0-9a-f-]{36}/)?[a-z0-9-]+\.[a-z0-9]{2,4}$');
alter table core.alert_media drop constraint if exists alert_media_path_check;
alter table core.alert_media add constraint alert_media_path_check
  check (path ~ '^([0-9a-f-]{36}/)?[a-z0-9-]+\.(png|jpe?g|gif|webp|webm|mp4)$');

drop index if exists core.overlay_presets_name_idx;
create unique index if not exists overlay_presets_channel_name_idx on core.overlay_presets (channel_id, lower(name));
drop index if exists core.queue_entries_active_key;
create unique index if not exists queue_entries_channel_active_key on core.queue_entries (channel_id, player_key)
  where status in ('waiting', 'picked');
drop index if exists core.hotword_counts_n_idx;
create index if not exists hotword_counts_channel_n_idx on core.hotword_counts (channel_id, n desc, last_at desc);

-- Alle anderen Tabellen: Index auf channel_id (die Sichten filtern immer danach)
do $$
declare
  r record;
begin
  for r in
    select c.relname from pg_class c
    where c.relnamespace = 'core'::regnamespace and c.relkind = 'r'
      -- nur Tabellen je Kanal (spätere Migrationen legen in core auch Hilfstabellen ohne channel_id an)
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'channel_id' and not a.attisdropped)
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.oid and i.indkey[0] = (select attnum from pg_attribute where attrelid = c.oid and attname = 'channel_id'))
  loop
    execute format('create index if not exists %I on core.%I (channel_id)', r.relname || '_channel_idx', r.relname);
  end loop;
end;
$$;

-- ---------- Sichten in public ----------
-- Normale Tabellen: Sicht mit den Rechten des Aufrufers (Row Level Security der Tabelle gilt).
-- Sechs Tabellen zeigen Zuschauern ohne Anmeldung nur bestimmte Spalten (Spaltenrechte). Eine
-- Sicht mit Aufrufer-Rechten braucht aber Leserechte auf alle Spalten – deshalb laufen diese
-- sechs mit den Rechten des Besitzers, sind abgeschottet (security_barrier), geben genau dieselben
-- Spalten frei wie die Tabelle und prüfen dieselben Lese-Regeln wie deren Policies.
-- Für spätere Migrationen: nach „alter table core.x add column …“ einfach select public.channel_view('x').
create or replace function public.channel_view(p_table text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  masks constant jsonb := jsonb_build_object(
    'giveaway_entries', 'true',
    'pranks', 'true',
    'queue_entries', $m$status in ('waiting', 'picked')$m$,
    'quiz_scores', 'true',
    'shop_runs', $m$stream or lobby_id is not null or (current_user = 'authenticated' and user_id = (select auth.uid()))$m$,
    'tts_messages', $m$status = 'approved' or public.is_admin_of(channel_id)$m$);
  v_mask text := masks ->> p_table;
  r record;
begin
  if to_regclass('core.' || p_table) is null then raise exception 'Tabelle core.% fehlt.', p_table; end if;
  if v_mask is null then
    execute format('create or replace view public.%1$I with (security_invoker = true) as
                      select * from core.%1$I where channel_id = (select public.current_channel())
                    with local check option', p_table);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated, service_role', p_table);
  else
    execute format('create or replace view public.%1$I with (security_invoker = false, security_barrier = true) as
                      select * from core.%1$I where channel_id = (select public.current_channel())
                        and (current_user not in (''anon'', ''authenticated'') or (%2$s))
                    with local check option', p_table, v_mask);
    execute format('revoke all on public.%I from public, anon, authenticated', p_table);
    execute format('grant select, insert, update, delete on public.%I to service_role', p_table);
    for r in
      select a.attname, rl.rolname
      from pg_attribute a cross join (values ('anon'), ('authenticated')) rl(rolname)
      where a.attrelid = ('core.' || p_table)::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege(rl.rolname, ('core.' || p_table)::regclass, a.attnum, 'SELECT')
    loop
      execute format('grant select (%I) on public.%I to %I', r.attname, p_table, r.rolname);
    end loop;
  end if;
end;
$$;
revoke execute on function public.channel_view(text) from public, anon, authenticated;

-- Rechte-Prüfung für eine bestimmte Zeile (Policies, Realtime): Darf ich in diesem Kanal steuern?
-- Wie is_admin(), nur für einen festen Kanal statt den der Anfrage.
create or replace function public.is_admin_of(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_channel is not null and (
    public.is_site_admin()
    or exists (select 1 from public.channels where id = p_channel and owner_id = auth.uid())
    -- Admin-Häkchen von früher: gilt nur im Standard-Kanal
    or (exists (select 1 from public.channels where id = p_channel and is_default)
        and coalesce((select is_admin from public.profiles where id = auth.uid()), false))
    -- freigegebene Mods des Kanals
    or (coalesce((select mods_enabled from core.overlay_config where channel_id = p_channel and id = 1), false)
        and exists (select 1 from auth.identities i
                    join core.channel_mods m on m.twitch_user_id = i.provider_id and m.channel_id = p_channel
                    where i.user_id = auth.uid() and i.provider = 'twitch'))
  );
$$;

create or replace function public.is_owner_of(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_channel is not null and (
    public.is_site_admin()
    or exists (select 1 from public.channels where id = p_channel and owner_id = auth.uid())
    or exists (select 1 from core.twitch_connection where channel_id = p_channel and connected_by = auth.uid())
  );
$$;

do $$
declare
  r record;
begin
  for r in select c.relname from pg_class c where c.relnamespace = 'core'::regnamespace and c.relkind = 'r'
             and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'channel_id' and not a.attisdropped)
           order by 1 loop
    perform public.channel_view(r.relname);
  end loop;
end;
$$;

-- Die zwei alten Sichten auf die neuen Sichten umstellen (gleiche Spalten, nur je Kanal)
create or replace view public.ideas_ranked with (security_invoker = on) as
  select i.id, i.text, i.author, i.created_at,
    (select count(*) from public.idea_votes v where v.idea_id = i.id) as votes,
    exists (select 1 from public.idea_votes v where v.idea_id = i.id and v.user_id = auth.uid()) as voted
  from public.ideas i;

do $$
begin
  execute (
    select 'create or replace view public.shop_lobbies_public with (security_invoker = on) as '
           || replace(pg_get_viewdef('public.shop_lobbies_public'::regclass), 'FROM core.shop_lobbies', 'FROM public.shop_lobbies'));
end;
$$;

-- ---------- Policies: Admin-Prüfung für den Kanal der Zeile ----------
-- Bisher: (select public.is_admin()) – der Kanal der Anfrage. Jetzt: der Kanal der Zeile.
-- Das stimmt auch für Realtime (kennt keinen Header) und verhindert, dass jemand Zeilen
-- eines anderen Kanals ändert.
do $$
declare
  r record;
  q text;
  w text;
  old_path text := current_setting('search_path');
begin
  perform set_config('search_path', '', true);
  for r in select * from pg_policies where schemaname = 'core' loop
    q := regexp_replace(regexp_replace(coalesce(r.qual, ''), '(public\.)?is_admin\(\)', 'public.is_admin_of(channel_id)', 'g'),
                        '(public\.)?is_owner\(\)', 'public.is_owner_of(channel_id)', 'g');
    w := regexp_replace(regexp_replace(coalesce(r.with_check, ''), '(public\.)?is_admin\(\)', 'public.is_admin_of(channel_id)', 'g'),
                        '(public\.)?is_owner\(\)', 'public.is_owner_of(channel_id)', 'g');
    if q is distinct from coalesce(r.qual, '') or w is distinct from coalesce(r.with_check, '') then
      execute format('alter policy %I on core.%I', r.policyname, r.tablename)
        || case when r.qual is not null then format(' using (%s)', q) else '' end
        || case when r.with_check is not null then format(' with check (%s)', w) else '' end;
    end if;
  end loop;
  perform set_config('search_path', old_path, true);
end;
$$;

-- Sounds hochladen: die Einstellung „Zuschauer dürfen hochladen“ des eigenen Kanals
drop policy if exists "sounds: anlegen für angemeldete" on core.sounds;
create policy "sounds: anlegen für angemeldete" on core.sounds for insert to authenticated with check (
  user_id = (select auth.uid())
  and path like (select auth.uid())::text || '/%'
  and (coalesce((select p.allow_uploads from core.prank_settings p where p.channel_id = sounds.channel_id and p.id = 1), false)
       or public.is_admin_of(channel_id)));

-- ---------- Dateien (Storage) ----------
-- Admin-Dateien liegen ab jetzt im Ordner <Kanal-ID>/…; ältere Dateien ohne Ordner gehören
-- zum Standard-Kanal.
create or replace function public.storage_admin_ok(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin_of(case
    when (storage.foldername(p_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (storage.foldername(p_name))[1]::uuid
    else public.default_channel() end);
$$;
grant execute on function public.storage_admin_ok(text) to authenticated;

do $$
declare
  b text;
begin
  if to_regclass('storage.objects') is null then return; end if;
  foreach b in array array['bingo', 'alert-sounds', 'alert-media', 'cards'] loop
    execute format('drop policy if exists %I on storage.objects', b || ': hochladen je Kanal');
    execute format('drop policy if exists %I on storage.objects', b || ': sehen je Kanal');
    execute format('drop policy if exists %I on storage.objects', b || ': löschen je Kanal');
    execute format('create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and public.storage_admin_ok(name))',
                   b || ': hochladen je Kanal', b);
    execute format('create policy %I on storage.objects for select to authenticated using (bucket_id = %L and public.storage_admin_ok(name))',
                   b || ': sehen je Kanal', b);
    execute format('create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and public.storage_admin_ok(name))',
                   b || ': löschen je Kanal', b);
  end loop;
  drop policy if exists "bingo: bilder hochladen nur admin" on storage.objects;
  drop policy if exists "bingo: bilder sehen nur admin" on storage.objects;
  drop policy if exists "bingo: bilder löschen nur admin" on storage.objects;
  drop policy if exists "alert-sounds: hochladen nur admin" on storage.objects;
  drop policy if exists "alert-sounds: sehen nur admin" on storage.objects;
  drop policy if exists "alert-sounds: löschen nur admin" on storage.objects;
  drop policy if exists "alert-media: hochladen nur admin" on storage.objects;
  drop policy if exists "alert-media: sehen nur admin" on storage.objects;
  drop policy if exists "alert-media: löschen nur admin" on storage.objects;
  drop policy if exists "cards: bilder hochladen nur admin" on storage.objects;
  drop policy if exists "cards: bilder sehen nur admin" on storage.objects;
  drop policy if exists "cards: bilder löschen nur admin" on storage.objects;

  -- Eigene Sounds der Zuschauer: Ordner = eigenes Konto. Ob Hochladen erlaubt ist, prüft die
  -- Tabelle sounds (je Kanal) – ohne Eintrag dort spielt die Datei nirgends.
  drop policy if exists "sounds: hochladen in eigenen Ordner" on storage.objects;
  create policy "sounds: hochladen in eigenen Ordner" on storage.objects for insert to authenticated with check (
    bucket_id = 'sounds' and (storage.foldername(name))[1] = (select auth.uid())::text);
  drop policy if exists "sounds: eigene Dateien sehen" on storage.objects;
  create policy "sounds: eigene Dateien sehen" on storage.objects for select to authenticated using (
    bucket_id = 'sounds' and ((storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from core.sounds s where s.path = name and public.is_admin_of(s.channel_id))));
  drop policy if exists "sounds: löschen selbst oder admin" on storage.objects;
  create policy "sounds: löschen selbst oder admin" on storage.objects for delete to authenticated using (
    bucket_id = 'sounds' and ((storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from core.sounds s where s.path = name and public.is_admin_of(s.channel_id))));
end;
$$;

-- ---------- Funktionen mit Tabellen-Typen ----------
-- Funktionen, die eine ganze Zeile zurückgeben (z. B. „returns public.hotwords“), zeigen nach dem
-- Umzug auf core.… – zurück auf die Sicht in public, damit die Webseite sie wie gewohnt aufruft.
do $$
declare
  r record;
  def text;
  pos int;
  head text;
  new_sig text;
  g record;
begin
  for r in
    select p.oid, p.oid::regprocedure::text as sig, p.proacl
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and (exists (select 1 from pg_type t join pg_class c on c.oid = t.typrelid
                   where t.oid = p.prorettype and c.relnamespace = 'core'::regnamespace)
        or exists (select 1 from unnest(p.proargtypes) a join pg_type t on t.oid = a join pg_class c on c.oid = t.typrelid
                   where c.relnamespace = 'core'::regnamespace))
  loop
    def := pg_get_functiondef(r.oid);
    pos := strpos(def, E'\nAS ');
    head := regexp_replace(left(def, pos), '\mcore\.', 'public.', 'g');
    new_sig := regexp_replace(r.sig, '\mcore\.', 'public.', 'g');
    execute 'drop function ' || r.sig;
    execute head || substr(def, pos + 1);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', new_sig);
    if r.proacl is null then
      execute format('grant execute on function %s to public', new_sig);
    else
      for g in select a.grantee from aclexplode(r.proacl) a where a.privilege_type = 'EXECUTE' loop
        if g.grantee = 0 then
          execute format('grant execute on function %s to public', new_sig);
        elsif g.grantee <> (select proowner from pg_proc where oid = new_sig::regprocedure) then
          execute format('grant execute on function %s to %I', new_sig, (select rolname from pg_roles where oid = g.grantee));
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

-- ---------- Rechte je Kanal ----------
-- Admin im Kanal der Anfrage: Plattform-Admin, Inhaber des Kanals, früheres Admin-Häkchen
-- (nur im Standard-Kanal) oder freigegebener Mod dieses Kanals.
create or replace function public.is_admin_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and (
    public.is_site_admin_user(p_user)
    or exists (select 1 from public.channels where id = public.current_channel() and owner_id = p_user)
    or (public.current_channel() = public.default_channel()
        and coalesce((select is_admin from public.profiles where id = p_user), false))
    or public.is_mod_user(p_user)
  );
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    public.is_site_admin()
    or exists (select 1 from public.channels where id = public.current_channel() and owner_id = auth.uid())
    or exists (select 1 from public.twitch_connection where connected_by = auth.uid())
  );
$$;

-- Früheres Admin-Häkchen (profiles.is_admin): zählt nur im Standard-Kanal
create or replace function public.is_legacy_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_channel() = public.default_channel()
    and coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.overlay_can_edit()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_owner()
    or public.is_mod()
    or (public.is_legacy_admin()
        and coalesce((select admins_can_edit from public.overlay_config where id = 1), false));
$$;

create or replace function public.my_access()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'is_admin', public.is_admin(),
    'is_site_admin', public.is_legacy_admin(),
    'is_platform_admin', public.is_site_admin(),
    'is_owner', public.is_owner(),
    'is_mod', public.is_mod(),
    'is_twitch_mod', public.is_twitch_mod_user(auth.uid()),
    'mods_enabled', coalesce((select mods_enabled from public.overlay_config where id = 1), false),
    'mods_scope', coalesce((select 'moderation:read' = any(scopes) from public.twitch_connection where id = 1), false),
    'mods_count', (select count(*) from public.channel_mods),
    'channel_id', public.current_channel()
  );
$$;

-- Realtime für neue Tabellen: ab jetzt die Tabelle in core
create or replace function public.realtime_add(p_table text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_schema text := case when to_regclass('core.' || p_table) is not null then 'core' else 'public' end;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = v_schema and tablename = p_table
  ) then
    execute format('alter publication supabase_realtime add table %I.%I', v_schema, p_table);
  end if;
end;
$$;

-- OAuth-Anfragen merken sich den Kanal, für den verbunden wird
alter table public.oauth_states add column if not exists channel_id uuid references public.channels on delete cascade;

-- ---------- Funktionen mit Schlüsseln je Kanal (ON CONFLICT mit channel_id) ----------
-- Unverändert bis auf „on conflict (channel_id, …)“ bzw. die Admin-Prüfung je Kanal.

CREATE OR REPLACE FUNCTION public.bingo_new_card(p_size integer, p_free boolean DEFAULT true)
 RETURNS bingo_card
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  free boolean := coalesce(p_free, true) and p_size % 2 = 1;
  need int;
  center int := (p_size * p_size) / 2;
  names text[] := '{}';
  images text[] := '{}';
  cells jsonb := '[]';
  picked jsonb;
  r public.bingo_items;
  name_key text;
  image text;
  result public.bingo_card;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen eine neue Bingo-Karte ziehen.';
  end if;
  if p_size is null or p_size not between 3 and 5 then
    raise exception 'Die Karte kann 3×3, 4×4 oder 5×5 Felder haben.';
  end if;
  need := p_size * p_size - case when free then 1 else 0 end;

  -- Zufällige Reihenfolge, Doppelte überspringen
  for r in select * from public.bingo_items b where not b.vault order by random() loop
    name_key := lower(regexp_replace(btrim(r.name), '\s+', ' ', 'g'));
    image := coalesce(r.image_key, r.path);
    continue when name_key = any(names) or image = any(images);
    names := names || name_key;
    images := images || image;
    -- Alles vom Bild außer Datum und Verwaltungsfeldern (id, name, path, rarity, amount); leere Felder fallen weg
    cells := cells || jsonb_build_array(jsonb_strip_nulls(to_jsonb(r) - 'created_at' - 'vault' - 'image_key'));
    exit when jsonb_array_length(cells) >= need;
  end loop;
  if jsonb_array_length(cells) < need then
    raise exception 'Für eine %×%-Karte braucht es % verschiedene Items – es gibt erst %. Gleiche Waffe in anderer Seltenheit und gleiche Bilder zählen nur einmal, Items im Tresor gar nicht.',
      p_size, p_size, need, jsonb_array_length(cells);
  end if;

  -- Feld in der Mitte frei lassen
  select jsonb_agg(cell order by pos) into picked from (
    select e.cell, case when free and e.n - 1 >= center then e.n else e.n - 1 end as pos
    from jsonb_array_elements(cells) with ordinality as e(cell, n)
    union all
    select jsonb_build_object('free', true), center where free
  ) x;

  insert into public.bingo_card (id, size, cells, marked, visible, created_at, updated_at)
    values (1, p_size, picked, case when free then array[center] else '{}'::int[] end, true, now(), now())
  on conflict (channel_id, id) do update set
    size = excluded.size, cells = excluded.cells, marked = excluded.marked,
    visible = true, created_at = now(), updated_at = now()
  returning * into result;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cards_touch_player(p_key text, p_name text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.card_players (player_key, name) values (p_key, left(coalesce(p_name, ''), 40))
    on conflict (channel_id, player_key) do update set name = excluded.name, updated_at = now();
$function$;

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
  streamer text;
  reply text;
  mine bigint;
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
    if arg ~ '^@?[a-zA-Z0-9_]{3,25}$' then
      -- Nur bekannte Namen – sonst keine Antwort (der Bot wiederholt nie eingetippten Text)
      select * into w from public.watchtime where login = lower(ltrim(arg, '@')) limit 1;
      if w.twitch_id is null or w.seconds < 60 then return null; end if;
      return json_build_object('reply', format('%s schaut schon %s zu 👀', coalesce(nullif(w.display_name, ''), w.login), public.watch_fmt(w.seconds)));
    end if;
    select * into w from public.watchtime where twitch_id = p_user_id;
    if w.twitch_id is null or w.seconds < 60 then
      return json_build_object('reply', format('@%s, bei dir ist noch keine Watchtime erfasst – sie zählt, solange der Stream live ist und du im Chat bist.', who));
    end if;
    return json_build_object('reply', format('@%s schaut schon %s zu 💜', who, public.watch_fmt(w.seconds)));
  end if;

  if cmd in ('!befehle', '!commands') then
    if exists (select 1 from public.chat_cooldowns where chat_cooldowns.slot = 'cmds' and at > now() - interval '30 seconds') then
      return null;
    end if;
    insert into public.chat_cooldowns (slot, at) values ('cmds', now()) on conflict (channel_id, slot) do update set at = now();
    select string_agg(command, ' ' order by command) into reply
      from public.bot_commands where enabled and (not mod_only or is_mod);
    return json_build_object('reply', left('Befehle: !watchtime ' || coalesce(reply, ''), 480));
  end if;

  -- Eigene Befehle
  select * into c from public.bot_commands where command = cmd and enabled;
  if c.id is null then return null; end if;
  if c.mod_only and not is_mod then return null; end if;
  if c.last_used_at is not null and c.last_used_at > now() - make_interval(secs => c.cooldown_seconds) then
    return null;
  end if;
  update public.bot_commands set uses = uses + 1, last_used_at = now() where id = c.id;
  streamer := coalesce((select nullif(display_name, '') from public.twitch_connection where id = 1), 'der Streamer');
  select seconds into mine from public.watchtime where twitch_id = p_user_id;
  reply := c.response;
  reply := replace(reply, '{user}', '@' || who);
  reply := replace(reply, '{count}', (c.uses + 1)::text);
  reply := replace(reply, '{streamer}', streamer);
  reply := replace(reply, '{watchtime}', public.watch_fmt(coalesce(mine, 0)));
  return json_build_object('reply', left(reply, 480));
end;
$function$;

CREATE OR REPLACE FUNCTION public.giveaway_enter(p_key text, p_name text, p_follower boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  g public.giveaway;
  who text := public.safe_name(p_name);
  n int;
begin
  if coalesce(p_key, '') = '' then return null; end if;
  select * into g from public.giveaway where id = 1 for update;
  if g.status <> 'open' or not public.tile_started('giveaway') then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  -- Zeit abgelaufen: ab jetzt geschlossen
  if g.ends_at is not null and g.ends_at <= now() then
    update public.giveaway set status = 'closed', updated_at = now() where id = 1;
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  if exists (select 1 from public.giveaway_entries where round = g.round and player_key = p_key and kicked) then
    return json_build_object('ok', false, 'reason', 'kicked',
      'reply', case when g.confirm_in_chat then ltrim(format('%s Bei dieser Verlosung kannst du nicht mehr mitmachen.', who)) end);
  end if;
  if g.followers_only and p_follower is not true then
    return json_build_object('ok', false, 'reason', 'follower',
      'reply', ltrim(format('%s Mitmachen dürfen nur Follower – folge dem Kanal und schreib dann nochmal %s.', who, g.command)));
  end if;
  insert into public.giveaway_entries (round, player_key, name)
    values (g.round, p_key, left(coalesce(nullif(btrim(p_name), ''), 'Zuschauer'), 40))
    on conflict (channel_id, round, player_key) do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    return json_build_object('ok', false, 'reason', 'twice',
      'reply', case when g.confirm_in_chat then ltrim(format('%s Du bist schon dabei – jeder darf nur einmal mitmachen.', who)) end);
  end if;
  update public.giveaway set entries = entries + 1, updated_at = now() where id = 1 returning entries into n;
  return json_build_object('ok', true, 'entries', n,
    'reply', case when g.confirm_in_chat then ltrim(format('%s ist dabei! 🍀 (%s im Lostopf)', who, n)) end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.hotwords_block(p_word text, p_block boolean DEFAULT true)
 RETURNS hotwords
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  w text := lower(left(btrim(coalesce(p_word, '')), 30));
  h public.hotwords;
begin
  if not public.is_admin() then raise exception 'Sperren dürfen nur der Streamer und die Mods.'; end if;
  if w = '' then raise exception 'Kein Wort angegeben.'; end if;
  if coalesce(p_block, true) then
    insert into public.hotword_blocks (word) values (w) on conflict (channel_id, word) do nothing;
    delete from public.hotword_counts where word = w;
  else
    delete from public.hotword_blocks where word = w;
  end if;
  perform public.hotwords_refresh();
  select * into h from public.hotwords where id = 1;
  return h;
end;
$function$;

CREATE OR REPLACE FUNCTION public.hotwords_note(p_player text, p_words text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  h public.hotwords;
  raw text;
  w text;
  v_label text;
  n int;
  changed boolean := false;
begin
  if coalesce(p_player, '') = '' or p_words is null then return; end if;
  select * into h from public.hotwords where id = 1;
  if not found or not h.enabled or not public.tile_started('hotwords') then return; end if;
  foreach raw in array p_words[1:12] loop
    v_label := left(btrim(coalesce(raw, '')), 30);
    w := lower(v_label);
    if char_length(w) < h.min_length or w !~ '[[:alpha:]]' then continue; end if;
    if exists (select 1 from public.hotword_blocks where word = w) then continue; end if;
    -- Spam-Schutz: pro Zuschauer und Wort höchstens einmal pro Minute
    insert into public.hotword_hits (player, word, at) values (left(p_player, 40), w, now())
      on conflict (channel_id, player, word) do update set at = now() where public.hotword_hits.at < now() - interval '60 seconds';
    get diagnostics n = row_count;
    if n = 0 then continue; end if;
    insert into public.hotword_counts (word, label, n, last_at) values (w, v_label, 1, now())
      on conflict (channel_id, word) do update set n = public.hotword_counts.n + 1, last_at = now();
    changed := true;
  end loop;
  if changed then perform public.hotwords_refresh(); end if;
  -- ab und zu aufräumen
  if random() < 0.02 then delete from public.hotword_hits where at < now() - interval '10 minutes'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.overlay_preset_save(p_name text, p_params text)
 RETURNS overlay_presets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  r public.overlay_presets;
begin
  if not public.overlay_can_edit() then raise exception 'Vorlagen speichern darf nur, wer das Overlay anpassen darf.'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then raise exception 'Bitte einen Namen mit 1–40 Zeichen.'; end if;
  if char_length(coalesce(p_params, '')) > 8000 then raise exception 'Die Einstellungen sind zu lang.'; end if;
  if (select count(*) from public.overlay_presets) >= 50 and not exists (select 1 from public.overlay_presets where lower(name) = lower(v_name)) then
    raise exception 'Höchstens 50 Vorlagen – lösch erst eine alte.';
  end if;
  insert into public.overlay_presets (name, params, created_by)
    values (v_name, coalesce(p_params, ''), coalesce((select username from public.profiles where id = auth.uid()), ''))
    on conflict (channel_id, (lower(name))) do update set params = excluded.params, updated_at = now()
    returning * into r;
  return r;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pause_guess(p_key text, p_name text, p_guess text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p public.pause_screen;
  secret int;
  g int;
  hint text;
begin
  if coalesce(btrim(p_guess), '') !~ '^\d{1,5}$' or p_key is null then return null; end if;
  g := btrim(p_guess)::int;
  select * into p from public.pause_screen where id = 1 for update;
  if not p.active or not p.game_on or g < 1 or g > p.game_max then return null; end if;
  if exists (select 1 from public.pause_cooldowns where player_key = p_key and last_at > now() - interval '3 seconds') then
    return null;
  end if;
  insert into public.pause_cooldowns (player_key, last_at) values (p_key, now())
    on conflict (channel_id, player_key) do update set last_at = now();
  select number into secret from public.pause_secret where id = 1;
  hint := case when g = secret then 'hit' when g < secret then 'higher' else 'lower' end;
  update public.pause_screen set
    game_guesses = game_guesses + 1,
    game_low = case when hint = 'higher' then greatest(game_low, g + 1) else game_low end,
    game_high = case when hint = 'lower' then least(game_high, g - 1) else game_high end,
    game_last = jsonb_build_object('n', coalesce((game_last ->> 'n')::int, 0) + 1, 'who', left(p_name, 40), 'guess', g, 'hint', hint, 'at', now()),
    game_winners = case when hint = 'hit'
      then (jsonb_build_array(jsonb_build_object('who', left(p_name, 40), 'round', game_round, 'guesses', game_guesses + 1, 'number', secret, 'at', now())) || game_winners) - 5
      else game_winners end,
    game_round = case when hint = 'hit' then game_round + 1 else game_round end,
    updated_at = now()
  where id = 1;
  if hint = 'hit' then
    perform public.pause_new_round(p.game_max);
    perform public.bot_say(format('🎉 %s hat die Zahl %s erraten! Neue Runde: Zahl zwischen 1 und %s – %s ZAHL', left(p_name, 40), secret, p.game_max, p.guess_command));
  end if;
  delete from public.pause_cooldowns where last_at < now() - interval '1 hour';
  return json_build_object('hint', hint, 'guess', g);
end;
$function$;

CREATE OR REPLACE FUNCTION public.queue_join(p_key text, p_name text, p_epic text, p_sub boolean, p_source text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cfg public.queue_settings;
  epic text := left(btrim(coalesce(p_epic, '')), 32);
  known text;
  pos int;
  who text := public.safe_name(p_name);
begin
  if p_key is null then return null; end if;
  select * into cfg from public.queue_settings where id = 1;
  if not cfg.open or not public.tile_started('queue') then
    return json_build_object('ok', false, 'reason', 'closed', 'reply', ltrim(format('%s Die Warteschlange ist gerade zu.', who)));
  end if;
  if epic <> '' and epic !~ '^[[:alnum:] ._-]{3,32}$' then
    return json_build_object('ok', false, 'reason', 'epic', 'reply', ltrim(format('%s Der Epic-Name sieht komisch aus (3–32 Zeichen, Buchstaben, Zahlen, . _ -).', who)));
  end if;
  if epic <> '' then
    insert into public.queue_players (player_key, epic_name) values (p_key, epic)
      on conflict (channel_id, player_key) do update set epic_name = excluded.epic_name, updated_at = now();
  else
    select epic_name into known from public.queue_players where player_key = p_key;
    if known is null then
      return json_build_object('ok', false, 'reason', 'epic', 'reply', ltrim(format('%s Schreib deinen Epic-Namen dazu: !join DeinEpicName', who)));
    end if;
  end if;
  if exists (select 1 from public.queue_entries where player_key = p_key and status = 'picked') then
    return json_build_object('ok', true, 'picked', true, 'reply', ltrim(format('%s Du bist schon dran!', who)));
  end if;
  if not exists (select 1 from public.queue_entries where player_key = p_key and status = 'waiting') then
    if (select count(*) from public.queue_entries where status = 'waiting') >= cfg.max_size then
      return json_build_object('ok', false, 'reason', 'full', 'reply', ltrim(format('%s Die Warteschlange ist voll.', who)));
    end if;
    insert into public.queue_entries (player_key, name, is_sub, source) values (p_key, left(p_name, 40), coalesce(p_sub, false), p_source);
  else
    update public.queue_entries set name = left(p_name, 40), is_sub = is_sub or coalesce(p_sub, false), updated_at = now()
      where player_key = p_key and status = 'waiting';
  end if;
  pos := public.queue_position(p_key);
  return json_build_object('ok', true, 'position', pos, 'reply', ltrim(format('%s Du stehst auf Platz %s.', who, pos)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.quiz_reveal()
 RETURNS quiz_round
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.quiz_round;
  right_choice int;
  right_count int;
  letters text[] := array['A', 'B', 'C', 'D'];
  fastest text;
  result public.quiz_round;
begin
  if not public.is_admin() then raise exception 'Auflösen dürfen nur der Streamer und die Mods.'; end if;
  select * into r from public.quiz_round where id = 1 for update;
  if r.status <> 'open' then raise exception 'Gerade ist keine Frage offen.'; end if;
  select correct into right_choice from public.quiz_secret where id = 1;

  with scored as (
    select a.player_key, a.name, a.choice = right_choice as ok,
      case when a.choice = right_choice then 10 + greatest(0, least(5, round(5 * (1 - extract(epoch from a.created_at - r.opened_at)
        / greatest(1, extract(epoch from r.closes_at - r.opened_at))))::int)) else 0 end as pts
    from public.quiz_answers a where a.round_n = r.n
  )
  insert into public.quiz_scores as s (player_key, name, points, correct, answered)
    select player_key, name, pts, ok::int, 1 from scored
  on conflict (channel_id, player_key) do update set
    name = excluded.name, points = s.points + excluded.points, correct = s.correct + excluded.correct,
    answered = s.answered + 1, updated_at = now();

  select count(*) into right_count from public.quiz_answers where round_n = r.n and choice = right_choice;
  update public.quiz_round set
    status = 'revealed', correct = right_choice,
    closes_at = least(closes_at, now()),
    winners = coalesce((
      select jsonb_agg(jsonb_build_object('name', name) order by created_at)
      from (select name, created_at from public.quiz_answers where round_n = r.n and choice = right_choice order by created_at limit 5) w
    ), '[]'::jsonb),
    updated_at = now()
  where id = 1 returning * into result;
  select name into fastest from public.quiz_answers where round_n = r.n and choice = right_choice order by created_at limit 1;
  perform public.bot_say(format('✅ Richtig war %s) %s – %s von %s lagen richtig.%s', letters[right_choice + 1], r.answers[right_choice + 1],
    right_count, r.answered, case when fastest is not null then format(' Am schnellsten: %s!', fastest) else '' end));
  delete from public.quiz_scores where updated_at < now() - interval '365 days';
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.watch_add(p_users jsonb, p_seconds integer, p_source text DEFAULT ''::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  secs int := greatest(0, least(coalesce(p_seconds, 0), 900));
  n int;
begin
  insert into public.watchtime (twitch_id, login, display_name, seconds, last_seen_at)
  select u ->> 'id', left(coalesce(u ->> 'login', ''), 40), left(coalesce(u ->> 'name', ''), 60), secs, now()
  from jsonb_array_elements(coalesce(p_users, '[]'::jsonb)) u
  where (u ->> 'id') ~ '^[0-9]{1,20}$'
  on conflict (channel_id, twitch_id) do update set
    seconds = public.watchtime.seconds + excluded.seconds,
    login = case when excluded.login <> '' then excluded.login else public.watchtime.login end,
    display_name = case when excluded.display_name <> '' then excluded.display_name else public.watchtime.display_name end,
    last_seen_at = now(),
    updated_at = now();
  get diagnostics n = row_count;
  update public.watch_state set live = true, source = left(coalesce(p_source, ''), 20), viewers = n where id = 1;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.watch_seen(p_id text, p_login text, p_name text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.watchtime (twitch_id, login, display_name, last_chat_at)
  select p_id, left(coalesce(p_login, ''), 40), left(coalesce(p_name, ''), 60), now()
  where coalesce(p_id, '') ~ '^[0-9]{1,20}$'
  on conflict (channel_id, twitch_id) do update set
    last_chat_at = now(),
    login = case when excluded.login <> '' then excluded.login else public.watchtime.login end,
    display_name = case when excluded.display_name <> '' then excluded.display_name else public.watchtime.display_name end;
$function$;

CREATE OR REPLACE FUNCTION public.wheel_variants_save(p_variants jsonb)
 RETURNS SETOF wheel_variants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v jsonb;
  s jsonb;
  pos int := 0;
  vid text;
  ids text[] := '{}';
  segs jsonb;
  b jsonb;
  bsegs jsonb;
begin
  if not public.is_admin() then
    raise exception 'Das Glücksrad dürfen nur Admins bearbeiten.';
  end if;
  if jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants) < 1 then
    raise exception 'Mindestens eine Variante wird gebraucht.';
  end if;
  if jsonb_array_length(p_variants) > 8 then
    raise exception 'Höchstens 8 Varianten.';
  end if;

  -- Erst alles prüfen, dann schreiben
  for v in select * from jsonb_array_elements(p_variants) loop
    if jsonb_typeof(v) is distinct from 'object' then
      raise exception 'Ungültige Variante.';
    end if;
    vid := nullif(btrim(coalesce(v ->> 'id', '')), '');
    if vid is not null and vid !~ '^[a-z0-9-]{1,40}$' then
      raise exception 'Ungültige Varianten-ID.';
    end if;
    if vid = any(ids) then
      raise exception 'Eine Variante ist doppelt.';
    end if;
    if vid is not null then ids := ids || vid; end if;
    if char_length(btrim(coalesce(v ->> 'name', ''))) not between 1 and 40 then
      raise exception 'Jede Variante braucht einen Namen (höchstens 40 Zeichen).';
    end if;
    if char_length(coalesce(v ->> 'description', '')) > 160 then
      raise exception 'Die Beschreibung ist zu lang (höchstens 160 Zeichen).';
    end if;
    if coalesce(v ->> 'color', '') !~ '^#[0-9a-fA-F]{6}$' then
      raise exception 'Ungültige Farbe.';
    end if;
    segs := v -> 'segments';
    if jsonb_typeof(segs) is distinct from 'array' or jsonb_array_length(segs) not between 2 and 16 then
      raise exception 'Jede Variante braucht 2 bis 16 Ergebnisse.';
    end if;
    for s in select * from jsonb_array_elements(segs) loop
      if jsonb_typeof(s) is distinct from 'object'
        or char_length(btrim(coalesce(s ->> 'label', ''))) not between 1 and 32 then
        raise exception 'Jedes Ergebnis braucht einen Titel (höchstens 32 Zeichen).';
      end if;
      if char_length(coalesce(s ->> 'detail', '')) > 200 then
        raise exception 'Eine Erklärung ist zu lang (höchstens 200 Zeichen).';
      end if;
    end loop;
    -- Zweites Rad (optional), z. B. die Seltenheit nach der Waffe
    b := v -> 'bonus';
    if b is not null and jsonb_typeof(b) <> 'null' then
      if jsonb_typeof(b) <> 'object' or char_length(btrim(coalesce(b ->> 'name', ''))) not between 1 and 40 then
        raise exception 'Das zweite Rad braucht einen Namen (höchstens 40 Zeichen).';
      end if;
      bsegs := b -> 'segments';
      if jsonb_typeof(bsegs) is distinct from 'array' or jsonb_array_length(bsegs) not between 2 and 16 then
        raise exception 'Das zweite Rad braucht 2 bis 16 Ergebnisse.';
      end if;
      for s in select * from jsonb_array_elements(bsegs) loop
        if jsonb_typeof(s) is distinct from 'object'
          or char_length(btrim(coalesce(s ->> 'label', ''))) not between 1 and 32 then
          raise exception 'Jedes Ergebnis im zweiten Rad braucht einen Titel (höchstens 32 Zeichen).';
        end if;
        if char_length(coalesce(s ->> 'detail', '')) > 200 then
          raise exception 'Eine Erklärung ist zu lang (höchstens 200 Zeichen).';
        end if;
        if coalesce(s ->> 'color', '') <> '' and s ->> 'color' !~ '^#[0-9a-fA-F]{6}$' then
          raise exception 'Ungültige Farbe im zweiten Rad.';
        end if;
      end loop;
    end if;
  end loop;

  -- Varianten, die nicht mehr in der Liste stehen, fallen weg
  delete from public.wheel_variants where id <> all(ids);

  for v in select * from jsonb_array_elements(p_variants) loop
    pos := pos + 1;
    vid := coalesce(nullif(btrim(coalesce(v ->> 'id', '')), ''), 'v-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10));
    select jsonb_agg(jsonb_build_object('label', btrim(e ->> 'label'), 'detail', btrim(coalesce(e ->> 'detail', ''))) order by n)
      into segs
      from jsonb_array_elements(v -> 'segments') with ordinality as t(e, n);
    b := null;
    if jsonb_typeof(v -> 'bonus') = 'object' then
      select jsonb_build_object('name', btrim(v -> 'bonus' ->> 'name'), 'segments', jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object('label', btrim(e ->> 'label'), 'detail', btrim(coalesce(e ->> 'detail', '')),
            'color', lower(nullif(e ->> 'color', ''))))
          order by n))
        into b
        from jsonb_array_elements(v -> 'bonus' -> 'segments') with ordinality as t(e, n);
    end if;
    insert into public.wheel_variants (id, position, name, description, color, segments, bonus)
    values (vid, pos, btrim(v ->> 'name'), btrim(coalesce(v ->> 'description', '')), lower(v ->> 'color'), segs, b)
    on conflict (channel_id, id) do update set
      position = excluded.position, name = excluded.name, description = excluded.description,
      color = excluded.color, segments = excluded.segments, bonus = excluded.bonus;
  end loop;

  return query select * from public.wheel_variants order by position;
end;
$function$;

CREATE OR REPLACE FUNCTION public.before_idea_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin_user(new.user_id)
     and (select count(*) from public.ideas
          where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Du hast heute schon 5 Vorschläge gemacht. Morgen geht es weiter.';
  end if;
  new.author := coalesce((select username from public.profiles where id = new.user_id), '');
  new.created_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mirror_spin_to_overlay()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Von der Webseite zählt nur, was ein Admin dreht (z. B. Dave zum Testen).
  if new.source = 'web'
     and not public.is_admin_user(new.user_id) then
    return new;
  end if;
  insert into public.overlay_spins (id, created_at, source, variant_id, variant_name, segment_index, result, detail, requested_by,
                                    bonus_name, bonus_index, bonus_result, bonus_detail)
  values (new.id, new.created_at, new.source, new.variant_id, new.variant_name, new.segment_index, new.result, new.detail, new.requested_by,
          new.bonus_name, new.bonus_index, new.bonus_result, new.bonus_detail)
  on conflict (id) do nothing;
  delete from public.overlay_spins where created_at < now() - interval '2 days';
  return new;
exception when others then
  -- Das Overlay ist Zugabe: Ein Fehler hier darf die eigentliche Drehung nie blockieren.
  raise warning 'overlay_spins: Spiegeln fehlgeschlagen: %', sqlerrm;
  return new;
end;
$function$;


-- ---------- Konto: Zuschauer oder Streamer? ----------
-- Wird nach der ersten Anmeldung einmal gefragt (null = noch nicht gefragt)
alter table public.profiles add column if not exists account_type text check (account_type in ('viewer', 'streamer'));

create or replace function public.profile_set_type(p_type text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Bitte zuerst anmelden.'; end if;
  if p_type not in ('viewer', 'streamer') then raise exception 'Unbekannte Auswahl.'; end if;
  update public.profiles set account_type = p_type where id = auth.uid();
end;
$$;
revoke execute on function public.profile_set_type(text) from public, anon;
grant execute on function public.profile_set_type(text) to authenticated;

-- ---------- Kanäle ----------
-- Öffentliche Angaben eines Kanals
create or replace function public.channel_public(c public.channels)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('id', c.id, 'login', c.login, 'display_name', c.display_name,
    'avatar_url', c.avatar_url, 'is_default', c.is_default, 'status', c.status,
    'is_owner', c.owner_id is not null and c.owner_id = auth.uid());
$$;
revoke execute on function public.channel_public(public.channels) from public, anon, authenticated;

-- Alle freigeschalteten Kanäle (Startseite: Streamer-Liste)
create or replace function public.channels_list()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(public.channel_public(c) order by c.is_default desc, lower(c.display_name)), '[]'::json)
  from public.channels c where c.status = 'active';
$$;
grant execute on function public.channels_list() to anon, authenticated;

-- Einen Kanal finden (Link #/c/<login>): ID oder Twitch-Login, ohne Angabe der Standard-Kanal.
-- Nicht freigeschaltete Kanäle sehen nur der Inhaber und der Plattform-Admin.
create or replace function public.channel_info(p_key text default null)
returns json language sql stable security definer set search_path = '' as $$
  select public.channel_public(c) from public.channels c
  where case
      when nullif(btrim(p_key), '') is null then c.is_default
      when p_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then c.id = p_key::uuid
      else c.login = lower(btrim(p_key)) end
    and (c.status = 'active' or (c.owner_id is not null and c.owner_id = auth.uid()) or public.is_site_admin());
$$;
grant execute on function public.channel_info(text) to anon, authenticated;

-- Mein Kanal (auch während er noch auf die Freischaltung wartet)
create or replace function public.channel_mine()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('id', c.id, 'login', c.login, 'display_name', c.display_name, 'avatar_url', c.avatar_url,
    'status', c.status, 'is_default', c.is_default, 'note', c.note, 'admin_note', c.admin_note,
    'created_at', c.created_at, 'approved_at', c.approved_at)
  from public.channels c where auth.uid() is not null and c.owner_id = auth.uid();
$$;
revoke execute on function public.channel_mine() from public, anon;
grant execute on function public.channel_mine() to authenticated;

-- Als Streamer bewerben: nur mit Twitch-Anmeldung (so ist sicher, dass der Kanal dir gehört)
create or replace function public.channel_apply(p_note text default '')
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_tid text;
  meta jsonb;
  v_login text;
  c public.channels;
begin
  if uid is null then raise exception 'Bitte zuerst anmelden.'; end if;
  select * into c from public.channels where owner_id = uid;
  if c.id is not null then return public.channel_mine(); end if;
  select provider_id, coalesce(identity_data, '{}'::jsonb) into v_tid, meta
    from auth.identities where user_id = uid and provider = 'twitch' limit 1;
  if v_tid is null then
    raise exception 'Als Streamer meldest du dich mit Twitch an – so ist klar, dass der Kanal dir gehört.';
  end if;
  v_login := lower(coalesce(nullif(meta ->> 'name', ''), nullif(meta ->> 'full_name', ''),
                            nullif(meta ->> 'preferred_username', ''), nullif(meta ->> 'nickname', '')));
  if v_login is null or v_login !~ '^[a-z0-9_]{1,25}$' then
    raise exception 'Deinen Twitch-Namen konnten wir nicht lesen. Bitte einmal ab- und wieder mit Twitch anmelden.';
  end if;

  select * into c from public.channels where twitch_id = v_tid;
  if c.id is not null then
    -- Den Kanal gibt es schon (z. B. der bisherige Kanal) – ohne Inhaber übernimmt ihn sein Twitch-Konto
    if c.owner_id is not null and c.owner_id <> uid then
      raise exception 'Dieser Twitch-Kanal ist schon mit einem anderen StreamHelp-Konto angemeldet.';
    end if;
    update public.channels set owner_id = uid, login = coalesce(login, v_login) where id = c.id;
  else
    if exists (select 1 from public.channels where login = v_login) then
      raise exception 'Der Kanalname % ist schon vergeben.', v_login;
    end if;
    insert into public.channels (login, twitch_id, display_name, avatar_url, owner_id, note)
    values (v_login, v_tid,
            left(coalesce(nullif(meta ->> 'nickname', ''), nullif(meta ->> 'slug', ''), v_login), 40),
            left(coalesce(nullif(meta ->> 'avatar_url', ''), nullif(meta ->> 'picture', ''), ''), 500),
            uid, left(btrim(coalesce(p_note, '')), 300));
  end if;
  update public.profiles set account_type = 'streamer' where id = uid;
  return public.channel_mine();
end;
$$;
revoke execute on function public.channel_apply(text) from public, anon;
grant execute on function public.channel_apply(text) to authenticated;

-- Zeilen eines Kanals als Vorlage in den aktuellen Kanal kopieren (für channel_seed)
create or replace function public.channel_copy_rows(p_table text, p_from uuid, p_skip text[] default '{}', p_where text default 'true')
returns int language plpgsql security definer set search_path = '' as $$
declare
  cols text;
  n int;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
  from pg_attribute a
  where a.attrelid = ('core.' || p_table)::regclass and a.attnum > 0 and not a.attisdropped
    and a.attname <> all (p_skip || array['channel_id']::text[]);
  execute format('insert into public.%I (%s) select %s from core.%I where channel_id = $1 and (%s) on conflict do nothing',
                 p_table, cols, cols, p_table, p_where) using p_from;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.channel_copy_rows(text, uuid, text[], text) from public, anon, authenticated;

-- Neuen Kanal einrichten: Grundeinstellungen + Kacheln, Glücksräder, Quizfragen und Karten
-- aus dem Standard-Kanal als Vorlage. Mehrfach aufrufbar (legt nur Fehlendes an).
create or replace function public.channel_seed(p_channel uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  prev text := current_setting('app.channel', true);
  v_from uuid := public.default_channel();
  t text;
begin
  if p_channel is null then return; end if;
  perform set_config('app.channel', p_channel::text, true);
  foreach t in array array['alert_config', 'card_settings', 'forbidden_word', 'giveaway', 'hotwords', 'overlay_config',
                           'pause_screen', 'pet', 'prank_settings', 'question_stage', 'queue_settings', 'quiz_round',
                           'quiz_secret', 'shop_settings', 'site_guard', 'subathon', 'ticker', 'tts_settings', 'tts_state',
                           'twitch_health', 'watch_state', 'win_challenge'] loop
    execute format('insert into public.%I (id) values (1) on conflict do nothing', t);
  end loop;
  insert into public.pause_secret (id, number) values (1, 1 + floor(random() * 100)::int) on conflict do nothing;
  if p_channel <> v_from then
    if not exists (select 1 from public.tiles) then
      perform public.channel_copy_rows('tiles', v_from, array['target_at', 'updated_at']);
    end if;
    if not exists (select 1 from public.wheel_variants) then
      perform public.channel_copy_rows('wheel_variants', v_from);
    end if;
    if not exists (select 1 from public.quiz_questions) then
      perform public.channel_copy_rows('quiz_questions', v_from, array['id', 'used_at', 'created_at']);
    end if;
    -- Nur Karten ohne eigenes Bild (die Bilder gehören dem anderen Kanal)
    if not exists (select 1 from public.card_defs) then
      perform public.channel_copy_rows('card_defs', v_from, array['id', 'created_at'], $w$coalesce(image_path, '') = ''$w$);
    end if;
  end if;
  if not exists (select 1 from public.bot_commands) then
    insert into public.bot_commands (command, response, enabled) values
      ('!lurk', '{user} macht es sich gemütlich und lurkt mit. Danke fürs Dabeibleiben! 💜', true),
      ('!hydrate', 'Trinkpause! {streamer} und alle im Chat: einmal Wasser trinken 💧', true),
      ('!socials', 'Alle Links von {streamer} stehen unten im Laufband 🔗', false);
  end if;
  perform set_config('app.channel', coalesce(prev, ''), true);
end;
$$;
revoke execute on function public.channel_seed(uuid) from public, anon, authenticated;

-- Plattform-Admin (auf der Webseite oder über den Admin-Bereich): alle Kanäle mit Bewerbungen
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
      'connected', exists (select 1 from core.twitch_connection t where t.channel_id = c.id))
    order by (c.status = 'pending') desc, c.created_at desc), '[]'::json)
    from public.channels c);
end;
$$;
revoke execute on function public.channels_admin() from public, anon;
grant execute on function public.channels_admin() to authenticated;

-- Plattform-Admin: freischalten, sperren oder zurück auf „wartet“
create or replace function public.channel_set_status(p_channel uuid, p_status text, p_admin_note text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  c public.channels;
begin
  if not (public.is_site_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Nur für den Plattform-Admin.';
  end if;
  if p_status not in ('pending', 'active', 'blocked') then raise exception 'Unbekannter Status.'; end if;
  select * into c from public.channels where id = p_channel for update;
  if c.id is null then raise exception 'Diesen Kanal gibt es nicht.'; end if;
  if c.is_default and p_status <> 'active' then raise exception 'Der Standard-Kanal bleibt immer aktiv.'; end if;
  update public.channels set
    status = p_status,
    admin_note = coalesce(left(btrim(p_admin_note), 300), admin_note),
    approved_at = case when p_status = 'active' then coalesce(approved_at, now()) else approved_at end,
    approved_by = case when p_status = 'active' then coalesce(approved_by, auth.uid()) else approved_by end
  where id = p_channel;
  if p_status = 'active' then perform public.channel_seed(p_channel); end if;
  return public.channels_admin();
end;
$$;
revoke execute on function public.channel_set_status(uuid, text, text) from public, anon;
grant execute on function public.channel_set_status(uuid, text, text) to authenticated;

-- Edge Functions: Kanal zu einer Twitch-ID (EventSub: broadcaster_user_id)
create or replace function public.channel_by_twitch(p_twitch_id text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.channels where twitch_id = p_twitch_id and status = 'active';
$$;
revoke execute on function public.channel_by_twitch(text) from public, anon, authenticated;
grant execute on function public.channel_by_twitch(text) to service_role;

-- Standard-Kanal: fehlende Grundeinstellungen anlegen
do $$ begin perform public.channel_seed(public.default_channel()); end $$;

notify pgrst, 'reload schema';

commit;
