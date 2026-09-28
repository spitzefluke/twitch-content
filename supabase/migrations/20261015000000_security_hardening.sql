-- ============================================================
-- Content-Stellwerk
-- Sicherheit:
--   1) Raid-Schutz: Streamer und Mods pausieren mit einem Klick alle Zuschauer-Aktionen
--      (Chat-Befehle, Kanalpunkte für Vorlesen/Karten/Würfe, Aktionen auf der Seite) –
--      z. B. bei einem Hate-Raid. Auf Wunsch nur für eine gewisse Zeit.
--   2) OBS/anon sieht keine internen IDs mehr (Konto-IDs, Twitch-Einlösungs-IDs):
--      nur noch die Spalten, die das Overlay wirklich braucht.
--   3) Hochladen von Sounds: höchstens 10 Dateien pro Person im Speicher
--      (vorher waren nur die Einträge begrenzt, nicht die Dateien).
-- Braucht 20261014000000_stream_extras.sql. Mehrfach ausführbar.
-- ============================================================

-- ---------- 1) Raid-Schutz ----------
create table if not exists public.site_guard (
  id int primary key default 1 check (id = 1),
  viewer_pause boolean not null default false,
  until timestamptz,                 -- NULL = bis zum Ausschalten
  reason text not null default '' check (char_length(reason) <= 120),
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.site_guard (id) values (1) on conflict (id) do nothing;
alter table public.site_guard enable row level security;
drop policy if exists "site_guard: lesen für angemeldete" on public.site_guard;
create policy "site_guard: lesen für angemeldete" on public.site_guard for select to authenticated using (true);

create or replace function public.viewer_paused()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select viewer_pause and (until is null or until > now()) from public.site_guard where id = 1), false);
$$;
grant execute on function public.viewer_paused() to anon, authenticated;

-- Aktionen auf der Seite: Admins immer, Zuschauer nur nach dem Starttermin und ohne Raid-Schutz
create or replace function public.feature_open(p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or (not public.viewer_paused() and coalesce(
    (select target_at is null or target_at <= now() from public.tiles where kind = p_kind order by position limit 1),
    false));
$$;

-- Chat und Kanalpunkte (ohne Admin-Ausnahme)
create or replace function public.tile_started(p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not public.viewer_paused() and coalesce(
    (select target_at is null or target_at <= now() from public.tiles where kind = p_kind order by position limit 1),
    false);
$$;
revoke execute on function public.tile_started(text) from public, anon, authenticated;

create or replace function public.site_guard_set(p_on boolean, p_minutes int default null, p_reason text default '')
returns public.site_guard language plpgsql security definer set search_path = '' as $$
declare
  result public.site_guard;
begin
  if not public.is_admin() then raise exception 'Den Raid-Schutz schalten nur der Streamer und die Mods.'; end if;
  update public.site_guard set
    viewer_pause = coalesce(p_on, false),
    until = case when coalesce(p_on, false) and coalesce(p_minutes, 0) > 0
                 then now() + make_interval(mins => least(1440, p_minutes)) end,
    reason = left(btrim(coalesce(p_reason, '')), 120),
    updated_by = public.my_name(),
    updated_at = now()
  where id = 1 returning * into result;
  perform public.bot_say(case when result.viewer_pause
    then '🛡️ Raid-Schutz an: Chat-Befehle und Kanalpunkte-Aktionen sind kurz pausiert.'
    else '✅ Raid-Schutz aus – alles läuft wieder.' end);
  return result;
end;
$$;
revoke execute on function public.site_guard_set(boolean, int, text) from public, anon;
grant execute on function public.site_guard_set(boolean, int, text) to authenticated;
do $$ begin perform public.realtime_add('site_guard'); end $$;

-- ---------- 2) OBS (anon) sieht nur, was das Overlay braucht ----------
-- Angemeldete (die Webseite) sehen weiter alle Spalten – die Zeilen regelt RLS.
revoke select on public.shop_runs from anon;
grant select (id, player, lobby_id, stream, chest, coins, spent, items, status, shop_until, score, created_at, updated_at)
  on public.shop_runs to anon;
revoke select on public.pranks from anon;
grant select (id, created_at, kind, item, sound_path, label, requested_by) on public.pranks to anon;
revoke select on public.queue_entries from anon;
grant select (id, name, is_sub, source, status, joined_at, picked_at, updated_at) on public.queue_entries to anon;
revoke select on public.quiz_scores from anon;
grant select (name, points, correct, answered, updated_at) on public.quiz_scores to anon;
revoke select on public.tts_messages from anon;
grant select (id, who, text, voice, status, source, reviewed_at, created_at) on public.tts_messages to anon;

-- ---------- 3) Sounds: höchstens 10 Dateien pro Person ----------
create or replace function public.storage_files_of(p_bucket text, p_user uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from storage.objects where bucket_id = p_bucket and (storage.foldername(name))[1] = p_user::text;
$$;
revoke execute on function public.storage_files_of(text, uuid) from public, anon;
grant execute on function public.storage_files_of(text, uuid) to authenticated;

drop policy if exists "sounds: hochladen in eigenen Ordner" on storage.objects;
create policy "sounds: hochladen in eigenen Ordner" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'sounds'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (
      (select public.is_admin())
      or ((select allow_uploads from public.prank_settings where id = 1)
          and not (select public.viewer_paused())
          and (select public.storage_files_of('sounds', auth.uid())) < 10)
    )
  );
