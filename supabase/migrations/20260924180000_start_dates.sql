-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Start für Zuschauer: „Ärgere den Dave“ und das Fortnite-Bingo zeigen
-- Nicht-Admins bis zum Startdatum (tiles.target_at) einen Countdown.
-- Admins können vorher schon alles benutzen und ändern das Datum im
-- jeweiligen Dialog („Für Zuschauer freigeschaltet ab“). Die Kanalpunkte-
-- Belohnungen fürs Ärgern sind bis dahin auf Twitch ausgeschaltet.
-- Außerdem fliegen „Fortnite Community-Cup“ und „Geisterzug-Special“ raus.
-- Mehrfach ausführbar (das Startdatum wird nur gesetzt, solange keins eingetragen ist).
-- ============================================================

update public.tiles set target_at = '2026-10-01 20:00:00+02'
  where kind in ('prank', 'bingo') and target_at is null;

delete from public.tiles
  where kind = 'countdown' and lower(trim(title)) in ('fortnite community-cup', 'geisterzug-special');
