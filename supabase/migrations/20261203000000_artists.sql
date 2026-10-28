-- ============================================================
-- StreamHelp: Artists laden Designs hoch (nach …_bet_scratch.sql einspielen)
--   · Bewerben: Jeder mit Konto kann sich als Artist bewerben (Name, Kurztext, Portfolio-Links).
--     Der Plattform-Admin schaltet im Admin-Bereich frei (Edge Function admin, Service-Rolle).
--   · Hochladen (nur freigeschaltete Artists): Alert-Grafiken (Bild, GIF, kurzes Video),
--     Szenen-Hintergründe, komplette Looks (Hintergrund + Akzentfarbe + Grund-Design, optional
--     Alert-Bild) und Sammelkarten-Bilder. Beim Hochladen bestätigt der Artist, dass er die Rechte hat.
--   · Prüfung: Jeder Upload wartet, bis der Admin ihn freigibt. Erst dann steht er in der
--     Design-Bibliothek – kostenlos, mit Credit (Name und Links des Artists).
--   · Streamer übernehmen Designs in ihr Overlay (gezählt je Kanal) und können sie melden.
-- Dateien: öffentlicher Bucket artist-assets, Ordner = Konto des Artists (<user-id>/<uuid>.<endung>).
-- Mehrfach ausführbar.
-- ============================================================

-- ---------- Tabellen (nur über die Funktionen unten erreichbar) ----------
create table if not exists core.artists (
  user_id uuid primary key references auth.users on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$'),
  bio text not null default '' check (char_length(bio) <= 300),
  links text[] not null default '{}' check (cardinality(links) <= 4),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'blocked')),
  note text not null default '' check (char_length(note) <= 300),     -- Nachricht des Admins an den Artist
  applied_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table core.artists enable row level security;
revoke all on core.artists from anon, authenticated;

create table if not exists core.artist_assets (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references core.artists (user_id) on delete cascade,
  kind text not null check (kind in ('alert', 'background', 'look', 'card')),
  title text not null check (char_length(title) between 3 and 60),
  description text not null default '' check (char_length(description) <= 300),
  tags text[] not null default '{}' check (cardinality(tags) <= 6),
  file text not null check (file ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|gif|webp|webm|mp4)$'),
  -- Look: {"base": "<Overlay-Design>", "accent": "#rrggbb", "alert": "<Datei>"}; Karte: {"rarity": "…", "emoji": "…"}
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 600),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed')),
  note text not null default '' check (char_length(note) <= 300),
  rights_confirmed_at timestamptz not null,
  uses int not null default 0,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists artist_assets_artist on core.artist_assets (artist_id, created_at desc);
create index if not exists artist_assets_gallery on core.artist_assets (status, kind, reviewed_at desc);
alter table core.artist_assets enable row level security;
revoke all on core.artist_assets from anon, authenticated;

-- Welcher Kanal hat welches Design übernommen (zählt je Kanal einmal)
create table if not exists core.artist_uses (
  asset_id uuid not null references core.artist_assets on delete cascade,
  channel_id uuid not null references public.channels on delete cascade,
  at timestamptz not null default now(),
  primary key (asset_id, channel_id)
);
alter table core.artist_uses enable row level security;
revoke all on core.artist_uses from anon, authenticated;

create table if not exists core.artist_reports (
  id bigint generated always as identity primary key,
  asset_id uuid not null references core.artist_assets on delete cascade,
  reporter uuid not null references auth.users on delete cascade,
  reason text not null check (char_length(reason) between 3 and 300),
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  unique (asset_id, reporter)
);
alter table core.artist_reports enable row level security;
revoke all on core.artist_reports from anon, authenticated;

