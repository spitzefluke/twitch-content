-- ============================================================
-- StreamHelp: Game-Pakete – Zähler, Spiel-Rad, Herzfrequenz
--   · Zähler (core.counters): Tode, Kills, Versuche, Jumpscares … – bis zu 12 je Kanal, mit
--     Chat-Befehl („!tode“ zeigt den Stand, Mods und Streamer zählen mit „!tode +“, „!tode -2“, „!tode =5“).
--   · Spiel-Rad (core.gamewheel): dreht zwischen den aktiven Games („Was spielen wir als Nächstes?“) oder
--     eine Challenge passend zum Game. Das Ergebnis lost die Datenbank aus; Overlay und Bot zeigen es.
--     „Automatisch wechseln“ stellt das gewonnene Game im Dashboard ein.
--   · Herzfrequenz (core.heart_rate): Der Streamer verbindet im Dashboard einen Pulsgurt oder eine Uhr
--     per Bluetooth; die Seite schickt alle paar Sekunden den Puls. Gespeichert wird nur der letzte Wert und
--     Min/Max/Durchschnitt der laufenden Sitzung. „!puls“ im Chat nennt den Wert.
-- Die Vorlagen je Game (Minecraft, Speedrun, Just Chatting, Horror, Fortnite) stehen in js/games.js.
-- Braucht 20261105000000_polls.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.polls') is null then
    raise exception 'Erst die Migration 20261105000000_polls.sql ausführen.';
  end if;
end;
$$;

-- ---------- Kacheln ----------
alter table core.tiles drop constraint if exists tiles_kind_check;
alter table core.tiles add constraint tiles_kind_check
  check (kind in ('wheel', 'countdown', 'prank', 'bingo', 'questions', 'pet', 'shop', 'challenge',
                  'forbidden', 'subathon', 'pause', 'quiz', 'queue', 'tts', 'cards', 'giveaway', 'hotwords', 'poll',
                  'counter', 'gamewheel', 'heart'));

do $$
declare
  c record;
  t record;
begin
  for c in select ch.id from public.channels ch where exists (select 1 from core.tiles x where x.channel_id = ch.id) loop
    for t in
      select * from (values
        ('counter', 'Zähler', 'Tode, Kills, Versuche, Jumpscares – live im Stream. Mods zählen im Chat mit !tode +.', 1),
        ('gamewheel', 'Spiel-Rad', 'Das Rad entscheidet: Welches Game kommt als Nächstes – oder welche Challenge gilt jetzt?', 2),
        ('heart', 'Herzfrequenz', 'Wie sehr schwitzt der Streamer? Der Puls live im Stream – perfekt für Horror-Games.', 3)
      ) v(kind, title, description, n)
      order by n
    loop
      continue when exists (select 1 from core.tiles x where x.channel_id = c.id and x.kind = t.kind);
      update core.tiles set position = position + 1 where channel_id = c.id and kind = 'countdown';
      insert into core.tiles (channel_id, id, position, kind, title, description, theme)
      values (c.id, t.kind,
              (select coalesce(max(x.position), 1) + 1 from core.tiles x where x.channel_id = c.id and x.kind <> 'countdown'),
              t.kind, t.title, t.description, t.kind)
      on conflict (channel_id, id) do nothing;
    end loop;
  end loop;
end;
$$;

-- ---------- Zähler ----------
create table if not exists core.counters (
  id bigint generated always as identity primary key,
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 24),
  emoji text not null default '🔢' check (char_length(emoji) between 1 and 8),
  command text check (command ~ '^[a-z0-9äöüß]{2,20}$'),   -- ohne „!“; null = kein Chat-Befehl
  value int not null default 0 check (value between -999999 and 999999),
  game text not null default '' check (char_length(game) <= 40),
  show boolean not null default true,                      -- im Overlay und Panel
  position int not null default 0,
  last_delta int not null default 0,
  last_by text not null default '' check (char_length(last_by) <= 40),
  updated_at timestamptz not null default now()
);
create unique index if not exists counters_command_key on core.counters (channel_id, command) where command is not null;
create index if not exists counters_channel_idx on core.counters (channel_id, position);
alter table core.counters enable row level security;
drop policy if exists "counters: lesen für alle" on core.counters;
create policy "counters: lesen für alle" on core.counters for select to anon, authenticated using (true);
revoke all on core.counters from anon, authenticated;
grant select on core.counters to anon, authenticated;
select public.channel_view('counters');
select public.realtime_add('counters');

