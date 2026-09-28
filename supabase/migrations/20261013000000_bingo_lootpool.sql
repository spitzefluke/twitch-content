-- ============================================================
-- Content-Stellwerk
-- Fortnite-Bingo: Bilder aus dem aktuellen Lootpool.
--   · Die Edge Function bingo-loot holt den Lootpool von fortniteapi.io (Secret
--     FORTNITEAPI_IO_KEY) und legt jedes Item als bingo_items-Zeile an:
--     source = 'lootpool', path = Bild-Adresse (https://…#ID), loot_id = ID bei Fortnite.
--   · Fliegt ein Item aus dem Lootpool, wird es active = false – neue Karten ziehen
--     nur noch aktive Bilder. Alte Karten behalten ihre Bilder.
--   · hidden: Admins blenden ein Lootpool-Item aus (der Abgleich holt es nicht zurück).
--   · Eigene hochgeladene Bilder bleiben wie bisher (source = 'upload', immer aktiv).
-- Braucht 20260926000000_bingo_amount.sql. Mehrfach ausführbar.
-- ============================================================

alter table public.bingo_items add column if not exists source text not null default 'upload';
alter table public.bingo_items drop constraint if exists bingo_items_source_check;
alter table public.bingo_items add constraint bingo_items_source_check check (source in ('upload', 'lootpool'));
alter table public.bingo_items add column if not exists loot_id text;
alter table public.bingo_items add column if not exists active boolean not null default true;
alter table public.bingo_items add column if not exists hidden boolean not null default false;
-- eindeutig (für den Abgleich per upsert); eigene Bilder haben keine loot_id (NULL zählt nicht doppelt)
alter table public.bingo_items drop constraint if exists bingo_items_loot_id_key;
alter table public.bingo_items add constraint bingo_items_loot_id_key unique (loot_id);
-- Lootpool-Bilder liegen nicht im Storage: ihr path ist eine https-Adresse
alter table public.bingo_items drop constraint if exists bingo_items_lootpool_path_check;
alter table public.bingo_items add constraint bingo_items_lootpool_path_check
  check (source <> 'lootpool' or path ~ '^https://');

-- Stand des letzten Abgleichs (für „zuletzt abgeglichen …“ und damit nicht jeder Besuch abgleicht)
create table if not exists public.bingo_loot_state (
  id int primary key default 1 check (id = 1),
  synced_at timestamptz,
  items int not null default 0,
  error text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.bingo_loot_state (id) values (1) on conflict (id) do nothing;
alter table public.bingo_loot_state enable row level security;
drop policy if exists "bingo_loot_state: lesen für angemeldete" on public.bingo_loot_state;
create policy "bingo_loot_state: lesen für angemeldete" on public.bingo_loot_state
  for select to authenticated using (true);
-- Schreiben nur bingo-loot (Service-Rolle)

-- Neue Stream-Karte: nur aktive, nicht ausgeblendete Bilder
create or replace function public.bingo_new_card(p_size int, p_free boolean default true)
returns public.bingo_card language plpgsql security definer set search_path = '' as $$
declare
  free boolean := coalesce(p_free, true) and p_size % 2 = 1;
  need int;
  have int;
  center int := (p_size * p_size) / 2;
  picked jsonb;
  result public.bingo_card;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen eine neue Bingo-Karte ziehen.';
  end if;
  if p_size is null or p_size not between 3 and 5 then
    raise exception 'Die Karte kann 3×3, 4×4 oder 5×5 Felder haben.';
  end if;
  need := p_size * p_size - case when free then 1 else 0 end;
  select count(*) into have from public.bingo_items where active and not hidden;
  if have < need then
    raise exception 'Für eine %×%-Karte braucht es % Bilder – verfügbar sind erst %.', p_size, p_size, need, have;
  end if;

  select jsonb_agg(cell order by pos) into picked from (
    -- Alles vom Bild außer Datum und Verwaltungsfeldern (id, name, path, rarity, amount); leere Felder fallen weg
    select jsonb_strip_nulls(to_jsonb(b) - 'created_at' - 'source' - 'loot_id' - 'active' - 'hidden') as cell,
           case when free and n - 1 >= center then n else n - 1 end as pos
    from (select b, row_number() over (order by random()) as n from public.bingo_items b where b.active and not b.hidden) r
    where n <= need
    union all
    select jsonb_build_object('free', true), center where free
  ) cells;

  insert into public.bingo_card (id, size, cells, marked, visible, created_at, updated_at)
    values (1, p_size, picked, case when free then array[center] else '{}'::int[] end, true, now(), now())
  on conflict (id) do update set
    size = excluded.size, cells = excluded.cells, marked = excluded.marked,
    visible = true, created_at = now(), updated_at = now()
  returning * into result;
  return result;
end;
$$;
revoke execute on function public.bingo_new_card(int, boolean) from public, anon;
grant execute on function public.bingo_new_card(int, boolean) to authenticated;
