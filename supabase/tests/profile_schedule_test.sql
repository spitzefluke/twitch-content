-- Tests zu Zeitplan und öffentlichem Profil (…_profile_schedule.sql). Läuft gegen eine Datenbank mit allen
-- Migrationen, ändert nichts dauerhaft (alles in einer Transaktion, am Ende rollback). Nur lokal/Test:
--   psql -v ON_ERROR_STOP=1 -d <testdatenbank> -f supabase/tests/profile_schedule_test.sql
begin;

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FEHLER: %', what; end if;
  raise notice 'ok: %', what;
end $$;
-- Erwarteten Fehler abfangen
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

-- ---------- Streamer A pflegt Zeitplan und Profil ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
-- jeden Tag ein Termin um 23:59 → der nächste liegt immer in der Zukunft
select public.schedule_save((select jsonb_agg(jsonb_build_object('weekday', d, 'start', '23:59', 'minutes', 60, 'title', 'Abendstream', 'game', 'Fortnite'))
                             from generate_series(1, 7) d));
select pg_temp.check(json_array_length(public.profile_get()->'slots') = 7, 'A speichert 7 Termine');
select pg_temp.check(json_array_length(public.profile_get()->'upcoming') >= 1, 'nächste Termine werden berechnet');
select pg_temp.check(pg_temp.fails($q$select public.schedule_save('[{"weekday":8,"start":"10:00"}]')$q$), 'Wochentag 8 wird abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.schedule_save('[{"weekday":1,"start":"25:00"}]')$q$), 'Uhrzeit 25:00 wird abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.profile_save('', '[]', 'Mars/Olympus', null, '', null)$q$), 'unbekannte Zeitzone wird abgelehnt');
select public.profile_save('Hallo!', '[{"label":"YouTube","url":"https://youtube.com/@a"},{"label":"böse","url":"javascript:alert(1)"},{"label":"http","url":"http://x.de"}]',
                           'Europe/Berlin', null, '', true);
select pg_temp.check((public.profile_get()->>'is_public')::boolean, 'A macht das Profil öffentlich');
select pg_temp.check(json_array_length(public.profile_get()->'links') = 1, 'nur https-Links bleiben (javascript: und http: fallen raus)');
reset role;

-- ---------- Öffentliche Seite (Gast) ----------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.headers', '{}', true);
select pg_temp.check(public.public_profile('testkanala')->>'bio' = 'Hallo!', 'Gast sieht das öffentliche Profil von A');
select pg_temp.check(json_array_length(public.public_profile('TestKanalA')->'upcoming') >= 1, 'Login ohne Groß/Klein, mit Terminen');
select pg_temp.check(public.public_profile('testkanalb') is null, 'Kanal B ohne Zustimmung: keine öffentliche Seite');
select pg_temp.check(pg_temp.fails($q$select count(*) from core.stream_schedule$q$), 'Gast liest core.stream_schedule nicht direkt');
select pg_temp.check(pg_temp.fails($q$select public.profile_get()$q$), 'Gast darf profile_get nicht');
reset role;

-- ---------- Streamer B kommt nicht an Kanal A ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(pg_temp.fails($q$select public.schedule_save('[]')$q$), 'B kann den Zeitplan von A nicht löschen');
select pg_temp.check(pg_temp.fails($q$select public.profile_save('weg', '[]', 'Europe/Berlin', null, '', false)$q$), 'B kann das Profil von A nicht ändern');
select pg_temp.check(pg_temp.fails($q$select public.profile_get()$q$), 'B liest Profil-Einstellungen von A nicht');
reset role;

-- ---------- Pause: Termine bis dahin fallen weg ----------
update core.channel_profile set away_until = current_date + 30, away_note = 'Urlaub' where channel_id = '11111111-0000-0000-0000-000000000001';
select pg_temp.check(json_array_length(public.public_profile('testkanala')->'upcoming') = 0, 'während der Pause keine Termine (14 Tage voraus)');
select pg_temp.check(public.public_profile('testkanala')->>'away_note' = 'Urlaub', 'Pausen-Hinweis ist sichtbar');
select pg_temp.check((select (x->>'profile')::boolean from json_array_elements(public.showcase_list()) x where x->>'login' = 'testkanala') is not false,
                     'Showcase kennt „profile“ (oder A steht nicht im Showcase)');

rollback;