create or replace function public.counter_save(p_id bigint, p_label text, p_emoji text, p_command text, p_show boolean default true, p_game text default '')
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_cmd text := nullif(lower(btrim(regexp_replace(coalesce(p_command, ''), '^!+', ''))), '');
  r core.counters;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Zähler einstellen dürfen nur der Streamer und die Mods.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_label, ''))) not between 1 and 24 then raise exception 'Der Name braucht 1 bis 24 Zeichen.'; end if;
  if v_cmd is not null and v_cmd !~ '^[a-z0-9äöüß]{2,20}$' then
    raise exception 'Der Chat-Befehl darf nur Buchstaben und Zahlen haben (2–20 Zeichen), z. B. tode.';
  end if;
  if v_cmd in ('vote', 'abstimmen', 'puls', 'herz', 'bpm', 'watchtime', 'befehle', 'sounds', 'change', 'join', 'leave', 'rate', 'erwischt') then
    raise exception 'Den Befehl !% gibt es schon für etwas anderes.', v_cmd;
  end if;
  if exists (select 1 from core.counters where channel_id = v_ch and command = v_cmd and id is distinct from p_id) then
    raise exception 'Den Befehl !% hat schon ein anderer Zähler.', v_cmd;
  end if;
  if p_id is null then
    if (select count(*) from core.counters where channel_id = v_ch) >= 12 then raise exception 'Höchstens 12 Zähler.'; end if;
    insert into core.counters (channel_id, label, emoji, command, show, game, position)
      values (v_ch, btrim(p_label), coalesce(nullif(btrim(p_emoji), ''), '🔢'), v_cmd, coalesce(p_show, true), left(coalesce(p_game, ''), 40),
              (select coalesce(max(position), 0) + 1 from core.counters where channel_id = v_ch))
    returning * into r;
  else
    update core.counters set label = btrim(p_label), emoji = coalesce(nullif(btrim(p_emoji), ''), '🔢'), command = v_cmd,
           show = coalesce(p_show, true), updated_at = now()
     where channel_id = v_ch and id = p_id
    returning * into r;
    if not found then raise exception 'Diesen Zähler gibt es nicht.'; end if;
  end if;
  return row_to_json(r);
end;
$$;
revoke execute on function public.counter_save(bigint, text, text, text, boolean, text) from public, anon;
grant execute on function public.counter_save(bigint, text, text, text, boolean, text) to authenticated;

-- Zählen: p_delta (+1, -1 …) oder p_set (fester Wert). Intern auch für den Chat (p_by = Name).
create or replace function public.counter_change(p_ch uuid, p_id bigint, p_delta int, p_set int, p_by text)
returns core.counters language plpgsql security definer set search_path = '' as $$
declare
  r core.counters;
begin
  update core.counters set
    value = least(999999, greatest(-999999, case when p_set is not null then p_set else value + coalesce(p_delta, 0) end)),
    last_delta = case when p_set is not null then p_set - value else coalesce(p_delta, 0) end,
    last_by = left(coalesce(p_by, ''), 40), updated_at = now()
  where channel_id = p_ch and id = p_id
  returning * into r;
  return r;
end;
$$;
revoke execute on function public.counter_change(uuid, bigint, int, int, text) from public, anon, authenticated;

