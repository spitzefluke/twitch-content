-- Fehlgeschlagene Admin-Logins (Schutz gegen Passwort-Raten).
-- Nur für die Edge Function "admin" (service role) zugänglich.
create table public.admin_login_failures (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);
create index admin_login_failures_at_idx on public.admin_login_failures (at desc);
alter table public.admin_login_failures enable row level security;
