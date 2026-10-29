-- Tests zur Sponsoring-Börse (…_sponsoring.sql). Läuft gegen eine Datenbank mit allen Migrationen,
-- ändert nichts dauerhaft (Transaktion mit rollback). Nur lokal/Test:
--   psql -v ON_ERROR_STOP=1 -d <testdatenbank> -f supabase/tests/sponsoring_test.sql
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
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a@test.invalid'), ('bbbbbbbb-0000-0000-0000-00000000000b', 'b@test.invalid'),
  ('cccccccc-0000-0000-0000-00000000000c', 'c@test.invalid')
  on conflict do nothing;
insert into public.channels (id, login, twitch_id, owner_id, status, display_name) values
  ('11111111-0000-0000-0000-000000000001', 'kleina', '9000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'active', 'KleinA'),
  ('22222222-0000-0000-0000-000000000002', 'grossb', '9000000002', 'bbbbbbbb-0000-0000-0000-00000000000b', 'active', 'GrossB'),
  ('33333333-0000-0000-0000-000000000003', 'wartetc', '9000000003', 'cccccccc-0000-0000-0000-00000000000c', 'pending', 'WartetC');
-- A: Ø 20 Zuschauer, B: Ø 500
insert into core.stream_sessions (channel_id, started_at, ended_at, peak_viewers, viewer_sum, samples) values
  ('11111111-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '3 days' + interval '2 hours', 30, 200, 10),
  ('22222222-0000-0000-0000-000000000002', now() - interval '2 days', now() - interval '2 days' + interval '2 hours', 700, 5000, 10);

-- ---------- Firma reicht ein (Edge Function, Service-Rolle) ----------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.check(pg_temp.fails($q$select public.sponsoring_submit('dddddddd-0000-0000-0000-00000000000d', 'kurz', '{}', null)$q$), 'ungültiger Token-Hash abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.sponsoring_submit('dddddddd-0000-0000-0000-00000000000d', repeat('a', 64),
  '{"company":"X","contact_email":"nicht-mail","title":"Titel","description":"Beschreibung lang genug"}', null)$q$), 'ungültige E-Mail abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.sponsoring_submit('dddddddd-0000-0000-0000-00000000000d', repeat('a', 64),
  '{"company":"GamerFuel","contact_email":"deals@gamerfuel.example","title":"Energy-Partner","description":"Wir suchen Streamer für unseren Drink.","link":"http://x.de"}', null)$q$), 'Link nur https');
select public.sponsoring_submit('dddddddd-0000-0000-0000-00000000000d', repeat('a', 64),
  '{"company":"GamerFuel","contact_email":"Deals@GamerFuel.example","title":"Energy-Partner","description":"Wir suchen Streamer für unseren Drink.",
    "reward":"50 € pro Monat + Produktpaket","pay_mode":"streamhelp","amount_cents":"5000","min_viewers":"5","max_viewers":"100","slots":"1",
    "overlay_text":"Energy ohne Zucker","code":"STREAM10","link":"https://gamerfuel.example","every_min":"2","show_sec":"99"}',
  'dddddddd-0000-0000-0000-00000000000d.png');
select pg_temp.check((select status = 'pending' and every_min = 5 and show_sec = 60 and contact_email = 'deals@gamerfuel.example' from core.sponsor_offers),
                     'Angebot wartet auf Freigabe, Werte begrenzt, E-Mail klein');
select pg_temp.check(public.sponsoring_manage(repeat('a', 64))->'offer'->>'status' = 'pending', 'Firma sieht ihr Angebot über den Link');
select pg_temp.check(public.sponsoring_manage(repeat('b', 64)) is null, 'falscher Link: nichts');

-- ---------- Streamer sehen nichts vor der Freigabe ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(json_array_length(public.sponsoring_offers()->'offers') = 0, 'vor der Freigabe: kein Angebot');
select pg_temp.check((public.sponsoring_offers()->'size'->>'avg')::int = 20, 'Kanalgröße A: Ø 20');
select pg_temp.check(pg_temp.fails($q$select * from core.sponsor_offers$q$), 'Angebote direkt nicht lesbar');
select pg_temp.check(pg_temp.fails($q$select public.sponsoring_manage(repeat('a', 64))$q$), 'sponsoring_manage nur für die Service-Rolle');
select pg_temp.check(pg_temp.fails($q$select public.sponsoring_review('dddddddd-0000-0000-0000-00000000000d', 'active', '')$q$), 'Freigabe nur Admin (Service-Rolle)');
reset role;

