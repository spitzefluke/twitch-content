-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Glücksrad mit zweitem Rad: Nach dem Ergebnis dreht sofort ein zweites Rad,
-- z. B. „Waffen-Lotto“: erst die Waffe, dann die Seltenheit.
--   · wheel_variants.bonus: {name, segments: [{label, detail, color?}]} oder null
--   · spins / overlay_spins: bonus_name, bonus_index, bonus_result, bonus_detail
--   · neue Variante „Waffen-Lotto“ (falls noch nicht da)
--   · wheel_variants_save speichert das zweite Rad mit
-- Braucht 20261006000000_wheel_edit.sql. Mehrfach ausführbar.
-- ============================================================

alter table public.wheel_variants add column if not exists bonus jsonb;
alter table public.wheel_variants drop constraint if exists wheel_variants_bonus_check;
alter table public.wheel_variants add constraint wheel_variants_bonus_check
  check (bonus is null or (jsonb_typeof(bonus) = 'object' and jsonb_typeof(bonus -> 'segments') = 'array'
    and jsonb_array_length(bonus -> 'segments') >= 2));

alter table public.spins add column if not exists bonus_name text;
alter table public.spins add column if not exists bonus_index int;
alter table public.spins add column if not exists bonus_result text;
alter table public.spins add column if not exists bonus_detail text;
alter table public.overlay_spins add column if not exists bonus_name text;
alter table public.overlay_spins add column if not exists bonus_index int;
alter table public.overlay_spins add column if not exists bonus_result text;
alter table public.overlay_spins add column if not exists bonus_detail text;

-- ---------- Glücksrad-Feed fürs Overlay (wie in …_security.sql, jetzt mit zweitem Rad) ----------
create or replace function public.mirror_spin_to_overlay()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Von der Webseite zählt nur, was ein Admin dreht (z. B. Dave zum Testen).
  if new.source = 'web'
     and not coalesce((select is_admin from public.profiles where id = new.user_id), false) then
    return new;
  end if;
  insert into public.overlay_spins (id, created_at, source, variant_id, variant_name, segment_index, result, detail, requested_by,
                                    bonus_name, bonus_index, bonus_result, bonus_detail)
  values (new.id, new.created_at, new.source, new.variant_id, new.variant_name, new.segment_index, new.result, new.detail, new.requested_by,
          new.bonus_name, new.bonus_index, new.bonus_result, new.bonus_detail)
  on conflict (id) do nothing;
  delete from public.overlay_spins where created_at < now() - interval '2 days';
  return new;
exception when others then
  -- Das Overlay ist Zugabe: Ein Fehler hier darf die eigentliche Drehung nie blockieren.
  raise warning 'overlay_spins: Spiegeln fehlgeschlagen: %', sqlerrm;
  return new;
end;
$$;

-- ---------- Neue Variante: Waffen-Lotto (Waffe, danach Seltenheit) ----------
insert into public.wheel_variants (id, position, name, description, color, segments, bonus)
select 'waffen-lotto', coalesce((select max(position) from public.wheel_variants), 0) + 1,
  'Waffen-Lotto', 'Lost Daves einzige Waffe aus – danach dreht das Rad die Seltenheit.', '#ff5a4e',
  '[
    {"label":"Sturmgewehr","detail":"Ein Sturmgewehr ist Daves einzige Waffe."},
    {"label":"Schrotflinte","detail":"Eine Schrotflinte ist Daves einzige Waffe."},
    {"label":"Maschinenpistole","detail":"Eine Maschinenpistole ist Daves einzige Waffe."},
    {"label":"Pistole","detail":"Eine Pistole ist Daves einzige Waffe."},
    {"label":"Scharfschützengewehr","detail":"Ein Scharfschützengewehr ist Daves einzige Waffe."},
    {"label":"Explosivwaffe","detail":"Raketenwerfer, Granatwerfer & Co. – nur Explosives."},
    {"label":"Bogen / Armbrust","detail":"Ein Bogen oder eine Armbrust ist Daves einzige Waffe."},
    {"label":"Maschinengewehr","detail":"Ein Maschinengewehr ist Daves einzige Waffe."}
  ]'::jsonb,
  '{"name":"Seltenheit","segments":[
    {"label":"Gewöhnlich","detail":"Nur die graue Version – kein Upgrade.","color":"#9aa3ad"},
    {"label":"Ungewöhnlich","detail":"Nur die grüne Version.","color":"#3ddc84"},
    {"label":"Selten","detail":"Nur die blaue Version.","color":"#35a7ff"},
    {"label":"Episch","detail":"Nur die lila Version.","color":"#b45cff"},
    {"label":"Legendär","detail":"Nur die goldene Version – such gut!","color":"#ffa928"},
    {"label":"Mythisch","detail":"Mythisch oder Boss-Version – bis dahin jede Seltenheit.","color":"#ffd84a"}
  ]}'::jsonb
