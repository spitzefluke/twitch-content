-- ============================================================
-- StreamHelp: Bingo-Items nach Kategorien (Lootpool sortieren)
--   · core.bingo_items.category: Sturmgewehre (ar), Schrotflinten (shotgun), MPs (smg),
--     Scharfschützen (sniper), Pistolen (pistol), Explosiv (explosive), Heilung (heal),
--     Schild (shield), Wurfgegenstände (throw), Mobilität (mobility), Sonstiges (other).
--     Die Webseite erkennt sie beim Hochladen aus dem Namen (js/bingo.js, categoryFromName),
--     Admins ändern sie in der Liste. Leer = Sonstiges.
--   · bingo_new_card: Karten mischen die Kategorien – reihum aus jeder eins, dann das nächste,
--     soweit genug Items da sind (vorher rein zufällig). Die Kategorie steht mit in der Karte,
--     Overlay und Zuschauer zeigen sie als kleines Symbol.
-- Braucht 20261028000000_platform.sql und 20261022000000_bingo_vault.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.bingo_items') is null then
    raise exception 'Erst die Plattform-Migration 20261028000000_platform.sql ausführen.';
  end if;
end;
$$;

alter table core.bingo_items add column if not exists category text;
alter table core.bingo_items drop constraint if exists bingo_items_category_check;
alter table core.bingo_items add constraint bingo_items_category_check check (category is null or category in
  ('ar', 'shotgun', 'smg', 'sniper', 'pistol', 'explosive', 'heal', 'shield', 'throw', 'mobility', 'other'));
select public.channel_view('bingo_items');

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

  -- Ausgewogen: reihum aus jeder Kategorie eins (zufällig), erst dann das zweite usw.;
  -- Items ohne Kategorie zählen als „Sonstiges“. Doppelte überspringen.
  for r in select b.* from public.bingo_items b where not b.vault
           order by row_number() over (partition by coalesce(b.category, 'other') order by random()), random() loop
    name_key := lower(regexp_replace(btrim(r.name), '\s+', ' ', 'g'));
    image := coalesce(r.image_key, r.path);
    continue when name_key = any(names) or image = any(images);
    names := names || name_key;
    images := images || image;
    -- Alles vom Bild außer Datum und Verwaltungsfeldern (id, name, path, rarity, amount, category); leere Felder fallen weg
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
