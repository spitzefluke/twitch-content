-- ============================================================
-- StreamHelp: Verlosung (Content-Idee mit Chat-Befehl)
--   · Der Streamer (oder ein Mod) legt einen Preis fest und startet die Verlosung.
--   · Zuschauer schreiben den Befehl (Standard !verlosung) in den Chat. Die Edge Function
--     twitch-eventsub prüft bei Twitch, ob sie dem Kanal folgen, und trägt sie über
--     giveaway_enter ein – jeder nur einmal pro Verlosung (unique round + player_key).
--   · Optional mit Zeitlimit; danach nimmt die Verlosung niemanden mehr an.
--   · „Gewinner ziehen“ lost serverseitig aus allen Teilnehmern; „Neu ziehen“ nimmt jemand
--     anderen (z. B. wenn der Gewinner nicht da ist). Der Chat-Bot verkündet Start und Gewinner.
--   · giveaway (eine Zeile) und die Namen der Teilnehmer sind für alle lesbar (Overlay, Webseite);
--     die Twitch-ID (player_key) sehen nur die Funktionen.
-- Braucht 20261014000000_stream_extras.sql (bot_say, tile_started, safe_name, realtime_add).
-- Mehrfach ausführbar.
-- ============================================================

-- ---------- Kachel ----------
alter table public.tiles drop constraint if exists tiles_kind_check;
alter table public.tiles add constraint tiles_kind_check
  check (kind in ('wheel', 'countdown', 'prank', 'bingo', 'questions', 'pet', 'shop', 'challenge',
                  'forbidden', 'subathon', 'pause', 'quiz', 'queue', 'tts', 'cards', 'giveaway'));

do $$
begin
  if not exists (select 1 from public.tiles where id = 'giveaway') then
    update public.tiles set position = position + 1 where kind = 'countdown';
    insert into public.tiles (id, position, kind, title, description, theme) values
      ('giveaway', (select coalesce(max(position), 1) + 1 from public.tiles where kind <> 'countdown'), 'giveaway',
       'Verlosung', 'Ein Preis, ein Gewinner: Schreib !verlosung in den Chat und sei dabei. Jeder Follower darf einmal mitmachen.', 'giveaway');
  end if;
end;
$$;

