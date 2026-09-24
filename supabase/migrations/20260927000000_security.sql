-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Absicherung nach der Prüfung auf Missbrauch:
--   · Glücksrad im OBS-Overlay: Drehungen von der Webseite nur noch von
--     Admins. Sonst konnte jeder Zuschauer kostenlos (statt mit Kanalpunkten)
--     alle paar Sekunden ein Ergebnis in Daves Stream bringen.
--   · Vorschläge: Der Name kommt aus dem Profil (vorher frei wählbar, z. B.
--     „Dave“), höchstens 5 neue Vorschläge pro Person und Tag.
--   · Eigene Bingo-Karte: höchstens 25 Felder.
-- Mehrfach ausführbar.
-- ============================================================

-- ---------- Glücksrad-Feed fürs Overlay ----------
create or replace function public.mirror_spin_to_overlay()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Von der Webseite zählt nur, was ein Admin dreht (z. B. Dave zum Testen).
  if new.source = 'web'
     and not coalesce((select is_admin from public.profiles where id = new.user_id), false) then
    return new;
  end if;
  insert into public.overlay_spins (id, created_at, source, variant_id, variant_name, segment_index, result, detail, requested_by)
  values (new.id, new.created_at, new.source, new.variant_id, new.variant_name, new.segment_index, new.result, new.detail, new.requested_by)
  on conflict (id) do nothing;
  delete from public.overlay_spins where created_at < now() - interval '2 days';
  return new;
exception when others then
  -- Das Overlay ist Zugabe: Ein Fehler hier darf die eigentliche Drehung nie blockieren.
  raise warning 'overlay_spins: Spiegeln fehlgeschlagen: %', sqlerrm;
  return new;
end;
$$;

-- ---------- Vorschläge ----------
create or replace function public.before_idea_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select is_admin from public.profiles where id = new.user_id), false)
     and (select count(*) from public.ideas
          where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Du hast heute schon 5 Vorschläge gemacht. Morgen geht es weiter.';
  end if;
  new.author := coalesce((select username from public.profiles where id = new.user_id), '');
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists on_idea_insert on public.ideas;
create trigger on_idea_insert
  before insert on public.ideas
  for each row execute function public.before_idea_insert();

-- ---------- Eigene Bingo-Karte ----------
alter table public.bingo_player_cards drop constraint if exists bingo_player_cards_size_check2;
alter table public.bingo_player_cards add constraint bingo_player_cards_size_check2
  check (jsonb_array_length(cells) <= 25 and cardinality(marked) <= 25);
