-- ============================================================
-- StreamHelp: Sponsoring-Börse (nach …_tips_sponsors_pro.sql einspielen)
--   Firmen bieten auf sponsoring.html ein Sponsoring an – ohne Konto, mit einem privaten Verwaltungs-Link
--   (nur dessen SHA-256 liegt hier). Sie legen fest, für welche Kanalgröße (Ø Zuschauer der letzten
--   30 Tage) das Angebot gilt, wie viele Streamer mitmachen können und wie die Einblendung im OBS-Overlay
--   aussieht (Logo, Text, Code, Link, alle X Minuten für Y Sekunden). Erst nach Freigabe durch den
--   Plattform-Admin sehen passende Streamer das Angebot im Dashboard und bewerben sich. Sagt die Firma zu,
--   wird es zum Sponsor des Kanals (Laufband, Overlay-Einblendung mit „Anzeige“, !sponsor, Profil).
--   Geld: „direct“ = die Firma zahlt den Streamer selbst; „streamhelp“ = Abrechnung über StreamHelp –
--   bis ein Zahlungsanbieter eingerichtet ist, verfolgt der Admin den Stand hier nur von Hand (pay_status).
--   Alle Firmen-Aktionen laufen über die Edge Function sponsoring (Service-Rolle).
-- Mehrfach ausführbar.
-- ============================================================

create table if not exists core.sponsor_offers (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  company text not null check (char_length(company) between 2 and 80),
  contact_email text not null check (char_length(contact_email) <= 120 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  website text not null default '' check (website = '' or (website ~ '^https://[^\s<>"''\\]{3,}$' and char_length(website) <= 300)),
  title text not null check (char_length(title) between 3 and 100),
  description text not null check (char_length(description) between 10 and 1500),
  reward text not null default '' check (char_length(reward) <= 200),       -- was der Streamer bekommt
  pay_mode text not null default 'direct' check (pay_mode in ('direct', 'streamhelp')),
  amount_cents int check (amount_cents is null or amount_cents between 0 and 100000000),
  min_viewers int not null default 0 check (min_viewers between 0 and 1000000),
  max_viewers int check (max_viewers is null or max_viewers between 0 and 1000000),
  slots int not null default 10 check (slots between 1 and 100),
  ends_on date,
  -- Einblendung im OBS-Overlay (legt die Firma fest)
  overlay_text text not null default '' check (char_length(overlay_text) <= 100),
  code text not null default '' check (char_length(code) <= 40),
  link text not null default '' check (link = '' or (link ~ '^https://[^\s<>"''\\]{3,}$' and char_length(link) <= 300)),
  logo_path text check (logo_path is null or logo_path ~ '^[0-9a-f-]{36}\.(png|jpg|webp)$'),
  every_min int not null default 15 check (every_min between 5 and 120),
  show_sec int not null default 12 check (show_sec between 5 and 60),
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'closed')),
  admin_note text not null default '' check (char_length(admin_note) <= 300),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (max_viewers is null or max_viewers >= min_viewers)
);
create index if not exists sponsor_offers_status on core.sponsor_offers (status, created_at desc);
alter table core.sponsor_offers enable row level security;
revoke all on core.sponsor_offers from anon, authenticated;

create table if not exists core.sponsor_applications (
  id bigint generated always as identity primary key,
  offer_id uuid not null references core.sponsor_offers on delete cascade,
  channel_id uuid not null references public.channels on delete cascade,
  message text not null default '' check (char_length(message) <= 500),
  stats jsonb,                                                   -- nur wenn der Streamer zustimmt
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'ended')),
  company_note text not null default '' check (char_length(company_note) <= 300),
  pay_status text not null default 'open' check (pay_status in ('open', 'invoiced', 'paid_in', 'paid_out')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (offer_id, channel_id)
);
create index if not exists sponsor_applications_channel on core.sponsor_applications (channel_id);
alter table core.sponsor_applications enable row level security;
revoke all on core.sponsor_applications from anon, authenticated;

-- Sponsoren eines Kanals: aus der Börse übernommene merken sich Angebot und Einblendung
alter table core.sponsors add column if not exists offer_id uuid references core.sponsor_offers on delete set null;
alter table core.sponsors add column if not exists logo_path text;
alter table core.sponsors add column if not exists every_min int;
alter table core.sponsors add column if not exists show_sec int;

-- Logos der Firmen: öffentlich lesbar (Overlay), hochladen nur die Edge Function (Service-Rolle)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-assets', 'sponsor-assets', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