-- ---------- Dateien ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artist-assets', 'artist-assets', true, 10485760, array[
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/webm', 'video/mp4'
])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Freigeschalteter Artist? (für die Storage-Regeln)
create or replace function public.artist_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from core.artists where user_id = auth.uid() and status = 'approved');
$$;
revoke execute on function public.artist_ok() from public, anon;
grant execute on function public.artist_ok() to authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  drop policy if exists "artist-assets: hochladen in eigenen Ordner" on storage.objects;
  create policy "artist-assets: hochladen in eigenen Ordner" on storage.objects for insert to authenticated with check (
    bucket_id = 'artist-assets' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.artist_ok()));
  drop policy if exists "artist-assets: eigene Dateien sehen" on storage.objects;
  create policy "artist-assets: eigene Dateien sehen" on storage.objects for select to authenticated using (
    bucket_id = 'artist-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
  drop policy if exists "artist-assets: eigene Dateien löschen" on storage.objects;
  create policy "artist-assets: eigene Dateien löschen" on storage.objects for delete to authenticated using (
    bucket_id = 'artist-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
end;
$$;

-- ---------- Hilfen ----------
-- Links: nur https://, höchstens 4, je 200 Zeichen
create or replace function public.artist_clean_links(p text[])
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(l order by o), '{}') from (
    select btrim(x) as l, o from unnest(coalesce(p, '{}')) with ordinality as u(x, o)
    where o <= 4 and btrim(x) ~ '^https://[^\s<>"]{3,195}$') s;
$$;
revoke execute on function public.artist_clean_links(text[]) from public, anon, authenticated;

-- Tags: klein, Buchstaben/Ziffern/Bindestrich, je 2–20 Zeichen, höchstens 6, ohne Doppelte
create or replace function public.artist_clean_tags(p text[])
returns text[] language plpgsql immutable set search_path = '' as $$
declare
  r text[] := '{}';
  x text;
  t text;
begin
  foreach x in array coalesce(p, '{}') loop
    t := btrim(lower(regexp_replace(btrim(coalesce(x, '')), '[^[:alnum:]äöüß-]+', '-', 'g')), '-');
    if char_length(t) between 2 and 20 and not t = any(r) then r := r || t; end if;
    exit when cardinality(r) >= 6;
  end loop;
  return r;
end;
$$;
revoke execute on function public.artist_clean_tags(text[]) from public, anon, authenticated;

-- Öffentliche Form eines Uploads (Galerie, eigene Liste, Admin)
create or replace function public.artist_asset_json(a core.artist_assets, p_private boolean default false)
returns json language sql stable set search_path = '' as $$
  select json_strip_nulls(json_build_object(
    'id', a.id, 'kind', a.kind, 'title', a.title, 'description', a.description, 'tags', a.tags,
    'file', a.file, 'extra', a.extra, 'uses', a.uses, 'created_at', a.created_at, 'approved_at', case when a.status = 'approved' then a.reviewed_at end,
    'status', case when p_private then a.status end, 'note', case when p_private then a.note end));
$$;
revoke execute on function public.artist_asset_json(core.artist_assets, boolean) from public, anon, authenticated;

-- ---------- Für alle: freigegebene Designs (Design-Bibliothek) ----------
create or replace function public.artist_gallery(p_kind text default null)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(x order by x_at desc), '[]'::json) from (
    select json_build_object('asset', public.artist_asset_json(a), 'artist', json_build_object(
             'name', r.name, 'slug', r.slug, 'links', r.links)) as x, a.reviewed_at as x_at
      from core.artist_assets a join core.artists r on r.user_id = a.artist_id
     where a.status = 'approved' and r.status = 'approved' and (p_kind is null or a.kind = p_kind)
     order by a.reviewed_at desc limit 300) s;
$$;
grant execute on function public.artist_gallery(text) to anon, authenticated;

-- ---------- Artist: Bewerbung und eigene Uploads ----------
create or replace function public.artist_me()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'artist', (select json_build_object('name', name, 'slug', slug, 'bio', bio, 'links', links, 'status', status, 'note', note,
                                        'applied_at', applied_at, 'reviewed_at', reviewed_at)
                 from core.artists where user_id = auth.uid()),
    'assets', coalesce((select json_agg(public.artist_asset_json(a, true) order by a.created_at desc)
                          from core.artist_assets a where a.artist_id = auth.uid() and a.status <> 'removed'), '[]'::json));
$$;
revoke execute on function public.artist_me() from public, anon;
grant execute on function public.artist_me() to authenticated;

create or replace function public.artist_apply(p_name text, p_slug text, p_bio text, p_links text[])
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_bio text := left(btrim(coalesce(p_bio, '')), 300);
  v_links text[] := public.artist_clean_links(p_links);
  v_old core.artists;
begin
  if v_uid is null then raise exception 'Bitte anmelden.' using errcode = '42501'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 40 then raise exception 'Der Artist-Name braucht 2 bis 40 Zeichen.'; end if;
  if v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$' then
    raise exception 'Die Kennung braucht 3 bis 30 Zeichen: Kleinbuchstaben, Ziffern und Bindestrich.';
  end if;
  if cardinality(v_links) = 0 then raise exception 'Mindestens ein Link zu deinen Arbeiten (https://…), z. B. Portfolio oder Instagram.'; end if;
  if exists (select 1 from core.artists where slug = v_slug and user_id <> v_uid) then raise exception 'Diese Kennung ist schon vergeben.'; end if;
  select * into v_old from core.artists where user_id = v_uid for update;
  if v_old.status = 'blocked' then raise exception 'Dein Artist-Konto ist gesperrt. Bei Fragen: Kontaktformular.'; end if;
  insert into core.artists (user_id, name, slug, bio, links)
    values (v_uid, v_name, v_slug, v_bio, v_links)
  on conflict (user_id) do update set
    name = excluded.name, slug = excluded.slug, bio = excluded.bio, links = excluded.links, updated_at = now(),
    -- Abgelehnt: neue Bewerbung; freigeschaltet bleibt freigeschaltet
    status = case when core.artists.status = 'rejected' then 'pending' else core.artists.status end,
    applied_at = case when core.artists.status = 'rejected' then now() else core.artists.applied_at end;
  return public.artist_me();
