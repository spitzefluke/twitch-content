-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- 1) OBS-Overlay live: Die Einstellungen aus dem OBS-Dialog liegen hier.
--    OBS lädt einmal overlay.html?live=1 – jede Änderung erscheint sofort,
--    ohne die Browserquelle neu einzurichten. Ändern darf Dave (wer Twitch
--    verbunden hat, oder der Admin-Bereich), Admins nur, wenn Dave es erlaubt.
-- 2) Daves Dino: Zuschauer füttern ihn im Stream mit einem Chat-Befehl
--    (Standard !füttern, über twitch-eventsub). Klicks auf der Webseite
--    wirken für Zuschauer nur noch auf der Seite – im Stream lösen nur Admins aus.
--    Dazu viele neue Sprüche.
-- Mehrfach ausführbar.
-- ============================================================

-- ---------- Wer ist „Dave“? ----------
-- Wer Daves Twitch-Kanal verbunden hat, oder der interne Account des Admin-Bereichs.
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'stellwerk_site_admin')::boolean, false)
    or exists (select 1 from public.twitch_connection where connected_by = auth.uid())
  );
$$;

-- ============================================================
-- 1) OBS-Overlay live
-- ============================================================
create table if not exists public.overlay_config (
  id int primary key default 1 check (id = 1),
  -- dieselben Parameter wie in der Adresse, z. B. wheel=br&next=bl&tstyle=board
  params text not null default '' check (char_length(params) <= 2000 and params ~ '^[A-Za-z0-9_=&.,%+-]*$'),
  admins_can_edit boolean not null default false,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.overlay_config (id) values (1) on conflict (id) do nothing;
alter table public.overlay_config enable row level security;

drop policy if exists "overlay_config: lesen für alle" on public.overlay_config;
create policy "overlay_config: lesen für alle" on public.overlay_config
  for select to anon, authenticated using (true);
grant select on public.overlay_config to anon;
-- Schreiben nur über die Funktionen unten.

create or replace function public.overlay_can_edit()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_owner()
    or (public.is_admin() and coalesce((select admins_can_edit from public.overlay_config where id = 1), false));
$$;

create or replace function public.overlay_access()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'can_edit', public.overlay_can_edit(),
    'is_owner', public.is_owner(),
    'admins_can_edit', coalesce((select admins_can_edit from public.overlay_config where id = 1), false)
  );
$$;

create or replace function public.overlay_save(p_params text)
returns public.overlay_config language plpgsql security definer set search_path = '' as $$
declare
  result public.overlay_config;
begin
  if not public.overlay_can_edit() then
    raise exception 'Das OBS-Overlay dürfen nur Dave und von ihm freigeschaltete Admins ändern.';
  end if;
  update public.overlay_config
    set params = coalesce(p_params, ''), updated_by = public.my_name(), updated_at = now()
    where id = 1
    returning * into result;
  return result;
end;
$$;

create or replace function public.overlay_allow_admins(p_on boolean)
returns public.overlay_config language plpgsql security definer set search_path = '' as $$
declare
  result public.overlay_config;
begin
  if not public.is_owner() then
    raise exception 'Nur Dave darf das erlauben.';
  end if;
  update public.overlay_config set admins_can_edit = coalesce(p_on, false), updated_at = now()
    where id = 1 returning * into result;
  return result;
end;
$$;

revoke execute on function public.overlay_save(text) from public, anon;
revoke execute on function public.overlay_allow_admins(boolean) from public, anon;
revoke execute on function public.overlay_access() from public, anon;
grant execute on function public.overlay_save(text) to authenticated;
grant execute on function public.overlay_allow_admins(boolean) to authenticated;
grant execute on function public.overlay_access() to authenticated;

-- ============================================================
-- 2) Daves Dino
-- ============================================================
alter table public.pet add column if not exists feed_command text not null default '!füttern';
alter table public.pet drop constraint if exists pet_feed_command_check;
alter table public.pet add constraint pet_feed_command_check check (feed_command ~ '^![^\s!]{1,29}$');

-- Pause pro Twitch-Zuschauer beim Füttern im Chat (nur für twitch-eventsub)
create table if not exists public.pet_chat_cooldowns (
  twitch_user_id text primary key,
  last_at timestamptz not null
);
alter table public.pet_chat_cooldowns enable row level security;

-- Von der Webseite aus wirkt Füttern/Streicheln im Stream nur für Admins.
-- Zuschauer füttern im Stream über den Chat-Befehl, auf der Seite nur für sich.
create or replace function public.pet_action(p_kind text)
returns public.pet_events language plpgsql security definer set search_path = '' as $$
declare
  result public.pet_events;
