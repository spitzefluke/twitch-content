-- ============================================================
-- Overlay-Designs und Alert-Designer (wie bei StreamElements)
--   1) alert_config: Aussehen je Alert-Art (Design, Bild/GIF/Video, Layout,
--      Text-Vorlage, Textanimation, Ein-/Ausblenden, Dauer) und Varianten nach Menge
--      (z. B. ab 1000 Bits ein anderes Alert). Das OBS-Overlay liest es ohne
--      Anmeldung, ändern dürfen Streamer, Admins und freigegebene Mods.
--   2) alert_media + Bucket alert-media: eigene Bilder, GIFs und kurze Videos
--   3) goal_progress(): Stand für Ziel-Balken (Follower, Abos, Bits seit einem Datum)
--   4) stream_live_info(): live ja/nein und Zuschauerzahl für die Labels im Overlay
--      (schreibt die Watchtime-Zählung aus …_chat_bot_commands.sql mit)
-- Braucht 20261017000000_chat_bot_commands.sql. Mehrfach ausführbar.
-- ============================================================

-- ---------- 1) Alert-Designer ----------
create table if not exists public.alert_config (
  id int primary key default 1 check (id = 1),
  config jsonb not null default '{}'::jsonb check (octet_length(config::text) <= 60000),
  updated_at timestamptz not null default now()
);
insert into public.alert_config (id) values (1) on conflict (id) do nothing;
alter table public.alert_config enable row level security;
drop policy if exists "alert_config: lesen für alle" on public.alert_config;
create policy "alert_config: lesen für alle" on public.alert_config
  for select to anon, authenticated using (true);
drop policy if exists "alert_config: ändern für admins" on public.alert_config;
create policy "alert_config: ändern für admins" on public.alert_config
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.alert_config to anon;
do $$ begin perform public.realtime_add('alert_config'); end $$;

-- ---------- 2) Eigene Bilder, GIFs und Videos ----------
-- Öffentlicher Bucket: OBS zeigt die Dateien ohne Anmeldung.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('alert-media', 'alert-media', true, 10485760, array[
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/webm', 'video/mp4'
])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "alert-media: hochladen nur admin" on storage.objects;
create policy "alert-media: hochladen nur admin" on storage.objects
  for insert to authenticated with check (bucket_id = 'alert-media' and (select public.is_admin()));
drop policy if exists "alert-media: sehen nur admin" on storage.objects;
create policy "alert-media: sehen nur admin" on storage.objects
  for select to authenticated using (bucket_id = 'alert-media' and (select public.is_admin()));
drop policy if exists "alert-media: löschen nur admin" on storage.objects;
create policy "alert-media: löschen nur admin" on storage.objects
  for delete to authenticated using (bucket_id = 'alert-media' and (select public.is_admin()));

create table if not exists public.alert_media (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  path text not null unique check (path ~ '^[a-z0-9-]+\.(png|jpe?g|gif|webp|webm|mp4)$'),
  kind text not null check (kind in ('image', 'video')),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
alter table public.alert_media enable row level security;
drop policy if exists "alert_media: lesen für admins" on public.alert_media;
create policy "alert_media: lesen für admins" on public.alert_media
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "alert_media: anlegen nur admin" on public.alert_media;
create policy "alert_media: anlegen nur admin" on public.alert_media
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "alert_media: löschen nur admin" on public.alert_media;
create policy "alert_media: löschen nur admin" on public.alert_media
  for delete to authenticated using ((select public.is_admin()));

create or replace function public.before_alert_media_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.alert_media) >= 40 then
    raise exception 'Es gibt schon 40 Alert-Bilder und -Videos. Lösch eins, um Platz zu schaffen.';
  end if;
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists on_alert_media_insert on public.alert_media;
create trigger on_alert_media_insert
  before insert on public.alert_media
  for each row execute function public.before_alert_media_insert();

-- ---------- 3) Ziel-Balken ----------
-- Follower: neue Follows; Abos: Abos + Resubs + verschenkte Abos; Bits: Summe der Bits.
-- Probe-Alerts zählen nicht.
create or replace function public.goal_progress(p_kind text, p_since timestamptz default null)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(case p_kind
    when 'follow' then (select count(*) from public.stream_alerts
      where kind = 'follow' and not test and created_at >= coalesce(p_since, now() - interval '30 days'))
    when 'sub' then (select coalesce(sum(case when kind = 'gift' then greatest(amount, 1) else 1 end), 0) from public.stream_alerts
      where kind in ('sub', 'resub', 'gift') and not test and created_at >= coalesce(p_since, now() - interval '30 days'))
    when 'bits' then (select coalesce(sum(amount), 0) from public.stream_alerts
      where kind = 'bits' and not test and created_at >= coalesce(p_since, now() - interval '30 days'))
    else 0 end, 0)::bigint;
$$;
grant execute on function public.goal_progress(text, timestamptz) to anon, authenticated;

-- ---------- 4) Live-Infos für die Labels ----------
alter table public.watch_state add column if not exists viewer_count int not null default 0;
alter table public.watch_state add column if not exists started_at timestamptz;

create or replace function public.stream_live_info()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'live', coalesce(live and last_tick_at > now() - interval '15 minutes', false),
    'viewers', case when live and last_tick_at > now() - interval '15 minutes' then viewer_count else 0 end,
    'started_at', case when live then started_at end)
  from public.watch_state where id = 1;
$$;
grant execute on function public.stream_live_info() to anon, authenticated;

-- Die Watchtime-Zählung schreibt Zuschauerzahl und Startzeit mit (nur Service-Rolle)
create or replace function public.watch_stream_info(p_viewers int, p_started_at timestamptz)
returns void language sql security definer set search_path = '' as $$
  update public.watch_state
     set viewer_count = greatest(0, least(coalesce(p_viewers, 0), 10000000)), started_at = p_started_at
   where id = 1;
$$;
revoke execute on function public.watch_stream_info(int, timestamptz) from public, anon, authenticated;
