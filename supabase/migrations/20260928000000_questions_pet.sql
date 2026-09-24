-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Zwei neue Content-Ideen:
--
-- 1) Unangenehme Fragen
--    Zuschauer schreiben auf der Webseite Fragen an Dave. Admins prüfen sie,
--    freigegebene Fragen zeigt ein Admin im OBS-Overlay. Dave beantwortet sie –
--    oder muss eine Bestrafung machen, die zufällig gezogen wird.
--    · questions: die Fragen (jeder sieht nur seine eigenen, Admins alle)
--    · question_stage: was gerade im Stream steht, lesbar auch für OBS
--    · question_show(), question_resolve(), question_hide(): nur Admins
--
-- 2) Daves Dino (Tamagotchi)
--    Ein Dino läuft durchs Overlay, sagt freche Sprüche und knabbert an den
--    Zuschauern, wenn er Hunger hat. Zuschauer füttern und streicheln ihn auf
--    der Webseite.
--    · pet: Name, Sprüche, wann zuletzt gefüttert (lesbar auch für OBS)
--    · pet_events: Füttern, Streicheln, Sprüche – Feed fürs Overlay
--    · pet_action(): Füttern/Streicheln mit Pause pro Person, pet_say(): nur Admins
--
-- Beide Kacheln haben wie „Ärgere den Dave“ ein Startdatum für Zuschauer.
-- Mehrfach ausführbar.
-- ============================================================

-- ---------- Kacheln ----------
alter table public.tiles drop constraint if exists tiles_kind_check;
alter table public.tiles add constraint tiles_kind_check
  check (kind in ('wheel', 'countdown', 'prank', 'bingo', 'questions', 'pet'));

do $$
declare
  start timestamptz := (select target_at from public.tiles where kind = 'prank' order by position limit 1);
begin
  if not exists (select 1 from public.tiles where id = 'questions') then
    update public.tiles set position = position + 1 where kind = 'countdown';
    insert into public.tiles (id, position, kind, title, description, theme, target_at) values
      ('questions', (select coalesce(max(position), 1) + 1 from public.tiles where kind <> 'countdown'), 'questions',
       'Unangenehme Fragen',
       'Stell Dave die Fragen, die sich sonst keiner traut. Kneift er, gibt es eine Bestrafung – live im Stream.',
       'questions', start);
  end if;
  if not exists (select 1 from public.tiles where id = 'pet') then
    update public.tiles set position = position + 1 where kind = 'countdown';
    insert into public.tiles (id, position, kind, title, description, theme, target_at) values
      ('pet', (select coalesce(max(position), 1) + 1 from public.tiles where kind <> 'countdown'), 'pet',
       'Daves Dino',
       'Ein kleiner Dino wohnt in Daves Stream. Füttere ihn – sonst knabbert er an den Zuschauern.',
       'pet', start);
  end if;
end;
$$;

-- Ist die Idee für die aufrufende Person schon freigeschaltet? Admins immer.
create or replace function public.feature_open(p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or coalesce(
    (select target_at is null or target_at <= now() from public.tiles where kind = p_kind order by position limit 1),
    false);
$$;

-- Wer? Der Name aus dem Profil, nie vom Browser.
create or replace function public.my_name()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select username from public.profiles where id = auth.uid()), 'Zuschauer');
$$;

-- ============================================================
-- 1) Unangenehme Fragen
-- ============================================================
create table if not exists public.questions (
  id bigint generated always as identity primary key,
  text text not null check (char_length(btrim(text)) between 5 and 200),
  anonymous boolean not null default false,
  author text not null default '',
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'done')),
  outcome text check (outcome in ('answered', 'punished', 'skipped')),
  punishment text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  shown_at timestamptz
);
create index if not exists questions_status_idx on public.questions (status, created_at);
create index if not exists questions_user_idx on public.questions (user_id, created_at desc);
alter table public.questions enable row level security;

drop policy if exists "questions: eigene oder admin" on public.questions;
create policy "questions: eigene oder admin" on public.questions
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "questions: stellen" on public.questions;
create policy "questions: stellen" on public.questions
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "questions: prüfen nur admin" on public.questions;
create policy "questions: prüfen nur admin" on public.questions
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "questions: zurückziehen oder admin" on public.questions;
create policy "questions: zurückziehen oder admin" on public.questions
  for delete to authenticated using (
    (user_id = (select auth.uid()) and status = 'pending') or (select public.is_admin()));

