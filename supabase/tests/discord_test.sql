-- Tests zur Discord-Anbindung (…_discord.sql). Läuft gegen eine Datenbank mit allen Migrationen,
-- ändert nichts dauerhaft (Transaktion mit rollback). Nur lokal/Test:
--   psql -v ON_ERROR_STOP=1 -d <testdatenbank> -f supabase/tests/discord_test.sql
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
  ('11111111-0000-0000-0000-000000000001', 'testkanala', '9000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'active', 'TestKanalA'),
  ('22222222-0000-0000-0000-000000000002', 'testkanalb', '9000000002', 'bbbbbbbb-0000-0000-0000-00000000000b', 'active', 'TestKanalB');

-- ---------- Streamer A verbindet seinen Discord ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check((public.discord_get()->>'connected')::boolean = false, 'anfangs nicht verbunden');
select pg_temp.check(pg_temp.fails($q$select public.discord_connect('https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz_-1234', 'x')$q$), 'Webhook setzen nur über die Edge Function');
reset role;

-- Edge Function (Service-Rolle, nachdem sie Recht und Webhook geprüft hat)
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.check(pg_temp.fails($q$select public.discord_connect('https://evil.example/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz', 'x')$q$), 'fremde Adresse abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.discord_connect('http://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz', 'x')$q$), 'ohne https abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.discord_connect('https://discord.com.evil.example/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz', 'x')$q$), 'Domain-Trick abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.discord_connect('https://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz?wait=1#', 'x')$q$), 'Zusätze an der Adresse abgelehnt');
select public.discord_connect('https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz_-1234', 'StreamHelp');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select pg_temp.check((public.discord_get()->>'connected')::boolean, 'gültiger Webhook verbunden');
select pg_temp.check(public.discord_get()->>'webhook_name' = 'StreamHelp', 'Name des Webhooks sichtbar');
select pg_temp.check(public.discord_get()::text !~ 'api/webhooks', 'discord_get verrät die Adresse nicht');
select pg_temp.check(pg_temp.fails($q$select * from core.discord_settings$q$), 'Tabelle direkt nicht lesbar');

select public.discord_save(true, true, true, '{streamer} ist live!', '<@&123456789012>');
select pg_temp.check(public.discord_get()->>'mention' = '123456789012', 'Rollen-Erwähnung <@&…> wird zur ID');
select public.discord_save(true, false, false, '', '@here');
select pg_temp.check(public.discord_get()->>'mention' = 'here' and (public.discord_get()->>'on_recap')::boolean = false, '@here gespeichert, Rückblick aus');
select pg_temp.check(public.discord_get()->>'live_text' like '%{streamer}%', 'leerer Text = Standardtext');
select pg_temp.check(pg_temp.fails($q$select public.discord_save(true, true, true, 'x', 'alle')$q$), 'ungültige Erwähnung abgelehnt');

-- Dienst-Funktionen sind für eingeloggte Nutzer gesperrt
select pg_temp.check(pg_temp.fails($q$select public.discord_target('live')$q$), 'discord_target nur für die Service-Rolle');
select pg_temp.check(pg_temp.fails($q$select public.discord_mark(true, '')$q$), 'discord_mark nur für die Service-Rolle');
select pg_temp.check(pg_temp.fails($q$select public.discord_recap()$q$), 'discord_recap nur für die Service-Rolle');
select pg_temp.check(pg_temp.fails($q$select public.discord_announce_data(null)$q$), 'discord_announce_data nur für die Service-Rolle');
select pg_temp.check(pg_temp.fails($q$select public.discord_idea_claim('x', now())$q$), 'discord_idea_claim nur für die Service-Rolle');

-- ---------- Fremde und Gäste ----------
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal1"}', true);
select pg_temp.check(pg_temp.fails($q$select public.discord_get()$q$), 'B sieht die Einstellungen von Kanal A nicht');
select pg_temp.check(pg_temp.fails($q$select public.discord_disconnect()$q$), 'B kann Kanal A nicht trennen');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.check(pg_temp.fails($q$select public.discord_get()$q$), 'Gast sieht nichts');
reset role;

-- ---------- Edge Functions (Service-Rolle) ----------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
create temp table t_live as select public.discord_target('live') as j;
select pg_temp.check((select j->>'url' like 'https://discord.com/api/webhooks/%' from t_live), 'Live-Meldung: Ziel geliefert');
select pg_temp.check((select j->>'display_name' = 'TestKanalA' and j->>'mention' = 'here' from t_live), 'Live-Meldung: Kanalname und Erwähnung dabei');
select pg_temp.check(public.discord_target('live') is null, 'Live-Meldung höchstens einmal je 30 Minuten');
select pg_temp.check(public.discord_target('recap') is null, 'Rückblick aus: kein Ziel');
select pg_temp.check(public.discord_target('manual') is not null, 'manuelle Ankündigung geht immer');
select public.discord_mark(false, 'HTTP 404');
select pg_temp.check((select last_error from core.discord_settings where channel_id = '11111111-0000-0000-0000-000000000001') = 'HTTP 404', 'Fehler gemerkt');
select public.discord_mark(true, '');
select pg_temp.check((select last_error = '' and last_ok_at is not null from core.discord_settings where channel_id = '11111111-0000-0000-0000-000000000001'), 'Erfolg gemerkt');

insert into core.stream_sessions (channel_id, started_at, ended_at, peak_viewers, viewer_sum, samples, game, follows, subs, bits, chatters)
  values ('11111111-0000-0000-0000-000000000001', now() - interval '3 hours', now() - interval '5 minutes', 42, 300, 10, 'Elden Ring', 5, 2, 100, 17);
select pg_temp.check((public.discord_recap()->>'avg')::int = 30 and (public.discord_recap()->>'peak')::int = 42, 'Rückblick: Schnitt und Spitze');
insert into core.tiles (channel_id, id, position, kind, title, description, theme, target_at) values
  ('11111111-0000-0000-0000-000000000001', 'dtest', 1, 'countdown', 'Horror-Nacht', 'Gruselspiele', 'countdown', now() + interval '3 days');
select pg_temp.check(json_array_length(public.discord_announce_data(null)->'ideas') = 1, 'Ankündigung: Idee mit Termin dabei');
select pg_temp.check(json_array_length(public.discord_announce_data('nix')->'ideas') = 0, 'Ankündigung: Filter nach Kachel');
select pg_temp.check(public.discord_idea_claim('dtest', '2030-01-01 18:00+00'), 'Termin: erste automatische Ankündigung');
select pg_temp.check(not public.discord_idea_claim('dtest', '2030-01-01 18:00+00'), 'Termin: gleiche Ankündigung nicht doppelt');
select pg_temp.check(public.discord_idea_claim('dtest', '2030-01-02 18:00+00'), 'Termin verschoben: neue Ankündigung');

-- Kanal B hat keinen Webhook: nichts
select set_config('request.headers', '{"x-channel":"22222222-0000-0000-0000-000000000002"}', true);
select pg_temp.check(public.discord_target('manual') is null, 'ohne Webhook: kein Ziel');

-- ---------- Trennen ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check((public.discord_disconnect()->>'connected')::boolean = false, 'getrennt');
reset role;
select pg_temp.check((select webhook_url is null from core.discord_settings where channel_id = '11111111-0000-0000-0000-000000000001'), 'Adresse gelöscht');

rollback;