begin
  if auth.uid() is null then
    raise exception 'Bitte zuerst anmelden.';
  end if;
  if p_kind not in ('feed', 'pet') then
    raise exception 'Unbekannte Aktion.';
  end if;
  if not public.is_admin() then
    raise exception 'Im Stream füttern Zuschauer den Dino über den Twitch-Chat.' using hint = 'chat';
  end if;
  if p_kind = 'feed' then
    update public.pet set last_fed_at = now(), last_fed_by = public.my_name(), fed_count = fed_count + 1 where id = 1;
  end if;
  insert into public.pet_events (kind, who) values (p_kind, public.my_name()) returning * into result;
  delete from public.pet_events where created_at < now() - interval '2 days';
  return result;
end;
$$;
revoke execute on function public.pet_action(text) from public, anon;
grant execute on function public.pet_action(text) to authenticated;

-- Viele neue Sprüche – nur, solange noch die alten Standard-Sprüche drinstehen
update public.pet set phrases = array[
  'Du Flitzpiepe!',
  'Der Rentner ist älter als mein Dino!',
  'Wer hat hier die Weiche falsch gestellt?',
  'Rawr! Das heißt „Hallo“.',
  'Ich bin 65 Millionen Jahre alt und DU spielst so?',
  'Nächster Halt: Niederlage.',
  'Bitte zurückbleiben, der Dino fährt ein!',
  'Chat, habt ihr Snacks dabei?',
  'Ich bin nicht dick, ich bin prähistorisch.',
  'Dave, du alte Pflaume!',
  'Zug hat Verspätung. Wie immer.',
  'Kurze Arme, große Klappe.',
  'Ich hab mehr Zähne als Dave Kills.',
  'Mein Opa war ein T-Rex. Und deiner?',
  'Ich bin kein Dino, ich bin ein Lebensgefühl.',
  'Dave, das war ein Kunstschuss. Also Kunst. Kein Schuss.',
  'Pssst … ich glaube, Dave hat Lag im Kopf.',
  'Einmal Victory Royale zum Mitnehmen, bitte.',
  'Meine Lieblingswaffe? Meine Zähne.',
  'Achtung an Gleis 3: Der Dino-Express fährt ein!',
  'Ich esse keine Zuschauer. Nur ein bisschen.',
  'Da war ein Busch. Der Busch war Dave.',
  'Ich hab Angst vor Meteoriten. Frag nicht, warum.',
  'Emote-Spam macht auch nicht satt.',
  'Der Zug ist abgefahren. Ich sitz drin.',
  'Ich wurde ausgebrütet, um zu nerven.',
  'Wort des Tages: Flitzpiepe.',
  'Wenn Dave gewinnt, ess ich einen Busch.',
  'Ich brauch keinen Baumodus, ich bin schon gebaut.',
  'Nächster Halt: Snackautomat.',
  'Pausenbrot? Wo? WO?!',
  'Ich hab Dave ins Knie gebissen. Aus Liebe.',
  'Rawr heißt übersetzt: Gib Snacks.',
  'Ich war Mitarbeiter des Monats. Im Jura.',
  'Wer hat mein Ei geklaut?!',
  'Ich bin nicht faul, ich spare Energie für die Evolution.',
  'Heute schon gestretcht? Ich komm nicht an meine Zehen.',
  'Dave spielt wie ein Fahrplan: niemand versteht ihn.',
  'Klatscht mal alle! … Ich kann nicht, kurze Arme.',
  'Ich hätte gern einen Fensterplatz im Battle Bus.',
  'Ist das hier der Ruhewagen? Nein? Gut. RAWR!',
  'Mein Horoskop sagt: Heute gibt es Snacks.',
  'Kennt ihr den? Kommt ein Dino in den Stream …',
  'Ich zähl bis drei, dann hab ich Hunger. Eins …'
] where phrases = array[
  'Du Flitzpiepe!',
  'Der Rentner ist älter als mein Dino!',
  'Wer hat hier die Weiche falsch gestellt?',
  'Rawr! Das heißt „Hallo“.',
  'Ich bin 65 Millionen Jahre alt und DU spielst so?',
  'Nächster Halt: Niederlage.',
  'Bitte zurückbleiben, der Dino fährt ein!',
  'Chat, habt ihr Snacks dabei?',
  'Ich bin nicht dick, ich bin prähistorisch.',
  'Dave, du alte Pflaume!',
  'Zug hat Verspätung. Wie immer.',
  'Kurze Arme, große Klappe.'
];

-- ---------- Chat-Bot: Welche Rechte hat er freigegeben? ----------
alter table public.twitch_bot add column if not exists scopes text[] not null default '{}';

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
      (select jsonb_build_object('bot_connected', true, 'bot_login', login, 'bot_name', display_name,
                                 'bot_chat', 'user:read:chat' = any(scopes))
       from public.twitch_bot where id = 1),
      jsonb_build_object('bot_connected', false)
    )
  )::json;
$$;
revoke execute on function public.twitch_status() from public, anon;
grant execute on function public.twitch_status() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'overlay_config'
  ) then
    alter publication supabase_realtime add table public.overlay_config;
  end if;
end;
$$;
