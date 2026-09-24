-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Kanalpunkte fürs Ärgern und eigene Bingo-Karten
--
--   · „Ärgere den Dave“ kostet Kanalpunkte: Die Seite legt in Daves Kanal
--     die Belohnungen „🍅 Wirf was auf Dave“ und „🔊 Sound für Dave“ an
--     (Edge Functions twitch-oauth / twitch-eventsub). Kosten und Abklingzeit
--     stehen in prank_settings, die IDs in twitch_connection.
--   · Von der Webseite aus lösen nur noch Admins direkt aus (send_prank).
--   · bingo_player_cards: jeder kann sich eine eigene Bingo-Karte ziehen und
--     selbst abhaken; Daves Karte (bingo_card) bleibt die für den Stream.
-- Mehrfach ausführbar. Braucht …_pranks.sql, …_bingo.sql und …_chat_bot.sql.
-- ============================================================

-- ---------- Kosten der Belohnungen ----------
alter table public.prank_settings add column if not exists throw_cost int not null default 500
  check (throw_cost between 1 and 1000000);
alter table public.prank_settings add column if not exists sound_cost int not null default 300
  check (sound_cost between 1 and 1000000);

-- ---------- Belohnungen in Daves Kanal ----------
alter table public.twitch_connection add column if not exists prank_throw_reward_id text;
alter table public.twitch_connection add column if not exists prank_sound_reward_id text;
alter table public.twitch_connection add column if not exists prank_rewards_active boolean not null default false;

-- Einlösungen können doppelt zugestellt werden – so zählt jede nur einmal.
alter table public.pranks add column if not exists redemption_id text unique;

-- Öffentlicher Status ohne Tokens, jetzt mit den Belohnungen fürs Ärgern
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
        'prank_rewards_active', prank_rewards_active
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

-- ---------- Von der Webseite nur noch für Admins ----------
create or replace function public.send_prank(p_kind text, p_item text, p_sound uuid default null)
returns public.pranks language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  who text;
  snd public.sounds;
  result public.pranks;
begin
  if uid is null then
    raise exception 'Bitte zuerst anmelden.';
  end if;
  -- Zuschauer ärgern Dave über Kanalpunkte auf Twitch (Edge Function twitch-eventsub).
  -- Direkt von der Webseite dürfen nur Admins auslösen, z. B. zum Testen.
  if not public.is_admin() then
    raise exception '„Ärgere den Dave“ geht über Kanalpunkte im Twitch-Chat von Dave.' using hint = 'points';
  end if;

  who := coalesce((select username from public.profiles where id = uid), 'jemand');

  if p_kind = 'sound' and p_sound is not null then
    select * into snd from public.sounds where id = p_sound;
    if not found then
      raise exception 'Diesen Sound gibt es nicht mehr.';
    end if;
    insert into public.pranks (kind, item, sound_path, label, requested_by)
      values ('sound', 'custom', snd.path, snd.name, who)
      returning * into result;
  elsif p_kind in ('throw', 'sound') and p_item ~ '^[a-z0-9_-]{1,24}$' and p_item <> 'custom' then
    insert into public.pranks (kind, item, requested_by)
      values (p_kind, p_item, who)
      returning * into result;
  else
    raise exception 'Unbekannte Aktion.';
  end if;

  -- Das Overlay braucht nur die letzten Minuten, die Seite die letzten Einträge.
  delete from public.pranks where created_at < now() - interval '2 days';
  return result;
end;
$$;
revoke execute on function public.send_prank(text, text, uuid) from public, anon;
grant execute on function public.send_prank(text, text, uuid) to authenticated;

-- ---------- Eigene Bingo-Karten ----------
create table if not exists public.bingo_player_cards (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  size int not null check (size between 3 and 5),
  cells jsonb not null check (jsonb_typeof(cells) = 'array'),
  marked int[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bingo_player_cards enable row level security;

drop policy if exists "bingo_player_cards: nur die eigene" on public.bingo_player_cards;
create policy "bingo_player_cards: nur die eigene" on public.bingo_player_cards
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
