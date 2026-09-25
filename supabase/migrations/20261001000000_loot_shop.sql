-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Kisten-Shop: Wähle eine von vier Kisten, bekomm Goldbarren und kauf dir
-- in kurzer Zeit Items im Shop (seltener = teurer). Dann die Items im Spiel
-- finden: jedes gefundene Item 1 Punkt, alle gefunden 10 Punkte extra.
-- Koop: Eine Runde mit Code, alle wählen aus denselben vier Kisten, Rangliste live.
--
--   · shop_settings: Katalog, Preise je Seltenheit, Einkaufszeit (Admins ändern)
--   · shop_lobbies: Koop-Runden mit Code
--   · shop_runs: eine Runde pro Spieler – geschrieben nur über die Funktionen unten,
--     damit Goldbarren und Preise vom Server kommen
--   · Daves Runde (stream = true) ist im OBS-Overlay zu sehen
-- Freigeschaltet für Zuschauer am 05.10.2026. Mehrfach ausführbar.
-- ============================================================

-- ---------- Kachel ----------
alter table public.tiles drop constraint if exists tiles_kind_check;
alter table public.tiles add constraint tiles_kind_check
  check (kind in ('wheel', 'countdown', 'prank', 'bingo', 'questions', 'pet', 'shop'));

do $$
begin
  if not exists (select 1 from public.tiles where id = 'shop') then
    update public.tiles set position = position + 1 where kind = 'countdown';
    insert into public.tiles (id, position, kind, title, description, theme, target_at) values
      ('shop', (select coalesce(max(position), 1) + 1 from public.tiles where kind <> 'countdown'), 'shop',
       'Kisten-Shop',
       'Wähl eine Kiste, kauf dir mit den Goldbarren Items und finde sie im Spiel. Allein oder im Koop gegen andere.',
       'shop', '2026-10-05 00:00:00+02');
  end if;
end;
$$;

-- ---------- Einstellungen ----------
create table if not exists public.shop_settings (
  id int primary key default 1 check (id = 1),
  -- [{name, rarity}] – rarity wie beim Bingo (common … mythic, exotic)
  items jsonb not null default '[
    {"name":"Pistole","rarity":"common"},{"name":"Sturmgewehr","rarity":"common"},
    {"name":"Taktische Schrotflinte","rarity":"common"},{"name":"Verband","rarity":"common"},
    {"name":"Pump","rarity":"uncommon"},{"name":"MP","rarity":"uncommon"},
    {"name":"Mini-Schild","rarity":"uncommon"},{"name":"Granate","rarity":"uncommon"},
    {"name":"Scharfschützengewehr","rarity":"rare"},{"name":"Schildtrank","rarity":"rare"},
    {"name":"Enterhaken","rarity":"rare"},{"name":"Burst-Sturmgewehr","rarity":"rare"},
    {"name":"SCAR","rarity":"epic"},{"name":"Raketenwerfer","rarity":"epic"},
    {"name":"Medkit","rarity":"epic"},{"name":"Sprungpad","rarity":"epic"},
    {"name":"Gold-SCAR","rarity":"legendary"},{"name":"Gold-Pump","rarity":"legendary"},
    {"name":"Heilsprudel","rarity":"legendary"},
    {"name":"Boss-Waffe","rarity":"mythic"},{"name":"Mythisches Item","rarity":"mythic"}
  ]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 60),
  prices jsonb not null default '{"common":10,"uncommon":20,"rare":35,"epic":55,"legendary":85,"mythic":130,"exotic":110}'::jsonb
    check (jsonb_typeof(prices) = 'object'),
  shop_seconds int not null default 90 check (shop_seconds between 20 and 600),
  updated_at timestamptz not null default now()
);
insert into public.shop_settings (id) values (1) on conflict (id) do nothing;
alter table public.shop_settings enable row level security;
drop policy if exists "shop_settings: lesen für alle" on public.shop_settings;
create policy "shop_settings: lesen für alle" on public.shop_settings
  for select to anon, authenticated using (true);
drop policy if exists "shop_settings: ändern nur admin" on public.shop_settings;
create policy "shop_settings: ändern nur admin" on public.shop_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.shop_settings to anon;

-- Katalog aufräumen: Name 1–30 Zeichen, bekannte Seltenheit, jeder Name nur einmal
create or replace function public.before_shop_settings_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.items := coalesce((
    select jsonb_agg(jsonb_build_object('name', n, 'rarity', r) order by ord)
    from (
      select distinct on (lower(n)) n, r, ord from (
        select left(btrim(e ->> 'name'), 30) as n, e ->> 'rarity' as r, ord
        from jsonb_array_elements(new.items) with ordinality as t(e, ord)
      ) x
      where n <> '' and r in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'exotic')
      order by lower(n), ord
    ) y
  ), '[]'::jsonb);
  if jsonb_array_length(new.items) = 0 then
    raise exception 'Der Shop braucht mindestens ein Item.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists on_shop_settings_update on public.shop_settings;