where not exists (select 1 from public.wheel_variants where id = 'waffen-lotto');

-- Kachel-Text anpassen, solange er noch der ursprüngliche ist
update public.tiles
set description = 'Vier Varianten, die Daves nächste Runde auf den Kopf stellen – beim Waffen-Lotto dreht danach noch die Seltenheit. Auch per Kanalpunkte direkt aus dem Chat drehbar.'
where id = 'wheel'
  and description = 'Drei Varianten, die Daves nächste Runde auf den Kopf stellen. Auch per Kanalpunkte direkt aus dem Chat drehbar.';

-- ---------- Speichern mit zweitem Rad (ersetzt die Fassung aus …_wheel_edit.sql) ----------
create or replace function public.wheel_variants_save(p_variants jsonb)
returns setof public.wheel_variants language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
  s jsonb;
  pos int := 0;
  vid text;
  ids text[] := '{}';
  segs jsonb;
  b jsonb;
  bsegs jsonb;
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
    -- Zweites Rad (optional), z. B. die Seltenheit nach der Waffe
    b := v -> 'bonus';
    if b is not null and jsonb_typeof(b) <> 'null' then
      if jsonb_typeof(b) <> 'object' or char_length(btrim(coalesce(b ->> 'name', ''))) not between 1 and 40 then
        raise exception 'Das zweite Rad braucht einen Namen (höchstens 40 Zeichen).';
      end if;
      bsegs := b -> 'segments';
      if jsonb_typeof(bsegs) is distinct from 'array' or jsonb_array_length(bsegs) not between 2 and 16 then
        raise exception 'Das zweite Rad braucht 2 bis 16 Ergebnisse.';
      end if;
      for s in select * from jsonb_array_elements(bsegs) loop
        if jsonb_typeof(s) is distinct from 'object'
          or char_length(btrim(coalesce(s ->> 'label', ''))) not between 1 and 32 then
          raise exception 'Jedes Ergebnis im zweiten Rad braucht einen Titel (höchstens 32 Zeichen).';
        end if;
        if char_length(coalesce(s ->> 'detail', '')) > 200 then
          raise exception 'Eine Erklärung ist zu lang (höchstens 200 Zeichen).';
        end if;
        if coalesce(s ->> 'color', '') <> '' and s ->> 'color' !~ '^#[0-9a-fA-F]{6}$' then
          raise exception 'Ungültige Farbe im zweiten Rad.';
        end if;
      end loop;
    end if;
  end loop;

  -- Varianten, die nicht mehr in der Liste stehen, fallen weg
  delete from public.wheel_variants where id <> all(ids);

  for v in select * from jsonb_array_elements(p_variants) loop
    pos := pos + 1;
    vid := coalesce(nullif(btrim(coalesce(v ->> 'id', '')), ''), 'v-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10));
    select jsonb_agg(jsonb_build_object('label', btrim(e ->> 'label'), 'detail', btrim(coalesce(e ->> 'detail', ''))) order by n)
      into segs
      from jsonb_array_elements(v -> 'segments') with ordinality as t(e, n);
    b := null;
    if jsonb_typeof(v -> 'bonus') = 'object' then
      select jsonb_build_object('name', btrim(v -> 'bonus' ->> 'name'), 'segments', jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object('label', btrim(e ->> 'label'), 'detail', btrim(coalesce(e ->> 'detail', '')),
            'color', lower(nullif(e ->> 'color', ''))))
          order by n))
        into b
        from jsonb_array_elements(v -> 'bonus' -> 'segments') with ordinality as t(e, n);
    end if;
    insert into public.wheel_variants (id, position, name, description, color, segments, bonus)
    values (vid, pos, btrim(v ->> 'name'), btrim(coalesce(v ->> 'description', '')), lower(v ->> 'color'), segs, b)
    on conflict (id) do update set
      position = excluded.position, name = excluded.name, description = excluded.description,
      color = excluded.color, segments = excluded.segments, bonus = excluded.bonus;
  end loop;

  return query select * from public.wheel_variants order by position;
end;
$$;

revoke execute on function public.wheel_variants_save(jsonb) from public, anon;
grant execute on function public.wheel_variants_save(jsonb) to authenticated;
