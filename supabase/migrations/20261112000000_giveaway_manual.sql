-- ============================================================
-- StreamHelp: Verlosung – Teilnehmer von Hand hinzufügen
--   · Streamer, Admins und freigegebene Mods tragen im Dialog der Verlosung selbst einen
--     Namen in den Lostopf ein (giveaway_add) – z. B. für Zuschauer ohne Twitch-Chat,
--     aus dem Discord oder nach einem Chat-Ausfall.
--   · Jeder Name nur einmal pro Verlosung (ohne Groß-/Kleinschreibung), auch gegenüber
--     Teilnehmern, die schon per Chat-Befehl dabei sind. Wer rausgeworfen wurde, kommt
--     nicht über diesen Weg zurück – dafür gibt es „Zurückholen“.
--   · Geht bei offener, geschlossener und schon gezogener Verlosung (dann gibt es beim
--     „Neu ziehen“ ein Los mehr), nur nicht, wenn keine Verlosung läuft.
--   · Der Bereich „Verlosung“ der Mod-Rechte gilt automatisch (Name beginnt mit giveaway).
-- Braucht 20261023000000_giveaway.sql, 20261025000000_giveaway_kick.sql und
-- 20261028000000_platform.sql. Mehrfach ausführbar.
-- ============================================================

create or replace function public.giveaway_add(p_name text)
returns public.giveaway language plpgsql security definer set search_path = '' as $$
declare
  g public.giveaway;
  -- führendes @ weg, Leerzeichen zusammenfassen, höchstens 40 Zeichen (wie bei Chat-Teilnehmern)
  v_name text := left(btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '^\s*@+', ''), '\s+', ' ', 'g')), 40);
  v_key text;
  n int;
begin
  if not public.is_admin() then raise exception 'Teilnehmer hinzufügen dürfen nur der Streamer und die Mods.'; end if;
  if char_length(v_name) < 1 then raise exception 'Bitte einen Namen eintragen.'; end if;
  v_key := 'manual:' || lower(v_name);

  select * into g from public.giveaway where id = 1 for update;
  if g.status = 'idle' or g.round = 0 then raise exception 'Erst eine Verlosung starten.'; end if;

  -- Gibt es den Namen in dieser Runde schon (per Chat oder von Hand)?
  if exists (select 1 from public.giveaway_entries where round = g.round and lower(name) = lower(v_name) and kicked) then
    raise exception '% wurde aus dieser Verlosung rausgeworfen – bitte unter „Rausgeworfen“ zurückholen.', v_name;
  end if;
  if exists (select 1 from public.giveaway_entries where round = g.round and lower(name) = lower(v_name)) then
    raise exception '% ist schon im Lostopf.', v_name;
  end if;

  insert into public.giveaway_entries (round, player_key, name)
    values (g.round, v_key, v_name)
    on conflict (channel_id, round, player_key) do nothing;
  get diagnostics n = row_count;
  if n = 0 then raise exception '% ist schon im Lostopf.', v_name; end if;

  update public.giveaway set entries = entries + 1, updated_at = now() where id = 1 returning * into g;
  return g;
end;
$$;
revoke execute on function public.giveaway_add(text) from public, anon;
grant execute on function public.giveaway_add(text) to authenticated;
