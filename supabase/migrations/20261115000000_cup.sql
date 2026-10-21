-- ============================================================
-- StreamHelp: Cup (Content-Idee „Cup“) – ein Turnier mit Rangliste und Preisgeldern
--   · Der Streamer legt Titel, Regeln, Preisgelder je Platz und den Spielcode fest. Der Bot schickt
--     Regeln und Spielcode auf Knopfdruck in den Chat.
--   · Zuschauer treten mit „!cup join“ im Chat bei, Streamer und Mods tragen Spieler auch von Hand ein.
--   · Punkte vergeben Streamer und Mods auf der Webseite; daraus ergibt sich die Rangliste (gleiche
--     Punkte = gleicher Platz). Preisgelder stehen neben den Plätzen.
--   · Chat: !cup (Infos) · !cup join · !cup regeln · !cup top · !cup platz
--   · core.cup (eine Zeile je Kanal) ist für alle lesbar (Rangliste ohne Anmeldung), der Spielcode liegt
--     in core.cup_code (nur über cup_admin), die Teilnehmer in core.cup_players (nur über Funktionen –
--     die Twitch-IDs bleiben unsichtbar; die Rangliste liefert cup_board ohne IDs).
--   · Mod-Rechte: Bereich „Spiele & Mitmachen“ (games).
-- Braucht 20261028000000_platform.sql, 20261031000000_security.sql, 20261107000000_chat_control.sql.
-- Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('public.channels') is null then
    raise exception 'Erst die Plattform-Migration 20261028000000_platform.sql ausführen.';
  end if;
end;
$$;

-- ---------- Kachel ----------
alter table core.tiles drop constraint if exists tiles_kind_check;
alter table core.tiles add constraint tiles_kind_check
  check (kind in ('wheel', 'countdown', 'prank', 'bingo', 'questions', 'pet', 'shop', 'challenge',
                  'forbidden', 'subathon', 'pause', 'quiz', 'queue', 'tts', 'cards', 'giveaway', 'hotwords', 'poll',
                  'counter', 'gamewheel', 'heart', 'chatcontrol', 'cup'));

do $$
declare
  c record;
begin
  for c in
    select ch.id from public.channels ch
    where exists (select 1 from core.tiles t where t.channel_id = ch.id)
      and not exists (select 1 from core.tiles t where t.channel_id = ch.id and t.kind = 'cup')
  loop
    update core.tiles set position = position + 1 where channel_id = c.id and kind = 'countdown';
    insert into core.tiles (channel_id, id, position, kind, title, description, theme)
    values (c.id, 'cup',
            (select coalesce(max(t.position), 1) + 1 from core.tiles t where t.channel_id = c.id and t.kind <> 'countdown'),
            'cup', 'Cup', 'Turnier mit der Community: Regeln und Spielcode vom Streamer, Beitritt mit !cup join, Rangliste mit Preisgeldern.', 'cup')
    on conflict (channel_id, id) do nothing;
  end loop;
end;
$$;

-- ---------- Cup (eine Zeile je Kanal, für alle lesbar) ----------
create table if not exists core.cup (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  id int not null default 1 check (id = 1),
  title text not null default 'Community-Cup' check (char_length(title) between 1 and 60),
  rules text not null default '' check (char_length(rules) <= 450),
  prizes text[] not null default '{}' check (cardinality(prizes) <= 10),   -- Preisgeld je Platz (Index 1 = Platz 1)
  open boolean not null default false,                                     -- !cup join erlaubt
  round int not null default 1,
  players int not null default 0,
  code_sent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (channel_id, id)
);
alter table core.cup enable row level security;
drop policy if exists "cup: lesen für alle" on core.cup;
create policy "cup: lesen für alle" on core.cup for select to anon, authenticated using (true);
revoke all on core.cup from anon, authenticated;
grant select on core.cup to anon, authenticated;
select public.channel_view('cup');
revoke insert, update, delete on public.cup from anon, authenticated;
select public.realtime_add('cup');

