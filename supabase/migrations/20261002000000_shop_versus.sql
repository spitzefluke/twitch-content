-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Kisten-Shop im Koop: Versus-Modus
--   1. Warteraum: Wer eröffnet, sitzt schon drin; bis zu 4 Spieler treten mit Code bei.
--   2. Der Ersteller startet die Runde (ab 2 Spielern). Jetzt erscheinen die Kisten –
--      jede Kiste nur einmal: Wer eine öffnet, dem gehört sie, alle sehen wer und wie viel.
--      Nach 45 Sekunden bekommt, wer noch keine hat, eine übrige Kiste per Zufall.
--   3. Haben alle ihre Kiste, geht es für alle gleichzeitig in den Shop.
--   4. Haben alle eingekauft (oder die Zeit ist um), kommt der VS-Bildschirm:
--      Gefundenes abhaken schiebt die eigene Seite in die des Gegners.
--   5. Sind alle fertig (oder der Ersteller beendet), gewinnt wer die meisten Punkte hat.
-- Die Phasen stehen in shop_lobbies; jeder Wechsel ändert auch die Zeilen in
-- shop_runs, damit alle Mitspieler es per Realtime sofort sehen.
-- Braucht 20261001000000_loot_shop.sql. Mehrfach ausführbar.
-- ============================================================

alter table public.shop_lobbies add column if not exists started_at timestamptz;
alter table public.shop_lobbies add column if not exists chests_until timestamptz;
alter table public.shop_lobbies add column if not exists shop_until timestamptz;
alter table public.shop_lobbies add column if not exists vs_at timestamptz;
alter table public.shop_lobbies add column if not exists ended_at timestamptz;

-- Runden im Warteraum haben noch keine Kiste und keine Goldbarren
alter table public.shop_runs alter column chest drop not null;
alter table public.shop_runs alter column shop_until drop not null;
alter table public.shop_runs drop constraint if exists shop_runs_coins_check;
alter table public.shop_runs add constraint shop_runs_coins_check check (coins >= 0);
alter table public.shop_runs drop constraint if exists shop_runs_status_check;
alter table public.shop_runs add constraint shop_runs_status_check
  check (status in ('waiting', 'choosing', 'opened', 'shopping', 'playing', 'done'));

-- Koop-Runden nach den alten Regeln (jeder wählte frei) sind vorbei
update public.shop_lobbies l set open = false, started_at = coalesce(started_at, created_at), ended_at = coalesce(ended_at, now())
  where started_at is null
    and exists (select 1 from public.shop_runs r where r.lobby_id = l.id and r.status <> 'waiting');
update public.shop_runs r set chest = null
  where lobby_id is not null and chest is not null
    and exists (select 1 from public.shop_runs x
                where x.lobby_id = r.lobby_id and x.chest = r.chest and (x.created_at, x.id) < (r.created_at, r.id));
-- Jede Kiste gehört in einer Koop-Runde nur einem
create unique index if not exists shop_runs_chest_per_lobby on public.shop_runs (lobby_id, chest)
  where lobby_id is not null and chest is not null;

-- Öffentlich: Phasen der Runde; die Kisten-Werte erst, wenn alle ihre Kiste haben
create or replace view public.shop_lobbies_public with (security_invoker = off) as
  select l.id, l.code, l.host_name, l.open, l.created_at,
         l.host_id, l.started_at, l.chests_until, l.shop_until, l.vs_at, l.ended_at,
         case when l.shop_until is not null then l.chests end as chests
  from public.shop_lobbies l;
revoke all on public.shop_lobbies_public from public;
grant select on public.shop_lobbies_public to anon, authenticated;

