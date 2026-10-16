-- ============================================================
-- StreamHelp: Verlosung – wer heute schon gewonnen hat, darf heute nicht mehr mitmachen
--   · Neue Einstellung je Verlosung: giveaway.one_win_per_day (Standard: an). Der Streamer
--     schaltet sie beim Starten im Dialog ein oder aus.
--   · „Heute“ ist der Kalendertag in Deutschland (Europe/Berlin), über alle Verlosungen dieses
--     Tages. Gezählt wird, wer gezogen wurde und nicht rausgeworfen ist: Wirft der Streamer
--     einen Gewinner raus (z. B. weil er nicht da war), ist er für heute wieder frei.
--   · Erkannt wird der Zuschauer an seiner Twitch-ID, bei von Hand eingetragenen Namen
--     (…_giveaway_manual.sql) und als Absicherung auch am Namen (ohne Groß-/Kleinschreibung).
--   · Gilt für Chat-Befehl, Twitch-Panel und das Eintragen von Hand. Das Datum des Gewinns
--     (won_at) liegt bei den Teilnehmern und bleibt wie die Twitch-ID für Zuschauer unsichtbar.
--   · Mitmachen per Chat/Panel und Eintragen von Hand ergänzen sich: Steht jemand schon von Hand
--     im Lostopf (gleicher Name, ohne Groß-/Kleinschreibung), ist er per Chat „schon dabei“ – und
--     wer von Hand eingetragen und rausgeworfen wurde, kommt auch per Chat nicht wieder rein.
--   · Gewinner von früheren Runden werden bis zu zwei Tage aufgehoben (sonst räumt der Start
--     einer neuen Verlosung sie nach einer Runde weg). Gewinne von vor dieser Migration haben
--     kein Datum und zählen nicht.
-- Braucht 20261023000000_giveaway.sql, 20261025000000_giveaway_kick.sql,
-- 20261028000000_platform.sql und 20261112000000_giveaway_manual.sql. Mehrfach ausführbar.
-- ============================================================

-- ---------- Spalten ----------
alter table core.giveaway add column if not exists one_win_per_day boolean not null default true;
alter table core.giveaway_entries add column if not exists won_at timestamptz;
-- Sichten neu bauen, damit die neuen Spalten sichtbar werden (won_at bekommt dabei kein Leserecht
-- für Zuschauer, weil die Sicht nur Spalten freigibt, die auch die Tabelle freigibt)
select public.channel_view('giveaway');
select public.channel_view('giveaway_entries');

-- ---------- Hat dieser Zuschauer heute schon gewonnen? (nur für die Funktionen unten) ----------
create or replace function public.giveaway_won_today(p_key text, p_name text default '')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.giveaway_entries e
    where e.won and not e.kicked
      and e.won_at >= (date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')
      and (e.player_key = p_key
           or (btrim(coalesce(p_name, '')) <> '' and lower(e.name) = lower(btrim(p_name))))
  );
$$;
revoke execute on function public.giveaway_won_today(text, text) from public, anon, authenticated;

