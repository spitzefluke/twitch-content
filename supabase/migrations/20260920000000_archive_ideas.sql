-- Archiv (gefahrene Strecken) und Vorschläge von Zuschauern.
-- Mehrfach ausführbar.

-- ---------- Archiv ----------
create table if not exists public.archive (
  id bigint generated always as identity primary key,
  happened_at date not null,
  title text not null check (char_length(title) between 1 and 80),
  meta text not null default '',
  vod_url text check (vod_url is null or vod_url like 'https://%'),
  created_at timestamptz not null default now()
);
create index if not exists archive_date_idx on public.archive (happened_at desc);
alter table public.archive enable row level security;

drop policy if exists "archive: lesen für angemeldete" on public.archive;
create policy "archive: lesen für angemeldete" on public.archive
  for select to authenticated using (true);
drop policy if exists "archive: anlegen nur admin" on public.archive;
create policy "archive: anlegen nur admin" on public.archive
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "archive: ändern nur admin" on public.archive;
create policy "archive: ändern nur admin" on public.archive
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "archive: löschen nur admin" on public.archive;
create policy "archive: löschen nur admin" on public.archive
  for delete to authenticated using ((select public.is_admin()));

-- ---------- Vorschläge ----------
create table if not exists public.ideas (
  id bigint generated always as identity primary key,
  text text not null check (char_length(text) between 3 and 120),
  author text not null,
  user_id uuid not null references auth.users on delete cascade,
  votes int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ideas_rank_idx on public.ideas (votes desc, created_at desc);
alter table public.ideas enable row level security;

drop policy if exists "ideas: lesen für angemeldete" on public.ideas;
create policy "ideas: lesen für angemeldete" on public.ideas
  for select to authenticated using (true);
-- Höchstens 5 Vorschläge pro Stunde und Person
drop policy if exists "ideas: einreichen" on public.ideas;
create policy "ideas: einreichen" on public.ideas
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and (select count(*) from public.ideas i where i.user_id = (select auth.uid()) and i.created_at > now() - interval '1 hour') < 5
  );
drop policy if exists "ideas: löschen (eigene oder admin)" on public.ideas;
create policy "ideas: löschen (eigene oder admin)" on public.ideas
  for delete to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ---------- Stimmen ----------
create table if not exists public.idea_votes (
  idea_id bigint not null references public.ideas on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);
alter table public.idea_votes enable row level security;

drop policy if exists "votes: lesen für angemeldete" on public.idea_votes;
create policy "votes: lesen für angemeldete" on public.idea_votes
  for select to authenticated using (true);
drop policy if exists "votes: eigene abgeben" on public.idea_votes;
create policy "votes: eigene abgeben" on public.idea_votes
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "votes: eigene zurücknehmen" on public.idea_votes;
create policy "votes: eigene zurücknehmen" on public.idea_votes
  for delete to authenticated using (user_id = (select auth.uid()));

-- Zähler in ideas.votes pflegen
create or replace function public.sync_idea_votes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.ideas set votes = votes + 1 where id = new.idea_id;
    return new;
  else
    update public.ideas set votes = greatest(0, votes - 1) where id = old.idea_id;
    return old;
  end if;
end;
$$;
drop trigger if exists idea_votes_sync on public.idea_votes;
create trigger idea_votes_sync
  after insert or delete on public.idea_votes
  for each row execute function public.sync_idea_votes();

-- Wer eine Idee einreicht, stimmt automatisch dafür
create or replace function public.autovote_own_idea()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.idea_votes (idea_id, user_id) values (new.id, new.user_id)
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists ideas_autovote on public.ideas;
create trigger ideas_autovote
  after insert on public.ideas
  for each row execute function public.autovote_own_idea();