-- Neue Frage: Name aus dem Profil, immer erst „zu prüfen“, höchstens 3 pro Tag.
create or replace function public.before_question_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.feature_open('questions') then
    raise exception '„Unangenehme Fragen“ ist noch nicht freigeschaltet.';
  end if;
  if not public.is_admin()
     and (select count(*) from public.questions
          where user_id = new.user_id and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Du hast heute schon 3 Fragen gestellt. Morgen geht es weiter.';
  end if;
  new.text := btrim(new.text);
  new.author := coalesce((select username from public.profiles where id = new.user_id), 'Zuschauer');
  new.status := 'pending';
  new.outcome := null;
  new.punishment := null;
  new.reviewed_at := null;
  new.shown_at := null;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists on_question_insert on public.questions;
create trigger on_question_insert
  before insert on public.questions
  for each row execute function public.before_question_insert();

-- Die Bühne: eine Zeile, was gerade im Stream steht. Der Name ist schon
-- „Anonym“, wenn die Person das wollte – der echte Name bleibt in questions.
create table if not exists public.question_stage (
  id int primary key default 1 check (id = 1),
  question_id bigint,
  text text not null default '',
  author text not null default '',
  state text not null default 'hidden' check (state in ('hidden', 'ask', 'answered', 'punished', 'skipped')),
  punishment text,
  punishments text[] not null default array[
    '10 Liegestütze – jetzt sofort',
    'Nächste Runde nur mit Pistolen',
    'Bis zum nächsten Kill nur mit Piepsstimme reden',
    'Den Refrain eines Liedes singen, das der Chat aussucht',
    'Der Chat sucht den nächsten Skin aus',
    'Nächste Runde ohne Heilung',
    '30 Sekunden Hampelmann',
    'Eine Minute lang jedem im Chat ein Kompliment machen',
    'Ein Glas Wasser auf ex',
    'Nächste Runde mit invertierter Maus/Kamera'
  ],
  updated_at timestamptz not null default now(),
  check (cardinality(punishments) between 1 and 50)
);
insert into public.question_stage (id) values (1) on conflict (id) do nothing;
alter table public.question_stage enable row level security;

drop policy if exists "question_stage: lesen für alle" on public.question_stage;
create policy "question_stage: lesen für alle" on public.question_stage
  for select to anon, authenticated using (true);
drop policy if exists "question_stage: ändern nur admin" on public.question_stage;
create policy "question_stage: ändern nur admin" on public.question_stage
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.question_stage to anon;

-- Bestrafungen: nicht leer, nicht zu lang
create or replace function public.before_question_stage_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.punishments := array(
    select left(btrim(p), 100) from unnest(new.punishments) as p where btrim(p) <> '' limit 50);
  if cardinality(new.punishments) = 0 then
    raise exception 'Es braucht mindestens eine Bestrafung.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists on_question_stage_update on public.question_stage;
create trigger on_question_stage_update
  before update on public.question_stage
  for each row execute function public.before_question_stage_update();

-- Eine freigegebene Frage im Stream zeigen
create or replace function public.question_show(p_id bigint)
returns public.question_stage language plpgsql security definer set search_path = '' as $$
declare
  q public.questions;
  result public.question_stage;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen Fragen im Stream zeigen.';
  end if;
  select * into q from public.questions where id = p_id;
  if not found then
    raise exception 'Diese Frage gibt es nicht mehr.';
  end if;
  if q.status not in ('approved', 'done') then
    raise exception 'Die Frage muss erst freigegeben werden.';
  end if;
  update public.questions set shown_at = now() where id = p_id;
  update public.question_stage set
    question_id = q.id,
    text = q.text,
    author = case when q.anonymous then 'Anonym' else q.author end,
    state = 'ask',
    punishment = null
  where id = 1
  returning * into result;
  return result;
end;
$$;

-- Ausgang: beantwortet, Bestrafung (zufällig gezogen) oder übersprungen
create or replace function public.question_resolve(p_outcome text)
returns public.question_stage language plpgsql security definer set search_path = '' as $$
declare
  stage public.question_stage;
  pick text;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen das.';
  end if;
  if p_outcome not in ('answered', 'punished', 'skipped') then
    raise exception 'Unbekannter Ausgang.';
  end if;
  select * into stage from public.question_stage where id = 1 for update;
  if stage.question_id is null or stage.state = 'hidden' then
    raise exception 'Im Stream steht gerade keine Frage.';
  end if;
  if p_outcome = 'punished' then
    pick := stage.punishments[1 + floor(random() * cardinality(stage.punishments))::int];
  end if;
  update public.questions
    set status = 'done', outcome = p_outcome, punishment = pick
    where id = stage.question_id;
  update public.question_stage
    set state = p_outcome, punishment = pick
    where id = 1
    returning * into stage;
  return stage;
end;
$$;

create or replace function public.question_hide()
returns public.question_stage language plpgsql security definer set search_path = '' as $$
declare
  result public.question_stage;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen das.';
  end if;
  update public.question_stage set state = 'hidden' where id = 1 returning * into result;
  return result;
end;
$$;

revoke execute on function public.question_show(bigint) from public, anon;
revoke execute on function public.question_resolve(text) from public, anon;
revoke execute on function public.question_hide() from public, anon;
grant execute on function public.question_show(bigint) to authenticated;
grant execute on function public.question_resolve(text) to authenticated;
grant execute on function public.question_hide() to authenticated;

-- ============================================================
-- 2) Daves Dino
-- ============================================================
create table if not exists public.pet (
  id int primary key default 1 check (id = 1),
  name text not null default 'Rexi' check (char_length(btrim(name)) between 1 and 20),
  -- nach so vielen Minuten ohne Futter hat er Hunger und knabbert
  hungry_after int not null default 45 check (hungry_after between 5 and 720),
  last_fed_at timestamptz not null default now(),
  last_fed_by text not null default '',
  fed_count int not null default 0,
  phrases text[] not null default array[
    'Du Flitzpiepe!',
    'Der Rentner ist älter als mein Dino!',
    'Wer hat hier die Weiche falsch gestellt?',
    'Rawr! Das heißt „Hallo“.',
    'Ich bin 65 Millionen Jahre alt und DU spielst so?',
    'Nächster Halt: Niederlage.',
    'Bitte zurückbleiben, der Dino fährt ein!',
    'Chat, habt ihr Snacks dabei?',
    'Ich bin nicht dick, ich bin prähistorisch.',
    'Dave, du alte Pflaume!',
    'Zug hat Verspätung. Wie immer.',
    'Kurze Arme, große Klappe.'
  ],
  updated_at timestamptz not null default now()
);
insert into public.pet (id) values (1) on conflict (id) do nothing;
alter table public.pet enable row level security;

