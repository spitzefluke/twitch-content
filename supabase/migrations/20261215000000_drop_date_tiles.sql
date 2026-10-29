-- ============================================================
-- StreamHelp: Termin-Kacheln aus den Content-Ideen entfernen
--   Die Content-Ideen zeigen keine Termin-Kacheln (kind 'countdown') mehr – Termine stehen unter
--   „Profil & Zeitplan“. Die beiden mitgelieferten Termin-Kacheln „Late-Night-Marathon“ (idea-1) und
--   „Countdown zum Subathon“ (idea-4) werden in allen Kanälen gelöscht, auch im Standard-Kanal,
--   damit neue Kanäle sie nicht mehr bekommen (public.channel_seed kopiert dessen Kacheln).
--   Andere, selbst angelegte Termin-Kacheln bleiben (Archiv, Overlay „Nächster Stream“).
-- Braucht 20261028000000_platform.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.tiles') is null then
    raise exception 'Erst die Plattform-Migration 20261028000000_platform.sql ausführen.';
  end if;
end;
$$;

delete from core.tiles where id in ('idea-1', 'idea-4') and kind = 'countdown';