-- Spielcode (z. B. Fortnite-Matchmaking-Schlüssel): nur für Streamer und Mods
create table if not exists core.cup_code (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  id int not null default 1 check (id = 1),
  code text not null default '' check (char_length(code) <= 60),
  primary key (channel_id, id)
);
alter table core.cup_code enable row level security;
revoke all on core.cup_code from anon, authenticated;

-- Teilnehmer: tw:<twitch-id> (per Chat) oder manual:<name> (von Hand)
create table if not exists core.cup_players (
  id bigint generated always as identity primary key,
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  player_key text not null check (player_key ~ '^(tw:\d{1,20}|manual:.{1,40})$'),
  name text not null check (char_length(name) between 1 and 40),
  points int not null default 0 check (points between -99999 and 99999),
  source text not null default 'chat' check (source in ('chat', 'mod')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, player_key)
);
create index if not exists cup_players_rank_idx on core.cup_players (channel_id, points desc, created_at);
alter table core.cup_players enable row level security;
revoke all on core.cup_players from anon, authenticated;

-- Audit-Protokoll: Einstellungen und Punkte (Änderungen von der Webseite)
do $$
begin
  if to_regprocedure('core.audit_row()') is not null then
    drop trigger if exists zz_audit on core.cup;
    create trigger zz_audit after insert or update or delete on core.cup for each row execute function core.audit_row();
    drop trigger if exists zz_audit on core.cup_code;
    create trigger zz_audit after insert or update or delete on core.cup_code for each row execute function core.audit_row();
    drop trigger if exists zz_audit on core.cup_players;
    create trigger zz_audit after insert or update or delete on core.cup_players for each row execute function core.audit_row();
  end if;
end;
$$;

-- ---------- Mod-Rechte: Cup gehört zum Bereich „Spiele & Mitmachen“ (games) ----------
create or replace function public.request_area()
returns text language sql stable set search_path = '' as $f$
  select coalesce(nullif(current_setting('app.area', true), ''), case
    when p ~ '^giveaway' then 'giveaway'
    when p ~ '^(spins?($|_)|wheel|overlay_spins)' then 'wheel'
    when p ~ '^bingo' then 'bingo'
    when p ~ '^(tiles?($|_)|ideas?($|_)|idea_votes|feature_open|games_|questions?($|_)|question_)' then 'ideas'
    when p ~ '^(quiz|shop|challenge|win_challenge|queue|cards?_|forbidden|hotword|pause|poll|counter|gamewheel|heart|cc_|chat_control|cup)' then 'games'
    when p ~ '^(send_prank|prank|sounds($|_)|tts)' then 'pranks'
    when p ~ '^pet' then 'pet'
    when p ~ '^(overlay|alert|ticker|stream_alerts|subathon|anniversary)' then 'overlay'
    when p ~ '^(bot_|chat_)' then 'chat'
    when p ~ '^stream_reward' then 'points'
    when p ~ '^site_guard' then 'guard'
  end)
  from (select lower(regexp_replace(coalesce(current_setting('request.path', true), ''), '^/(rpc/)?', '')) as p) x;
$f$;

-- ---------- Hilfen ----------
-- Zeile anlegen, falls es sie noch nicht gibt
create or replace function public.cup_row(p_ch uuid)
returns core.cup language plpgsql security definer set search_path = '' as $$
declare
  c core.cup;
begin
  insert into core.cup (channel_id, id) values (p_ch, 1) on conflict (channel_id, id) do nothing;
  select * into c from core.cup where channel_id = p_ch and id = 1;
  return c;
end;
$$;
revoke execute on function public.cup_row(uuid) from public, anon, authenticated;

-- Spielerzahl nachziehen und updated_at setzen (Realtime: die Webseite lädt dann die Rangliste neu)
create or replace function public.cup_touch(p_ch uuid)
returns void language sql security definer set search_path = '' as $$
  update core.cup set players = (select count(*) from core.cup_players p where p.channel_id = p_ch), updated_at = now()
  where channel_id = p_ch and id = 1;
$$;
revoke execute on function public.cup_touch(uuid) from public, anon, authenticated;

