-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Glücksrad bearbeiten: Admins ändern Varianten und Ergebnisse direkt auf der Seite.
--   · wheel_variants_save(variants): speichert alle Varianten auf einmal
--     (Reihenfolge = Position). Fehlende Varianten werden gelöscht, neue angelegt.
-- Alte Drehungen bleiben unverändert (sie speichern Name und Ergebnis als Text).
-- Mehrfach ausführbar.
-- ============================================================

create or replace function public.wheel_variants_save(p_variants jsonb)
returns setof public.wheel_variants language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
  s jsonb;
  pos int := 0;
  vid text;
  ids text[] := '{}';
  segs jsonb;
begin
  if not public.is_admin() then
    raise exception 'Das Glücksrad dürfen nur Admins bearbeiten.';
  end if;
  if jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants) < 1 then
    raise exception 'Mindestens eine Variante wird gebraucht.';
  end if;
  if jsonb_array_length(p_variants) > 8 then
    raise exception 'Höchstens 8 Varianten.';
  end if;

  -- Erst alles prüfen, dann schreiben
  for v in select * from jsonb_array_elements(p_variants) loop
    if jsonb_typeof(v) is distinct from 'object' then
      raise exception 'Ungültige Variante.';
    end if;
    vid := nullif(btrim(coalesce(v ->> 'id', '')), '');
    if vid is not null and vid !~ '^[a-z0-9-]{1,40}$' then
      raise exception 'Ungültige Varianten-ID.';
    end if;
    if vid = any(ids) then
      raise exception 'Eine Variante ist doppelt.';
    end if;
    if vid is not null then ids := ids || vid; end if;
    if char_length(btrim(coalesce(v ->> 'name', ''))) not between 1 and 40 then
      raise exception 'Jede Variante braucht einen Namen (höchstens 40 Zeichen).';
    end if;
    if char_length(coalesce(v ->> 'description', '')) > 160 then
      raise exception 'Die Beschreibung ist zu lang (höchstens 160 Zeichen).';
    end if;
    if coalesce(v ->> 'color', '') !~ '^#[0-9a-fA-F]{6}$' then
      raise exception 'Ungültige Farbe.';
    end if;
    segs := v -> 'segments';
    if jsonb_typeof(segs) is distinct from 'array' or jsonb_array_length(segs) not between 2 and 16 then
      raise exception 'Jede Variante braucht 2 bis 16 Ergebnisse.';
    end if;
    for s in select * from jsonb_array_elements(segs) loop
      if jsonb_typeof(s) is distinct from 'object'
        or char_length(btrim(coalesce(s ->> 'label', ''))) not between 1 and 32 then
        raise exception 'Jedes Ergebnis braucht einen Titel (höchstens 32 Zeichen).';
      end if;
      if char_length(coalesce(s ->> 'detail', '')) > 200 then
        raise exception 'Eine Erklärung ist zu lang (höchstens 200 Zeichen).';
      end if;
    end loop;
  end loop;

  -- Varianten, die nicht mehr in der Liste stehen, fallen weg
  delete from public.wheel_variants where id <> all(ids);

  for v in select * from jsonb_array_elements(p_variants) loop
    pos := pos + 1;
    vid := coalesce(nullif(btrim(coalesce(v ->> 'id', '')), ''), 'v-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10));
    select jsonb_agg(jsonb_build_object('label', btrim(e ->> 'label'), 'detail', btrim(coalesce(e ->> 'detail', ''))) order by n)
      into segs
      from jsonb_array_elements(v -> 'segments') with ordinality as t(e, n);
    insert into public.wheel_variants (id, position, name, description, color, segments)
    values (vid, pos, btrim(v ->> 'name'), btrim(coalesce(v ->> 'description', '')), lower(v ->> 'color'), segs)
    on conflict (id) do update set
      position = excluded.position, name = excluded.name, description = excluded.description,
      color = excluded.color, segments = excluded.segments;
  end loop;

  return query select * from public.wheel_variants order by position;
end;
$$;

revoke execute on function public.wheel_variants_save(jsonb) from public, anon;
grant execute on function public.wheel_variants_save(jsonb) to authenticated;
