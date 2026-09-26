-- ============================================================
-- Zugfahrer_DaveTV · Content-Stellwerk
-- Eigene Alert-Sounds dürfen bis zu 20 Sekunden lang sein (vorher 10) und bis
-- 4 MB groß (vorher 1 MB), damit auch 20 Sekunden WAV passen. Die Sounds aus
-- „Ärgere den Dave“ bleiben bei 10 Sekunden.
-- Braucht 20261009000000_alert_bits_sounds.sql. Mehrfach ausführbar.
-- ============================================================

alter table public.alert_sounds drop constraint if exists alert_sounds_duration_check;
alter table public.alert_sounds add constraint alert_sounds_duration_check
  check (duration > 0 and duration <= 20.5);

update storage.buckets set file_size_limit = 4194304 where id = 'alert-sounds';