end;
$$;
revoke execute on function public.artist_apply(text, text, text, text[]) from public, anon;
grant execute on function public.artist_apply(text, text, text, text[]) to authenticated;

-- Upload anmelden, nachdem die Datei im Bucket liegt. Wartet auf die Freigabe.
create or replace function public.artist_asset_submit(p_kind text, p_title text, p_description text, p_tags text[],
                                                      p_file text, p_extra jsonb, p_rights boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_extra jsonb := '{}'::jsonb;
  v_file_re text := '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|gif|webp|webm|mp4)$';
  v_alert text;
  a core.artist_assets;
begin
  if v_uid is null or not public.artist_ok() then
    raise exception 'Hochladen dürfen nur freigeschaltete Artists.' using errcode = '42501';
  end if;
  if p_rights is not true then raise exception 'Bitte bestätige, dass du die Rechte an dem Design hast.'; end if;
  if p_kind not in ('alert', 'background', 'look', 'card') then raise exception 'Unbekannte Art.'; end if;
  if char_length(v_title) < 3 or char_length(v_title) > 60 then raise exception 'Der Titel braucht 3 bis 60 Zeichen.'; end if;
  if coalesce(p_file, '') !~ v_file_re or split_part(p_file, '/', 1) <> v_uid::text then raise exception 'Ungültige Datei.'; end if;
  if p_kind in ('background', 'card') and p_file ~ '\.(webm|mp4)$' then raise exception 'Hintergründe und Karten brauchen ein Bild.'; end if;
  if to_regclass('storage.objects') is not null
     and not exists (select 1 from storage.objects where bucket_id = 'artist-assets' and name = p_file) then
    raise exception 'Die Datei ist nicht angekommen – bitte noch einmal hochladen.';
  end if;
  if (select count(*) from core.artist_assets where artist_id = v_uid and status = 'pending') >= 10 then
    raise exception 'Du hast schon 10 Uploads in der Prüfung. Warte bitte, bis sie freigegeben sind.';
  end if;
  if (select count(*) from core.artist_assets where artist_id = v_uid and status <> 'removed') >= 200 then
    raise exception 'Höchstens 200 Designs je Artist.';
  end if;
  if p_kind = 'look' then
    if coalesce(p_file, '') ~ '\.(webm|mp4)$' then raise exception 'Der Hintergrund eines Looks braucht ein Bild.'; end if;
    v_alert := nullif(p_extra->>'alert', '');
    if v_alert is not null and (v_alert !~ v_file_re or split_part(v_alert, '/', 1) <> v_uid::text) then raise exception 'Ungültiges Alert-Bild.'; end if;
    v_extra := jsonb_strip_nulls(jsonb_build_object(
      'base', case when coalesce(p_extra->>'base', '') ~ '^[a-z0-9-]{2,20}$' then p_extra->>'base' else 'standard' end,
      'accent', case when coalesce(p_extra->>'accent', '') ~* '^#[0-9a-f]{6}$' then lower(p_extra->>'accent') end,
      'alert', v_alert));
  elsif p_kind = 'card' then
    v_extra := jsonb_strip_nulls(jsonb_build_object(
      'rarity', case when p_extra->>'rarity' in ('common', 'uncommon', 'rare', 'epic', 'legendary') then p_extra->>'rarity' else 'rare' end,
      'emoji', nullif(left(coalesce(p_extra->>'emoji', ''), 8), '')));
  end if;
  insert into core.artist_assets (artist_id, kind, title, description, tags, file, extra, rights_confirmed_at)
    values (v_uid, p_kind, v_title, left(btrim(coalesce(p_description, '')), 300), public.artist_clean_tags(p_tags), p_file, v_extra, now())
  returning * into a;
  return public.artist_asset_json(a, true);
end;
$$;
revoke execute on function public.artist_asset_submit(text, text, text, text[], text, jsonb, boolean) from public, anon;
grant execute on function public.artist_asset_submit(text, text, text, text[], text, jsonb, boolean) to authenticated;

-- Eigenen Upload löschen; liefert die Dateien, die der Browser danach aus dem Bucket entfernt
create or replace function public.artist_asset_delete(p_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  a core.artist_assets;
begin
  delete from core.artist_assets where id = p_id and artist_id = auth.uid() returning * into a;
  if not found then raise exception 'Nicht gefunden.'; end if;
  return array_remove(array[a.file, a.extra->>'alert'], null);
end;
$$;
revoke execute on function public.artist_asset_delete(uuid) from public, anon;
grant execute on function public.artist_asset_delete(uuid) to authenticated;

-- ---------- Streamer: übernehmen und melden ----------
-- Zählt die Übernahme (je Kanal einmal); nur Streamer, Admins und freigegebene Mods des Kanals
create or replace function public.artist_asset_use(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  a core.artist_assets;
begin
  if v_ch is null or not public.is_admin() then raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501'; end if;
  select * into a from core.artist_assets where id = p_id and status = 'approved';
  if not found then raise exception 'Dieses Design gibt es nicht (mehr).'; end if;
  insert into core.artist_uses (asset_id, channel_id) values (p_id, v_ch) on conflict do nothing;
  if found then update core.artist_assets set uses = uses + 1 where id = p_id returning * into a; end if;
  return public.artist_asset_json(a);
end;
$$;
revoke execute on function public.artist_asset_use(uuid) from public, anon;
grant execute on function public.artist_asset_use(uuid) to authenticated;

create or replace function public.artist_asset_report(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then raise exception 'Bitte anmelden.' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 then raise exception 'Bitte kurz schreiben, was nicht stimmt.'; end if;
  if not exists (select 1 from core.artist_assets where id = p_id and status = 'approved') then raise exception 'Nicht gefunden.'; end if;
  if (select count(*) from core.artist_reports where reporter = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Zu viele Meldungen heute.';
  end if;
  insert into core.artist_reports (asset_id, reporter, reason) values (p_id, auth.uid(), left(v_reason, 300))
    on conflict (asset_id, reporter) do update set reason = excluded.reason, status = 'open', created_at = now();
end;
$$;
revoke execute on function public.artist_asset_report(uuid, text) from public, anon;
grant execute on function public.artist_asset_report(uuid, text) to authenticated;

-- ---------- Plattform-Admin (nur Service-Rolle: Edge Function admin) ----------
create or replace function public.artist_admin_list()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'artists', coalesce((select json_agg(json_build_object(
        'user_id', r.user_id, 'name', r.name, 'slug', r.slug, 'bio', r.bio, 'links', r.links, 'status', r.status, 'note', r.note,
        'applied_at', r.applied_at, 'reviewed_at', r.reviewed_at,
        'email', (select email from auth.users u where u.id = r.user_id),
        'assets', (select count(*) from core.artist_assets a where a.artist_id = r.user_id and a.status = 'approved'))
      order by (r.status = 'pending') desc, r.applied_at desc) from core.artists r), '[]'::json),
    'assets', coalesce((select json_agg(x order by o, at) from (
        select json_build_object('asset', public.artist_asset_json(a, true), 'artist', json_build_object('user_id', r.user_id, 'name', r.name, 'slug', r.slug),
                                 'reports', (select coalesce(json_agg(json_build_object('id', p.id, 'reason', p.reason, 'created_at', p.created_at) order by p.id), '[]'::json)
                                               from core.artist_reports p where p.asset_id = a.id and p.status = 'open')) as x,
               case when a.status = 'pending' then 0 else 1 end as o, a.created_at as at
          from core.artist_assets a join core.artists r on r.user_id = a.artist_id
         where a.status = 'pending' or exists (select 1 from core.artist_reports p where p.asset_id = a.id and p.status = 'open')
         limit 200) s), '[]'::json));
$$;
revoke execute on function public.artist_admin_list() from public, anon, authenticated;

create or replace function public.artist_admin_review(p_user uuid, p_status text, p_note text)
returns json language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('approved', 'rejected', 'blocked', 'pending') then raise exception 'Ungültiger Status.'; end if;
  update core.artists set status = p_status, note = left(btrim(coalesce(p_note, '')), 300), reviewed_at = now(), updated_at = now()
   where user_id = p_user;
  if not found then raise exception 'Artist nicht gefunden.'; end if;
  return public.artist_admin_list();
end;
$$;
revoke execute on function public.artist_admin_review(uuid, text, text) from public, anon, authenticated;

-- Upload freigeben, ablehnen oder (nach einer Meldung) entfernen. Liefert die Dateien, die die
-- Edge Function bei „abgelehnt“/„entfernt“ aus dem Bucket löscht.
create or replace function public.artist_asset_review(p_id uuid, p_status text, p_note text)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  a core.artist_assets;
begin
  if p_status not in ('approved', 'rejected', 'removed') then raise exception 'Ungültiger Status.'; end if;
  update core.artist_assets set status = p_status, note = left(btrim(coalesce(p_note, '')), 300), reviewed_at = now()
   where id = p_id returning * into a;
  if not found then raise exception 'Upload nicht gefunden.'; end if;
  update core.artist_reports set status = 'done' where asset_id = p_id and status = 'open';
  return case when p_status = 'approved' then '{}'::text[] else array_remove(array[a.file, a.extra->>'alert'], null) end;
end;
$$;
revoke execute on function public.artist_asset_review(uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
