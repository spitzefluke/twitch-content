-- Regressionstests zur Härtung (…_hardening.sql). Läuft gegen eine Datenbank mit allen Migrationen,
-- ändert nichts dauerhaft (alles in einer Transaktion, am Ende rollback). Nur lokal/Test, nie produktiv:
--   psql -v ON_ERROR_STOP=1 -d <testdatenbank> -f supabase/tests/hardening_test.sql
-- Schlägt eine Prüfung fehl, bricht das Skript mit „FEHLER: …“ ab.
begin;

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FEHLER: %', what; end if;
  raise notice 'ok: %', what;
end $$;

-- Zwei Kanäle mit je einem Streamer
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a@test.invalid'), ('bbbbbbbb-0000-0000-0000-00000000000b', 'b@test.invalid')
  on conflict do nothing;
insert into public.channels (id, login, twitch_id, owner_id, status) values
  ('11111111-0000-0000-0000-000000000001', 'testkanala', '9000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'active'),
  ('22222222-0000-0000-0000-000000000002', 'testkanalb', '9000000002', 'bbbbbbbb-0000-0000-0000-00000000000b', 'active');
insert into core.bot_timers (channel_id, text, interval_min, min_lines, enabled) values
  ('11111111-0000-0000-0000-000000000001', 'A eigener Timer', 15, 5, true),
  ('22222222-0000-0000-0000-000000000002', 'B geheim', 15, 5, true);
insert into core.bot_settings (channel_id) values
  ('11111111-0000-0000-0000-000000000001'), ('22222222-0000-0000-0000-000000000002') on conflict do nothing;

-- ---------- 1) Streamer A sieht und ändert nur Kanal A ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(public.is_admin(), 'A ist Admin in Kanal A');
select pg_temp.check((select count(*) from public.bot_timers) = 1, 'A sieht den eigenen Timer über die Sicht');
select pg_temp.check((select count(*) from core.bot_timers where channel_id = '22222222-0000-0000-0000-000000000002') = 0,
                     'A sieht Timer von B auch direkt in core nicht');
select pg_temp.check((select count(*) from core.bot_settings where channel_id = '22222222-0000-0000-0000-000000000002') = 0,
                     'A sieht Bot-Einstellungen von B auch direkt in core nicht');
select pg_temp.check((select count(*) from core.bot_settings where channel_id = '11111111-0000-0000-0000-000000000001') = 1,
                     'A sieht die eigenen Bot-Einstellungen');
with u as (update core.bot_timers set text = 'gekapert' where channel_id = '22222222-0000-0000-0000-000000000002' returning 1)
select pg_temp.check((select count(*) from u) = 0, 'A kann Timer von B nicht ändern');
with d as (delete from core.bot_timers where channel_id = '22222222-0000-0000-0000-000000000002' returning 1)
select pg_temp.check((select count(*) from d) = 0, 'A kann Timer von B nicht löschen');
-- A gibt sich als Kanal B aus
select set_config('request.headers', '{"x-channel":"22222222-0000-0000-0000-000000000002"}', true);
select pg_temp.check(not public.is_admin(), 'A ist kein Admin in Kanal B');
select pg_temp.check((select count(*) from public.bot_timers) = 0, 'A sieht mit x-channel B keine Timer von B');
reset role;

-- ---------- 2) Bits-Quittung zählt plattformweit genau einmal ----------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check((public.panel_sound_play('tw:123', 'Zuschauer', 'airhorn', null, '', false, 'tx-test-1', 'sound_100', 100) ->> 'ok')::boolean,
                     'Quittung spielt in Kanal A');
select pg_temp.check((public.panel_sound_play('tw:123', 'Zuschauer', 'airhorn', null, '', false, 'tx-test-1', 'sound_100', 100) ->> 'duplicate')::boolean,
                     'dieselbe Quittung in Kanal A: Doppelte, kein zweiter Sound');
select set_config('request.headers', '{"x-channel":"22222222-0000-0000-0000-000000000002"}', true);
select pg_temp.check((public.panel_sound_play('tw:123', 'Zuschauer', 'airhorn', null, '', false, 'tx-test-1', 'sound_100', 100) ->> 'reason') = 'receipt',
                     'dieselbe Quittung in Kanal B wird abgelehnt');
select pg_temp.check((select count(*) from core.pranks where channel_id = '22222222-0000-0000-0000-000000000002') = 0,
                     'in Kanal B läuft dafür kein Sound');
select pg_temp.check((select count(*) from core.bits_transactions where transaction_id = 'tx-test-1') = 1,
                     'die Transaktion steht genau einmal in der Datenbank');

rollback;
