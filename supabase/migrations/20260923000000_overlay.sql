-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- OBS-Overlay (overlay.html): liest ohne Anmeldung.
--
-- Eine OBS-Browserquelle hat keine Sitzung, liest also als "anon".
-- Freigegeben wird nur, was ohnehin im Stream zu sehen ist:
--   · Kacheln (Content-Ideen mit Countdown)
--   · Glücksrad-Varianten (Segmente zum Zeichnen des Rads)
--   · ein schlanker Feed der Drehungen – ohne user_id und redemption_id
-- Mehrfach ausführbar.
-- ============================================================

-- ---------- Kacheln & Varianten lesbar ohne Anmeldung ----------
drop policy if exists "tiles: lesen für overlay" on public.tiles;
create policy "tiles: lesen für overlay" on public.tiles
  for select to anon using (true);

drop policy if exists "wheel_variants: lesen für overlay" on public.wheel_variants;
create policy "wheel_variants: lesen für overlay" on public.wheel_variants
  for select to anon using (true);

grant select on public.tiles, public.wheel_variants to anon;

-- ---------- Feed der Drehungen ----------
-- Eigene Tabelle statt Freigabe von "spins": Realtime schickt immer die
-- ganze Zeile, und user_id/redemption_id gehören nicht in einen öffentlichen Feed.
create table if not exists public.overlay_spins (
  id bigint primary key,                       -- gleiche id wie in spins
  created_at timestamptz not null default now(),
  source text not null,
  variant_id text not null,
  variant_name text not null,
  segment_index int not null,
  result text not null,
  detail text not null default '',
  requested_by text not null
);
alter table public.overlay_spins enable row level security;

drop policy if exists "overlay_spins: lesen für alle" on public.overlay_spins;
create policy "overlay_spins: lesen für alle" on public.overlay_spins
  for select to anon, authenticated using (true);
grant select on public.overlay_spins to anon, authenticated;

-- Jede neue Drehung landet automatisch im Feed; ältere Einträge räumt
-- derselbe Trigger weg – das Overlay braucht nur die letzten Minuten.
create or replace function public.mirror_spin_to_overlay()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.overlay_spins (id, created_at, source, variant_id, variant_name, segment_index, result, detail, requested_by)
  values (new.id, new.created_at, new.source, new.variant_id, new.variant_name, new.segment_index, new.result, new.detail, new.requested_by)
  on conflict (id) do nothing;
  delete from public.overlay_spins where created_at < now() - interval '2 days';
  return new;
exception when others then
  -- Das Overlay ist Zugabe: Ein Fehler hier darf die eigentliche Drehung nie blockieren.
  raise warning 'overlay_spins: Spiegeln fehlgeschlagen: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_spin_mirror_overlay on public.spins;
create trigger on_spin_mirror_overlay
  after insert on public.spins
  for each row execute function public.mirror_spin_to_overlay();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'overlay_spins'
  ) then
    alter publication supabase_realtime add table public.overlay_spins;
  end if;
end;
$$;
