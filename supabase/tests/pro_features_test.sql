-- Tests zur Pro-Abfrage (…_pro_features.sql). Läuft gegen eine Datenbank mit allen Migrationen, ändert nichts
-- dauerhaft (Transaktion mit rollback). Nur lokal/Test:
--   psql -v ON_ERROR_STOP=1 -d <testdatenbank> -f supabase/tests/pro_features_test.sql
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
insert into public.channels (id, login, twitch_id, owner_id, status, display_name) values
  ('11111111-0000-0000-0000-000000000001', 'testkanala', '9000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'active', 'KanalA'),
  ('22222222-0000-0000-0000-000000000002', 'testkanalb', '9000000002', 'bbbbbbbb-0000-0000-0000-00000000000b', 'active', 'KanalB');

-- Zuschauer (ohne Anmeldung) fragen für Kanal A
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(public.channel_has_pro() = false, 'anfangs kein Pro');
select pg_temp.check(pg_temp.fails($q$select public.channel_is_pro('11111111-0000-0000-0000-000000000001')$q$), 'channel_is_pro nicht für Zuschauer');
select pg_temp.check(pg_temp.fails($q$select * from core.channel_plans$q$), 'Tabelle direkt nicht lesbar');
reset role;

-- Admin vergibt Pro an A (Service-Rolle)
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.pro_grant('11111111-0000-0000-0000-000000000001', 30, 'Tester');
select pg_temp.check(public.channel_is_pro('11111111-0000-0000-0000-000000000001'), 'Service-Rolle: A hat Pro');
select pg_temp.check(not public.channel_is_pro('22222222-0000-0000-0000-000000000002'), 'Service-Rolle: B hat kein Pro');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.check(public.channel_has_pro(), 'Zuschauer sehen: A hat Pro');
select set_config('request.headers', '{"x-channel":"22222222-0000-0000-0000-000000000002"}', true);
select pg_temp.check(public.channel_has_pro() = false, 'Zuschauer sehen: B hat kein Pro');
select set_config('request.headers', '{}', true);
select pg_temp.check(public.channel_has_pro() = false, 'ohne Kanal: kein Pro');
reset role;

-- Abgelaufen zählt nicht
update core.channel_plans set until = now() - interval '1 minute' where channel_id = '11111111-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(public.channel_has_pro() = false, 'abgelaufenes Pro zählt nicht');
reset role;

rollback;
