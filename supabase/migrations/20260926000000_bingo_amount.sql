-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Fortnite-Bingo: Zahl im Icon, z. B. 5 auf dem Kill-Symbol = 5 Kills.
-- Mehrfach ausführbar (steht genauso in …_bingo.sql).
-- ============================================================

alter table public.bingo_items add column if not exists amount int
  check (amount is null or amount between 1 and 999);

-- Neue Karten nehmen alles vom Bild mit (auch Seltenheit und Zahl)
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
  select count(*) into have from public.bingo_items;
  if have < need then
    raise exception 'Für eine %×%-Karte braucht es % Bilder – hochgeladen sind erst %.', p_size, p_size, need, have;
  end if;

  select jsonb_agg(cell order by pos) into picked from (
    -- Alles vom Bild außer dem Datum (id, name, path, rarity, amount …); leere Felder fallen weg
    select jsonb_strip_nulls(to_jsonb(b) - 'created_at') as cell,
           case when free and n - 1 >= center then n else n - 1 end as pos
    from (select b, row_number() over (order by random()) as n from public.bingo_items b) r
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
