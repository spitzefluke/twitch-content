-- Tests zur Markenfarbe fürs Profil (…_brand_color.sql). Läuft gegen eine Datenbank mit allen Migrationen,
-- ändert nichts dauerhaft (Transaktion mit rollback). Nur lokal/Test:
--   psql -v ON_ERROR_STOP=1 -d <testdatenbank> -f supabase/tests/brand_color_test.sql
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

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a@test.invalid'), ('bbbbbbbb-0000-0000-0000-00000000000b', 'b@test.invalid')
  on conflict do nothing;
insert into public.channels (id, login, twitch_id, owner_id, status) values
  ('11111111-0000-0000-0000-000000000001', 'testkanala', '9000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'active'),
  ('22222222-0000-0000-0000-000000000002', 'testkanalb', '9000000002', 'bbbbbbbb-0000-0000-0000-00000000000b', 'active');

-- ---------- Streamer A setzt die Farbe ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(public.profile_accent_save('#FF4FD8') = '#ff4fd8', 'Farbe gespeichert (klein geschrieben)');
select pg_temp.check(public.profile_get()->>'accent' = '#ff4fd8', 'profile_get liefert die Farbe');
select pg_temp.check(pg_temp.fails($q$select public.profile_accent_save('red; background:url(x)')$q$), 'ungültige Farbe abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.profile_accent_save('#12345')$q$), 'zu kurze Farbe abgelehnt');
-- Profil noch nicht öffentlich: keine öffentliche Seite
select pg_temp.check(public.public_profile('testkanala') is null, 'nicht öffentlich: keine Seite, auch keine Farbe');
select public.profile_save('Hallo!', '[]', 'Europe/Berlin', null, '', true);
select pg_temp.check(public.public_profile('testkanala')->>'accent' = '#ff4fd8', 'öffentliches Profil zeigt die Farbe');
select pg_temp.check(public.profile_accent_save('') is null, 'leer = zurück zur Standardfarbe');
select pg_temp.check(public.profile_get()->>'accent' is null, 'Standardfarbe: keine eigene Farbe mehr');

-- ---------- Fremde und Gäste ----------
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal1"}', true);
select pg_temp.check(pg_temp.fails($q$select public.profile_accent_save('#000000')$q$), 'B kann die Farbe von Kanal A nicht ändern');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.check(pg_temp.fails($q$select public.profile_accent_save('#000000')$q$), 'Gast kann keine Farbe setzen');
reset role;

rollback;
