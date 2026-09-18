-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- ============================================================

-- ---------- Profile ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null check (char_length(username) between 1 and 25),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles: lesen für angemeldete" on public.profiles
  for select to authenticated using (true);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), split_part(new.email, '@', 1)), 25)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------- Kacheln ----------
create table public.tiles (
  id text primary key,
  position int not null,
  kind text not null check (kind in ('wheel', 'countdown')),
  title text not null,
  description text not null default '',
  theme text not null default 'tracks',
  target_at timestamptz,
  background text check (background is null or background like 'https://%'),
  updated_at timestamptz not null default now()
);
alter table public.tiles enable row level security;
create policy "tiles: lesen für angemeldete" on public.tiles
  for select to authenticated using (true);
create policy "tiles: ändern nur admin" on public.tiles
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.tiles (id, position, kind, title, description, theme, target_at) values
  ('wheel',  1, 'wheel',     'Fortnite-Glücksrad',     'Drei Varianten, die Daves nächste Runde auf den Kopf stellen. Auch per Kanalpunkte direkt aus dem Chat drehbar.', 'wheel', null),
  ('idea-1', 2, 'countdown', 'Nachtschicht Güterzug',  'Train Sim World: Langstrecke durch die Nacht – ohne Pause bis zum Zielbahnhof.', 'tracks', '2026-10-03 20:00:00+02'),
  ('idea-2', 3, 'countdown', 'Fortnite Community-Cup', 'Zuschauer gegen Dave – mit Glücksrad-Regeln in jeder Runde.', 'storm', '2026-10-17 18:00:00+02'),
  ('idea-3', 4, 'countdown', 'Geisterzug-Special',     'Halloween-Stream: Horror-Games und eine Fahrt ins Ungewisse.', 'ghost', '2026-10-31 20:00:00+01'),
  ('idea-4', 5, 'countdown', 'Subathon: Endstation?',  'Jeder Sub verlängert die Fahrt. Wo liegt die Endstation?', 'city', '2026-11-21 12:00:00+01')
on conflict (id) do nothing;

-- ---------- Glücksrad-Varianten ----------
create table public.wheel_variants (
  id text primary key,
  position int not null,
  name text not null,
  description text not null default '',
  color text not null default '#ffb81c',
  segments jsonb not null check (jsonb_typeof(segments) = 'array' and jsonb_array_length(segments) >= 2)
);
alter table public.wheel_variants enable row level security;
create policy "wheel_variants: lesen für angemeldete" on public.wheel_variants
  for select to authenticated using (true);
create policy "wheel_variants: ändern nur admin" on public.wheel_variants
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.wheel_variants (id, position, name, description, color, segments) values
('waffen', 1, 'Waffen-Roulette', 'Bestimmt, womit Dave kämpfen darf.', '#ffb81c', '[
  {"label":"Nur Schrotflinten","detail":"Nur Shotguns (und die Spitzhacke) sind erlaubt."},
  {"label":"Nur Grau & Grün","detail":"Nur Waffen der Seltenheit Gewöhnlich und Ungewöhnlich."},
  {"label":"Erste Waffe zählt","detail":"Die erste gefundene Waffe bleibt die einzige Waffe."},
  {"label":"Pistolen & MPs","detail":"Nur Pistolen und Maschinenpistolen."},
  {"label":"Keine Shotguns","detail":"Alles ist erlaubt – außer Schrotflinten."},
  {"label":"Sniper-Pflicht","detail":"Ein Scharfschützengewehr muss immer im Inventar sein."},
  {"label":"Nur Truhen-Loot","detail":"Nur Items aus Truhen, kein Boden-Loot."},
  {"label":"Freie Wahl","detail":"Glück gehabt: keine Waffen-Regel!"}
]'),
('landung', 2, 'Lande-Lotto', 'Entscheidet, wo und wie Dave in die Runde startet.', '#3ddc84', '[
  {"label":"Hot Drop","detail":"Lande am vollsten POI der Runde."},
  {"label":"Letzter raus","detail":"Springe als Allerletzter aus dem Bus."},
  {"label":"Erster raus","detail":"Springe sofort beim ersten möglichen Moment ab."},
  {"label":"Chat wählt","detail":"Der Chat bestimmt den Landeort."},
  {"label":"Höchster Punkt","detail":"Lande auf dem höchsten Punkt in Reichweite."},
  {"label":"Nur zu Fuß","detail":"Keine Fahrzeuge in dieser Runde."},
  {"label":"Gleisarbeiter","detail":"Lande so nah wie möglich an Gleisen oder einer Straße."},
  {"label":"Freie Wahl","detail":"Glück gehabt: lande, wo du willst!"}
]'),
('handicap', 3, 'Handicap-Express', 'Eine Extra-Challenge für die ganze Runde.', '#9146ff', '[
  {"label":"Kein Heilen","detail":"Keine Heil- oder Schild-Items benutzen."},
  {"label":"Kein Sprinten","detail":"Nur gehen – niemals sprinten."},
  {"label":"Emote nach Kill","detail":"Nach jedem Kill sofort ein Emote."},
  {"label":"Nur 3 Slots","detail":"Maximal drei Inventarplätze belegen."},
  {"label":"Ducken im Kampf","detail":"Im Kampf nur geduckt bewegen."},
  {"label":"Kein Bauen","detail":"Nicht bauen – auch nicht im Build-Modus."},
  {"label":"Pazifist bis Top 10","detail":"Keine Kämpfe, bis nur noch 10 Spieler übrig sind."},
  {"label":"Freifahrt","detail":"Glück gehabt: keine Challenge!"}
]')
on conflict (id) do nothing;

-- ---------- Drehungen ----------
-- Schreiben nur über Edge Functions (service role), lesen für alle Angemeldeten.
create table public.spins (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source text not null check (source in ('web', 'twitch')),
  variant_id text not null,
  variant_name text not null,
  segment_index int not null,
  result text not null,
  detail text not null default '',
  requested_by text not null,
  user_id uuid references auth.users on delete set null,
  redemption_id text unique
);
create index spins_created_at_idx on public.spins (created_at desc);
create index spins_user_idx on public.spins (user_id, created_at desc);
alter table public.spins enable row level security;
create policy "spins: lesen für angemeldete" on public.spins
  for select to authenticated using (true);

alter publication supabase_realtime add table public.spins;

-- ---------- Twitch (nur service role) ----------
create table public.twitch_connection (
  id int primary key default 1 check (id = 1),
  broadcaster_id text not null,
  broadcaster_login text not null,
  display_name text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scopes text[] not null default '{}',
  reward_id text,
  reward_title text,
  reward_cost int,
  subscription_id text,
  connected_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.twitch_connection enable row level security;
-- absichtlich keine Policies: Tokens sind nur für Edge Functions lesbar

create table public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.oauth_states enable row level security;

-- Öffentlicher Status ohne Tokens
create or replace function public.twitch_status()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select json_build_object(
      'connected', true,
      'login', broadcaster_login,
      'display_name', display_name,
      'reward_active', reward_id is not null,
      'reward_title', reward_title,
      'reward_cost', reward_cost,
      'subscription_active', subscription_id is not null
    ) from public.twitch_connection where id = 1),
    json_build_object('connected', false)
  );
$$;
revoke execute on function public.twitch_status() from public, anon;
grant execute on function public.twitch_status() to authenticated;
