-- ============================================================
-- Content-Stellwerk
-- Sieben neue Content-Ideen:
--   1) Verbotenes Wort   – ein Wort, das der Streamer nicht sagen darf; Zuschauer melden (!erwischt)
--   2) Subathon-Timer    – Follows, Abos und Bits verlängern den Stream
--   3) Pausen-Bildschirm – „Gleich geht's weiter“ mit Countdown und Zahlenraten (!rate 42)
--   4) Quiz              – Fragen im Overlay, der Chat antwortet mit !a !b !c !d
--   5) Mitspielen        – Warteschlange (!join EpicName), der Streamer zieht das Squad
--   6) Text-to-Speech    – Nachrichten per Kanalpunkte, das Overlay liest sie vor
--   7) Sammelkarten      – Karten-Packs (täglich gratis und per Kanalpunkte), Sammlung, Tauschen
--
-- Gemeinsam:
--   · player_key: wer ist wer? Twitch-Konto („tw:‹id›“), sonst das Konto der Seite („u:‹uuid›“).
--     Wer sich mit Twitch anmeldet, ist auf der Seite und im Chat dieselbe Person.
--   · chat_command(): alle neuen Chat-Befehle (twitch-eventsub ruft sie auf)
--   · bot_outbox: Nachrichten für den Chat-Bot (verschickt die Edge Function stream-tools)
--   · stream_rewards: die Kanalpunkte-Belohnungen für Text-to-Speech und Karten-Packs
-- Braucht 20261012000000_streamer_mods.sql. Mehrfach ausführbar.
-- ============================================================

-- ---------- Kacheln ----------
alter table public.tiles drop constraint if exists tiles_kind_check;
alter table public.tiles add constraint tiles_kind_check
  check (kind in ('wheel', 'countdown', 'prank', 'bingo', 'questions', 'pet', 'shop', 'challenge',
                  'forbidden', 'subathon', 'pause', 'quiz', 'queue', 'tts', 'cards'));

do $$
declare
  t record;
begin
  for t in select * from (values
    ('forbidden', 'Verbotenes Wort', 'Ein Wort, das der Streamer nicht sagen darf. Erwischt? Schreib !erwischt – jeder Versprecher kostet eine Strafe.'),
    ('subathon', 'Subathon', 'Jeder Follow, jedes Abo und jedes Bit verlängert den Stream. Wie lange hältst du ihn wach?'),
    ('pause', 'Kurze Pause', 'Gleich geht''s weiter! Bis dahin: Zahlenraten im Chat mit !rate.'),
    ('quiz', 'Fortnite-Quiz', 'Fragen im Stream, Antwort im Chat mit !a !b !c !d oder hier. Wer ist der größte Fortnite-Nerd?'),
    ('queue', 'Mitspielen', 'Spiel mit dem Streamer! Stell dich mit !join und deinem Epic-Namen an.'),
    ('tts', 'Vorlesen lassen', 'Deine Nachricht, vorgelesen im Stream – mit Roboter-, Oma- oder Monster-Stimme.'),
    ('cards', 'Sammelkarten', 'Jeden Tag ein Gratis-Pack. Sammle alle Karten, tausche Doppelte und werde Nummer 1.')
  ) as v(id, title, description)
  loop
    if not exists (select 1 from public.tiles where id = t.id) then
      update public.tiles set position = position + 1 where kind = 'countdown';
      insert into public.tiles (id, position, kind, title, description, theme) values
        (t.id, (select coalesce(max(position), 1) + 1 from public.tiles where kind <> 'countdown'), t.id, t.title, t.description, t.id);
    end if;
  end loop;
end;
$$;

-- ---------- Wer ist wer? ----------
-- Twitch-Konto bevorzugt: so zählen Chat (!join, !a …) und Seite für dieselbe Person.
create or replace function public.player_key_of(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when p_user is null then null else coalesce(
    (select 'tw:' || provider_id from auth.identities where user_id = p_user and provider = 'twitch' limit 1),
    'u:' || p_user::text) end;
$$;
revoke execute on function public.player_key_of(uuid) from public, anon, authenticated;

create or replace function public.my_player_key()
returns text language sql stable security definer set search_path = '' as $$
  select public.player_key_of(auth.uid());
$$;
revoke execute on function public.my_player_key() from public, anon;
grant execute on function public.my_player_key() to authenticated;

-- Ist die Idee für Zuschauer schon freigeschaltet? (ohne Admin-Ausnahme – für den Chat)
create or replace function public.tile_started(p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select target_at is null or target_at <= now() from public.tiles where kind = p_kind order by position limit 1),
    false);
$$;
revoke execute on function public.tile_started(text) from public, anon, authenticated;

-- Realtime für eine Tabelle einschalten (falls noch nicht)
create or replace function public.realtime_add(p_table text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = p_table
  ) then
    execute format('alter publication supabase_realtime add table public.%I', p_table);
  end if;
end;
$$;
revoke execute on function public.realtime_add(text) from public, anon, authenticated;

