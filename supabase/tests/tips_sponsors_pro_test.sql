-- Tests zu Trinkgeld, Sponsoren und Pro (…_tips_sponsors_pro.sql). Läuft gegen eine Datenbank mit allen
-- Migrationen, ändert nichts dauerhaft (Transaktion mit rollback). Nur lokal/Test:
--   psql -v ON_ERROR_STOP=1 -d <testdatenbank> -f supabase/tests/tips_sponsors_pro_test.sql
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

-- ---------- Trinkgeld ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check((public.tip_get()->>'kofi')::boolean = false, 'anfangs kein Ko-fi');
select pg_temp.check(pg_temp.fails($q$select public.tip_save('[{"label":"PayPal","url":"http://paypal.me/x"}]', true, true, '', 0)$q$), 'nur https-Links');
select pg_temp.check(pg_temp.fails($q$select public.tip_save('[{"label":"x","url":"javascript:alert(1)"}]', true, true, '', 0)$q$), 'javascript: abgelehnt');
select public.tip_save('[{"label":"PayPal","url":"https://paypal.me/testa"},{"label":"","url":""},{"label":"Tipeee","url":"https://tipeee.com/testa"}]', true, true, '', 200);
select pg_temp.check(json_array_length(public.tip_get()->'links') = 2, 'leere Links fallen weg');
select pg_temp.check(public.tip_get()->>'thank_text' like '%{amount}%' and (public.tip_get()->>'min_cents')::int = 200, 'Standard-Dank, Mindestbetrag');
select pg_temp.check(pg_temp.fails($q$select public.tip_kofi_token('<script>')$q$), 'ungültiger Token abgelehnt');
select pg_temp.check((public.tip_kofi_token('a1b2c3d4-e5f6-7890-abcd-ef1234567890')->>'kofi')::boolean, 'Ko-fi verbunden');
select pg_temp.check(public.tip_get()::text !~ 'a1b2c3d4', 'Token wird nie zurückgegeben');
select pg_temp.check(pg_temp.fails($q$select * from core.tip_settings$q$), 'Tabelle direkt nicht lesbar');
select pg_temp.check(pg_temp.fails($q$select public.tip_kofi_check('a1b2c3d4-e5f6-7890-abcd-ef1234567890')$q$), 'tip_kofi_check nur für die Service-Rolle');
select pg_temp.check(pg_temp.fails($q$select public.money_chat('1', 'x', '{}', '!trinkgeld')$q$), 'money_chat nur für die Service-Rolle');
-- Test-Alert Trinkgeld
select pg_temp.check((public.alert_test('tip')).tier = 'EUR', 'Test-Alert Trinkgeld (Währung EUR)');
-- B darf nichts bei A
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal1"}', true);
select pg_temp.check(pg_temp.fails($q$select public.tip_get()$q$), 'B sieht Trinkgeld-Einstellungen von A nicht');
select pg_temp.check(pg_temp.fails($q$select public.tip_kofi_token('zzzzzzzz-zzzz')$q$), 'B kann den Ko-fi-Token von A nicht setzen');
reset role;

-- Edge Function (Service-Rolle)
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(public.tip_kofi_check('falsch-falsch') is null, 'falscher Token: nichts');
select pg_temp.check(public.tip_kofi_check(null) is null, 'ohne Token: nichts');
select pg_temp.check((public.tip_kofi_check('a1b2c3d4-e5f6-7890-abcd-ef1234567890')->>'min_cents')::int = 200, 'richtiger Token: Einstellungen');
insert into core.stream_alerts (channel_id, kind, user_name, tier, amount, message, event_id)
  values ('11111111-0000-0000-0000-000000000001', 'tip', 'Lena', 'EUR', 500, 'Danke!', 'kofi:tx1');
select set_config('request.headers', '{"x-channel":"22222222-0000-0000-0000-000000000002"}', true);
select pg_temp.check(public.tip_kofi_check('a1b2c3d4-e5f6-7890-abcd-ef1234567890') is null, 'Token von A gilt nicht für Kanal B');
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(public.money_chat('1', 'Max', '{}', '!trinkgeld')->>'reply' like '%https://paypal.me/testa%', '!trinkgeld nennt die Links');
select pg_temp.check((public.money_chat('1', 'Max', '{}', '!spende')->>'reply') is null
                     and (public.money_chat('1', 'Max', '{}', '!spende')->>'handled')::boolean, 'Pause: zweites Mal still');