-- Name wie im Chat: führendes @ weg, Leerzeichen zusammenfassen, höchstens 40 Zeichen
create or replace function public.cup_clean_name(p text)
returns text language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '^\s*@+', ''), '\s+', ' ', 'g')), 40);
$$;

-- ---------- Rangliste (für alle, auch ohne Anmeldung) ----------
create or replace function public.cup_board()
returns json language sql stable security definer set search_path = '' as $$
  with ch as (select public.current_channel() as id),
  c as (select cu.* from core.cup cu, ch where cu.channel_id = ch.id and cu.id = 1),
  ranked as (
    select p.id, p.name, p.points, p.player_key,
           rank() over (order by p.points desc) as place,
           row_number() over (order by p.points desc, p.created_at, p.id) as n
    from core.cup_players p, ch where p.channel_id = ch.id
  ),
  me as (select case when auth.uid() is null then null else public.my_player_key() end as k)
  select json_build_object(
    'title', coalesce((select title from c), 'Community-Cup'),
    'rules', coalesce((select rules from c), ''),
    'prizes', coalesce((select to_json(prizes) from c), '[]'::json),
    'open', coalesce((select open from c), false),
    'round', coalesce((select round from c), 1),
    'code_sent_at', (select code_sent_at from c),
    'updated_at', (select updated_at from c),
    'count', (select count(*) from ranked),
    'players', coalesce((select json_agg(json_build_object('id', r.id, 'name', r.name, 'points', r.points, 'place', r.place) order by r.n)
                         from ranked r where r.n <= 200), '[]'::json),
    'me', (select json_build_object('id', r.id, 'place', r.place, 'points', r.points) from ranked r, me where me.k is not null and r.player_key = me.k)
  );
$$;
revoke execute on function public.cup_board() from public;
grant execute on function public.cup_board() to anon, authenticated;

-- Für Streamer und Mods: dazu der Spielcode
create or replace function public.cup_admin()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Den Spielcode sehen nur der Streamer und die Mods.'; end if;
  return json_build_object('code', coalesce((select code from core.cup_code where channel_id = public.current_channel() and id = 1), ''));
end;
$$;
revoke execute on function public.cup_admin() from public, anon;
grant execute on function public.cup_admin() to authenticated;

-- ---------- Einstellungen ----------
-- p_code: null = unverändert, '' = löschen
create or replace function public.cup_save(p_title text, p_rules text, p_prizes text[], p_open boolean, p_code text default null)
returns core.cup language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_title text := left(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), 60);
  v_rules text := btrim(regexp_replace(coalesce(p_rules, ''), '[\r\n]+', ' · ', 'g'));
  v_prizes text[];
  c core.cup;
begin
  if not public.is_admin() then raise exception 'Den Cup richten nur der Streamer und die Mods ein.'; end if;
  if v_title = '' then v_title := 'Community-Cup'; end if;
  if char_length(v_rules) > 450 then raise exception 'Die Regeln dürfen höchstens 450 Zeichen haben (der Chat schneidet sonst ab).'; end if;
  if cardinality(coalesce(p_prizes, '{}')) > 10 then raise exception 'Preisgelder gibt es für höchstens 10 Plätze.'; end if;
  -- leere Plätze am Ende weg, jeder Eintrag höchstens 40 Zeichen
  select coalesce(array_agg(left(btrim(coalesce(x, '')), 40) order by i), '{}') into v_prizes
    from unnest(coalesce(p_prizes, '{}')) with ordinality as u(x, i);
  while cardinality(v_prizes) > 0 and v_prizes[cardinality(v_prizes)] = '' loop
    v_prizes := v_prizes[1:cardinality(v_prizes) - 1];
  end loop;
  if p_code is not null and char_length(btrim(p_code)) > 60 then raise exception 'Der Spielcode darf höchstens 60 Zeichen haben.'; end if;

  perform public.cup_row(v_ch);
  update core.cup set title = v_title, rules = v_rules, prizes = v_prizes, open = coalesce(p_open, open), updated_at = now()
    where channel_id = v_ch and id = 1 returning * into c;
  if p_code is not null then
    insert into core.cup_code (channel_id, id, code) values (v_ch, 1, btrim(p_code))
      on conflict (channel_id, id) do update set code = excluded.code;
  end if;
  return c;
