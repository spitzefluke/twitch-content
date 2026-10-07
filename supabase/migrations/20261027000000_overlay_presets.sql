-- ============================================================
-- StreamHelp: Overlay-Vorlagen
--   Im OBS-Fenster (Reiter „Design“) lassen sich die kompletten Overlay-Einstellungen
--   unter einem Namen speichern und mit einem Klick wieder laden – z. B. eine Vorlage
--   pro Game oder für besondere Streams. Speichern, umbenennen und löschen darf, wer das
--   Overlay anpassen darf (overlay_can_edit: Streamer bzw. freigegebene Admins/Mods).
-- Braucht 20260930000000_live_overlay.sql. Mehrfach ausführbar.
-- ============================================================

create table if not exists public.overlay_presets (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  params text not null default '' check (char_length(params) <= 8000),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists overlay_presets_name_idx on public.overlay_presets (lower(name));
alter table public.overlay_presets enable row level security;
drop policy if exists "overlay_presets: lesen für angemeldete" on public.overlay_presets;
create policy "overlay_presets: lesen für angemeldete" on public.overlay_presets for select to authenticated using (true);
revoke all on public.overlay_presets from anon, authenticated;
grant select on public.overlay_presets to authenticated;
-- Schreiben nur über die Funktionen unten

-- Speichern: gleicher Name (ohne Groß/Klein) überschreibt die Vorlage
create or replace function public.overlay_preset_save(p_name text, p_params text)
returns public.overlay_presets language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  r public.overlay_presets;
begin
  if not public.overlay_can_edit() then raise exception 'Vorlagen speichern darf nur, wer das Overlay anpassen darf.'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then raise exception 'Bitte einen Namen mit 1–40 Zeichen.'; end if;
  if char_length(coalesce(p_params, '')) > 8000 then raise exception 'Die Einstellungen sind zu lang.'; end if;
  if (select count(*) from public.overlay_presets) >= 50 and not exists (select 1 from public.overlay_presets where lower(name) = lower(v_name)) then
    raise exception 'Höchstens 50 Vorlagen – lösch erst eine alte.';
  end if;
  insert into public.overlay_presets (name, params, created_by)
    values (v_name, coalesce(p_params, ''), coalesce((select username from public.profiles where id = auth.uid()), ''))
    on conflict ((lower(name))) do update set params = excluded.params, updated_at = now()
    returning * into r;
  return r;
end;
$$;
revoke execute on function public.overlay_preset_save(text, text) from public, anon;
grant execute on function public.overlay_preset_save(text, text) to authenticated;

create or replace function public.overlay_preset_delete(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.overlay_can_edit() then raise exception 'Vorlagen löschen darf nur, wer das Overlay anpassen darf.'; end if;
  delete from public.overlay_presets where id = p_id;
end;
$$;
revoke execute on function public.overlay_preset_delete(bigint) from public, anon;
grant execute on function public.overlay_preset_delete(bigint) to authenticated;