drop policy if exists "pet: lesen für alle" on public.pet;
create policy "pet: lesen für alle" on public.pet
  for select to anon, authenticated using (true);
drop policy if exists "pet: ändern nur admin" on public.pet;
create policy "pet: ändern nur admin" on public.pet
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.pet to anon;

create or replace function public.before_pet_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := btrim(new.name);
  new.phrases := array(
    select left(btrim(p), 80) from unnest(new.phrases) as p where btrim(p) <> '' limit 50);
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists on_pet_update on public.pet;
create trigger on_pet_update
  before update on public.pet
  for each row execute function public.before_pet_update();

-- Feed fürs Overlay. Ohne user_id: OBS liest die ganze Zeile ohne Anmeldung.
create table if not exists public.pet_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('feed', 'pet', 'say')),
  who text not null default '',
  text text not null default ''
);
create index if not exists pet_events_created_at_idx on public.pet_events (created_at desc);
alter table public.pet_events enable row level security;
drop policy if exists "pet_events: lesen für alle" on public.pet_events;
create policy "pet_events: lesen für alle" on public.pet_events
  for select to anon, authenticated using (true);
grant select on public.pet_events to anon, authenticated;

-- Pause pro Person: nicht lesbar, nur für pet_action()
create table if not exists public.pet_cooldowns (
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  last_at timestamptz not null,
  primary key (user_id, kind)
);
alter table public.pet_cooldowns enable row level security;

-- Füttern (alle 10 Minuten pro Person) oder Streicheln (jede Minute)
create or replace function public.pet_action(p_kind text)
returns public.pet_events language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  wait interval := case p_kind when 'feed' then interval '10 minutes' when 'pet' then interval '1 minute' end;
  last timestamptz;
  result public.pet_events;
begin
  if uid is null then
    raise exception 'Bitte zuerst anmelden.';
  end if;
  if wait is null then
    raise exception 'Unbekannte Aktion.';
  end if;
  if not public.feature_open('pet') then
    raise exception 'Daves Dino ist noch nicht freigeschaltet.';
  end if;
  if not public.is_admin() then
    select last_at into last from public.pet_cooldowns where user_id = uid and kind = p_kind;
    if last is not null and last > now() - wait then
      raise exception 'Kurz warten – noch % Sekunden.', ceil(extract(epoch from (last + wait - now())))::int
        using hint = 'cooldown';
    end if;
  end if;
  insert into public.pet_cooldowns (user_id, kind, last_at) values (uid, p_kind, now())
    on conflict (user_id, kind) do update set last_at = excluded.last_at;

  if p_kind = 'feed' then
    update public.pet set last_fed_at = now(), last_fed_by = public.my_name(), fed_count = fed_count + 1 where id = 1;
  end if;
  insert into public.pet_events (kind, who) values (p_kind, public.my_name()) returning * into result;
  delete from public.pet_events where created_at < now() - interval '2 days';
  return result;
end;
$$;

-- Admins lassen den Dino im Stream etwas sagen
create or replace function public.pet_say(p_text text)
returns public.pet_events language plpgsql security definer set search_path = '' as $$
declare
  result public.pet_events;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen dem Dino Worte in den Mund legen.';
  end if;
  if char_length(btrim(coalesce(p_text, ''))) not between 1 and 100 then
    raise exception 'Bitte 1 bis 100 Zeichen.';
  end if;
  insert into public.pet_events (kind, who, text) values ('say', public.my_name(), btrim(p_text)) returning * into result;
  return result;
end;
$$;

revoke execute on function public.pet_action(text) from public, anon;
revoke execute on function public.pet_say(text) from public, anon;
grant execute on function public.pet_action(text) to authenticated;
grant execute on function public.pet_say(text) to authenticated;

-- ---------- Realtime ----------
do $$
declare
  t text;
begin
  foreach t in array array['questions', 'question_stage', 'pet', 'pet_events'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