-- Kanalgröße: Ø Zuschauer der Streams der letzten 30 Tage (aus …_bot_stats.sql)
create or replace function public.channel_size(p_channel uuid)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'avg', coalesce(round(avg(case when s.samples > 0 then s.viewer_sum::numeric / s.samples end))::int, 0),
    'peak', coalesce(max(s.peak_viewers), 0),
    'streams', count(*))
  from core.stream_sessions s
  where s.channel_id = p_channel and s.started_at > now() - interval '30 days';
$$;
revoke execute on function public.channel_size(uuid) from public, anon, authenticated;

-- Angebot ohne Firmen-Interna (für Streamer)
create or replace function public.sponsor_offer_public(o core.sponsor_offers)
returns json language sql stable set search_path = '' as $$
  select json_build_object('id', o.id, 'company', o.company, 'website', o.website, 'title', o.title, 'description', o.description,
    'reward', o.reward, 'pay_mode', o.pay_mode, 'amount_cents', o.amount_cents, 'min_viewers', o.min_viewers, 'max_viewers', o.max_viewers,
    'slots', o.slots, 'ends_on', o.ends_on, 'overlay_text', o.overlay_text, 'code', o.code, 'link', o.link, 'logo_path', o.logo_path,
    'every_min', o.every_min, 'show_sec', o.show_sec,
    'taken', (select count(*) from core.sponsor_applications a where a.offer_id = o.id and a.status = 'accepted'));
$$;
revoke execute on function public.sponsor_offer_public(core.sponsor_offers) from public, anon, authenticated;

-- ---------- Streamer (Team des Kanals) ----------
-- Passende, freigegebene Angebote und die eigenen Bewerbungen
create or replace function public.sponsoring_offers()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_size json;
  v_avg int;
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  v_size := public.channel_size(v_ch);
  v_avg := (v_size ->> 'avg')::int;
  return json_build_object(
    'size', v_size,
    'offers', coalesce((select json_agg(public.sponsor_offer_public(o) order by o.created_at desc)
      from core.sponsor_offers o
      where o.status = 'active' and (o.ends_on is null or o.ends_on >= current_date)
        and v_avg >= o.min_viewers and (o.max_viewers is null or v_avg <= o.max_viewers)
        and not exists (select 1 from core.sponsor_applications a where a.offer_id = o.id and a.channel_id = v_ch and a.status <> 'withdrawn')
        and (select count(*) from core.sponsor_applications a where a.offer_id = o.id and a.status = 'accepted') < o.slots), '[]'::json),
    'mine', coalesce((select json_agg(json_build_object('offer', public.sponsor_offer_public(o), 'status', a.status, 'message', a.message,
                        'company_note', a.company_note, 'created_at', a.created_at, 'decided_at', a.decided_at) order by a.created_at desc)
      from core.sponsor_applications a join core.sponsor_offers o on o.id = a.offer_id where a.channel_id = v_ch and a.status <> 'withdrawn'), '[]'::json));
end;
$$;
revoke execute on function public.sponsoring_offers() from public, anon;
grant execute on function public.sponsoring_offers() to authenticated;

