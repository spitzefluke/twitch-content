-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Alert-Feld im OBS-Overlay: neue Follower, Abos, Resubs und verschenkte Abos.
--   · stream_alerts: je Ereignis eine Zeile – geschrieben von twitch-eventsub
--     (Service-Rolle), gelesen vom Overlay (auch ohne Login) per Realtime
--   · alert_test(kind): Admins schicken einen Test-Alert ins Overlay
--   · alerts_status(): hat Dave die nötigen Twitch-Rechte schon freigegeben?
-- Für echte Alerts muss Dave Twitch einmal neu verbinden (neue Scopes
-- moderator:read:followers und channel:read:subscriptions). Mehrfach ausführbar.
-- ============================================================

create table if not exists public.stream_alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('follow', 'sub', 'resub', 'gift')),
  user_name text not null default '' check (char_length(user_name) <= 60),
  tier text not null default '' check (char_length(tier) <= 10),     -- 1000, 2000, 3000 (Stufe 1–3)
  months int not null default 0 check (months >= 0),                 -- Resub: Monate insgesamt
  amount int not null default 0 check (amount >= 0),                 -- Geschenk: wie viele Abos
  message text not null default '' check (char_length(message) <= 300),
  test boolean not null default false,
  event_id text unique,                                              -- Twitch-Nachrichten-ID gegen Doppelte
  created_at timestamptz not null default now()
);
create index if not exists stream_alerts_created_idx on public.stream_alerts (created_at desc);
alter table public.stream_alerts enable row level security;

-- Was im Stream zu sehen ist, darf jeder lesen (OBS hat keine Anmeldung)
drop policy if exists "stream_alerts: lesen für alle" on public.stream_alerts;
create policy "stream_alerts: lesen für alle" on public.stream_alerts
  for select to anon, authenticated using (true);
grant select on public.stream_alerts to anon;
-- Schreiben nur twitch-eventsub (Service-Rolle) und alert_test.

create or replace function public.alert_test(p_kind text)
returns public.stream_alerts language plpgsql security definer set search_path = '' as $$
declare
  names text[] := array['Lokfuehrer_Lena', 'SchienenSeb', 'TTV_Weichensteller', 'Bahnhofskater', 'ICE_Irina', 'Gleis9dreiviertel'];
  who text := names[1 + floor(random() * array_length(names, 1))::int];
  result public.stream_alerts;
begin
  if not public.is_admin() then
    raise exception 'Test-Alerts dürfen nur Admins schicken.';
  end if;
  if p_kind not in ('follow', 'sub', 'resub', 'gift') then
    raise exception 'Diese Alert-Art gibt es nicht.';
  end if;
  if (select count(*) from public.stream_alerts where test and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Genug getestet – kurz warten.';
  end if;
  insert into public.stream_alerts (kind, user_name, tier, months, amount, message, test)
  values (
    p_kind, who, '1000',
    case when p_kind = 'resub' then 3 + floor(random() * 20)::int else 0 end,
    case when p_kind = 'gift' then (array[1, 5, 10])[1 + floor(random() * 3)::int] else 0 end,
    case when p_kind = 'resub' then 'Test-Nachricht: Weiter so, Dave!' else '' end,
    true
  )
  returning * into result;
  delete from public.stream_alerts where test and created_at < now() - interval '1 day';
  return result;
end;
$$;

-- Hat Dave beim Verbinden schon die Rechte für Follower und Abos freigegeben?
create or replace function public.alerts_status()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'connected', exists (select 1 from public.twitch_connection where id = 1),
    'follows', coalesce((select 'moderator:read:followers' = any(scopes) from public.twitch_connection where id = 1), false),
    'subs', coalesce((select 'channel:read:subscriptions' = any(scopes) from public.twitch_connection where id = 1), false)
  );
$$;

revoke execute on function public.alert_test(text) from public, anon;
revoke execute on function public.alerts_status() from public, anon;
grant execute on function public.alert_test(text) to authenticated;
grant execute on function public.alerts_status() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stream_alerts'
  ) then
    alter publication supabase_realtime add table public.stream_alerts;
  end if;
end;
$$;
