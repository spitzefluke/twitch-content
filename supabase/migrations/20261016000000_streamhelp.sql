-- ============================================================
-- StreamHelp
--   1) Twitch-Gesundheitscheck: twitch_health hält fest, ob die Twitch-Verbindung alle
--      Rechte für die neuesten Funktionen hat und ob die Abos bei Twitch laufen
--      (Follows, Abos, Bits, Kanalpunkte, Chat). Probleme sehen Streamer, Mods und Admins
--      im Dashboard. Geschrieben wird nur von den Edge Functions (Service-Rolle).
--   2) Kanalpunkte-Einlösungen als Alert (stream_alerts.kind 'redeem')
--   3) Keine Zug-Themen mehr in den mitgelieferten Texten (nur unveränderte Standardtexte)
-- Braucht 20261015000000_security_hardening.sql. Mehrfach ausführbar.
-- ============================================================

-- ---------- 1) Twitch-Gesundheitscheck ----------
create table if not exists public.twitch_health (
  id int primary key default 1 check (id = 1),
  checked_at timestamptz,
  ok boolean not null default true,
  -- [{code, level: error|warn, text, fix}]
  problems jsonb not null default '[]'::jsonb,
  -- Rechte, Abos, Bot … für die Anzeige im Dashboard
  details jsonb not null default '{}'::jsonb,
  last_event_at timestamptz,
  last_event_type text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.twitch_health (id) values (1) on conflict (id) do nothing;
alter table public.twitch_health enable row level security;
drop policy if exists "twitch_health: lesen für admins" on public.twitch_health;
create policy "twitch_health: lesen für admins" on public.twitch_health
  for select to authenticated using ((select public.is_admin()) or (select public.is_owner()));
do $$ begin perform public.realtime_add('twitch_health'); end $$;

-- ---------- 2) Kanalpunkte als Alert ----------
alter table public.stream_alerts drop constraint if exists stream_alerts_kind_check;
alter table public.stream_alerts add constraint stream_alerts_kind_check
  check (kind in ('follow', 'sub', 'resub', 'gift', 'bits', 'redeem'));

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
  if p_kind not in ('follow', 'sub', 'resub', 'gift', 'bits', 'redeem') then
    raise exception 'Diese Alert-Art gibt es nicht.';
  end if;
  if (select count(*) from public.stream_alerts where test and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Genug getestet – kurz warten.';
  end if;
  insert into public.stream_alerts (kind, user_name, tier, months, amount, message, test)
  values (
    p_kind, who, case when p_kind in ('bits', 'redeem', 'follow') then '' else '1000' end,
    case when p_kind = 'resub' then 3 + floor(random() * 20)::int else 0 end,
    case when p_kind = 'gift' then (array[1, 5, 10])[1 + floor(random() * 3)::int]
         when p_kind = 'bits' then (array[100, 500, 1000])[1 + floor(random() * 3)::int]
         when p_kind = 'redeem' then (array[500, 1000, 5000])[1 + floor(random() * 3)::int]
         else 0 end,
    case when p_kind = 'resub' then 'Test-Nachricht: Weiter so!'
         when p_kind = 'bits' then 'Test-Cheer: Let''s go!'
         when p_kind = 'redeem' then rewards[1 + floor(random() * array_length(rewards, 1))::int]
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

-- ---------- 3) Keine Zug-Themen mehr (nur mitgelieferte, unveränderte Texte) ----------
update public.tiles set title = 'Late-Night-Marathon', description = 'Ein langer Stream bis tief in die Nacht – ohne Pause bis zum Finale.', theme = 'storm'
  where id = 'idea-1' and title = 'Nachtschicht Güterzug';
update public.tiles set title = 'Halloween-Special', description = 'Halloween-Stream: Horror-Games und jede Menge Schreckmomente.'
  where id = 'idea-3' and title = 'Geisterzug-Special';
update public.tiles set title = 'Subathon', description = 'Jeder Sub verlängert den Stream. Wie lange geht es diesmal?'
  where id = 'idea-4' and title = 'Subathon: Endstation?';
update public.tiles set theme = 'storm' where kind = 'countdown' and theme in ('tracks', 'city');

update public.wheel_variants set name = 'Handicap-Runde' where name = 'Handicap-Express';
update public.wheel_variants set
  segments = replace(segments::text, '{"label": "Gleisarbeiter", "detail": "Lande so nah wie möglich an Gleisen oder einer Straße."}',
                                     '{"label": "Straßenkind", "detail": "Lande so nah wie möglich an einer Straße."}')::jsonb
  where segments::text like '%Gleisarbeiter%';

-- Dino-Sprüche mit Zug-Bezug raus, ein paar neue rein
update public.pet set phrases = array(
    select p from unnest(phrases) with ordinality as t(p, n)
    where p !~* '(weiche|gleis|nächster halt|zug |zug$|verspätung|fährt ein|ruhewagen|fahrplan|dino-express)'
    order by n)
  || array['Ich hab mehr Lag als Dein WLAN.', 'Chat, wer hat hier die Bananen verteilt?', 'Noch eine Runde? Immer!']
  where exists (select 1 from unnest(phrases) p where p ~* '(weiche|gleis|nächster halt|zug |zug$|verspätung|fährt ein|ruhewagen|fahrplan|dino-express)');

-- Laufband: StreamHelp statt Stellwerk, Kanal statt fester Name
update public.ticker set items = array(
    select case
      when t = '🚂 Content-Stellwerk: {seite}' then '💜 StreamHelp: {seite}'
      when t ~* 'twitch\.tv/zugfahrer_davetv' then '🟣 twitch.tv/{kanal}'
      else t end
    from unnest(items) with ordinality as x(t, n) order by n)
  where exists (select 1 from unnest(items) t where t = '🚂 Content-Stellwerk: {seite}' or t ~* 'zugfahrer_davetv');

update public.profiles set username = 'StreamHelp-Admin' where username = 'Stellwerk-Admin';
