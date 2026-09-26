-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Alerts: Bits dazu und eigene Alert-Sounds.
--   · stream_alerts.kind 'bits' (amount = Anzahl Bits, message = Cheer-Nachricht)
--   · alert_test('bits'), alerts_status() meldet auch das Bits-Recht (bits:read)
--   · alert_sounds + öffentlicher Bucket "alert-sounds": Admins laden eigene Sounds
--     für die Alerts hoch (höchstens 1 MB, 10 Sekunden, 30 Stück). Getrennt von den
--     Sounds aus „Ärgere den Dave“, damit Zuschauer sie nicht abspielen können.
-- Braucht 20261005000000_stream_alerts.sql. Für echte Bits-Alerts muss Dave Twitch
-- einmal neu verbinden (neues Recht bits:read). Mehrfach ausführbar.
-- ============================================================

alter table public.stream_alerts drop constraint if exists stream_alerts_kind_check;
alter table public.stream_alerts add constraint stream_alerts_kind_check
  check (kind in ('follow', 'sub', 'resub', 'gift', 'bits'));

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
    case when p_kind = 'resub' then 'Test-Nachricht: Weiter so, Dave!'
         when p_kind = 'bits' then 'Test-Cheer: Volle Fahrt voraus!'
         else '' end,
    true
  )
  returning * into result;
  delete from public.stream_alerts where test and created_at < now() - interval '1 day';
  return result;
end;
$$;

create or replace function public.alerts_status()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'connected', exists (select 1 from public.twitch_connection where id = 1),
    'follows', coalesce((select 'moderator:read:followers' = any(scopes) from public.twitch_connection where id = 1), false),
    'subs', coalesce((select 'channel:read:subscriptions' = any(scopes) from public.twitch_connection where id = 1), false),
    'bits', coalesce((select 'bits:read' = any(scopes) from public.twitch_connection where id = 1), false)
  );
$$;

revoke execute on function public.alert_test(text) from public, anon;
revoke execute on function public.alerts_status() from public, anon;
grant execute on function public.alert_test(text) to authenticated;
grant execute on function public.alerts_status() to authenticated;

-- ---------- Eigene Alert-Sounds ----------
-- Öffentlicher Bucket: OBS spielt die Dateien ohne Anmeldung ab.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('alert-sounds', 'alert-sounds', true, 1048576, array[
  'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac'
])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "alert-sounds: hochladen nur admin" on storage.objects;
create policy "alert-sounds: hochladen nur admin" on storage.objects
  for insert to authenticated with check (bucket_id = 'alert-sounds' and (select public.is_admin()));
-- Löschen braucht bei Supabase Storage auch Leserechte auf die Zeile.
drop policy if exists "alert-sounds: sehen nur admin" on storage.objects;
create policy "alert-sounds: sehen nur admin" on storage.objects
  for select to authenticated using (bucket_id = 'alert-sounds' and (select public.is_admin()));
drop policy if exists "alert-sounds: löschen nur admin" on storage.objects;
create policy "alert-sounds: löschen nur admin" on storage.objects
  for delete to authenticated using (bucket_id = 'alert-sounds' and (select public.is_admin()));

create table if not exists public.alert_sounds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  path text not null unique check (path ~ '^[a-z0-9-]+\.[a-z0-9]{2,4}$'),
  duration real not null check (duration > 0 and duration <= 10.5),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists alert_sounds_created_idx on public.alert_sounds (created_at desc);
alter table public.alert_sounds enable row level security;

drop policy if exists "alert_sounds: lesen für angemeldete" on public.alert_sounds;
create policy "alert_sounds: lesen für angemeldete" on public.alert_sounds
  for select to authenticated using (true);
drop policy if exists "alert_sounds: anlegen nur admin" on public.alert_sounds;
create policy "alert_sounds: anlegen nur admin" on public.alert_sounds
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "alert_sounds: löschen nur admin" on public.alert_sounds;
create policy "alert_sounds: löschen nur admin" on public.alert_sounds
  for delete to authenticated using ((select public.is_admin()));

create or replace function public.before_alert_sound_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.alert_sounds) >= 30 then
    raise exception 'Es gibt schon 30 Alert-Sounds. Lösch einen, um Platz zu schaffen.';
  end if;
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists on_alert_sound_insert on public.alert_sounds;
create trigger on_alert_sound_insert
  before insert on public.alert_sounds
  for each row execute function public.before_alert_sound_insert();
