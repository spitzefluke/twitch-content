-- ============================================================
-- StreamHelp: Chat-Kommandos – der Chat steuert das Spiel
--   · Der Streamer legt Kommandos an: Wort (z. B. „springen“), was zu tun ist („Spring!“), Symbol,
--     Abklingzeit, optional Kanalpunkte-Kosten (eigene Belohnung bei Twitch) und ob der Chat-Befehl
--     kostenlos geht. Vorlagen je Game stehen in js/games.js (PACKS → commands).
--   · Zuschauer tippen „!springen“ oder lösen die Belohnung ein. Das OBS-Overlay (Ebene „Chat-Kommandos“)
--     zeigt groß, was der Streamer tun muss – er führt es selbst im Spiel aus.
--   · Modus „direkt“: jedes Kommando kommt sofort (Abklingzeit je Zuschauer und je Kommando).
--     Modus „abstimmen“: Der erste Befehl startet eine Runde (10–120 s), am Ende gewinnt der häufigste.
--     Kanalpunkte-Einlösungen kommen in beiden Modi sofort.
-- Braucht 20261106000000_game_packs.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.counters') is null then
    raise exception 'Erst die Migration 20261106000000_game_packs.sql ausführen.';
  end if;
end;
$$;

-- ---------- Kachel ----------
alter table core.tiles drop constraint if exists tiles_kind_check;
alter table core.tiles add constraint tiles_kind_check
  check (kind in ('wheel', 'countdown', 'prank', 'bingo', 'questions', 'pet', 'shop', 'challenge',
                  'forbidden', 'subathon', 'pause', 'quiz', 'queue', 'tts', 'cards', 'giveaway', 'hotwords', 'poll',
                  'counter', 'gamewheel', 'heart', 'chatcontrol'));

do $$
declare
  c record;
begin
  for c in
    select ch.id from public.channels ch
    where exists (select 1 from core.tiles t where t.channel_id = ch.id)
      and not exists (select 1 from core.tiles t where t.channel_id = ch.id and t.kind = 'chatcontrol')
  loop
    update core.tiles set position = position + 1 where channel_id = c.id and kind = 'countdown';
    insert into core.tiles (channel_id, id, position, kind, title, description, theme)
    values (c.id, 'chatcontrol',
            (select coalesce(max(t.position), 1) + 1 from core.tiles t where t.channel_id = c.id and t.kind <> 'countdown'),
            'chatcontrol', 'Chat-Kommandos', 'Der Chat steuert das Spiel: !springen, !links, !nachladen – der Streamer muss gehorchen.', 'chatcontrol')
    on conflict (channel_id, id) do nothing;
  end loop;
end;
$$;

-- ---------- Einstellungen und Abstimm-Runde (eine Zeile je Kanal, für alle lesbar) ----------
create table if not exists core.chat_control (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  id int not null default 1 check (id = 1),
  enabled boolean not null default true,
  mode text not null default 'direct' check (mode in ('direct', 'vote')),
  vote_seconds int not null default 30 check (vote_seconds between 10 and 120),
  user_cooldown int not null default 20 check (user_cooldown between 0 and 600),   -- Sekunden je Zuschauer
  show_seconds int not null default 6 check (show_seconds between 2 and 30),       -- so lange steht ein Kommando im Overlay
  round int not null default 0,
  round_ends_at timestamptz,                    -- null: gerade keine Abstimm-Runde
  tally jsonb not null default '{}'::jsonb,     -- {"<command_id>": Stimmen}
  voters int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (channel_id, id)
);
alter table core.chat_control enable row level security;
drop policy if exists "chat_control: lesen für alle" on core.chat_control;
create policy "chat_control: lesen für alle" on core.chat_control for select to anon, authenticated using (true);
revoke all on core.chat_control from anon, authenticated;
grant select on core.chat_control to anon, authenticated;
select public.channel_view('chat_control');
select public.realtime_add('chat_control');

