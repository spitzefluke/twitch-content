-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Fortnite-Bingo: Tipprunde mit Kanalpunkten. Zuschauer tippen über eine
-- Twitch-Vorhersage, welche Reihe auf Daves Karte zuerst voll wird – wer
-- richtig liegt, bekommt Kanalpunkte (Edge Function bingo-bet).
--
--   · bingo_card.bet: die laufende oder letzte Tipprunde, lesbar auch für OBS
--     {id, status: active|resolved|canceled, outcomes: [{id, key, title}],
--      lock_at, started_at, winner?}
--   · Solange eine Tipprunde läuft, gibt es keine neue Karte; mit einer neuen
--     Karte verschwindet die alte Runde.
-- Mehrfach ausführbar.
-- ============================================================

alter table public.bingo_card add column if not exists bet jsonb;

create or replace function public.bingo_card_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.cells is distinct from old.cells or new.size is distinct from old.size then
    if old.bet ->> 'status' = 'active' then
      raise exception 'Es läuft noch eine Tipprunde. Erst beenden oder abbrechen, dann eine neue Karte ziehen.';
    end if;
    new.bet := null;
  end if;
  return new;
end;
$$;
drop trigger if exists on_bingo_card_update on public.bingo_card;
create trigger on_bingo_card_update
  before update on public.bingo_card
  for each row execute function public.bingo_card_before_update();

-- Öffentlicher Status ohne Tokens, jetzt mit: Darf die Seite Vorhersagen starten?
-- (Berechtigung channel:manage:predictions – ältere Verbindungen haben sie nicht)
create or replace function public.twitch_status()
returns json language sql stable security definer set search_path = '' as $$
  select (
    coalesce(
      (select jsonb_build_object(
        'connected', true,
        'login', broadcaster_login,
        'display_name', display_name,
        'reward_active', reward_id is not null,
        'reward_title', reward_title,
        'reward_cost', reward_cost,
        'subscription_active', subscription_id is not null,
        'bot_scope', 'channel:bot' = any(scopes),
        'prank_rewards', prank_throw_reward_id is not null and prank_sound_reward_id is not null,
        'prank_rewards_active', prank_rewards_active,
        'predictions_scope', 'channel:manage:predictions' = any(scopes)
      ) from public.twitch_connection where id = 1),
      jsonb_build_object('connected', false)
    )
    || coalesce(
      (select jsonb_build_object('bot_connected', true, 'bot_login', login, 'bot_name', display_name)
       from public.twitch_bot where id = 1),
      jsonb_build_object('bot_connected', false)
    )
  )::json;
$$;
revoke execute on function public.twitch_status() from public, anon;
grant execute on function public.twitch_status() to authenticated;
