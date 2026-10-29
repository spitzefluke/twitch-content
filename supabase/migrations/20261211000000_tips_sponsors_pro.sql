-- ============================================================
-- StreamHelp: Trinkgeld, Sponsoren, Pro-Vorbereitung (nach …_raid_network.sql einspielen)
--   Trinkgeld: StreamHelp nimmt kein Geld an. Der Streamer verbindet seinen Ko-fi (Webhook mit
--   Bestätigungs-Token) und/oder hinterlegt eigene Links (PayPal.me, Tipeee, Streamlabs …).
--   Ko-fi-Trinkgelder kommen als Alert „tip“ ins Overlay (Betrag in Cent, Währung in tier) und der Bot
--   bedankt sich. !trinkgeld im Chat nennt die Links, das öffentliche Profil zeigt sie.
--   Sponsoren: eigene Partner des Streamers (Name, Text, Rabattcode, Link) – laufen mit „Anzeige“
--   im Laufband des Overlays, !sponsor im Chat, auf dem öffentlichen Profil. Kein Geldfluss über StreamHelp.
--   Pro: Technik für Pro-Kanäle (gültig bis …), vergibt nur der Plattform-Admin – noch ohne Bezahlung.
-- Mehrfach ausführbar.
-- ============================================================

-- ---------- Alerts: neue Art „tip“ ----------
alter table core.stream_alerts drop constraint if exists stream_alerts_kind_check;
alter table core.stream_alerts add constraint stream_alerts_kind_check
  check (kind in ('follow', 'sub', 'resub', 'gift', 'bits', 'redeem', 'tip'));

-- Test-Alerts wie in …_streamhelp.sql, dazu Trinkgeld (Betrag in Cent, Währung in tier)
create or replace function public.alert_test(p_kind text)
returns public.stream_alerts language plpgsql security definer set search_path = '' as $$
declare
  names text[] := array['NightOwl_Mia', 'PixelPaul', 'GG_Gina', 'LootLukas', 'CrispyCarl', 'StreamSofia'];
  rewards text[] := array['🎡 Glücksrad', '🔊 Nachricht vorlesen', '🃏 Sammelkarten-Pack', '💧 Trink was!'];
  who text := names[1 + floor(random() * array_length(names, 1))::int];
  result public.stream_alerts;
