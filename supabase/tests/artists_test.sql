-- Tests zum Artist-Upload (…_artists.sql). Läuft gegen eine Datenbank mit allen Migrationen,
-- ändert nichts dauerhaft (Transaktion mit rollback). Nur lokal/Test:
--   psql -v ON_ERROR_STOP=1 -d <testdatenbank> -f supabase/tests/artists_test.sql
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
-- als angemeldeter Nutzer
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated","aal":"aal1"}', u), true);
end $$;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'artist@test.invalid'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'streamer@test.invalid'),
  ('cccccccc-0000-0000-0000-00000000000c', 'fremd@test.invalid')
  on conflict do nothing;
insert into public.channels (id, login, twitch_id, owner_id, status) values
  ('22222222-0000-0000-0000-000000000002', 'testkanalb', '9000000002', 'bbbbbbbb-0000-0000-0000-00000000000b', 'active');
-- Dateien liegen schon im Bucket (der Browser lädt sie vor dem Anmelden hoch)
insert into storage.objects (bucket_id, name) values
  ('artist-assets', 'aaaaaaaa-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.png'),
  ('artist-assets', 'aaaaaaaa-0000-0000-0000-00000000000a/22222222-2222-2222-2222-222222222222.webm'),
  ('artist-assets', 'aaaaaaaa-0000-0000-0000-00000000000a/33333333-3333-3333-3333-333333333333.png');