create or replace function public.sponsoring_apply(p_offer uuid, p_message text, p_share boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  o core.sponsor_offers;
  v_size json;
  v_avg int;
  v_stats jsonb;
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  if not exists (select 1 from public.channels where id = v_ch and status = 'active') then raise exception 'Erst wenn dein Kanal freigeschaltet ist.'; end if;
  select * into o from core.sponsor_offers where id = p_offer and status = 'active' and (ends_on is null or ends_on >= current_date) for update;
  if not found then raise exception 'Dieses Angebot gibt es nicht mehr.'; end if;
  v_size := public.channel_size(v_ch);
  v_avg := (v_size ->> 'avg')::int;
  if v_avg < o.min_viewers or (o.max_viewers is not null and v_avg > o.max_viewers) then
    raise exception 'Dieses Angebot ist für eine andere Kanalgröße.';
  end if;
  if (select count(*) from core.sponsor_applications where offer_id = o.id and status = 'accepted') >= o.slots then
    raise exception 'Alle Plätze sind schon vergeben.';
  end if;
  if coalesce(p_share, false) then
    v_stats := (v_size::jsonb) || jsonb_build_object('login', (select login from public.channels where id = v_ch));
  end if;
  insert into core.sponsor_applications (offer_id, channel_id, message, stats)
    values (o.id, v_ch, left(btrim(coalesce(p_message, '')), 500), v_stats)
  on conflict (offer_id, channel_id) do update set message = excluded.message, stats = excluded.stats, status = 'pending',
    created_at = now(), decided_at = null, company_note = ''
    where core.sponsor_applications.status = 'withdrawn';
  if not found then raise exception 'Du hast dich schon beworben.'; end if;
  return public.sponsoring_offers();
end;
$$;
revoke execute on function public.sponsoring_apply(uuid, text, boolean) from public, anon;
grant execute on function public.sponsoring_apply(uuid, text, boolean) to authenticated;

-- Bewerbung zurückziehen bzw. laufendes Sponsoring beenden (Sponsor verschwindet aus Overlay und Chat)
create or replace function public.sponsoring_withdraw(p_offer uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  update core.sponsor_applications set status = case when status = 'accepted' then 'ended' else 'withdrawn' end, decided_at = now()
    where offer_id = p_offer and channel_id = v_ch and status in ('pending', 'accepted');
  delete from core.sponsors where offer_id = p_offer and channel_id = v_ch;
  return public.sponsoring_offers();
end;
$$;
revoke execute on function public.sponsoring_withdraw(uuid) from public, anon;
grant execute on function public.sponsoring_withdraw(uuid) to authenticated;

-- ---------- Firma (nur Edge Function sponsoring, Service-Rolle) ----------
create or replace function public.sponsoring_submit(p_id uuid, p_token_hash text, p jsonb, p_logo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_min int := greatest(0, coalesce((p ->> 'min_viewers')::int, 0));
  v_max int := nullif(p ->> 'max_viewers', '')::int;
begin
  insert into core.sponsor_offers (id, token_hash, company, contact_email, website, title, description, reward, pay_mode, amount_cents,
                                   min_viewers, max_viewers, slots, ends_on, overlay_text, code, link, logo_path, every_min, show_sec)
  values (p_id, p_token_hash, btrim(coalesce(p ->> 'company', '')), lower(btrim(coalesce(p ->> 'contact_email', ''))),
          btrim(coalesce(p ->> 'website', '')), btrim(coalesce(p ->> 'title', '')), btrim(coalesce(p ->> 'description', '')),
          left(btrim(coalesce(p ->> 'reward', '')), 200),
          case when p ->> 'pay_mode' = 'streamhelp' then 'streamhelp' else 'direct' end,
          nullif(p ->> 'amount_cents', '')::int, v_min, v_max,
          least(100, greatest(1, coalesce((p ->> 'slots')::int, 10))), nullif(p ->> 'ends_on', '')::date,
          left(btrim(coalesce(p ->> 'overlay_text', '')), 100), left(btrim(coalesce(p ->> 'code', '')), 40), btrim(coalesce(p ->> 'link', '')),
          p_logo, least(120, greatest(5, coalesce((p ->> 'every_min')::int, 15))), least(60, greatest(5, coalesce((p ->> 'show_sec')::int, 12))));
  return p_id;
end;
$$;
revoke execute on function public.sponsoring_submit(uuid, text, jsonb, text) from public, anon, authenticated;

-- Verwaltungs-Ansicht der Firma: ihr Angebot und die Bewerbungen (Zahlen nur, wenn der Streamer zugestimmt hat)
create or replace function public.sponsoring_manage(p_token_hash text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'offer', (public.sponsor_offer_public(o)::jsonb || jsonb_build_object('status', o.status, 'admin_note', o.admin_note,
              'contact_email', o.contact_email, 'created_at', o.created_at))::json,
    'applications', coalesce((select json_agg(json_build_object('id', a.id, 'login', c.login, 'display_name', c.display_name,
                     'avatar_url', c.avatar_url, 'message', a.message, 'stats', a.stats, 'status', a.status, 'company_note', a.company_note,
                     'created_at', a.created_at) order by (a.status = 'pending') desc, a.created_at desc)
                    from core.sponsor_applications a join public.channels c on c.id = a.channel_id
                    where a.offer_id = o.id and a.status <> 'withdrawn'), '[]'::json))
  from core.sponsor_offers o where o.token_hash = p_token_hash;
$$;
revoke execute on function public.sponsoring_manage(text) from public, anon, authenticated;

-- Zusagen (Sponsor im Kanal anlegen), absagen oder ein laufendes Sponsoring beenden
create or replace function public.sponsoring_decide(p_token_hash text, p_app bigint, p_action text, p_note text default '')
returns json language plpgsql security definer set search_path = '' as $$
declare
  o core.sponsor_offers;
  a core.sponsor_applications;
begin
  select * into o from core.sponsor_offers where token_hash = p_token_hash for update;
  if not found then raise exception 'Unbekannter Verwaltungs-Link.'; end if;
  select * into a from core.sponsor_applications where id = p_app and offer_id = o.id for update;
  if not found then raise exception 'Diese Bewerbung gibt es nicht.'; end if;
  if p_action = 'accept' then
    if o.status <> 'active' then raise exception 'Das Angebot ist nicht (mehr) freigegeben.'; end if;
    if a.status <> 'pending' then raise exception 'Über diese Bewerbung ist schon entschieden.'; end if;
    if (select count(*) from core.sponsor_applications where offer_id = o.id and status = 'accepted') >= o.slots then
      raise exception 'Alle Plätze sind vergeben.';
    end if;
    update core.sponsor_applications set status = 'accepted', decided_at = now(), company_note = left(btrim(coalesce(p_note, '')), 300) where id = a.id;
    delete from core.sponsors where offer_id = o.id and channel_id = a.channel_id;
    insert into core.sponsors (channel_id, name, text, code, url, active, position, offer_id, logo_path, every_min, show_sec)
      values (a.channel_id, o.company, o.overlay_text, o.code, o.link, true,
              coalesce((select max(position) + 1 from core.sponsors where channel_id = a.channel_id), 0),
              o.id, o.logo_path, o.every_min, o.show_sec);
  elsif p_action = 'decline' then
    if a.status <> 'pending' then raise exception 'Über diese Bewerbung ist schon entschieden.'; end if;
    update core.sponsor_applications set status = 'declined', decided_at = now(), company_note = left(btrim(coalesce(p_note, '')), 300) where id = a.id;
  elsif p_action = 'end' then
    if a.status <> 'accepted' then raise exception 'Dieses Sponsoring läuft nicht.'; end if;
    update core.sponsor_applications set status = 'ended', decided_at = now() where id = a.id;
    delete from core.sponsors where offer_id = o.id and channel_id = a.channel_id;
  else
    raise exception 'Unbekannte Aktion.';
  end if;
  return public.sponsoring_manage(p_token_hash);
end;
$$;
revoke execute on function public.sponsoring_decide(text, bigint, text, text) from public, anon, authenticated;

-- Angebot beenden: keine neuen Bewerbungen, laufende Sponsorings enden (Einblendungen verschwinden)
create or replace function public.sponsoring_close(p_token_hash text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  update core.sponsor_offers set status = 'closed' where token_hash = p_token_hash and status in ('pending', 'active') returning id into v_id;
  if v_id is not null then
    update core.sponsor_applications set status = case when status = 'accepted' then 'ended' else 'declined' end, decided_at = now()
      where offer_id = v_id and status in ('pending', 'accepted');
    delete from core.sponsors where offer_id = v_id;
  end if;
  return public.sponsoring_manage(p_token_hash);
end;
$$;
revoke execute on function public.sponsoring_close(text) from public, anon, authenticated;

-- ---------- Plattform-Admin (Edge Function admin, Service-Rolle) ----------
create or replace function public.sponsoring_admin_list()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg((public.sponsor_offer_public(o)::jsonb || jsonb_build_object('status', o.status, 'admin_note', o.admin_note,
      'contact_email', o.contact_email, 'created_at', o.created_at, 'reviewed_at', o.reviewed_at,
      'applications', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'login', c.login, 'display_name', c.display_name,
                       'status', a.status, 'pay_status', a.pay_status, 'created_at', a.created_at) order by a.created_at desc)
                      from core.sponsor_applications a join public.channels c on c.id = a.channel_id where a.offer_id = o.id), '[]'::jsonb)))::json
    order by (o.status = 'pending') desc, o.created_at desc), '[]'::json)
  from core.sponsor_offers o;