-- ---------- Nachrichten für den Chat-Bot ----------
-- Nur die Funktionen hier schreiben hinein (kein eingetippter Text ohne Prüfung);
-- die Edge Function stream-tools verschickt sie (Aktion flush) und twitch-eventsub nach Chat-Befehlen.
create table if not exists public.bot_outbox (
  id bigint generated always as identity primary key,
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.bot_outbox enable row level security;
-- keine Policies: nur die Service-Rolle

create or replace function public.bot_say(p_text text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(btrim(p_text), '') = '' then return; end if;
  insert into public.bot_outbox (text) values (left(p_text, 500));
  delete from public.bot_outbox where created_at < now() - interval '1 day';
end;
$$;
revoke execute on function public.bot_say(text) from public, anon, authenticated;

-- ---------- Kanalpunkte-Belohnungen (Text-to-Speech, Karten-Pack) ----------
create table if not exists public.stream_rewards (
  key text primary key check (key in ('tts', 'cards')),
  reward_id text,
  title text not null check (char_length(title) between 1 and 45),
  cost int not null default 500 check (cost between 1 and 1000000),
  cooldown int not null default 0 check (cooldown between 0 and 604800),
  enabled boolean not null default true,
  synced_at timestamptz,
  error text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.stream_rewards (key, title, cost, cooldown) values
  ('tts', '🔊 Nachricht vorlesen', 500, 30),
  ('cards', '🃏 Sammelkarten-Pack', 1000, 0)
on conflict (key) do nothing;
alter table public.stream_rewards enable row level security;
drop policy if exists "stream_rewards: lesen für admins" on public.stream_rewards;
create policy "stream_rewards: lesen für admins" on public.stream_rewards
  for select to authenticated using ((select public.is_admin()));

create or replace function public.stream_reward_set(p_key text, p_cost int, p_cooldown int, p_enabled boolean)
returns public.stream_rewards language plpgsql security definer set search_path = '' as $$
declare
  result public.stream_rewards;
begin
  if not public.is_admin() then raise exception 'Nur Admins dürfen die Belohnungen einstellen.'; end if;
  update public.stream_rewards set
    cost = least(1000000, greatest(1, coalesce(p_cost, cost))),
    cooldown = least(604800, greatest(0, coalesce(p_cooldown, cooldown))),
    enabled = coalesce(p_enabled, enabled),
    updated_at = now()
  where key = p_key returning * into result;
  if result.key is null then raise exception 'Diese Belohnung gibt es nicht.'; end if;
  return result;
end;
$$;
revoke execute on function public.stream_reward_set(text, int, int, boolean) from public, anon;
grant execute on function public.stream_reward_set(text, int, int, boolean) to authenticated;

-- ============================================================
-- 1) Verbotenes Wort
-- ============================================================
create table if not exists public.forbidden_word (
  id int primary key default 1 check (id = 1),
  words text[] not null default array['Digga', 'Sorry', 'Eigentlich', 'Krass', 'Bruder', 'Safe', 'Alter', 'Genau', 'Ehrlich gesagt', 'Lag'],
  word text not null default '' check (char_length(word) <= 40),
  running boolean not null default false,
  count int not null default 0 check (count between 0 and 9999),
  penalty_each int not null default 10 check (penalty_each between 0 and 1000),
  penalty_what text not null default 'Liegestütze' check (char_length(penalty_what) <= 40),
  report_command text not null default '!erwischt' check (report_command ~ '^![a-zäöüß0-9_]{2,20}$'),
  pending int not null default 0,
  -- Für die Animation im Overlay: {n, type: draw|hit|undo|report|stop, by, at}
  last_event jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.forbidden_word (id) values (1) on conflict (id) do nothing;
alter table public.forbidden_word enable row level security;
drop policy if exists "forbidden_word: lesen für alle" on public.forbidden_word;
create policy "forbidden_word: lesen für alle" on public.forbidden_word for select to anon, authenticated using (true);
grant select on public.forbidden_word to anon;

-- Meldungen: mehrere Zuschauer innerhalb einer Minute = eine Meldung
create table if not exists public.forbidden_reports (
  id bigint generated always as identity primary key,
  reporters text[] not null default '{}',
  reporter_keys text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.forbidden_reports enable row level security;
drop policy if exists "forbidden_reports: lesen für admins" on public.forbidden_reports;
create policy "forbidden_reports: lesen für admins" on public.forbidden_reports
  for select to authenticated using ((select public.is_admin()));

create or replace function public.forbidden_event(p_type text, p_by text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'n', coalesce((select (last_event ->> 'n')::int from public.forbidden_word where id = 1), 0) + 1,
    'type', p_type, 'by', coalesce(p_by, ''), 'at', now());
$$;
revoke execute on function public.forbidden_event(text, text) from public, anon, authenticated;

create or replace function public.forbidden_recount()
returns void language sql security definer set search_path = '' as $$
  update public.forbidden_word set pending = (select count(*) from public.forbidden_reports where status = 'pending') where id = 1;
$$;
revoke execute on function public.forbidden_recount() from public, anon, authenticated;

-- Eine Meldung (Chat oder Seite). Pro Person höchstens alle 30 Sekunden.
create or replace function public.forbidden_report(p_key text, p_name text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  f public.forbidden_word;
  open_id bigint;
begin
  select * into f from public.forbidden_word where id = 1 for update;
  if not f.running or not public.tile_started('forbidden') or p_key is null then return null; end if;
  if exists (select 1 from public.forbidden_reports where p_key = any(reporter_keys) and created_at > now() - interval '30 seconds') then
    return null;
  end if;
  select id into open_id from public.forbidden_reports
    where status = 'pending' and created_at > now() - interval '60 seconds' order by id desc limit 1;
  if open_id is null then
    insert into public.forbidden_reports (reporters, reporter_keys) values (array[left(p_name, 40)], array[p_key]);
  else
    update public.forbidden_reports set
      reporters = (reporters || left(p_name, 40))[1:50],
      reporter_keys = (reporter_keys || p_key)[1:50],
      updated_at = now()
    where id = open_id and not (p_key = any(reporter_keys));
  end if;
  perform public.forbidden_recount();
  update public.forbidden_word set last_event = public.forbidden_event('report', p_name), updated_at = now() where id = 1;
  delete from public.forbidden_reports where created_at < now() - interval '7 days';
  return json_build_object('ok', true);
end;
$$;
revoke execute on function public.forbidden_report(text, text) from public, anon, authenticated;

create or replace function public.forbidden_report_web()
returns json language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Bitte anmelden.'; end if;
  if not (select running from public.forbidden_word where id = 1) then
    raise exception 'Gerade läuft kein verbotenes Wort.';
  end if;
  return coalesce(public.forbidden_report(public.my_player_key(), public.my_name()), json_build_object('ok', false));
end;
$$;
revoke execute on function public.forbidden_report_web() from public, anon;
grant execute on function public.forbidden_report_web() to authenticated;

create or replace function public.forbidden_draw(p_word text default null)
returns public.forbidden_word language plpgsql security definer set search_path = '' as $$
declare
  f public.forbidden_word;
  pick text := left(btrim(coalesce(p_word, '')), 40);
  result public.forbidden_word;
begin
  if not public.is_admin() then raise exception 'Nur Admins ziehen das verbotene Wort.'; end if;
  select * into f from public.forbidden_word where id = 1 for update;
  if pick = '' then
    select w into pick from unnest(f.words) w where btrim(w) <> '' and w <> f.word order by random() limit 1;
    pick := coalesce(pick, f.words[1], 'Digga');
  end if;
  update public.forbidden_reports set status = 'rejected', updated_at = now() where status = 'pending';
  update public.forbidden_word set
    word = pick, running = true, count = 0, pending = 0,
    last_event = public.forbidden_event('draw', public.my_name()), updated_at = now()
  where id = 1 returning * into result;
  return result;
end;
$$;

create or replace function public.forbidden_save(p_words text[], p_each int, p_what text, p_command text)
returns public.forbidden_word language plpgsql security definer set search_path = '' as $$
declare
  cleaned text[];
  cmd text := lower(btrim(coalesce(p_command, '')));
  result public.forbidden_word;
begin
  if not public.is_admin() then raise exception 'Nur Admins dürfen das ändern.'; end if;
  select coalesce(array_agg(distinct w), '{}') into cleaned
    from (select left(btrim(x), 40) w from unnest(coalesce(p_words, '{}')) x) s where w <> '';
  if cardinality(cleaned) = 0 then raise exception 'Mindestens ein Wort eintragen.'; end if;
  if cardinality(cleaned) > 200 then raise exception 'Höchstens 200 Wörter.'; end if;
  if cmd !~ '^!' then cmd := '!' || cmd; end if;
  if cmd !~ '^![a-zäöüß0-9_]{2,20}$' then raise exception 'Der Befehl darf nur Buchstaben und Zahlen haben, z. B. !erwischt.'; end if;
  update public.forbidden_word set
    words = cleaned,
    penalty_each = least(1000, greatest(0, coalesce(p_each, penalty_each))),
    penalty_what = left(btrim(coalesce(p_what, penalty_what)), 40),
    report_command = cmd,
    updated_at = now()
  where id = 1 returning * into result;
  return result;
end;
$$;

-- Meldung bestätigen (+1) oder verwerfen
create or replace function public.forbidden_judge(p_report bigint, p_ok boolean)
returns public.forbidden_word language plpgsql security definer set search_path = '' as $$
declare
  r public.forbidden_reports;
  result public.forbidden_word;
begin
  if not public.is_admin() then raise exception 'Meldungen prüfen nur der Streamer und die Mods.'; end if;
  update public.forbidden_reports set status = case when p_ok then 'confirmed' else 'rejected' end, updated_at = now()
    where id = p_report and status = 'pending' returning * into r;
  if r.id is null then raise exception 'Diese Meldung ist schon erledigt.'; end if;
  perform public.forbidden_recount();
  update public.forbidden_word set
    count = case when p_ok then least(9999, count + 1) else count end,
    last_event = case when p_ok then public.forbidden_event('hit', array_to_string(r.reporters[1:3], ', ')) else last_event end,
    updated_at = now()
  where id = 1 returning * into result;
  return result;
end;
$$;

-- Von Hand zählen (+1 / −1), z. B. wenn der Streamer sich selbst erwischt
create or replace function public.forbidden_add(p_delta int)
returns public.forbidden_word language plpgsql security definer set search_path = '' as $$
declare
  result public.forbidden_word;
begin
  if not public.is_admin() then raise exception 'Nur der Streamer und die Mods zählen.'; end if;
  update public.forbidden_word set
    count = least(9999, greatest(0, count + coalesce(p_delta, 0))),
    last_event = public.forbidden_event(case when coalesce(p_delta, 0) > 0 then 'hit' else 'undo' end, public.my_name()),
    updated_at = now()
  where id = 1 returning * into result;
  return result;
end;
$$;

create or replace function public.forbidden_stop()
returns public.forbidden_word language plpgsql security definer set search_path = '' as $$
declare
  result public.forbidden_word;
begin
  if not public.is_admin() then raise exception 'Nur Admins dürfen das beenden.'; end if;
  update public.forbidden_reports set status = 'rejected', updated_at = now() where status = 'pending';
  update public.forbidden_word set running = false, pending = 0,
    last_event = public.forbidden_event('stop', public.my_name()), updated_at = now()
  where id = 1 returning * into result;
  return result;
end;
$$;

revoke execute on function public.forbidden_draw(text) from public, anon;
revoke execute on function public.forbidden_save(text[], int, text, text) from public, anon;
revoke execute on function public.forbidden_judge(bigint, boolean) from public, anon;
revoke execute on function public.forbidden_add(int) from public, anon;
revoke execute on function public.forbidden_stop() from public, anon;
grant execute on function public.forbidden_draw(text) to authenticated;
grant execute on function public.forbidden_save(text[], int, text, text) to authenticated;
grant execute on function public.forbidden_judge(bigint, boolean) to authenticated;
grant execute on function public.forbidden_add(int) to authenticated;
grant execute on function public.forbidden_stop() to authenticated;
do $$ begin perform public.realtime_add('forbidden_word'); end $$;
do $$ begin perform public.realtime_add('forbidden_reports'); end $$;

-- ============================================================
-- 2) Subathon-Timer
-- ============================================================
create table if not exists public.subathon (
  id int primary key default 1 check (id = 1),
  status text not null default 'ready' check (status in ('ready', 'running', 'paused', 'ended')),
  ends_at timestamptz,                         -- solange er läuft
  remaining int not null default 7200 check (remaining >= 0), -- Sekunden, solange er steht
  start_minutes int not null default 120 check (start_minutes between 1 and 10080),
  sec_follow int not null default 30 check (sec_follow between 0 and 86400),
  sec_sub int not null default 300 check (sec_sub between 0 and 86400),     -- pro Abo (Stufe 2 ×2, Stufe 3 ×5)
  sec_bits int not null default 60 check (sec_bits between 0 and 86400),    -- pro 100 Bits
  cap_hours int not null default 0 check (cap_hours between 0 and 720),    -- 0 = ohne Grenze
  started_at timestamptz,
  added int not null default 0,
  -- Für die Animation im Overlay: {n, seconds, who, kind, at}
  last_event jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.subathon (id) values (1) on conflict (id) do nothing;
alter table public.subathon enable row level security;
drop policy if exists "subathon: lesen für alle" on public.subathon;
create policy "subathon: lesen für alle" on public.subathon for select to anon, authenticated using (true);
grant select on public.subathon to anon;

create table if not exists public.subathon_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('follow', 'sub', 'resub', 'gift', 'bits', 'manual')),
  who text not null default '',
  seconds int not null,
  created_at timestamptz not null default now()
);
alter table public.subathon_log enable row level security;
drop policy if exists "subathon_log: lesen für alle" on public.subathon_log;
create policy "subathon_log: lesen für alle" on public.subathon_log for select to anon, authenticated using (true);
grant select on public.subathon_log to anon;

-- Restzeit in Sekunden (läuft: bis ends_at)
create or replace function public.subathon_left(s public.subathon)
returns int language sql stable set search_path = '' as $$
  select case when s.status = 'running' then greatest(0, ceil(extract(epoch from s.ends_at - now()))::int)
              when s.status = 'ended' then 0 else s.remaining end;
$$;

-- Zeit gutschreiben (Alerts, Admins). Ist die Zeit abgelaufen, ist der Subathon vorbei.
create or replace function public.subathon_credit(p_kind text, p_who text, p_seconds int)
returns public.subathon language plpgsql security definer set search_path = '' as $$
declare
  s public.subathon;
  cap timestamptz;
  next_end timestamptz;
  applied int;
  result public.subathon;
begin
  select * into s from public.subathon where id = 1 for update;
  if s.status = 'running' and s.ends_at <= now() then
    update public.subathon set status = 'ended', remaining = 0, updated_at = now() where id = 1 returning * into result;
    return result;
  end if;
  if s.status not in ('running', 'paused') or coalesce(p_seconds, 0) = 0 then return s; end if;
  if s.status = 'running' then
    next_end := s.ends_at + make_interval(secs => p_seconds);
    if s.cap_hours > 0 then
      cap := s.started_at + make_interval(hours => s.cap_hours);
      next_end := least(next_end, greatest(cap, s.ends_at));
    end if;
    next_end := greatest(next_end, now());
    applied := round(extract(epoch from next_end - s.ends_at))::int;
    update public.subathon set ends_at = next_end, added = added + applied,
      last_event = jsonb_build_object('n', coalesce((last_event ->> 'n')::int, 0) + 1, 'seconds', applied, 'who', left(coalesce(p_who, ''), 60), 'kind', p_kind, 'at', now()),
      updated_at = now()
    where id = 1 returning * into result;
  else
    applied := greatest(-s.remaining, p_seconds);
    update public.subathon set remaining = remaining + applied, added = added + applied,
      last_event = jsonb_build_object('n', coalesce((last_event ->> 'n')::int, 0) + 1, 'seconds', applied, 'who', left(coalesce(p_who, ''), 60), 'kind', p_kind, 'at', now()),
      updated_at = now()
    where id = 1 returning * into result;
  end if;
  if applied <> 0 then
    insert into public.subathon_log (kind, who, seconds) values (p_kind, left(coalesce(p_who, ''), 60), applied);
  end if;
  return result;
end;
$$;
revoke execute on function public.subathon_credit(text, text, int) from public, anon, authenticated;

-- Neue Alerts (Follows, Abos, Bits) → Zeit dazu. Test-Alerts zählen nicht.
create or replace function public.subathon_on_alert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  s public.subathon;
  tier_factor int := case new.tier when '2000' then 2 when '3000' then 5 else 1 end;
  secs int;
begin
  if new.test then return new; end if;
  select * into s from public.subathon where id = 1;
  if s.status not in ('running', 'paused') then return new; end if;
  secs := case new.kind
    when 'follow' then s.sec_follow
    when 'sub' then s.sec_sub * tier_factor
    when 'resub' then s.sec_sub * tier_factor
    when 'gift' then s.sec_sub * tier_factor * greatest(1, new.amount)
    when 'bits' then (s.sec_bits * new.amount) / 100
    else 0 end;
  if secs > 0 then perform public.subathon_credit(new.kind, new.user_name, secs); end if;
  return new;
end;
$$;
drop trigger if exists stream_alerts_subathon on public.stream_alerts;
create trigger stream_alerts_subathon after insert on public.stream_alerts
  for each row execute function public.subathon_on_alert();

create or replace function public.subathon_control(p_action text, p_value int default null)
returns public.subathon language plpgsql security definer set search_path = '' as $$
declare
  s public.subathon;
  result public.subathon;
begin
  if not public.is_admin() then raise exception 'Den Subathon steuern nur der Streamer und die Mods.'; end if;
  select * into s from public.subathon where id = 1 for update;
  if s.status = 'running' and s.ends_at <= now() then
    s.status := 'ended';
    update public.subathon set status = 'ended', remaining = 0 where id = 1;
  end if;
  if p_action = 'start' then
    if s.status in ('running', 'paused') then raise exception 'Der Subathon läuft schon.'; end if;
    delete from public.subathon_log;
    update public.subathon set status = 'running',
      start_minutes = least(10080, greatest(1, coalesce(p_value, start_minutes))),
      ends_at = now() + make_interval(mins => least(10080, greatest(1, coalesce(p_value, start_minutes)))),
      started_at = now(), added = 0, remaining = 0,
      last_event = jsonb_build_object('n', coalesce((last_event ->> 'n')::int, 0) + 1, 'kind', 'start', 'seconds', 0, 'who', public.my_name(), 'at', now()),
      updated_at = now()
    where id = 1 returning * into result;
  elsif p_action = 'pause' then
    if s.status <> 'running' then raise exception 'Der Subathon läuft gerade nicht.'; end if;
    update public.subathon set status = 'paused', remaining = public.subathon_left(s), ends_at = null, updated_at = now()
      where id = 1 returning * into result;
  elsif p_action = 'resume' then
    if s.status <> 'paused' then raise exception 'Der Subathon ist nicht pausiert.'; end if;
    update public.subathon set status = 'running', ends_at = now() + make_interval(secs => remaining), remaining = 0, updated_at = now()
      where id = 1 returning * into result;
  elsif p_action = 'add' then
    if s.status not in ('running', 'paused') then raise exception 'Erst den Subathon starten.'; end if;
    if coalesce(p_value, 0) = 0 or abs(p_value) > 86400 then raise exception 'Zwischen 1 Sekunde und 24 Stunden.'; end if;
    result := public.subathon_credit('manual', public.my_name(), p_value);
  elsif p_action = 'end' then
    update public.subathon set status = 'ended', remaining = 0, ends_at = null, updated_at = now()
      where id = 1 returning * into result;
  elsif p_action = 'reset' then
    delete from public.subathon_log;
    update public.subathon set status = 'ready', remaining = start_minutes * 60, ends_at = null, started_at = null, added = 0,
      updated_at = now()
    where id = 1 returning * into result;
  else
    raise exception 'Unbekannte Aktion.';
  end if;
  return result;
end;
$$;

create or replace function public.subathon_save(p_start int, p_follow int, p_sub int, p_bits int, p_cap int)
returns public.subathon language plpgsql security definer set search_path = '' as $$
declare
  result public.subathon;
begin
  if not public.is_admin() then raise exception 'Nur Admins dürfen das ändern.'; end if;
  update public.subathon set
    start_minutes = least(10080, greatest(1, coalesce(p_start, start_minutes))),
    remaining = case when status = 'ready' then least(10080, greatest(1, coalesce(p_start, start_minutes))) * 60 else remaining end,
    sec_follow = least(86400, greatest(0, coalesce(p_follow, sec_follow))),
    sec_sub = least(86400, greatest(0, coalesce(p_sub, sec_sub))),
    sec_bits = least(86400, greatest(0, coalesce(p_bits, sec_bits))),
    cap_hours = least(720, greatest(0, coalesce(p_cap, cap_hours))),
    updated_at = now()
  where id = 1 returning * into result;
  return result;
end;
$$;
revoke execute on function public.subathon_control(text, int) from public, anon;
revoke execute on function public.subathon_save(int, int, int, int, int) from public, anon;
grant execute on function public.subathon_control(text, int) to authenticated;
grant execute on function public.subathon_save(int, int, int, int, int) to authenticated;
do $$ begin perform public.realtime_add('subathon'); end $$;

-- ============================================================
-- 3) Pausen-Bildschirm mit Zahlenraten
-- ============================================================
create table if not exists public.pause_screen (
  id int primary key default 1 check (id = 1),
  active boolean not null default false,
  title text not null default 'Gleich geht''s weiter!' check (char_length(title) between 1 and 60),
  message text not null default '' check (char_length(message) <= 140),
  ends_at timestamptz,
  started_at timestamptz,
  game_on boolean not null default true,
  guess_command text not null default '!rate' check (guess_command ~ '^![a-zäöüß0-9_]{2,20}$'),
  game_max int not null default 100 check (game_max between 10 and 10000),
  game_round int not null default 1,
  game_low int not null default 1,
  game_high int not null default 100,
  game_guesses int not null default 0,
  -- Letzter Tipp: {n, who, guess, hint: higher|lower|hit, at}
  game_last jsonb not null default '{}'::jsonb,
  -- Die letzten Gewinner: [{who, round, guesses, number, at}]
  game_winners jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.pause_screen (id) values (1) on conflict (id) do nothing;
alter table public.pause_screen enable row level security;
drop policy if exists "pause_screen: lesen für alle" on public.pause_screen;
create policy "pause_screen: lesen für alle" on public.pause_screen for select to anon, authenticated using (true);
grant select on public.pause_screen to anon;

-- Die gesuchte Zahl – liest niemand außer den Funktionen
create table if not exists public.pause_secret (
  id int primary key default 1 check (id = 1),
  number int not null
);
alter table public.pause_secret enable row level security;
insert into public.pause_secret (id, number) values (1, 1 + floor(random() * 100)::int) on conflict (id) do nothing;

create table if not exists public.pause_cooldowns (
  player_key text primary key,
  last_at timestamptz not null default now()
);
alter table public.pause_cooldowns enable row level security;

create or replace function public.pause_new_round(p_max int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.pause_secret set number = 1 + floor(random() * p_max)::int where id = 1;
  update public.pause_screen set game_low = 1, game_high = p_max, game_guesses = 0 where id = 1;
end;
$$;
revoke execute on function public.pause_new_round(int) from public, anon, authenticated;

-- Ein Tipp (Chat: !rate 42, oder die Seite). Pro Person höchstens alle 3 Sekunden.
create or replace function public.pause_guess(p_key text, p_name text, p_guess text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  p public.pause_screen;
  secret int;
  g int;
  hint text;
begin
  if coalesce(btrim(p_guess), '') !~ '^\d{1,5}$' or p_key is null then return null; end if;
  g := btrim(p_guess)::int;
  select * into p from public.pause_screen where id = 1 for update;
  if not p.active or not p.game_on or g < 1 or g > p.game_max then return null; end if;
  if exists (select 1 from public.pause_cooldowns where player_key = p_key and last_at > now() - interval '3 seconds') then
    return null;
  end if;
  insert into public.pause_cooldowns (player_key, last_at) values (p_key, now())
    on conflict (player_key) do update set last_at = now();
  select number into secret from public.pause_secret where id = 1;
  hint := case when g = secret then 'hit' when g < secret then 'higher' else 'lower' end;
  update public.pause_screen set
    game_guesses = game_guesses + 1,
    game_low = case when hint = 'higher' then greatest(game_low, g + 1) else game_low end,
    game_high = case when hint = 'lower' then least(game_high, g - 1) else game_high end,
    game_last = jsonb_build_object('n', coalesce((game_last ->> 'n')::int, 0) + 1, 'who', left(p_name, 40), 'guess', g, 'hint', hint, 'at', now()),
    game_winners = case when hint = 'hit'
      then (jsonb_build_array(jsonb_build_object('who', left(p_name, 40), 'round', game_round, 'guesses', game_guesses + 1, 'number', secret, 'at', now())) || game_winners) - 5
      else game_winners end,
    game_round = case when hint = 'hit' then game_round + 1 else game_round end,
    updated_at = now()
  where id = 1;
  if hint = 'hit' then
    perform public.pause_new_round(p.game_max);
    perform public.bot_say(format('🎉 %s hat die Zahl %s erraten! Neue Runde: Zahl zwischen 1 und %s – %s ZAHL', left(p_name, 40), secret, p.game_max, p.guess_command));
  end if;
  delete from public.pause_cooldowns where last_at < now() - interval '1 hour';
  return json_build_object('hint', hint, 'guess', g);
end;
$$;
revoke execute on function public.pause_guess(text, text, text) from public, anon, authenticated;

create or replace function public.pause_guess_web(p_guess int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  res json;
begin
  if auth.uid() is null then raise exception 'Bitte anmelden.'; end if;
  if not coalesce((select active and game_on from public.pause_screen where id = 1), false) then
    raise exception 'Gerade läuft keine Pause mit Zahlenraten.';
  end if;
  res := public.pause_guess(public.my_player_key(), public.my_name(), p_guess::text);
  if res is null then raise exception 'Kurz warten – höchstens ein Tipp alle 3 Sekunden.'; end if;
  return res;
end;
$$;
revoke execute on function public.pause_guess_web(int) from public, anon;
grant execute on function public.pause_guess_web(int) to authenticated;

create or replace function public.pause_start(p_minutes int, p_title text, p_message text, p_game boolean)
returns public.pause_screen language plpgsql security definer set search_path = '' as $$
declare
  p public.pause_screen;
  result public.pause_screen;
begin
  if not public.is_admin() then raise exception 'Die Pause starten nur der Streamer und die Mods.'; end if;
  select * into p from public.pause_screen where id = 1 for update;
  if not p.active then perform public.pause_new_round(p.game_max); end if;
  update public.pause_screen set
    active = true,
    started_at = case when active then started_at else now() end,
    ends_at = case when coalesce(p_minutes, 0) > 0 then now() + make_interval(mins => least(600, p_minutes)) else null end,
    title = coalesce(nullif(left(btrim(coalesce(p_title, '')), 60), ''), title),
    message = left(btrim(coalesce(p_message, message)), 140),
    game_on = coalesce(p_game, game_on),
    updated_at = now()
  where id = 1 returning * into result;
  if not p.active and result.game_on then
    perform public.bot_say(format('☕ Kurze Pause! Errate die Zahl zwischen 1 und %s: %s ZAHL', result.game_max, result.guess_command));
  end if;
  return result;
end;
$$;

create or replace function public.pause_stop()
returns public.pause_screen language plpgsql security definer set search_path = '' as $$
declare
  result public.pause_screen;
begin
  if not public.is_admin() then raise exception 'Die Pause beenden nur der Streamer und die Mods.'; end if;
  update public.pause_screen set active = false, ends_at = null, updated_at = now() where id = 1 returning * into result;
  return result;
end;
$$;

create or replace function public.pause_settings(p_max int, p_command text)
returns public.pause_screen language plpgsql security definer set search_path = '' as $$
declare
  cmd text := lower(btrim(coalesce(p_command, '')));
  result public.pause_screen;
begin
  if not public.is_admin() then raise exception 'Nur Admins dürfen das ändern.'; end if;
  if cmd !~ '^!' then cmd := '!' || cmd; end if;
  if cmd !~ '^![a-zäöüß0-9_]{2,20}$' then raise exception 'Der Befehl darf nur Buchstaben und Zahlen haben, z. B. !rate.'; end if;
  update public.pause_screen set
    game_max = least(10000, greatest(10, coalesce(p_max, game_max))),
    guess_command = cmd,
    updated_at = now()
  where id = 1 returning * into result;
  if result.game_high > result.game_max or result.game_guesses = 0 then perform public.pause_new_round(result.game_max); end if;
  select * into result from public.pause_screen where id = 1;
  return result;
end;
$$;
revoke execute on function public.pause_start(int, text, text, boolean) from public, anon;
revoke execute on function public.pause_stop() from public, anon;
revoke execute on function public.pause_settings(int, text) from public, anon;
grant execute on function public.pause_start(int, text, text, boolean) to authenticated;
grant execute on function public.pause_stop() to authenticated;
grant execute on function public.pause_settings(int, text) to authenticated;
do $$ begin perform public.realtime_add('pause_screen'); end $$;

-- ============================================================
-- 4) Quiz
-- ============================================================
create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(btrim(question)) between 3 and 200),
  answers text[] not null check (cardinality(answers) between 2 and 4),
  correct int not null check (correct between 0 and 3),
  category text not null default 'Fortnite' check (char_length(category) between 1 and 30),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (correct < cardinality(answers))
);
alter table public.quiz_questions enable row level security;
drop policy if exists "quiz_questions: lesen für admins" on public.quiz_questions;
create policy "quiz_questions: lesen für admins" on public.quiz_questions
  for select to authenticated using ((select public.is_admin()));

-- Die laufende Frage – lesbar für alle (auch OBS). Die richtige Antwort steht erst nach dem Auflösen drin.
create table if not exists public.quiz_round (
  id int primary key default 1 check (id = 1),
  n int not null default 0,
  status text not null default 'idle' check (status in ('idle', 'open', 'revealed')),
  question_id uuid,
  question text not null default '',
  answers text[] not null default '{}',
  category text not null default '',
  correct int,
  opened_at timestamptz,
  closes_at timestamptz,
  counts int[] not null default '{0,0,0,0}',
  answered int not null default 0,
  winners jsonb not null default '[]'::jsonb,   -- die schnellsten Richtigen: [{name, points}]
  seconds int not null default 30 check (seconds between 10 and 300),
  updated_at timestamptz not null default now()
);
insert into public.quiz_round (id) values (1) on conflict (id) do nothing;
alter table public.quiz_round enable row level security;
drop policy if exists "quiz_round: lesen für alle" on public.quiz_round;
create policy "quiz_round: lesen für alle" on public.quiz_round for select to anon, authenticated using (true);
grant select on public.quiz_round to anon;

create table if not exists public.quiz_secret (
  id int primary key default 1 check (id = 1),
  correct int
);
alter table public.quiz_secret enable row level security;
insert into public.quiz_secret (id) values (1) on conflict (id) do nothing;

create table if not exists public.quiz_answers (
  round_n int not null,
  player_key text not null,
  name text not null default '',
  choice int not null check (choice between 0 and 3),
  created_at timestamptz not null default now(),
  primary key (round_n, player_key)
);
alter table public.quiz_answers enable row level security;

-- Rangliste (Namen und Punkte sind öffentlich – auch fürs Overlay)
create table if not exists public.quiz_scores (
  player_key text primary key,
  name text not null default '',
  points int not null default 0,
  correct int not null default 0,
  answered int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.quiz_scores enable row level security;
drop policy if exists "quiz_scores: lesen für alle" on public.quiz_scores;
create policy "quiz_scores: lesen für alle" on public.quiz_scores for select to anon, authenticated using (true);
grant select on public.quiz_scores to anon;

-- Startfragen (nur, wenn es noch keine gibt)
insert into public.quiz_questions (question, answers, correct)
select q, a, c from (values
  ('Wie viele Spieler starten in einem normalen Battle-Royale-Match?', array['50', '100', '150', '64'], 1),
  ('Wie heißt das Fahrzeug, aus dem alle zu Beginn abspringen?', array['Kampfbus', 'Sturmzug', 'Loot-Laster', 'Party-Zeppelin'], 0),
  ('Welche Farbe hat die Seltenheit „Episch“?', array['Blau', 'Lila', 'Gold', 'Grün'], 1),
  ('Welche Farbe hat die Seltenheit „Legendär“?', array['Gold', 'Lila', 'Blau', 'Grau'], 0),
  ('Welche Farbe hat die Seltenheit „Ungewöhnlich“?', array['Grün', 'Blau', 'Grau', 'Lila'], 0),
  ('Wie viel Schild gibt ein kleiner Schildtrank?', array['10', '25', '50', '75'], 1),
  ('Bis wie viel Schild helfen kleine Schildtränke höchstens?', array['25', '50', '75', '100'], 1),
  ('Wie viel Schild gibt ein großer Schildtrank?', array['25', '50', '75', '100'], 1),
  ('Wie viele Lebenspunkte hat man ohne Schild höchstens?', array['100', '150', '200', '250'], 0),
  ('Was füllt Leben UND Schild komplett auf?', array['Medikit', 'Pott', 'Bandage', 'Kleiner Schildtrank'], 1),
  ('Aus welchen drei Materialien baut man?', array['Holz, Stein, Metall', 'Holz, Glas, Metall', 'Stein, Eis, Holz', 'Metall, Beton, Holz'], 0),
  ('Welches Baumaterial hält am wenigsten aus?', array['Holz', 'Stein', 'Metall', 'Alle gleich viel'], 0),
  ('Wie heißt der Modus ganz ohne Bauen?', array['Null Bauen', 'Kreativ', 'Rette die Welt', 'Team-Rumble'], 0),
  ('Welche Firma entwickelt Fortnite?', array['Epic Games', 'Riot Games', 'Activision', 'Ubisoft'], 0),
  ('In welchem Jahr erschien Fortnite Battle Royale?', array['2015', '2016', '2017', '2019'], 2),
  ('Wie heißt die Währung im Item-Shop?', array['V-Bucks', 'Robux', 'Coins', 'Gems'], 0),
  ('Was passiert, wenn man im Sturm steht?', array['Man verliert Leben', 'Man wird schneller', 'Man bekommt Schild', 'Nichts'], 0),
  ('Wie heißt der bekannte Bananen-Skin?', array['Peely', 'Fishstick', 'Jonesy', 'Midas'], 0),
  ('Welcher Ort war schon in Kapitel 1 auf der Karte?', array['Tilted Towers', 'Mega City', 'Brutal Boxcars', 'Lavish Lair'], 0),
  ('Was bekommt man, wenn man als Letzter übrig bleibt?', array['Victory Royale', 'Battle Pass', 'Supply Drop', 'Level-Up'], 0),
  ('Wie viele Spieler hat ein Squad höchstens?', array['2', '3', '4', '5'], 2),
  ('Womit gleitet man nach dem Absprung zu Boden?', array['Gleiter', 'Fallschirm-Rucksack', 'Jetpack', 'Drachen'], 0),
  ('Was macht ein Lagerfeuer?', array['Heilt Spieler in der Nähe', 'Gibt Schild', 'Macht unsichtbar', 'Lädt Munition nach'], 0),
  ('Was bedeutet „Third-Party“?', array['Ein drittes Team mischt sich in einen Kampf ein', 'Ein Spiel zu dritt', 'Ein neuer Skin', 'Die dritte Zone'], 0)
) as v(q, a, c)
where not exists (select 1 from public.quiz_questions);

create or replace function public.quiz_question_save(p_id uuid, p_question text, p_answers text[], p_correct int, p_category text)
returns public.quiz_questions language plpgsql security definer set search_path = '' as $$
declare
  cleaned text[];
  result public.quiz_questions;
begin
  if not public.is_admin() then raise exception 'Nur Admins dürfen Fragen anlegen.'; end if;
  select coalesce(array_agg(left(btrim(a), 80) order by n), '{}') into cleaned
    from unnest(coalesce(p_answers, '{}')) with ordinality as t(a, n) where btrim(a) <> '';
  if cardinality(cleaned) < 2 or cardinality(cleaned) > 4 then raise exception 'Eine Frage braucht 2 bis 4 Antworten.'; end if;
  if p_correct is null or p_correct < 0 or p_correct >= cardinality(cleaned) then raise exception 'Bitte die richtige Antwort wählen.'; end if;
  if char_length(btrim(coalesce(p_question, ''))) < 3 then raise exception 'Die Frage ist zu kurz.'; end if;
  if p_id is null then
    insert into public.quiz_questions (question, answers, correct, category)
      values (left(btrim(p_question), 200), cleaned, p_correct, coalesce(nullif(left(btrim(coalesce(p_category, '')), 30), ''), 'Fortnite'))
      returning * into result;
  else
    update public.quiz_questions set question = left(btrim(p_question), 200), answers = cleaned, correct = p_correct,
      category = coalesce(nullif(left(btrim(coalesce(p_category, '')), 30), ''), category)
    where id = p_id returning * into result;
    if result.id is null then raise exception 'Diese Frage gibt es nicht mehr.'; end if;
  end if;
  return result;
end;
$$;

create or replace function public.quiz_question_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Nur Admins dürfen Fragen löschen.'; end if;
  delete from public.quiz_questions where id = p_id;
end;
$$;

-- Frage stellen: bestimmte oder die am längsten nicht gestellte
create or replace function public.quiz_start(p_question uuid default null, p_seconds int default 30)
returns public.quiz_round language plpgsql security definer set search_path = '' as $$
declare
  q public.quiz_questions;
  secs int := least(300, greatest(10, coalesce(p_seconds, 30)));
  letters text[] := array['A', 'B', 'C', 'D'];
  list text;
  result public.quiz_round;
begin
  if not public.is_admin() then raise exception 'Quizfragen stellen nur der Streamer und die Mods.'; end if;
  if p_question is null then
    select * into q from public.quiz_questions order by used_at nulls first, random() limit 1;
  else
    select * into q from public.quiz_questions where id = p_question;
  end if;
  if q.id is null then raise exception 'Es gibt noch keine Quizfragen.'; end if;
  update public.quiz_questions set used_at = now() where id = q.id;
  update public.quiz_secret set correct = q.correct where id = 1;
  update public.quiz_round set
    n = n + 1, status = 'open', question_id = q.id, question = q.question, answers = q.answers, category = q.category,
    correct = null, opened_at = now(), closes_at = now() + make_interval(secs => secs), seconds = secs,
    counts = array_fill(0, array[cardinality(q.answers)]), answered = 0, winners = '[]'::jsonb, updated_at = now()
  where id = 1 returning * into result;
  delete from public.quiz_answers where round_n < result.n - 5;
  select string_agg(format('%s) %s', letters[i], q.answers[i]), ' · ') into list from generate_series(1, cardinality(q.answers)) i;
  perform public.bot_say(format('🧠 Quiz: %s – %s – antworte mit %s (%s s)', q.question, list,
    array_to_string((select array_agg('!' || lower(letters[i])) from generate_series(1, cardinality(q.answers)) i), ' '), secs));
  return result;
end;
$$;

-- Eine Antwort (Chat: !a … !d, oder die Seite). Es zählt die erste.
create or replace function public.quiz_answer(p_key text, p_name text, p_choice int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r public.quiz_round;
  inserted int;
begin
  select * into r from public.quiz_round where id = 1;
  if r.status <> 'open' or now() >= r.closes_at or p_key is null
     or p_choice is null or p_choice < 0 or p_choice >= cardinality(r.answers) or not public.tile_started('quiz') then
    return null;
  end if;
  insert into public.quiz_answers (round_n, player_key, name, choice) values (r.n, p_key, left(p_name, 40), p_choice)
    on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return json_build_object('ok', false, 'already', true); end if;
  update public.quiz_round set counts[p_choice + 1] = counts[p_choice + 1] + 1, answered = answered + 1, updated_at = now()
    where id = 1 and n = r.n;
  return json_build_object('ok', true);
end;
$$;
revoke execute on function public.quiz_answer(text, text, int) from public, anon, authenticated;

create or replace function public.quiz_answer_web(p_choice int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r public.quiz_round;
  res json;
begin
  if auth.uid() is null then raise exception 'Bitte anmelden.'; end if;
  select * into r from public.quiz_round where id = 1;
  if r.status <> 'open' or now() >= r.closes_at then raise exception 'Die Zeit für diese Frage ist um.'; end if;
  res := public.quiz_answer(public.my_player_key(), public.my_name(), p_choice);
  if res is null then raise exception 'Das Quiz ist noch nicht freigeschaltet.'; end if;
  if (res ->> 'already')::boolean then raise exception 'Du hast schon geantwortet.'; end if;
  return res;
end;
$$;
revoke execute on function public.quiz_answer_web(int) from public, anon;
grant execute on function public.quiz_answer_web(int) to authenticated;

-- Meine Antwort auf die laufende Frage
create or replace function public.quiz_my_answer()
returns int language sql stable security definer set search_path = '' as $$
  select choice from public.quiz_answers
  where round_n = (select n from public.quiz_round where id = 1) and player_key = public.my_player_key();
$$;
revoke execute on function public.quiz_my_answer() from public, anon;
grant execute on function public.quiz_my_answer() to authenticated;

-- Auflösen: Punkte verteilen (10 für richtig, bis zu 5 extra fürs schnelle Antworten)
create or replace function public.quiz_reveal()
returns public.quiz_round language plpgsql security definer set search_path = '' as $$
declare
  r public.quiz_round;
  right_choice int;
  right_count int;
  letters text[] := array['A', 'B', 'C', 'D'];
  fastest text;
  result public.quiz_round;
begin
  if not public.is_admin() then raise exception 'Auflösen dürfen nur der Streamer und die Mods.'; end if;
  select * into r from public.quiz_round where id = 1 for update;
  if r.status <> 'open' then raise exception 'Gerade ist keine Frage offen.'; end if;
  select correct into right_choice from public.quiz_secret where id = 1;

  with scored as (
    select a.player_key, a.name, a.choice = right_choice as ok,
      case when a.choice = right_choice then 10 + greatest(0, least(5, round(5 * (1 - extract(epoch from a.created_at - r.opened_at)
        / greatest(1, extract(epoch from r.closes_at - r.opened_at))))::int)) else 0 end as pts
    from public.quiz_answers a where a.round_n = r.n
  )
  insert into public.quiz_scores as s (player_key, name, points, correct, answered)
    select player_key, name, pts, ok::int, 1 from scored
  on conflict (player_key) do update set
    name = excluded.name, points = s.points + excluded.points, correct = s.correct + excluded.correct,
    answered = s.answered + 1, updated_at = now();

  select count(*) into right_count from public.quiz_answers where round_n = r.n and choice = right_choice;
  update public.quiz_round set
    status = 'revealed', correct = right_choice,
    closes_at = least(closes_at, now()),
    winners = coalesce((
      select jsonb_agg(jsonb_build_object('name', name) order by created_at)
      from (select name, created_at from public.quiz_answers where round_n = r.n and choice = right_choice order by created_at limit 5) w
    ), '[]'::jsonb),
    updated_at = now()
  where id = 1 returning * into result;
  select name into fastest from public.quiz_answers where round_n = r.n and choice = right_choice order by created_at limit 1;
  perform public.bot_say(format('✅ Richtig war %s) %s – %s von %s lagen richtig.%s', letters[right_choice + 1], r.answers[right_choice + 1],
    right_count, r.answered, case when fastest is not null then format(' Am schnellsten: %s!', fastest) else '' end));
  delete from public.quiz_scores where updated_at < now() - interval '365 days';
  return result;
end;
$$;

create or replace function public.quiz_hide()
returns public.quiz_round language plpgsql security definer set search_path = '' as $$
declare
  result public.quiz_round;
begin
  if not public.is_admin() then raise exception 'Nur der Streamer und die Mods.'; end if;
  update public.quiz_round set status = 'idle', updated_at = now() where id = 1 returning * into result;
  return result;
end;
$$;

create or replace function public.quiz_reset_scores()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Nur Admins dürfen die Rangliste leeren.'; end if;
  delete from public.quiz_scores;
end;
$$;

-- Mein Platz in der Rangliste
create or replace function public.quiz_my_score()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('points', s.points, 'correct', s.correct, 'answered', s.answered,
    'rank', (select count(*) + 1 from public.quiz_scores o where o.points > s.points))
  from public.quiz_scores s where s.player_key = public.my_player_key();
$$;

revoke execute on function public.quiz_question_save(uuid, text, text[], int, text) from public, anon;
revoke execute on function public.quiz_question_delete(uuid) from public, anon;
revoke execute on function public.quiz_start(uuid, int) from public, anon;
revoke execute on function public.quiz_reveal() from public, anon;
revoke execute on function public.quiz_hide() from public, anon;
revoke execute on function public.quiz_reset_scores() from public, anon;
revoke execute on function public.quiz_my_score() from public, anon;
grant execute on function public.quiz_question_save(uuid, text, text[], int, text) to authenticated;
grant execute on function public.quiz_question_delete(uuid) to authenticated;
grant execute on function public.quiz_start(uuid, int) to authenticated;
grant execute on function public.quiz_reveal() to authenticated;
grant execute on function public.quiz_hide() to authenticated;
grant execute on function public.quiz_reset_scores() to authenticated;
grant execute on function public.quiz_my_score() to authenticated;
do $$ begin perform public.realtime_add('quiz_round'); end $$;

-- ============================================================
-- 5) Mitspielen: Warteschlange
-- ============================================================
create table if not exists public.queue_settings (
  id int primary key default 1 check (id = 1),
  open boolean not null default false,
  mode text not null default 'order' check (mode in ('order', 'random')),
  sub_priority boolean not null default true,
  max_size int not null default 100 check (max_size between 1 and 500),
  squad_size int not null default 3 check (squad_size between 1 and 20),
  note text not null default '' check (char_length(note) <= 100),
  updated_at timestamptz not null default now()
);
insert into public.queue_settings (id) values (1) on conflict (id) do nothing;
alter table public.queue_settings enable row level security;
drop policy if exists "queue_settings: lesen für alle" on public.queue_settings;
create policy "queue_settings: lesen für alle" on public.queue_settings for select to anon, authenticated using (true);
grant select on public.queue_settings to anon;

-- Wer wartet / ist dran – ohne Epic-Namen (die sehen nur Admins, siehe queue_players)
create table if not exists public.queue_entries (
  id bigint generated always as identity primary key,
  player_key text not null,
  name text not null default '',
  is_sub boolean not null default false,
  source text not null default 'chat' check (source in ('chat', 'web')),
  status text not null default 'waiting' check (status in ('waiting', 'picked', 'done', 'removed')),
  joined_at timestamptz not null default now(),
  picked_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists queue_entries_active_key on public.queue_entries (player_key) where status in ('waiting', 'picked');
alter table public.queue_entries enable row level security;
drop policy if exists "queue_entries: lesen für alle" on public.queue_entries;
create policy "queue_entries: lesen für alle" on public.queue_entries
  for select to anon, authenticated using (status in ('waiting', 'picked'));
grant select on public.queue_entries to anon;

-- Epic-Namen (gemerkt pro Person, damit !join ohne Namen beim nächsten Mal reicht)
create table if not exists public.queue_players (
  player_key text primary key,
  epic_name text not null check (char_length(epic_name) between 3 and 32),
  updated_at timestamptz not null default now()
);
alter table public.queue_players enable row level security;

-- Reihenfolge der Wartenden: Subs zuerst (wenn eingestellt), sonst wer zuerst kam
create or replace function public.queue_position(p_key text)
returns int language sql stable security definer set search_path = '' as $$
  with s as (select sub_priority from public.queue_settings where id = 1),
  ordered as (
    select player_key, row_number() over (
      order by case when (select sub_priority from s) and is_sub then 0 else 1 end, joined_at, id) as pos
    from public.queue_entries where status = 'waiting'
  )
  select pos::int from ordered where player_key = p_key;
$$;
revoke execute on function public.queue_position(text) from public, anon, authenticated;

-- Namen in Bot-Nachrichten nur, wenn sie harmlos aussehen (keine eingetippten Texte wiederholen)
drop function if exists public.safe_name(text);
create or replace function public.safe_name(p_name text, p_fallback text default '')
returns text language sql immutable set search_path = '' as $$
  select case when coalesce(p_name, '') ~ '^[A-Za-z0-9_äöüÄÖÜß.-]{1,25}$' then '@' || p_name else p_fallback end;
$$;

create or replace function public.queue_join(p_key text, p_name text, p_epic text, p_sub boolean, p_source text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg public.queue_settings;
  epic text := left(btrim(coalesce(p_epic, '')), 32);
  known text;
  pos int;
  who text := public.safe_name(p_name);
begin
  if p_key is null then return null; end if;
  select * into cfg from public.queue_settings where id = 1;
  if not cfg.open or not public.tile_started('queue') then
    return json_build_object('ok', false, 'reason', 'closed', 'reply', ltrim(format('%s Die Warteschlange ist gerade zu.', who)));
  end if;
  if epic <> '' and epic !~ '^[[:alnum:] ._-]{3,32}$' then
    return json_build_object('ok', false, 'reason', 'epic', 'reply', ltrim(format('%s Der Epic-Name sieht komisch aus (3–32 Zeichen, Buchstaben, Zahlen, . _ -).', who)));
  end if;
  if epic <> '' then
    insert into public.queue_players (player_key, epic_name) values (p_key, epic)
      on conflict (player_key) do update set epic_name = excluded.epic_name, updated_at = now();
  else
    select epic_name into known from public.queue_players where player_key = p_key;
    if known is null then
      return json_build_object('ok', false, 'reason', 'epic', 'reply', ltrim(format('%s Schreib deinen Epic-Namen dazu: !join DeinEpicName', who)));
    end if;
  end if;
  if exists (select 1 from public.queue_entries where player_key = p_key and status = 'picked') then
    return json_build_object('ok', true, 'picked', true, 'reply', ltrim(format('%s Du bist schon dran!', who)));
  end if;
  if not exists (select 1 from public.queue_entries where player_key = p_key and status = 'waiting') then
    if (select count(*) from public.queue_entries where status = 'waiting') >= cfg.max_size then
      return json_build_object('ok', false, 'reason', 'full', 'reply', ltrim(format('%s Die Warteschlange ist voll.', who)));
    end if;
    insert into public.queue_entries (player_key, name, is_sub, source) values (p_key, left(p_name, 40), coalesce(p_sub, false), p_source);
  else
    update public.queue_entries set name = left(p_name, 40), is_sub = is_sub or coalesce(p_sub, false), updated_at = now()
      where player_key = p_key and status = 'waiting';
  end if;
  pos := public.queue_position(p_key);
  return json_build_object('ok', true, 'position', pos, 'reply', ltrim(format('%s Du stehst auf Platz %s.', who, pos)));
end;
$$;
revoke execute on function public.queue_join(text, text, text, boolean, text) from public, anon, authenticated;

create or replace function public.queue_leave(p_key text, p_name text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  update public.queue_entries set status = 'removed', updated_at = now() where player_key = p_key and status = 'waiting';
  get diagnostics n = row_count;
  if n = 0 then return null; end if;
  return json_build_object('ok', true, 'reply', ltrim(format('%s Du bist raus aus der Warteschlange.', public.safe_name(p_name))));
end;
$$;
revoke execute on function public.queue_leave(text, text) from public, anon, authenticated;

create or replace function public.queue_join_web(p_epic text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  res json;
begin
  if auth.uid() is null then raise exception 'Bitte anmelden.'; end if;
  res := public.queue_join(public.my_player_key(), public.my_name(), p_epic, false, 'web');
  if not (res ->> 'ok')::boolean then
    raise exception '%', case res ->> 'reason'
      when 'closed' then 'Die Warteschlange ist gerade zu.'
      when 'full' then 'Die Warteschlange ist voll.'
      else 'Bitte einen gültigen Epic-Namen eintragen (3–32 Zeichen).' end;
  end if;
  return res;
end;
$$;

create or replace function public.queue_leave_web()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Bitte anmelden.'; end if;
  perform public.queue_leave(public.my_player_key(), public.my_name());
end;
$$;

-- Mein Stand: wartend (Platz), dran, oder nicht dabei – und mein gemerkter Epic-Name
create or replace function public.queue_me()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'status', (select status from public.queue_entries where player_key = public.my_player_key() and status in ('waiting', 'picked') limit 1),
    'position', public.queue_position(public.my_player_key()),
    'epic', (select epic_name from public.queue_players where player_key = public.my_player_key())
  );
$$;

-- Für Admins: alle Wartenden und Dran-Seienden mit Epic-Namen
create or replace function public.queue_admin_list()
returns table (id bigint, name text, epic_name text, is_sub boolean, source text, status text, joined_at timestamptz, picked_at timestamptz, place int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Nur der Streamer und die Mods sehen die Epic-Namen.'; end if;
  return query
    select e.id, e.name, coalesce(p.epic_name, ''), e.is_sub, e.source, e.status, e.joined_at, e.picked_at,
      case when e.status = 'waiting' then public.queue_position(e.player_key) end
    from public.queue_entries e left join public.queue_players p on p.player_key = e.player_key
    where e.status in ('waiting', 'picked')
    order by e.status, 9, e.picked_at;
end;
$$;

-- Die Nächsten ziehen: der Reihe nach oder per Zufall (Subs zuerst, wenn eingestellt)
create or replace function public.queue_pick(p_count int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg public.queue_settings;
  want int;
  picked bigint[];
  names text;
begin
  if not public.is_admin() then raise exception 'Ziehen dürfen nur der Streamer und die Mods.'; end if;
  select * into cfg from public.queue_settings where id = 1;
  want := least(20, greatest(1, coalesce(p_count, cfg.squad_size)));
  select array_agg(id) into picked from (
    select id from public.queue_entries where status = 'waiting'
    order by case when cfg.sub_priority and is_sub then 0 else 1 end,
             case when cfg.mode = 'random' then random() end,
             joined_at, id
    limit want
  ) s;
  if picked is null then raise exception 'Gerade wartet niemand.'; end if;
  update public.queue_entries set status = 'picked', picked_at = now(), updated_at = now() where id = any(picked);
  select string_agg(public.safe_name(name, 'ein Zuschauer'), ', ') into names from public.queue_entries where id = any(picked);
  perform public.bot_say(format('🎮 Ihr seid dran: %s! Schaut in eure Freundschaftsanfragen bei Epic.', names));
  return json_build_object('picked', cardinality(picked));
end;
$$;

-- Erledigt (hat mitgespielt), entfernen, alle Dran-Seienden erledigt, Schlange leeren
create or replace function public.queue_update(p_action text, p_id bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Nur der Streamer und die Mods.'; end if;
  if p_action = 'done' then
    update public.queue_entries set status = 'done', updated_at = now() where id = p_id and status in ('waiting', 'picked');
  elsif p_action = 'remove' then
    update public.queue_entries set status = 'removed', updated_at = now() where id = p_id and status in ('waiting', 'picked');
  elsif p_action = 'back' then
    update public.queue_entries set status = 'waiting', picked_at = null, updated_at = now() where id = p_id and status = 'picked';
  elsif p_action = 'done_all' then
    update public.queue_entries set status = 'done', updated_at = now() where status = 'picked';
  elsif p_action = 'clear' then
    update public.queue_entries set status = 'removed', updated_at = now() where status in ('waiting', 'picked');
  else
    raise exception 'Unbekannte Aktion.';
  end if;
  delete from public.queue_entries where status in ('done', 'removed') and updated_at < now() - interval '7 days';
end;
$$;

create or replace function public.queue_save(p_open boolean, p_mode text, p_sub boolean, p_max int, p_squad int, p_note text)
returns public.queue_settings language plpgsql security definer set search_path = '' as $$
declare
  was boolean;
  result public.queue_settings;
begin
  if not public.is_admin() then raise exception 'Nur der Streamer und die Mods.'; end if;
  select open into was from public.queue_settings where id = 1;
  update public.queue_settings set
    open = coalesce(p_open, open),
    mode = case when p_mode in ('order', 'random') then p_mode else mode end,
    sub_priority = coalesce(p_sub, sub_priority),
    max_size = least(500, greatest(1, coalesce(p_max, max_size))),
    squad_size = least(20, greatest(1, coalesce(p_squad, squad_size))),
    note = left(btrim(coalesce(p_note, note)), 100),
    updated_at = now()
  where id = 1 returning * into result;
  if result.open and not was then
    perform public.bot_say('🎮 Die Warteschlange zum Mitspielen ist offen! Schreib !join DeinEpicName – raus mit !leave.');
  end if;
  return result;
end;
$$;
revoke execute on function public.queue_join_web(text) from public, anon;
revoke execute on function public.queue_leave_web() from public, anon;
revoke execute on function public.queue_me() from public, anon;
revoke execute on function public.queue_admin_list() from public, anon;
revoke execute on function public.queue_pick(int) from public, anon;
revoke execute on function public.queue_update(text, bigint) from public, anon;
revoke execute on function public.queue_save(boolean, text, boolean, int, int, text) from public, anon;
grant execute on function public.queue_join_web(text) to authenticated;
grant execute on function public.queue_leave_web() to authenticated;
grant execute on function public.queue_me() to authenticated;
grant execute on function public.queue_admin_list() to authenticated;
grant execute on function public.queue_pick(int) to authenticated;
grant execute on function public.queue_update(text, bigint) to authenticated;
grant execute on function public.queue_save(boolean, text, boolean, int, int, text) to authenticated;
do $$ begin perform public.realtime_add('queue_entries'); perform public.realtime_add('queue_settings'); end $$;

-- ============================================================
-- 6) Text-to-Speech (Kanalpunkte → das Overlay liest vor)
-- ============================================================
create table if not exists public.tts_settings (
  id int primary key default 1 check (id = 1),
  need_approval boolean not null default true,
  max_chars int not null default 200 check (max_chars between 20 and 500),
  blocked_words text[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.tts_settings (id) values (1) on conflict (id) do nothing;
alter table public.tts_settings enable row level security;
drop policy if exists "tts_settings: lesen für admins" on public.tts_settings;
create policy "tts_settings: lesen für admins" on public.tts_settings for select to authenticated using ((select public.is_admin()));

-- Überspringen: das Overlay hört auf skip_n (öffentlich lesbar)
create table if not exists public.tts_state (
  id int primary key default 1 check (id = 1),
  skip_n int not null default 0,
  muted boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.tts_state (id) values (1) on conflict (id) do nothing;
alter table public.tts_state enable row level security;
drop policy if exists "tts_state: lesen für alle" on public.tts_state;
create policy "tts_state: lesen für alle" on public.tts_state for select to anon, authenticated using (true);
grant select on public.tts_state to anon;

create table if not exists public.tts_messages (
  id uuid primary key default gen_random_uuid(),
  who text not null default '',
  text text not null check (char_length(text) between 1 and 500),
  voice text not null default 'normal' check (voice in ('normal', 'roboter', 'oma', 'monster', 'schnell', 'fluester')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  source text not null default 'twitch' check (source in ('twitch', 'web')),
  redemption_id text unique,
  reward_id text,
  -- Kanalpunkte bei Twitch schon als eingelöst/zurückgegeben markiert (stream-tools, Aktion settle)
  settled boolean not null default false,
  reviewed_by text not null default '',
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.tts_messages enable row level security;
-- Freigegebene liest auch OBS (sie werden sowieso im Stream vorgelesen); Admins sehen alles
drop policy if exists "tts_messages: freigegebene lesen alle" on public.tts_messages;
create policy "tts_messages: freigegebene lesen alle" on public.tts_messages
  for select to anon, authenticated using (status = 'approved' or (select public.is_admin()));
grant select on public.tts_messages to anon;

-- Stimme am Anfang: „roboter: Hallo“ → (roboter, Hallo)
create or replace function public.tts_parse(p_input text)
returns table (voice text, body text) language sql immutable set search_path = '' as $$
  select
    case when m[1] is null then 'normal'
      else case lower(m[1])
        when 'robot' then 'roboter' when 'roboter' then 'roboter'
        when 'oma' then 'oma' when 'omi' then 'oma'
        when 'monster' then 'monster' when 'tief' then 'monster'
        when 'schnell' then 'schnell' when 'fluester' then 'fluester' when 'flüster' then 'fluester' else 'normal' end end,
    btrim(coalesce(case when m[1] is null then p_input else m[2] end, ''))
  from (select regexp_match(btrim(coalesce(p_input, '')), '^\[?(robot|roboter|oma|omi|monster|tief|schnell|fluester|flüster)\]?\s*[:\-]\s*(.*)$', 'is') as m) s;
$$;

-- Prüfen: Länge, Links, gesperrte Wörter → Grund oder NULL
create or replace function public.tts_problem(p_text text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  cfg public.tts_settings;
  w text;
begin
  select * into cfg from public.tts_settings where id = 1;
  if char_length(btrim(coalesce(p_text, ''))) = 0 then return 'empty'; end if;
  if char_length(p_text) > cfg.max_chars then return 'long'; end if;
  if p_text ~* '(https?://|www\.|\m[a-z0-9-]+\.(de|com|net|org|tv|gg|io|ly|me)\M)' then return 'link'; end if;
  foreach w in array cfg.blocked_words loop
    if btrim(w) <> '' and position(lower(btrim(w)) in lower(p_text)) > 0 then return 'blocked'; end if;
  end loop;
  return null;
end;
$$;
revoke execute on function public.tts_problem(text) from public, anon, authenticated;

-- Einlösung von Twitch (twitch-eventsub). Ergebnis: fulfill, cancel (Punkte zurück) oder wait (Freigabe).
create or replace function public.tts_redeem(p_redemption text, p_reward text, p_name text, p_input text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg public.tts_settings;
  parsed record;
  problem text;
  who text := public.safe_name(p_name);
begin
  select * into cfg from public.tts_settings where id = 1;
  if exists (select 1 from public.tts_messages where redemption_id = p_redemption) then
    return json_build_object('action', 'duplicate');
  end if;
  if not public.tile_started('tts') then
    return json_build_object('action', 'cancel', 'reply', ltrim(format('%s Vorlesen geht noch nicht – deine Kanalpunkte sind zurück.', who)));
  end if;
  select * into parsed from public.tts_parse(p_input);
  problem := public.tts_problem(parsed.body);
  if problem is not null then
    -- Den eingetippten Text nie wiederholen
    return json_build_object('action', 'cancel', 'reply', ltrim(format('%s %s Deine Kanalpunkte sind zurück.', who, case problem
      when 'long' then format('Die Nachricht ist zu lang (höchstens %s Zeichen).', cfg.max_chars)
      when 'link' then 'Links werden nicht vorgelesen.'
      when 'empty' then 'Da war keine Nachricht.'
      else 'Diese Nachricht wird nicht vorgelesen.' end)));
  end if;
  insert into public.tts_messages (who, text, voice, status, source, redemption_id, reward_id, reviewed_at, reviewed_by)
    values (left(p_name, 40), parsed.body, parsed.voice,
            case when cfg.need_approval then 'pending' else 'approved' end, 'twitch', p_redemption, p_reward,
            case when cfg.need_approval then null else now() end, case when cfg.need_approval then '' else 'automatisch' end);
  delete from public.tts_messages where created_at < now() - interval '3 days' and (settled or redemption_id is null or status <> 'pending');
  return json_build_object('action', case when cfg.need_approval then 'wait' else 'fulfill' end);
end;
$$;
revoke execute on function public.tts_redeem(text, text, text, text) from public, anon, authenticated;

-- Freigeben / Ablehnen / nochmal vorlesen (Admins). Die Kanalpunkte erledigt danach stream-tools (settle).
create or replace function public.tts_review(p_id uuid, p_action text)
returns public.tts_messages language plpgsql security definer set search_path = '' as $$
declare
  result public.tts_messages;
begin
  if not public.is_admin() then raise exception 'Freigeben dürfen nur der Streamer und die Mods.'; end if;
  if p_action = 'approve' then
    update public.tts_messages set status = 'approved', reviewed_at = now(), reviewed_by = public.my_name()
      where id = p_id and status = 'pending' returning * into result;
  elsif p_action = 'reject' then
    update public.tts_messages set status = 'rejected', reviewed_at = now(), reviewed_by = public.my_name()
      where id = p_id and status = 'pending' returning * into result;
  elsif p_action = 'replay' then
    update public.tts_messages set reviewed_at = now(), reviewed_by = public.my_name()
      where id = p_id and status = 'approved' returning * into result;
  else
    raise exception 'Unbekannte Aktion.';
  end if;
  if result.id is null then raise exception 'Diese Nachricht ist schon erledigt.'; end if;
  return result;
end;
$$;

-- Probe von der Seite (Admins): wird sofort vorgelesen
create or replace function public.tts_web(p_text text, p_voice text)
returns public.tts_messages language plpgsql security definer set search_path = '' as $$
declare
  problem text := public.tts_problem(p_text);
  result public.tts_messages;
begin
  if not public.is_admin() then raise exception 'Nur der Streamer und die Mods.'; end if;
  if problem = 'long' then raise exception 'Die Nachricht ist zu lang.'; end if;
  if problem = 'empty' then raise exception 'Bitte einen Text eingeben.'; end if;
  insert into public.tts_messages (who, text, voice, status, source, reviewed_at, reviewed_by, settled)
    values (public.my_name(), btrim(p_text),
            case when p_voice in ('normal', 'roboter', 'oma', 'monster', 'schnell', 'fluester') then p_voice else 'normal' end,
            'approved', 'web', now(), public.my_name(), true)
    returning * into result;
  return result;
end;
$$;

create or replace function public.tts_skip(p_mute boolean default null)
returns public.tts_state language plpgsql security definer set search_path = '' as $$
declare
  result public.tts_state;
begin
  if not public.is_admin() then raise exception 'Nur der Streamer und die Mods.'; end if;
  update public.tts_state set
    skip_n = case when p_mute is null then skip_n + 1 else skip_n end,
    muted = coalesce(p_mute, muted),
    updated_at = now()
  where id = 1 returning * into result;
  return result;
end;
$$;

create or replace function public.tts_save(p_approval boolean, p_max int, p_blocked text[])
returns public.tts_settings language plpgsql security definer set search_path = '' as $$
declare
  result public.tts_settings;
begin
  if not public.is_admin() then raise exception 'Nur Admins dürfen das ändern.'; end if;
  update public.tts_settings set
    need_approval = coalesce(p_approval, need_approval),
    max_chars = least(500, greatest(20, coalesce(p_max, max_chars))),
    blocked_words = coalesce((select array_agg(distinct lower(left(btrim(w), 40))) from unnest(p_blocked) w where btrim(w) <> ''), '{}'),
    updated_at = now()
  where id = 1 returning * into result;
  return result;
end;
$$;
revoke execute on function public.tts_review(uuid, text) from public, anon;
revoke execute on function public.tts_web(text, text) from public, anon;
revoke execute on function public.tts_skip(boolean) from public, anon;
revoke execute on function public.tts_save(boolean, int, text[]) from public, anon;
grant execute on function public.tts_review(uuid, text) to authenticated;
grant execute on function public.tts_web(text, text) to authenticated;
grant execute on function public.tts_skip(boolean) to authenticated;
grant execute on function public.tts_save(boolean, int, text[]) to authenticated;
do $$ begin perform public.realtime_add('tts_messages'); perform public.realtime_add('tts_state'); end $$;

-- ============================================================
-- 7) Sammelkarten
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cards', 'cards', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "cards: bilder hochladen nur admin" on storage.objects;
create policy "cards: bilder hochladen nur admin" on storage.objects
  for insert to authenticated with check (bucket_id = 'cards' and (select public.is_admin()));
drop policy if exists "cards: bilder sehen nur admin" on storage.objects;
create policy "cards: bilder sehen nur admin" on storage.objects
  for select to authenticated using (bucket_id = 'cards' and (select public.is_admin()));
drop policy if exists "cards: bilder löschen nur admin" on storage.objects;
create policy "cards: bilder löschen nur admin" on storage.objects
  for delete to authenticated using (bucket_id = 'cards' and (select public.is_admin()));

create table if not exists public.card_defs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  rarity text not null default 'common' check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  emoji text not null default '🃏' check (char_length(emoji) between 1 and 8),
  image_path text check (image_path is null or char_length(image_path) <= 200),
  description text not null default '' check (char_length(description) <= 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.card_defs enable row level security;
drop policy if exists "card_defs: lesen für alle" on public.card_defs;
create policy "card_defs: lesen für alle" on public.card_defs for select to anon, authenticated using (true);
grant select on public.card_defs to anon;

insert into public.card_defs (name, rarity, emoji, description)
select n, r, e, d from (values
  ('Chat-Spam', 'common', '💬', 'Alle schreiben gleichzeitig. Keiner liest.'),
  ('Lag', 'common', '🐌', 'Er war doch getroffen!'),
  ('Aus Versehen gebaut', 'common', '🧱', 'Eigentlich wollte er schießen.'),
  ('Vergessen zu heilen', 'common', '🩹', 'Ein Leben, drei Medikits im Inventar.'),
  ('Busfahrer-Gruß', 'common', '🚌', 'Danke, Busfahrer!'),
  ('Loot-Goblin', 'common', '🎒', 'Öffnet jede Kiste. Wirklich jede.'),
  ('No-Scope-Versuch', 'uncommon', '🎯', 'Daneben. Aber mit Stil.'),
  ('Tanz-Emote', 'uncommon', '💃', 'Mitten im Fight.'),
  ('Sturm-Surfer', 'uncommon', '🌪️', 'Knapp vor der Zone.'),
  ('Clutch-Moment', 'rare', '🔥', 'Eins gegen drei – und gewonnen.'),
  ('Mod mit Bann-Hammer', 'rare', '🔨', 'Ordnung muss sein.'),
  ('Stream-Dino', 'rare', '🦖', 'Hat Hunger. Immer.'),
  ('Victory Royale', 'epic', '👑', 'Der Moment, für den alle da sind.'),
  ('Rage-Quit', 'epic', '😡', 'Controller liegt noch.'),
  ('Der Streamer', 'legendary', '⭐', 'Die seltenste Karte von allen.'),
  ('Goldener Pott', 'legendary', '🏆', 'Leben und Schild voll – in Gold.')
) as v(n, r, e, d)
where not exists (select 1 from public.card_defs);

create table if not exists public.card_settings (
  id int primary key default 1 check (id = 1),
  pack_size int not null default 3 check (pack_size between 1 and 10),
  daily boolean not null default true,
  -- Gewichte für Gewöhnlich, Ungewöhnlich, Selten, Episch, Legendär
  weights int[] not null default '{55,25,12,6,2}' check (cardinality(weights) = 5),
  updated_at timestamptz not null default now()
);
insert into public.card_settings (id) values (1) on conflict (id) do nothing;
alter table public.card_settings enable row level security;
drop policy if exists "card_settings: lesen für angemeldete" on public.card_settings;
create policy "card_settings: lesen für angemeldete" on public.card_settings for select to authenticated using (true);

create table if not exists public.card_players (
  player_key text primary key,
  name text not null default '',
  last_daily date,
  updated_at timestamptz not null default now()
);
alter table public.card_players enable row level security;

create table if not exists public.card_owned (
  player_key text not null,
  card_id uuid not null references public.card_defs on delete cascade,
  count int not null default 1 check (count >= 0),
  first_at timestamptz not null default now(),
  primary key (player_key, card_id)
);
alter table public.card_owned enable row level security;
-- Sammlungen sehen alle Angemeldeten (zum Tauschen)
drop policy if exists "card_owned: lesen für angemeldete" on public.card_owned;
create policy "card_owned: lesen für angemeldete" on public.card_owned for select to authenticated using (true);

create table if not exists public.card_packs (
  id uuid primary key default gen_random_uuid(),
  player_key text not null,
  source text not null check (source in ('daily', 'twitch', 'admin')),
  redemption_id text unique,
  cards uuid[],
  opened_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists card_packs_player on public.card_packs (player_key) where opened_at is null;
alter table public.card_packs enable row level security;

create table if not exists public.card_trades (
  id uuid primary key default gen_random_uuid(),
  from_key text not null,
  from_name text not null default '',
  to_key text not null,
  to_name text not null default '',
  give_card uuid not null references public.card_defs on delete cascade,
  want_card uuid not null references public.card_defs on delete cascade,
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'canceled', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.card_trades enable row level security;
drop policy if exists "card_trades: eigene lesen" on public.card_trades;
create policy "card_trades: eigene lesen" on public.card_trades for select to authenticated
  using (from_key = (select public.my_player_key()) or to_key = (select public.my_player_key()));

-- Seltene Ziehungen fürs Overlay (Episch und Legendär)
create table if not exists public.card_pulls (
  id bigint generated always as identity primary key,
  who text not null default '',
  card_id uuid,
  card_name text not null default '',
  rarity text not null default '',
  emoji text not null default '',
  image_path text,
  created_at timestamptz not null default now()
);
alter table public.card_pulls enable row level security;
drop policy if exists "card_pulls: lesen für alle" on public.card_pulls;
create policy "card_pulls: lesen für alle" on public.card_pulls for select to anon, authenticated using (true);
grant select on public.card_pulls to anon;

create or replace function public.cards_touch_player(p_key text, p_name text)
returns void language sql security definer set search_path = '' as $$
  insert into public.card_players (player_key, name) values (p_key, left(coalesce(p_name, ''), 40))
    on conflict (player_key) do update set name = excluded.name, updated_at = now();
$$;
revoke execute on function public.cards_touch_player(text, text) from public, anon, authenticated;

-- Eine zufällige Karte: erst die Seltenheit nach Gewicht (nur Seltenheiten mit Karten), dann die Karte
create or replace function public.cards_draw_one()
returns public.card_defs language plpgsql volatile security definer set search_path = '' as $$
declare
  w int[] := (select weights from public.card_settings where id = 1);
  rarities text[] := array['common', 'uncommon', 'rare', 'epic', 'legendary'];
  total int := 0;
  roll int;
  pick text;
  i int;
  result public.card_defs;
begin
  for i in 1..5 loop
    if exists (select 1 from public.card_defs where active and rarity = rarities[i]) then total := total + greatest(0, w[i]); end if;
  end loop;
  if total = 0 then
    select * into result from public.card_defs where active order by random() limit 1;
    return result;
  end if;
  roll := floor(random() * total)::int;
  for i in 1..5 loop
    if exists (select 1 from public.card_defs where active and rarity = rarities[i]) then
      if roll < greatest(0, w[i]) then pick := rarities[i]; exit; end if;
      roll := roll - greatest(0, w[i]);
    end if;
  end loop;
  select * into result from public.card_defs where active and rarity = pick order by random() limit 1;
  return result;
end;
$$;
revoke execute on function public.cards_draw_one() from public, anon, authenticated;

-- Mein Stand: ungeöffnete Packs, Tages-Pack verfügbar?, Sammlung
create or replace function public.cards_me()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  me text := public.my_player_key();
  today date := (now() at time zone 'Europe/Berlin')::date;
begin
  if me is null then raise exception 'Bitte anmelden.'; end if;
  return json_build_object(
    'key', me,
    'packs', coalesce((select json_agg(json_build_object('id', id, 'source', source, 'created_at', created_at) order by created_at)
                       from public.card_packs where player_key = me and opened_at is null), '[]'::json),
    'daily', coalesce((select daily from public.card_settings where id = 1), true)
             and public.tile_started('cards')
             and coalesce((select last_daily from public.card_players where player_key = me), date '2000-01-01') < today,
    'owned', coalesce((select json_agg(json_build_object('card_id', card_id, 'count', count)) from public.card_owned where player_key = me and count > 0), '[]'::json)
  );
end;
$$;

-- Tages-Pack abholen (einmal pro Tag, deutsche Zeit)
create or replace function public.cards_claim_daily()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me text := public.my_player_key();
  today date := (now() at time zone 'Europe/Berlin')::date;
  last date;
  pack uuid;
begin
  if me is null then raise exception 'Bitte anmelden.'; end if;
  if not public.feature_open('cards') then raise exception 'Die Sammelkarten starten erst später.'; end if;
  if not coalesce((select daily from public.card_settings where id = 1), true) then raise exception 'Gratis-Packs sind gerade aus.'; end if;
  perform public.cards_touch_player(me, public.my_name());
  select last_daily into last from public.card_players where player_key = me for update;
  if last is not null and last >= today then raise exception 'Dein Gratis-Pack für heute hast du schon – morgen gibt es ein neues.'; end if;
  update public.card_players set last_daily = today where player_key = me;
  insert into public.card_packs (player_key, source) values (me, 'daily') returning id into pack;
  return pack;
end;
$$;

-- Pack öffnen: Karten ziehen, in die Sammlung, seltene ins Overlay
create or replace function public.cards_open(p_pack uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me text := public.my_player_key();
  p public.card_packs;
  size int := coalesce((select pack_size from public.card_settings where id = 1), 3);
  c public.card_defs;
  drawn uuid[] := '{}';
  out_cards jsonb := '[]'::jsonb;
  was_new boolean;
  i int;
begin
  if me is null then raise exception 'Bitte anmelden.'; end if;
  select * into p from public.card_packs where id = p_pack and player_key = me for update;
  if p.id is null then raise exception 'Dieses Pack gibt es nicht.'; end if;
  if p.opened_at is not null then raise exception 'Dieses Pack ist schon offen.'; end if;
  if not exists (select 1 from public.card_defs where active) then raise exception 'Es gibt noch keine Karten.'; end if;
  perform public.cards_touch_player(me, public.my_name());
  for i in 1..size loop
    c := public.cards_draw_one();
    was_new := not exists (select 1 from public.card_owned where player_key = me and card_id = c.id and count > 0);
    insert into public.card_owned (player_key, card_id, count) values (me, c.id, 1)
      on conflict (player_key, card_id) do update set count = public.card_owned.count + 1;
    drawn := drawn || c.id;
    out_cards := out_cards || jsonb_build_object('id', c.id, 'name', c.name, 'rarity', c.rarity, 'emoji', c.emoji,
      'image_path', c.image_path, 'description', c.description, 'new', was_new);
    if c.rarity in ('epic', 'legendary') then
      insert into public.card_pulls (who, card_id, card_name, rarity, emoji, image_path)
        values (public.my_name(), c.id, c.name, c.rarity, c.emoji, c.image_path);
    end if;
  end loop;
  update public.card_packs set opened_at = now(), cards = drawn where id = p.id;
  delete from public.card_pulls where created_at < now() - interval '2 days';
  return out_cards::json;
end;
$$;

-- Kanalpunkte-Einlösung (twitch-eventsub): Pack für das Twitch-Konto
create or replace function public.cards_redeem(p_redemption text, p_twitch_id text, p_name text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  if not public.tile_started('cards') then
    return json_build_object('action', 'cancel', 'reply', ltrim(format('%s Die Sammelkarten starten erst später – deine Kanalpunkte sind zurück.', public.safe_name(p_name))));
  end if;
  insert into public.card_packs (player_key, source, redemption_id) values ('tw:' || p_twitch_id, 'twitch', p_redemption)
    on conflict (redemption_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('action', 'duplicate'); end if;
  perform public.cards_touch_player('tw:' || p_twitch_id, p_name);
  return json_build_object('action', 'fulfill',
    'reply', ltrim(format('%s Dein Karten-Pack liegt bereit! Auf der Webseite mit Twitch anmelden und bei „Sammelkarten“ öffnen.', public.safe_name(p_name))));
end;
$$;
revoke execute on function public.cards_redeem(text, text, text) from public, anon, authenticated;

-- Rangliste: die meisten verschiedenen Karten
create or replace function public.cards_leaderboard()
returns table (player_key text, name text, uniq int, total int)
language sql stable security definer set search_path = '' as $$
  select o.player_key, coalesce(p.name, ''), count(*) filter (where o.count > 0)::int, coalesce(sum(o.count), 0)::int
  from public.card_owned o left join public.card_players p on p.player_key = o.player_key
  group by o.player_key, p.name
  having count(*) filter (where o.count > 0) > 0
  order by 3 desc, 4 desc, 2
  limit 30;
$$;

-- Tauschen: meine Karte gegen eine Karte eines anderen
create or replace function public.cards_offer(p_to text, p_give uuid, p_want uuid)
returns public.card_trades language plpgsql security definer set search_path = '' as $$
declare
  me text := public.my_player_key();
  result public.card_trades;
begin
  if me is null then raise exception 'Bitte anmelden.'; end if;
  if p_to = me then raise exception 'Mit dir selbst tauschen geht nicht.'; end if;
  if not exists (select 1 from public.card_owned where player_key = me and card_id = p_give and count > 0) then
    raise exception 'Diese Karte hast du nicht.';
  end if;
  if not exists (select 1 from public.card_owned where player_key = p_to and card_id = p_want and count > 0) then
    raise exception 'Diese Karte hat die andere Person nicht (mehr).';
  end if;
  if (select count(*) from public.card_trades where from_key = me and status = 'open') >= 10 then
    raise exception 'Du hast schon 10 offene Angebote – warte auf Antworten oder zieh welche zurück.';
  end if;
  perform public.cards_touch_player(me, public.my_name());
  insert into public.card_trades (from_key, from_name, to_key, to_name, give_card, want_card)
    values (me, public.my_name(), p_to, coalesce((select name from public.card_players where player_key = p_to), ''), p_give, p_want)
    returning * into result;
  return result;
end;
$$;

create or replace function public.cards_answer(p_trade uuid, p_accept boolean)
returns public.card_trades language plpgsql security definer set search_path = '' as $$
declare
  me text := public.my_player_key();
  t public.card_trades;
  result public.card_trades;
begin
  select * into t from public.card_trades where id = p_trade for update;
  if t.id is null or t.status <> 'open' then raise exception 'Dieses Angebot gibt es nicht mehr.'; end if;
  if t.to_key = me and not p_accept then
    update public.card_trades set status = 'declined', updated_at = now() where id = t.id returning * into result;
    return result;
  end if;
  if t.from_key = me and not p_accept then
    update public.card_trades set status = 'canceled', updated_at = now() where id = t.id returning * into result;
    return result;
  end if;
  if t.to_key <> me then raise exception 'Das Angebot ist nicht an dich.'; end if;
  -- Beide müssen die Karten noch haben
  perform 1 from public.card_owned where (player_key, card_id) in ((t.from_key, t.give_card), (t.to_key, t.want_card)) for update;
  if not exists (select 1 from public.card_owned where player_key = t.from_key and card_id = t.give_card and count > 0)
     or not exists (select 1 from public.card_owned where player_key = t.to_key and card_id = t.want_card and count > 0) then
    update public.card_trades set status = 'failed', updated_at = now() where id = t.id returning * into result;
    return result;
  end if;
  update public.card_owned set count = count - 1 where player_key = t.from_key and card_id = t.give_card;
  update public.card_owned set count = count - 1 where player_key = t.to_key and card_id = t.want_card;
  insert into public.card_owned (player_key, card_id, count) values (t.to_key, t.give_card, 1)
    on conflict (player_key, card_id) do update set count = public.card_owned.count + 1;
  insert into public.card_owned (player_key, card_id, count) values (t.from_key, t.want_card, 1)
    on conflict (player_key, card_id) do update set count = public.card_owned.count + 1;
  delete from public.card_owned where count <= 0;
  update public.card_trades set status = 'accepted', updated_at = now() where id = t.id returning * into result;
  delete from public.card_trades where status <> 'open' and updated_at < now() - interval '14 days';
  return result;
end;
$$;

-- Admins: Karten anlegen/ändern/löschen, Einstellungen, Packs verschenken
create or replace function public.card_save(p_id uuid, p_name text, p_rarity text, p_emoji text, p_image text, p_description text, p_active boolean)
returns public.card_defs language plpgsql security definer set search_path = '' as $$
declare
  result public.card_defs;
begin
  if not public.is_admin() then raise exception 'Karten verwalten nur Admins.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Die Karte braucht einen Namen.'; end if;
  if p_rarity not in ('common', 'uncommon', 'rare', 'epic', 'legendary') then raise exception 'Unbekannte Seltenheit.'; end if;
  if p_id is null then
    insert into public.card_defs (name, rarity, emoji, image_path, description, active)
      values (left(btrim(p_name), 40), p_rarity, coalesce(nullif(left(btrim(coalesce(p_emoji, '')), 8), ''), '🃏'),
              nullif(p_image, ''), left(btrim(coalesce(p_description, '')), 120), coalesce(p_active, true))
      returning * into result;
  else
    update public.card_defs set name = left(btrim(p_name), 40), rarity = p_rarity,
      emoji = coalesce(nullif(left(btrim(coalesce(p_emoji, '')), 8), ''), '🃏'),
      image_path = nullif(p_image, ''), description = left(btrim(coalesce(p_description, '')), 120),
      active = coalesce(p_active, active)
    where id = p_id returning * into result;
    if result.id is null then raise exception 'Diese Karte gibt es nicht mehr.'; end if;
  end if;
  return result;
end;
$$;

-- Löschen nimmt die Karte aus allen Sammlungen – lieber „nicht mehr ziehbar“ (active = false)
create or replace function public.card_delete(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  path text;
begin
  if not public.is_admin() then raise exception 'Karten verwalten nur Admins.'; end if;
  delete from public.card_defs where id = p_id returning image_path into path;
  return path;
end;
$$;

create or replace function public.cards_save_settings(p_size int, p_daily boolean, p_weights int[])
returns public.card_settings language plpgsql security definer set search_path = '' as $$
declare
  result public.card_settings;
begin
  if not public.is_admin() then raise exception 'Nur Admins dürfen das ändern.'; end if;
  if p_weights is not null and (cardinality(p_weights) <> 5 or exists (select 1 from unnest(p_weights) w where w < 0 or w > 1000)
     or (select sum(w) from unnest(p_weights) w) = 0) then
    raise exception 'Fünf Gewichte zwischen 0 und 1000, nicht alle 0.';
  end if;
  update public.card_settings set
    pack_size = least(10, greatest(1, coalesce(p_size, pack_size))),
    daily = coalesce(p_daily, daily),
    weights = coalesce(p_weights, weights),
    updated_at = now()
  where id = 1 returning * into result;
  return result;
end;
$$;

revoke execute on function public.cards_me() from public, anon;
revoke execute on function public.cards_claim_daily() from public, anon;
revoke execute on function public.cards_open(uuid) from public, anon;
revoke execute on function public.cards_leaderboard() from public, anon;
revoke execute on function public.cards_offer(text, uuid, uuid) from public, anon;
revoke execute on function public.cards_answer(uuid, boolean) from public, anon;
revoke execute on function public.card_save(uuid, text, text, text, text, text, boolean) from public, anon;
revoke execute on function public.card_delete(uuid) from public, anon;
revoke execute on function public.cards_save_settings(int, boolean, int[]) from public, anon;
grant execute on function public.cards_me() to authenticated;
grant execute on function public.cards_claim_daily() to authenticated;
grant execute on function public.cards_open(uuid) to authenticated;
grant execute on function public.cards_leaderboard() to authenticated;
grant execute on function public.cards_offer(text, uuid, uuid) to authenticated;
grant execute on function public.cards_answer(uuid, boolean) to authenticated;
grant execute on function public.card_save(uuid, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.card_delete(uuid) to authenticated;
grant execute on function public.cards_save_settings(int, boolean, int[]) to authenticated;
do $$ begin perform public.realtime_add('card_pulls'); perform public.realtime_add('card_trades'); end $$;

-- ============================================================
-- Chat-Befehle (twitch-eventsub → chat_command)
-- ============================================================
-- p_badges: set_ids der Chat-Abzeichen (subscriber, founder, moderator, broadcaster …)
-- Ergebnis: NULL oder {reply: Text für den Bot}
create or replace function public.chat_command(p_user_id text, p_name text, p_badges text[], p_text text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  msg text := btrim(coalesce(p_text, ''));
  cmd text;
  arg text;
  key text;
  res json;
begin
  if msg !~ '^!' or coalesce(p_user_id, '') !~ '^[0-9]{1,20}$' then return null; end if;
  cmd := lower(split_part(msg, ' ', 1));
  arg := btrim(substr(msg, char_length(cmd) + 1));
  key := 'tw:' || p_user_id;
  if cmd = (select report_command from public.forbidden_word where id = 1) then
    perform public.forbidden_report(key, p_name);
    return null;
  end if;
  if cmd in ('!a', '!b', '!c', '!d') then
    perform public.quiz_answer(key, p_name, ascii(substr(cmd, 2, 1)) - ascii('a'));
    return null;
  end if;
  if cmd = (select guess_command from public.pause_screen where id = 1) then
    perform public.pause_guess(key, p_name, split_part(arg, ' ', 1));
    return null;
  end if;
  if cmd = '!join' then
    res := public.queue_join(key, p_name, arg, coalesce(p_badges && array['subscriber', 'founder'], false), 'chat');
    return case when res is null then null else json_build_object('reply', res ->> 'reply') end;
  end if;
  if cmd = '!leave' then
    res := public.queue_leave(key, p_name);
    return case when res is null then null else json_build_object('reply', res ->> 'reply') end;
  end if;
  return null;
end;
$$;
revoke execute on function public.chat_command(text, text, text[], text) from public, anon, authenticated;