create trigger on_shop_settings_update
  before update on public.shop_settings
  for each row execute function public.before_shop_settings_update();

-- ---------- Koop-Runden ----------
create table if not exists public.shop_lobbies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{5}$'),
  host_id uuid not null references auth.users on delete cascade,
  host_name text not null default '',
  chests int[] not null check (cardinality(chests) = 4),
  open boolean not null default true,
  created_at timestamptz not null default now()
);
-- Ohne Policies: Die Kisten-Werte bleiben geheim, gelesen wird über shop_lobbies_public
alter table public.shop_lobbies enable row level security;

create or replace view public.shop_lobbies_public with (security_invoker = off) as
  select id, code, host_name, open, created_at from public.shop_lobbies;
revoke all on public.shop_lobbies_public from public;
grant select on public.shop_lobbies_public to anon, authenticated;

-- ---------- Runden ----------
create table if not exists public.shop_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  player text not null default '',
  lobby_id uuid references public.shop_lobbies on delete cascade,
  stream boolean not null default false,
  chest int not null check (chest between 0 and 3),
  coins int not null check (coins > 0),
  spent int not null default 0 check (spent >= 0 and spent <= coins),
  -- [{name, rarity, price, found}]
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  status text not null default 'shopping' check (status in ('shopping', 'playing', 'done')),
  shop_until timestamptz not null,
  score int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shop_runs_user_idx on public.shop_runs (user_id, created_at desc);
create index if not exists shop_runs_lobby_idx on public.shop_runs (lobby_id);
create index if not exists shop_runs_stream_idx on public.shop_runs (stream, created_at desc) where stream;
create unique index if not exists shop_runs_one_per_lobby on public.shop_runs (lobby_id, user_id) where lobby_id is not null;
alter table public.shop_runs enable row level security;

-- Eigene Runden, Koop-Runden (Rangliste) und Daves Runde im Stream sind lesbar
drop policy if exists "shop_runs: lesen" on public.shop_runs;
create policy "shop_runs: lesen" on public.shop_runs
  for select to authenticated using (user_id = (select auth.uid()) or lobby_id is not null or stream);
drop policy if exists "shop_runs: lesen für overlay" on public.shop_runs;
create policy "shop_runs: lesen für overlay" on public.shop_runs
  for select to anon using (stream or lobby_id is not null);
grant select on public.shop_runs to anon;

-- Punkte: je gefundenes Item 1, alle gefunden 10 extra
create or replace function public.shop_score(p_items jsonb)
returns int language sql immutable set search_path = '' as $$
  select coalesce(sum(case when (e ->> 'found')::boolean then 1 else 0 end), 0)::int
    + case when jsonb_array_length(p_items) > 0
            and not exists (select 1 from jsonb_array_elements(p_items) e2 where not coalesce((e2 ->> 'found')::boolean, false))
           then 10 else 0 end
  from jsonb_array_elements(p_items) e;
$$;

-- Vier Kisten: klein, mittel, groß, Jackpot – gemischt
create or replace function public.shop_random_chests()
returns int[] language sql volatile set search_path = '' as $$
  select array_agg(v order by random()) from (values
    (45 + floor(random() * 21)::int),
    (90 + floor(random() * 31)::int),
    (140 + floor(random() * 31)::int),
    (200 + floor(random() * 41)::int)
  ) t(v);
$$;

-- Kiste öffnen = neue Runde. Mit Code im Koop (gleiche Kisten für alle).
-- Gibt die Runde und alle vier Kisten zurück (zum Aufdecken) – die Kisten
-- stehen nicht in shop_runs, sonst könnten Koop-Mitspieler vorher nachsehen.
drop function if exists public.shop_open_chest(int, text, boolean);
create or replace function public.shop_open_chest(p_chest int, p_code text default null, p_stream boolean default false)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  lobby public.shop_lobbies;
  chests int[];
  secs int := coalesce((select shop_seconds from public.shop_settings where id = 1), 90);
  result public.shop_runs;
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
  if nullif(btrim(p_code), '') is not null then
    select * into lobby from public.shop_lobbies where code = upper(btrim(p_code));
    if not found then
      raise exception 'Diese Koop-Runde gibt es nicht. Code prüfen.';
    end if;
    if not lobby.open then
      raise exception 'Diese Koop-Runde ist schon beendet.';
    end if;
    if exists (select 1 from public.shop_runs where lobby_id = lobby.id and user_id = uid) then
      raise exception 'Du spielst in dieser Koop-Runde schon mit.';
    end if;
    chests := lobby.chests;
  else
    chests := public.shop_random_chests();
    -- Alte Solo-Runden sind damit vorbei
    update public.shop_runs set status = 'done', updated_at = now()
      where user_id = uid and lobby_id is null and status <> 'done';
  end if;
  -- Im Stream zeigt nur ein Admin seine Runde, und immer nur eine
  if coalesce(p_stream, false) and public.is_admin() then
    update public.shop_runs set stream = false where stream;
  end if;
  insert into public.shop_runs (user_id, player, lobby_id, stream, chest, coins, shop_until)
    values (uid, public.my_name(), lobby.id, coalesce(p_stream, false) and public.is_admin(), p_chest,
            chests[p_chest + 1], now() + make_interval(secs => secs))
    returning * into result;
  return json_build_object('run', row_to_json(result), 'chests', chests);
