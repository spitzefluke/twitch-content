-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- „Ärgere den Dave“: Zuschauer werfen Bananen & Co. auf Dave oder
-- spielen Sounds in den Stream. Zu sehen und zu hören im OBS-Overlay.
--
--   · Kachel „Ärgere den Dave“ im Fahrplan
--   · prank_settings: an/aus, Pause zwischen zwei Aktionen, eigene Sounds erlaubt
--   · sounds + Storage-Bucket "sounds": eigene Sounds (max. 1 MB, 10 Sekunden)
--   · pranks: öffentlicher Feed fürs Overlay – geschrieben nur über send_prank()
-- Mehrfach ausführbar.
-- ============================================================

-- ---------- Kachel ----------
alter table public.tiles drop constraint if exists tiles_kind_check;
alter table public.tiles add constraint tiles_kind_check check (kind in ('wheel', 'countdown', 'prank', 'bingo'));

do $$
begin
  if not exists (select 1 from public.tiles where id = 'prank') then
    -- als nächste Idee direkt hinter das Glücksrad
    update public.tiles set position = position + 1 where kind = 'countdown';
    insert into public.tiles (id, position, kind, title, description, theme, target_at) values
      ('prank', 2, 'prank', 'Ärgere den Dave',
       'Bananen, Tomaten, Torten – wirf was auf Dave oder spiel ihm deine eigenen Sounds in den Stream.',
       'prank', null);
  end if;
end;
$$;

-- ---------- Einstellungen ----------
create table if not exists public.prank_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  cooldown_seconds int not null default 20 check (cooldown_seconds between 0 and 3600),
  allow_uploads boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.prank_settings (id) values (1) on conflict (id) do nothing;
alter table public.prank_settings enable row level security;

drop policy if exists "prank_settings: lesen für angemeldete" on public.prank_settings;
create policy "prank_settings: lesen für angemeldete" on public.prank_settings
  for select to authenticated using (true);
drop policy if exists "prank_settings: ändern nur admin" on public.prank_settings;
create policy "prank_settings: ändern nur admin" on public.prank_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- Eigene Sounds ----------
-- Die Dateien liegen im öffentlichen Bucket "sounds" unter <user_id>/<datei>,
-- damit OBS sie ohne Anmeldung abspielen kann.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sounds', 'sounds', true, 1048576, array[
  'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac'
])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "sounds: hochladen in eigenen Ordner" on storage.objects;
create policy "sounds: hochladen in eigenen Ordner" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'sounds'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and ((select allow_uploads from public.prank_settings where id = 1) or (select public.is_admin()))
  );
-- Löschen braucht bei Supabase Storage auch Leserechte auf die Zeile.
drop policy if exists "sounds: eigene Dateien sehen" on storage.objects;
create policy "sounds: eigene Dateien sehen" on storage.objects
  for select to authenticated using (
    bucket_id = 'sounds'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );
drop policy if exists "sounds: löschen selbst oder admin" on storage.objects;
create policy "sounds: löschen selbst oder admin" on storage.objects
  for delete to authenticated using (
    bucket_id = 'sounds'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

create table if not exists public.sounds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  path text not null unique,
  duration real not null check (duration > 0 and duration <= 10.5),
  author text not null default '',
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists sounds_created_at_idx on public.sounds (created_at desc);
alter table public.sounds enable row level security;

drop policy if exists "sounds: lesen für angemeldete" on public.sounds;
create policy "sounds: lesen für angemeldete" on public.sounds
  for select to authenticated using (true);
drop policy if exists "sounds: anlegen für angemeldete" on public.sounds;
create policy "sounds: anlegen für angemeldete" on public.sounds
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and path like (select auth.uid())::text || '/%'
    and ((select allow_uploads from public.prank_settings where id = 1) or (select public.is_admin()))
  );
drop policy if exists "sounds: löschen selbst oder admin" on public.sounds;
create policy "sounds: löschen selbst oder admin" on public.sounds
  for delete to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Name der Person aus dem Profil (nicht vom Browser) und höchstens 8 Sounds pro Person.