$$;
revoke execute on function public.sponsoring_admin_list() from public, anon, authenticated;

create or replace function public.sponsoring_review(p_offer uuid, p_status text, p_note text default '')
returns json language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('active', 'rejected', 'closed') then raise exception 'Unbekannter Status.'; end if;
  update core.sponsor_offers set status = p_status, admin_note = left(btrim(coalesce(p_note, '')), 300), reviewed_at = now() where id = p_offer;
  if not found then raise exception 'Dieses Angebot gibt es nicht.'; end if;
  if p_status <> 'active' then
    update core.sponsor_applications set status = case when status = 'accepted' then 'ended' else 'declined' end, decided_at = now()
      where offer_id = p_offer and status in ('pending', 'accepted');
    delete from core.sponsors where offer_id = p_offer;
  end if;
  return public.sponsoring_admin_list();
end;
$$;
revoke execute on function public.sponsoring_review(uuid, text, text) from public, anon, authenticated;

-- Abrechnung über StreamHelp: Stand von Hand (bis ein Zahlungsanbieter eingerichtet ist)
create or replace function public.sponsoring_pay(p_app bigint, p_pay_status text)
returns json language plpgsql security definer set search_path = '' as $$
begin
  if p_pay_status not in ('open', 'invoiced', 'paid_in', 'paid_out') then raise exception 'Unbekannter Stand.'; end if;
  update core.sponsor_applications set pay_status = p_pay_status where id = p_app;
  if not found then raise exception 'Diese Bewerbung gibt es nicht.'; end if;
  return public.sponsoring_admin_list();
