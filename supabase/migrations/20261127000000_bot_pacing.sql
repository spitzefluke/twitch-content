-- Chat-Bot: nicht zu schnell senden (nach …_hardening.sql einspielen).
--
-- Twitch lässt einen Bot, der im Kanal kein Mod ist, nur etwa 20 Nachrichten in 30 Sekunden schreiben
-- („Your message was not sent because you are sending messages too quickly“, HTTP 429). Kamen mehrere
-- Nachrichten auf einmal (Ansagen aus der Warteschlange, Antworten auf Befehle, Begrüßung, Danke …),
-- gingen sie ohne Abstand raus – und die überzähligen waren verloren.
--
--   · bot_send_slot(): vergibt je Kanal den nächsten freien Sendezeitpunkt (Abstand p_gap_ms) und sagt,
--     wie lange die Edge Function vor dem Senden warten soll. Gilt auch für gleichzeitige Aufrufe.
--   · Bot-Protokoll: neuer Status 'retry' – Twitch hat gebremst, die Nachricht kommt gleich noch einmal.

create table if not exists core.bot_send_pace (
  channel_id uuid primary key references public.channels on delete cascade,
  next_at timestamptz not null default now()
);
alter table core.bot_send_pace enable row level security;
revoke all on core.bot_send_pace from anon, authenticated;

-- Wartezeit in ms bis zum eigenen Sendeplatz (0 = sofort). Nur Edge Functions (Service-Rolle).
create or replace function public.bot_send_slot(p_gap_ms int default 1600)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_gap interval := make_interval(secs => greatest(0, least(coalesce(p_gap_ms, 1600), 10000)) / 1000.0);
  v_slot timestamptz;
begin
  if v_ch is null then return 0; end if;
  -- next_at = Ende des zuletzt vergebenen Platzes; der eigene Platz beginnt dort (oder jetzt)
  insert into core.bot_send_pace as p (channel_id, next_at) values (v_ch, clock_timestamp() + v_gap)
  on conflict (channel_id) do update set next_at = greatest(p.next_at, clock_timestamp()) + v_gap
  returning next_at - v_gap into v_slot;
  return greatest(0, ceil(extract(epoch from (v_slot - clock_timestamp())) * 1000))::int;
end;
$$;
revoke execute on function public.bot_send_slot(int) from public, anon, authenticated;
grant execute on function public.bot_send_slot(int) to service_role;

-- ---------- Bot-Protokoll: Status 'retry' ----------
alter table core.bot_log drop constraint if exists bot_log_status_check;
alter table core.bot_log add constraint bot_log_status_check
  check (status in ('sent', 'dropped', 'error', 'no_bot', 'off', 'retry'));

-- Wie in …_live_welcome.sql, dazu der Status 'retry'
create or replace function public.bot_log_add(p_text text, p_status text, p_reason text default '', p_source text default 'chat',
                                              p_bot text default '', p_ms int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if v_ch is null then return; end if;
  insert into core.bot_log (channel_id, bot, text, status, reason, source, ms)
  values (v_ch, left(coalesce(p_bot, ''), 40), left(coalesce(p_text, ''), 500),
          case when p_status in ('sent', 'dropped', 'error', 'no_bot', 'off', 'retry') then p_status else 'error' end,
          left(coalesce(p_reason, ''), 300),
          case when p_source in ('chat', 'outbox', 'test', 'mod', 'system') then p_source else 'chat' end,
          case when p_ms between 0 and 600000 then p_ms end);
  if random() < 0.02 then delete from core.bot_log where created_at < now() - interval '7 days'; end if;
end;
$$;
revoke execute on function public.bot_log_add(text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.bot_log_add(text, text, text, text, text, int) to service_role;
