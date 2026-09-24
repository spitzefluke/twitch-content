-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Start für Zuschauer: „Ärgere den Dave“ und das Fortnite-Bingo zeigen
-- Nicht-Admins bis zum Startdatum (tiles.target_at) einen Countdown.
-- Admins können vorher schon alles benutzen und ändern das Datum im
-- jeweiligen Dialog („Für Zuschauer freigeschaltet ab“).
-- Außerdem fliegen „Fortnite Community-Cup“ und „Geisterzug-Special“ raus.
-- Mehrfach ausführbar (das Startdatum wird nur gesetzt, solange keins eingetragen ist).
-- ============================================================

update public.tiles set target_at = '2026-10-01 20:00:00+02'
  where kind in ('prank', 'bingo') and target_at is null;

delete from public.tiles
  where kind = 'countdown' and lower(trim(title)) in ('fortnite community-cup', 'geisterzug-special');

-- send_prank wie in …_pranks.sql, dazu die Sperre bis zum Start
create or replace function public.send_prank(p_kind text, p_item text, p_sound uuid default null)
returns public.pranks language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  admin boolean := public.is_admin();
  cfg public.prank_settings;
  who text;
  last timestamptz;
  wait_s int;
  starts timestamptz;
  snd public.sounds;
  result public.pranks;
begin
  if uid is null then
    raise exception 'Bitte zuerst anmelden.';
  end if;
  select * into cfg from public.prank_settings where id = 1;
  if not coalesce(cfg.enabled, true) and not admin then
    raise exception 'Dave hat „Ärgere den Dave“ gerade pausiert.' using hint = 'paused';
  end if;
  -- Vor dem Start (Startdatum der Kachel) dürfen nur Admins.
  select target_at into starts from public.tiles where kind = 'prank' order by position limit 1;
  if not admin and starts > now() then
    raise exception '„Ärgere den Dave“ startet erst am % Uhr.',
      to_char(starts at time zone 'Europe/Berlin', 'DD.MM.YYYY "um" HH24:MI') using hint = 'locked';
  end if;

  if not admin and coalesce(cfg.cooldown_seconds, 0) > 0 then
    select last_at into last from public.prank_cooldowns where user_id = uid for update;
    if last is not null and last > now() - make_interval(secs => cfg.cooldown_seconds) then
      wait_s := ceil(extract(epoch from (last + make_interval(secs => cfg.cooldown_seconds) - now())))::int;
      raise exception 'Kurz durchatmen: noch % Sekunden bis zur nächsten Aktion.', wait_s using hint = 'cooldown:' || wait_s;
    end if;
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

  insert into public.prank_cooldowns (user_id, last_at) values (uid, now())
    on conflict (user_id) do update set last_at = excluded.last_at;
  -- Das Overlay braucht nur die letzten Minuten, die Seite die letzten Einträge.
  delete from public.pranks where created_at < now() - interval '2 days';
  return result;
end;
$$;

revoke execute on function public.send_prank(text, text, uuid) from public, anon;
grant execute on function public.send_prank(text, text, uuid) to authenticated;
