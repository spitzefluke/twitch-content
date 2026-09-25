-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Laufband im OBS-Overlay: Texte, die langsam von rechts nach links
-- durchlaufen – andere Seiten und Socials. Das Laufband ist immer an,
-- Admins pflegen die Texte im OBS-Dialog der Webseite.
-- {seite} wird im Overlay durch die Adresse dieser Webseite ersetzt.
-- Mehrfach ausführbar.
-- ============================================================

create table if not exists public.ticker (
  id int primary key default 1 check (id = 1),
  items text[] not null default array[
    '🟣 twitch.tv/zugfahrer_davetv',
    '🚂 Content-Stellwerk: {seite}'
  ],
  updated_at timestamptz not null default now(),
  check (cardinality(items) between 1 and 30)
);
insert into public.ticker (id) values (1) on conflict (id) do nothing;
alter table public.ticker enable row level security;

drop policy if exists "ticker: lesen für alle" on public.ticker;
create policy "ticker: lesen für alle" on public.ticker
  for select to anon, authenticated using (true);
drop policy if exists "ticker: ändern nur admin" on public.ticker;
create policy "ticker: ändern nur admin" on public.ticker
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.ticker to anon;

-- Leere Zeilen raus, jede Zeile höchstens 120 Zeichen
create or replace function public.before_ticker_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.items := array(
    select left(btrim(t), 120) from unnest(new.items) as t where btrim(t) <> '' limit 30);
  if cardinality(new.items) = 0 then
    raise exception 'Das Laufband braucht mindestens einen Text.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists on_ticker_update on public.ticker;
create trigger on_ticker_update
  before update on public.ticker
  for each row execute function public.before_ticker_update();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ticker'
  ) then
    alter publication supabase_realtime add table public.ticker;
  end if;
end;
$$;
