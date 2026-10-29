-- Tests zu Raid-Netzwerk und Freunde werben (…_raid_network.sql). Läuft gegen eine Datenbank mit allen
-- Migrationen, ändert nichts dauerhaft (Transaktion mit rollback). Nur lokal/Test:
--   psql -v ON_ERROR_STOP=1 -d <testdatenbank> -f supabase/tests/raid_network_test.sql
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
  ('cccccccc-0000-0000-0000-00000000000c', 'c@test.invalid'), ('dddddddd-0000-0000-0000-00000000000d', 'd@test.invalid')
  on conflict do nothing;
insert into public.channels (id, login, twitch_id, owner_id, status, display_name) values
  ('11111111-0000-0000-0000-000000000001', 'testkanala', '9000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'active', 'KanalA'),
  ('22222222-0000-0000-0000-000000000002', 'testkanalb', '9000000002', 'bbbbbbbb-0000-0000-0000-00000000000b', 'active', 'KanalB'),
  ('33333333-0000-0000-0000-000000000003', 'testkanalc', '9000000003', 'cccccccc-0000-0000-0000-00000000000c', 'active', 'KanalC');
-- A und B sind live im selben Spiel, C ist live, macht aber nicht mit
insert into core.stream_games (channel_id, id, live_category, live_at) values
  ('11111111-0000-0000-0000-000000000001', 1, 'Fortnite', now()),
  ('22222222-0000-0000-0000-000000000002', 1, 'Fortnite', now() - interval '3 minutes'),
  ('33333333-0000-0000-0000-000000000003', 1, 'Minecraft', now());

-- ---------- Raid-Netzwerk ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check((public.raid_network_get()->>'enabled')::boolean = false, 'anfangs nicht im Netzwerk');
select pg_temp.check(pg_temp.fails($q$select * from core.raid_network$q$), 'Tabelle direkt nicht lesbar');
select public.raid_network_save(false, 'de', 'Chill & Fortnite', true, true, '');
-- B macht mit, C nicht
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"22222222-0000-0000-0000-000000000002"}', true);
select public.raid_network_save(true, 'de', 'Ranked mit Chat', true, true, '');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(json_array_length(public.raid_network_get()->'suggestions') = 0, 'wer selbst nicht mitmacht, sieht keine Vorschläge');
select pg_temp.check((public.raid_network_save(true, 'de', 'Chill & Fortnite', true, true, '')->>'enabled')::boolean, 'A macht jetzt mit');
select pg_temp.check(json_array_length(public.raid_network_get()->'suggestions') = 1, 'nur Mitglieder, die live sind (B, nicht C)');
select pg_temp.check((public.raid_network_get()->'suggestions'->0->>'login') = 'testkanalb'
                     and (public.raid_network_get()->'suggestions'->0->>'same_game')::boolean, 'B: gleiches Spiel erkannt');
select pg_temp.check(public.raid_network_get()->>'raid_text' like '%{target}%', 'leerer Ansage-Text = Standardtext');
select pg_temp.check((public.raid_network_save(true, 'xx', '', true, true, 'x')->>'language') = 'other', 'unbekannte Sprache = other');
select public.raid_network_save(true, 'de', 'Chill & Fortnite', true, true, 'Auf zu {target}!');

-- Dienst-Funktionen sind für eingeloggte Nutzer gesperrt
select pg_temp.check(pg_temp.fails($q$select public.raid_target('testkanalb')$q$), 'raid_target nur für die Service-Rolle');
select pg_temp.check(pg_temp.fails($q$select public.raid_logged('22222222-0000-0000-0000-000000000002')$q$), 'raid_logged nur für die Service-Rolle');
select pg_temp.check(pg_temp.fails($q$select public.raid_welcome('9000000002')$q$), 'raid_welcome nur für die Service-Rolle');

-- Fremde und Gäste
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated","aal":"aal1"}', true);
select pg_temp.check(pg_temp.fails($q$select public.raid_network_get()$q$), 'C sieht die Einstellungen von Kanal A nicht');
select pg_temp.check(pg_temp.fails($q$select public.raid_network_save(false, 'de', '', true, true, '')$q$), 'C kann Kanal A nicht ändern');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.check(pg_temp.fails($q$select public.raid_network_get()$q$), 'Gast sieht nichts');
reset role;

