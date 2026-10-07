-- ============================================================
-- StreamHelp: Games im Dashboard
--   · Jeder Kanal wählt seine Games (Fortnite, Minecraft, Just Chatting, Retro-Games …).
--     Oben bei den Content-Ideen stehen sie zur Auswahl; je Game zeigt die Seite die passenden
--     Ideen – Games ohne eigene Idee zeigen „Wir arbeiten an einer Content-Idee für dieses Game“.
--     Die Liste der Games steht in js/games.js (Webseite) und _shared/games.ts (Edge Function).
--   · Aktivieren von Hand (Streamer, Mods) oder automatisch: Geht der Stream live, liest die
--     Edge Function die Twitch-Kategorie (Watchtime-Durchgang aus dem OBS-Overlay) und schaltet
--     das passende Game an (games_live). „Automatisch“ lässt sich ausschalten.
-- Braucht 20261028000000_platform.sql (Tabellen je Kanal). Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('public.channels') is null then
    raise exception 'Erst die Plattform-Migration 20261028000000_platform.sql ausführen.';
  end if;
end;
$$;

create table if not exists core.stream_games (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  id int not null default 1 check (id = 1),
  active text[] not null default array['fortnite', 'just-chatting']::text[]
    check (cardinality(active) <= 40),
  current text not null default '' check (char_length(current) <= 40),  -- von Hand gewählt
  auto boolean not null default true,                                     -- Kategorie beim Live-Gehen lesen
  live_category text not null default '' check (char_length(live_category) <= 120),
  live_game text not null default '' check (char_length(live_game) <= 40),
  live_at timestamptz,                                                    -- zuletzt live gesehen
  updated_at timestamptz not null default now(),
  primary key (channel_id, id)
);
alter table core.stream_games enable row level security;
drop policy if exists "stream_games: lesen für alle" on core.stream_games;
create policy "stream_games: lesen für alle" on core.stream_games for select to anon, authenticated using (true);
revoke all on core.stream_games from anon, authenticated;
grant select on core.stream_games to anon, authenticated;
do $$ begin perform public.channel_view('stream_games'); end $$;
-- Schreiben nur über die Funktionen unten

-- Streamer und Mods: Games an/aus, gewähltes Game, Automatik
create or replace function public.games_save(p_active text[], p_current text, p_auto boolean)
returns public.stream_games language plpgsql security definer set search_path = '' as $$
declare
  g public.stream_games;
  v_active text[];
begin
  if not public.is_admin() then raise exception 'Games einstellen dürfen nur der Streamer und die Mods.'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_active
    from unnest(coalesce(p_active, '{}')) x where x ~ '^[a-z0-9-]{1,40}$';
  if cardinality(v_active) > 40 then raise exception 'Höchstens 40 Games.'; end if;
  insert into public.stream_games (id, active, current, auto, updated_at)
    values (1, v_active, coalesce(nullif(p_current, ''), ''), coalesce(p_auto, true), now())
  on conflict (channel_id, id) do update set
    active = excluded.active,
    current = case when excluded.current ~ '^[a-z0-9-]{0,40}$' then excluded.current else '' end,
    auto = excluded.auto,
    updated_at = now()
  returning * into g;
  return g;
end;
$$;
revoke execute on function public.games_save(text[], text, boolean) from public, anon;
grant execute on function public.games_save(text[], text, boolean) to authenticated;

-- Edge Function: Der Stream ist live in dieser Twitch-Kategorie (p_game: passendes Game oder '')
create or replace function public.games_live(p_category text, p_game text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_game text := case when coalesce(p_game, '') ~ '^[a-z0-9-]{1,40}$' then p_game else '' end;
begin
  insert into public.stream_games (id, live_category, live_game, live_at)
    values (1, left(coalesce(p_category, ''), 120), v_game, now())
  on conflict (channel_id, id) do update set
    live_category = excluded.live_category, live_game = excluded.live_game, live_at = now();
  -- Automatik: das Game des Streams gleich anschalten
  if v_game <> '' then
    update public.stream_games set active = active || v_game, updated_at = now()
      where id = 1 and auto and not (v_game = any(active));
  end if;
end;
$$;
revoke execute on function public.games_live(text, text) from public, anon, authenticated;
grant execute on function public.games_live(text, text) to service_role;

do $$ begin perform public.realtime_add('stream_games'); end $$;

notify pgrst, 'reload schema';
