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

- **Zwei-Faktor-Anmeldung:** für alle Konten (Authenticator-App); mit eingerichteter 2FA gelten
  Streamer-/Mod-/Admin-Rechte nur nach bestätigtem Code. Im Admin-Bereich ist sie Pflicht.
- **Mod-Rechte und Protokoll:** Streamer sperren Mods einzelne Bereiche; Änderungen mit Rechten
  landen im Mod-Protokoll.
- **Rate-Limits** für die API (`api_guard`) und die Edge Functions; Bot-Schutz bei der Registrierung.
- **Automatische Prüfungen** bei jeder PR: Secret-Scan, Migrationen, Edge Functions, CodeQL.

## Wenn etwas passiert

Siehe **`NOTFALLPLAN.md`** (Raid, gekaperte Konten, verlorene 2FA, Schlüssel austauschen, Backups).

## Einstellungen, die nur im Supabase-Dashboard gehen

Siehe README, Abschnitt „Sicherheit – Checkliste“.

## Supabase-Sicherheitsbericht (Advisors)

Nach `supabase/migrations/20261103000000_advisor_cleanup.sql` (Trigger-Funktionen nicht mehr direkt
aufrufbar) meldet der Bericht unter **0028/0029 „SECURITY DEFINER Function executable“** weiter
Funktionen. Das ist Absicht:

- **Rechte-Prüfungen** (`is_admin`, `is_mod`, `is_owner`, `is_owner_of`, `is_admin_of`, `is_site_admin`,
  `is_legacy_admin`, `mfa_ok`, `current_channel`, `default_channel`, `my_name`, `overlay_can_edit`,
  `challenge_can_edit`, `storage_admin_ok`, `storage_files_of`, `viewer_paused`, `feature_open`): stecken in den
  Row-Level-Security-Regeln. Postgres führt sie mit der Rolle des Aufrufers aus – ohne `EXECUTE` für
  `anon`/`authenticated` würde jede Abfrage scheitern. Sie verraten nur etwas über den Aufrufer selbst.
- **`api_guard`**: ist die Rate-Limit-Prüfung vor jeder Anfrage (PostgREST `db_pre_request`) und läuft
  mit der Rolle der Anfrage – sie muss ausführbar bleiben. Direkt aufgerufen zählt sie nur einen Treffer.
- **Öffentliche Daten** (`channel_info`, `channels_list`, `showcase_list`, `platform_stats`, `stream_live_info`,
  `streamer_info`, `goal_progress`, `contact_send`): für Startseite, Overlay (OBS hat keine Anmeldung) und
  Kontaktformular gedacht – nur freigegebene Felder, mit Grenzen gegen Spam.
- **Aktionen für Angemeldete** (Glücksrad, Bingo, Quiz, Shop, Verlosung, Einstellungen …): prüfen in der
  Funktion selbst, wer was darf (Streamer, freigegebene Mods, Zuschauer).

Neue Trigger-Funktion angelegt? Danach die Aufräum-Migration noch einmal ausführen.

**Leaked Password Protection** (Warnung `auth_leaked_password_protection`): ist eine Einstellung in
Supabase unter **Authentication → Attack Protection** (bzw. Passwort-Einstellungen) – dort einschalten,
falls euer Supabase-Plan sie anbietet. Unabhängig davon lehnt StreamHelp häufige und zu einfache
Passwörter schon bei der Registrierung ab.