-- Edge Function (Service-Rolle) für Kanal A
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(public.raid_target('testkanalb')->>'twitch_id' = '9000000002', 'Raid-Ziel B: Twitch-ID geliefert');
select pg_temp.check(public.raid_target('TestKanalB')->>'raid_text' = 'Auf zu {target}!', 'Ansage-Text dabei, Name ohne Groß/klein');
select pg_temp.check(pg_temp.fails($q$select public.raid_target('testkanalc')$q$), 'C macht nicht mit: kein Raid-Ziel');
select pg_temp.check(pg_temp.fails($q$select public.raid_target('testkanala')$q$), 'sich selbst raiden: nein');
select pg_temp.check(pg_temp.fails($q$select public.raid_target('gibtsnicht')$q$), 'unbekannter Kanal: nein');
select public.raid_logged('22222222-0000-0000-0000-000000000002');
select pg_temp.check(pg_temp.fails($q$select public.raid_target('testkanalb')$q$), 'höchstens ein Raid je 2 Minuten');
update core.stream_games set live_at = now() - interval '30 minutes' where channel_id = '22222222-0000-0000-0000-000000000002';
update core.raid_log set created_at = now() - interval '5 minutes';
select pg_temp.check(pg_temp.fails($q$select public.raid_target('testkanalb')$q$), 'B offline: kein Raid-Ziel');
update core.stream_games set live_at = now() where channel_id = '22222222-0000-0000-0000-000000000002';
-- B raidet A: A begrüßt, weil beide mitmachen
select pg_temp.check(public.raid_welcome('9000000002')->>'note' = 'Ranked mit Chat', 'Raid aus dem Netzwerk: Kurztext für die Begrüßung');
select pg_temp.check(public.raid_welcome('9000000003') is null, 'Raid von außerhalb: keine Netzwerk-Begrüßung');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select pg_temp.check((public.raid_network_get()->'suggestions'->0->>'raided_recently')::boolean, 'kürzlich geraidet wird markiert');
reset role;

-- ---------- Freunde werben ----------
-- D meldet sich als Streamer an (Kanal wartet auf Freischaltung) und kam über den Link von A
insert into public.channels (id, login, twitch_id, owner_id, status, display_name) values
  ('44444444-0000-0000-0000-000000000004', 'testkanald', '9000000004', 'dddddddd-0000-0000-0000-00000000000d', 'pending', 'KanalD');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal1"}', true);
select pg_temp.check(not public.referral_claim('gibtsnicht'), 'unbekannter Werber: nichts gespeichert');
select pg_temp.check(not public.referral_claim('testkanald'), 'sich selbst werben: nein');
select pg_temp.check(public.referral_claim('TestKanalA'), 'Werber A gemerkt');
select pg_temp.check(not public.referral_claim('testkanalb'), 'Werber nur einmal, nicht nachträglich ändern');
-- B (schon freigeschaltet) kann sich nicht nachträglich zuordnen
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal1"}', true);
select pg_temp.check(not public.referral_claim('testkanala'), 'freigeschalteter Kanal: keine Zuordnung mehr');
-- A sieht D als wartend, noch kein Abzeichen
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check((public.referral_get()->>'pending')::int = 1 and (public.referral_get()->>'active')::int = 0
                     and public.referral_get()->>'badge' = '', 'A: 1 wartend, noch kein Abzeichen');
select pg_temp.check(pg_temp.fails($q$select * from core.referrals$q$), 'Tabelle direkt nicht lesbar');
reset role;
-- Admin-Liste: D steht mit „geworben von“ vorne
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.check((public.channels_admin()->0->>'login') = 'testkanald' and (public.channels_admin()->0->>'referred_by') = 'KanalA',
                     'Admin: geworbene Bewerbung zuerst, mit „geworben von“');
update public.channels set status = 'active' where id = '44444444-0000-0000-0000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select pg_temp.check(public.referral_get()->>'badge' = 'werber' and (public.referral_get()->>'active')::int = 1, 'nach Freischaltung: Abzeichen „werber“');
select public.profile_save('Hallo!', '[]', 'Europe/Berlin', null, '', true);
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.check(public.public_profile('testkanala')->>'badge' = 'werber', 'öffentliches Profil zeigt das Abzeichen');
select pg_temp.check(public.public_profile('testkanala')::text !~ 'testkanald', 'öffentlich keine Liste der Geworbenen');
reset role;
select pg_temp.check(public.referral_badge(3) = 'netzwerker' and public.referral_badge(10) = 'botschafter', 'Stufen 3 und 10');

rollback;
