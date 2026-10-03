-- ============================================================
-- StreamHelp: Fortnite-Bingo ohne Lootpool, mit Item-Tresor und ohne Dopplungen
--   · Lootpool und eingebaute Item-Liste sind weg: Ins Bingo kommen nur noch hochgeladene
--     Bilder. Die Lootpool-Items (source = 'lootpool') werden gelöscht, dazu die Tabelle
--     bingo_loot_state und die Spalten source, loot_id, active, hidden. Alte Karten behalten
--     ihre Felder (die Karte speichert eine Kopie), nur die Bilder davon fehlen dann.
--   · vault (Item-Tresor): Admins legen ein Item in den Tresor – es kommt auf keine neue
--     Karte, bleibt aber gespeichert und lässt sich wieder herausholen.
--   · image_key: Fingerabdruck der Bilddatei (SHA-256, rechnet die Webseite beim Hochladen).
--     Kopien (⧉) und „ein Bild → alle Seltenheiten“ teilen sich Datei und Fingerabdruck.
--   · Kartenregel (Stream-Karte hier, eigene Karte in js/bingo.js): Jeder Item-Name nur einmal
--     pro Karte (gleiche Waffe in anderer Seltenheit zählt als dieselbe), jedes Bild nur einmal
--     (gleicher Fingerabdruck bzw. gleiche Datei).
-- Braucht 20260926000000_bingo_amount.sql. Mehrfach ausführbar – auch wenn
-- 20261013000000_bingo_lootpool.sql (gibt es nicht mehr) nie gelaufen ist.
-- ============================================================

-- Lootpool entfernen
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'bingo_items' and column_name = 'source') then
    execute 'delete from public.bingo_items where source = ''lootpool''';
  end if;
end $$;
-- Lootpool-Bilder hatten eine https-Adresse statt einer Datei im Storage
delete from public.bingo_items where path ~ '^https?://';
alter table public.bingo_items drop constraint if exists bingo_items_lootpool_path_check;
alter table public.bingo_items drop constraint if exists bingo_items_loot_id_key;
alter table public.bingo_items drop constraint if exists bingo_items_source_check;
alter table public.bingo_items drop column if exists source;
alter table public.bingo_items drop column if exists loot_id;
alter table public.bingo_items drop column if exists active;
alter table public.bingo_items drop column if exists hidden;
drop table if exists public.bingo_loot_state;

-- Tresor und Fingerabdruck
alter table public.bingo_items add column if not exists vault boolean not null default false;
alter table public.bingo_items add column if not exists image_key text;
alter table public.bingo_items drop constraint if exists bingo_items_image_key_check;
alter table public.bingo_items add constraint bingo_items_image_key_check
  check (image_key is null or image_key ~ '^[0-9a-f]{64}$');

-- Neue Stream-Karte: nur Items außerhalb des Tresors, jeder Name und jedes Bild nur einmal
create or replace function public.bingo_new_card(p_size int, p_free boolean default true)
returns public.bingo_card language plpgsql security definer set search_path = '' as $$
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
  on conflict (id) do update set
    size = excluded.size, cells = excluded.cells, marked = excluded.marked,
    visible = true, created_at = now(), updated_at = now()
  returning * into result;
  return result;
end;
$$;
revoke execute on function public.bingo_new_card(int, boolean) from public, anon;
grant execute on function public.bingo_new_card(int, boolean) to authenticated;
