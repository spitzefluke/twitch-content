-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Sicherheit (Supabase-Linter „Security Definer View“): shop_lobbies_public lief mit
-- den Rechten des Erstellers – so konnte jeder alle Koop-Runden samt Code auflisten.
--   · Die Sicht rechnet jetzt mit den Rechten der aufrufenden Person (security_invoker);
--     direkt lesen darf sie niemand mehr.
--   · Gelesen wird über zwei Funktionen:
--       shop_lobby_by_code(code) – wer den Code kennt (zum Beitreten)
--       shop_lobby_by_id(id)     – nur Ersteller, Mitspieler der Runde und Admins
-- Mehrfach ausführbar.
-- ============================================================

alter view public.shop_lobbies_public set (security_invoker = on);
revoke all on public.shop_lobbies_public from public, anon, authenticated;

create or replace function public.shop_lobby_by_code(p_code text)
returns setof public.shop_lobbies_public language sql stable security definer set search_path = '' as $$
  select v.* from public.shop_lobbies_public v
  where auth.uid() is not null and v.code = upper(btrim(p_code));
$$;

create or replace function public.shop_lobby_by_id(p_id uuid)
returns setof public.shop_lobbies_public language sql stable security definer set search_path = '' as $$
  select v.* from public.shop_lobbies_public v
  where v.id = p_id
    and auth.uid() is not null
    and (v.host_id = auth.uid()
         or public.is_admin()
         or exists (select 1 from public.shop_runs r where r.lobby_id = v.id and r.user_id = auth.uid()));
$$;

revoke execute on function public.shop_lobby_by_code(text) from public, anon;
revoke execute on function public.shop_lobby_by_id(uuid) from public, anon;
grant execute on function public.shop_lobby_by_code(text) to authenticated;
grant execute on function public.shop_lobby_by_id(uuid) to authenticated;
