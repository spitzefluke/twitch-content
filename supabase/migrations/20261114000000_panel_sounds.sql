-- ============================================================
-- StreamHelp: Sounds über die Twitch-Erweiterung (Panel, Komponente, Overlay)
--   · Zuschauer tippen im Panel auf einen Sound, das OBS-Overlay spielt ihn ab – ohne Kanalpunkte,
--     also auch für Kanäle ohne Affiliate. Standard: aus. Der Streamer schaltet es im Dialog
--     „Ärgere den Streamer“ ein (prank_settings.panel_sounds).
--   · Bremse auf dem Server: je Zuschauer eine Abklingzeit (panel_sound_cooldown, Standard 2 Minuten)
--     und für den ganzen Kanal ein Mindestabstand zwischen zwei Panel-Sounds (panel_sound_gap,
--     Standard 15 Sekunden). Dazu gelten Raid-Schutz und der Starttermin der Kachel „prank“.
--   · Nur die Edge Function twitch-ext ruft panel_sound_play auf (Service-Rolle); sie prüft vorher
--     den Ausweis von Twitch und nimmt nur Sounds aus der eigenen Liste (eingebaut oder hochgeladen).
-- Braucht 20260924000000_pranks.sql, 20261015000000_security_hardening.sql und
-- 20261028000000_platform.sql. Mehrfach ausführbar.
-- ============================================================

-- ---------- Einstellungen ----------
alter table core.prank_settings add column if not exists panel_sounds boolean not null default false;
alter table core.prank_settings add column if not exists panel_sound_cooldown int not null default 120;
alter table core.prank_settings add column if not exists panel_sound_gap int not null default 15;
alter table core.prank_settings drop constraint if exists prank_settings_panel_sound_cooldown_check;
alter table core.prank_settings add constraint prank_settings_panel_sound_cooldown_check check (panel_sound_cooldown between 10 and 3600);
alter table core.prank_settings drop constraint if exists prank_settings_panel_sound_gap_check;
alter table core.prank_settings add constraint prank_settings_panel_sound_gap_check check (panel_sound_gap between 0 and 600);
select public.channel_view('prank_settings');

-- ---------- Wann hat welcher Zuschauer zuletzt einen Sound geschickt? (nur für die Bremse, nicht lesbar) ----------
create table if not exists core.panel_sound_uses (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  player_key text not null check (player_key ~ '^tw:\d{1,20}$'),
  last_at timestamptz not null default now(),
  primary key (channel_id, player_key)
);
alter table core.panel_sound_uses enable row level security;
revoke all on core.panel_sound_uses from anon, authenticated;
select public.channel_view('panel_sound_uses');
revoke all on public.panel_sound_uses from anon, authenticated;

-- ---------- Abspielen ----------
-- p_item: eingebauter Sound (z. B. „gong“) oder „custom“ mit p_path/p_label eines hochgeladenen Sounds.
-- Antwort: {ok:true} | {ok:false, reason:'off'|'closed'|'cooldown', wait:<Sekunden>}
create or replace function public.panel_sound_play(p_key text, p_name text, p_item text, p_path text default null, p_label text default '')
returns json language plpgsql security definer set search_path = '' as $$
declare
  s public.prank_settings;
  v_last timestamptz;
  v_wait int;
begin
  if coalesce(p_key, '') !~ '^tw:\d{1,20}$' then return json_build_object('ok', false, 'reason', 'share'); end if;
  if coalesce(p_item, '') !~ '^[a-z0-9_-]{1,24}$' then return json_build_object('ok', false, 'reason', 'sound'); end if;
  select * into s from public.prank_settings where id = 1 for update;
  if s.id is null or not s.panel_sounds then return json_build_object('ok', false, 'reason', 'off'); end if;
  if public.viewer_paused() or not public.tile_started('prank') then return json_build_object('ok', false, 'reason', 'closed'); end if;

  -- Ganzer Kanal: Mindestabstand zum letzten Panel-Sound
  select max(last_at) into v_last from public.panel_sound_uses;
  if v_last is not null and v_last > now() - make_interval(secs => s.panel_sound_gap) then
    v_wait := ceil(extract(epoch from v_last + make_interval(secs => s.panel_sound_gap) - now()))::int;
    return json_build_object('ok', false, 'reason', 'cooldown', 'wait', greatest(v_wait, 1));
  end if;
  -- Dieser Zuschauer: eigene Abklingzeit
  select last_at into v_last from public.panel_sound_uses where player_key = p_key;
  if v_last is not null and v_last > now() - make_interval(secs => s.panel_sound_cooldown) then
    v_wait := ceil(extract(epoch from v_last + make_interval(secs => s.panel_sound_cooldown) - now()))::int;
    return json_build_object('ok', false, 'reason', 'cooldown', 'wait', greatest(v_wait, 1));
  end if;

  insert into public.panel_sound_uses (player_key, last_at) values (p_key, now())
    on conflict (channel_id, player_key) do update set last_at = excluded.last_at;
  insert into public.pranks (kind, item, sound_path, label, requested_by)
    values ('sound', p_item, case when p_item = 'custom' then p_path end,
            case when p_item = 'custom' then left(coalesce(p_label, ''), 60) else '' end,
            left(coalesce(nullif(btrim(p_name), ''), 'Zuschauer'), 40));
  -- Aufräumen wie beim Kanalpunkte-Weg
  delete from public.pranks where created_at < now() - interval '2 days';
  delete from public.panel_sound_uses where last_at < now() - interval '1 day';
  return json_build_object('ok', true);
end;
$$;
revoke execute on function public.panel_sound_play(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.panel_sound_play(text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
