-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Chat-Bot: Ergebnisse schreibt ein eigener Twitch-Account in den Chat,
-- nicht mehr Dave selbst.
--
-- Der Bot-Account gibt der App einmal die Rechte user:write:chat und
-- user:bot, Dave gibt channel:bot. Gesendet wird dann mit dem App-Token
-- im Namen des Bots – Tokens des Bots müssen dafür nicht gespeichert werden.
-- Mehrfach ausführbar.
-- ============================================================

create table if not exists public.twitch_bot (
  id int primary key default 1 check (id = 1),
  user_id text not null,
  login text not null,
  display_name text not null,
  connected_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.twitch_bot enable row level security;
-- absichtlich keine Policies: nur Edge Functions (service role) lesen und schreiben

-- Welcher Login läuft gerade: Daves Kanal oder der Bot?
alter table public.oauth_states add column if not exists kind text not null default 'broadcaster'
  check (kind in ('broadcaster', 'bot'));

-- Öffentlicher Status ohne Tokens, jetzt mit Bot
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
        'bot_scope', 'channel:bot' = any(scopes)
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
