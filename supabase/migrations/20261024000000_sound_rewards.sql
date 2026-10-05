-- ============================================================
-- StreamHelp · Sounds per Kanalpunkte: eine Belohnung pro Sound
--
-- Neben der Sammel-Belohnung „🔊 Sound für ‹Kanal›“ (eintippen: Nummer, Name
-- oder „zufall“) kann der Streamer einzelnen Sounds eine eigene Belohnung geben,
-- z. B. „🔊 Tröte“ – Zuschauer klicken nur noch, nichts eintippen.
--
--   · prank_sound_rewards: welcher Sound (eingebaut oder eigener), an/aus, Kosten.
--     Anlegen und ändern: Streamer, Admins, freigegebene Mods. Die Belohnung auf
--     Twitch legt die Edge Function twitch-oauth an (sync_pranks) und trägt
--     reward_id/error ein; einlösen wertet twitch-eventsub aus.
--   · höchstens 20 Sounds mit eigener Belohnung (Twitch erlaubt 50 pro Kanal)
--   · Wird ein eigener Sound gelöscht, bleibt die Zeile ohne Sound zurück; beim
--     nächsten Abgleich verschwindet sie samt Belohnung auf Twitch.
-- Mehrfach ausführbar. Braucht …_pranks.sql.
-- ============================================================

create table if not exists public.prank_sound_rewards (
  id bigint generated always as identity primary key,
  board text unique check (board ~ '^[a-z0-9_-]{1,24}$'),             -- eingebauter Sound (whistle, horn, …)
  sound_id uuid unique references public.sounds on delete set null,    -- eigener Sound
  enabled boolean not null default true,
  cost int not null default 300 check (cost between 1 and 1000000),
  reward_id text,
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prank_sound_rewards_one check (board is null or sound_id is null)
);
alter table public.prank_sound_rewards enable row level security;

drop policy if exists "prank_sound_rewards: lesen für angemeldete" on public.prank_sound_rewards;
create policy "prank_sound_rewards: lesen für angemeldete" on public.prank_sound_rewards
  for select to authenticated using (true);
drop policy if exists "prank_sound_rewards: anlegen nur admin" on public.prank_sound_rewards;
create policy "prank_sound_rewards: anlegen nur admin" on public.prank_sound_rewards
  for insert to authenticated with check ((select public.is_admin()) and ((board is null) <> (sound_id is null)));
drop policy if exists "prank_sound_rewards: ändern nur admin" on public.prank_sound_rewards;
create policy "prank_sound_rewards: ändern nur admin" on public.prank_sound_rewards
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Von der Webseite: nur Sound, an/aus und Kosten. reward_id/error schreibt die Edge Function.
-- Löschen gibt es nicht – ausschalten, damit die Belohnung auf Twitch mit weggeräumt wird.
revoke all on public.prank_sound_rewards from anon, authenticated;
grant select on public.prank_sound_rewards to authenticated;
grant insert (board, sound_id, enabled, cost) on public.prank_sound_rewards to authenticated;
grant update (enabled, cost, updated_at) on public.prank_sound_rewards to authenticated;

-- Höchstens 20 eingeschaltete Sounds mit eigener Belohnung
create or replace function public.before_prank_sound_reward()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.enabled and (tg_op = 'INSERT' or not old.enabled) and (
    select count(*) from public.prank_sound_rewards where enabled and id is distinct from new.id
  ) >= 20 then
    raise exception 'Höchstens 20 Sounds mit eigener Belohnung – Twitch erlaubt nur 50 Belohnungen pro Kanal. Schalte erst einen anderen aus.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.before_prank_sound_reward() from public, anon, authenticated;
drop trigger if exists on_prank_sound_reward on public.prank_sound_rewards;
create trigger on_prank_sound_reward
  before insert or update on public.prank_sound_rewards
  for each row execute function public.before_prank_sound_reward();
