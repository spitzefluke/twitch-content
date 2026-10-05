-- ============================================================
-- StreamHelp: Verlosung – Teilnehmer rauswerfen
--   · Streamer, Admins und freigegebene Mods werfen auf der Webseite jemanden aus dem
--     Lostopf (giveaway_kick). Rausgeworfene werden nicht gezogen und können sich in
--     dieser Verlosung nicht neu eintragen (der Eintrag bleibt, nur markiert).
--   · Zurückholen geht auch (p_kick = false).
--   · Fliegt der aktuelle Gewinner raus, ist die Verlosung wieder „geschlossen“ und
--     „Neu ziehen“ lost jemand anderen aus; er verschwindet aus „Letzte Gewinner“.
-- Braucht 20261023000000_giveaway.sql. Mehrfach ausführbar.
-- ============================================================

alter table public.giveaway_entries add column if not exists kicked boolean not null default false;
grant select (kicked) on public.giveaway_entries to anon, authenticated;

-- Mitmachen: wie bisher, nur Rausgeworfene kommen nicht wieder rein
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
  if exists (select 1 from public.giveaway_entries where round = g.round and player_key = p_key and kicked) then
    return json_build_object('ok', false, 'reason', 'kicked',
      'reply', case when g.confirm_in_chat then ltrim(format('%s Bei dieser Verlosung kannst du nicht mehr mitmachen.', who)) end);
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

-- Ziehen: wie bisher, ohne Rausgeworfene
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

-- Rauswerfen (p_kick = true) oder zurückholen (false) – nur in der aktuellen Verlosung
create or replace function public.giveaway_kick(p_entry bigint, p_kick boolean default true)
returns public.giveaway language plpgsql security definer set search_path = '' as $$
declare
  g public.giveaway;
  e public.giveaway_entries;
  v_kick boolean := coalesce(p_kick, true);
begin
  if not public.is_admin() then raise exception 'Rauswerfen dürfen nur der Streamer und die Mods.'; end if;
  select * into g from public.giveaway where id = 1 for update;
  select * into e from public.giveaway_entries where id = p_entry and round = g.round for update;
  if e.id is null then raise exception 'Diesen Teilnehmer gibt es in der aktuellen Verlosung nicht (mehr).'; end if;
  if e.kicked = v_kick then return g; end if;

  if v_kick then
    update public.giveaway_entries set kicked = true, won = false where id = e.id;
    -- Schon gezogen? Dann zählt der Gewinn nicht – aus „Letzte Gewinner“ raus
    if e.won then
      delete from public.giveaway_winners where id = (
        select id from public.giveaway_winners where round = g.round and name = e.name order by id desc limit 1);
    end if;
    update public.giveaway set entries = greatest(entries - 1, 0), updated_at = now(),
      -- Der aktuelle Gewinner fliegt raus: wieder „geschlossen“, „Neu ziehen“ lost jemand anderen aus
      status = case when e.won and status = 'drawn' and winner_name = e.name then 'closed' else status end,
      winner_name = case when e.won and status = 'drawn' and winner_name = e.name then '' else winner_name end,
      drawn_at = case when e.won and status = 'drawn' and winner_name = e.name then null else drawn_at end
      where id = 1 returning * into g;
  else
    update public.giveaway_entries set kicked = false where id = e.id;
    update public.giveaway set entries = entries + 1, updated_at = now() where id = 1 returning * into g;
  end if;
  return g;
end;
$$;
revoke execute on function public.giveaway_kick(bigint, boolean) from public, anon;
grant execute on function public.giveaway_kick(bigint, boolean) to authenticated;

-- Bin ich dabei? Rausgeworfene sind es nicht mehr
create or replace function public.giveaway_me()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'joined', exists (select 1 from public.giveaway_entries e join public.giveaway g on g.id = 1
                      where e.round = g.round and not e.kicked and e.player_key = public.my_player_key()),
    'won', exists (select 1 from public.giveaway_entries e join public.giveaway g on g.id = 1
                   where e.round = g.round and e.won and not e.kicked and e.player_key = public.my_player_key()),
    'kicked', exists (select 1 from public.giveaway_entries e join public.giveaway g on g.id = 1
                      where e.round = g.round and e.kicked and e.player_key = public.my_player_key()),
    'twitch', public.my_player_key() like 'tw:%'
  );
$$;
revoke execute on function public.giveaway_me() from public, anon;
grant execute on function public.giveaway_me() to authenticated;