select pg_temp.check(not (public.money_chat('1', 'Max', '{}', '!sponsor')->>'handled')::boolean, 'ohne Sponsoren: !sponsor nicht erledigt (eigener Befehl darf)');
select pg_temp.check(not (public.money_chat('1', 'Max', '{}', '!hallo')->>'handled')::boolean, 'anderer Befehl: nicht erledigt');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select pg_temp.check(json_array_length(public.tip_get()->'recent') = 1 and public.tip_get()->'recent'->0->>'name' = 'Lena', 'letzte Trinkgelder (ohne Tests)');

-- ---------- Sponsoren ----------
select pg_temp.check(pg_temp.fails($q$select public.sponsor_save(null, '', '', '', '', true)$q$), 'Sponsor ohne Namen abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.sponsor_save(null, 'X', '', '', 'http://x.de', true)$q$), 'Sponsor-Link nur https');
select public.sponsor_save(null, 'GamerFuel', 'Energy ohne Zucker', 'STREAM10', 'https://gamerfuel.example', true);
select public.sponsor_save(null, 'Alt', '', '', '', false);
select pg_temp.check(json_array_length(public.sponsor_admin_list()) = 2, 'zwei Sponsoren angelegt');
select pg_temp.check(json_array_length(public.sponsor_list()) = 1, 'öffentlich nur aktive');
select pg_temp.check(pg_temp.fails($q$select * from core.sponsors$q$), 'Tabelle direkt nicht lesbar');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.check(public.sponsor_list()->0->>'code' = 'STREAM10', 'Overlay ohne Login liest die Sponsoren');
select pg_temp.check(pg_temp.fails($q$select public.sponsor_admin_list()$q$), 'Gast sieht die Verwaltung nicht');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update core.chat_cooldowns set at = now() - interval '1 minute' where channel_id = '11111111-0000-0000-0000-000000000001';
select pg_temp.check(public.money_chat('1', 'Max', '{}', '!sponsor')->>'reply' = 'Werbung: GamerFuel – Energy ohne Zucker · Code STREAM10 · https://gamerfuel.example', '!sponsor mit „Werbung“');
-- B kann Sponsoren von A nicht ändern
select set_config('test.sid', (select id::text from core.sponsors where name = 'GamerFuel'), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"22222222-0000-0000-0000-000000000002"}', true);
select pg_temp.check(pg_temp.fails(format($q$select public.sponsor_save(%s, 'Gekapert', '', '', '', true)$q$,
  current_setting('test.sid'))), 'B kann Sponsor von A nicht über die eigene Kanal-ID ändern');
select public.sponsor_delete(current_setting('test.sid')::bigint);
reset role;
select pg_temp.check(exists (select 1 from core.sponsors where name = 'GamerFuel'), 'B kann Sponsor von A nicht löschen');

-- ---------- Öffentliches Profil ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select public.profile_save('Hallo!', '[]', 'Europe/Berlin', null, '', true);
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.check(json_array_length(public.public_profile('testkanala')->'tips') = 2
                     and json_array_length(public.public_profile('testkanala')->'sponsors') = 1, 'Profil zeigt Trinkgeld-Links und aktive Sponsoren');
select pg_temp.check(public.public_profile('testkanala')::text !~ 'a1b2c3d4', 'Profil verrät den Ko-fi-Token nicht');
reset role;

-- ---------- Pro ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select pg_temp.check((public.pro_status()->>'pro')::boolean = false, 'anfangs kein Pro');
select pg_temp.check(pg_temp.fails($q$select public.pro_grant('11111111-0000-0000-0000-000000000001', 30, '')$q$), 'Pro vergeben nur der Plattform-Admin (Service-Rolle)');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.pro_grant('11111111-0000-0000-0000-000000000001', 30, 'Tester');
select pg_temp.check(public.channel_is_pro('11111111-0000-0000-0000-000000000001'), 'Pro aktiv');
select public.pro_grant('11111111-0000-0000-0000-000000000001', 30, '');
select pg_temp.check((select until > now() + interval '59 days' and note = 'Tester' from core.channel_plans), 'verlängert, Notiz bleibt');
select pg_temp.check((select (x->>'pro_until') is not null from json_array_elements(public.channels_admin()) x where x->>'login' = 'testkanala'), 'Admin-Liste zeigt Pro bis');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select pg_temp.check((public.pro_status()->>'pro')::boolean, 'Dashboard: Pro aktiv');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.pro_grant('11111111-0000-0000-0000-000000000001', 0, '');
select pg_temp.check(not public.channel_is_pro('11111111-0000-0000-0000-000000000001'), 'Pro entzogen');

rollback;