-- ---------- Bewerben ----------
set local role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000000a');
select pg_temp.check(pg_temp.fails($q$select public.artist_apply('Pixel Pinsel', 'pixel-pinsel', 'Ich male Overlays.', '{}')$q$), 'Bewerbung ohne Link: abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.artist_apply('Pixel Pinsel', 'Pixel Pinsel!', '', array['https://example.com/pp'])$q$), 'ungültige Kennung: abgelehnt');
select public.artist_apply('Pixel Pinsel', 'pixel-pinsel', 'Ich male Overlays.', array['https://example.com/pp', 'javascript:alert(1)', 'http://unsicher.example']);
select pg_temp.check(public.artist_me()->'artist'->>'status' = 'pending', 'Bewerbung wartet auf Freigabe');
select pg_temp.check(json_array_length(public.artist_me()->'artist'->'links') = 1, 'nur https-Links bleiben');
select pg_temp.check(pg_temp.fails($q$select public.artist_asset_submit('alert', 'Hype', '', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.png', '{}', true)$q$),
                     'vor der Freigabe: kein Upload');
select pg_temp.check(not public.artist_ok(), 'Storage: noch kein Hochladen erlaubt');
select pg_temp.as_user('cccccccc-0000-0000-0000-00000000000c');
select pg_temp.check(pg_temp.fails($q$select public.artist_apply('Kopie', 'pixel-pinsel', '', array['https://example.com/x'])$q$), 'Kennung schon vergeben');
select pg_temp.check(pg_temp.fails($q$select public.artist_admin_list()$q$), 'Nutzer kommt nicht an die Admin-Liste');
select pg_temp.check(pg_temp.fails($q$select public.artist_admin_review('aaaaaaaa-0000-0000-0000-00000000000a', 'approved', '')$q$), 'Nutzer kann sich nicht selbst freischalten');
reset role;

-- ---------- Admin schaltet frei (Service-Rolle) ----------
select pg_temp.check(json_array_length(public.artist_admin_list()->'artists') = 1, 'Admin sieht die Bewerbung');
select public.artist_admin_review('aaaaaaaa-0000-0000-0000-00000000000a', 'approved', 'Willkommen!');

-- ---------- Hochladen ----------
set local role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000000a');
select pg_temp.check(public.artist_ok(), 'freigeschaltet: Hochladen erlaubt');
select pg_temp.check(public.artist_me()->'artist'->>'note' = 'Willkommen!', 'Artist sieht die Nachricht des Admins');
select pg_temp.check(pg_temp.fails($q$select public.artist_asset_submit('alert', 'Hype', '', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.png', '{}', false)$q$),
                     'ohne Rechte-Bestätigung: abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.artist_asset_submit('alert', 'Fremd', '', '{}', 'cccccccc-0000-0000-0000-00000000000c/11111111-1111-1111-1111-111111111111.png', '{}', true)$q$),
                     'fremder Ordner: abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.artist_asset_submit('alert', 'Fehlt', '', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/99999999-9999-9999-9999-999999999999.png', '{}', true)$q$),
                     'Datei nicht im Bucket: abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.artist_asset_submit('background', 'Video', '', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/22222222-2222-2222-2222-222222222222.webm', '{}', true)$q$),
                     'Hintergrund als Video: abgelehnt');
select public.artist_asset_submit('alert', 'Hype-Rakete', 'Für große Momente', array['Hype', 'hype', 'Rakete!', 'x'],
  'aaaaaaaa-0000-0000-0000-00000000000a/22222222-2222-2222-2222-222222222222.webm', '{}', true);
select public.artist_asset_submit('look', 'Neon-Nacht', '', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.png',
  '{"base": "cyberpunk", "accent": "#FF00AA", "alert": "aaaaaaaa-0000-0000-0000-00000000000a/22222222-2222-2222-2222-222222222222.webm", "evil": "<script>"}', true);
select pg_temp.check(json_array_length(public.artist_gallery()) = 0, 'vor der Prüfung: nichts in der Galerie');
select pg_temp.check(pg_temp.fails($q$select count(*) from core.artist_assets$q$), 'Artist liest die Tabelle nicht direkt');
reset role;
select pg_temp.check((select tags from core.artist_assets where title = 'Hype-Rakete') = array['hype', 'rakete'], 'Tags bereinigt (klein, ohne Doppelte, zu kurze raus)');
select pg_temp.check((select extra from core.artist_assets where title = 'Neon-Nacht') =
  '{"base": "cyberpunk", "accent": "#ff00aa", "alert": "aaaaaaaa-0000-0000-0000-00000000000a/22222222-2222-2222-2222-222222222222.webm"}'::jsonb,
  'Look: nur bekannte Felder, Farbe klein');
select set_config('test.hype', (select id::text from core.artist_assets where title = 'Hype-Rakete'), true);

-- ---------- Freigabe ----------
select public.artist_asset_review((select id from core.artist_assets where title = 'Hype-Rakete'), 'approved', '');
select pg_temp.check(cardinality(public.artist_asset_review((select id from core.artist_assets where title = 'Neon-Nacht'), 'rejected', 'Bild zu unscharf')) = 2,
                     'abgelehnt: beide Dateien zum Löschen');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.check(json_array_length(public.artist_gallery()) = 1, 'Galerie: nur der freigegebene Upload');
select pg_temp.check(public.artist_gallery()->0->'artist'->>'name' = 'Pixel Pinsel', 'Credit: Name des Artists');
select pg_temp.check(public.artist_gallery()::text not like '%artist@test%' and public.artist_gallery()::text not like '%aaaaaaaa-0000-0000-0000-00000000000a"%',
                     'Galerie ohne E-Mail und Konto-ID');
select pg_temp.check(public.artist_gallery()::text not like '%Willkommen%', 'Galerie ohne Admin-Notiz');
select pg_temp.check(pg_temp.fails($q$select count(*) from core.artists$q$), 'Gast kommt nicht an die Tabellen');
select pg_temp.check(pg_temp.fails($q$select public.artist_asset_report((select (public.artist_gallery()->0->'asset'->>'id')::uuid), 'kaputt')$q$), 'Gast kann nicht melden');
reset role;

-- ---------- Streamer übernimmt und meldet ----------
set local role authenticated;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-00000000000b');
select set_config('request.headers', '{"x-channel":"22222222-0000-0000-0000-000000000002"}', true);
select public.artist_asset_use((select (public.artist_gallery()->0->'asset'->>'id')::uuid));
select public.artist_asset_use((select (public.artist_gallery()->0->'asset'->>'id')::uuid));
select pg_temp.check((public.artist_gallery()->0->'asset'->>'uses')::int = 1, 'Übernahme zählt je Kanal einmal');
select public.artist_asset_report((select (public.artist_gallery()->0->'asset'->>'id')::uuid), 'Das ist geklaut von XY');
select pg_temp.as_user('cccccccc-0000-0000-0000-00000000000c');
select pg_temp.check(pg_temp.fails($q$select public.artist_asset_use((select (public.artist_gallery()->0->'asset'->>'id')::uuid))$q$),
                     'Fremder (kein Admin des Kanals) zählt keine Übernahme');
reset role;
select pg_temp.check(json_array_length(public.artist_admin_list()->'assets'->0->'reports') = 1, 'Admin sieht die Meldung');

-- ---------- Eigene Uploads, Löschen, Sperren ----------
set local role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000000a');
select pg_temp.check(json_array_length(public.artist_me()->'assets') = 2, 'Artist sieht beide Uploads');
select pg_temp.check(public.artist_me()::text like '%Bild zu unscharf%', 'Artist sieht den Ablehnungsgrund');
select pg_temp.as_user('cccccccc-0000-0000-0000-00000000000c');
select pg_temp.check(pg_temp.fails($q$select public.artist_asset_delete(current_setting('test.hype')::uuid)$q$), 'Fremder kann nicht löschen');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000000a');
select pg_temp.check(cardinality(public.artist_asset_delete((select (x->>'id')::uuid from json_array_elements(public.artist_me()->'assets') x where x->>'title' = 'Neon-Nacht'))) = 2,
                     'eigenen Upload löschen: Dateien zum Entfernen');
reset role;
select public.artist_admin_review('aaaaaaaa-0000-0000-0000-00000000000a', 'blocked', 'Geklaute Designs');
select pg_temp.check(json_array_length(public.artist_gallery()) = 0, 'gesperrter Artist: Designs verschwinden aus der Galerie');
set local role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-00000000000a');
select pg_temp.check(pg_temp.fails($q$select public.artist_apply('Neu', 'neu-name', '', array['https://example.com/x'])$q$), 'gesperrt: keine neue Bewerbung');
select pg_temp.check(not public.artist_ok(), 'gesperrt: kein Hochladen mehr');
reset role;

rollback;
