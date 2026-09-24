-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Fortnite-Bingo: Admins laden Bilder von Items hoch, daraus wird eine
-- zufällige Bingo-Karte gezogen. Gefundene Items werden abgehakt –
-- die Karte ist im OBS-Overlay zu sehen.
--
--   · Kachel „Fortnite-Bingo“ im Fahrplan
--   · Storage-Bucket "bingo" + Tabelle bingo_items: die Bilder (nur Admins)
--   · bingo_card: die aktuelle Karte (eine), lesbar auch ohne Anmeldung (OBS)
--   · bingo_new_card() zieht eine neue Karte, bingo_toggle() hakt ein Feld ab
-- Mehrfach ausführbar.
-- ============================================================

-- ---------- Kachel ----------
alter table public.tiles drop constraint if exists tiles_kind_check;
alter table public.tiles add constraint tiles_kind_check check (kind in ('wheel', 'countdown', 'prank', 'bingo'));

do $$
begin
  if not exists (select 1 from public.tiles where id = 'bingo') then
    update public.tiles set position = position + 1 where kind = 'countdown';
    insert into public.tiles (id, position, kind, title, description, theme, target_at) values
      ('bingo', (select coalesce(max(position), 1) + 1 from public.tiles where kind <> 'countdown'), 'bingo',
       'Fortnite-Bingo',
       'Welche Items findet Dave diese Runde? Die Karte wird zufällig gezogen und im Stream abgehakt.',
       'bingo', null);
  end if;
end;
$$;

-- ---------- Bilder ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bingo', 'bingo', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "bingo: bilder hochladen nur admin" on storage.objects;
create policy "bingo: bilder hochladen nur admin" on storage.objects
  for insert to authenticated with check (bucket_id = 'bingo' and (select public.is_admin()));
drop policy if exists "bingo: bilder sehen nur admin" on storage.objects;
create policy "bingo: bilder sehen nur admin" on storage.objects
  for select to authenticated using (bucket_id = 'bingo' and (select public.is_admin()));
drop policy if exists "bingo: bilder löschen nur admin" on storage.objects;
create policy "bingo: bilder löschen nur admin" on storage.objects
  for delete to authenticated using (bucket_id = 'bingo' and (select public.is_admin()));

create table if not exists public.bingo_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  path text not null unique,
  created_at timestamptz not null default now()
);
alter table public.bingo_items enable row level security;
-- Seltenheit wie in Fortnite (bei Waffen); leer bei Items ohne Seltenheit
alter table public.bingo_items add column if not exists rarity text
  check (rarity is null or rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'exotic'));
-- Zahl im Icon, z. B. 5 auf dem Kill-Symbol = 5 Kills; leer = keine Zahl
alter table public.bingo_items add column if not exists amount int
  check (amount is null or amount between 1 and 999);

drop policy if exists "bingo_items: lesen für alle" on public.bingo_items;
create policy "bingo_items: lesen für alle" on public.bingo_items
  for select to anon, authenticated using (true);
drop policy if exists "bingo_items: anlegen nur admin" on public.bingo_items;
create policy "bingo_items: anlegen nur admin" on public.bingo_items
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "bingo_items: ändern nur admin" on public.bingo_items;
create policy "bingo_items: ändern nur admin" on public.bingo_items
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "bingo_items: löschen nur admin" on public.bingo_items;
create policy "bingo_items: löschen nur admin" on public.bingo_items
  for delete to authenticated using ((select public.is_admin()));
grant select on public.bingo_items to anon;

-- ---------- Die Karte ----------
-- cells: pro Feld {id, name, path, rarity?, amount?} bzw. {free: true} für die freie Mitte.
-- Name und Bild stehen in der Karte selbst – löscht man ein Bild, bleibt die Karte heil.
create table if not exists public.bingo_card (
  id int primary key default 1 check (id = 1),
  size int not null check (size between 3 and 5),
  cells jsonb not null check (jsonb_typeof(cells) = 'array'),
  marked int[] not null default '{}',
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bingo_card enable row level security;

drop policy if exists "bingo_card: lesen für alle" on public.bingo_card;
create policy "bingo_card: lesen für alle" on public.bingo_card
  for select to anon, authenticated using (true);
drop policy if exists "bingo_card: ändern nur admin" on public.bingo_card;
create policy "bingo_card: ändern nur admin" on public.bingo_card
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.bingo_card to anon;

-- Neue Karte aus zufälligen Bildern. Bei ungerader Größe kann die Mitte frei sein.
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

-- Ein Feld abhaken oder den Haken wieder entfernen – in der Datenbank,
-- damit zwei Admins sich nicht gegenseitig überschreiben.
create or replace function public.bingo_toggle(p_index int)
returns public.bingo_card language plpgsql security definer set search_path = '' as $$
declare
  card public.bingo_card;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen Felder abhaken.';
  end if;
  select * into card from public.bingo_card where id = 1 for update;
  if not found then
    raise exception 'Es gibt noch keine Bingo-Karte.';
  end if;
  if p_index is null or p_index < 0 or p_index >= jsonb_array_length(card.cells) then
    raise exception 'Dieses Feld gibt es nicht.';
  end if;
  if coalesce((card.cells -> p_index ->> 'free')::boolean, false) then
    return card;
  end if;
  update public.bingo_card
    set marked = case when p_index = any(marked) then array_remove(marked, p_index) else array_append(marked, p_index) end,
        updated_at = now()
    where id = 1
    returning * into card;
  return card;
end;
$$;

revoke execute on function public.bingo_new_card(int, boolean) from public, anon;
revoke execute on function public.bingo_toggle(int) from public, anon;
grant execute on function public.bingo_new_card(int, boolean) to authenticated;
grant execute on function public.bingo_toggle(int) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bingo_card'
  ) then
    alter publication supabase_realtime add table public.bingo_card;
  end if;
end;
$$;