end;
$$;
revoke execute on function public.cup_save(text, text, text[], boolean, text) from public, anon;
grant execute on function public.cup_save(text, text, text[], boolean, text) to authenticated;

-- Beitritt per Chat an/aus (der Bot sagt Bescheid)
create or replace function public.cup_set_open(p_open boolean)
returns core.cup language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  c core.cup;
begin
  if not public.is_admin() then raise exception 'Den Beitritt öffnen und schließen nur der Streamer und die Mods.'; end if;
  perform public.cup_row(v_ch);
  update core.cup set open = coalesce(p_open, false), updated_at = now() where channel_id = v_ch and id = 1 returning * into c;
  perform public.bot_say(case when c.open
    then format('🏆 %s: Anmeldung offen! Schreib !cup join, um mitzumachen. Regeln: !cup regeln', c.title)
    else format('🏆 %s: Anmeldung geschlossen (%s dabei).', c.title, c.players) end);
  return c;
end;
$$;
revoke execute on function public.cup_set_open(boolean) from public, anon;
grant execute on function public.cup_set_open(boolean) to authenticated;

-- Regeln bzw. Spielcode per Bot in den Chat
create or replace function public.cup_announce(p_what text)
returns core.cup language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  c core.cup;
  v_code text;
begin
  if not public.is_admin() then raise exception 'Das verschicken nur der Streamer und die Mods.'; end if;
  c := public.cup_row(v_ch);
  if p_what = 'rules' then
    if c.rules = '' then raise exception 'Erst Regeln eintragen und speichern.'; end if;
    perform public.bot_say(format('📜 %s – Regeln: %s', c.title, c.rules));
  elsif p_what = 'code' then
    select code into v_code from core.cup_code where channel_id = v_ch and id = 1;
    if coalesce(v_code, '') = '' then raise exception 'Erst einen Spielcode eintragen und speichern.'; end if;
    perform public.bot_say(format('🔑 %s – Spielcode: %s', c.title, v_code));
    update core.cup set code_sent_at = now(), updated_at = now() where channel_id = v_ch and id = 1 returning * into c;
  else
    raise exception 'Unbekannt: %', p_what;
  end if;
  return c;
end;
$$;
revoke execute on function public.cup_announce(text) from public, anon;
grant execute on function public.cup_announce(text) to authenticated;

