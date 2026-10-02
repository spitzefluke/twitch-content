-- ============================================================
-- StreamHelp: Haustier – Tierwahl und Ei → Baby → Erwachsen
--   · pet.species: dino | cat | fox | axolotl | penguin | dragon (wählt der Streamer)
--   · pet.stage: egg | baby | adult
--       Ei:   schlüpft nach hatch_feeds × Füttern (Standard 50)
--       Baby: wächst nach grow_days Streams mit guter Laune (Standard 5). Ein „Stream mit
--             guter Laune“ ist ein Tag (deutsche Zeit), an dem das Baby mindestens 3 × gefüttert wurde.
--   · stage_helpers: wer im aktuellen Stadium gefüttert hat (für den Dank im Chat)
--   · pet_events kind 'stage' (text = neues Stadium, who = die ersten Helfer) – Overlay zeigt
--     dazu einen Alert mit Konfetti, der Chat-Bot dankt den Helfern
-- Gezählt wird in einem Trigger: Füttern über den Chat (Edge Function) und über die Webseite
-- (pet_action) laufen beide über pet.fed_count. Setzt ein Admin das Stadium von Hand
-- (z. B. „Neues Ei“), beginnen die Zähler von vorn. Mehrfach ausführbar.
-- ============================================================

alter table public.pet add column if not exists species text not null default 'dino';
alter table public.pet drop constraint if exists pet_species_check;
alter table public.pet add constraint pet_species_check check (species in ('dino', 'cat', 'fox', 'axolotl', 'penguin', 'dragon'));
alter table public.pet add column if not exists stage text not null default 'adult';
alter table public.pet drop constraint if exists pet_stage_check;
alter table public.pet add constraint pet_stage_check check (stage in ('egg', 'baby', 'adult'));
alter table public.pet add column if not exists hatch_feeds int not null default 50;
alter table public.pet drop constraint if exists pet_hatch_feeds_check;
alter table public.pet add constraint pet_hatch_feeds_check check (hatch_feeds between 5 and 500);
alter table public.pet add column if not exists grow_days int not null default 5;
alter table public.pet drop constraint if exists pet_grow_days_check;
alter table public.pet add constraint pet_grow_days_check check (grow_days between 1 and 30);
alter table public.pet add column if not exists stage_feeds int not null default 0;
alter table public.pet add column if not exists good_days int not null default 0;
alter table public.pet add column if not exists feed_day date;
alter table public.pet add column if not exists day_feeds int not null default 0;
alter table public.pet add column if not exists stage_helpers text[] not null default '{}';
alter table public.pet add column if not exists stage_changed_at timestamptz;

alter table public.pet_events drop constraint if exists pet_events_kind_check;
alter table public.pet_events add constraint pet_events_kind_check check (kind in ('feed', 'pet', 'say', 'costume', 'stage'));

-- Stadium weiterzählen. security definer: schreibt den 'stage'-Eintrag in pet_events, auch wenn
-- ein Admin über die Webseite füttert (pet_events hat keine Schreib-Regel für angemeldete Nutzer).
create or replace function public.pet_stage_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Europe/Berlin')::date;
  helpers text;
begin
  -- Von Hand gesetzt (Admin): Zähler von vorn
  if new.stage is distinct from old.stage then
    new.stage_feeds := 0;
    new.good_days := 0;
    new.day_feeds := 0;
    new.feed_day := null;
    new.stage_changed_at := now();
    new.stage_helpers := '{}';
    return new;
  end if;
  -- Nur echtes Füttern zählt; erwachsene Tiere zählen nicht mehr
  if new.fed_count <= old.fed_count or new.stage = 'adult' then
    return new;
  end if;

  -- Helfer merken (ohne Doppelte, die letzten 20)
  if btrim(coalesce(new.last_fed_by, '')) <> '' and not (new.last_fed_by = any(new.stage_helpers)) then
    new.stage_helpers := new.stage_helpers || left(btrim(new.last_fed_by), 40);
    if cardinality(new.stage_helpers) > 20 then
      new.stage_helpers := new.stage_helpers[cardinality(new.stage_helpers) - 19:];
    end if;
  end if;
  helpers := left(array_to_string(new.stage_helpers[1:5], ', '), 200);

  if new.stage = 'egg' then
    new.stage_feeds := old.stage_feeds + 1;
    if new.stage_feeds >= new.hatch_feeds then
      new.stage := 'baby';
      new.stage_feeds := 0;
      new.good_days := 0;
      new.day_feeds := 0;
      new.feed_day := null;
      new.stage_changed_at := now();
      insert into public.pet_events (kind, who, text) values ('stage', helpers, 'baby');
      new.stage_helpers := '{}';
    end if;
  elsif new.stage = 'baby' then
    if new.feed_day is distinct from today then
      new.feed_day := today;
      new.day_feeds := 0;
    end if;
    new.day_feeds := new.day_feeds + 1;
    new.stage_feeds := old.stage_feeds + 1;
    if new.day_feeds = 3 then
      new.good_days := old.good_days + 1;
    end if;
    if new.good_days >= new.grow_days then
      new.stage := 'adult';
      new.stage_feeds := 0;
      new.stage_changed_at := now();
      insert into public.pet_events (kind, who, text) values ('stage', helpers, 'adult');
      new.stage_helpers := '{}';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.pet_stage_progress() from public, anon, authenticated;
drop trigger if exists on_pet_stage on public.pet;
create trigger on_pet_stage
  before update on public.pet
  for each row execute function public.pet_stage_progress();
