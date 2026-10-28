-- Tests zu Zuschauer-Wette und Rubbellos (…_bet_scratch.sql). Läuft gegen eine Datenbank mit allen
-- Migrationen, ändert nichts dauerhaft (Transaktion mit rollback). Nur lokal/Test:
--   psql -v ON_ERROR_STOP=1 -d <testdatenbank> -f supabase/tests/bet_scratch_test.sql
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
insert into core.tiles (channel_id, id, position, kind, title, description, theme) values
  ('11111111-0000-0000-0000-000000000001', 'bet', 1, 'bet', 'Wette', '', 'bet'),
  ('11111111-0000-0000-0000-000000000001', 'scratch', 2, 'scratch', 'Rubbellos', '', 'scratch');

-- ---------- Wette: Streamer A startet ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select public.bet_start('Schaffe ich den Boss im 1. Versuch?', array['Ja', 'Nein'], 0);
select pg_temp.check((select status from core.bets where channel_id = '11111111-0000-0000-0000-000000000001') = 'open', 'Wette läuft');
select pg_temp.check(pg_temp.fails($q$select public.bet_start('Noch eine?', array['a','b'], 0)$q$), 'zweite Wette, solange eine läuft: abgelehnt');
select pg_temp.check(pg_temp.fails($q$select public.bet_start('Nur eine Antwort', array['a'], 0)$q$), 'nur eine Antwort: abgelehnt');
reset role;

-- Chat (Service-Rolle über die Edge Function): drei tippen „Ja“, einer „Nein“, einer ändert seinen Tipp
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select public.fun_chat('101', 'Anna', '{}', '!tipp ja');
select public.fun_chat('102', 'Ben', '{}', '!tipp 1');
select public.fun_chat('103', 'Cleo', '{}', '!tipp 2');
select public.fun_chat('104', 'Dino', '{}', '!tipp nein');
select public.fun_chat('104', 'Dino', '{}', '!tipp ja');
select pg_temp.check((select counts = array[3, 1] and total = 4 from core.bets where channel_id = '11111111-0000-0000-0000-000000000001'),
                     'Tipps gezählt (Ja 3, Nein 1), geänderter Tipp zählt nur einmal');
select pg_temp.check((public.fun_chat('105', 'Eva', '{}', '!tipp 7')->>'handled')::boolean, '!tipp mit ungültiger Zahl: erledigt, ohne zu zählen');
select pg_temp.check((select total from core.bets where channel_id = '11111111-0000-0000-0000-000000000001') = 4, 'ungültiger Tipp zählt nicht');
select pg_temp.check(public.fun_chat('106', 'Fritz', '{}', '!tipp')->>'reply' like '🎯 Schaffe ich%', '!tipp ohne Zusatz nennt die Wette');

-- Auflösen: „Ja“ – Quote 4 ÷ 3 → aufgerundet 2 Punkte
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select public.bet_lock();
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.fun_chat('107', 'Gina', '{}', '!tipp ja');
select pg_temp.check((select total from core.bets where channel_id = '11111111-0000-0000-0000-000000000001') = 4, 'nach „Tipps schließen“ zählt kein Tipp mehr');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select public.bet_resolve(1);
reset role;
select pg_temp.check((select points from core.bets where channel_id = '11111111-0000-0000-0000-000000000001') = 2, 'Quote: 4 Tipps ÷ 3 richtige → 2 Punkte');
select pg_temp.check((select points from core.bet_scores where player_key = 'tw:101') = 2 and (select points from core.bet_scores where player_key = 'tw:103') = 0,
                     'richtig: 2 Punkte, falsch: 0 Punkte');
select pg_temp.check((select tips from core.bet_scores where player_key = 'tw:103') = 1, 'falscher Tipp zählt als Tipp');
select pg_temp.check(json_array_length(public.bet_top(10)) = 3, 'Rangliste: drei mit Punkten');
select pg_temp.check(public.bet_top(10)::text not like '%tw:%', 'Rangliste ohne Twitch-IDs');
select pg_temp.check(exists (select 1 from core.bot_outbox where channel_id = '11111111-0000-0000-0000-000000000001' and text like '🎯 Auflösung: Ja!%'),
                     'Bot verkündet die Auflösung');