-- ---------- Nächste Phase, wenn es so weit ist ----------
create or replace function public.shop_lobby_advance(p_lobby uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.shop_lobbies;
  secs int := coalesce((select shop_seconds from public.shop_settings where id = 1), 90);
  r record;
  pick int;
begin
  select * into l from public.shop_lobbies where id = p_lobby for update;
  if not found or l.started_at is null or l.ended_at is not null then
    return;
  end if;

  -- Kisten: Sobald alle eine haben (oder die Zeit um ist) geht es in den Shop
  if l.shop_until is null then
    if exists (select 1 from public.shop_runs where lobby_id = l.id and status = 'choosing') then
      if now() < l.chests_until then
        return;
      end if;
      for r in select id from public.shop_runs where lobby_id = l.id and status = 'choosing' order by created_at loop
        select i into pick from generate_series(0, 3) i
          where not exists (select 1 from public.shop_runs x where x.lobby_id = l.id and x.chest = i)
          order by random() limit 1;
        update public.shop_runs set chest = pick, coins = l.chests[pick + 1], status = 'opened', updated_at = now()
          where id = r.id;
      end loop;
    end if;
    -- 3 Sekunden, um die Kisten der anderen zu sehen
    update public.shop_lobbies set shop_until = now() + make_interval(secs => secs + 3) where id = l.id
      returning * into l;
    update public.shop_runs set status = 'shopping', shop_until = l.shop_until, updated_at = now()
      where lobby_id = l.id and status = 'opened';
    return;
  end if;

  -- Einkauf: Wenn alle fertig sind (oder die Zeit um ist) kommt der VS-Bildschirm
  if l.vs_at is null then
    if exists (select 1 from public.shop_runs where lobby_id = l.id and status = 'shopping')
       and now() <= l.shop_until + interval '3 seconds' then
      return;
    end if;
    update public.shop_lobbies set vs_at = now() where id = l.id;
    update public.shop_runs set status = 'playing', updated_at = now()
      where lobby_id = l.id and status in ('shopping', 'playing');
    return;
  end if;

  -- Alle fertig: Runde vorbei
  if not exists (select 1 from public.shop_runs where lobby_id = l.id and status <> 'done') then
    update public.shop_lobbies set ended_at = now(), open = false where id = l.id;
  end if;
end;
$$;
revoke execute on function public.shop_lobby_advance(uuid) from public, anon, authenticated;

-- ---------- Warteraum ----------
-- Koop-Runde eröffnen: Code aus gut lesbaren Zeichen, wer eröffnet sitzt schon drin
create or replace function public.shop_create_lobby()
returns public.shop_lobbies_public language plpgsql security definer set search_path = '' as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  new_code text;
  lobby public.shop_lobbies;
  result public.shop_lobbies_public;
begin
  if auth.uid() is null then
    raise exception 'Bitte zuerst anmelden.';
  end if;
  if not public.feature_open('shop') then
    raise exception 'Der Kisten-Shop ist noch nicht freigeschaltet.';
  end if;
  if (select count(*) from public.shop_lobbies where host_id = auth.uid() and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Du hast in der letzten Stunde schon 5 Koop-Runden eröffnet.';
  end if;
  loop
    new_code := (select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
                 from generate_series(1, 5));
    exit when not exists (select 1 from public.shop_lobbies where code = new_code);
  end loop;
  insert into public.shop_lobbies (code, host_id, host_name, chests)
    values (new_code, auth.uid(), public.my_name(), public.shop_random_chests())
    returning * into lobby;
  insert into public.shop_runs (user_id, player, lobby_id, chest, coins, status)
    values (auth.uid(), public.my_name(), lobby.id, null, 0, 'waiting');
  select * into result from public.shop_lobbies_public where id = lobby.id;
  return result;
end;
$$;

create or replace function public.shop_join_lobby(p_code text)
returns public.shop_runs language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  lobby public.shop_lobbies;
  result public.shop_runs;
begin
  if uid is null then
    raise exception 'Bitte zuerst anmelden.';
  end if;
  if not public.feature_open('shop') then
    raise exception 'Der Kisten-Shop ist noch nicht freigeschaltet.';
  end if;
  select * into lobby from public.shop_lobbies where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then
    raise exception 'Diese Koop-Runde gibt es nicht. Code prüfen.';
  end if;
  select * into result from public.shop_runs where lobby_id = lobby.id and user_id = uid;
  if found then
    return result;
  end if;
  if not lobby.open or lobby.ended_at is not null then
    raise exception 'Diese Koop-Runde ist schon beendet.';
  end if;
  if lobby.started_at is not null then
    raise exception 'Diese Koop-Runde hat schon angefangen.';
  end if;
  if (select count(*) from public.shop_runs where lobby_id = lobby.id) >= 4 then
    raise exception 'Die Koop-Runde ist voll – mehr als 4 geht nicht (4 Kisten).';
  end if;
  insert into public.shop_runs (user_id, player, lobby_id, chest, coins, status)
    values (uid, public.my_name(), lobby.id, null, 0, 'waiting')
    returning * into result;
  return result;
end;
$$;

-- Vor dem Start wieder rausgehen; geht der Ersteller, ist die Runde zu
create or replace function public.shop_leave_lobby(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  lobby public.shop_lobbies;
begin
  select * into lobby from public.shop_lobbies where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or lobby.started_at is not null then
    return;
  end if;
  if lobby.host_id = auth.uid() then
    update public.shop_lobbies set open = false, ended_at = now() where id = lobby.id;
    update public.shop_runs set status = 'done', updated_at = now() where lobby_id = lobby.id;
  else
    delete from public.shop_runs where lobby_id = lobby.id and user_id = auth.uid();
  end if;
end;
$$;

-- Nur wer eröffnet hat, startet – ab 2 Spielern
create or replace function public.shop_start_lobby(p_code text)
returns public.shop_lobbies_public language plpgsql security definer set search_path = '' as $$
declare
  lobby public.shop_lobbies;
  result public.shop_lobbies_public;
begin
  select * into lobby from public.shop_lobbies where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then
    raise exception 'Diese Koop-Runde gibt es nicht. Code prüfen.';
  end if;
  if lobby.host_id is distinct from auth.uid() then
    raise exception 'Starten darf nur, wer die Runde eröffnet hat.';
  end if;
  if not lobby.open or lobby.ended_at is not null then
    raise exception 'Diese Koop-Runde ist schon beendet.';
  end if;
  if lobby.started_at is null then
    if (select count(*) from public.shop_runs where lobby_id = lobby.id) < 2 then
      raise exception 'Zum Starten braucht es mindestens 2 Spieler.';
    end if;
    update public.shop_lobbies set started_at = now(), chests_until = now() + interval '45 seconds' where id = lobby.id;
    update public.shop_runs set status = 'choosing', updated_at = now() where lobby_id = lobby.id and status = 'waiting';
  end if;
  select * into result from public.shop_lobbies_public where id = lobby.id;
  return result;
end;
$$;

-- Läuft eine Zeit ab, stößt jeder Mitspieler damit die nächste Phase an
create or replace function public.shop_lobby_tick(p_code text)
returns public.shop_lobbies_public language plpgsql security definer set search_path = '' as $$
declare
  lobby_id uuid := (select id from public.shop_lobbies where code = upper(btrim(coalesce(p_code, ''))));
  result public.shop_lobbies_public;
begin
  if lobby_id is null then
    raise exception 'Diese Koop-Runde gibt es nicht. Code prüfen.';
  end if;
  perform public.shop_lobby_advance(lobby_id);
  select * into result from public.shop_lobbies_public where id = lobby_id;
  return result;
end;
$$;

-- Ersteller (oder Admin): vor dem Start abbrechen, danach das Match beenden
create or replace function public.shop_close_lobby(p_code text)
returns public.shop_lobbies_public language plpgsql security definer set search_path = '' as $$
declare
  lobby public.shop_lobbies;
  result public.shop_lobbies_public;
begin
  select * into lobby from public.shop_lobbies where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or not (lobby.host_id = auth.uid() or public.is_admin()) then
    raise exception 'Beenden darf nur, wer die Runde eröffnet hat.';
  end if;
  update public.shop_lobbies set open = false, ended_at = coalesce(ended_at, now()),
    vs_at = case when started_at is not null then coalesce(vs_at, now()) end
    where id = lobby.id;
  update public.shop_runs set status = 'done', score = public.shop_score(items), updated_at = now()
    where lobby_id = lobby.id and status <> 'done';
  select * into result from public.shop_lobbies_public where id = lobby.id;
  return result;
end;
$$;

-- ---------- Kiste öffnen ----------
-- Allein: neue Runde mit eigenen vier Kisten. Koop: die eigene Runde bekommt die
-- Kiste, sofern sie noch frei ist. Die Kisten-Werte kommen allein sofort zurück,
-- im Koop erst, wenn alle ihre Kiste haben.
create or replace function public.shop_open_chest(p_chest int, p_code text default null, p_stream boolean default false)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  lobby public.shop_lobbies;
  chests int[];
  secs int := coalesce((select shop_seconds from public.shop_settings where id = 1), 90);
  streamed boolean := coalesce(p_stream, false) and public.is_admin();
  result public.shop_runs;
  taker text;
begin
  if uid is null then
    raise exception 'Bitte zuerst anmelden.';
  end if;
  if not public.feature_open('shop') then
    raise exception 'Der Kisten-Shop ist noch nicht freigeschaltet.';
  end if;
  if p_chest is null or p_chest not between 0 and 3 then
    raise exception 'Diese Kiste gibt es nicht.';
  end if;
  -- Im Stream zeigt nur ein Admin seine Runde, und immer nur eine
  if streamed then
    update public.shop_runs set stream = false where stream;
  end if;

  if nullif(btrim(p_code), '') is null then
    chests := public.shop_random_chests();
    -- Alte Solo-Runden sind damit vorbei
    update public.shop_runs set status = 'done', updated_at = now()
      where user_id = uid and lobby_id is null and status <> 'done';
    insert into public.shop_runs (user_id, player, stream, chest, coins, shop_until)
      values (uid, public.my_name(), streamed, p_chest, chests[p_chest + 1], now() + make_interval(secs => secs))
      returning * into result;
    return json_build_object('run', row_to_json(result), 'chests', chests);
  end if;

  select * into lobby from public.shop_lobbies where code = upper(btrim(p_code)) for update;
  if not found then
    raise exception 'Diese Koop-Runde gibt es nicht. Code prüfen.';
  end if;
  if not lobby.open or lobby.ended_at is not null then
    raise exception 'Diese Koop-Runde ist schon beendet.';
  end if;
  if lobby.started_at is null then
    raise exception 'Warte, bis % die Runde startet.', coalesce(nullif(lobby.host_name, ''), 'der Ersteller');
  end if;
  select * into result from public.shop_runs where lobby_id = lobby.id and user_id = uid for update;
  if not found then
    raise exception 'Du spielst in dieser Koop-Runde nicht mit.';
  end if;
  if result.status <> 'choosing' then
    raise exception 'Du hast schon eine Kiste.';
  end if;
  select player into taker from public.shop_runs where lobby_id = lobby.id and chest = p_chest;
  if found then
    raise exception 'Die Kiste hat sich schon % geschnappt.', taker;
  end if;
  update public.shop_runs set chest = p_chest, coins = lobby.chests[p_chest + 1], status = 'opened',
    stream = stream or streamed, updated_at = now()
    where id = result.id;
  perform public.shop_lobby_advance(lobby.id);
  select * into result from public.shop_runs where id = result.id;
  return json_build_object('run', row_to_json(result),
    'chests', (select v.chests from public.shop_lobbies_public v where v.id = lobby.id));
end;
$$;

-- ---------- Einkaufen, Abhaken, Beenden – im Koop mit Phasen ----------
create or replace function public.shop_done_shopping(p_run uuid)
returns public.shop_runs language plpgsql security definer set search_path = '' as $$
declare
  r public.shop_runs := public.shop_my_run(p_run);
begin
  if r.status = 'shopping' then
    update public.shop_runs set status = 'playing', updated_at = now() where id = r.id returning * into r;
  end if;
  if r.lobby_id is not null then
    perform public.shop_lobby_advance(r.lobby_id);
    select * into r from public.shop_runs where id = r.id;
  end if;
  return r;
end;
$$;

create or replace function public.shop_mark(p_run uuid, p_index int, p_found boolean)
returns public.shop_runs language plpgsql security definer set search_path = '' as $$
declare
  r public.shop_runs := public.shop_my_run(p_run);
  next jsonb;
begin
  if r.lobby_id is not null and (select vs_at from public.shop_lobbies where id = r.lobby_id) is null then
    raise exception 'Warte, bis alle eingekauft haben – dann geht das Duell los.';
  end if;
  if r.status <> 'playing' then
    raise exception 'Abhaken geht, sobald der Einkauf vorbei ist und bis die Runde endet.';
  end if;
  if p_index is null or p_index < 0 or p_index >= jsonb_array_length(r.items) then
    raise exception 'Dieses Item gibt es in deiner Runde nicht.';
  end if;
  next := jsonb_set(r.items, array[p_index::text, 'found'], to_jsonb(coalesce(p_found, false)));
  update public.shop_runs set items = next, score = public.shop_score(next), updated_at = now()
    where id = r.id returning * into r;
  return r;
end;
$$;

create or replace function public.shop_finish(p_run uuid)
returns public.shop_runs language plpgsql security definer set search_path = '' as $$
declare
  r public.shop_runs := public.shop_my_run(p_run);
begin
  if r.lobby_id is not null and (select vs_at from public.shop_lobbies where id = r.lobby_id) is null then
    raise exception 'Warte, bis alle eingekauft haben – dann geht das Duell los.';
  end if;
  update public.shop_runs set status = 'done', score = public.shop_score(items), updated_at = now()
    where id = r.id returning * into r;
  if r.lobby_id is not null then
    perform public.shop_lobby_advance(r.lobby_id);
  end if;
  return r;
end;
$$;

revoke execute on function public.shop_join_lobby(text) from public, anon;
revoke execute on function public.shop_leave_lobby(text) from public, anon;
revoke execute on function public.shop_start_lobby(text) from public, anon;
revoke execute on function public.shop_lobby_tick(text) from public, anon;
revoke execute on function public.shop_close_lobby(text) from public, anon;
revoke execute on function public.shop_create_lobby() from public, anon;
revoke execute on function public.shop_open_chest(int, text, boolean) from public, anon;
revoke execute on function public.shop_done_shopping(uuid) from public, anon;
revoke execute on function public.shop_mark(uuid, int, boolean) from public, anon;
revoke execute on function public.shop_finish(uuid) from public, anon;
grant execute on function public.shop_join_lobby(text) to authenticated;
grant execute on function public.shop_leave_lobby(text) to authenticated;
grant execute on function public.shop_start_lobby(text) to authenticated;
grant execute on function public.shop_lobby_tick(text) to authenticated;
grant execute on function public.shop_close_lobby(text) to authenticated;
grant execute on function public.shop_create_lobby() to authenticated;
grant execute on function public.shop_open_chest(int, text, boolean) to authenticated;
grant execute on function public.shop_done_shopping(uuid) to authenticated;
grant execute on function public.shop_mark(uuid, int, boolean) to authenticated;
grant execute on function public.shop_finish(uuid) to authenticated;