create or replace function public.counter_add(p_id bigint, p_delta int default 1, p_set int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  r core.counters;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Zählen dürfen nur der Streamer und die Mods.' using errcode = '42501';
  end if;
  if p_set is null and (p_delta is null or abs(p_delta) > 1000) then raise exception 'Bitte um 1 bis 1000 ändern.'; end if;
  r := public.counter_change(v_ch, p_id, p_delta, p_set, public.my_name());
  if r.id is null then raise exception 'Diesen Zähler gibt es nicht.'; end if;
  return row_to_json(r);
end;
$$;
revoke execute on function public.counter_add(bigint, int, int) from public, anon;
grant execute on function public.counter_add(bigint, int, int) to authenticated;

create or replace function public.counter_delete(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_channel() is null or not public.is_admin() then
    raise exception 'Zähler löschen dürfen nur der Streamer und die Mods.' using errcode = '42501';
  end if;
  delete from core.counters where channel_id = public.current_channel() and id = p_id;
end;
$$;
revoke execute on function public.counter_delete(bigint) from public, anon;
grant execute on function public.counter_delete(bigint) to authenticated;

-- Reihenfolge (Liste von IDs)
create or replace function public.counter_order(p_ids bigint[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_channel() is null or not public.is_admin() then
    raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501';
  end if;
  update core.counters c set position = o.i
    from unnest(coalesce(p_ids, '{}')) with ordinality as o(id, i)
   where c.channel_id = public.current_channel() and c.id = o.id;
end;
$$;
revoke execute on function public.counter_order(bigint[]) from public, anon;
grant execute on function public.counter_order(bigint[]) to authenticated;

-- ---------- Spiel-Rad ----------
create table if not exists core.gamewheel (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  id int not null default 1 check (id = 1),
  challenges jsonb not null default '{}'::jsonb check (jsonb_typeof(challenges) = 'object'),  -- {game: [text, …]} – fehlt ein Game, gilt die Vorlage
  auto_switch boolean not null default true,     -- gewonnenes Game im Dashboard einstellen
  n int not null default 0,                      -- Zähler der Drehungen (Overlay merkt neue)
  mode text not null default 'game' check (mode in ('game', 'challenge')),
  game text not null default '' check (char_length(game) <= 40),
  options text[] not null default '{}' check (cardinality(options) <= 16),
  result_index int,
  result text not null default '' check (char_length(result) <= 80),
  spun_by text not null default '',
  spun_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (channel_id, id)
);
alter table core.gamewheel enable row level security;
drop policy if exists "gamewheel: lesen für alle" on core.gamewheel;
create policy "gamewheel: lesen für alle" on core.gamewheel for select to anon, authenticated using (true);
revoke all on core.gamewheel from anon, authenticated;
grant select on core.gamewheel to anon, authenticated;
select public.channel_view('gamewheel');
select public.realtime_add('gamewheel');

-- Drehen: p_options sind die Felder (Game-Namen oder Challenges, 2–16), p_ids die Game-IDs dazu (nur bei mode = game).
-- Das Ergebnis lost die Datenbank aus.
create or replace function public.gamewheel_spin(p_mode text, p_options text[], p_ids text[] default null, p_game text default '')
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_mode text := case when p_mode = 'challenge' then 'challenge' else 'game' end;
  v_opts text[];
  v_i int;
  r core.gamewheel;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Das Spiel-Rad drehen dürfen nur der Streamer und die Mods.' using errcode = '42501';
  end if;
  select coalesce(array_agg(left(btrim(o), 80) order by i), '{}') into v_opts
    from unnest(coalesce(p_options, '{}')) with ordinality as u(o, i) where btrim(coalesce(o, '')) <> '';
  if cardinality(v_opts) < 2 or cardinality(v_opts) > 16 then raise exception 'Das Rad braucht 2 bis 16 Felder.'; end if;
  v_i := floor(random() * cardinality(v_opts))::int + 1;
  insert into core.gamewheel (channel_id, id) values (v_ch, 1) on conflict (channel_id, id) do nothing;
  update core.gamewheel set n = n + 1, mode = v_mode, game = left(coalesce(p_game, ''), 40), options = v_opts,
         result_index = v_i - 1, result = v_opts[v_i], spun_by = public.my_name(), spun_at = now(), updated_at = now()
   where channel_id = v_ch and id = 1
  returning * into r;
  -- Game gewonnen: im Dashboard einstellen (Bot verkündet es mit kurzer Verzögerung – erst dreht das Rad)
  if v_mode = 'game' and r.auto_switch and p_ids is not null and cardinality(p_ids) = cardinality(v_opts)
     and p_ids[v_i] ~ '^[a-z0-9-]{1,40}$' then
    insert into core.stream_games (channel_id, id) values (v_ch, 1) on conflict (channel_id, id) do nothing;
    update core.stream_games set current = p_ids[v_i],
           active = case when p_ids[v_i] = any(active) then active else active || p_ids[v_i] end,
           updated_at = now()
     where channel_id = v_ch and id = 1;
  end if;
  insert into core.bot_outbox (channel_id, text) values (v_ch, left(case v_mode
    when 'game' then format('🎡 Das Spiel-Rad hat entschieden: %s!', r.result)
    else format('🎡 Challenge: %s', r.result) end, 500));
  return row_to_json(r);
end;
$$;
revoke execute on function public.gamewheel_spin(text, text[], text[], text) from public, anon;
grant execute on function public.gamewheel_spin(text, text[], text[], text) to authenticated;

-- Eigene Challenges je Game (leere Liste = Vorlage aus js/games.js) und „automatisch wechseln“
create or replace function public.gamewheel_save(p_game text, p_challenges text[], p_auto boolean default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_list jsonb;
  r core.gamewheel;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501';
  end if;
  insert into core.gamewheel (channel_id, id) values (v_ch, 1) on conflict (channel_id, id) do nothing;
  if p_game is not null then
    if p_game !~ '^[a-z0-9-]{1,40}$' then raise exception 'Unbekanntes Game.'; end if;
    select coalesce(jsonb_agg(left(btrim(x), 80) order by i), '[]'::jsonb) into v_list
      from unnest(coalesce(p_challenges, '{}')) with ordinality as u(x, i) where btrim(coalesce(x, '')) <> '';
    if jsonb_array_length(v_list) > 16 then raise exception 'Höchstens 16 Challenges je Game.'; end if;
    if jsonb_array_length(v_list) = 1 then raise exception 'Mindestens 2 Challenges (oder keine für die Vorlage).'; end if;
    update core.gamewheel set
      challenges = case when jsonb_array_length(v_list) = 0 then challenges - p_game else jsonb_set(challenges, array[p_game], v_list) end,
      updated_at = now()
    where channel_id = v_ch and id = 1;
  end if;
  if p_auto is not null then
    update core.gamewheel set auto_switch = p_auto, updated_at = now() where channel_id = v_ch and id = 1;
  end if;
  select * into r from core.gamewheel where channel_id = v_ch and id = 1;
  return row_to_json(r);
end;
$$;
revoke execute on function public.gamewheel_save(text, text[], boolean) from public, anon;
grant execute on function public.gamewheel_save(text, text[], boolean) to authenticated;

-- ---------- Herzfrequenz ----------
create table if not exists core.heart_rate (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  id int not null default 1 check (id = 1),
  bpm int check (bpm between 25 and 250),
  at timestamptz,                                -- letzter Wert
  alarm int not null default 140 check (alarm between 60 and 220),   -- ab hier wird das Herz im Overlay rot
  session_at timestamptz,                        -- Beginn der Sitzung (nach 10 Minuten Pause neu)
  s_min int, s_max int, s_sum bigint not null default 0, s_n int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (channel_id, id)
);
alter table core.heart_rate enable row level security;
drop policy if exists "heart_rate: lesen für alle" on core.heart_rate;
create policy "heart_rate: lesen für alle" on core.heart_rate for select to anon, authenticated using (true);
revoke all on core.heart_rate from anon, authenticated;
grant select on core.heart_rate to anon, authenticated;
select public.channel_view('heart_rate');
select public.realtime_add('heart_rate');

-- Puls vom Dashboard (Bluetooth). Häufiger als alle 2 Sekunden wird nichts gespeichert.
create or replace function public.heart_push(p_bpm int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  h core.heart_rate;
  v_new boolean;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Den Puls schickt nur der Streamer.' using errcode = '42501';
  end if;
  if p_bpm is null or p_bpm < 25 or p_bpm > 250 then raise exception 'Unplausibler Puls: %', p_bpm; end if;
  insert into core.heart_rate (channel_id, id) values (v_ch, 1) on conflict (channel_id, id) do nothing;
  select * into h from core.heart_rate where channel_id = v_ch and id = 1 for update;
  if h.at is not null and h.at > now() - interval '2 seconds' then
    return json_build_object('ok', false, 'reason', 'fast');
  end if;
  v_new := h.at is null or h.at < now() - interval '10 minutes';
  update core.heart_rate set
    bpm = p_bpm, at = now(),
    session_at = case when v_new then now() else session_at end,
    s_min = case when v_new then p_bpm else least(s_min, p_bpm) end,
    s_max = case when v_new then p_bpm else greatest(s_max, p_bpm) end,
    s_sum = case when v_new then p_bpm else s_sum + p_bpm end,
    s_n = case when v_new then 1 else s_n + 1 end,
    updated_at = now()
  where channel_id = v_ch and id = 1;
  return json_build_object('ok', true);
end;
$$;
revoke execute on function public.heart_push(int) from public, anon;
grant execute on function public.heart_push(int) to authenticated;

-- Einstellungen und „Sitzung beenden“ (p_stop: Puls ausblenden, Werte bleiben bis zur nächsten Sitzung)
create or replace function public.heart_settings(p_alarm int default null, p_stop boolean default false)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  h core.heart_rate;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501';
  end if;
  if p_alarm is not null and (p_alarm < 60 or p_alarm > 220) then raise exception 'Die Warnschwelle kann 60 bis 220 sein.'; end if;
  insert into core.heart_rate (channel_id, id) values (v_ch, 1) on conflict (channel_id, id) do nothing;
  update core.heart_rate set alarm = coalesce(p_alarm, alarm),
         at = case when p_stop then null else at end, bpm = case when p_stop then null else bpm end, updated_at = now()
   where channel_id = v_ch and id = 1
  returning * into h;
  return row_to_json(h);
end;
$$;
revoke execute on function public.heart_settings(int, boolean) from public, anon;
grant execute on function public.heart_settings(int, boolean) to authenticated;

-- ---------- Chat: Zähler und !puls ----------
-- Edge Function (Service-Rolle), vor chat_command. Antwort: {handled, reply}
--   !tode        → „💀 Tode: 12“ (für alle, je Zähler höchstens alle 10 Sekunden)
--   !tode +      → zählt (nur Mods und Streamer; „+3“, „-1“, „=5“ gehen auch)
--   !puls/!herz  → „❤️ 96 bpm“ (alle 15 Sekunden)
create or replace function public.game_chat(p_user_id text, p_name text, p_badges text[], p_text text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_cmd text;
  v_arg text;
  v_mod boolean := coalesce(p_badges && array['moderator', 'broadcaster'], false);
  c core.counters;
  h core.heart_rate;
  m text[];
  v_delta int;
  v_set int;
  v_slot text;
begin
  if v_ch is null then return json_build_object('handled', false); end if;
  v_cmd := lower(substring(btrim(coalesce(p_text, '')) from '^!([^\s]{1,25})'));
  v_arg := btrim(coalesce(substring(btrim(p_text) from '^![^\s]+\s+(.*)$'), ''));
  if v_cmd is null then return json_build_object('handled', false); end if;

  if v_cmd in ('puls', 'herz', 'bpm') then
    select * into h from core.heart_rate where channel_id = v_ch and id = 1;
    if not found then return json_build_object('handled', false); end if;
    v_slot := 'heart';
    if exists (select 1 from core.chat_cooldowns where channel_id = v_ch and slot = v_slot and at > now() - interval '15 seconds') then
      return json_build_object('handled', true);
    end if;
    insert into core.chat_cooldowns (channel_id, slot, at) values (v_ch, v_slot, now())
      on conflict (channel_id, slot) do update set at = now();
    if h.at is null or h.at < now() - interval '30 seconds' then
      return json_build_object('handled', true, 'reply', '❤️ Gerade kommt kein Puls an.');
    end if;
    return json_build_object('handled', true, 'reply', format('❤️ %s bpm%s', h.bpm,
      case when h.s_n > 5 then format(' · heute max. %s, Ø %s', h.s_max, round(h.s_sum::numeric / h.s_n)) else '' end));
  end if;

  select * into c from core.counters where channel_id = v_ch and command = v_cmd;
  if not found then return json_build_object('handled', false); end if;

  m := regexp_match(v_arg, '^([+-])\s*(\d{0,4})$');
  if m is not null then v_delta := (case when m[1] = '-' then -1 else 1 end) * coalesce(nullif(m[2], '')::int, 1); end if;
  m := regexp_match(v_arg, '^=\s*(-?\d{1,6})$');
  if m is not null then v_set := m[1]::int; end if;

  -- Zählen: Mods und Streamer – außer der Streamer hat dem Mod die Mitmach-Spiele gesperrt
  if (v_delta is not null or v_set is not null) and v_mod
     and not exists (select 1 from core.mod_rights r where r.channel_id = v_ch and r.twitch_user_id = p_user_id and 'games' = any(r.denied)) then
    c := public.counter_change(v_ch, c.id, v_delta, v_set, left(coalesce(p_name, ''), 40));
    return json_build_object('handled', true, 'reply', format('%s %s: %s', c.emoji, c.label, c.value));
  end if;

  v_slot := 'counter:' || c.id;
  if exists (select 1 from core.chat_cooldowns where channel_id = v_ch and slot = v_slot and at > now() - interval '10 seconds') then
    return json_build_object('handled', true);
  end if;
  insert into core.chat_cooldowns (channel_id, slot, at) values (v_ch, v_slot, now())
    on conflict (channel_id, slot) do update set at = now();
  return json_build_object('handled', true, 'reply', format('%s %s: %s', c.emoji, c.label, c.value));
end;
$$;
revoke execute on function public.game_chat(text, text, text[], text) from public, anon, authenticated;

-- ---------- Mod-Rechte: Zähler, Spiel-Rad und Puls gehören zu den Mitmach-Spielen ----------
create or replace function public.request_area()
returns text language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('app.area', true), ''), case
    when p ~ '^giveaway' then 'giveaway'
    when p ~ '^(spins?($|_)|wheel|overlay_spins)' then 'wheel'
    when p ~ '^bingo' then 'bingo'
    when p ~ '^(tiles?($|_)|ideas?($|_)|idea_votes|feature_open|games_|questions?($|_)|question_)' then 'ideas'
    when p ~ '^(quiz|shop|challenge|win_challenge|queue|cards?_|forbidden|hotword|pause|poll|counter|gamewheel|heart)' then 'games'
    when p ~ '^(send_prank|prank|sounds($|_)|tts)' then 'pranks'
    when p ~ '^pet' then 'pet'
    when p ~ '^(overlay|alert|ticker|stream_alerts|subathon|anniversary)' then 'overlay'
    when p ~ '^(bot_|chat_)' then 'chat'
    when p ~ '^stream_reward' then 'points'
    when p ~ '^site_guard' then 'guard'
  end)
  from (select lower(regexp_replace(coalesce(current_setting('request.path', true), ''), '^/(rpc/)?', '')) as p) x;
$$;

notify pgrst, 'reload schema';
