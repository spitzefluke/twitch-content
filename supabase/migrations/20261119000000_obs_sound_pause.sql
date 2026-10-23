-- ============================================================
-- StreamHelp: Soundkäufe pausieren, wenn OBS nicht verbunden ist
--   1) OBS meldet sich: Läuft overlay.html als Browserquelle in OBS (window.obsstudio), ruft es alle
--      30 Sekunden obs_ping() auf. obs_status() sagt Streamer und Mods, ob OBS gerade verbunden ist
--      (letzte Meldung höchstens 90 Sekunden alt). Die Vorschau auf der Webseite meldet sich nicht.
--   2) Notschalter „Soundkäufe pausieren“ (prank_settings.sales_paused): Ohne OBS laufen gekaufte Sounds
--      ins Leere. Solange pausiert ist,
--        · zeigt die Twitch-Erweiterung keine Sounds und keine Bits-Käufe (twitch-ext),
--        · gibt es für Sound-Belohnungen (Kanalpunkte) die Punkte zurück (twitch-eventsub) und
--        · schaltet „Auf Twitch übernehmen“ die Sound-Belohnungen auf Twitch aus (_shared/pranks.ts).
--      Schalten dürfen der Streamer und alle freigegebenen Mods – auch ohne den Bereich „Ärgern“, weil es
--      ein Notschalter ist (sound_sales_pause fällt in keinen Mod-Bereich, siehe request_area).
-- Braucht 20261118000000_panel_bits_subs.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.bits_transactions') is null then
    raise exception 'Erst die Migration 20261118000000_panel_bits_subs.sql ausführen.';
  end if;
end;
$$;

-- ---------- 1) OBS meldet sich ----------
create table if not exists core.obs_presence (
  channel_id uuid primary key default public.current_channel() references public.channels on delete cascade,
  seen_at timestamptz not null default now(),
  version text not null default '' check (char_length(version) <= 40)
);
alter table core.obs_presence enable row level security;
revoke all on core.obs_presence from anon, authenticated;
-- keine Policy: schreiben über obs_ping, lesen über obs_status

-- Aus dem Overlay (anon, Kanal über den Header x-channel). Höchstens eine Meldung je 20 Sekunden zählt.
create or replace function public.obs_ping(p_version text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  n int;
begin
  if v_ch is null or not exists (select 1 from public.channels where id = v_ch) then return false; end if;
  insert into core.obs_presence as o (channel_id, seen_at, version)
  values (v_ch, now(), left(regexp_replace(coalesce(p_version, ''), '[^0-9A-Za-z. _-]', '', 'g'), 40))
  on conflict (channel_id) do update set seen_at = now(), version = excluded.version
  where o.seen_at <= now() - interval '20 seconds';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke execute on function public.obs_ping(text) from public;
grant execute on function public.obs_ping(text) to anon, authenticated;

-- Für Streamer und Mods: {online, seen_at, version, sales_paused, paused_by, paused_at}
create or replace function public.obs_status()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  o core.obs_presence;
  s core.prank_settings;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Nur für Streamer und freigegebene Mods.' using errcode = '42501';
  end if;
  select * into o from core.obs_presence where channel_id = v_ch;
  select * into s from core.prank_settings where channel_id = v_ch and id = 1;
  return json_build_object(
    'online', o.seen_at is not null and o.seen_at > now() - interval '90 seconds',
    'seen_at', o.seen_at, 'version', coalesce(o.version, ''),
    'sales_paused', coalesce(s.sales_paused, false), 'paused_by', coalesce(s.sales_paused_by, ''),
    'paused_at', s.sales_paused_at);
end;
$$;
revoke execute on function public.obs_status() from public, anon;
grant execute on function public.obs_status() to authenticated;

-- ---------- 2) Notschalter ----------
alter table core.prank_settings add column if not exists sales_paused boolean not null default false;
alter table core.prank_settings add column if not exists sales_paused_by text not null default '';
alter table core.prank_settings add column if not exists sales_paused_at timestamptz;
select public.channel_view('prank_settings');

create or replace function public.sound_sales_pause(p_on boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_on boolean := coalesce(p_on, false);
  v_was boolean;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Soundkäufe pausieren nur der Streamer und freigegebene Mods.' using errcode = '42501';
  end if;
  select sales_paused into v_was from core.prank_settings where channel_id = v_ch and id = 1 for update;
  if not found then raise exception 'In der Datenbank fehlt „Ärgere den Streamer“ (Migration …_pranks.sql).'; end if;
  update core.prank_settings set
    sales_paused = v_on,
    -- schon pausiert: wer und seit wann bleiben stehen
    sales_paused_by = case when v_on and v_was then sales_paused_by when v_on then left(coalesce(public.my_name(), ''), 40) else '' end,
    sales_paused_at = case when v_on and v_was then sales_paused_at when v_on then now() end
  where channel_id = v_ch and id = 1;
  -- Zuschauer im Chat Bescheid geben – nur, wenn sich wirklich etwas ändert
  if v_was is distinct from v_on then
    perform public.bot_say(case when v_on
      then '⏸️ Sounds sind kurz pausiert – OBS ist gerade nicht verbunden. Kanalpunkte für Sounds gibt es zurück.'
      else '🔊 Sounds sind wieder da!' end);
  end if;
  return public.obs_status();
end;
$$;
revoke execute on function public.sound_sales_pause(boolean) from public, anon;
grant execute on function public.sound_sales_pause(boolean) to authenticated;

notify pgrst, 'reload schema';
