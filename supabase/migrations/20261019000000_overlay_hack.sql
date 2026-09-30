-- ============================================================
-- „Overlay-Hack“ bei „Ärgere den Streamer“ (nur Mods)
--   Ein Hacker „0xNULL“ übernimmt für knapp eine Minute das ganze Overlay – Glitches,
--   Terminals, Pop-ups, „Overlay geklaut“. Wer im Chat !firewall tippt, beendet es; sonst
--   springt am Ende die Notfall-Firewall an. Auslösen dürfen nur der Streamer, Admins und
--   freigegebene Mods (is_admin) – nicht per Kanalpunkte.
--   pranks.kind bekommt 'hack' (item 'start' = starten, 'firewall' = sofort beenden).
-- Mehrfach ausführbar.
-- ============================================================

alter table public.pranks drop constraint if exists pranks_kind_check;
alter table public.pranks add constraint pranks_kind_check check (kind in ('throw', 'sound', 'hack'));

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
  -- Zuschauer ärgern den Streamer über Kanalpunkte auf Twitch (Edge Function twitch-eventsub).
  -- Direkt von der Webseite dürfen nur Admins und freigegebene Mods auslösen.
  if not public.is_admin() then
    raise exception '„Ärgere den Streamer“ geht über Kanalpunkte im Twitch-Chat.' using hint = 'points';
  end if;

  who := coalesce((select username from public.profiles where id = uid), 'jemand');

  if p_kind = 'hack' and p_item in ('start', 'firewall') then
    -- Ein Hack dauert gut eine Minute – nicht mehrere übereinander
    if p_item = 'start' and exists (
      select 1 from public.pranks where kind = 'hack' and item = 'start' and created_at > now() - interval '75 seconds'
    ) then
      raise exception 'Der Overlay-Hack läuft noch. Warte, bis die Firewall ihn beendet hat.';
    end if;
    insert into public.pranks (kind, item, requested_by)
      values ('hack', p_item, who)
      returning * into result;
  elsif p_kind = 'sound' and p_sound is not null then
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