-- ---------- Stand der Verlosung ----------
create table if not exists public.giveaway (
  id int primary key default 1 check (id = 1),
  round int not null default 0,
  status text not null default 'idle' check (status in ('idle', 'open', 'closed', 'drawn')),
  prize text not null default '' check (char_length(prize) <= 100),
  command text not null default '!verlosung' check (command ~ '^![a-z0-9äöüß_]{2,20}$'),
  followers_only boolean not null default true,
  confirm_in_chat boolean not null default true,
  entries int not null default 0,
  opened_at timestamptz,
  ends_at timestamptz,
  winner_name text not null default '',
  drawn_at timestamptz,
  draws int not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.giveaway (id) values (1) on conflict (id) do nothing;
alter table public.giveaway enable row level security;
drop policy if exists "giveaway: lesen für alle" on public.giveaway;
create policy "giveaway: lesen für alle" on public.giveaway for select to anon, authenticated using (true);
grant select on public.giveaway to anon, authenticated;
-- Schreiben nur über die Funktionen unten

-- Teilnehmer: Name für alle, die Twitch-ID nur für die Funktionen (Spalten-Rechte)
create table if not exists public.giveaway_entries (
  id bigint generated always as identity primary key,
  round int not null,
  player_key text not null,
  name text not null default '',
  won boolean not null default false,
  created_at timestamptz not null default now(),
  unique (round, player_key)
);
alter table public.giveaway_entries enable row level security;
drop policy if exists "giveaway_entries: lesen für alle" on public.giveaway_entries;
create policy "giveaway_entries: lesen für alle" on public.giveaway_entries for select to anon, authenticated using (true);
revoke select on public.giveaway_entries from anon, authenticated;
grant select (id, round, name, won, created_at) on public.giveaway_entries to anon, authenticated;

-- Bisherige Gewinner (für die Webseite)
create table if not exists public.giveaway_winners (
  id bigint generated always as identity primary key,
  round int not null,
  prize text not null default '',
  name text not null default '',
  entries int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.giveaway_winners enable row level security;
drop policy if exists "giveaway_winners: lesen für alle" on public.giveaway_winners;
create policy "giveaway_winners: lesen für alle" on public.giveaway_winners for select to anon, authenticated using (true);
grant select on public.giveaway_winners to anon, authenticated;

-- ---------- Mitmachen (nur die Edge Function, nach der Follower-Prüfung bei Twitch) ----------
-- p_follower: folgt der Zuschauer dem Kanal? (null = unbekannt, zählt wie nein, wenn nur Follower dürfen)
create or replace function public.giveaway_enter(p_key text, p_name text, p_follower boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  g public.giveaway;
  who text := public.safe_name(p_name);
  n int;
begin
  if coalesce(p_key, '') = '' then return null; end if;
  select * into g from public.giveaway where id = 1 for update;
  if g.status <> 'open' or not public.tile_started('giveaway') then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  -- Zeit abgelaufen: ab jetzt geschlossen
  if g.ends_at is not null and g.ends_at <= now() then
    update public.giveaway set status = 'closed', updated_at = now() where id = 1;
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  if g.followers_only and p_follower is not true then
    return json_build_object('ok', false, 'reason', 'follower',
      'reply', ltrim(format('%s Mitmachen dürfen nur Follower – folge dem Kanal und schreib dann nochmal %s.', who, g.command)));
  end if;
  insert into public.giveaway_entries (round, player_key, name)
    values (g.round, p_key, left(coalesce(nullif(btrim(p_name), ''), 'Zuschauer'), 40))
    on conflict (round, player_key) do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    return json_build_object('ok', false, 'reason', 'twice',
      'reply', case when g.confirm_in_chat then ltrim(format('%s Du bist schon dabei – jeder darf nur einmal mitmachen.', who)) end);
  end if;
  update public.giveaway set entries = entries + 1, updated_at = now() where id = 1 returning entries into n;
  return json_build_object('ok', true, 'entries', n,
    'reply', case when g.confirm_in_chat then ltrim(format('%s ist dabei! 🍀 (%s im Lostopf)', who, n)) end);
end;
$$;
revoke execute on function public.giveaway_enter(text, text, boolean) from public, anon, authenticated;

-- ---------- Steuern (Streamer, Admins, freigegebene Mods) ----------
create or replace function public.giveaway_start(p_prize text, p_command text, p_followers_only boolean, p_minutes int, p_confirm boolean)
returns public.giveaway language plpgsql security definer set search_path = '' as $$
declare
  v_prize text := btrim(coalesce(p_prize, ''));
  v_cmd text := lower(btrim(coalesce(p_command, '')));
  v_mins int := coalesce(p_minutes, 0);
  g public.giveaway;
begin
  if not public.is_admin() then raise exception 'Eine Verlosung starten dürfen nur der Streamer und die Mods.'; end if;
  if char_length(v_prize) < 2 or char_length(v_prize) > 100 then raise exception 'Bitte einen Preis eintragen (2–100 Zeichen).'; end if;
  if v_cmd = '' then v_cmd := '!verlosung'; end if;
  if left(v_cmd, 1) <> '!' then v_cmd := '!' || v_cmd; end if;
  if v_cmd !~ '^![a-z0-9äöüß_]{2,20}$' then raise exception 'Der Befehl darf nur Buchstaben, Zahlen und _ haben (2–20 Zeichen), z. B. !verlosung.'; end if;
  if v_cmd in ('!join', '!leave', '!a', '!b', '!c', '!d', '!watchtime', '!befehle', '!commands', '!change') then
    raise exception 'Den Befehl % benutzt schon eine andere Funktion.', v_cmd;
  end if;
  if v_mins < 0 or v_mins > 240 then raise exception 'Die Dauer kann 0 (ohne Limit) bis 240 Minuten sein.'; end if;
  update public.giveaway set
    round = round + 1, status = 'open', prize = v_prize, command = v_cmd,
    followers_only = coalesce(p_followers_only, true), confirm_in_chat = coalesce(p_confirm, true),
    entries = 0, opened_at = now(), ends_at = case when v_mins > 0 then now() + make_interval(mins => v_mins) end,
    winner_name = '', drawn_at = null, draws = 0, updated_at = now()
  where id = 1 returning * into g;
  -- Alte Teilnehmer (vorletzte Runde und älter) aufräumen
  delete from public.giveaway_entries where round < g.round - 1;
  perform public.bot_say(format('🎁 Verlosung: %s! Schreib %s in den Chat, um mitzumachen%s%s. Jeder darf einmal.',
    g.prize, g.command,
    case when g.followers_only then ' (nur Follower)' else '' end,
    case when g.ends_at is not null then format(' – du hast %s Minuten', v_mins) else '' end));
  return g;
end;
$$;
revoke execute on function public.giveaway_start(text, text, boolean, int, boolean) from public, anon;
grant execute on function public.giveaway_start(text, text, boolean, int, boolean) to authenticated;

-- Keine neuen Teilnehmer mehr (Ziehen geht auch direkt aus „offen“)
create or replace function public.giveaway_close()
returns public.giveaway language plpgsql security definer set search_path = '' as $$
declare
  g public.giveaway;
begin
  if not public.is_admin() then raise exception 'Nur der Streamer und die Mods.'; end if;
  update public.giveaway set status = 'closed', ends_at = least(coalesce(ends_at, now()), now()), updated_at = now()
    where id = 1 and status = 'open' returning * into g;
  if g.id is null then select * into g from public.giveaway where id = 1; return g; end if;
  perform public.bot_say(format('🔒 Die Verlosung ist zu – %s im Lostopf. Gleich wird gezogen!', g.entries));
  return g;
end;
$$;
revoke execute on function public.giveaway_close() from public, anon;
grant execute on function public.giveaway_close() to authenticated;

-- Gewinner ziehen: zufällig aus allen, die noch nicht gewonnen haben (Neu ziehen = noch einmal aufrufen)
create or replace function public.giveaway_draw()
returns public.giveaway language plpgsql security definer set search_path = '' as $$
declare
  g public.giveaway;
  e public.giveaway_entries;
begin
  if not public.is_admin() then raise exception 'Ziehen dürfen nur der Streamer und die Mods.'; end if;
  select * into g from public.giveaway where id = 1 for update;
  if g.status = 'idle' or g.round = 0 then raise exception 'Erst eine Verlosung starten.'; end if;
  select * into e from public.giveaway_entries
    where round = g.round and not won order by random() limit 1;
  if e.id is null then
    raise exception '%', case when g.entries = 0 then 'Noch niemand im Lostopf.' else 'Alle Teilnehmer wurden schon gezogen.' end;
  end if;
  update public.giveaway_entries set won = true where id = e.id;
  update public.giveaway set status = 'drawn', winner_name = e.name, drawn_at = now(), draws = draws + 1,
    ends_at = least(coalesce(ends_at, now()), now()), updated_at = now()
    where id = 1 returning * into g;
  insert into public.giveaway_winners (round, prize, name, entries) values (g.round, g.prize, e.name, g.entries);
  delete from public.giveaway_winners where id not in (select id from public.giveaway_winners order by id desc limit 50);
  perform public.bot_say(format('🎉 %s: %s gewinnt „%s“! Herzlichen Glückwunsch! (%s im Lostopf)',
    case when g.draws > 1 then 'Neu gezogen' else 'Gewinner der Verlosung' end,
    public.safe_name(e.name, 'ein Zuschauer'), g.prize, g.entries));
  return g;
end;
$$;
revoke execute on function public.giveaway_draw() from public, anon;
grant execute on function public.giveaway_draw() to authenticated;

-- Beenden: Overlay blendet die Verlosung aus, Teilnehmer bleiben bis zur nächsten Runde
create or replace function public.giveaway_reset()
returns public.giveaway language plpgsql security definer set search_path = '' as $$
declare
  g public.giveaway;
begin
  if not public.is_admin() then raise exception 'Nur der Streamer und die Mods.'; end if;
  update public.giveaway set status = 'idle', ends_at = null, updated_at = now() where id = 1 returning * into g;
  return g;
end;
$$;
revoke execute on function public.giveaway_reset() from public, anon;
grant execute on function public.giveaway_reset() to authenticated;

-- Bin ich dabei? (für die Webseite – angemeldet mit Twitch)
create or replace function public.giveaway_me()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'joined', exists (select 1 from public.giveaway_entries e join public.giveaway g on g.id = 1
                      where e.round = g.round and e.player_key = public.my_player_key()),
    'won', exists (select 1 from public.giveaway_entries e join public.giveaway g on g.id = 1
                   where e.round = g.round and e.won and e.player_key = public.my_player_key()),
    'twitch', public.my_player_key() like 'tw:%'
  );
$$;
revoke execute on function public.giveaway_me() from public, anon;
grant execute on function public.giveaway_me() to authenticated;

-- Realtime nur für den Stand (enthält die Zahl der Teilnehmer); die Liste lädt die Webseite dann neu
do $$ begin perform public.realtime_add('giveaway'); end $$;