-- ---------- Admin gibt frei ----------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.check((public.sponsoring_review('dddddddd-0000-0000-0000-00000000000d', 'active', '')->0->>'status') = 'active', 'Admin gibt frei');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(json_array_length(public.sponsoring_offers()->'offers') = 1, 'A (Ø 20) passt: Angebot sichtbar');
select pg_temp.check(public.sponsoring_offers()::text !~ 'gamerfuel\.example"[^}]*contact' and public.sponsoring_offers()::text !~ 'deals@', 'Streamer sieht keine Kontakt-E-Mail');
select pg_temp.check(public.sponsoring_offers()::text !~ repeat('a', 64), 'Streamer sieht den Token-Hash nicht');
-- B ist zu groß
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"22222222-0000-0000-0000-000000000002"}', true);
select pg_temp.check(json_array_length(public.sponsoring_offers()->'offers') = 0, 'B (Ø 500) passt nicht: unsichtbar');
select pg_temp.check(pg_temp.fails($q$select public.sponsoring_apply('dddddddd-0000-0000-0000-00000000000d', 'Hallo', true)$q$), 'B kann sich nicht bewerben (Größe)');
-- C ist noch nicht freigeschaltet
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"33333333-0000-0000-0000-000000000003"}', true);
select pg_temp.check(pg_temp.fails($q$select public.sponsoring_apply('dddddddd-0000-0000-0000-00000000000d', 'Hallo', false)$q$), 'nicht freigeschalteter Kanal: keine Bewerbung');
-- A bewirbt sich (mit Zahlen)
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select public.sponsoring_apply('dddddddd-0000-0000-0000-00000000000d', 'Ich streame gern mit Energy!', true);
select pg_temp.check(json_array_length(public.sponsoring_offers()->'mine') = 1 and public.sponsoring_offers()->'mine'->0->>'status' = 'pending', 'Bewerbung wartet');
select pg_temp.check(pg_temp.fails($q$select public.sponsoring_apply('dddddddd-0000-0000-0000-00000000000d', 'nochmal', true)$q$), 'nicht doppelt bewerben');
reset role;

-- ---------- Firma entscheidet ----------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.check((public.sponsoring_manage(repeat('a', 64))->'applications'->0->'stats'->>'avg')::int = 20, 'Firma sieht Zahlen (Zustimmung)');
select set_config('test.app', (select id::text from core.sponsor_applications limit 1), true);
select public.sponsoring_decide(repeat('a', 64), current_setting('test.app')::bigint, 'accept', 'Willkommen!');
select pg_temp.check((select name = 'GamerFuel' and code = 'STREAM10' and logo_path is not null and every_min = 5 and offer_id is not null
                      from core.sponsors where channel_id = '11111111-0000-0000-0000-000000000001'), 'Zusage: Sponsor im Kanal angelegt (Einblendung der Firma)');
select pg_temp.check(pg_temp.fails(format($q$select public.sponsoring_decide(repeat('b', 64), %s, 'decline', '')$q$, current_setting('test.app'))), 'fremder Link kann nicht entscheiden');
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(public.sponsor_list()->0->>'logo_path' like '%.png' and (public.sponsor_list()->0->>'show_sec')::int = 60, 'Overlay bekommt Logo und Takt');

select set_config('test.sid', (select id::text from core.sponsors where offer_id is not null), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select public.sponsor_save(current_setting('test.sid')::bigint, 'Gekapert', 'x', 'X', '', false);
reset role;
select pg_temp.check((select name = 'GamerFuel' and not active from core.sponsors where id = current_setting('test.sid')::bigint),
                     'Börsen-Sponsor: Streamer kann nur pausieren, nicht umschreiben');
-- Plätze voll (slots = 1): Admin-Liste zeigt die Bewerbung
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.check((public.sponsoring_admin_list()->0->'applications'->0->>'status') = 'accepted', 'Admin sieht die Zusage');
select pg_temp.check((public.sponsoring_pay(current_setting('test.app')::bigint, 'paid_in')->0->'applications'->0->>'pay_status') = 'paid_in', 'Abrechnungs-Stand von Hand');
select pg_temp.check(pg_temp.fails($q$select public.sponsoring_pay(1, 'bar')$q$), 'unbekannter Stand abgelehnt');

-- Streamer beendet
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select public.sponsoring_withdraw('dddddddd-0000-0000-0000-00000000000d');
select pg_temp.check(public.sponsoring_offers()->'mine'->0->>'status' = 'ended', 'Streamer beendet: Status beendet');
reset role;
select pg_temp.check(not exists (select 1 from core.sponsors where offer_id is not null), 'Sponsor verschwindet aus Overlay und Chat');

-- Firma schließt das Angebot
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.check(public.sponsoring_close(repeat('a', 64))->'offer'->>'status' = 'closed', 'Firma beendet das Angebot');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.check(pg_temp.fails($q$select public.sponsoring_offers()$q$), 'Gast sieht keine Angebote');
select pg_temp.check(pg_temp.fails($q$select public.sponsoring_submit('dddddddd-0000-0000-0000-00000000000e', repeat('c', 64), '{}', null)$q$), 'Gast kann nicht direkt einreichen (nur über die Edge Function)');
reset role;

rollback;