create or replace function public.before_sound_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.sounds where user_id = new.user_id) >= 8 then
    raise exception 'Du hast schon 8 Sounds hochgeladen. Lösch einen, um Platz zu schaffen.';
  end if;
  new.author := coalesce((select username from public.profiles where id = new.user_id), '');
  return new;
end;
$$;
drop trigger if exists on_sound_insert on public.sounds;
create trigger on_sound_insert
  before insert on public.sounds
  for each row execute function public.before_sound_insert();

-- ---------- Feed fürs Overlay ----------
-- Ohne user_id: Realtime schickt die ganze Zeile an alle, auch an OBS (anon).
create table if not exists public.pranks (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('throw', 'sound')),
  item text not null check (item ~ '^[a-z0-9_-]{1,24}$'),  -- Wurfgegenstand bzw. eingebauter Sound, "custom" = eigener Sound
  sound_path text,                                          -- Pfad im Bucket "sounds" bei eigenen Sounds
  label text not null default '',                           -- Name des eigenen Sounds
  requested_by text not null
);
create index if not exists pranks_created_at_idx on public.pranks (created_at desc);
alter table public.pranks enable row level security;

drop policy if exists "pranks: lesen für alle" on public.pranks;
create policy "pranks: lesen für alle" on public.pranks
  for select to anon, authenticated using (true);
grant select on public.pranks to anon, authenticated;

-- Wann hat wer zuletzt etwas geschickt? Nur für die Pause, nicht lesbar.
create table if not exists public.prank_cooldowns (
  user_id uuid primary key references auth.users on delete cascade,
  last_at timestamptz not null
);
alter table public.prank_cooldowns enable row level security;

-- Einziger Weg in den Feed: prüft Anmeldung, Pause und ob Dave das Ärgern erlaubt.
-- Admins sind von der Pause ausgenommen und dürfen auch, wenn es ausgeschaltet ist.
create or replace function public.send_prank(p_kind text, p_item text, p_sound uuid default null)
returns public.pranks language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  admin boolean := public.is_admin();
  cfg public.prank_settings;
  who text;
  last timestamptz;
  wait_s int;
  snd public.sounds;
  result public.pranks;
begin
  if uid is null then
    raise exception 'Bitte zuerst anmelden.';
  end if;
  select * into cfg from public.prank_settings where id = 1;
  if not coalesce(cfg.enabled, true) and not admin then
    raise exception 'Dave hat „Ärgere den Dave“ gerade pausiert.' using hint = 'paused';
  end if;

  if not admin and coalesce(cfg.cooldown_seconds, 0) > 0 then
    select last_at into last from public.prank_cooldowns where user_id = uid for update;
    if last is not null and last > now() - make_interval(secs => cfg.cooldown_seconds) then
      wait_s := ceil(extract(epoch from (last + make_interval(secs => cfg.cooldown_seconds) - now())))::int;
      raise exception 'Kurz durchatmen: noch % Sekunden bis zur nächsten Aktion.', wait_s using hint = 'cooldown:' || wait_s;
    end if;
  end if;

  who := coalesce((select username from public.profiles where id = uid), 'jemand');

  if p_kind = 'sound' and p_sound is not null then
    select * into snd from public.sounds where id = p_sound;
    if not found then
      raise exception 'Diesen Sound gibt es nicht mehr.';
    end if;
    insert into public.pranks (kind, item, sound_path, label, requested_by)
      values ('sound', 'custom', snd.path, snd.name, who)
      returning * into result;
  elsif p_kind in ('throw', 'sound') and p_item ~ '^[a-z0-9_-]{1,24}$' and p_item <> 'custom' then
    insert into public.pranks (kind, item, requested_by)
      values (p_kind, p_item, who)
      returning * into result;
  else
    raise exception 'Unbekannte Aktion.';
  end if;

  insert into public.prank_cooldowns (user_id, last_at) values (uid, now())
    on conflict (user_id) do update set last_at = excluded.last_at;
  -- Das Overlay braucht nur die letzten Minuten, die Seite die letzten Einträge.
  delete from public.pranks where created_at < now() - interval '2 days';
  return result;
end;
$$;
revoke execute on function public.send_prank(text, text, uuid) from public, anon;
grant execute on function public.send_prank(text, text, uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pranks'
  ) then
    alter publication supabase_realtime add table public.pranks;
  end if;
end;
$$;