-- ---------- Kommandos ----------
create table if not exists core.cc_commands (
  id bigint generated always as identity primary key,
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  word text not null check (word ~ '^[a-z0-9äöüß]{2,20}$'),      -- ohne „!“
  label text not null check (char_length(btrim(label)) between 1 and 40),   -- was der Streamer tun muss
  emoji text not null default '🎮' check (char_length(emoji) between 1 and 8),
  cooldown int not null default 15 check (cooldown between 0 and 3600),     -- Sekunden je Kommando (für alle)
  chat boolean not null default true,           -- per Chat-Befehl (kostenlos) auslösbar
  cost int not null default 0 check (cost = 0 or cost between 1 and 1000000), -- Kanalpunkte (0 = keine Belohnung)
  reward_id text,                               -- Belohnung bei Twitch (legt stream-tools → cc_sync an)
  reward_error text not null default '',
  enabled boolean not null default true,
  game text not null default '' check (char_length(game) <= 40),
  position int not null default 0,
  uses int not null default 0,
  last_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists cc_commands_word_key on core.cc_commands (channel_id, word);
create index if not exists cc_commands_channel_idx on core.cc_commands (channel_id, position);
alter table core.cc_commands enable row level security;
drop policy if exists "cc_commands: lesen für alle" on core.cc_commands;
create policy "cc_commands: lesen für alle" on core.cc_commands for select to anon, authenticated using (true);
revoke all on core.cc_commands from anon, authenticated;
grant select on core.cc_commands to anon, authenticated;
select public.channel_view('cc_commands');
select public.realtime_add('cc_commands');

-- Ausgelöste Kommandos (das Overlay zeigt neue an). Die letzten 200 je Kanal, höchstens 2 Tage.
create table if not exists core.cc_events (
  id bigint generated always as identity primary key,
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  command_id bigint references core.cc_commands (id) on delete set null,
  word text not null,
  label text not null,
  emoji text not null,
  who text not null default '' check (char_length(who) <= 40),
  source text not null check (source in ('chat', 'points', 'vote', 'web')),
  votes int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cc_events_channel_idx on core.cc_events (channel_id, id desc);
alter table core.cc_events enable row level security;
drop policy if exists "cc_events: lesen für alle" on core.cc_events;
create policy "cc_events: lesen für alle" on core.cc_events for select to anon, authenticated using (true);
revoke all on core.cc_events from anon, authenticated;
grant select on core.cc_events to anon, authenticated;
select public.channel_view('cc_events');
select public.realtime_add('cc_events');

-- Stimmen der laufenden Runde (nur über Funktionen)
create table if not exists core.cc_votes (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  round int not null,
  voter text not null check (char_length(voter) between 1 and 60),
  command_id bigint not null,
  primary key (channel_id, round, voter)
);
alter table core.cc_votes enable row level security;
revoke all on core.cc_votes from anon, authenticated;

-- ---------- Intern ----------
create or replace function public.cc_fire(p_ch uuid, p_cmd core.cc_commands, p_who text, p_source text, p_votes int default 0)
returns core.cc_events language plpgsql security definer set search_path = '' as $$
declare
  e core.cc_events;
begin
  insert into core.cc_events (channel_id, command_id, word, label, emoji, who, source, votes)
    values (p_ch, p_cmd.id, p_cmd.word, p_cmd.label, p_cmd.emoji, left(coalesce(p_who, ''), 40), p_source, coalesce(p_votes, 0))
  returning * into e;
  update core.cc_commands set uses = uses + 1, last_at = now() where id = p_cmd.id;
  delete from core.cc_events where channel_id = p_ch and (created_at < now() - interval '2 days' or id <= e.id - 200);
  return e;
end;
$$;
revoke execute on function public.cc_fire(uuid, core.cc_commands, text, text, int) from public, anon, authenticated;

-- Abstimm-Runde beenden, wenn die Zeit um ist: der häufigste Befehl gewinnt (Gleichstand: Zufall)
create or replace function public.cc_finish_round(p_ch uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s core.chat_control;
  v_win bigint;
  v_votes int;
  c core.cc_commands;
begin
  select * into s from core.chat_control where channel_id = p_ch and id = 1 for update;
  if not found or s.round_ends_at is null or s.round_ends_at > now() then return; end if;
  select (k)::bigint, (v)::int into v_win, v_votes
    from jsonb_each_text(s.tally) as t(k, v)
   order by (v)::int desc, random() limit 1;
  update core.chat_control set round_ends_at = null, tally = '{}'::jsonb, voters = 0, updated_at = now()
   where channel_id = p_ch and id = 1;
  delete from core.cc_votes where channel_id = p_ch and round <= s.round;
  if v_win is null then return; end if;
  select * into c from core.cc_commands where channel_id = p_ch and id = v_win;
  if found then perform public.cc_fire(p_ch, c, 'Chat', 'vote', v_votes); end if;
end;
$$;
revoke execute on function public.cc_finish_round(uuid) from public, anon, authenticated;

-- Chat-Befehl (aus game_chat). Der Bot antwortet nicht – sonst flutet er den Chat; das Overlay zeigt es.
create or replace function public.cc_chat(p_ch uuid, p_user_id text, p_name text, p_word text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  s core.chat_control;
  c core.cc_commands;
  v_old bigint;
  v_slot text := 'ccu:' || left(coalesce(p_user_id, ''), 40);
begin
  select * into c from core.cc_commands where channel_id = p_ch and word = p_word;
  if not found then return json_build_object('handled', false); end if;
  insert into core.chat_control (channel_id, id) values (p_ch, 1) on conflict (channel_id, id) do nothing;
  select * into s from core.chat_control where channel_id = p_ch and id = 1;
  -- Kommando gehört uns: auch wenn es gerade nicht geht, nicht an eigene Befehle weiterreichen
  if not s.enabled or not c.enabled or not c.chat or public.viewer_paused()
     or not public.tile_started('chatcontrol') then
    return json_build_object('handled', true);
  end if;

  if s.mode = 'direct' then
    if c.last_at is not null and c.last_at > now() - make_interval(secs => c.cooldown) then
      return json_build_object('handled', true, 'reason', 'cooldown');
    end if;
    if s.user_cooldown > 0 and exists (select 1 from core.chat_cooldowns where channel_id = p_ch and slot = v_slot
                                        and at > now() - make_interval(secs => s.user_cooldown)) then
      return json_build_object('handled', true, 'reason', 'user_cooldown');
    end if;
    insert into core.chat_cooldowns (channel_id, slot, at) values (p_ch, v_slot, now())
      on conflict (channel_id, slot) do update set at = now();
    perform public.cc_fire(p_ch, c, p_name, 'chat');
    return json_build_object('handled', true, 'fired', true);
  end if;

  -- Abstimmen: abgelaufene Runde auswerten, sonst Stimme zählen (eine je Zuschauer, änderbar)
  perform public.cc_finish_round(p_ch);
  select * into s from core.chat_control where channel_id = p_ch and id = 1 for update;
  if s.round_ends_at is null then
    update core.chat_control set round = round + 1, round_ends_at = now() + make_interval(secs => vote_seconds),
           tally = '{}'::jsonb, voters = 0, updated_at = now()
     where channel_id = p_ch and id = 1
    returning * into s;
  end if;
  select command_id into v_old from core.cc_votes where channel_id = p_ch and round = s.round and voter = left(p_user_id, 60);
  if v_old = c.id then return json_build_object('handled', true); end if;
  insert into core.cc_votes (channel_id, round, voter, command_id) values (p_ch, s.round, left(p_user_id, 60), c.id)
    on conflict (channel_id, round, voter) do update set command_id = excluded.command_id;
  update core.chat_control set
    tally = case when v_old is null then tally
                 else jsonb_set(tally, array[v_old::text], to_jsonb(greatest(coalesce((tally ->> v_old::text)::int, 0) - 1, 0))) end
            || jsonb_build_object(c.id::text, coalesce((tally ->> c.id::text)::int, 0) + 1),
    voters = voters + case when v_old is null then 1 else 0 end,
    updated_at = now()
  where channel_id = p_ch and id = 1;
  return json_build_object('handled', true, 'voted', true);
end;
$$;
revoke execute on function public.cc_chat(uuid, text, text, text) from public, anon, authenticated;

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
  if not found then return public.cc_chat(v_ch, p_user_id, p_name, v_cmd); end if;

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


-- Kanalpunkte-Einlösung (Edge Function twitch-eventsub). Antwort: {ok} oder {ok:false, reason: unknown|paused|off}
create or replace function public.cc_redeem(p_reward_id text, p_name text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  s core.chat_control;
  c core.cc_commands;
begin
  select * into c from core.cc_commands where channel_id = v_ch and reward_id = p_reward_id;
  if not found then return json_build_object('ok', false, 'reason', 'unknown'); end if;
  if public.viewer_paused() then return json_build_object('ok', false, 'reason', 'paused'); end if;
  select * into s from core.chat_control where channel_id = v_ch and id = 1;
  if (found and not s.enabled) or not c.enabled or not public.tile_started('chatcontrol') then
    return json_build_object('ok', false, 'reason', 'off');
  end if;
  perform public.cc_fire(v_ch, c, p_name, 'points');
  return json_build_object('ok', true, 'label', c.label, 'emoji', c.emoji);
end;
$$;
revoke execute on function public.cc_redeem(text, text) from public, anon, authenticated;

-- Belohnungs-ID merken (Edge Function stream-tools → cc_sync)
create or replace function public.cc_reward_set(p_id bigint, p_reward_id text, p_error text default '')
returns void language sql security definer set search_path = '' as $$
  update core.cc_commands set reward_id = p_reward_id, reward_error = left(coalesce(p_error, ''), 200)
   where channel_id = public.current_channel() and id = p_id;
$$;
revoke execute on function public.cc_reward_set(bigint, text, text) from public, anon, authenticated;

-- Abgelaufene Abstimm-Runde auswerten. Darf jeder (das Overlay, wenn der Countdown 0 erreicht).
create or replace function public.cc_tick()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_channel() is not null then perform public.cc_finish_round(public.current_channel()); end if;
end;
$$;
revoke execute on function public.cc_tick() from public;
grant execute on function public.cc_tick() to anon, authenticated;

-- ---------- Streamer und Mods ----------
create or replace function public.cc_settings_save(p_enabled boolean, p_mode text, p_vote_seconds int, p_user_cooldown int, p_show_seconds int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  s core.chat_control;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501';
  end if;
  if p_mode is not null and p_mode not in ('direct', 'vote') then raise exception 'Unbekannter Modus.'; end if;
  if p_vote_seconds is not null and (p_vote_seconds < 10 or p_vote_seconds > 120) then raise exception 'Eine Abstimm-Runde dauert 10 bis 120 Sekunden.'; end if;
  if p_user_cooldown is not null and (p_user_cooldown < 0 or p_user_cooldown > 600) then raise exception 'Die Pause je Zuschauer kann 0 bis 600 Sekunden sein.'; end if;
  if p_show_seconds is not null and (p_show_seconds < 2 or p_show_seconds > 30) then raise exception 'Die Anzeigedauer kann 2 bis 30 Sekunden sein.'; end if;
  insert into core.chat_control (channel_id, id) values (v_ch, 1) on conflict (channel_id, id) do nothing;
  update core.chat_control set
    enabled = coalesce(p_enabled, enabled), mode = coalesce(p_mode, mode), vote_seconds = coalesce(p_vote_seconds, vote_seconds),
    user_cooldown = coalesce(p_user_cooldown, user_cooldown), show_seconds = coalesce(p_show_seconds, show_seconds),
    -- Moduswechsel oder Ausschalten: laufende Runde verwerfen
    round_ends_at = case when coalesce(p_mode, mode) <> mode or p_enabled is false then null else round_ends_at end,
    tally = case when coalesce(p_mode, mode) <> mode or p_enabled is false then '{}'::jsonb else tally end,
    voters = case when coalesce(p_mode, mode) <> mode or p_enabled is false then 0 else voters end,
    updated_at = now()
  where channel_id = v_ch and id = 1
  returning * into s;
  return row_to_json(s);
end;
$$;
revoke execute on function public.cc_settings_save(boolean, text, int, int, int) from public, anon;
grant execute on function public.cc_settings_save(boolean, text, int, int, int) to authenticated;

create or replace function public.cc_command_save(p_id bigint, p_word text, p_label text, p_emoji text, p_cooldown int default 15,
  p_chat boolean default true, p_cost int default 0, p_enabled boolean default true, p_game text default '')
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_word text := lower(btrim(regexp_replace(coalesce(p_word, ''), '^!+', '')));
  r core.cc_commands;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Chat-Kommandos einstellen dürfen nur der Streamer und die Mods.' using errcode = '42501';
  end if;
  if v_word !~ '^[a-z0-9äöüß]{2,20}$' then
    raise exception 'Der Befehl darf nur Buchstaben und Zahlen haben (2–20 Zeichen), z. B. springen.';
  end if;
  if v_word in ('vote', 'abstimmen', 'puls', 'herz', 'bpm', 'watchtime', 'befehle', 'sounds', 'change', 'join', 'leave', 'rate', 'erwischt', 'füttern', 'fuettern') then
    raise exception 'Den Befehl !% gibt es schon für etwas anderes.', v_word;
  end if;
  if exists (select 1 from core.counters where channel_id = v_ch and command = v_word) then
    raise exception 'Den Befehl !% hat schon ein Zähler.', v_word;
  end if;
  if exists (select 1 from core.cc_commands where channel_id = v_ch and word = v_word and id is distinct from p_id) then
    raise exception 'Das Kommando !% gibt es schon.', v_word;
  end if;
  if char_length(btrim(coalesce(p_label, ''))) not between 1 and 40 then raise exception 'Der Text braucht 1 bis 40 Zeichen.'; end if;
  if coalesce(p_cooldown, 0) not between 0 and 3600 then raise exception 'Die Abklingzeit kann 0 bis 3600 Sekunden sein.'; end if;
  if coalesce(p_cost, 0) < 0 or coalesce(p_cost, 0) > 1000000 then raise exception 'Kanalpunkte: 0 bis 1.000.000.'; end if;
  if not coalesce(p_chat, true) and coalesce(p_cost, 0) = 0 then
    raise exception 'Ohne Chat-Befehl braucht das Kommando Kanalpunkte – sonst kann es niemand auslösen.';
  end if;
  if p_id is null then
    if (select count(*) from core.cc_commands where channel_id = v_ch) >= 30 then raise exception 'Höchstens 30 Kommandos.'; end if;
    insert into core.cc_commands (channel_id, word, label, emoji, cooldown, chat, cost, enabled, game, position)
      values (v_ch, v_word, btrim(p_label), coalesce(nullif(btrim(p_emoji), ''), '🎮'), coalesce(p_cooldown, 15), coalesce(p_chat, true),
              coalesce(p_cost, 0), coalesce(p_enabled, true), left(coalesce(p_game, ''), 40),
              (select coalesce(max(position), 0) + 1 from core.cc_commands where channel_id = v_ch))
    returning * into r;
  else
    update core.cc_commands set word = v_word, label = btrim(p_label), emoji = coalesce(nullif(btrim(p_emoji), ''), '🎮'),
           cooldown = coalesce(p_cooldown, 15), chat = coalesce(p_chat, true), cost = coalesce(p_cost, 0),
           enabled = coalesce(p_enabled, true), updated_at = now()
     where channel_id = v_ch and id = p_id
    returning * into r;
    if not found then raise exception 'Dieses Kommando gibt es nicht.'; end if;
  end if;
  return row_to_json(r);
end;
$$;
revoke execute on function public.cc_command_save(bigint, text, text, text, int, boolean, int, boolean, text) from public, anon;
grant execute on function public.cc_command_save(bigint, text, text, text, int, boolean, int, boolean, text) to authenticated;

-- Löschen. Die Belohnung bei Twitch räumt danach „Kanalpunkte abgleichen“ (stream-tools → cc_sync) weg.
create or replace function public.cc_command_delete(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_channel() is null or not public.is_admin() then
    raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501';
  end if;
  delete from core.cc_commands where channel_id = public.current_channel() and id = p_id;
end;
$$;
revoke execute on function public.cc_command_delete(bigint) from public, anon;
grant execute on function public.cc_command_delete(bigint) to authenticated;

-- Ausprobieren (erscheint im Overlay, ohne Abklingzeit)
create or replace function public.cc_test(p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  c core.cc_commands;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501';
  end if;
  select * into c from core.cc_commands where channel_id = v_ch and id = p_id;
  if not found then raise exception 'Dieses Kommando gibt es nicht.'; end if;
  return row_to_json(public.cc_fire(v_ch, c, public.my_name(), 'web'));
end;
$$;
revoke execute on function public.cc_test(bigint) from public, anon;
grant execute on function public.cc_test(bigint) to authenticated;

-- ---------- Mod-Rechte: Chat-Kommandos gehören zu den Mitmach-Spielen ----------
create or replace function public.request_area()
returns text language sql stable set search_path = '' as $f$
  select coalesce(nullif(current_setting('app.area', true), ''), case
    when p ~ '^giveaway' then 'giveaway'
    when p ~ '^(spins?($|_)|wheel|overlay_spins)' then 'wheel'
    when p ~ '^bingo' then 'bingo'
    when p ~ '^(tiles?($|_)|ideas?($|_)|idea_votes|feature_open|games_|questions?($|_)|question_)' then 'ideas'
    when p ~ '^(quiz|shop|challenge|win_challenge|queue|cards?_|forbidden|hotword|pause|poll|counter|gamewheel|heart|cc_|chat_control)' then 'games'
    when p ~ '^(send_prank|prank|sounds($|_)|tts)' then 'pranks'
    when p ~ '^pet' then 'pet'
    when p ~ '^(overlay|alert|ticker|stream_alerts|subathon|anniversary)' then 'overlay'
    when p ~ '^(bot_|chat_)' then 'chat'
    when p ~ '^stream_reward' then 'points'
    when p ~ '^site_guard' then 'guard'
  end)
  from (select lower(regexp_replace(coalesce(current_setting('request.path', true), ''), '^/(rpc/)?', '')) as p) x;
$f$;

notify pgrst, 'reload schema';
