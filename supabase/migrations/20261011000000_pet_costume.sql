-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Rexi v3 (Claude Design „OBS Overlay v2“): Kostüme und Heißhunger auf Knopfdruck.
--   · pet.costume: schaffner | lok | bau – Zuschauer wechseln es mit „!change“ im Chat
--     (twitch-eventsub, _shared/chat.ts), Admins auf der Webseite
--   · pet.costume_command: dürfen Zuschauer wechseln? pet.costume_cooldown: Pause in Sekunden
--   · pet.frenzy_at: Heißhunger von Hand ausgelöst (pet_frenzy) – Füttern beendet ihn
--   · pet_events.kind 'costume' (who = Zuschauer, text = Kostüm) für die Chat-Zeile im Overlay
-- Mehrfach ausführbar.
-- ============================================================

alter table public.pet add column if not exists costume text not null default 'schaffner';
alter table public.pet drop constraint if exists pet_costume_check;
alter table public.pet add constraint pet_costume_check check (costume in ('schaffner', 'lok', 'bau'));
alter table public.pet add column if not exists costume_command boolean not null default true;
alter table public.pet add column if not exists costume_cooldown int not null default 60;
alter table public.pet drop constraint if exists pet_costume_cooldown_check;
alter table public.pet add constraint pet_costume_cooldown_check check (costume_cooldown between 0 and 300);
alter table public.pet add column if not exists costume_changed_at timestamptz;
alter table public.pet add column if not exists frenzy_at timestamptz;

alter table public.pet_events drop constraint if exists pet_events_kind_check;
alter table public.pet_events add constraint pet_events_kind_check check (kind in ('feed', 'pet', 'say', 'costume'));

-- Füttern (Chat, Webseite) beendet einen von Hand ausgelösten Heißhunger
create or replace function public.pet_fed_ends_frenzy()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.last_fed_at is distinct from old.last_fed_at then
    new.frenzy_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists on_pet_fed_ends_frenzy on public.pet;
create trigger on_pet_fed_ends_frenzy
  before update on public.pet
  for each row execute function public.pet_fed_ends_frenzy();

-- Admins: Heißhunger sofort auslösen (p_on = true) oder beenden
create or replace function public.pet_frenzy(p_on boolean)
returns public.pet language plpgsql security definer set search_path = '' as $$
declare
  result public.pet;
begin
  if not public.is_admin() then
    raise exception 'Heißhunger auslösen dürfen nur Admins.';
  end if;
  update public.pet set frenzy_at = case when p_on then now() end, updated_at = now()
    where id = 1 returning * into result;
  return result;
end;
$$;
revoke execute on function public.pet_frenzy(boolean) from public, anon;
grant execute on function public.pet_frenzy(boolean) to authenticated;

-- Admins wechseln das Kostüm auf der Webseite (mit Eintrag für die Chat-Zeile im Overlay)
create or replace function public.pet_costume(p_costume text)
returns public.pet language plpgsql security definer set search_path = '' as $$
declare
  result public.pet;
begin
  if not public.is_admin() then
    raise exception 'Das Kostüm wechseln hier nur Admins – Zuschauer mit !change im Chat.';
  end if;
  if p_costume not in ('schaffner', 'lok', 'bau') then
    raise exception 'Dieses Kostüm gibt es nicht.';
  end if;
  update public.pet set costume = p_costume, costume_changed_at = now(), updated_at = now()
    where id = 1 returning * into result;
  insert into public.pet_events (kind, who, text) values ('costume', public.my_name(), p_costume);
  return result;
end;
$$;
revoke execute on function public.pet_costume(text) from public, anon;
grant execute on function public.pet_costume(text) to authenticated;
