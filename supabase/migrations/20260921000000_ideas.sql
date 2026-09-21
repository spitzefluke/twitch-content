-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Vorschläge aus der Community (Bereich „Vorschläge“ im Dashboard)
-- Mehrfach ausführbar.
-- ============================================================

create table if not exists public.ideas (
  id bigint generated always as identity primary key,
  text text not null check (char_length(text) between 3 and 120),
  author text not null default '',
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists ideas_created_at_idx on public.ideas (created_at desc);
alter table public.ideas enable row level security;

drop policy if exists "ideas: lesen für angemeldete" on public.ideas;
create policy "ideas: lesen für angemeldete" on public.ideas
  for select to authenticated using (true);
drop policy if exists "ideas: anlegen für angemeldete" on public.ideas;
create policy "ideas: anlegen für angemeldete" on public.ideas
  for insert to authenticated with check (user_id = (select auth.uid()));
-- Eigene Vorschläge darf jeder zurückziehen, Dave darf aufräumen.
drop policy if exists "ideas: löschen selbst oder admin" on public.ideas;
create policy "ideas: löschen selbst oder admin" on public.ideas
  for delete to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

create table if not exists public.idea_votes (
  idea_id bigint not null references public.ideas on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);
alter table public.idea_votes enable row level security;

drop policy if exists "idea_votes: lesen für angemeldete" on public.idea_votes;
create policy "idea_votes: lesen für angemeldete" on public.idea_votes
  for select to authenticated using (true);
drop policy if exists "idea_votes: eigene Stimme setzen" on public.idea_votes;
create policy "idea_votes: eigene Stimme setzen" on public.idea_votes
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "idea_votes: eigene Stimme zurücknehmen" on public.idea_votes;
create policy "idea_votes: eigene Stimme zurücknehmen" on public.idea_votes
  for delete to authenticated using (user_id = (select auth.uid()));

-- Vorschläge mit Stimmenzahl und der eigenen Stimme.
-- security_invoker: die Sicht rechnet mit den Rechten der aufrufenden Person,
-- die Policies oben gelten also weiter.
create or replace view public.ideas_ranked with (security_invoker = on) as
  select
    i.id,
    i.text,
    i.author,
    i.created_at,
    (select count(*) from public.idea_votes v where v.idea_id = i.id) as votes,
    exists (select 1 from public.idea_votes v where v.idea_id = i.id and v.user_id = auth.uid()) as voted
  from public.ideas i;

revoke all on public.ideas_ranked from public, anon;
grant select on public.ideas_ranked to authenticated;