begin
  if not public.is_admin() then
    raise exception 'Test-Alerts dürfen nur Admins schicken.';
  end if;
  if p_kind not in ('follow', 'sub', 'resub', 'gift', 'bits', 'redeem', 'tip') then
    raise exception 'Diese Alert-Art gibt es nicht.';
  end if;
  if (select count(*) from public.stream_alerts where test and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Genug getestet – kurz warten.';
  end if;
  insert into public.stream_alerts (kind, user_name, tier, months, amount, message, test)
  values (
    p_kind, who, case when p_kind = 'tip' then 'EUR' when p_kind in ('bits', 'redeem', 'follow') then '' else '1000' end,
    case when p_kind = 'resub' then 3 + floor(random() * 20)::int else 0 end,
    case when p_kind = 'gift' then (array[1, 5, 10])[1 + floor(random() * 3)::int]
         when p_kind = 'bits' then (array[100, 500, 1000])[1 + floor(random() * 3)::int]
         when p_kind = 'redeem' then (array[500, 1000, 5000])[1 + floor(random() * 3)::int]
         when p_kind = 'tip' then (array[300, 500, 1000])[1 + floor(random() * 3)::int]
         else 0 end,
    case when p_kind = 'resub' then 'Test-Nachricht: Weiter so!'
         when p_kind = 'bits' then 'Test-Cheer: Let''s go!'
         when p_kind = 'redeem' then rewards[1 + floor(random() * array_length(rewards, 1))::int]
         when p_kind = 'tip' then 'Test-Trinkgeld: Danke für den Stream!'
         else '' end,
    true
  )
  returning * into result;
  delete from public.stream_alerts where test and created_at < now() - interval '1 day';
  return result;
end;
$$;
revoke execute on function public.alert_test(text) from public, anon;
grant execute on function public.alert_test(text) to authenticated;

-- ---------- Trinkgeld ----------
create table if not exists core.tip_settings (
  channel_id uuid primary key references public.channels on delete cascade,
  kofi_token text check (kofi_token is null or kofi_token ~ '^[A-Za-z0-9-]{8,100}$'),   -- geheim: Bestätigungs-Token von Ko-fi
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 4),
  alert boolean not null default true,
  thank boolean not null default true,
  thank_text text not null default '💶 Danke {name} für {amount} Trinkgeld! {message}' check (char_length(thank_text) <= 300),
  min_cents int not null default 0 check (min_cents between 0 and 1000000),
  last_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table core.tip_settings enable row level security;
revoke all on core.tip_settings from anon, authenticated;

-- Links prüfen: höchstens 4, nur https, Name kurz
create or replace function public.tip_links_clean(p_links jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  l jsonb;
  v_out jsonb := '[]'::jsonb;
  v_url text;
begin
  if p_links is null or jsonb_typeof(p_links) <> 'array' then return v_out; end if;
  for l in select * from jsonb_array_elements(p_links) loop
    v_url := btrim(coalesce(l ->> 'url', ''));
    if v_url = '' then continue; end if;
    if v_url !~ '^https://[^\s<>"''\\]{3,}$' or char_length(v_url) > 300 then
      raise exception 'Bitte nur https-Links (z. B. https://paypal.me/…).';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('label', left(btrim(coalesce(l ->> 'label', '')), 30), 'url', v_url));
    if jsonb_array_length(v_out) >= 4 then exit; end if;
  end loop;
  return v_out;
end;
$$;

create or replace function public.tip_get()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  s core.tip_settings;
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  select * into s from core.tip_settings where channel_id = v_ch;
  return json_build_object(
    'channel_id', v_ch, 'kofi', s.kofi_token is not null,
    'links', coalesce(s.links, '[]'::jsonb), 'alert', coalesce(s.alert, true), 'thank', coalesce(s.thank, true),
    'thank_text', coalesce(s.thank_text, '💶 Danke {name} für {amount} Trinkgeld! {message}'), 'min_cents', coalesce(s.min_cents, 0),
    'last_at', s.last_at,
    'recent', coalesce((select json_agg(json_build_object('name', a.user_name, 'cents', a.amount, 'currency', a.tier, 'message', a.message, 'at', a.created_at)
                         order by a.created_at desc)
                        from (select * from core.stream_alerts where channel_id = v_ch and kind = 'tip' and not test order by created_at desc limit 15) a), '[]'::json));
end;
$$;
revoke execute on function public.tip_get() from public, anon;
grant execute on function public.tip_get() to authenticated;

create or replace function public.tip_save(p_links jsonb, p_alert boolean, p_thank boolean, p_thank_text text, p_min_cents int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_text text := left(btrim(coalesce(p_thank_text, '')), 300);
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  if v_text = '' then v_text := '💶 Danke {name} für {amount} Trinkgeld! {message}'; end if;
  insert into core.tip_settings (channel_id, links, alert, thank, thank_text, min_cents)
    values (v_ch, public.tip_links_clean(p_links), coalesce(p_alert, true), coalesce(p_thank, true), v_text, greatest(0, least(coalesce(p_min_cents, 0), 1000000)))
  on conflict (channel_id) do update set links = excluded.links, alert = excluded.alert, thank = excluded.thank,
    thank_text = excluded.thank_text, min_cents = excluded.min_cents, updated_at = now();
  return public.tip_get();
end;
$$;
revoke execute on function public.tip_save(jsonb, boolean, boolean, text, int) from public, anon;
grant execute on function public.tip_save(jsonb, boolean, boolean, text, int) to authenticated;

-- Ko-fi verbinden: Bestätigungs-Token aus Ko-fi → Settings → API (leer = trennen). Wird nie zurückgegeben.
create or replace function public.tip_kofi_token(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  if v_token is not null and v_token !~ '^[A-Za-z0-9-]{8,100}$' then raise exception 'Das sieht nicht wie ein Ko-fi-Token aus.'; end if;
  insert into core.tip_settings (channel_id, kofi_token) values (v_ch, v_token)
    on conflict (channel_id) do update set kofi_token = excluded.kofi_token, updated_at = now();
  return public.tip_get();
end;
$$;
revoke execute on function public.tip_kofi_token(text) from public, anon;
grant execute on function public.tip_kofi_token(text) to authenticated;

-- Edge Function tips (Service-Rolle): stimmt der Token? Dann Einstellungen für Alert und Dank.
create or replace function public.tip_kofi_check(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  s core.tip_settings;
begin
  select * into s from core.tip_settings where channel_id = public.current_channel();
  if not found or s.kofi_token is null or p_token is null or s.kofi_token <> p_token then return null; end if;
  update core.tip_settings set last_at = now() where channel_id = s.channel_id;
  return json_build_object('alert', s.alert, 'thank', s.thank, 'thank_text', s.thank_text, 'min_cents', s.min_cents);
end;
$$;
revoke execute on function public.tip_kofi_check(text) from public, anon, authenticated;

-- ---------- Sponsoren ----------
create table if not exists core.sponsors (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.channels on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  text text not null default '' check (char_length(text) <= 140),
  code text not null default '' check (char_length(code) <= 40),
  url text not null default '' check (url = '' or (url ~ '^https://[^\s<>"''\\]{3,}$' and char_length(url) <= 300)),
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sponsors_channel on core.sponsors (channel_id, position, id);
alter table core.sponsors enable row level security;
revoke all on core.sponsors from anon, authenticated;

create or replace function public.sponsor_admin_list()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  return coalesce((select json_agg(json_build_object('id', s.id, 'name', s.name, 'text', s.text, 'code', s.code, 'url', s.url, 'active', s.active)
                   order by s.position, s.id) from core.sponsors s where s.channel_id = v_ch), '[]'::json);
end;
$$;
revoke execute on function public.sponsor_admin_list() from public, anon;
grant execute on function public.sponsor_admin_list() to authenticated;

create or replace function public.sponsor_save(p_id bigint, p_name text, p_text text, p_code text, p_url text, p_active boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_name text := left(btrim(coalesce(p_name, '')), 60);
  v_url text := btrim(coalesce(p_url, ''));
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
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
revoke execute on function public.sponsor_save(bigint, text, text, text, text, boolean) from public, anon;
grant execute on function public.sponsor_save(bigint, text, text, text, text, boolean) to authenticated;

create or replace function public.sponsor_delete(p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  delete from core.sponsors where id = p_id and channel_id = v_ch;
  return public.sponsor_admin_list();
end;
$$;
revoke execute on function public.sponsor_delete(bigint) from public, anon;
grant execute on function public.sponsor_delete(bigint) to authenticated;

-- Overlay (ohne Login): aktive Sponsoren des Kanals – Werbung ist ohnehin öffentlich
create or replace function public.sponsor_list()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('name', s.name, 'text', s.text, 'code', s.code, 'url', s.url) order by s.position, s.id), '[]'::json)
  from core.sponsors s
  join public.channels c on c.id = s.channel_id and c.status = 'active'
  where s.channel_id = public.current_channel() and s.active;
$$;
grant execute on function public.sponsor_list() to anon, authenticated;

-- ---------- Chat: !trinkgeld und !sponsor (Edge Function, Service-Rolle) ----------
create or replace function public.money_chat(p_user_id text, p_name text, p_badges text[], p_text text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_cmd text := lower(regexp_replace(split_part(btrim(coalesce(p_text, '')), ' ', 1), '^!', ''));
  v_kind text;
  v_reply text;
begin
  v_kind := case when v_cmd in ('trinkgeld', 'spende', 'spenden', 'donate', 'kofi', 'tips') then 'tip'
                 when v_cmd in ('sponsor', 'sponsoren', 'partner', 'code', 'codes') then 'sponsor' end;
  if v_kind is null or v_ch is null then return json_build_object('handled', false); end if;
  if v_kind = 'tip' then
    select string_agg(coalesce(nullif(l ->> 'label', ''), 'Link') || ': ' || (l ->> 'url'), ' · ') into v_reply
      from core.tip_settings t, jsonb_array_elements(t.links) l where t.channel_id = v_ch;
    if v_reply is null then return json_build_object('handled', false); end if;
    v_reply := '💶 Trinkgeld für den Stream (freiwillig, geht direkt an den Streamer): ' || v_reply;
  else
    select string_agg(s.name || coalesce(nullif(' – ' || s.text, ' – '), '') || coalesce(nullif(' · Code ' || s.code, ' · Code '), '')
                      || coalesce(nullif(' · ' || s.url, ' · '), ''), ' | ' order by s.position, s.id) into v_reply
      from core.sponsors s where s.channel_id = v_ch and s.active;
    if v_reply is null then return json_build_object('handled', false); end if;
    v_reply := 'Werbung: ' || v_reply;
  end if;
  -- höchstens alle 30 Sekunden je Befehl (sonst flutet der Chat)
  if exists (select 1 from core.chat_cooldowns where channel_id = v_ch and slot = 'money:' || v_kind and at > now() - interval '30 seconds') then
    return json_build_object('handled', true);
  end if;
  insert into core.chat_cooldowns (channel_id, slot, at) values (v_ch, 'money:' || v_kind, now())
    on conflict (channel_id, slot) do update set at = now();
  return json_build_object('handled', true, 'reply', left(v_reply, 480));
end;
$$;
revoke execute on function public.money_chat(text, text, text[], text) from public, anon, authenticated;

-- ---------- Pro (vorbereitet, ohne Bezahlung) ----------
create table if not exists core.channel_plans (
  channel_id uuid primary key references public.channels on delete cascade,
  plan text not null default 'pro' check (plan in ('pro')),
  until timestamptz not null,
  note text not null default '' check (char_length(note) <= 200),
  updated_at timestamptz not null default now()
);
alter table core.channel_plans enable row level security;
revoke all on core.channel_plans from anon, authenticated;

create or replace function public.channel_is_pro(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from core.channel_plans where channel_id = p_channel and until > now());
$$;
revoke execute on function public.channel_is_pro(uuid) from public, anon, authenticated;

-- Dashboard (Team des Kanals)
create or replace function public.pro_status()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  p core.channel_plans;
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  select * into p from core.channel_plans where channel_id = v_ch;
  return json_build_object('pro', coalesce(p.until > now(), false), 'until', case when p.until > now() then p.until end);
end;
$$;
revoke execute on function public.pro_status() from public, anon;
grant execute on function public.pro_status() to authenticated;

-- Admin-Bereich (Edge Function admin, Service-Rolle): Pro für n Tage vergeben/verlängern, 0 = entziehen
create or replace function public.pro_grant(p_channel uuid, p_days int, p_note text default '')
returns json language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.channels where id = p_channel) then raise exception 'Diesen Kanal gibt es nicht.'; end if;
  if coalesce(p_days, 0) <= 0 then
    delete from core.channel_plans where channel_id = p_channel;
  else
    if p_days > 3660 then raise exception 'Höchstens 10 Jahre.'; end if;
    insert into core.channel_plans (channel_id, until, note)
      values (p_channel, now() + make_interval(days => p_days), left(btrim(coalesce(p_note, '')), 200))
    on conflict (channel_id) do update set
      until = greatest(core.channel_plans.until, now()) + make_interval(days => p_days),
      note = case when excluded.note <> '' then excluded.note else core.channel_plans.note end, updated_at = now();
  end if;
  return public.channels_admin();
end;
$$;
revoke execute on function public.pro_grant(uuid, int, text) from public, anon, authenticated;

-- Admin-Liste wie in …_raid_network.sql, dazu „Pro bis“
create or replace function public.channels_admin()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_site_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Nur für den Plattform-Admin.';
  end if;
  return (select coalesce(json_agg(json_build_object(
      'id', c.id, 'login', c.login, 'display_name', c.display_name, 'avatar_url', c.avatar_url,
      'status', c.status, 'is_default', c.is_default, 'note', c.note, 'admin_note', c.admin_note,
      'created_at', c.created_at, 'approved_at', c.approved_at,
      'owner', coalesce((select username from public.profiles where id = c.owner_id), ''),
      'connected', exists (select 1 from core.twitch_connection t where t.channel_id = c.id),
      'blocked_until', case when c.blocked_until > now() then c.blocked_until end,
      'overlay_off_until', case when c.overlay_off_until > now() then c.overlay_off_until end,
      'overlay_off_reason', c.overlay_off_reason,
      'warning', nullif(c.warning, ''), 'warning_at', c.warning_at, 'warning_seen_at', c.warning_seen_at,
      'referred_by', (select coalesce(nullif(rc.display_name, ''), rc.login) from core.referrals r join public.channels rc on rc.id = r.referrer_id where r.channel_id = c.id),
      'referrals', public.referral_count(c.id),
      'pro_until', (select p.until from core.channel_plans p where p.channel_id = c.id and p.until > now()))
    order by (c.status = 'pending') desc, (c.status = 'pending' and exists (select 1 from core.referrals r where r.channel_id = c.id)) desc, c.created_at desc), '[]'::json)
    from public.channels c);
end;
$$;

-- ---------- Öffentliches Profil wie in …_raid_network.sql, dazu Trinkgeld-Links und Sponsoren ----------
create or replace function public.public_profile(p_login text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'login', c.login, 'display_name', c.display_name, 'avatar_url', c.avatar_url,
    'live', coalesce(g.live_at > now() - interval '15 minutes', false),
    'category', case when g.live_at > now() - interval '15 minutes' then left(coalesce(g.live_category, ''), 60) else '' end,
    'bio', cp.bio, 'links', cp.links, 'tz', cp.tz, 'accent', cp.accent,
    'away_until', case when cp.away_until >= (now() at time zone cp.tz)::date then cp.away_until end,
    'away_note', case when cp.away_until >= (now() at time zone cp.tz)::date then cp.away_note else '' end,
    'slots', coalesce((select json_agg(json_build_object('weekday', s.weekday, 'start', to_char(s.start_time, 'HH24:MI'),
                        'minutes', s.minutes, 'title', s.title, 'game', s.game) order by s.weekday, s.start_time)
                       from core.stream_schedule s where s.channel_id = c.id), '[]'::json),
    'upcoming', public.schedule_upcoming(c.id, 8),
    'badge', public.referral_badge(public.referral_count(c.id)),
    'tips', coalesce((select t.links from core.tip_settings t where t.channel_id = c.id), '[]'::jsonb),
    'sponsors', coalesce((select json_agg(json_build_object('name', sp.name, 'text', sp.text, 'code', sp.code, 'url', sp.url) order by sp.position, sp.id)
                          from core.sponsors sp where sp.channel_id = c.id and sp.active), '[]'::json))
  from public.channels c
  join core.channel_profile cp on cp.channel_id = c.id and cp.is_public
  left join core.stream_games g on g.channel_id = c.id and g.id = 1
  where c.status = 'active' and c.login = lower(btrim(coalesce(p_login, '')))
  limit 1;
$$;
grant execute on function public.public_profile(text) to anon, authenticated;

notify pgrst, 'reload schema';
