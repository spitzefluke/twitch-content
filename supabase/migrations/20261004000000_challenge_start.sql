-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Win-Challenge für Zuschauer erst ab 10.10.2026 (vorher Countdown auf der Kachel).
-- Dave und die Admins sehen und benutzen sie schon vorher. Den Termin ändert ein
-- Admin im Challenge-Dialog unter „Für Zuschauer freigeschaltet ab“.
-- Braucht 20261003000000_win_challenge.sql.
-- ============================================================
update public.tiles set target_at = '2026-10-10 00:00:00+02'
  where id = 'challenge' and target_at is null;