end;
$$;
revoke execute on function public.sponsoring_pay(bigint, text) from public, anon, authenticated;

-- ---------- Sponsoren des Kanals: Börsen-Sponsoren sind fest (legt die Firma fest) ----------
create or replace function public.sponsor_admin_list()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  return coalesce((select json_agg(json_build_object('id', s.id, 'name', s.name, 'text', s.text, 'code', s.code, 'url', s.url, 'active', s.active,
                     'offer_id', s.offer_id, 'logo_path', s.logo_path, 'every_min', s.every_min, 'show_sec', s.show_sec)
                   order by s.position, s.id) from core.sponsors s where s.channel_id = v_ch), '[]'::json);
end;
$$;

-- wie in …_tips_sponsors_pro.sql; bei Sponsoren aus der Börse lässt sich nur „zeigen/pausieren“ ändern
create or replace function public.sponsor_save(p_id bigint, p_name text, p_text text, p_code text, p_url text, p_active boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_name text := left(btrim(coalesce(p_name, '')), 60);
  v_url text := btrim(coalesce(p_url, ''));
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  if p_id is not null and exists (select 1 from core.sponsors where id = p_id and channel_id = v_ch and offer_id is not null) then
    update core.sponsors set active = coalesce(p_active, true) where id = p_id and channel_id = v_ch;
    return public.sponsor_admin_list();
  end if;
  if v_name = '' then raise exception 'Bitte einen Namen eingeben.'; end if;
  if v_url <> '' and (v_url !~ '^https://[^\s<>"''\\]{3,}$' or char_length(v_url) > 300) then raise exception 'Der Link muss mit https:// beginnen.'; end if;
  if p_id is null then
    if (select count(*) from core.sponsors where channel_id = v_ch) >= 20 then raise exception 'Höchstens 20 Sponsoren.'; end if;
    insert into core.sponsors (channel_id, name, text, code, url, active, position)
      values (v_ch, v_name, left(btrim(coalesce(p_text, '')), 140), left(btrim(coalesce(p_code, '')), 40), v_url, coalesce(p_active, true),
              coalesce((select max(position) + 1 from core.sponsors where channel_id = v_ch), 0));
  else
    update core.sponsors set name = v_name, text = left(btrim(coalesce(p_text, '')), 140), code = left(btrim(coalesce(p_code, '')), 40),
      url = v_url, active = coalesce(p_active, true)
      where id = p_id and channel_id = v_ch;
    if not found then raise exception 'Diesen Sponsor gibt es nicht.'; end if;
  end if;
  return public.sponsor_admin_list();
end;
$$;

-- Löschen eines Börsen-Sponsors beendet das Sponsoring
create or replace function public.sponsor_delete(p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_offer uuid;
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  delete from core.sponsors where id = p_id and channel_id = v_ch returning offer_id into v_offer;
  if v_offer is not null then
    update core.sponsor_applications set status = 'ended', decided_at = now() where offer_id = v_offer and channel_id = v_ch and status = 'accepted';
  end if;
  return public.sponsor_admin_list();
end;
$$;

-- Overlay (ohne Login): aktive Sponsoren mit Einblendung (Logo, alle X Minuten für Y Sekunden)
create or replace function public.sponsor_list()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('name', s.name, 'text', s.text, 'code', s.code, 'url', s.url,
           'logo_path', s.logo_path, 'every_min', s.every_min, 'show_sec', s.show_sec) order by s.position, s.id), '[]'::json)
  from core.sponsors s
  join public.channels c on c.id = s.channel_id and c.status = 'active'
  where s.channel_id = public.current_channel() and s.active;
$$;
grant execute on function public.sponsor_list() to anon, authenticated;

notify pgrst, 'reload schema';