-- ---------- Spieler und Punkte (Streamer und Mods) ----------
create or replace function public.cup_add(p_name text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_name text := public.cup_clean_name(p_name);
begin
  if not public.is_admin() then raise exception 'Spieler eintragen dürfen nur der Streamer und die Mods.'; end if;
  if v_name = '' then raise exception 'Bitte einen Namen eintragen.'; end if;
  perform public.cup_row(v_ch);
  if exists (select 1 from core.cup_players where channel_id = v_ch and lower(name) = lower(v_name)) then
    raise exception '% ist schon im Cup.', v_name;
  end if;
  if (select count(*) from core.cup_players where channel_id = v_ch) >= 500 then
    raise exception 'Mehr als 500 Spieler gehen nicht.';
  end if;
  insert into core.cup_players (channel_id, player_key, name, source) values (v_ch, 'manual:' || lower(v_name), v_name, 'mod');
  perform public.cup_touch(v_ch);
  return public.cup_board();
end;
$$;
revoke execute on function public.cup_add(text) from public, anon;
grant execute on function public.cup_add(text) to authenticated;

-- Punkte ändern: p_delta (z. B. +3, -1) oder p_set (fester Wert)
create or replace function public.cup_points(p_id bigint, p_delta int default null, p_set int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  n int;
begin
  if not public.is_admin() then raise exception 'Punkte vergeben nur der Streamer und die Mods.'; end if;
  if p_delta is null and p_set is null then raise exception 'Keine Punkte angegeben.'; end if;
  update core.cup_players set
    points = greatest(-99999, least(99999, coalesce(p_set, points + p_delta))), updated_at = now()
  where channel_id = v_ch and id = p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Diesen Spieler gibt es nicht mehr.'; end if;
  perform public.cup_touch(v_ch);
  return public.cup_board();
end;
$$;
revoke execute on function public.cup_points(bigint, int, int) from public, anon;
grant execute on function public.cup_points(bigint, int, int) to authenticated;

create or replace function public.cup_remove(p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if not public.is_admin() then raise exception 'Spieler entfernen dürfen nur der Streamer und die Mods.'; end if;
  delete from core.cup_players where channel_id = v_ch and id = p_id;
  perform public.cup_touch(v_ch);
  return public.cup_board();
end;
$$;
revoke execute on function public.cup_remove(bigint) from public, anon;
grant execute on function public.cup_remove(bigint) to authenticated;

-- Neuer Cup: p_keep_players = true → alle bleiben, Punkte auf 0; sonst alle raus. Spielcode wird geleert.
create or replace function public.cup_reset(p_keep_players boolean default false)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if not public.is_admin() then raise exception 'Einen neuen Cup starten nur der Streamer und die Mods.'; end if;
  perform public.cup_row(v_ch);
  if coalesce(p_keep_players, false) then
    update core.cup_players set points = 0, updated_at = now() where channel_id = v_ch;
  else
    delete from core.cup_players where channel_id = v_ch;
  end if;
  update core.cup_code set code = '' where channel_id = v_ch and id = 1;
  update core.cup set round = round + 1, code_sent_at = null, updated_at = now() where channel_id = v_ch and id = 1;
  perform public.cup_touch(v_ch);
  return public.cup_board();
end;
$$;
revoke execute on function public.cup_reset(boolean) from public, anon;
grant execute on function public.cup_reset(boolean) to authenticated;

-- ---------- Chat (nur die Edge Function, Service-Rolle) ----------
-- !cup · !cup join · !cup regeln · !cup top · !cup platz
-- Antwort: {handled, reply?}. Infos höchstens alle 15 Sekunden (sonst flutet der Bot den Chat).
create or replace function public.cup_chat(p_user_id text, p_name text, p_badges text[], p_text text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_cmd text;
  v_arg text;
  v_key text := 'tw:' || coalesce(p_user_id, '');
  v_name text := public.cup_clean_name(p_name);
  c core.cup;
  v_top text;
  v_place bigint;
  v_points int;
  v_prize text;
  v_slot text;
  n int;
begin
  if v_ch is null or coalesce(p_user_id, '') !~ '^\d{1,20}$' then return json_build_object('handled', false); end if;
  v_cmd := lower(substring(btrim(coalesce(p_text, '')) from '^!([^\s]{1,25})'));
  if v_cmd is distinct from 'cup' then return json_build_object('handled', false); end if;
  v_arg := lower(btrim(coalesce(substring(btrim(p_text) from '^![^\s]+\s+(\S+)'), '')));
  select * into c from core.cup where channel_id = v_ch and id = 1;
  -- Ohne Cup-Kachel oder vor ihrem Starttermin: nichts tun (dann darf ein eigener Befehl !cup antworten)
  if not public.tile_started('cup') then return json_build_object('handled', false); end if;
  if c.channel_id is null then c := public.cup_row(v_ch); end if;

  if v_arg in ('join', 'beitreten', 'mitmachen', 'dabei') then
    if public.viewer_paused() then return json_build_object('handled', true); end if;
    if not c.open then
      return json_build_object('handled', true, 'reply', format('@%s Die Anmeldung für %s ist gerade geschlossen.', v_name, c.title));
    end if;
    if v_name = '' then v_name := 'Zuschauer'; end if;
    -- Von Hand unter demselben Namen eingetragen? Dann ist er schon dabei
    if exists (select 1 from core.cup_players where channel_id = v_ch and (player_key = v_key or lower(name) = lower(v_name))) then
      return json_build_object('handled', true);
    end if;
    if (select count(*) from core.cup_players where channel_id = v_ch) >= 500 then
      return json_build_object('handled', true, 'reply', format('@%s Der Cup ist voll.', v_name));
    end if;
    insert into core.cup_players (channel_id, player_key, name, source) values (v_ch, v_key, v_name, 'chat')
      on conflict (channel_id, player_key) do nothing;
    get diagnostics n = row_count;
    if n = 0 then return json_build_object('handled', true); end if;
    perform public.cup_touch(v_ch);
    return json_build_object('handled', true, 'reply',
      format('✅ %s ist im %s! (%s dabei)', v_name, c.title, (select count(*) from core.cup_players where channel_id = v_ch)));
  end if;

  -- Infos: Abklingzeit je Befehl für alle, „!cup platz“ je Zuschauer (feste Schlüssel – beliebige Zusätze
  -- wie „!cup xyz“ zählen als „!cup“, sonst ließe sich die Bremse umgehen)
  v_slot := case
    when v_arg in ('regeln', 'rules', 'regel') then 'cup:rules'
    when v_arg in ('top', 'rangliste', 'ranking', 'tabelle') then 'cup:top'
    when v_arg in ('platz', 'rang', 'rank', 'punkte', 'me', 'ich') then 'cup:me:' || p_user_id
    else 'cup:info' end;
  if exists (select 1 from core.chat_cooldowns where channel_id = v_ch and slot = v_slot
             and at > now() - case when v_slot like 'cup:me:%' then interval '30 seconds' else interval '15 seconds' end) then
    return json_build_object('handled', true);
  end if;
  insert into core.chat_cooldowns (channel_id, slot, at) values (v_ch, v_slot, now())
    on conflict (channel_id, slot) do update set at = now();

  if v_arg in ('regeln', 'rules', 'regel') then
    return json_build_object('handled', true, 'reply',
      case when c.rules = '' then format('📜 Für %s stehen noch keine Regeln fest.', c.title) else format('📜 %s – Regeln: %s', c.title, c.rules) end);
  end if;

  if v_arg in ('top', 'rangliste', 'ranking', 'tabelle') then
    select string_agg(format('%s. %s (%s)', r.place, r.name, r.points), ' · ' order by r.n) into v_top
    from (select name, points, rank() over (order by points desc) as place,
                 row_number() over (order by points desc, created_at, id) as n
          from core.cup_players where channel_id = v_ch) r where r.n <= 5;
    return json_build_object('handled', true, 'reply',
      case when v_top is null then format('🏆 %s: Noch niemand dabei – !cup join', c.title) else format('🏆 %s – Top 5: %s', c.title, v_top) end);
  end if;

  if v_arg in ('platz', 'rang', 'rank', 'punkte', 'me', 'ich') then
    select r.place, r.points into v_place, v_points
    from (select player_key, points, rank() over (order by points desc) as place from core.cup_players where channel_id = v_ch) r
    where r.player_key = v_key;
    if v_place is null then
      return json_build_object('handled', true, 'reply', format('@%s Du bist (noch) nicht im Cup%s', v_name, case when c.open then ' – schreib !cup join' else '.' end));
    end if;
    v_prize := case when v_points > 0 then c.prizes[v_place] end;  -- mit 0 Punkten kein Preisplatz
    return json_build_object('handled', true, 'reply',
      format('@%s Platz %s mit %s Punkten%s', v_name, v_place, v_points, case when coalesce(v_prize, '') <> '' then format(' (Preisgeld: %s)', v_prize) else '' end));
  end if;

  -- !cup allein (oder unbekannt): kurz erklären
  return json_build_object('handled', true, 'reply', format('🏆 %s · %s dabei · %s · Regeln: !cup regeln · Rangliste: !cup top%s',
    c.title, (select count(*) from core.cup_players where channel_id = v_ch),
    case when c.open then 'Mitmachen: !cup join' else 'Anmeldung geschlossen' end,
    case when cardinality(c.prizes) > 0 and coalesce(c.prizes[1], '') <> '' then format(' · 1. Platz: %s', c.prizes[1]) else '' end));
end;
$$;
revoke execute on function public.cup_chat(text, text, text[], text) from public, anon, authenticated;
grant execute on function public.cup_chat(text, text, text[], text) to service_role;

notify pgrst, 'reload schema';