-- ---------- Fremder Streamer kommt nicht an die Wette von A ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check(pg_temp.fails($q$select public.bet_start('Fremd', array['a','b'], 0)$q$), 'B kann in Kanal A keine Wette starten');
select pg_temp.check(pg_temp.fails($q$select public.scratch_save(true, 'all', 0, '[{"label":"x","weight":1}]')$q$), 'B kann das Rubbellos von A nicht ändern');
select pg_temp.check(pg_temp.fails($q$select public.bet_reset_scores()$q$), 'B kann die Rangliste von A nicht löschen');
reset role;

-- ---------- Rubbellos ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select public.scratch_save(true, 'all', 30, '[{"label":"Shoutout","emoji":"📣","weight":1,"win":true},{"label":"<script>","weight":"x"},{"label":"","weight":5}]');
select pg_temp.check(json_array_length(public.scratch_get()->'prizes') = 1, 'ungültige Gewinne fallen raus (Häufigkeit keine Zahl, leerer Text)');
select pg_temp.check(pg_temp.fails($q$select public.scratch_save(true, 'all', 30, '[{"label":"Niete","weight":0}]')$q$), 'alle Häufigkeiten 0: abgelehnt');
select pg_temp.check((public.scratch_test()->>'ok')::boolean, 'Probe-Los aus dem Dashboard');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.check(public.fun_chat('201', 'Hanna', '{}', '!rubbeln')->>'reply' like '🎟️ Hanna rubbelt … 📣 Shoutout%', '!rubbeln zieht ein Los, Bot antwortet');
select pg_temp.check(public.fun_chat('201', 'Hanna', '{}', '!rubbeln')->>'reply' like '@Hanna Dein nächstes Los gibt es in 30 Min.', 'zweites Los in der Pause: Hinweis');
select pg_temp.check(public.fun_chat('201', 'Hanna', '{}', '!rubbeln')->>'reply' is null, 'Hinweis nur einmal je Minute');
select pg_temp.check((select count(*) from core.scratch_draws where channel_id = '11111111-0000-0000-0000-000000000001') = 2, 'zwei Lose (Probe + Hanna)');
-- Nur für Abos: ohne Abzeichen kein Los
update core.scratch set who = 'subs' where channel_id = '11111111-0000-0000-0000-000000000001';
select pg_temp.check((public.scratch_draw('tw:202', 'Ivo', '{}', 'chat')->>'reason') = 'who', 'nur Abos: ohne Abzeichen kein Los');
select pg_temp.check((public.scratch_draw('tw:203', 'Jule', '{subscriber}', 'chat')->>'ok')::boolean, 'nur Abos: mit Abo-Abzeichen');

-- ---------- Gäste ----------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.headers', '{"x-channel":"11111111-0000-0000-0000-000000000001"}', true);
select pg_temp.check((select count(*) from public.scratch_draws) = 3, 'Gast sieht die Lose (Overlay)');
select pg_temp.check(pg_temp.fails($q$select count(*) from core.scratch_last$q$), 'Gast sieht nicht, wer wann gerubbelt hat (Twitch-IDs)');
select pg_temp.check(pg_temp.fails($q$select count(*) from core.bet_votes$q$), 'Gast sieht die einzelnen Tipps nicht');
select pg_temp.check(pg_temp.fails($q$select public.fun_chat('1', 'x', '{}', '!rubbeln')$q$), 'Gast kann fun_chat nicht direkt aufrufen');
select pg_temp.check(pg_temp.fails($q$select public.scratch_draw('tw:1', 'x', '{}', 'chat')$q$), 'Gast kann kein Los ziehen');
select pg_temp.check(json_array_length(public.bet_top(5)) = 3, 'Gast sieht die Rangliste');
reset role;

rollback;