end;
$$;

create or replace function public.shop_my_run(p_run uuid)
returns public.shop_runs language plpgsql security definer set search_path = '' as $$
declare
  r public.shop_runs;
begin
  select * into r from public.shop_runs where id = p_run and user_id = auth.uid() for update;
  if not found then
    raise exception 'Diese Runde gibt es nicht.';
  end if;
  return r;
end;
$$;
revoke execute on function public.shop_my_run(uuid) from public, anon, authenticated;

-- Kaufen: Preis und Katalog kommen vom Server
create or replace function public.shop_buy(p_run uuid, p_name text)
returns public.shop_runs language plpgsql security definer set search_path = '' as $$
declare
  r public.shop_runs := public.shop_my_run(p_run);
  cfg public.shop_settings;
  item jsonb;
  price int;
begin
  if r.status <> 'shopping' then
    raise exception 'Der Einkauf ist schon vorbei.';
  end if;
  if now() > r.shop_until + interval '3 seconds' then
    update public.shop_runs set status = 'playing', updated_at = now() where id = r.id;
    raise exception 'Die Zeit im Shop ist abgelaufen.';
  end if;
  select * into cfg from public.shop_settings where id = 1;
  select e into item from jsonb_array_elements(cfg.items) e where lower(e ->> 'name') = lower(btrim(p_name)) limit 1;
  if item is null then
    raise exception 'Dieses Item gibt es im Shop nicht.';
  end if;
  if exists (select 1 from jsonb_array_elements(r.items) e where lower(e ->> 'name') = lower(item ->> 'name')) then
    raise exception 'Das hast du schon gekauft.';
  end if;
  price := coalesce((cfg.prices ->> (item ->> 'rarity'))::int, 10);
  if r.spent + price > r.coins then
    raise exception 'Dafür reichen deine Goldbarren nicht.';
  end if;
  update public.shop_runs set
    items = items || jsonb_build_array(jsonb_build_object('name', item ->> 'name', 'rarity', item ->> 'rarity', 'price', price, 'found', false)),
    spent = spent + price,
    updated_at = now()
  where id = r.id
  returning * into r;
  return r;
end;
$$;

create or replace function public.shop_done_shopping(p_run uuid)
returns public.shop_runs language plpgsql security definer set search_path = '' as $$
declare
  r public.shop_runs := public.shop_my_run(p_run);
begin
  if r.status = 'shopping' then
    update public.shop_runs set status = 'playing', updated_at = now() where id = r.id returning * into r;
  end if;
  return r;
end;
$$;

-- Im Spiel gefunden (oder doch nicht)
create or replace function public.shop_mark(p_run uuid, p_index int, p_found boolean)
returns public.shop_runs language plpgsql security definer set search_path = '' as $$
declare
  r public.shop_runs := public.shop_my_run(p_run);
  next jsonb;
begin
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
  update public.shop_runs set status = 'done', score = public.shop_score(items), updated_at = now()
    where id = r.id returning * into r;
  return r;
end;
$$;

-- Koop-Runde eröffnen: Code aus gut lesbaren Zeichen, Kisten für alle gleich
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
  select * into result from public.shop_lobbies_public where id = lobby.id;
  return result;
end;
$$;

create or replace function public.shop_close_lobby(p_code text)
returns public.shop_lobbies_public language plpgsql security definer set search_path = '' as $$
declare
  result public.shop_lobbies_public;
begin
  update public.shop_lobbies set open = false
    where code = upper(btrim(p_code)) and (host_id = auth.uid() or public.is_admin());
  if not found then
    raise exception 'Beenden darf nur, wer die Runde eröffnet hat.';
  end if;
  select * into result from public.shop_lobbies_public where code = upper(btrim(p_code));
  return result;
end;
$$;

revoke execute on function public.shop_open_chest(int, text, boolean) from public, anon;
revoke execute on function public.shop_buy(uuid, text) from public, anon;
revoke execute on function public.shop_done_shopping(uuid) from public, anon;
revoke execute on function public.shop_mark(uuid, int, boolean) from public, anon;
revoke execute on function public.shop_finish(uuid) from public, anon;
revoke execute on function public.shop_create_lobby() from public, anon;
revoke execute on function public.shop_close_lobby(text) from public, anon;
grant execute on function public.shop_open_chest(int, text, boolean) to authenticated;
grant execute on function public.shop_buy(uuid, text) to authenticated;
grant execute on function public.shop_done_shopping(uuid) to authenticated;
grant execute on function public.shop_mark(uuid, int, boolean) to authenticated;
grant execute on function public.shop_finish(uuid) to authenticated;
grant execute on function public.shop_create_lobby() to authenticated;
grant execute on function public.shop_close_lobby(text) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['shop_runs', 'shop_settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