-- ---------- Mitmachen (Chat, Twitch-Panel): wie bisher, plus die Tagesregel ----------
create or replace function public.giveaway_enter(p_key text, p_name text, p_follower boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  g public.giveaway;
  who text := public.safe_name(p_name);
  n int;
  v_manual_kicked boolean;
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
  if exists (select 1 from public.giveaway_entries where round = g.round and player_key = p_key and kicked) then
    return json_build_object('ok', false, 'reason', 'kicked',
      'reply', case when g.confirm_in_chat then ltrim(format('%s Bei dieser Verlosung kannst du nicht mehr mitmachen.', who)) end);
  end if;
  -- Von Hand eingetragen (…_giveaway_manual.sql) unter demselben Namen? Dann zählt das wie „schon dabei“
  -- bzw. „rausgeworfen“ – sonst stünde derselbe Zuschauer zweimal im Lostopf
  select e.kicked into v_manual_kicked from public.giveaway_entries e
    where e.round = g.round and e.player_key like 'manual:%' and lower(e.name) = lower(btrim(coalesce(p_name, '')))
    limit 1;
  if found then
    if v_manual_kicked then
      return json_build_object('ok', false, 'reason', 'kicked',
        'reply', case when g.confirm_in_chat then ltrim(format('%s Bei dieser Verlosung kannst du nicht mehr mitmachen.', who)) end);
    end if;
    return json_build_object('ok', false, 'reason', 'twice',
      'reply', case when g.confirm_in_chat then ltrim(format('%s Du bist schon dabei – jeder darf nur einmal mitmachen.', who)) end);
  end if;
  -- Heute schon gewonnen? (nur wenn der Streamer die Regel nicht ausgeschaltet hat)
  if g.one_win_per_day and public.giveaway_won_today(p_key, p_name) then
    return json_build_object('ok', false, 'reason', 'won_today',
      'reply', case when g.confirm_in_chat then ltrim(format('%s Du hast heute schon gewonnen – bei dieser Verlosung bist du nicht dabei. Morgen wieder!', who)) end);
  end if;
  if g.followers_only and p_follower is not true then
    return json_build_object('ok', false, 'reason', 'follower',
      'reply', ltrim(format('%s Mitmachen dürfen nur Follower – folge dem Kanal und schreib dann nochmal %s.', who, g.command)));
  end if;
  insert into public.giveaway_entries (round, player_key, name)
    values (g.round, p_key, left(coalesce(nullif(btrim(p_name), ''), 'Zuschauer'), 40))
    on conflict (channel_id, round, player_key) do nothing;
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

-- ---------- Starten: neuer Schalter p_one_win_per_day (Standard: an) ----------
drop function if exists public.giveaway_start(text, text, boolean, int, boolean);
create or replace function public.giveaway_start(p_prize text, p_command text, p_followers_only boolean, p_minutes int, p_confirm boolean,
                                                 p_one_win_per_day boolean default true)
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
    one_win_per_day = coalesce(p_one_win_per_day, true),
    entries = 0, opened_at = now(), ends_at = case when v_mins > 0 then now() + make_interval(mins => v_mins) end,
    winner_name = '', drawn_at = null, draws = 0, updated_at = now()
  where id = 1 returning * into g;
  -- Alte Teilnehmer aufräumen (vorletzte Runde und älter) – außer Gewinner der letzten zwei Tage,
  -- die für die Tagesregel gebraucht werden
  delete from public.giveaway_entries
    where round < g.round - 1 and not (won and not kicked and won_at >= now() - interval '2 days');
  perform public.bot_say(format('🎁 Verlosung: %s! Schreib %s in den Chat, um mitzumachen%s%s. Jeder darf einmal.%s',
    g.prize, g.command,
    case when g.followers_only then ' (nur Follower)' else '' end,
    case when g.ends_at is not null then format(' – du hast %s Minuten', v_mins) else '' end,
    case when g.one_win_per_day then ' Wer heute schon gewonnen hat, ist nicht dabei.' else '' end));
  return g;
end;
$$;
revoke execute on function public.giveaway_start(text, text, boolean, int, boolean, boolean) from public, anon;
grant execute on function public.giveaway_start(text, text, boolean, int, boolean, boolean) to authenticated;

-- ---------- Ziehen: merkt sich, wann jemand gewonnen hat ----------
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
    where round = g.round and not won and not kicked order by random() limit 1;
  if e.id is null then
    raise exception '%', case when g.entries = 0 then 'Noch niemand im Lostopf.' else 'Alle Teilnehmer wurden schon gezogen.' end;
  end if;
  update public.giveaway_entries set won = true, won_at = now() where id = e.id;
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

-- ---------- Von Hand eintragen: wie bisher, plus die Tagesregel ----------
create or replace function public.giveaway_add(p_name text)
returns public.giveaway language plpgsql security definer set search_path = '' as $$
declare
  g public.giveaway;
  -- führendes @ weg, Leerzeichen zusammenfassen, höchstens 40 Zeichen (wie bei Chat-Teilnehmern)
  v_name text := left(btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '^\s*@+', ''), '\s+', ' ', 'g')), 40);
  v_key text;
  n int;
begin
  if not public.is_admin() then raise exception 'Teilnehmer hinzufügen dürfen nur der Streamer und die Mods.'; end if;
  if char_length(v_name) < 1 then raise exception 'Bitte einen Namen eintragen.'; end if;
  v_key := 'manual:' || lower(v_name);

  select * into g from public.giveaway where id = 1 for update;
  if g.status = 'idle' or g.round = 0 then raise exception 'Erst eine Verlosung starten.'; end if;

  if exists (select 1 from public.giveaway_entries where round = g.round and lower(name) = lower(v_name) and kicked) then
    raise exception '% wurde aus dieser Verlosung rausgeworfen – bitte unter „Rausgeworfen“ zurückholen.', v_name;
  end if;
  if g.one_win_per_day and public.giveaway_won_today(v_key, v_name) then
    raise exception '% hat heute schon gewonnen und darf bei dieser Verlosung nicht mitmachen.', v_name;
  end if;
  if exists (select 1 from public.giveaway_entries where round = g.round and lower(name) = lower(v_name)) then
    raise exception '% ist schon im Lostopf.', v_name;
  end if;

  insert into public.giveaway_entries (round, player_key, name)
    values (g.round, v_key, v_name)
    on conflict (channel_id, round, player_key) do nothing;
  get diagnostics n = row_count;
  if n = 0 then raise exception '% ist schon im Lostopf.', v_name; end if;

  update public.giveaway set entries = entries + 1, updated_at = now() where id = 1 returning * into g;
  return g;
end;
$$;
revoke execute on function public.giveaway_add(text) from public, anon;
grant execute on function public.giveaway_add(text) to authenticated;

-- ---------- Bin ich dabei? Dazu: habe ich heute schon gewonnen? ----------
create or replace function public.giveaway_me()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'joined', exists (select 1 from public.giveaway_entries e join public.giveaway g on g.id = 1
                      where e.round = g.round and not e.kicked and e.player_key = public.my_player_key()),
    'won', exists (select 1 from public.giveaway_entries e join public.giveaway g on g.id = 1
                   where e.round = g.round and e.won and not e.kicked and e.player_key = public.my_player_key()),
    'kicked', exists (select 1 from public.giveaway_entries e join public.giveaway g on g.id = 1
                      where e.round = g.round and e.kicked and e.player_key = public.my_player_key()),
    'won_today', public.giveaway_won_today(public.my_player_key(), ''),
    'twitch', public.my_player_key() like 'tw:%'
  );
$$;
revoke execute on function public.giveaway_me() from public, anon;
grant execute on function public.giveaway_me() to authenticated;
