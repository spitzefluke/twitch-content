-- ============================================================
-- StreamHelp: Aufräumen nach dem Supabase-Sicherheitsbericht (Advisors 0028/0029)
--   1) Trigger-Funktionen (before_*_insert, handle_new_user, mirror_spin_to_overlay, subathon_on_alert …)
--      darf niemand direkt über /rest/v1/rpc aufrufen. Postgres prüft EXECUTE nur beim Anlegen des
--      Triggers, nicht beim Auslösen – die Trigger laufen also unverändert weiter.
--   2) storage_files_of(): zählt nur noch die eigenen Dateien (oder als Admin), nicht die beliebiger Konten.
--   3) channel_showcase() braucht keine Gäste.
-- Was der Bericht weiter meldet, ist Absicht (siehe SECURITY.md → „Supabase-Sicherheitsbericht“).
-- Mehrfach ausführbar – nach neuen Migrationen mit Trigger-Funktionen einfach noch einmal ausführen.
-- ============================================================

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;

create or replace function public.storage_files_of(p_bucket text, p_user uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from storage.objects
  where bucket_id = p_bucket and (storage.foldername(name))[1] = p_user::text
    and (p_user = auth.uid() or public.is_admin());
$$;
revoke execute on function public.storage_files_of(text, uuid) from public, anon;
grant execute on function public.storage_files_of(text, uuid) to authenticated;

do $$
begin
  if to_regprocedure('public.channel_showcase()') is not null then
    revoke execute on function public.channel_showcase() from public, anon;
    grant execute on function public.channel_showcase() to authenticated;
  end if;
end;
$$;

notify pgrst, 'reload schema';
