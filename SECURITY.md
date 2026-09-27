# Sicherheit

## Lücke gefunden?

Bitte **nicht** als öffentliches Issue melden, sondern über GitHub unter
**Security → Report a vulnerability** (privat) an die Betreiber dieses Repositorys.

## Was die Seite schützt

- **Datenbank:** Row Level Security auf allen Tabellen; alles Schreibende läuft über
  geprüfte Funktionen (`security definer`, fester `search_path`). Das OBS-Overlay liest ohne
  Anmeldung nur freigegebene Spalten – keine Konto-IDs, keine Twitch-Einlösungs-IDs.
- **Twitch:** Webhooks werden per HMAC-Signatur und Zeitstempel geprüft; verbinden darf nur
  der Kanal aus `BROADCASTER_LOGIN`. Der Chat-Bot wiederholt nie eingetippten Text.
- **Webseite:** Content-Security-Policy (nur eigene Skripte, per Hash freigegebene
  Inline-Skripte, `tools/stamp-versions.mjs`), Schutz gegen Einbetten in fremde Seiten
  (Clickjacking), `Referrer-Policy: same-origin`, keine fremden Skripte zur Laufzeit
  (supabase-js liegt lokal in `js/supabase-js.js`).
- **Raid-Schutz:** In der Streameransicht pausieren Streamer und Mods mit einem Klick alle
  Zuschauer-Aktionen (Chat-Befehle, Kanalpunkte mit Rückerstattung, Aktionen auf der Seite).
- **Uploads:** nur Bilder bzw. Audio, Größenlimits pro Bucket, höchstens 10 Sounds pro Person.
- **Geheimnisse:** stehen nur in Supabase (Edge Functions → Secrets) bzw. GitHub (Actions → Secrets),
  nie im Code. `js/config.js` enthält nur den öffentlichen Anon-Key.

## Einstellungen, die nur im Supabase-Dashboard gehen

Siehe README, Abschnitt „Sicherheit – Checkliste“.
