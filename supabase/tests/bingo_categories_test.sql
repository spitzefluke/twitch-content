-- Tests zu den Bingo-Kategorien (…_bingo_categories.sql). Läuft gegen eine Datenbank mit allen Migrationen,
-- ändert nichts dauerhaft (Transaktion mit rollback). Nur lokal/Test:
--   psql -v ON_ERROR_STOP=1 -d <testdatenbank> -f supabase/tests/bingo_categories_test.sql
begin;

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FEHLER: %', what; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function pg_temp.fails(q text) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when others then
  return true;
end $$;

insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'a@test.invalid') on conflict do nothing;
insert into public.channels (id, login, twitch_id, owner_id, status, display_name) values
  ('11111111-0000-0000-0000-000000000001', 'testkanala', '9000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'active', 'KanalA');

-- Lootpool: 10 Sturmgewehre, 2 Heilung, 2 Schild, 1 ohne Kategorie
insert into core.bingo_items (channel_id, name, path, category)
  select '11111111-0000-0000-0000-000000000001', 'Gewehr ' || n, 'test/ar' || n || '.png', 'ar' from generate_series(1, 10) n;
insert into core.bingo_items (channel_id, name, path, category) values
  ('11111111-0000-0000-0000-000000000001', 'Medkit', 'test/h1.png', 'heal'),
  ('11111111-0000-0000-0000-000000000001', 'Verband', 'test/h2.png', 'heal'),
  ('11111111-0000-0000-0000-000000000001', 'Schildtrank', 'test/s1.png', 'shield'),
  ('11111111-0000-0000-0000-000000000001', 'Minis', 'test/s2.png', 'shield'),
  ('11111111-0000-0000-0000-000000000001', 'Krone', 'test/o1.png', null);

select pg_temp.check(pg_temp.fails($q$insert into core.bingo_items (channel_id, name, path, category)
  values ('11111111-0000-0000-0000-000000000001', 'Falsch', 'test/x.png', 'laser')$q$), 'unbekannte Kategorie abgelehnt');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check((select count(*) from public.bingo_items where category = 'heal') = 2, 'Kategorie über die Sicht lesbar');
update public.bingo_items set category = 'other' where name = 'Krone';
select pg_temp.check((select category from public.bingo_items where name = 'Krone') = 'other', 'Admin ändert die Kategorie');

-- 3×3 ohne freies Feld = 9 Items: reihum gezogen sind alle 5 Nicht-Gewehre dabei (4 Kategorien, 2 Runden),
-- bei reinem Zufall wäre das selten. Zehnmal ziehen, jedes Mal muss es stimmen.
do $$
declare
  c public.bingo_card;
  k int;
begin
  for k in 1..10 loop
    c := public.bingo_new_card(3, false);
    if (select count(*) from jsonb_array_elements(c.cells) e where e->>'category' is distinct from 'ar') <> 5 then
      raise exception 'FEHLER: Karte % nicht ausgewogen: %', k, c.cells;
    end if;
  end loop;
end $$;
select pg_temp.check(true, 'Karten mischen die Kategorien (10 von 10 ausgewogen)');
select pg_temp.check((select bool_and(e ? 'category') from public.bingo_card b, jsonb_array_elements(b.cells) e where b.id = 1),
  'Kategorie steht mit in der Karte');
select pg_temp.check(pg_temp.fails($q$select public.bingo_new_card(5, true)$q$), 'zu wenige Items: klare Fehlermeldung bleibt');
reset role;

rollback;
