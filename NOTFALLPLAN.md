# Notfallplan

Was tun, wenn etwas schiefgeht? Jeder Abschnitt ist eine Checkliste – von oben nach unten abarbeiten.
Geheime Schlüssel gehören **nur** in Supabase (Edge Functions → Secrets) oder GitHub
(Settings → Secrets and variables → Actions) – nie in den Code, nie in einen Chat, nie in ein Issue.

## 1. Raid, Spam oder Bots im Stream

1. Dashboard → **Raid-Schutz** an (pausiert alle Zuschauer-Aktionen, Kanalpunkte gehen zurück).
2. Auf Twitch: Follower-only/Sub-only-Chat, ggf. Shield Mode.
3. Danach im **Mod-Protokoll** (Dashboard → Mods) prüfen, ob jemand etwas verstellt hat.

## 2. Ein Mod macht Unsinn

1. Dashboard → **Mods → Rechte je Mod**: betroffene Bereiche sperren (gilt sofort).
2. Notfalls **„Für Mods freigeben“** ausschalten – dann steuert kein Mod mehr mit.
3. Im **Mod-Protokoll** nachsehen, was geändert wurde, und es zurückdrehen.
4. Auf Twitch den Mod-Status entziehen, danach „Mods von Twitch holen“.

## 3. Passwort oder StreamHelp-Konto geklaut

1. Dashboard → **Sicherheit → Alle anderen Geräte abmelden**.
2. Passwort ändern: bei Anmeldung mit Twitch & Co. beim Anbieter; bei E-Mail-Konten setzt es der
   Plattform-Admin in Supabase unter **Authentication → Users → (Konto) → Send password recovery**.
3. **Zwei-Faktor-Anmeldung** einschalten (Dashboard → Sicherheit).
4. Mod-Protokoll prüfen.

Kein Zugang mehr? Der Plattform-Admin kann in Supabase unter **Authentication → Users** das Konto
abmelden („Sign out user“) oder sperren.

## 4. Handy mit der Authenticator-App verloren

- **Streamer/Mod:** Solange du noch irgendwo angemeldet bist: Dashboard → Sicherheit → 2FA ausschalten,
  danach neu einrichten. Sonst: Plattform-Admin löscht in Supabase unter
  **Authentication → Users → (Konto) → MFA factors** den Faktor.
- **Admin-Bereich:** In Supabase im SQL Editor `delete from public.admin_mfa;` ausführen. Beim nächsten
  Login (nur mit Passwort) richtest du den Code neu ein. Vorher das Admin-Passwort ändern (Abschnitt 6).

## 5. Twitch-Konto des Streamers gekapert

1. Dashboard → **Twitch-Verbindung → Trennen** (widerruft den Zugang von StreamHelp).
2. Auf twitch.tv Passwort ändern, 2FA bei Twitch an, unter **Einstellungen → Verbindungen** fremde Apps entfernen.
3. Danach Twitch in StreamHelp neu verbinden.

## 6. Ein geheimer Schlüssel ist bekannt geworden (Secret-Rotation)

Grundregel: **erst neuen Schlüssel erzeugen und eintragen, dann den alten ungültig machen.**
Jede Zeile: wo erzeugen → wo eintragen.

| Schlüssel | Neu erzeugen | Eintragen |
|---|---|---|
| Supabase **service_role** / Secret Key | Supabase → Project Settings → API Keys → neuen Secret Key anlegen, alten löschen (bzw. bei Legacy-Keys: JWT-Secret neu) | Wird von den Edge Functions automatisch genutzt; bei Legacy-Keys danach alle Functions neu deployen (GitHub → Actions → „Edge Functions deployen“) |
| `TWITCH_CLIENT_SECRET` | dev.twitch.tv → Console → Anwendung → „Neues Secret“ | Supabase Secrets **und** Supabase → Authentication → Providers → Twitch |
| `EVENTSUB_SECRET` | beliebiger neuer Zufallswert (mind. 32 Zeichen) | Supabase Secrets, danach im Dashboard „Alerts prüfen“ (legt die Webhooks neu an) |
| `EXTENSION_SECRET` | dev.twitch.tv → Extensions → Einstellungen → Extension-Secret erzeugen | Supabase Secrets |
| `ADMIN_PASSWORD` | neues langes Passwort | Supabase Secrets – meldet alle Admin-Sitzungen ab |
| `HEALTH_CHECK_KEY` | neuer Zufallswert | Supabase Secrets **und** GitHub Actions Secrets |
| `SUPABASE_ACCESS_TOKEN` (GitHub) | supabase.com/dashboard/account/tokens → neues Token, altes löschen | GitHub Actions Secrets |
| Turnstile Secret Key | Cloudflare → Turnstile → Widget → „Rotate secret key“ | Supabase → Authentication → Attack Protection |
| Twitch-Zugang des Streamers/Bots | Twitch trennen und neu verbinden | – |

Danach: Sicherheits-Check im Admin-Bereich laufen lassen und die Logs der Edge Functions ansehen.

## 7. Daten sichern und wiederherstellen

- **Streamer:** Dashboard → Sicherheit → **Kanal-Daten herunterladen** (JSON mit allen Einstellungen,
  ohne Tokens und Lösungen). Am besten vor großen Umbauten und einmal im Monat.
- **Ganze Datenbank:** Supabase → Database → **Backups** (tägliche Sicherungen im Pro-Plan; im Free-Plan
  vorher von Hand: `supabase db dump`). Ein Dump enthält Tokens – **nie** in das öffentliche Repo
  oder als GitHub-Artefakt hochladen.
- Wiederherstellen: Supabase → Database → Backups → Restore, oder den Dump per `psql` einspielen.

## 8. Rate-Limit sperrt echte Nutzer

Die Grenze (300 schreibende Anfragen pro Minute und Konto/IP) sitzt in `public.api_guard()`.
Wert in der Funktion erhöhen oder vorübergehend ganz ausschalten:

```sql
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
```

Wieder an: `alter role authenticator set pgrst.db_pre_request to 'public.api_guard'; notify pgrst, 'reload config';`

## 9. Sicherheitslücke gemeldet

Siehe `SECURITY.md`. Fix in einer eigenen PR, Schlüssel rotieren (Abschnitt 6), falls betroffen.
