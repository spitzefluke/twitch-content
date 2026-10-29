# StreamHelp

StreamHelp bündelt Planung, Zuschaueraktionen und Stream-Technik für Twitch in einer Plattform. Jeder freigeschaltete Streamer erhält einen eigenen Kanal mit eigenen Inhalten; Zuschauer, Streamer und freigegebene Mods nutzen passende Ansichten und Rechte.

## Funktionen auf einen Blick

- **Planen und entdecken:** Öffentliche Startseite mit Streamer-Showcase, Content-Ideen passend zum Game, Terminen, Countdown, Archiv, Zuschauer-Vorschlägen und mehrsprachiger Hilfe. Das Dashboard bietet außerdem Suche, Favoriten, Einführung, Statistiken und eine installierbare Handy-App.
- **Zuschauer einbeziehen:** Twitch-Panel und Dashboard unterstützen Umfragen, Verlosungen, Mitspieler-Warteschlange, Haustieraktionen und Game-Pakete. Zuschauer können per Chat oder Kanalpunkten Kommandos für den Stream auslösen. Fortnite-Bingo, Quiz, Zähler, Spiel-Rad und weitere Aktionen lassen sich im Overlay zeigen.
- **Chat-Bot und Twitch:** Der gemeinsame Bot verarbeitet eigene Befehle, Stream-Infos, Begrüßungen, automatische Nachrichten, Moderation und Song-Wünsche. Er bedankt sich für Follows, Abos, Bits und Raids. Twitch-Verbindungen, Belohnungen und EventSub laufen über Supabase Edge Functions.
- **OBS und Aufnahme:** Das anpassbare Overlay zeigt Alerts, Chat, Szenen, Spiele, Haustier, Laufband und weitere Ebenen. Es lässt sich in Module und OBS-Szenen aufteilen und direkt über obs-websocket verwalten. Statistiken zeigen Overlay-Datenverbrauch und OBS-/Stream-Werte; das Aufnahme-Studio nimmt Videos lokal im Browser auf.
- **Sicherheit und Betrieb:** Streamer verwalten Mod-Rechte und Raid-Schutz. Plattform-Admins können Kanäle moderieren, Overlays oder den Bot im Notfall pausieren, Wartung ankündigen, Updates ausrollen und Neuigkeiten veröffentlichen. Zwei-Faktor-Anmeldung, Rate-Limits, Sicherheitsprüfungen und Datenexport ergänzen den Schutz.

Startseite und Anmeldung sind in zehn Sprachen verfügbar; die Twitch-Erweiterung übernimmt die Sprache des Zuschauers (oder eine feste, die der Streamer wählt). Das Dashboard ist derzeit deutsch. Im Demo-Modus lassen sich viele Funktionen ohne Twitch- oder Supabase-Verbindung ausprobieren. Die folgenden Abschnitte beschreiben Einrichtung und Funktionen im Detail.

## Aufbau

```
index.html, css/, js/, assets/   → statische Seite für GitHub Pages
overlay.html                     → OBS-Browserquelle (alle Ebenen, live eingestellt)
404.html                         → eigene Fehlerseite („Dieser Stream ist offline“) für falsche Adressen
supabase/migrations/             → Datenbank (Profile, Kacheln, Varianten, Drehungen, Vorschläge, Twitch-Tokens)
supabase/functions/
  twitch-oauth/                  → Twitch-Login für Streamer und Bot, Belohnungen, EventSub-Abos, Gesundheitscheck
  twitch-eventsub/               → empfängt Kanalpunkte-Einlösungen von Twitch, dreht, postet im Chat
  spin/                          → Drehung von der Webseite aus
  bingo-bet/                     → Bingo-Tipprunde als Twitch-Vorhersage (starten, auflösen, abbrechen)
  youtube-chat/                  → YouTube-Livechat fürs Overlay (ohne API-Schlüssel)
  stream-tools/                  → Bot-Nachrichten verschicken, Kanalpunkte für Vorlesen/Karten, Einlösungen abschließen
```

GitHub Pages kann nur statische Dateien ausliefern. Damit Einlösungen auch ohne geöffnete Seite funktionieren, braucht Twitch einen Server, den es anrufen kann. Diese Rolle übernehmen die **Supabase Edge Functions** (der kostenlose Tarif reicht). Supabase kümmert sich außerdem um Accounts und die Datenbank.

### Versionsnummern (Cache)

GitHub Pages lässt JS- und CSS-Dateien bis zu 10 Minuten im Browser-Cache. Damit nach einem Update nie alte und neue Dateien gemischt werden (Fehler wie „does not provide an export named …“), hängt `tools/stamp-versions.mjs` an jede Datei `?v=<Hash ihres Inhalts>` – für die JS-Module über eine Import-Map in `index.html`, `overlay.html` und `admin.html`. Nach Änderungen an `js/` oder `css/` einmal `node tools/stamp-versions.mjs` ausführen; vergisst man es, erledigt das die GitHub Action „Versionsnummern aktualisieren“ nach dem Push auf `main`. Das OBS-Overlay schaut alle 3 Minuten nach, ob es eine neue Version gibt, und lädt sich dann von selbst neu – OBS muss dafür nicht angefasst werden.

## Demo-Modus

Solange in `js/config.js` nichts eingetragen ist, läuft die Seite im Demo-Modus. Accounts und Kacheln werden dann nur im Browser gespeichert, und der erste registrierte Account darf Kacheln bearbeiten. Mit „Kanalpunkte-Einlösung simulieren“ im Glücksrad lässt sich testen, wie eine Twitch-Einlösung aussieht.

Lokal starten (ES-Module brauchen einen Webserver):

```bash
npx http-server -p 5317
```

Die Startseite ist öffentlich, `…/#login` öffnet direkt die Anmeldung. Die Oberfläche (Startseite, Anmeldung, Seitenleiste) steht in `css/shell.css`, die Logik dazu am Anfang von `js/app.js`.

---

## Einrichtung (Live-Betrieb)

### 1. GitHub Pages

1. Neues Repository anlegen und alle Dateien hochladen.
2. **Settings → Pages → Build and deployment**: Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
3. Nach ca. einer Minute ist die Seite unter `https://<dein-name>.github.io/<repo>/` erreichbar.

### 2. Supabase – schnell mit dem Setup-Skript (Windows)

1. Auf [supabase.com/dashboard](https://supabase.com/dashboard) ein neues Projekt anlegen (kostenloser Tarif, Region z. B. *Frankfurt*). Das Datenbank-Passwort gut merken.
2. Repo klonen und im Ordner ausführen:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup-supabase.ps1
   ```

   Das Skript erledigt Folgendes:
   - Es meldet dich bei Supabase an (über den Browser) und fragt nach der Projekt-ID.
   - Es legt die Datenbank an.
   - Es zeigt dir die Redirect-URL für die Twitch-App und fragt dann nach Client-ID und Secret.
   - Es fragt nach einem Admin-Passwort für `admin.html`.
   - Es setzt alle Secrets (das Webhook-Secret erzeugt es selbst).
   - Es lädt die Server-Funktionen hoch und trägt die Supabase-Adresse in `js/config.js` ein.
3. Danach bleiben nur die zwei Schritte, die das Skript am Ende anzeigt: die Site-URL im Supabase-Dashboard eintragen und `js/config.js` pushen.

Wer lieber alles von Hand macht, folgt den Schritten 2a–4.

### 2a. Supabase-Projekt (manuell)

1. Auf [supabase.com](https://supabase.com) ein Projekt anlegen.
2. Repository klonen, im Projektordner `npx supabase link --project-ref <Projekt-ID>` ausführen und danach `npx supabase db push`. Dadurch werden alle Migrationen aus `supabase/migrations/` in der richtigen Reihenfolge eingespielt. Das Setup-Skript oben erledigt diesen Schritt ebenfalls. Falls du stattdessen den SQL Editor verwendest, führe **alle** Dateien in `supabase/migrations/` nach Dateiname aufsteigend aus; eine alte, fest gepflegte Auswahlliste kann neue Funktionen und Sicherheitskorrekturen auslassen.
3. **Authentication → URL Configuration**: *Site URL* = deine GitHub-Pages-URL. Dieselbe URL auch bei *Redirect URLs* eintragen.
4. Optional: Unter **Authentication → Providers → Email** kannst du „Confirm email“ ausschalten. Dann entfällt die Bestätigungsmail bei der Registrierung.
5. **Project Settings → API**: *Project URL* und den *anon / publishable key* in `js/config.js` eintragen:

   ```js
   SUPABASE_URL: 'https://abcdefgh.supabase.co',
   SUPABASE_ANON_KEY: 'eyJ…',
   ```

   Den *service_role / secret key* **niemals** in `config.js` eintragen.

### 3. Twitch-App registrieren

1. [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → **Register Your Application**
2. **OAuth Redirect URL**: `https://<projekt-ref>.supabase.co/functions/v1/twitch-oauth`
3. Kategorie: *Website Integration*, Client-Typ: *Confidential*
4. **Client ID** notieren und ein **Client Secret** erzeugen.

### 4. Edge Functions deployen

**Ohne eigene Installation – über GitHub (empfohlen):** Die Action `.github/workflows/deploy-functions.yml` lädt die Functions hoch, sobald sich auf `main` etwas unter `supabase/functions` ändert.

1. In Supabase oben rechts auf das Profilbild → **Account preferences** → **Access Tokens** (direkt: supabase.com/dashboard/account/tokens) → **Generate new token**, Namen z. B. `github`, Token kopieren.
2. In GitHub im Repository **Settings → Secrets and variables → Actions → New repository secret**: Name `SUPABASE_ACCESS_TOKEN`, Wert = der Token.
3. Zum sofortigen Deployen: **Actions → Edge Functions deployen → Run workflow**. Nach gut einer Minute steht dort ein grüner Haken.

Die Secrets der Functions (`TWITCH_CLIENT_ID` usw., Tabelle unten) trägst du weiterhin in Supabase unter **Edge Functions → Secrets** ein.

**Alternativ vom eigenen Rechner** mit der [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
```

```bash
supabase link --project-ref <projekt-ref>
```

```bash
supabase secrets set TWITCH_CLIENT_ID=xxx TWITCH_CLIENT_SECRET=xxx EVENTSUB_SECRET=<zufällige-zeichenkette-32-zeichen> SITE_URL=https://<dein-name>.github.io/<repo>/ BROADCASTER_LOGIN=<twitch-name-des-streamers> HEALTH_CHECK_KEY=<zufällige-zeichenkette-32-zeichen>
```

```bash
supabase functions deploy --use-api --no-verify-jwt
```

Tests für die Webhook-Signaturprüfung:

```bash
npx deno test --allow-env --allow-net supabase/functions/twitch-eventsub/signature_test.ts
```

| Secret | Bedeutung |
|---|---|
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | aus der Twitch-Developer-Konsole |
| `EVENTSUB_SECRET` | beliebige zufällige Zeichenkette (10–100 Zeichen), mit der Twitch seine Webhooks signiert |
| `SITE_URL` | wohin der Streamer nach dem Twitch-Login zurückgeschickt wird |
| `BROADCASTER_LOGIN` | **Pflicht:** nur dieser Twitch-Kanal darf sich verbinden (und wird dabei Admin). Fehlt es, dürfen sich aus Sicherheitsgründen nur Admins verbinden. |
| `REWARD_TITLE` *(optional)* | Name der Belohnung, Standard `Glücksrad` |
| `REWARD_COST` *(optional)* | Kosten in Kanalpunkten beim ersten Verbinden, Standard `10000` – danach im Glücksrad-Dialog änderbar |
| `HEALTH_CHECK_KEY` *(empfohlen)* | beliebige zufällige Zeichenkette (mindestens 20 Zeichen). Damit prüft die GitHub Action „Twitch-Gesundheitscheck“ alle 30 Minuten die Twitch-Verbindung – denselben Wert als GitHub-Secret `HEALTH_CHECK_KEY` eintragen (siehe „Twitch-Gesundheitscheck“). |
| `HELP_AI_URL` / `HELP_AI_KEY` / `HELP_AI_MODEL` *(optional)* | KI-Hilfe auf der Startseite (OpenAI-kompatibler Dienst, siehe „Sprachen, Kontakt & KI-Hilfe, Showcase“). Ohne sie antwortet die Seite aus den FAQ. |

### 5. Der Streamer verbindet Twitch

1. Der Streamer registriert sich auf der Webseite und meldet sich an.
2. In der Seitenleiste auf **🟣 Twitch-Verbindung** (nur in der Streameransicht) und **„Mit Twitch verbinden“** klicken.
3. Auf Twitch mit dem eigenen Kanal anmelden (Standard-Kanal: der aus `BROADCASTER_LOGIN`; jeder andere Kanal: das Twitch-Konto, mit dem er angemeldet wurde) und den Zugriff erlauben:
   - `channel:manage:redemptions` (Belohnung anlegen, Einlösungen erledigen)
   - `channel:read:redemptions` (Einlösungen empfangen)
   - `channel:bot` (der Chat-Bot darf in seinem Chat schreiben)
   - `moderator:read:followers`, `channel:read:subscriptions` und `bits:read` (neue Follower, Abos und Bits für die Alerts im Overlay)
   - `moderation:read`, `channel:manage:predictions` (Mods erkennen, Bingo-Tipprunde)
   - `moderator:read:chatters` (wer im Chat ist – für die Watchtime)
4. Danach passiert automatisch Folgendes:
   - Die Belohnung „Glücksrad“ für 10.000 Kanalpunkte wird angelegt.
   - Der EventSub-Webhook wird registriert.
   - Der Account des Streamers wird Admin und darf die Kacheln bearbeiten.
   - Der Gesundheitscheck läuft einmal durch; das Ergebnis steht unter **🔔 Alerts**.

Löst ab jetzt ein Zuschauer die Belohnung ein, passiert Folgendes:

1. Twitch ruft `twitch-eventsub` auf.
2. Eine zufällige Variante und ein zufälliges Feld werden ausgelost.
3. Im Chat erscheint zum Beispiel:
   > 🎡 Glücksrad für @Zuschauer: [Waffen-Roulette] Nur Schrotflinten – Nur Shotguns (und die Spitzhacke) sind erlaubt. Gilt für die nächste Runde!
4. Die Einlösung wird als erledigt markiert. Schlägt das Drehen fehl, bekommt der Zuschauer seine Punkte zurück.
5. Ist die Webseite gerade offen, dreht sich das Rad dort live mit (Supabase Realtime).

Dreht der Streamer selbst auf der Webseite, kann er mit dem Schalter „Ergebnis als … im Chat posten“ bestimmen, ob das Ergebnis auch im Chat landet.

**Glücksrad bearbeiten (Admins):** Im Glücksrad-Dialog unten auf **„✎ Kosten und Ergebnisse bearbeiten“**:
- **Kosten auf Twitch:** Kanalpunkte pro Drehung (1 bis 1.000.000) eintragen und „Auf Twitch übernehmen“ – die Belohnung auf Twitch ändert sich sofort und die Kosten bleiben auch beim erneuten Verbinden erhalten.
- **Varianten und Ergebnisse:** Name, Farbe und Beschreibung jeder Variante sowie ihre Ergebnisse (Titel auf dem Rad + Erklärung, was gilt) ändern, verschieben, löschen und neue anlegen (2 bis 16 Ergebnisse pro Variante, bis zu 8 Varianten). Die Vorschau zeigt das Rad sofort. „Varianten speichern“ gilt gleich für die Webseite, Kanalpunkte-Drehungen im Chat und das OBS-Overlay; alte Drehungen bleiben, wie sie waren.

- **Zweites Rad:** Pro Variante lässt sich „Danach dreht sofort ein zweites Rad“ einschalten (Vorlage: Seltenheit). Über „1. Rad / 2. Rad“ bearbeitest du beide; im zweiten Rad hat jedes Feld seine eigene Farbe.

Einmal nötig: Migration `20261006000000_wheel_edit.sql` ausführen (die Edge Function `twitch-oauth` kommt beim Merge automatisch).

**Waffen-Lotto:** Die Variante lost zuerst die einzige Waffe des Streamers aus (Sturmgewehr, Schrotflinte, MP, Pistole, Scharfschützengewehr, Explosivwaffe, Bogen/Armbrust, Maschinengewehr). Direkt danach wechselt das Rad auf die **Seltenheit** (Gewöhnlich bis Mythisch, in Fortnite-Farben) und dreht noch einmal – auf der Webseite, bei Kanalpunkten und im OBS-Overlay. Im Chat steht z. B. „[Waffen-Lotto] Sturmgewehr + Seltenheit: Episch!“. Einmal nötig: Migration `20261007000000_wheel_bonus.sql` (legt die Variante an und speichert das zweite Rad bei jeder Drehung mit).

### 6. Chat-Bot verbinden

Die Ergebnisse schreibt ein eigener Twitch-Account in den Chat, nicht der Streamer. Er liest außerdem die Chat-Befehle mit (`!join`, `!a`–`!d`, `!füttern`, `!change` …). Ohne verbundenen Bot bleibt der Chat still, das Rad dreht trotzdem.

1. Auf Twitch einen eigenen Account für den Bot anlegen, z. B. `StreamHelpBot`. Sein Name steht später im Chat.
2. Auf twitch.tv mit **diesem Bot-Account** anmelden (in einem privaten Fenster geht es am einfachsten).
3. Im selben Fenster auf der Webseite anmelden (Streamer, Admin oder freigegebener Mod) und in der Seitenleiste unter **🤖 Bot & Chat** auf **„Bot verbinden“** klicken. (Im Admin-Bereich geht es weiterhin auch.)
4. Twitch fragt jetzt den Bot-Account nach `user:write:chat`, `user:read:chat` und `user:bot`. Erlauben. Danach geht es zurück ins Dashboard, dort steht „Chat-Bot … ist verbunden“.

Gesendet wird mit dem App-Token der Twitch-App. Twitch zeigt am Bot dann das Bot-Abzeichen. Dafür braucht es das Recht des Streamers `channel:bot` aus Schritt 5. Hat der Streamer schon vorher verbunden, einmal **„Neu verbinden“**, oder den Bot im Kanal zum Moderator machen (`/mod StreamHelpBot`).

**Bot im Kanal zum Mod machen (empfohlen):** im eigenen Twitch-Chat `/mod StreamHelpBot` schreiben (bzw. den Namen von Bot 2). Sonst blockt Twitch seine Nachrichten, sobald der Chat im Nur-Follower-, Nur-Abo-, Emote- oder langsamen Modus ist („This room is in followers-only mode“). Das Bot-Protokoll im Dashboard zeigt bei jeder blockierten Nachricht den Grund auf Deutsch und was zu tun ist.

**Zweiter Bot** (Migration `20261116000000_bot_stats.sql`): Im Admin-Bereich gibt es zwei Plätze, **Bot 1** und **Bot 2** – zwei verschiedene Twitch-Konten, jedes wie oben verbunden (vor dem Verbinden auf twitch.tv mit dem jeweiligen Bot-Account anmelden). Jeder Streamer wählt im Dashboard unter **🤖 Bot & Chat**, welcher in seinem Chat schreibt; ist der gewählte nicht verbunden, springt der andere ein. Beim Wechsel richtet StreamHelp das Chat-Abo des Kanals gleich neu aus.

### 7. Eigene Befehle und !watchtime

Im Dashboard unter **🤖 Bot & Chat** legen Streamer, Admins und freigegebene Mods **eigene Befehle** an: Befehl (z. B. `!discord`) und feste Antwort, dazu Pause in Sekunden, „Nur Mods“ und an/aus. Platzhalter in der Antwort: `{user}` (Name des Schreibers), `{count}` (wie oft der Befehl benutzt wurde), `{watchtime}` (Watchtime des Schreibers), `{streamer}`. Eingebaute Befehle (`!join`, `!watchtime` …) lassen sich nicht überschreiben; `!befehle` listet alle aktiven im Chat. Beispiele `!lurk`, `!hydrate` und `!socials` sind vorbereitet.

**`!watchtime`** antwortet mit der eigenen Zuschauzeit, `!watchtime @name` mit der eines anderen (nur, wenn der Name bekannt ist – der Bot wiederholt nie eingetippten Text). Gezählt wird, solange der Stream live ist, **jede Minute** (Migration `20261116000000_bot_stats.sql`; vorher alle 5 Minuten): Angestoßen wird die Zählung von allem, was während des Streams passiert – Chat-Nachrichten, Twitch-Panel, `stream.online` und das OBS-Overlay. Die Edge Function sieht bei Twitch nach, ob der Kanal live ist, und schreibt allen im Chat die Zeit gut (höchstens jede Minute, Streamer und Bots zählen nicht). Die Rangliste im Dashboard aktualisiert sich dabei von selbst. Dafür braucht die Seite das neue Twitch-Recht `moderator:read:chatters` – der Gesundheitscheck meldet es, dann **Twitch einmal neu verbinden**. Bis dahin zählen alle, die in den letzten 10 Minuten geschrieben haben. Die Rangliste steht im Dashboard unter Bot & Chat.

Einmal nötig: Migration `20261017000000_chat_bot_commands.sql`.

**Alte Watchtime, Twitch-Daten, „zählt seit“** (Migration `20261104000000_watchtime_import.sql`):

- Twitch gibt die bisherige Zuschauzeit eines Zuschauers **nicht** heraus – dafür gibt es keine Schnittstelle. StreamHelp (wie jedes Tool) zählt ab dem ersten Stream mit Overlay; die Watchtime-Karte zeigt, **seit wann**.
- **Import:** Unter Bot & Chat → Watchtime lädt der Streamer den Watchtime-Export eines früheren Bots als CSV hoch (StreamElements, Streamlabs, Nightbot, WizeBot …). Erkannt werden eine Namens-Spalte (`username`, `name`, `login` …) und eine Zeit-Spalte (`minutes`, `hours`, `watchtime` …, auch Texte wie „12h 30m“ oder „1:23:45“). Vor dem Speichern zeigt die Seite, wie viele Zuschauer und Stunden gefunden wurden. Ein neuer Import ersetzt den alten, „Import entfernen“ nimmt ihn wieder heraus. Gezählt wird beides zusammen – in der Rangliste, bei `!watchtime` und im Platzhalter `{watchtime}`.
- **Twitch-Daten:** `!watchtime` nennt zusätzlich „Follower seit …“, die Rangliste zeigt „Follower seit“ und „Twitch seit“ (Konto erstellt). Geholt wird das bei Twitch höchstens einmal pro Woche je Zuschauer; „Follower seit“ braucht das Recht `moderator:read:followers` (hat die Verbindung schon für die Verlosung).

## Social-Logins für Zuschauer

Auf der Anmeldeseite gibt es Buttons für **Twitch, Discord, Google, Spotify und GitHub**. Ein Button erscheint automatisch, sobald der Anbieter in Supabase eingeschaltet ist. Im Admin-Bereich unter „Anmelde-Möglichkeiten“ siehst du, welche schon aktiv sind.

Für jeden Anbieter brauchst du eine App mit dieser **Callback-/Redirect-URL**:

```
https://ssibsphuttjlphijilsc.supabase.co/auth/v1/callback
```

Die Client-ID und das Secret aus der App trägst du dann in Supabase unter **Authentication → Sign In / Providers** beim jeweiligen Anbieter ein und schaltest ihn ein.

| Anbieter | Wo die App angelegt wird | Hinweise |
|---|---|---|
| **Twitch** | [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) | Die vorhandene App reicht. Unter „OAuth Redirect URLs“ die Callback-URL **zusätzlich** eintragen. |
| **Discord** | [discord.com/developers/applications](https://discord.com/developers/applications) | *New Application* → *OAuth2* → Redirect hinzufügen, Client ID und Secret kopieren |
| **Google** | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) | Zuerst den *OAuth consent screen* (extern) einrichten, dann *OAuth client ID* vom Typ *Web application* anlegen und die Callback-URL eintragen. |
| **Spotify** | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) | *Create app*, Callback-URL als Redirect URI, „Web API“ anhaken. ⚠️ Im Entwicklungsmodus können sich nur Konten anmelden, die du im Dashboard unter *User Management* einzeln freigibst. |
| **GitHub** | [github.com/settings/developers](https://github.com/settings/developers) | *New OAuth App*. Homepage: die GitHub-Pages-URL, Callback: die URL oben. |

**Wichtig:** Unter **Authentication → URL Configuration** müssen *Site URL* und *Redirect URLs* auf `https://spitzefluke.github.io/twitch-content/` stehen. Sonst landen Zuschauer nach dem Login nicht wieder auf der Webseite.

Neue Nutzer bekommen automatisch den Anzeigenamen vom jeweiligen Anbieter. „Mit Twitch anmelden“ (für Zuschauer) und „Mit Twitch verbinden“ (für den Streamer, Kanalpunkte und Chat) sind zwei getrennte Dinge.

## Dashboard: Streameransicht, Modansicht und Mods

Nach dem Anmelden kommt das **Dashboard**. Links die **Seitenleiste**, nach Themen gruppiert (Inhalte, Live-Steuerung, Stream-Setup, Auswertung, Kanal & Team), mit **Bereich suchen** (Taste `/`). Der Knopf oben klappt sie ein – dann bleiben Symbol und Kurzname stehen; der Zustand bleibt gespeichert, auf dem Handy öffnet ☰ sie über dem Inhalt. Oben rechts: **Darstellung** (Hell/Dunkel, Akzentfarbe, Kontrast – gilt nur in diesem Browser), der Knopf **OBS-Overlay** mit Status und das **Konto-Menü** (Twitch-Status, Kanal wechseln, Sicherheit, Abmelden). Zuerst stehen immer die **🎬 Content-Ideen**. Zuschauer sehen nur Content-Ideen und Vorschläge & Archiv; Streamer, Admins und freigegebene Mods zusätzlich die **Stream-Werkzeuge**:

| Bereich | Was es dort gibt |
|---|---|
| 🤖 **Bot & Chat** | Editor in drei Spalten: links die Liste (Bot-Konto, Protokoll, eigene Befehle, Auto-Nachrichten, Begrüßung, Moderation, Songs …), in der Mitte bearbeiten mit Speichern/Verwerfen, rechts eine **Chat-Vorschau** zum Ausprobieren (nur im Browser, nichts geht in den echten Chat) |
| 🎟️ **Kanalpunkte** | alle Belohnungen mit Kosten und Stand; „Kosten & Einstellungen“ öffnet das passende Fenster |
| 🔔 **Alerts** | Twitch-Gesundheitscheck mit „Jetzt prüfen & reparieren“, Probe-Alerts (auch Kanalpunkte) |
| 🎛️ **Overlay & OBS** | Adresse der Browserquelle, OBS-Fenster öffnen |
| 🛡️ **Raid-Schutz** | alle Zuschauer-Aktionen mit einem Klick pausieren |
| 👥 **Mods** | Mods von Twitch holen, Freigabe (nur Streamer) |
| 🟣 **Twitch-Verbindung** | Kanal verbinden, neu verbinden, trennen (nur Streameransicht) |

Die **🎬 Content-Ideen** beginnen mit einer Begrüßung und dem Countdown zum nächsten Termin. Darunter filtern Chips nach Art (Mit Termin, Mitmachen, Chat-Spiele, Overlay) und nach Game; Suche und der Wechsel zwischen **Raster und Liste** stehen rechts (die Ansicht merkt sich der Browser).

Eingeklappt zeigt die Seitenleiste beim Drüberfahren den Namen jedes Bereichs mit einem Zähler (z. B. „16 Kacheln“, „3 Vorschläge“, „1 Twitch-Problem“). Countdowns, die in weniger als 24 Stunden ablaufen, leuchten gelb, die Sekunden pulsieren.

Oben schaltest du zwischen **🎥 Streameransicht** und **🛡️ Modansicht** um; in der Modansicht ist die Kopfzeile grün und trägt das Schild „Mod-Ansicht“. Die Modansicht zeigt genau das, was freigegebene Mods sehen: alles – auch die **Kanalpunkte-Kosten** und das **Bot-Konto** – außer Twitch verbinden/trennen und der Mod-Freigabe. Mods haben nur die Modansicht. **🎛️ OBS** oben rechts öffnet das OBS-Fenster.

Wer Twitch verbindet und sich als der Kanal anmeldet, ist der **Streamer** dieser Seite. Der Name des Kanals steht überall (Startseite, Laufband „Mehr von …“ und `{kanal}`, Sprüche des Dinos mit `{streamer}`, Kanalpunkte-Belohnungen „🍅 Wirf was auf ‹Kanal›“).

**Mods – „Für Mods freigeben“** (schaltet nur der Streamer): Die Seite holt die Mods des Kanals von Twitch (**🔄 Mods von Twitch holen**, passiert auch beim Verbinden). Mods melden sich mit **„Mit Twitch anmelden“** an; ist die Freigabe an, steuern sie das OBS-Overlay, alle Content-Ideen, die Kanalpunkte-Kosten und den Bot mit. Freigabe aus → Mods sind sofort wieder normale Zuschauer.

Einmal nötig: Migration `supabase/migrations/20261012000000_streamer_mods.sql` ausführen, und der Streamer verbindet **Twitch einmal neu** – für die Mod-Liste braucht die Seite das Recht `moderation:read`.

## Twitch-Gesundheitscheck

Neue Funktionen brauchen oft neue Twitch-Rechte, und Twitch schaltet Webhook-Abos nach Zustellfehlern still ab – dann kommen keine Alerts mehr. Deshalb prüft StreamHelp automatisch:

- **Rechte:** fragt Twitch, welche Rechte der gespeicherte Zugang wirklich hat, und vergleicht sie mit dem, was die neuesten Funktionen brauchen. Fehlt etwas, steht dort, wofür (z. B. „Bits-Alerts“) – Lösung: Twitch einmal neu verbinden.
- **Abos bei Twitch** für Follows, Abos, Resubs, Abo-Geschenke, Bits, Kanalpunkte und Chat: fehlende oder abgeschaltete legt er sofort neu an.
- **Bot** verbunden und liest den Chat? Secrets gesetzt (`EVENTSUB_SECRET` 10–100 Zeichen)?
- **Letzte Nachricht von Twitch:** wann zuletzt ein echtes Ereignis ankam.

Wann: beim Öffnen des Dashboards (Streamer, Mods, Admins – höchstens einmal pro Minute wirklich bei Twitch), alle 10 Minuten solange es offen ist, nach dem Verbinden mit Twitch und **alle 30 Minuten per GitHub Action** („Twitch-Gesundheitscheck“), auch wenn niemand online ist. Probleme sehen Streamer, Mods und Admins sofort: roter Punkt in der Kopfzeile, Banner über dem Inhalt, Zahl an **🔔 Alerts** und eine Meldung; im Admin-Bereich steht es unter Twitch → „Gesundheit“. Echte Kanalpunkte-Einlösungen erscheinen jetzt auch als Alert (🎟️).

Einrichten: Migration `20261016000000_streamhelp.sql` ausführen. Für den 30-Minuten-Check eine zufällige Zeichenkette (mindestens 20 Zeichen) zweimal als Secret eintragen: in Supabase unter **Edge Functions → Secrets** als `HEALTH_CHECK_KEY` und in GitHub unter **Settings → Secrets and variables → Actions** als `HEALTH_CHECK_KEY`. Ohne das Secret überspringt die Action den Check einfach.

## OBS-Overlay

Im Dashboard oben rechts auf **🎛️ OBS** klicken – das kann jeder, der angemeldet ist. Die OBS-Einstellungen öffnen sich in einem **eigenen Fenster** (`index.html?obs`), nicht als Pop-up; „← Zur Webseite“ schließt es wieder. **Am Anfang ist alles aus** – nur das Laufband läuft immer. Aufbau wie ein Editor: oben die Werkzeugleiste (OBS-Status, „Live gespeichert“, „In OBS übernehmen“), **links die Ebenen** (gruppiert nach „Immer im Bild“, „Bei Aktion“, „Info“, „Spiele“ und „Neue Content-Ideen“), **in der Mitte die Bühne** mit großer Vorschau, Adresse und OBS-Verbindung, **rechts der Inspektor**. Jede Ebene hat einen Schalter; ein Klick auf ihren Namen zeigt rechts unter „Ebene“ ihre Einstellungen (Esc hebt die Auswahl auf) (Größe, Platz mit „Zurück an den Standardplatz“, dazu z. B. beim Glücksrad „Zeigen bei“ und Ergebnisdauer, beim Dino „Läuft auf“ und das Klettern). Ein Klick auf eine Karte in der Vorschau öffnet ihre Ebene, die offene Ebene ist in der Vorschau markiert. Weitere Reiter: **„Aussehen & Ton“** (Akzentfarbe, Kartenhintergrund, Abstand, Gesamtlautstärke, **🎚️ Lautstärke je Ebene**, Alert-Sounds) und **„Texte“** (Laufband-Texte, „Dino sagt im Stream“, Admin-Freigabe); Probe-Alerts gibt es im Dashboard unter **🔔 Alerts**. Die Kopfzeile zeigt, ob OBS verbunden ist und ob live gespeichert wird. Am einfachsten auf dem PC, auf dem OBS läuft:

1. **Mit OBS verbinden:** In OBS unter **Werkzeuge → WebSocket-Servereinstellungen** „WebSocket-Server aktivieren“ anhaken, über „Verbindungsinfo anzeigen“ das Passwort kopieren und im Dialog eintragen (OBS 28 oder neuer). Das Passwort merkt sich nur dieser Browser – verschlüsselt (AES-GCM, Schlüssel nicht exportierbar in IndexedDB); „Trennen“ löscht es. Fragt der Browser nach Zugriff aufs lokale Netzwerk: zulassen.
2. Die Vorschau zeigt jetzt das **echte OBS-Bild** (etwa jede Sekunde neu). Die Seite erkennt die Kamera des Streamers in der Szene und legt den **roten Rahmen** darauf – dort landen die Würfe. Stimmt die Erkennung nicht, eine andere Quelle wählen oder den Rahmen selbst verschieben und an der Ecke in der Größe ändern.
3. **Karten verschieben:** Karten in der Vorschau mit der Maus an ihren Platz ziehen; sie rasten am Rand, in der Mitte und an den Kanten der anderen Karten ein – eine pinke Hilfslinie zeigt, woran. Rechts bei den Ebenen: was zu sehen ist, Größen und die Einstellungen jeder Karte.
4. **In OBS übernehmen:** legt in der aktuellen Szene die Browserquelle **„StreamHelp-Overlay“** an (eine alte „Stellwerk-Overlay“-Quelle wird dabei umbenannt) (1920 × 1080, Ton über OBS) und schiebt sie ganz nach oben, über die Kamera.

**Live:** Die Browserquelle bekommt die feste Adresse `overlay.html?live=1`. Alle Einstellungen aus dem Dialog liegen in der Datenbank (`overlay_config`) – jede Änderung im Dialog wird sofort gespeichert und das Overlay in OBS lädt sich von selbst neu. Einmal einrichten reicht, danach nie wieder die Adresse tauschen. Ändern darf **der Streamer** (wer Twitch verbunden hat, und der Admin-Bereich); im Dialog kann der Streamer mit **„Admins (Mods) dürfen das Overlay anpassen“** den Admins der Seite das Anpassen erlauben. Alle anderen sehen die aktuellen Einstellungen nur an. Migration `20260930000000_live_overlay.sql` nötig – ohne sie enthält die Adresse wie früher alle Einstellungen.

**Ton im Stream:** Der Ton des Overlays (Glücksrad, Alerts, Sounds …) kommt in den Stream, wenn bei der Browserquelle **„Audio über OBS steuern“** an ist – „In OBS übernehmen“ stellt das automatisch ein, im OBS-Mixer steht dann „StreamHelp-Overlay“. Mit OBS verbunden prüft **🔊 Ton prüfen** im OBS-Fenster alles auf einmal: Die Seite schickt dem Overlay in OBS einen Test-Ton (über das Browserquellen-Ereignis `streamhelpSoundTest`), liest dabei die Pegelanzeige in OBS mit und meldet, ob der Ton ankommt – oder warum nicht (Ton nicht über OBS, Quelle stumm, sehr leise). **🛠 Beheben** schaltet „Audio über OBS steuern“ ein und die Stummschaltung aus. **Vorlesen** nutzt die Windows-Stimme des PCs; die kann eine Browserquelle technisch nicht an OBS geben, sie läuft über **Desktop-Audio** – die Prüfung zeigt, ob OBS Desktop-Audio aufnimmt.

**Ton anpassen:** Unter *Aussehen & Ton* gibt es die Gesamtlautstärke und einen Regler je Ebene (0–200 %), dazu **🔇** (stumm/zurück) und **▶** (Ton der Ebene in der Vorschau anhören – schaltet „🔈 Ton in der Vorschau“ ein; sonst ist die Vorschau stumm).

**Aussehen je Ebene:** Jede Karte hat unter *Ebene → 🎨 Aussehen* eine eigene **Farbe** (Design-Farbe, 9 Farben oder frei gewählt), eine **Schrift** (Barlow, Inter, JetBrains Mono, Georgia, Comic, Impact …) und – außer Glücksrad, Alerts und Laufband, die eigene Effekte haben – wie sie **einblendet** (von unten/oben/rechts/links, zoomen, aufploppen, aufklappen, nur einblenden oder ohne) samt **Tempo**. Das **Laufband** lässt sich jetzt wie alle Ebenen ausschalten.

**Vorlagen:** Unter *Aussehen & Ton → 💾 Vorlagen* speichert ihr die kompletten Overlay-Einstellungen unter einem Namen (z. B. „Fortnite-Abend“) und holt sie mit **Laden** zurück (Strg+Z macht es rückgängig). Speichern/Löschen darf, wer das Overlay anpassen darf. Einmal nötig: Migration `supabase/migrations/20261027000000_overlay_presets.sql`.

**Leistung – keine Lags im Stream:** Das Overlay ist darauf ausgelegt, OBS möglichst wenig zu belasten. Bewegung läuft auf der Grafikkarte (transform/opacity statt Neuzeichnen), das Glücksrad zeichnet seine Scheibe nur einmal und dreht dann das fertige Bild, das Haustier misst nicht in jedem Bild neu, und es gibt keine Unschärfe-Filter über großen Flächen. Gemessen mit allen Ebenen an: ca. 190 % → 40 % Rechenzeit (Software-Grafik), Pausen-Bildschirm 200 % → 15 %. Für OBS empfohlen:
- Browserquelle **1920 × 1080** (wie die Leinwand), **„Benutzerdefinierte Bildrate“ 30** statt 60 – halbiert die Arbeit, sieht für Karten und Laufband gleich aus.
- In OBS unter *Einstellungen → Erweitert* **„Browserquellen-Hardwarebeschleunigung“ an** lassen.
- **„Quelle herunterfahren, wenn nicht sichtbar“** nur für Quellen, die ihr nicht braucht – das Overlay selbst sollte laufen bleiben (sonst fehlen Alerts).
- Nur die Ebenen einschalten, die ihr im Stream wirklich zeigt; jede ausgeschaltete Ebene kostet nichts.

Das Passwort bleibt nur in diesem Browser; die Verbindung geht direkt an OBS auf `127.0.0.1:4455`, nicht ins Internet. Ohne Verbindung geht es auch: „OBS-Fenster teilen“ zeigt ein geteiltes Fenster (z. B. einen Fenster-Projektor) als Hintergrund der Vorschau, und die Adresse lässt sich kopieren und von Hand als Browserquelle (Breite 1920, Höhe 1080) einfügen.

Das Overlay ist durchsichtig, zu sehen sind nur die Karten. Das Glücksrad taucht nur auf, wenn jemand dreht – per Kanalpunkte oder auf der Webseite –, und verschwindet nach dem Ergebnis wieder (außer mit `always=1`). Für verschiedene Szenen kannst du mehrere Browserquellen mit unterschiedlichen Adressen anlegen.

| Option in der Adresse | Wirkung |
|---|---|
| `wheel=br` / `bc` / `bl` / `tr` / `tc` / `tl` | Glücksrad an (unten rechts, unten Mitte, unten links, oben …) – oder frei wie `wheel=62.5,70` (linke obere Ecke in Prozent; so speichert es das Verschieben in der Vorschau). Fehlt es, ist das Glücksrad aus – wie alle Karten |
| `next=bl` / … | „Als Nächstes“ an (auch frei wie beim Glücksrad) |
| `wsize=120`, `nsize=80` | Größe der Karten in Prozent (50 bis 200); `scale=1.2` gilt für beide |
| `from=twitch` / `web` | nur Kanalpunkte-Drehungen bzw. nur Drehungen auf der Seite zeigen (von der Seite kommen nur Drehungen von Admins ins Overlay) |
| `hold=15` | Sekunden, die das Ergebnis stehen bleibt (3 bis 60) |
| `always=1` | Glücksrad dauerhaft zeigen, zwischen den Drehungen mit „Kanalpunkte einlösen zum Drehen“ |
| `vcolor=0` | Glücksrad in der Akzentfarbe statt in der Farbe der Variante |
| `wlabel=…`, `nlabel=…` | eigene Überschriften der Karten |
| `rotate=20` | Sekunden bis zur nächsten Content-Idee (5 bis 120) |
| `margin=80` | Abstand zum Bildrand in Pixeln |
| `bg=50` | Deckkraft des Kartenhintergrunds in Prozent (0 = nur Schrift) |
| `accent=3ddc84` | Akzentfarbe (Hex ohne `#`) |
| `vol=40` | Lautstärke in Prozent, `0` = ohne Ton |
| `bingo=tr` / … | Bingo-Karte an |
| `bsize=80` | Größe der Bingo-Karte in Prozent |
| `bstyle=classic` / `neon` / `paper` | Design der Bingo-Karte: Klassisch (dunkel), Neon (leuchtende Rahmen) oder Papier (Bingo-Schein mit Stempel) |
| `prank=1` | „Ärgere den Streamer“ an (Würfe und Sounds) |
| `cam=73,72,25,25` | Kamera des Streamers im Bild: links, oben, Breite, Höhe in Prozent – dort landen die Würfe |
| `psize=150` | Größe der Wurfgeschosse in Prozent |
| `quest=tc` / … | Karte „Unangenehme Frage“ an |
| `qsize=120` | Größe der Fragen-Karte in Prozent |
| `shop=tl` / … | Kisten-Shop-Karte an |
| `ssize=120` | Größe der Kisten-Shop-Karte in Prozent |
| `challenge=tl` / … | Win-Challenge-Karte an |
| `csize=120` | Größe der Win-Challenge-Karte in Prozent |
| `alerts=tr` / … | Alerts an (neue Follower, Abos, Resubs, verschenkte Abos) – nur zu sehen, wenn einer kommt |
| `asize=120` | Größe der Alerts in Prozent |
| `recent=tl` / … | Karte „Letzter Follower & letztes Abo“ an (eigene Karte, dauerhaft sichtbar) |
| `rsize=120` | Größe dieser Karte in Prozent |
| `sfollow=gong`, `ssub=…`, `sresub=…`, `sgift=none`, `sbits=…` | Sound je Alert-Art: Soundboard-Sound (`whistle`, `horn`, `gong` …), `a:<pfad>` für einen eigenen Alert-Sound, `c:<pfad>` für einen Sound aus „Ärgere den Streamer“ oder `none`; ohne Angabe der Standardklang |
| `forbid=tr` / … · `fwsize=120` | Verbotenes Wort (Karte) und ihre Größe |
| `subathon=tc` / … · `sasize=120` | Subathon-Timer |
| `pause=1` | Pausen-Bildschirm (ganzes Bild, nur während einer Pause) |
| `scbg=<Datei>` | Hintergrund der Szenen-Bildschirme aus einem Artist-Design (Design-Bibliothek → Von Artists) |
| `scmove=lights` / `stars` / `waves` / `sparks` / `aurora` | Bewegter Hintergrund der Szenen-Bildschirme (Lichter, Sterne, Wellen, Funken, Polarlicht) – nur `transform`/`opacity`, schont OBS |
| `quiz=bl` / … · `qzsize=120` | Quizfrage (nur solange eine läuft) |
| `queue=tl` / … · `qusize=120` | Mitspielen: wer dran ist, wer wartet |
| `tts=bc` / … · `ttsize=120` | Vorlesen – ohne diese Ebene liest das Overlay nichts vor |
| `cards=br` / … · `cdsize=120` | Sammelkarten: epische und legendäre Ziehungen |
| `giveaway=tc` / … · `gwsize=120` | Verlosung: Preis, Befehl, Zeit, Zahl im Lostopf; beim Ziehen die Auslosung |
| `bet=x,y` / … · `btsize=120` | Zuschauer-Wette: Frage, Balken mit Quote, Restzeit; nach der Auflösung Ergebnis und Top 3 |
| `scratch=x,y` / … · `scsize=120` | Rubbellos: jedes `!rubbeln` als Los, das live freigerubbelt wird |
| `pet=1` | Stream-Dino an |
| `dsize=130` | Größe des Dinos in Prozent |
| `pground=edge` | Dino läuft am Bildrand statt oben auf dem Laufband |
| `pclimb=0` | Dino klettert bei Heißhunger nicht an Karten hoch |
| `pscreen=0` | Dino frisst bei Heißhunger keine Löcher in den Bildschirm |
| `chat=tl` / `x,y` | Twitch-Chat an dieser Stelle (Standard im OBS-Dialog: rechts oben, frei verschiebbar) |
| `chsize=120` / `chmax=8` | Größe in Prozent / höchstens so viele Nachrichten (3 – 50) |
| `chstyle=card` / `bubble` / `clean` | Stil des Chats: Karte (Standard), Sprechblasen (jede Nachricht eine Blase mit der Namensfarbe als Akzent) oder Schlicht (nur Text mit Schatten, direkt im Bild) |
| `chh=60` | feste Höhe des Chats in Prozent der Bildhöhe (20 – 95) – neue Nachrichten unten, alte rutschen oben raus, `chmax` gilt dann nicht; ohne Angabe wächst er mit den Nachrichten |
| `chfade=30` | Nachrichten verschwinden nach so vielen Sekunden (Standard 0 = bleiben, bis neue sie verdrängen) |
| `yt=@kanal` | YouTube-Livechat dazumischen (Kanal als `@name` oder Kanal-ID `UC…`) – jede Nachricht bekommt dann das Twitch- bzw. YouTube-Logo |
| `chtw=0` | Twitch-Chat weglassen (nur YouTube) |
| `chcmd=1` / `chbots=1` | Befehle (`!füttern` …) bzw. Bots (StreamElements, Nightbot …) auch zeigen – Standard: ausgeblendet |
| `ticker=bc` / `x,y` | Position des Laufbands (Standard unten Mitte) – das Laufband ist immer an, `ticker=0` blendet es nicht aus |
| `tstyle=bar` / `neon` / `board` | Design des Laufbands: Laufband, Neon oder Bahnhofs-Anzeige (gelbe LED-Schrift) |
| `tsize=120` / `tspeed=70` | Größe in Prozent / Tempo in Pixeln pro Sekunde |
| `test=1` | alle 20 Sekunden eine Probe-Drehung – nur zum Ausrichten, danach wieder entfernen |

**Kamera des Streamers:** Im OBS-Dialog unter „Ärgere den Streamer“ eine Vorlage wählen oder in der Vorschau einen Rahmen um die Stelle ziehen, an der die Kamera im Stream sitzt. In OBS die Browserquelle **über** die Kamera-Quelle schieben, sonst fliegt alles hinter dem Streamer vorbei. Läuft das Overlay in mehreren Browserquellen, bei allen außer einer `prank=0` setzen – sonst kommt jeder Sound doppelt.

**Einmal nötig:** die Migration `supabase/migrations/20260923000000_overlay.sql` im SQL Editor ausführen. OBS hat keine Anmeldung, das Overlay liest deshalb ohne Login. Die Migration gibt dafür genau das frei, was ohnehin im Stream zu sehen ist: Kacheln, Glücksrad-Varianten und einen Feed der Drehungen (`overlay_spins`, ohne Nutzer-IDs). Fehlt sie, weist der OBS-Dialog darauf hin.

### Lautstärke je Ebene

Alles, was im Overlay Töne macht, hat im OBS-Fenster unter **„Aussehen & Ton“ → 🎚️ Lautstärke je Ebene** einen eigenen Regler: Glücksrad, Alerts, Würfe & Sounds, Dino, Fragen, Bingo, Kisten-Shop, Win-Challenge, Vorlesen, Quiz, Verbotenes Wort, Subathon, Pause, Sammelkarten und Verlosung. 100 % = so laut wie die Gesamtlautstärke, 0 % = stumm (🔇), bis 200 % lauter. Regler ausgeschalteter Ebenen sind abgeblendet. Wie alles andere gilt die Änderung nach wenigen Sekunden in OBS (Parameter `vwheel`, `valert`, `vprank`, `vpet`, `vquest`, `vbingo`, `vshop`, `vchal`, `vtts`, `vquiz`, `vforbid`, `vsub`, `vpause`, `vcards`, `vgive`). Keine Migration nötig.

### Emote-Regen

OBS-Editor → „Bei Aktion“ → **Emote-Regen** (`erain=1`, `js/overlay-emoterain.js`): Emotes aus dem Twitch-Chat regnen übers ganze Bild. Das Overlay liest den Chat dafür nur mit – kein Bot, keine Datenbank, keine Migration nötig.

- **`!regen`** (Befehl änderbar): Die Emotes aus der Nachricht regnen – ohne Emote die zuletzt im Chat benutzten. Einstellbar: wer darf (alle / Abonnenten, VIPs, Mods / nur Mods) und die Pause dazwischen. Streamer und Mods dürfen immer.
- **Emote-Combo:** Schreibt der Chat dasselbe Emote oft genug innerhalb von 8 Sekunden („Combo ab“, 0 = aus), regnet es von selbst.
- Optional fällt zu **jedem Emote** im Chat eins herunter; dazu Menge und Größe.
- Im Dashboard erklärt die Kachel **„Emote-Regen“** (Kategorie Overlay) den Befehl für Zuschauer; Streamer und Mods kommen von dort in den OBS-Editor. Die Kachel bringt die Migration `…_bet_scratch.sql` mit.
- In Modulen gehört die Ebene zu **🔔 Alerts & Ziele** – sie regnet nur in der Quelle, die sie enthält.
- Parameter: `ercmd`, `erwho=all|subs|mods`, `ercool` (Sekunden), `ercombo`, `erall=1`, `ermax`, `ersize`. Mit `test=1` regnet es alle paar Sekunden zur Probe.

### Chat im Overlay (Twitch + YouTube)

Im OBS-Dialog unter „Immer im Bild“ → **Chat (Twitch + YouTube)** einschalten: Der Chat des Kanals läuft als Karte im Bild mit – mit Emotes, Namensfarben und Abzeichen (Streamer, Mod, VIP, Abo bzw. YouTube-Mitglied). Löschen Mods eine Nachricht oder sperren jemanden, verschwindet sie auch im Overlay. Befehle und bekannte Bots sind standardmäßig ausgeblendet; Größe, Zeilenzahl und Ausblenden stehen beim Chat im OBS-Dialog. Ohne Nachrichten ist die Karte unsichtbar.

- **Twitch:** Das Overlay liest den Chat **anonym** über Twitchs Chat-Schnittstelle mit (wie ein ausgeloggter Zuschauer) – kein Login, kein Bot. Der Kanal kommt aus `CHANNEL` in `js/config.js`.
- **YouTube:** Ist der YouTube-Kanal unter „Twitch-Verbindung → YouTube“ verbunden, kommt der Chat der laufenden Sendung von selbst dazu (siehe „YouTube mit Twitch live schalten“). Sonst im Feld **YouTube** den Kanal eintragen (`@Kanalname`). Sobald dort ein Livestream läuft, kommen die Nachrichten dazu – gemischt mit Twitch, vor jedem Namen das Logo der Plattform; Super Chats mit Betrag, neue Mitglieder hervorgehoben. Läuft kein Stream, schaut das Overlay jede Minute wieder nach. Weil der Browser YouTube nicht direkt abfragen darf, holt die Edge Function `youtube-chat` die Nachrichten (wird mit den anderen Functions automatisch deployt). **Kein API-Schlüssel nötig** – sie liest den Chat so, wie ihn das Chat-Fenster auf youtube.com lädt. Das ist inoffiziell: Ändert YouTube etwas daran, muss die Funktion angepasst werden.

**Logo und Verbindung im Bild:** Vor jedem Namen steht das Logo der Plattform, bei Twitch-Nachrichten das Twitch-Logo, bei YouTube-Nachrichten das YouTube-Logo. Oben in der Chat-Karte zeigt je ein kleines Schild, ob die Verbindung steht:
- **Twitch:** 🟢 verbunden, 🟡 verbindet … oder 🔴 getrennt (es wird automatisch neu verbunden).
- **YouTube:** 🟢 live, ⚪ wartet auf Stream oder 🔴 keine Verbindung.

Beides lässt sich im OBS-Dialog beim Chat abschalten (Parameter `chplat=0` bzw. `chstat=0`). Mit Verbindungsanzeige bleibt die Karte auch ohne Nachrichten sichtbar.

Es wird nichts gespeichert, keine Migration nötig.

### Alerts für Follower, Abos und Bits

Zwei eigene Bausteine, im OBS-Dialog einzeln ein- und ausschaltbar, verschiebbar und in der Größe einstellbar:
- **Alerts:** Kommt ein neuer Follower, ein Abo, ein Resub (mit Monaten und Nachricht), werden Abos verschenkt oder Bits gecheert (mit Anzahl und Nachricht), springt die Karte mit Animation, Konfetti und Klang auf und zeigt den Namen ein paar Sekunden groß. Dazwischen ist sie unsichtbar. Kommen mehrere gleichzeitig, laufen sie nacheinander.
- **Letzter Follower & Abo:** kleine Karte, die immer den letzten Follower, das letzte Abo und die letzten Bits zeigt.

**🎨 Design-Bibliothek:** Im OBS-Editor die Ebene **Alerts** anklicken – rechts im Inspektor stehen alle Designs mit Mini-Vorschau: Klassik, Neon, Banner, Comic, Glas, Minimal, Arcade, Glitch, Hype und Gold. Ein Klick wählt das Design, die Vorschau zeigt es sofort, OBS übernimmt es nach wenigen Sekunden (Parameter `alook`). Die Farbe je Alert-Art (Follow lila, Abo gold, Bits blau) bleibt erhalten. Neue Designs kommen in `ALERT_LOOKS` (`js/alerts.js`) und als `.ov-alert[data-look="…"]` in `css/overlay.css` dazu – die Bibliothek wächst einfach mit.

**🎨 Alert-Designer (wie bei StreamElements):** Im Dashboard unter **🔔 Alerts** gestaltest du jede Alert-Art einzeln – Follower, Abo, Resub, verschenkte Abos, Bits und Kanalpunkte:
- **Fertige Designs:** 14 komplette Vorlagen (Lila Party, Sternstunde, Neon-Herz, Arcade, Comic, Königlich, Hype-Rakete, Stromschlag, Feuer, Diamant, Bescherung, Eiskalt, Champion, Schlicht) – ein Klick setzt Design, Bild, Animationen und Farbe; auf Wunsch für alle Alert-Arten auf einmal.
- **Bild, GIF oder Video:** 13 eingebaute animierte Bilder (`assets/alerts/*.svg`) oder eigene Dateien hochladen (PNG, JPG, GIF, WebP, WebM, MP4 – höchstens 10 MB, bis zu 40 Stück). Videos laufen bis zum Ende (höchstens 30 Sekunden), auf Wunsch mit Ton.
- **Texte:** drei Zeilen mit Platzhaltern `{name}`, `{amount}`, `{months}`, `{tier}`, `{message}`, `{reward}` – leer lassen heißt Standardtext. Platzhalter werden in der Farbe hervorgehoben. Namen und Nachrichten von Zuschauern landen nur als Text im Overlay, nie als HTML.
- **Textanimation** (Welle, Hüpfen, Wackeln, Leuchten, Schreibmaschine, Gummi, Regenbogen), **Einblenden** (Aufploppen, Reinschieben, Von oben fallen, Heranzoomen, Einblenden, Umdrehen, Wirbeln), **Layout** (Bild oben, Bild links, Bild als Hintergrund), **Dauer** (3–30 Sekunden), Bildgröße, Farbe, Konfetti und Sound.
- **Varianten nach Menge:** Für Bits, verschenkte Abos, Resubs (Monate) und Kanalpunkte eigene Designs ab einer Menge – z. B. ab 1000 Bits ein anderes Bild und ein anderer Sound. Es gilt die Variante mit der größten passenden Menge.
- **Werkzeuge:** Mit der Maus über einem fertigen Design spielt es sofort in der großen Vorschau (übernommen wird erst beim Klick). Die **Zeitleiste** „Ablauf“ zeigt Ein – Halten – Aus auf einer Skala bis 30 Sekunden; am Balken ziehen ändert die Dauer, beim Abspielen läuft ein gelber Strich mit. Unter dem Sound steht seine **Wellenform** mit Länge. **🎲 Würfeln** stellt ein zufälliges Design zusammen (Look, Layout, Einblenden, Textanimation, Bild, Farbe).
- **Live-Vorschau** direkt daneben; „▶ Abspielen“ zeigt den Alert mit der eingestellten Menge. Nach **Speichern** gelten die Designs sofort in allen OBS-Quellen, ohne Neuladen.

Die Design-Bibliothek im OBS-Editor (`alook`) ist das **Grund-Design**, das der Designer übernimmt, solange eine Alert-Art „wie im OBS-Fenster“ steht. Gestalten dürfen der Streamer, Admins und freigegebene Mods. Einmal nötig: Migration `20261018000000_overlay_designs.sql` (Tabellen `alert_config` und `alert_media`, Bucket `alert-media`) – ohne sie laufen die Alerts wie bisher.

**📖 Anleitung „In OBS einrichten“:** Beim ersten Öffnen des OBS-Editors erklärt ein Dialog Schritt für Schritt mit Bildern aus OBS, wie die Browserquelle angelegt wird: Adresse kopieren (direkt im Dialog) → Quellen **+** → **Browser** → Name „StreamHelp“ → URL, **1920 × 1080**, „Audio über OBS steuern“ an, „Quelle herunterfahren, wenn nicht sichtbar“ aus → ganz nach oben schieben → in weiteren Szenen „Vorhandene hinzufügen“. Im letzten Schritt prüft die Seite live, ob sich OBS meldet (`obs_status`, Migration `20261119000000_obs_sound_pause.sql`). Mods bekommen die Anleitung nicht von selbst, und wenn OBS sich schon meldet, bleibt sie zu. Jederzeit wieder: **Steuerung → In OBS einrichten**. Code: `js/obs-setup.js`.
- Die Bilder (`assets/obs-guide/*.webp`) sind OBS 30 (deutsch, Theme Yami) nachgebaut: `tools/obs-guide/mock.html` im Browser öffnen bzw. per Playwright je Rahmen (`#m1` … `#m7`) als Bild speichern. Echte OBS-Screenshots einfach unter denselben Dateinamen ablegen (16:10, z. B. 1440 × 900).

**🧩 Link zur Twitch-Erweiterung:** Der Knopf **Twitch-Erweiterung** im Dock „Steuerung“ öffnet die Seite der Erweiterung im Creator-Dashboard (`dashboard.twitch.tv/extensions/<ID>-<Version>`), dort lässt sie sich installieren und aktivieren. ID und Version stehen in `js/config.js` (`TWITCH_EXTENSION_ID`, `TWITCH_EXTENSION_VERSION`) – **nach einer neuen Version bei Twitch die Versionsnummer dort anpassen.**

**Werkzeuge im OBS-Editor:**
- **🖥️ Vorschau** und **🎛️ Ebenen** oben in der Kopfzeile klappen die Bereiche ein und aus (nie beide zugleich, wird gemerkt).
- **Ebenen suchen** und **nur aktive** zeigen: Suchfeld über der Ebenenliste.
- **Rückgängig** mit **Strg+Z**, wiederholen mit **Strg+Umschalt+Z** (oder ↶/↷ oben); **Verlauf** zeigt die letzten 40 Änderungen mit Uhrzeit („Fortnite-Bingo an“, „Größe · Alerts“, „Chat verschoben“) – ein Klick springt dorthin. Rückgängig wird wie jede Änderung live gespeichert.
- **▶ Testen** im Inspektor jeder Ebene führt sie in der Vorschau vor: Alerts spielen nacheinander jede Art, das Glücksrad dreht, Würfe fliegen, der Chat schreibt, das Haustier tanzt, hüpft oder versteckt sich; andere Karten blinken kurz auf.
- **Mods** sehen die Anleitungen „So geht das Verbinden“ und „Ohne Verbindung von Hand einrichten“ nicht – OBS richtet der Streamer ein.

**Animationen im Overlay:** Alerts kommen in 560 ms federnd und aus der Unschärfe herein (ohne eigene Textanimation rollen die Buchstaben 30 ms versetzt ein), eine dünne Linie unten läuft als Zeitleiste ab, und sie gehen in 360 ms nach oben unscharf weg. Während ein Alert läuft, hält das Laufband an und tritt zurück. Chat-Nachrichten federn herein. Das Haustier reagiert: Bei Abos tanzt es, bei Followern und Bits hüpft es, bei der Atombombe (und der Blendgranate) aus „Ärgere den Streamer“ duckt es sich weg. Der Szenen-Bildschirm öffnet sich als Kreis aus der Mitte (900 ms); läuft der Countdown von *Gleich geht's los* ab, geht „Jetzt live“ genauso auf (bei *Bin gleich zurück*: „Wieder da“).

Unter **🔔 Alert-Sounds** (im OBS-Dialog) stellst du pro Alert-Art den Ton ein: Standard, kein Ton, ein eigener Alert-Sound, ein Sound vom Soundboard oder ein Sound aus „Ärgere den Streamer“ – mit ▶ zum Anhören. **Eigene Alert-Sounds** laden Admins direkt dort hoch (MP3, OGG, WAV, M4A, höchstens 4 MB und 20 Sekunden, bis zu 30 Stück). Der Alert bleibt stehen, solange sein Sound läuft. Sie liegen getrennt von den Zuschauer-Sounds, Zuschauer können sie also nicht per Kanalpunkte abspielen. Wird ein Sound gelöscht, bekommt die Alert-Art wieder den Standardklang. Admins und Mods schicken im Dashboard unter **🔔 Alerts** Probe-Alerts in alle OBS-Quellen (Probe-Alerts zählen nicht als „letzter Follower“).

Einmal nötig: Migration `20261005000000_stream_alerts.sql` ausführen und **der Streamer muss Twitch einmal neu verbinden** (Seitenleiste → Twitch-Verbindung) – für Follower und Abos braucht die Seite die neuen Berechtigungen `moderator:read:followers` und `channel:read:subscriptions`. Danach meldet Twitch die Ereignisse an `twitch-eventsub`; die Abos dafür legt die Seite selbst an (auch beim Klick auf „Auf Twitch übernehmen“ im Ärgern-Dialog). Der Gesundheitscheck unter **🔔 Alerts** zeigt, ob die Rechte schon da sind.

**Kommen echte Alerts nicht an** (Probe-Alerts gehen aber)? Im Dashboard unter **🔔 Alerts** auf **„Jetzt prüfen & reparieren“**: Fehlende oder von Twitch abgeschaltete Abos (z. B. nach Zustellfehlern) legt die Seite sofort neu an; die Liste zeigt je Art ✓ aktiv, … wird freigeschaltet oder ✕ mit der genauen Meldung. Fehlen Rechte, steht dort „Twitch neu verbinden“. Das passiert auch automatisch (siehe „Twitch-Gesundheitscheck“).

**Bits und eigene Alert-Sounds:** Einmal nötig: Migrationen `20261009000000_alert_bits_sounds.sql` und `20261010000000_alert_sound_length.sql` (20 Sekunden, 4 MB) ausführen und **der Streamer verbindet Twitch noch einmal neu** – für Bits braucht die Seite das Recht `bits:read`.

### Design-Bibliothek

Im Dashboard unter **Design-Bibliothek** (Streamer, Admins, freigegebene Mods) stehen alle Looks an einem Ort (`js/library.js`):

- **Drei Arten** als Karten oben (Klick filtert): **Komplett-Looks** (30 Pakete aus `js/theme-packs.js` – Overlay, Kamera-Rahmen, Alerts, Chat, Laufband, Bingo und fünf Szenen), **Overlays** (die 24 Designs fürs ganze Overlay) und **Alerts** (die 30 fertigen Alert-Designs). Eigene Entwürfe, keine fremden Grafiken.
- **Neu dazu:** *Lo-Fi & Chill* (Regen am Fenster, Lampenlicht, Schallplatte), *Manga-Panel* (Panel-Rahmen, Rasterpunkte, Speedlines, Kirschblüte), *Cyberpunk-City* (Neonstadt bei Regen, abgeschrägte Ecken, Chip-Alert) und die Saison-Looks *Valentinstag*, *Osterwiese*, *Sommerabend* und *Silvester* – jeweils mit eigenem Overlay-Design, Szenen-Hintergrund (`assets/bg-<design>.svg`) und Alert-Bild (`assets/alerts/`). Alles eigene Entwürfe, keine fremden Figuren oder Marken.
- **Große Vorschau** (`overlay.html` im iframe) mit den Szenen **Gameplay**, **Gleich live**, **Pause**, **Just Chatting**, **Stream-Ende** und **Alerts** (Alert-Art wählbar, „Abspielen“). **Vorher / Nachher** legt deine aktuellen Einstellungen und das gewählte Design übereinander – mit dem Regler verschiebst du die Trennlinie. Der Knopf oben rechts zeigt die Vorschau im **Vollbild**; dort blättern die Pfeiltasten durch die Designs.
- Daneben: Art, Stimmung, „Neu“/„Beliebt“, **Das ändert sich** (welche Teile das Design setzt) und der Knopf zum Übernehmen. Bei Komplett-Looks stehen darunter die OBS-Adressen je Szene zum Kopieren (`overlay.html?live=1&scene=start|brb|chat|end`).
- **Galerie** darunter: Art (Alle, Komplett-Looks, Overlays, Alerts), **Stimmung** (Gaming, Gemütlich, Bunt & verspielt, Sci-Fi, Natur, Fantasy & Horror, Retro, Edel, Minimal, Saisonal), Suche, Sortierung (Beliebt, Neu, A – Z) und **Favoriten** (Herz an jeder Kachel; merkt sich dieser Browser). Was gerade gilt, trägt „✓ Aktiv“.
- **Übernehmen:** *Look installieren* setzt Overlay-Design, Kamera-Rahmen, Laufband, Chat-Stil, Bingo-Karte und das Alert-Design (für alle Alert-Arten) in einem Schritt und speichert alles – welche Ebenen an sind und wo sie stehen, bleibt. *Fürs Overlay übernehmen* speichert nur das Overlay-Design (OBS mit `live=1` zeigt es sofort). *Für alle Alerts übernehmen* setzt Look, Bild, Farbe und Animationen bei allen Alert-Arten (Texte, Sounds und Varianten bleiben) und öffnet den Alert-Designer – dort prüfen und **Speichern**.

### Overlay-Design, Szenen, Kamera-Rahmen, Info-Leiste und Ziel-Balken

- **Design des ganzen Overlays:** OBS-Editor → „Aussehen & Ton“ → 🎨: Standard, Neon, Glas, Gamer, Arcade, Gold, Candy, Minimal, Weltraum, Sci-Fi-HUD, Kawaii, Horror, Wald, Fantasy, Ozean, Halloween, Weihnachten, Lo-Fi, Manga, Cyberpunk, Valentinstag, Ostern, Sommer oder Silvester. Die 16 neueren Designs haben eigene Szenen-Hintergründe. Gilt für alle Karten, das Laufband und den Kamera-Rahmen; Alerts, Bingo, Chat und Laufband mit eigenem Stil behalten ihn (Parameter `otheme`).
- **Szenen-Bildschirm** (Gruppe „Stream-Grafiken“): füllt das ganze Bild hinter allen Karten – 🚀 *Gleich geht's los* mit Countdown bis zu einer Uhrzeit, ☕ *Bin gleich zurück* (auch mit Countdown) 💜 *Danke fürs Zuschauen* mit den letzten Unterstützern und 💬 *Just Chatting*: große Kamera mit Rahmen links (der Hintergrund lässt die Kamera frei), Chat oben rechts – Spiel-Ebenen wie Glücksrad oder Bingo bleiben dort weg. Überschrift und Zeile darunter sind frei. Tipp: Mit den Knöpfen „📋 Start-/Pause-/Ende-/Chatting-Quelle“ bekommt jede OBS-Szene eine eigene Browserquelle (`overlay.html?live=1&scene=start`) – dann schaltest du nur noch die OBS-Szene um.
- **Kamera-Rahmen:** Rahmen um die Kamera (Leuchten, Schlicht, Nur Ecken, Neon) mit Namensschild. Der Bereich ist derselbe rote Rahmen wie bei „Würfe & Sounds“.
- **Info-Leiste:** letzter Follower, letztes Abo, letzte Bits, Zuschauerzahl und „Live seit“ – was davon zu sehen ist, wählst du per Häkchen.
- **Ziel-Balken:** Follower-, Abo- oder Bits-Ziel mit Titel, Zielwert und Startdatum (ohne Datum: letzte 30 Tage). Der Balken füllt sich bei jedem neuen Alert und feiert, wenn das Ziel erreicht ist. Probe-Alerts zählen nicht.

Zuschauerzahl und Laufzeit schreibt die Watchtime-Zählung mit (jede Minute, solange der Stream läuft). Einmal nötig: Migration `20261018000000_overlay_designs.sql` (`goal_progress()`, `stream_live_info()`) – ohne sie bleiben Ziel und Zuschauerzahl bei 0 bzw. „offline“, alles andere geht auch so.

### Laufband

Unten im Overlay laufen langsam von rechts nach links weitere Seiten und Socials durch (z. B. Twitch, YouTube, TikTok, die StreamHelp-Seite). Das Laufband ist immer da und lässt sich nicht ausschalten, aber in der Vorschau des OBS-Dialogs verschieben; Design (Laufband, Neon, LED-Anzeige), Größe und Tempo stehen im Dialog. Die Texte pflegen Admins im OBS-Dialog unter **📢 Laufband-Texte bearbeiten** (eine Zeile pro Eintrag, `{seite}` = Adresse dieser Webseite, `{kanal}` = Twitch-Name des Streamers). Für bekannte Plattformen – Twitch, YouTube, TikTok, Instagram, Discord, X, Kick, Spotify, Steam, Facebook, Threads, Bluesky, Reddit, Patreon, Ko-fi, PayPal, Streamlabs, Snapchat, WhatsApp, Telegram, GitHub – steht automatisch das echte Logo davor (Simple Icons, CC0); es reicht die Adresse, z. B. `youtube.com/@kanal`. Änderungen laufen sofort in allen OBS-Quellen. Einmal nötig: Migration `20260929000000_ticker.sql` – ohne sie läuft das Band mit Twitch und der StreamHelp-Seite.

## Ärgere den Streamer

Kachel bei den Content-Ideen, jederzeit verfügbar. Einmal nötig: `supabase/migrations/20260924000000_pranks.sql` im SQL Editor ausführen. Das legt die Kachel an, die Tabellen und den Storage-Bucket `sounds` für eigene Sounds.

- **Kanalpunkte:** Beim Verbinden mit Twitch (und bei jedem Speichern der Einstellungen) legt die Seite im Kanal des Streamers zwei Belohnungen an: **„🍅 Wirf was auf ‹Kanal›“** (Standard 500 Punkte) und **„🔊 Sound für ‹Kanal›“** (300 Punkte). Zuschauer tippen beim Einlösen ein, was fliegen bzw. welcher Sound laufen soll – Tippfehler und Emojis werden erkannt. Unbekanntes gibt die Punkte zurück, der Chat-Bot sagt, was es gibt. Die Webseite zeigt Zuschauern die Liste zum Kopieren und eine Vorschau; direkt auslösen können dort nur Admins. Migration `20260925000000_channel_points.sql` nötig; bei Belohnungen, die schon vorher bestanden, einmal im Dialog „Auf Twitch übernehmen“ klicken.
- **Sound auswählen auf Twitch:** Jeder Sound hat eine **Nummer** – 1–9 die eingebauten, ab 10 die eigenen (der älteste zuerst); sie steht auf der Webseite am Sound. Bei „🔊 Sound für ‹Kanal›“ reicht die Nummer (`3`, `#3`, `Nr. 3`), der Name geht weiter, auch mit Tippfehlern (`trillerpfiefe`) oder nur einem Teil (`violin` → „Sad Violin“). **`zufall`** (oder `random`, `?`) spielt irgendeinen Sound. **`!sounds`** im Chat schreibt die nummerierte Liste (höchstens alle 30 Sekunden, nur solange das Ärgern an ist; braucht den Chat-Bot).
- **Eigene Belohnung pro Sound (⚡):** Im Dialog unter „Für Admins → ⚡ Sounds mit eigener Belohnung“ Sounds anhaken und den Preis setzen – dann gibt es auf Twitch z. B. **„🔊 Tröte“**, und Zuschauer lösen ein, **ohne etwas einzutippen**. Höchstens 20 (Twitch erlaubt 50 Belohnungen pro Kanal, inklusive Glücksrad & Co.). Ausschalten oder den Sound löschen räumt die Belohnung auf Twitch weg; Twitch trennen schaltet sie nur aus. Einmal nötig: Migration `supabase/migrations/20261024000000_sound_rewards.sql` ausführen.
- **Werfen:** Banane, Tomate, Torte, Ei, Fisch, Quietscheente, Stinkesocke, Schneeball, rote Unterhose, Nuke (mit Explosion und Rauchpilz), Flashbang (der ganze Bildschirm wird für ein paar Sekunden weiß – ein einzelner Blitz, kein Flackern) – oder Blumen, wenn man nett sein will. Im Overlay fliegt das Geschoss auf Kamera des Streamers und hinterlässt einen Fleck.
- **Sounds:** neun eingebaute Töne (vom Browser erzeugt, keine Dateien) und eigene Sounds. Hochladen darf jeder Angemeldete bis zu 8 Sounds, je höchstens 10 Sekunden und 1 MB (MP3, OGG, WAV, M4A). Löschen kann man die eigenen, Admins alle.
- **💻 Overlay-Hack (nur Mods):** Nur der Streamer, Admins und freigegebene Mods sehen im Dialog „Hack starten“ – nicht per Kanalpunkte. Dann übernimmt der Hacker *0xNULL* für knapp eine Minute **das ganze Bild**: Glitches und Wackeln auf allen Karten, Terminal und Hexdump, gestörte Kamera („Signal abgefangen“), Warnungen, „Zugriff verweigert“-Pop-ups und zum Schluss „Overlay geklaut“ mit Fortschrittsbalken. Tippt irgendwer im Twitch-Chat **`!firewall`**, fegt die Firewall alles weg (mit Dank an den Retter); sonst springt bei 100 % die Notfall-Firewall an. „🛡️ Firewall“ im Dialog beendet ihn sofort. Läuft in allen OBS-Quellen mit der Ebene „Würfe & Sounds“, Lautstärke über deren Regler. Design nach dem Claude-Design-Entwurf „Overlay Hack“. Einmal nötig: Migration `20261019000000_overlay_hack.sql`.
- **🎂 Kanal-Jubiläum (nur Mods):** Im selben Mod-Bereich startet „Jubiläum starten“ einen zweiminütigen Film über das ganze Bild (nach dem Claude-Design „1 Jahr Kanal v2“): Tage und Jahre auf Twitch, „Tag 1“ mit Profilbild, der Kanal in Zahlen, die Content-Ideen, die Community, die Mods, Jahr 2 mit dem nächsten Termin und ein Finale mit Konfetti. **Alle Daten kommen automatisch vom verbundenen Kanal**: Die Edge Function `stream-tools` (`action: "anniversary"`) holt beim Start Name, Login, Profilbild, „auf Twitch seit“, Follower, Mods und den nächsten Termin aus dem Twitch-Zeitplan. Aus der Datenbank kommen die gemeinsame Watchtime, die treuesten Zuschauer, Bits und Abos seit StreamHelp sowie die freigeschalteten Content-Ideen. In den Zahlen stehen nur Werte über 0. Ohne Mods dankt der Film den Stammgästen, ohne Termin fällt die Karte weg. Der Chat läuft live mit: Was die Zuschauer während des Films schreiben, erscheint in der Community-Szene. Statt „auf Twitch seit“ kann man ein eigenes Datum eintragen, z. B. den ersten Stream. „⏹️ Film beenden“ stoppt ihn. Einmal nötig: Migration `20261020000000_channel_anniversary.sql` (die Edge Functions deployen sich beim Merge).
- **Für Admins** im Dialog: Belohnungen an/aus, Kosten, Abklingzeit auf Twitch (Standard 20 Sekunden), eigene Sounds erlauben, Startdatum. „Auf Twitch übernehmen“ gleicht die Belohnungen an; vor dem Startdatum sind sie auf Twitch aus – danach beim nächsten Öffnen des Dialogs durch einen Admin automatisch an.

Direkt von der Webseite lässt die Datenbank nur Admins werfen (`send_prank`); alle anderen gehen über Kanalpunkte (`twitch-eventsub`). Der Feed `pranks` enthält nur Anzeigename, Gegenstand und Sound – keine Nutzer-IDs –, damit OBS ihn ohne Anmeldung lesen kann.

## Fortnite-Bingo

Kachel bei den Content-Ideen. Einmal nötig: `supabase/migrations/20260924120000_bingo.sql` im SQL Editor ausführen. Das legt die Kachel an, die Tabellen und den Storage-Bucket `bingo`.

1. Auf der Webseite als Admin die Kachel **Fortnite-Bingo** öffnen.
2. Rechts unter **Bilder** Bilder der Items wählen – mehrere auf einmal gehen. Der Name kommt aus dem Dateinamen (`chug-jug.png` → „Chug Jug“) und lässt sich danach ändern. Die Bilder werden vor dem Hochladen verkleinert.
   Jedes Bild kann eine **Seltenheit** wie in Fortnite haben – Gewöhnlich (grau), Ungewöhnlich (grün), Selten (blau), Episch (lila), Legendär (gold), **Mythisch** (gold mit Glanz) oder Exotisch. Steht sie im Dateinamen (`scar_legendary.png`, `pump-episch.png`, `mythic_goldfish.png`), wird sie gleich erkannt; sonst in der Liste neben dem Bild wählen. Items ohne Seltenheit (z. B. Heilung) bekommen eine bunte Farbe, die es bei Waffen nicht gibt. Migration `20260925120000_bingo_rarity.sql` nötig.
   Außerdem kann im Icon eine **Zahl** stehen – z. B. das Kill-Symbol mit „5“ für 5 Kills. Aus dem Dateinamen erkannt (`kill_5.png`, `elim x10.png`) oder im Feld „Zahl“ neben dem Bild eintragen. **⧉** kopiert ein Bild mit anderer Zahl, so gibt es das Kill-Symbol für 3, 5 und 10 Kills. Migration `20260926000000_bingo_amount.sql` nötig.
   **Ein Bild → alle Seltenheiten:** Über dem Hochladen-Knopf die Seltenheiten anhaken (Schnellwahl **Grün bis Gold**, **Grau bis Gold**). Dann wird aus jedem gewählten Bild ein Item pro Seltenheit – gleicher Name, gleiches Bild, Rahmen in der passenden Farbe. Ohne Haken kommt die Seltenheit wie bisher aus dem Dateinamen.
   **🔒 Tresor:** Items, die gerade nicht aufs Bingo sollen (z. B. nicht mehr im Spiel), legt ein Admin mit 🔒 in den Tresor. Sie kommen auf keine neue Karte – weder die Stream-Karte noch die eigenen –, bleiben aber gespeichert und stehen unten in der Liste unter „Tresor“. 🔓 holt sie zurück. Löschen (🗑) entfernt Item und Bild für immer.
3. Größe wählen und **Neue Karte ziehen**. Für 5×5 mit freier Mitte braucht es 24 verschiedene Items, für 4×4 16, für 3×3 8.
   **Keine Dopplungen:** Auf jeder Karte steht jeder Item-Name nur einmal – dieselbe Waffe in einer anderen Seltenheit zählt als dasselbe Item. Und jedes Bild nur einmal: Kopien (⧉) und dieselbe Datei erkennt die Seite an einem Fingerabdruck der Datei (SHA-256, beim Hochladen berechnet). Die Zahl neben „Bilder“ zeigt, wie viele verschiedene Items es gibt.
4. Im Stream die gefundenen Items auf der Karte anklicken. Eine volle Reihe, Spalte oder Diagonale zeigt „Bingo!“ – auf der Seite und im Overlay, mit Applaus.

Zuschauer sehen die Stream-Karte nur an. Unter **Meine Karte** zieht sich jeder seine eigene Karte aus denselben Bildern und kreuzt selbst ab (gespeichert in `bingo_player_cards`, nur für einen selbst sichtbar). **Im Stream zeigen** blendet die Stream-Karte im Overlay aus und ein, **Haken entfernen** fängt dieselbe Karte neu an.

Im OBS-Dialog unter **🎨 Bingo-Design** gibt es drei Looks für die Karte im Overlay: **Klassisch**, **Neon** und **Papier**.

### Lootpool entfernt, Tresor neu

Den automatischen Abgleich mit dem Fortnite-Lootpool (api-fortnite.com) und die eingebaute Item-Liste gibt es nicht mehr – ins Bingo kommen nur noch hochgeladene Bilder. Einmal nötig:
1. Migration `supabase/migrations/20261022000000_bingo_vault.sql` im SQL Editor ausführen. Sie löscht die Lootpool-Items und alles, was dazugehörte (Tabelle `bingo_loot_state`, Spalten `source`, `loot_id`, `active`, `hidden`), und legt den Tresor (`vault`) und den Fingerabdruck (`image_key`) an. Die alte Migration `…_bingo_lootpool.sql` braucht es nicht mehr. Hinweis: Steht auf der aktuellen Stream-Karte noch ein Lootpool-Item, fehlt dort nur das Bild – einfach eine neue Karte ziehen.
2. Die Edge Function `bingo-loot` löscht die GitHub Action beim nächsten Merge in Supabase. Das Secret `API_FORTNITE_KEY` (und `FORTNITEAPI_IO_KEY`) kann in Supabase unter **Edge Functions → Secrets** weg.

### Tipprunde mit Kanalpunkten

Die Zuschauer tippen, welche Reihe auf der Stream-Karte zuerst voll wird – wer richtig liegt, bekommt Kanalpunkte. Das läuft über eine **Twitch-Vorhersage** (Prediction): Die Zuschauer setzen ihre Punkte im Chat, die Gewinner teilen sich die Punkte der anderen. Einen festen Bonus aus dem Nichts kann eine App auf Twitch nicht vergeben.

1. Karte ziehen, im Bingo-Dialog unter **🎯 Tipprunde** die Zeit zum Tippen wählen und **Tipprunde starten**. Die Vorhersage erscheint oben im Chat, der Chat-Bot kündigt sie an.
2. Auf der Karte stehen jetzt Nummern (Reihe 1–5) und Buchstaben (Spalte B-I-N-G-O bzw. A, B, C …) – im Overlay mit Countdown. Bei 3×3 und 4×4 kann man auch auf die Diagonalen tippen; bei 5×5 nicht, weil Twitch höchstens 10 Antworten erlaubt.
3. Erst nach Ablauf der Tippzeit Items abhaken. Wird eine getippte Reihe voll, löst die Seite die Vorhersage von selbst auf und die Punkte werden verteilt.
4. **Abbrechen** oder eine neue Karte ziehen gibt allen ihre Punkte zurück.

Einmal nötig: Migration `20260926120000_bingo_bet.sql` ausführen, die Edge Function `bingo-bet` deployen (geht automatisch beim Merge) und **der Streamer muss Twitch einmal neu verbinden** – für Vorhersagen braucht die Seite die neue Berechtigung `channel:manage:predictions`. Vorhersagen gibt es nur für Affiliates und Partner.

## Unangenehme Fragen

Zuschauer schreiben auf der Webseite Fragen an den Streamer (höchstens 3 pro Tag, auf Wunsch „anonym im Stream“). Jede Frage landet erst bei den Admins:

1. Im Dialog **Unangenehme Fragen** unter „Zu prüfen“ **Freigeben** oder **Ablehnen**. Neue Fragen melden sich bei Admins mit einer Nachricht.
2. Unter „Freigegeben“ **▶ Im Stream zeigen** – die Frage erscheint groß im OBS-Overlay (mit Gong).
3. Der Streamer antwortet → **✅ Beantwortet** (Applaus). Kneift er → **😈 Bestrafung ziehen**: Die Datenbank lost eine Strafe aus der Liste aus, sie steht im Overlay (mit Buzzer). **⏭ Überspringen** geht auch.
4. **Ausblenden** nimmt die Karte aus dem Bild.

Die Bestrafungen bearbeiten Admins im selben Dialog (eine pro Zeile). Zuschauer sehen nur ihre eigenen Fragen und deren Stand; den echten Namen hinter „Anonym“ sehen nur Admins.

## Stream-Haustier (Stream-Dino)

**Tier des Kanals:** Rexi bekommt Gesellschaft – der Streamer wählt im Haustier-Dialog (Kachel) oder im OBS-Fenster bei der Ebene **„Haustier“** unter **Tier & Entwicklung** das Tier: **Dino** (Rexi), **Katze** (Mimi, Schnurrhaare, schwingt den Schwanz), **Fuchs** (Fipsi, Buschschwanz), **Axolotl** (Axel, wehende Kiemen), **Pinguin** (Pino, watschelt) oder **Drache** (Funki, schlägt mit den Flügeln und spuckt beim Brüllen Feuer). Alle Tiere nutzen Rexis Gelenke – Laufen, Sprechen, Tricks, Hunger, Heißhunger und die drei Kostüme funktionieren bei allen. Neben den Sprüchen aus dem Dialog hat jedes Tier eigene; Dino-Sprüche sagt nur der Dino. Hieß das Tier wie das alte Standard-Tier, bekommt es beim Wechsel den neuen Standard-Namen. Zeichnungen in `js/pet-species.js`.

**Ei → Baby → Erwachsen:** Mit **🥚 Ei** legt der Streamer ein neues Ei in den Stream. Es wackelt, bekommt beim Füttern Risse, kurz vor Schluss schauen Augen heraus – und nach **50 × Füttern** (einstellbar 5–500) schlüpft das Baby: kleiner, großer Kopf, große Augen. Das Baby wächst nach **5 Streams mit guter Laune** (einstellbar 1–30; ein Stream mit guter Laune ist ein Tag, an dem es mindestens 3 × gefüttert wurde). Jede Stufe erscheint im Overlay als Banner mit Konfetti, der Chat-Bot dankt den Helfern („🐣 Mimi ist geschlüpft! Danke an …“). Gezählt wird in der Datenbank (Trigger), egal ob über den Chat oder die Webseite gefüttert wird. Mods sehen den Stand, ändern kann ihn der Streamer.

Einmal nötig: Migration `supabase/migrations/20261021000000_pet_species.sql` im SQL Editor ausführen.

### Der Dino (Rexi)

Ein kleiner Dino (Standardname „Rexi“, im Kapitän-Kostüm mit Mütze und Pfeife) läuft im OBS-Overlay unten durchs Bild (steht das Laufband unten, läuft er obendrauf – oder mit „Läuft auf: dem Bildrand“ ganz unten) und sagt ab und zu einen von über 40 Sprüchen („Du Flitzpiepe!“, „Der Rentner ist älter als mein Dino!“ …). Zwischendurch hüpft er, brüllt, schaut sich um, tanzt oder macht ein Nickerchen.

**Füttern im Stream:** Zuschauer schreiben den Chat-Befehl (Standard **`!füttern`**, im Dialog änderbar) in den Twitch-Chat des Kanals – höchstens alle 10 Minuten pro Person. Dann fällt Futter vom Himmel und der Dino bedankt sich mit Namen. Dafür liest der Chat-Bot den Chat des Kanals mit (Berechtigung `user:read:chat`): **Den Chat-Bot im Admin-Bereich einmal neu verbinden**, danach richtet die Seite das Chat-Abo selbst ein (auch beim Klick auf „Auf Twitch übernehmen“ im Ärgern-Dialog).

**Auf der Webseite** füttern und streicheln Zuschauer den Dino nur für sich – im Stream passiert dabei nichts. Admins können beides: mit **„Auch im Stream“** (Standard an) erscheint es in OBS, ohne nur auf der Seite.

Wird er eine Weile nicht gefüttert (Standard 45 Minuten), bekommt er **Hunger**: Er meckert und **knabbert an den Zuschauern** – ein Namensschild von jemandem, der zuletzt gefüttert, geworfen oder gedreht hat, fällt ins Bild, der Dino läuft hin und beißt hinein.

Bei Hunger wird Rexi **rot** (auch die kleine Zeichnung auf der Kachel) und der Magen knurrt ab und zu hörbar.

**Heißhunger:** Nach der doppelten Hungerzeit (Standard 90 Minuten) – oder sofort per Knopf **🔥 Heißhunger auslösen** (OBS-Fenster: beim Dino und unter „Texte“, außerdem im Dino-Dialog) – brüllt Rexi, wächst auf 1,3-fache Größe, frisst sich abwechselnd durch den **Bildschirm** und die Karten. Zuerst der Bildschirm: Er klettert an der näheren Bildschirmkante hoch und frisst Löcher ins Streambild – schwarze Löcher mit gezackter Bisskante, Farbversatz wie bei einem kaputten Display und Sprüngen im „Glas“, bunte Pixel fallen heraus, die Karten wackeln bei jedem Biss. Solange keiner füttert, frisst er sich die Kante hoch und immer weiter ins Bild. Danach klettert er an einer Karte hoch und frisst Stücke aus dem Rand: am liebsten von rechts an der Karte **„Als Nächstes“**, 9 Bissen von der Kante bis zur oberen Ecke, dann kaut er weiter und droht („Wenn ihr nicht füttert, ess ich die Karten!“). Die Karte wackelt, Krümel fallen. Sobald ihn jemand füttert (Chat oder **🍖 Rexi füttern**), springt er runter, rülpst, freut sich – der Bildschirm repariert sich und die Karten wachsen wieder zu. Derselbe Knopf beendet den Heißhunger auch ohne Füttern. Beides ist abschaltbar im OBS-Fenster beim Dino („Bei Heißhunger an Karten hochklettern“, `pclimb=0`; „Bei Heißhunger Löcher in den Bildschirm fressen“, `pscreen=0`). In der Vorschau des OBS-Fensters frisst er nur den Bildschirm an, und nur, wenn dort „Heißhunger auslösen“ gedrückt wird – Karten lässt er dort in Ruhe.

**Kostüme:** Kapitän (Mütze + Pfeife), Mechaniker (Streifenmütze + Halstuch) und Bauarbeiter (Helm + Warnweste). Zuschauer wechseln es mit **`!change`** im Twitch-Chat (nimmt das nächste) oder gezielt mit `!change kapitän`, `!change mechaniker` bzw. `!change bauarbeiter` (die alten Wörter gehen weiter) – über dem Dino erscheint dann „@name !change mechaniker → MECHANIKER“, und jedes Kostüm hat seinen Sound (Pfeife, Brüllen, Stapfen). Im OBS-Fenster beim Dino stellen Admins das Kostüm direkt ein, schalten `!change` ab und legen die **Abklingzeit** fest (0–300 Sekunden, Standard 60, gilt für alle). Wie `!füttern` braucht `!change` den Chat-Bot.

Rexis Sounds (Brüllen, Kauen, Kartenknuspern, Magenknurren, Rülpsen, Schnarchen, Pfeife …) entstehen im Browser (`js/rexi-sfx.js`), es werden keine Dateien geladen. Lautstärke wie alle Overlay-Sounds über `vol`.

Admins stellen im Dialog Name, Hunger-Zeit und die Sprüche ein und können den Dino über **Dino sagt im Stream** sofort etwas sagen lassen.

Einmal nötig für beides: Migration `supabase/migrations/20260928000000_questions_pet.sql` ausführen. Für Kostüme, `!change` und den Heißhunger-Knopf zusätzlich `supabase/migrations/20261011000000_pet_costume.sql`. Im OBS-Dialog lassen sich Fragen-Karte und Dino einzeln ausschalten und in der Größe ändern; die Fragen-Karte lässt sich in der Vorschau verschieben.

## Kisten-Shop

**Wähle eine Kiste, kauf dir Items und finde sie im Spiel – für jedes gefundene Item gibt es einen Punkt, für das volle Set nochmal 10 oben drauf.**

1. **Kiste wählen:** Vier Truhen, in jeder liegt eine andere Menge Goldbarren (ungefähr 45–65, 90–120, 140–170, 200–240, jedes Mal neu gemischt). Die Werte würfelt die Datenbank, die Seite erfährt sie erst beim Öffnen – schummeln geht nicht.
2. **Einkaufen:** Kurz Zeit (Standard 90 Sekunden) im Shop mit Fortnite-Items wie Pump, SCAR, Gold-SCAR, Mythisches Item … Je seltener, desto teurer (Standardpreise: Gewöhnlich 10, Ungewöhnlich 20, Selten 35, Episch 55, Legendär 85, Mythisch 130, Exotisch 110). Jedes Item nur einmal. Läuft die Zeit ab, geht es mit dem Gekauften weiter.
3. **Im Spiel finden:** Gefundene Items abhaken. Punkte = gefundene Items, alle gefunden = +10.

**Koop-Duell (bis zu 4 Spieler):**
1. **Warteraum:** Jemand eröffnet eine Koop-Runde und teilt den 5-stelligen Code, die anderen treten damit bei. Alle sehen, wer schon drin ist.
2. **Start:** Nur wer eröffnet hat, startet die Runde (ab 2 Spielern). Vorher kann er sie auch abbrechen.
3. **Kisten:** Jede der vier Kisten gibt es nur einmal. Wer eine öffnet, dem gehört sie: Alle anderen sehen sofort, wer sie hat und wie viele Goldbarren drin waren, und können sie nicht mehr nehmen. Wer nach 45 Sekunden noch keine hat, bekommt eine übrige per Zufall.
4. **Shop:** Haben alle ihre Kiste, geht es für alle gleichzeitig in den Shop (die Kisten der anderen sind dann kurz aufgedeckt).
5. **Duell:** Haben alle eingekauft (oder die Zeit ist um), kommt ein VS-Bildschirm: Die Namen fliegen von beiden Seiten rein, dazwischen knallt „VS“. Danach steht ein Tauziehen-Balken: Jedes abgehakte Item schiebt die eigene Seite in die der anderen, alle gefunden (+10) schiebt richtig.
6. **Sieger:** Sind alle fertig (oder der Ersteller beendet das Duell), gewinnt, wer die meisten Punkte hat – mit Krone, Konfetti und Applaus.

**Im Stream:** Admins haken beim Öffnen der Kiste **„Meine Runde im Stream zeigen“** an. Dann zeigt das OBS-Overlay oben links eine Karte mit Timer, Guthaben, gekauften Items (mit den Bingo-Bildern, wenn es welche gibt) und Punkten, im Koop-Duell dazu das Tauziehen und am Ende den Sieger. Nach dem Ende bleibt sie noch 10 Minuten stehen. Im OBS-Dialog lässt sie sich ausschalten, vergrößern und in der Vorschau verschieben.

Admins stellen im Dialog Shop-Zeit, Preise pro Seltenheit und die Items ein (eine Zeile „Name | Seltenheit“). Freigeschaltet für Zuschauer ab **05.10.2026** (im Dialog änderbar). Einmal nötig: die Migrationen `supabase/migrations/20261001000000_loot_shop.sql` und `20261002000000_shop_versus.sql` (Koop-Duell) ausführen.

## Win-Challenge (nur für den Streamer)

Eine Leiter aus Stufen, die der Streamer der Reihe nach gewinnen muss:

- **🎮 Game** – Games gewinnen, z. B. „Gewinne ein Solo-Game“.
- **🔁 Runden** – mehrere Runden gewinnen, z. B. „Gewinne 3 Zone-Wars-Runden“.
- **⚔️ Fight gegen Mod** – 1v1 gegen einen Mod, z. B. „Box-Fight vs ModMax, first to 2“. Die Namen der Admins der Seite stehen als Vorschlag bereit.

Jede Stufe hat ein Ziel (so viele Siege braucht sie). Optional hat die Challenge **Leben** (Standard 3, 0 = ohne): Jede Niederlage kostet eins, sind alle weg, ist die Challenge gescheitert.

**Eintragen darf nur der Streamer** – mit den großen Knöpfen **Sieg** und **Niederlage**, dazu **Rückgängig**, **Stufe überspringen**, **Neu starten** und ein Klick auf eine Stufe, um dorthin zu springen. Rechts richtet der Streamer die Challenge ein (Name, Leben, Stufen hinzufügen, verschieben, löschen); Siege bleiben beim Speichern erhalten. Mit **„Admins (Mods) dürfen Ergebnisse eintragen“** kann der Streamer seinen Mods das Eintragen erlauben. Zuschauer sehen den Stand nur an.

**Im Stream:** Sobald der erste Sieg eingetragen ist, zeigt das OBS-Overlay oben links eine Karte mit der aktuellen Stufe, den Siegen (●●○), den Leben (❤️) und einem Fortschrittsbalken. Ein Sieg lässt die Karte grün aufleuchten („SIEG!“), eine Niederlage rot wackeln und ein Herz zerbrechen. Eine geschaffte Stufe, die geschaffte Challenge (mit Konfetti) und das Scheitern kommen groß übers ganze Bild. Nach dem Ende bleibt die Karte noch 10 Minuten stehen. Im OBS-Dialog lässt sie sich ausschalten, vergrößern und verschieben.

**Für Zuschauer ab 10.10.2026** (vorher Countdown auf der Kachel; der Streamer und die Admins sehen sie schon vorher, der Termin steht im Challenge-Dialog). Einmal nötig: die Migrationen `supabase/migrations/20261003000000_win_challenge.sql` und `20261004000000_challenge_start.sql` ausführen.

## Sieben weitere Content-Ideen

Einmal nötig: `supabase/migrations/20261014000000_stream_extras.sql` im SQL Editor ausführen (legt alle sieben Kacheln an). Die Edge Function `stream-tools` kommt mit dem nächsten Merge automatisch zu Supabase. Chat-Befehle brauchen den verbundenen **Chat-Bot** (Abschnitt 6) – er liest den Chat und antwortet. Im OBS-Fenster gibt es für jede Idee eine Ebene unter **„Neue Content-Ideen“**. Alles lässt sich auch aus dem OBS-Fenster (Reiter **Content**) öffnen, von Streamer und freigegebenen Mods.

| Idee | Zuschauer | Streamer / Mods |
|---|---|---|
| 🤐 **Verbotenes Wort** | melden mit `!erwischt` im Chat oder auf der Seite | Wort ziehen (zufällig oder eigenes), Meldungen bestätigen (+1) oder verwerfen, Strafe pro Verstoß einstellen (z. B. 10 Liegestütze) |
| ⏱️ **Subathon** | Follows, Abos und Bits verlängern den Timer von selbst | starten, pausieren, Zeit von Hand dazu, Sekunden pro Follow/Abo/100 Bits, Höchstdauer; Rangliste „am meisten Zeit geschenkt“ |
| ☕ **Kurze Pause** | Zahlenraten mit `!rate 42` (oder auf der Seite) | Pause mit Überschrift, Text und Countdown starten – das Overlay zeigt den Pausen-Bildschirm, Chat und Dino bleiben davor |
| 🧠 **Quiz** | antworten mit `!a` `!b` `!c` `!d` oder auf der Seite; 10 Punkte + bis zu 5 fürs schnelle Antworten | Frage stellen (zufällig oder bestimmte), auflösen, eigene Fragen anlegen; 24 Fortnite-Fragen sind dabei |
| 🎮 **Mitspielen** | `!join EpicName` (danach reicht `!join`), `!leave`; oder auf der Seite | öffnen, der Reihe nach oder per Zufall ziehen (Subs zuerst, wenn gewünscht) – der Bot sagt im Chat Bescheid; Epic-Namen sehen nur Streamer und Mods |
| 🔊 **Vorlesen** | Kanalpunkte „🔊 Nachricht vorlesen“; Stimme mit `oma:`, `roboter:`, `monster:`, `schnell:`, `flüster:` am Anfang | freigeben oder ablehnen (Punkte zurück), gesperrte Wörter, selbst etwas vorlesen lassen, abbrechen, stumm |
| 🃏 **Sammelkarten** | jeden Tag ein Gratis-Pack, Packs per Kanalpunkte „🃏 Sammelkarten-Pack“ (mit Twitch anmelden, damit sie ankommen), Sammlung, Rangliste, Tauschen | Karten anlegen (Emoji oder Bild, 5 Seltenheiten), Karten pro Pack, Wahrscheinlichkeiten |

**Kanalpunkte für Vorlesen und Karten:** im jeweiligen Dialog unter „Kanalpunkte“ Kosten einstellen und **„Speichern & zu Twitch übernehmen“** (nur Admins der Seite, nicht Mods; Twitch-Affiliate/Partner nötig).

**Vorlesen in OBS:** Das Overlay nutzt die Sprachausgabe von Windows/Chrome. Der Ton geht an das Standard-Audiogerät und wird mit **Desktop-Audio** aufgenommen (nicht über „Audio über OBS steuern“).

## Verlosung

Eine Content-Idee mit Chat-Befehl: Der Streamer (oder ein freigegebener Mod) legt einen **Preis** fest und startet die Verlosung, die Zuschauer schreiben **`!verlosung`** in den Chat, am Ende wird **ein Gewinner ausgelost**.

- **Nur Follower, jeder einmal:** Schreibt jemand den Befehl, fragt die Seite bei Twitch nach, ob er dem Kanal folgt (Recht `moderator:read:followers`, das die Verbindung seit den Follower-Alerts hat). Wer nicht folgt, bekommt vom Bot den Hinweis, erst zu folgen. Jeder kommt pro Verlosung nur einmal in den Lostopf – das sichert die Datenbank ab (ein Eintrag pro Twitch-Konto und Runde). „Nur Follower“ lässt sich im Dialog ausschalten.
- **Starten** im Dialog der Kachel 🎁 *Verlosung*: Preis, Befehl (Standard `!verlosung`), Dauer (bis zum Schließen oder 2–60 Minuten) und ob der Bot jede Teilnahme im Chat bestätigt. Der Bot verkündet Preis und Befehl.
- **Ziehen:** **🎲 Gewinner ziehen** lost in der Datenbank zufällig aus allen im Lostopf (schließt die Verlosung). Ist der Gewinner nicht da, lost **🔁 Neu ziehen** jemand anderen aus. Der Bot verkündet den Gewinner, Dialog und Overlay zeigen die Auslosung mit durchlaufenden Namen, Konfetti und Fanfare. **Beenden** blendet die Verlosung im Overlay aus.
- Auf der Seite sehen alle Preis, Stand, Teilnehmer und die letzten Gewinner; wer mit Twitch angemeldet ist, sieht, ob er im Lostopf ist. Die Twitch-IDs der Teilnehmer bleiben in der Datenbank, öffentlich sind nur die Namen.
- **OBS:** Ebene **Verlosung** unter „Neue Content-Ideen“ (Parameter `giveaway`, Größe `gwsize`, Lautstärke `vgive`). Sie erscheint nur, solange eine Verlosung läuft; neue Teilnehmer ploppen kurz auf. „▶ Testen“ im OBS-Editor führt eine Auslosung vor.
- Im Demo-Modus füllt **➕ 5 Test-Teilnehmer** den Lostopf (dort gibt es keinen Twitch-Chat).

**Rauswerfen:** Streamer und Mods sehen in der Liste „Im Lostopf“ neben jedem Namen ein **✕**. Wer rausfliegt, ist aus dem Lostopf, wird nicht gezogen und kann sich in dieser Verlosung nicht neu eintragen (der Bot antwortet dann nur, dass Mitmachen nicht mehr geht). Unter „🚫 Rausgeworfen“ holt **↩ Zurückholen** jemanden wieder rein. Fliegt der gerade gezogene Gewinner raus, ist die Verlosung wieder „geschlossen“, er verschwindet aus „Letzte Gewinner“ und **🔁 Neu ziehen** lost jemand anderen aus. Einmal nötig: Migration `supabase/migrations/20261025000000_giveaway_kick.sql` ausführen.

**Teilnehmer hinzufügen:** Streamer und Mods tragen im Dialog unter „Teilnehmer hinzufügen“ selbst Namen in den Lostopf ein – für Zuschauer ohne Chat, aus dem Discord oder nach einem Chat-Ausfall. Jeder Name geht pro Verlosung nur einmal (ohne Groß-/Kleinschreibung), auch nicht, wenn er schon per Chat dabei ist; Rausgeworfene kommen nur über „↩ Zurückholen“ wieder rein. Wer schon von Hand im Lostopf steht, ist beim Chat-Befehl „schon dabei“ (kein zweites Los, auch bei einem rausgeworfenen Namen nicht). Es geht, solange eine Verlosung existiert (offen, geschlossen oder schon gezogen – dann gibt es beim „Neu ziehen“ ein Los mehr). Die Aktion zählt zum Mod-Bereich „Verlosung“ und steht im Protokoll als „Teilnehmer hinzugefügt“. Einmal nötig: Migration `supabase/migrations/20261112000000_giveaway_manual.sql` ausführen.

**Einmal gewonnen, heute raus:** Wer heute schon gewonnen hat, ist bei weiteren Verlosungen desselben Tages nicht dabei – weder per Chat-Befehl oder Twitch-Panel noch beim Eintragen von Hand. Beim Starten steht dafür der Schalter „Wer heute schon gewonnen hat, darf nicht mehr mitmachen“ (Standard: an); er gilt für die gestartete Verlosung. „Heute“ ist der Kalendertag nach deutscher Zeit. Gezählt wird, wer gezogen und nicht rausgeworfen wurde: Wirft der Streamer einen Gewinner raus (z. B. weil er nicht da war), ist er für heute wieder frei. Erkannt wird der Zuschauer an seiner Twitch-ID, bei Eingetragenen am Namen. Wer es versucht, bekommt vom Bot (bei „Bot bestätigt jede Teilnahme“) bzw. im Panel einen Hinweis; Gewinne von vor der Migration zählen nicht. Einmal nötig: Migration `supabase/migrations/20261113000000_giveaway_one_win_per_day.sql` ausführen (danach „Verlosung starten“ mit dem neuen Schalter).

Einmal nötig: Migration `supabase/migrations/20261023000000_giveaway.sql` ausführen (braucht `…_stream_extras.sql`). Den Chat-Befehl liest der verbundene **Chat-Bot**; die Edge Function `twitch-eventsub` kommt mit dem nächsten Merge automatisch zu Supabase.

## Hot Words

Die (höchstens) **5 Wörter, die im Twitch-Chat am häufigsten geschrieben werden**, stehen live im Stream – mit Zähler. Kachel „Hot Words“ im Dashboard, im OBS-Fenster die Ebene **Hot Words** (unsichtbar, solange noch nichts gezählt ist).

- **Gezählt** wird jede Chat-Nachricht, die der **Chat-Bot** mitliest (Edge Function `twitch-eventsub`). Füllwörter wie „und“, „ich“, „the“, Befehle (`!…`), Links, `@Namen` und reine Zahlen zählen nicht. Gegen Spam zählt dasselbe Wort pro Person höchstens **einmal pro Minute**.
- **Streamer und Mods** stellen im Dialog ein: Zählen an/aus, wie viele Wörter zu sehen sind (1–5) und ab wie vielen Buchstaben ein Wort zählt (Standard 3). **🔄 Neu anfangen** setzt alle Zähler auf 0.
- **Sperren:** 🚫 neben einem Wort (oder unter „Gesperrt“ eintippen) – es verschwindet sofort aus Stream und Liste und zählt nie wieder. Die Sperrliste sehen nur Streamer und Mods; „↩ Freigeben“ hebt die Sperre auf.
- Im Demo-Modus füllt **💬 Test-Chat** die Liste mit Beispielwörtern.

Einmal nötig: Migration `supabase/migrations/20261026000000_hotwords.sql` ausführen (braucht `…_stream_extras.sql`). Die Edge Function `twitch-eventsub` kommt mit dem nächsten Merge automatisch zu Supabase.

## Umfragen

Kachel **„Umfrage“** im Dashboard: **Streamer und Mods** stellen eine Frage mit **2–5 Antworten** (Knopf „Ja / Nein“ füllt beides aus), wählen eine **Dauer** (1–60 Minuten oder „bis ich beende“) und ob im **Chat** abgestimmt werden darf.

- **Abstimmen:** im **Twitch-Panel** unter dem Stream (ein Tipp auf die Antwort), im Chat mit **`!vote 2`** (auch `!abstimmen 2`) oder auf der Seite. Jeder hat **eine Stimme** und kann sie bis zum Ende **ändern**. Der Bot antwortet nicht auf jede Stimme (sonst flutet er den Chat) – er **kündigt die Umfrage an** und nennt am Ende das **Ergebnis**.
- **Im Stream:** OBS-Ebene **„Umfrage“** (im OBS-Fenster einschalten): Frage, Balken mit Prozent, Restzeit. Danach bleibt das Ergebnis stehen, bis du im Dialog **Ausblenden** drückst. Ist die Zeit um, beendet sich die Umfrage von selbst.
- **Letzte Umfragen** mit Ergebnis stehen im Dialog (die letzten 20 je Kanal werden gemerkt).
- Raid-Schutz pausiert auch das Abstimmen. Mods brauchen den Bereich **„Mitmach-Spiele“** (Mod-Rechte).
- Im Demo-Modus füllt **🗳️ 10 Test-Stimmen** die Umfrage.

Einmal nötig: Migration `supabase/migrations/20261105000000_polls.sql` ausführen (nach `…_watchtime_import.sql`). Die Edge Functions `twitch-eventsub` (für `!vote`) und `twitch-ext` (Panel) kommen mit dem nächsten Merge automatisch zu Supabase.

## Chat-Bot: schneller, zwei Bots, Protokoll

Migration `supabase/migrations/20261116000000_bot_stats.sql`:

- **Schneller:** Watchtime, Hot Words und die Zählung laufen neben der Antwort des Bots statt davor; Bot und Twitch-Verbindung sind im Chat-Pfad kurz zwischengespeichert. Ansagen aus der Warteschlange (Umfrage zu Ende, Cup, Quiz …) gehen nach jeder Chat-Nachricht, jedem Panel-Aufruf und jeder Overlay-Runde raus – nicht mehr erst bei der nächsten Chat-Nachricht.
- **Zwei Bots:** siehe Schritt 6 („Zweiter Bot“).
- **Bot wechseln:** Wählt der Streamer den anderen Bot, meldet sich dieser sofort im Chat („👋 Hallo! Ich bin … und ab jetzt der Bot in diesem Chat.“). Kommt die Nachricht nicht an (z. B. Nur-Follower-Modus), sagt das Dashboard gleich, warum und was zu tun ist.
- **Live-Start** (Migration `supabase/migrations/20261117000000_live_welcome.sql`): Geht der Streamer live, schreibt der Bot sofort eine Willkommensnachricht mit dem Spiel – Standard „🔴 {streamer} ist jetzt live mit {game}! Willkommen im Stream – schön, dass ihr da seid 💜“. Text und an/aus unter 🤖 Bot & Chat → „Begrüßung & Danke“ → Live-Start (Platzhalter `{streamer}`, `{game}`, `{title}`). Höchstens einmal in 30 Minuten, damit ein kurzer Abbruch mit Neustart den Chat nicht zuschreibt. Spiel und Titel kommen frisch von Twitch.
- **Nicht zu schnell** (Migration `supabase/migrations/20261127000000_bot_pacing.sql`): Twitch lässt einen Bot, der im Kanal kein Mod ist, nur etwa 20 Nachrichten in 30 Sekunden schreiben – sonst kommt „you are sending messages too quickly“ (429). Je Kanal geht deshalb höchstens alle 1,6 Sekunden eine Bot-Nachricht raus (die Datenbank vergibt die Sendeplätze, auch bei gleichzeitigen Antworten). Bremst Twitch trotzdem, versucht der Bot es nach 2 und 5 Sekunden noch einmal und stellt die Nachricht danach in die Warteschlange; im Protokoll steht dann „↻ kommt gleich noch einmal“. Am schnellsten ist der Bot als Mod (`/mod BotName` im Chat).
- **Bot-Protokoll:** Jede Nachricht des Bots steht mit Status im Protokoll – ✓ gesendet (mit Antwortzeit von Twitch), ✕ von Twitch blockiert (mit dem Grund von Twitch, z. B. Link-Sperre, doppelte Nachricht, Bot gebannt), Fehler, kein Bot, Notfall-Schalter. **Streamer und freigegebene Mods** sehen es im Dashboard unter 🤖 Bot & Chat → „Bot-Protokoll“ und schicken dort eine **Testnachricht**. Der **Plattform-Admin** sieht im Admin-Bereich das Protokoll aller Kanäle (je Kanal die letzten 24 Stunden, Filter „nur Probleme“). Einträge bleiben 7 Tage.

## Chat-Bot: Clips, Ansagen, Stichwort-Antworten, Statistik

Migration `supabase/migrations/20261120000000_bot_more.sql` (nach `…_live_welcome.sql`). Die neuen Twitch-Rechte (`clips:edit`, `channel:read:ads`, `channel:read:hype_train`, `channel:read:goals`) meldet der Gesundheitscheck – dann **Twitch einmal neu verbinden**. Einstellungen im Dashboard unter **🤖 Bot & Chat** (Streamer und freigegebene Mods mit dem Bereich Chat).

- **🎬 `!clip`:** macht einen Twitch-Clip der letzten Sekunden und postet den Link (`https://clips.twitch.tv/…`). Nur während des Streams. Einstellbar: an/aus, wer darf (alle, Abos, VIPs, Mods), Pause für alle (Standard 30 s) und je Person (Standard 120 s, Mods nie). Die letzten Clips stehen in der Karte „Clips & Statistik“ (30 Tage).
- **📊 Statistik im Chat:** `!stats` (live: Dauer, Chatter, Nachrichten, neue Follower, Abos, Bits, Spitze der Zuschauer – offline der letzte Stream), `!topchatter` (Top 5 nach Nachrichten in diesem Stream, offline insgesamt; der Streamer zählt nicht mit), `!topwatch` (Top 5 der Watchtime). Pause je Befehl einstellbar (Standard 30 s). Nachrichten zählt `core.chat_counts` (gesamt und je Stream, moderierte Nachrichten zählen nicht).
- **💡 Stichwort-Antworten:** Schreibt jemand z. B. „wann streamst du?“, antwortet der Bot mit dem hinterlegten Text (`{user}` = Name). Je Antwort bis zu 10 Stichwörter oder Wortfolgen – „eins davon reicht“ oder „alle müssen vorkommen“; gezählt werden ganze Wörter, Groß/klein und Satzzeichen sind egal. Pause je Antwort und für alle zusammen (Standard 15 s). Befehle (`!…`), der Streamer selbst und der Raid-Schutz lösen nichts aus.
- **📣 Ansagen:**
  - **Werbepausen** (nur Affiliates/Partner): kurz vorher „⏰ In etwa einer Minute kommt Werbung …“ (die Seite fragt mit jedem Watchtime-Durchgang den Werbeplan bei Twitch ab und warnt, wenn die Werbung in den nächsten 2½ Minuten kommt), beim Start „📺 Werbepause (3 Min) …“ (EventSub `channel.ad_break.begin`) und danach „✅ Die Werbung ist vorbei“ (Bot-Warteschlange mit Sendezeitpunkt `bot_outbox.send_after`). Platzhalter `{in}`, `{duration}`.
  - **Hype-Train** (EventSub v2, nur Affiliates/Partner): Start, jede neue Stufe genau einmal und das Ende (`{level}`).
  - **Ziele** aus dem Creator-Dashboard (Follower, Abos, Bits): sobald ein Ziel erreicht ist, genau einmal (`{goal}`, `{current}`, `{target}`).
- **`!befehle`** listet jetzt auch `!clip` und die Statistik-Befehle.
- Technik: `bot_chat2` ruft `bot_chat` auf und erledigt danach Clips, Statistik, `!befehle` und Stichwort-Antworten in einem Datenbank-Aufruf; fehlt die Migration, nimmt die Edge Function wie bisher `bot_chat`. Ansagen entscheidet `bot_notice` (an/aus, Texte, jede Meldung genau einmal).

## Cup

Ein Turnier mit der Community (Kachel „Cup“, Migration `supabase/migrations/20261115000000_cup.sql`):

- **Der Streamer legt fest:** Name des Cups, **Regeln** (höchstens 450 Zeichen, eine Chat-Nachricht), **Preisgelder je Platz** (bis Platz 10, freier Text wie „50 €“) und den **Spielcode** (z. B. Fortnite-Matchmaking-Schlüssel). Den Code sehen nur Streamer und Mods, bis er verschickt wird.
- **Bot:** „📜 Regeln in den Chat“ und „🔑 Spielcode in den Chat“ schicken beides auf Knopfdruck. Beim Öffnen und Schließen der Anmeldung sagt der Bot Bescheid.
- **Beitreten:** Zuschauer schreiben **`!cup join`**, solange die Anmeldung offen ist. Streamer und Mods tragen Spieler auch **von Hand** ein (jeder Name nur einmal – wer von Hand drinsteht, ist auch per Chat schon dabei).
- **Punkte:** Streamer und Mods vergeben sie im Cup-Fenster (−/+ oder Wert eintippen). Daraus entsteht die **Rangliste** – gleiche Punkte = gleicher Platz, das Preisgeld steht neben dem Platz. Die Rangliste sehen alle auf der Seite, auch ohne Anmeldung (ohne Twitch-IDs).
- **Chat:** `!cup` (Infos), `!cup join`, `!cup regeln`, `!cup top` (Top 5), `!cup platz` (eigener Platz und Punkte). Infos antworten höchstens alle 15 Sekunden, `!cup platz` je Zuschauer alle 30 Sekunden.
- **Neuer Cup:** Punkte auf 0 (Spieler bleiben) oder alle Spieler entfernen; der Spielcode wird dabei geleert.
- **Mod-Rechte:** Bereich „Spiele & Mitmachen“. Alles steht im Protokoll.
- **Im Stream (OBS):** Ebene **„Cup“** im OBS-Fenster einschalten (gehört zum Modul „Spiele & Mitmachen“). Sie zeigt Titel, „Anmeldung offen: !cup join“ bzw. „Spielcode ist raus“, die **Rangliste** mit 🥇🥈🥉, Punkten und Preisgeldern (3–10 Plätze einstellbar, dazu „+ N weitere“) und auf Wunsch die **Regeln**. Neue Punkte leuchten kurz auf, die Reihenfolge stellt sich sofort um. Die Karte erscheint, sobald es Spieler gibt oder die Anmeldung offen ist. Keine eigene Migration nötig.

## Zuschauer-Wette und Rubbellos

Zwei Chat-Spiele ohne Kanalpunkte und ohne Geld (Kacheln „Zuschauer-Wette“ und „Rubbellos“, Kategorie Chat-Spiele). Einmal nötig: Migration **`supabase/migrations/20261201000000_bet_scratch.sql`** (nach `…_profile_schedule.sql`, braucht `…_cup.sql`). Tests dazu: `supabase/tests/bet_scratch_test.sql`. Der Chat-Bot leitet `!tipp`/`!tip`/`!wette`/`!bet` und `!rubbeln`/`!rubbellos`/`!los` an `fun_chat` weiter (`supabase/functions/_shared/chat.ts`) – nach dem Merge die Edge Function `twitch-eventsub` neu deployen (passiert mit den anderen Functions automatisch).

**Zuschauer-Wette** (`js/extras-bet.js`):
- Streamer und Mods stellen eine Frage mit **2–4 Antworten** („Ja / Nein“ auf Knopfdruck) und wählen, wie lange getippt werden darf (oder bis „🔒 Tipps schließen“). Der Bot kündigt sie an, beim Schließen und bei der Auflösung meldet er sich wieder.
- **Tippen:** `!tipp 1` oder `!tipp ja` im Chat, angemeldet auch auf der Seite. Jeder hat einen Tipp und darf ihn ändern, solange die Tipps offen sind.
- **Quote:** Wer richtig liegt, bekommt **Tipp-Punkte = Tipps gesamt ÷ richtige Tipps** (aufgerundet, 1–20). Je weniger richtig lagen, desto mehr Punkte. Die Quote steht als „×Zahl“ neben jeder Antwort.
- **Rangliste** aller Tipp-Punkte (ohne Twitch-IDs, für alle lesbar); im Chat `!tipp top` (Top 5, höchstens alle 15 s) und `!tipp punkte` (eigene Punkte, je Zuschauer alle 30 s). Löschen darf sie nur der Streamer.
- **Im Stream (OBS):** Ebene **„Zuschauer-Wette“** – Frage, Balken mit Quote, Restzeit; nach der Auflösung leuchtet die richtige Antwort, darunter die Top 3.

**Rubbellos** (`js/extras-scratch.js`):
- `!rubbeln` zieht ein Los. **Gewinne** (bis 12) mit Emoji, Text, **Häufigkeit** (Gewicht – die Chance steht daneben) und „Gewinn/Niete“ stellt der Streamer ein; Vorgabe: Niete, Shoutout, Sound, Emote-Regen, Game aussuchen, Ehrenplatz.
- **Pause je Zuschauer** (Standard 30 Minuten), auf Wunsch nur für Abos/VIPs/Mods. Wer zu früh rubbelt, bekommt höchstens einmal pro Minute einen Hinweis.
- Der Bot schreibt das Ergebnis; Gewinne löst der Streamer selbst ein – es gibt kein Geld.
- **Im Stream (OBS):** Ebene **„Rubbellos“** – jedes Los erscheint mit Namen und wird live freigerubbelt, bei Gewinn glitzert es. „Probe-Los“ im Dashboard testet das Overlay.
- Gespeichert wird je Los nur Name, Gewinn und Uhrzeit (für alle lesbar, die letzten 200); wann wer zuletzt gerubbelt hat, steht getrennt und ist nicht öffentlich.

**Mod-Rechte:** beides im Bereich „Spiele & Mitmachen“. Raid-Schutz und Starttermin der Kachel gelten wie bei den anderen Spielen.

## Design-Upgrades: bewegte Szenen, Markenfarbe, Look-Baukasten

- **Bewegte Szenen** (`scmove=`, `js/overlay-stage.js`): Lichter, Sterne, Wellen, Funken oder Polarlicht hinter „Gleich live“, „Pause“, „Ende“ und „Just Chatting“. Es bewegt sich nur `transform` und `opacity` (keine Filter, kein Neuzeichnen pro Bild). Einstellen im OBS-Fenster → Szenen-Bildschirm → **Bewegung**; einige Komplett-Looks bringen eine Bewegung mit (Kosmos, Gemütlicher Abend, Frostbite, Inferno, Tiefsee). Ein Hintergrund aus der Design-Bibliothek (`scbg=`) steht dort jetzt auch und lässt sich entfernen – er geht beim Speichern im OBS-Fenster nicht mehr verloren.
- **Markenfarbe** (`js/brand-colors.js`): Logo wählen – die Farben liest der Browser selbst heraus, **das Logo wird nirgends hochgeladen**. Im OBS-Fenster → Design neben der Akzentfarbe („Farbe aus deinem Logo“) und im Look-Baukasten. Fürs **öffentliche Profil** gibt es unter „Profil & Zeitplan“ → „Farbe deiner Seite“ eine eigene Farbe (Migration **`supabase/migrations/20261205000000_brand_color.sql`**, Tests: `supabase/tests/brand_color_test.sql`).
- **Look-Baukasten** (Design-Bibliothek → **＋ Eigener Look**, `js/look-builder.js`): Farbe (auch aus dem Logo), Karten-Design, Kamera-Rahmen, Alert-Design, Chat, Laufband, Bingo-Karte und Szenen-Bewegung wählen – mit Live-Vorschau (Gameplay, Gleich live, Pause). Optional „Alerts in dieser Farbe“ und „Auch für mein öffentliches Profil“. Gespeichert als Overlay-Vorlage mit `look=1` (keine eigene Tabelle); die Looks stehen in der Bibliothek unter **Eigene Looks** (Bearbeiten, Löschen, Installieren) und nicht in der Vorlagen-Liste des OBS-Fensters.

## Discord: Live-Meldung, Rückblick, Ankündigungen

Einmal nötig: Migration **`supabase/migrations/20261207000000_discord.sql`** (nach `…_brand_color.sql`). Tests: `supabase/tests/discord_test.sql` (SQL) und `supabase/functions/_shared/discord_test.ts` (Deno). Gepostet wird von den Edge Functions `twitch-eventsub` und `stream-tools` (werden mit den anderen Functions deployt) – über einen **Webhook**, kein Discord-Bot, keine neuen Secrets.

- **Verbinden** (Dashboard → **Discord**, `js/dash-discord.js`): In Discord am Kanal → Integrationen → Webhooks → Neuer Webhook → Adresse kopieren und einfügen. `stream-tools` (`discord_connect`) prüft die Adresse bei Discord und speichert sie. Die Adresse ist geheim: Sie liegt nur in `core.discord_settings` (kein Zugriff für Browser), das Dashboard sieht nur den Namen des Webhooks. Gepostet wird ausschließlich an `https://discord.com/api/webhooks/…` (Format in Datenbank und Edge Function geprüft).
- **Live-Benachrichtigung** beim Stream-Start (EventSub `stream.online`): eigener Text mit `{streamer}`, `{title}`, `{game}`, `{link}`, Vorschaubild von Twitch, wahlweise mit `@here`, `@everyone` oder einer Rolle (nur diese Erwähnung pingt – `@everyone` im Stream-Titel nicht). Höchstens einmal je 30 Minuten.
- **Rückblick** nach dem Stream (`stream.offline`, nachdem die Statistik den Stream abgeschlossen hat): Dauer, Ø/Spitze Zuschauer, Chatter, neue Follower, Abos, Bits.
- **Ankündigungen:** „Wochenplan posten“ (aus Profil & Zeitplan, Zeiten als Discord-Zeitstempel in der Zeitzone der Lesenden) und „Idee posten“ (Content-Idee mit Termin). Mit „Neue Termine ankündigen“ geht ein neuer oder verschobener Termin einer Content-Idee automatisch raus – je Termin einmal.
- Status im Dashboard: wann zuletzt gepostet wurde, sonst die letzte Fehlermeldung (z. B. Webhook in Discord gelöscht). **Testnachricht** und **Trennen** dort.
- **Mod-Rechte:** Bereich „Bot & Chat“. **Demo-Modus:** Einstellungen im Browser, es wird nichts gepostet.
- **Startseite:** Link zum StreamHelp-Discord (https://discord.gg/XkVG2ZEDG) im Menü, im Kontaktbereich und in der Fußzeile; auch die KI-Hilfe kennt ihn.

## Raid-Netzwerk und Freunde werben

Einmal nötig: Migration **`supabase/migrations/20261209000000_raid_network.sql`** (nach `…_discord.sql`). Tests: `supabase/tests/raid_network_test.sql` (SQL) und `supabase/functions/_shared/raids_test.ts` (Deno). **Neues Twitch-Recht `channel:manage:raids`:** Nach dem Deploy meldet der Twitch-Gesundheitscheck bei bestehenden Kanälen „Recht fehlt“ – Streamer verbinden Twitch einmal neu (Knopf „Twitch neu verbinden“). Bis dahin geht alles außer „Raiden“.

- **Raid-Netzwerk** (Dashboard → **Raid-Netzwerk**, `js/dash-network.js`): Mitmachen ist freiwillig („Im Raid-Netzwerk sichtbar“). Wer mitmacht, sieht die anderen Mitglieder, die gerade live sind (`core.stream_games.live_at`, höchstens 12 Minuten alt): gleiches Spiel zuerst, dann gleiche Sprache, dann kleinere Kanäle (Ø Zuschauer des laufenden Streams). Sichtbar sind nur Name, Bild, Spiel, Zuschauerzahl, Sprache und der Kurztext – nur für andere Mitglieder.
- **Raid mit einem Klick** (`stream-tools` → `raid_start`, `_shared/raids.ts`): Die Datenbank prüft Mitgliedschaft beider Kanäle, ob das Ziel live ist und höchstens einen Raid je 2 Minuten (`raid_target`), dann startet Twitch den Raid (Helix `POST /raids`). **Raid abbrechen** (`raid_cancel`). Rechte: Streamer, Admins, Mods mit Bereich „Bot & Chat“; jeder Raid steht im Mod-Protokoll.
- **Bot-Ansage:** Sobald Twitch den Raid angenommen hat, schreibt der Bot die Ansage (`{target}`, `{link}`; abschaltbar). Kommt ein Raid aus dem Netzwerk, begrüßt der Bot ihn nach dem normalen Danke mit dem Kurztext des Kanals (`raid_welcome`, abschaltbar).
- **Freunde werben** (Dashboard → **Freunde werben**): eigener Link `index.html?ref=<login>`. Der Browser merkt sich den Link 30 Tage (`localStorage` `sh_ref`); nach „Kanal anmelden“ ordnet `referral_claim` den neuen Kanal dem Werber zu (nur einmal, nur solange der Kanal auf Freischaltung wartet). Im Admin-Bereich stehen geworbene Bewerbungen oben mit „geworben von …“. Abzeichen ab 1 / 3 / 10 freigeschalteten Kanälen (Werber, Netzwerker, Botschafter) – im Dashboard und auf dem öffentlichen Profil. Kein Geld.
- **Demo-Modus:** drei erfundene Mitglieder sind live, geraidet wird nicht; Beispiel-Werbungen.

## Artists: Designs hochladen

Artists stellen Streamern eigene Designs zur Verfügung – **kostenlos, mit Credit**. Einmal nötig: Migration **`supabase/migrations/20261203000000_artists.sql`** (nach `…_bet_scratch.sql`). Tests dazu: `supabase/tests/artists_test.sql`. Die Admin-Aktionen laufen über die Edge Function `admin` (wird mit den anderen Functions deployt).

- **Bewerben** (Dashboard → **Artist-Bereich**, für alle mit Konto, `js/dash-artist.js`): Artist-Name, Kennung, Kurztext und 1–4 Links zu eigenen Arbeiten (nur `https://`), dazu die Regeln bestätigen (nur eigene Werke, kostenlos mit Credit, Prüfung).
- **Freischalten** (admin.html → **Artists**): Bewerbungen freischalten, ablehnen (mit Nachricht) oder sperren. Gesperrte Artists verschwinden mit allen Designs aus der Bibliothek.
- **Hochladen** (nur freigeschaltet): **Alert-Grafik** (PNG/JPG/GIF/WebP oder kurzes WebM/MP4), **Szenen-Hintergrund** (Bild), **kompletter Look** (Hintergrund + Grund-Design + Akzentfarbe, optional eigenes Alert-Bild) oder **Sammelkarte** (Bild + Seltenheit). Höchstens 10 MB je Datei, 10 Uploads gleichzeitig in Prüfung, 200 je Artist. Beim Hochladen bestätigt der Artist die Rechte; die Vorschau zeigt, wie es im Stream aussieht.
- **Prüfung:** Jeder Upload wartet im Admin-Bereich auf **Freigeben** oder **Ablehnen** (mit Hinweis an den Artist). Abgelehnte und entfernte Dateien werden gelöscht. Der Artist sieht Status, Hinweis und wie viele Kanäle sein Design nutzen.
- **Design-Bibliothek → Von Artists:** freigegebene Designs mit Name und Links des Artists. Übernehmen setzt je nach Art das Bild für alle Alerts (`a:<Datei>` im Alert-Designer, danach speichern), den Hintergrund der Szenen „Gleich live“, „Pause“ und „Stream-Ende“ (`scbg=`), Grund-Design + Farbe + Hintergrund (Look) oder legt eine neue Sammelkarte an. Jede Übernahme zählt je Kanal einmal. **Melden** schickt das Design mit Grund an den Admin (er kann es entfernen oder die Meldung schließen).
- **Dateien:** öffentlicher Bucket `artist-assets`, Ordner = Konto des Artists. Hochladen nur in den eigenen Ordner und nur freigeschaltet. Wird ein Design entfernt, zeigt das Overlay an der Stelle nichts mehr – Streamer wählen dann einfach ein anderes.
- **Demo-Modus:** Beispiel-Designs von „PixelPinsel“; eigene Uploads liegen im Browser (höchstens 1,5 MB je Datei), freischalten im Admin-Bereich mit Passwort „demo“.

## Sicherheit

Einmal nötig: `supabase/migrations/20261015000000_security_hardening.sql` im SQL Editor ausführen.

- **🛡️ Raid-Schutz:** In der **Streameransicht → Content** ganz oben. Ein Klick pausiert alle Zuschauer-Aktionen – Chat-Befehle, Kanalpunkte (Glücksrad, Würfe, Vorlesen, Karten: die Punkte gehen automatisch zurück) und Aktionen auf der Seite – für 15 Minuten, 1 Stunde oder bis zum Ausschalten. Streamer und Mods können weiter alles. Der Bot sagt es im Chat an, auf der Seite erscheint ein Hinweis.
- **🔊 OBS & Soundkäufe** (Migration `supabase/migrations/20261119000000_obs_sound_pause.sql`): Ohne OBS hört niemand die Sounds, die Zuschauer kaufen. Das Overlay meldet sich deshalb alle 30 Sekunden, wenn es als Browserquelle **in OBS** läuft (`obs_ping`; die Vorschau auf der Webseite zählt nicht). Fehlt die Meldung während des Streams, sehen Streamer und **alle freigegebenen Mods** oben auf der Seite „⚠️ OBS ist nicht verbunden“ mit dem Knopf **„Soundkäufe pausieren“** – dieselbe Karte steht im Dashboard unter **Raid-Schutz**. Pausiert:
  - die **Twitch-Erweiterung** bietet keine Sounds und keine Bits-Käufe mehr an (Hinweis „Gerade pausiert“),
  - **Kanalpunkte** für Sounds gibt es zurück, die Sound-Belohnungen auf Twitch werden ausgeschaltet (Würfe laufen weiter),
  - `!sounds` antwortet „Sounds sind gerade pausiert“, der Bot sagt Pause und Ende einmal im Chat an.
  Ist OBS wieder da, erinnert ein grüner Hinweis ans **Freigeben**. Der Notschalter gehört zu keinem Mod-Bereich – auch Mods ohne „Ärgern“ dürfen ihn schalten. Ein Bits-Kauf, der genau während des Umschaltens fertig wird, läuft trotzdem (bezahlt ist bezahlt).
- **Content-Security-Policy** auf allen Seiten: Nur eigene Skripte laufen; die beiden Inline-Skripte sind per Hash freigegeben (`node tools/stamp-versions.mjs` schreibt die Policy mit). Die Supabase-Bibliothek liegt lokal (`js/supabase-js.js`) statt vom CDN.
- **Kein Einbetten in fremde Seiten** (Schutz gegen Clickjacking), Referrer nur innerhalb der Seite.
- **OBS sieht weniger:** Das Overlay (ohne Anmeldung) bekommt keine Konto-IDs oder Twitch-Einlösungs-IDs mehr.
- **Uploads:** höchstens 10 Sound-Dateien pro Person; neue Passwörter brauchen mindestens 10 Zeichen und dürfen nicht den Namen enthalten.
- Siehe auch `SECURITY.md` (Lücken privat melden) und **`NOTFALLPLAN.md`** (was tun, wenn …, Schlüssel austauschen).

### Sicherheits-Paket (Migration `20261031000000_security.sql`)

Einmal nötig: `supabase/migrations/20261031000000_security.sql` im SQL Editor ausführen (nach der Plattform-Migration).

- **🔐 Zwei-Faktor-Anmeldung** (Dashboard → **Sicherheit**): QR-Code mit einer Authenticator-App scannen, Code bestätigen. Danach fragt StreamHelp beim Anmelden nach dem Code – auch nach „Mit Twitch anmelden“. Hat ein Konto 2FA, zählen Streamer-, Mod- und Admin-Rechte **nur** nach bestätigtem Code (Datenbank: `mfa_ok()`, Edge Functions: `getUserFromRequest`). In Supabase muss unter **Authentication → Multi-Factor** „TOTP“ an sein (Standard).
- **Admin-Bereich: 2FA ist Pflicht.** Beim ersten Login nur mit Passwort zeigt `admin.html` einen QR-Code; erst nach bestätigtem Code gibt es Daten. Danach immer Passwort + Code. Code-Fenster gelten nur einmal. Zurücksetzen: `NOTFALLPLAN.md`, Abschnitt 4.
- **Angemeldete Geräte** (Dashboard → Sicherheit): alle eigenen Anmeldungen mit Gerät, IP und letzter Aktivität; einzeln oder „alle anderen“ abmelden.
- **Rechte je Mod** (Dashboard → Mods): Der Streamer nimmt einzelnen Mods Bereiche weg – Content-Ideen, Glücksrad, Bingo, Mitmach-Spiele, Verlosung, Ärgern/Sounds/Vorlesen, Haustier, Overlay/Alerts, Chat-Bot, Kanalpunkte, Raid-Schutz. Die Datenbank erkennt den Bereich an der aufgerufenen Funktion bzw. Tabelle (`request_area()`), die Edge Functions fragen `is_admin_user_in()`. Bilder/Sounds hochladen hängt weiter nur an der Mod-Freigabe.
- **Mod-Protokoll** (Dashboard → Mods, nur Streamer): Wer mit Streamer-/Mod-/Admin-Rechten etwas ändert, landet mit Zeit, Rolle und Aktion in `core.audit_log` (90 Tage). Zuschauer-Aktionen nicht.
- **Daten-Export** (Dashboard → Sicherheit, nur Streamer): alle Kanal-Daten als JSON, ohne Tokens und Quiz-/Pausen-Lösungen.
- **Rate-Limits:** höchstens 300 schreibende API-Anfragen pro Minute und Konto bzw. IP (PostgREST `db-pre-request` → `api_guard()`); dazu Grenzen in den Edge Functions (Glücksrad 10/Min, Twitch-Panel: Mitmachen 6/Min, Stand 30/Min je Zuschauer …). Abschalten: `NOTFALLPLAN.md`, Abschnitt 8.
- **Härtung:** Tabellen mit Geheimnissen (Twitch-Tokens, Lösungen, OAuth-Anfragen) haben keine Tabellenrechte mehr für Besucher – bisher schützte sie allein RLS.
- **Sicherheits-Check** im Admin-Bereich: prüft wie der Supabase Security Advisor (RLS, `search_path`, geheime Tabellen, Rate-Limit, Streamer ohne 2FA).
- **Bot-Schutz:** verstecktes Fangfeld und Mindestzeit beim Registrieren; optional **Cloudflare Turnstile**: Site Key in `js/config.js` (`TURNSTILE_SITE_KEY`), Secret Key **nur** in Supabase unter Authentication → Attack Protection → Captcha. Erst beides eintragen, dann einschalten.
- **GitHub-Checks** bei jeder PR (`.github/workflows/security-checks.yml`): Versionsnummern/CSP, JS-Syntax, keine geheimen Schlüssel im Code (`tools/check-secrets.mjs`), Migrationen (`tools/check-sql.mjs`), Typprüfung und Tests der Edge Functions, Secret-Scan der ganzen Git-Historie (gitleaks, `.gitleaks.toml`). Dazu **CodeQL** (`.github/workflows/codeql.yml`, Funde unter Security → Code scanning).


### Sicherheits-Audit (Migration `20261125000000_hardening.sql`)

Einmal nötig: `supabase/migrations/20261125000000_hardening.sql` im SQL Editor ausführen (nach `…_bot_more.sql`). Ändert keine Daten. Die Edge Functions gehen beim Merge automatisch raus.

- **Twitch verbinden nur durch den Inhaber:** Den Twitch-Login für einen Kanal startet nur, wem der Kanal auf StreamHelp gehört (bzw. der Plattform-Admin); geprüft beim Start und noch einmal beim Rückweg von Twitch. Vorher konnte ein Fremder den Login starten, dem Streamer den Freigabe-Link unterschieben und wäre danach als Inhaber eingetragen gewesen. Bei einem Kanal ohne Inhaber muss das StreamHelp-Konto selbst mit genau diesem Twitch-Konto angemeldet sein (oder Admin sein).
- **Bits-Quittungen gelten plattformweit einmal:** Dieselbe Bits-Transaktion lässt sich nicht mehr in einem zweiten Kanal einlösen.
- **Bot-Einstellungen und Auto-Nachrichten:** Die Regeln in der Datenbank prüfen jetzt den Kanal der Zeile (`is_admin_of(channel_id)`). `tools/check-sql.mjs` meldet künftig jede neue Policy, die nur `is_admin()` ohne `channel_id` prüft.
- **Edge Functions:** Aufrufe an Twitch und YouTube brechen nach 8–10 Sekunden ab, statt die Function festzuhalten; `supabase-js` ist auf eine feste Version gepinnt (keine ungeprüfte neue Version beim nächsten Deployment).
- **Tests:** `supabase/tests/hardening_test.sql` (gegen eine Testdatenbank mit allen Migrationen, alles in einer Transaktion mit `rollback` – nie gegen die echte Datenbank) und `supabase/functions/_shared/oauth_owner_test.ts` (läuft in den Sicherheits-Checks mit).
### Checkliste im Supabase-Dashboard (geht nur dort)

1. **Authentication → Providers → Email:** „Confirm email“ an, **Minimum password length 10**, **„Prevent use of leaked passwords“** an.
2. **Authentication → Attack Protection:** **CAPTCHA** (hCaptcha oder Cloudflare Turnstile) einschalten – stoppt Bot-Registrierungen.
3. **Authentication → URL Configuration:** als Site-URL und Redirect-URLs **nur** die eigene GitHub-Pages-Adresse eintragen.
4. **Authentication → Rate Limits:** Standardwerte lassen oder senken (z. B. Anmeldeversuche pro Stunde).
5. **Project Settings → API:** den **service_role**-Schlüssel nie weitergeben; wurde er je irgendwo geteilt: **„Roll“** (neu erzeugen) und in den Edge-Function-Secrets nachziehen.
6. **Advisors → Security Advisor** ab und zu öffnen und Warnungen beheben.
7. **GitHub:** Settings → Code security → **Secret scanning** und **Dependabot alerts** an (Dependabot hält die Actions aktuell, siehe `.github/dependabot.yml`).

## Startdatum für Zuschauer

„Ärgere den Streamer“, das Fortnite-Bingo, die Unangenehmen Fragen, Stream-Dino, der Kisten-Shop und die Win-Challenge können einen Starttermin haben (Migration `20260924180000_start_dates.sql`, Standard: 01.10.2026, 20 Uhr). Bis dahin sehen Zuschauer auf der Kachel einen Countdown und können nichts werfen – das prüft auch die Datenbank. Admins benutzen beides schon vorher und sehen auf der Kachel „🔒 Zuschauer ab …“. Den Termin ändert ein Admin im jeweiligen Dialog unter „Für Zuschauer freigeschaltet ab“; leer lassen heißt: sofort für alle.

## Plattform: viele Streamer

StreamHelp läuft für beliebig viele Streamer. Jeder Kanal hat **eigene** Kacheln, Glücksräder, Sounds, Bingo-Items, Overlay-Einstellungen, Verlosungen, Hot Words, Mods, Befehle … – nur Konten (Anmeldung) und der **Chat-Bot** sind gemeinsam.

**So läuft es ab**

1. **Startseite** – mit Liste aller freigeschalteten Streamer. Ein Klick auf einen Kanal merkt ihn sich für nach dem Anmelden.
2. **Anmelden** – mit Twitch (oder E-Mail). Nach der ersten Anmeldung kommt einmal die Frage **„Bist du Streamer?“**
   - **Nein** → Zuschauer: Mitmachen in jedem Kanal (oben über den Knopf **Kanal** wechseln).
   - **Ja** → Streamer melden sich mit **Twitch** an (so ist sicher, dass der Kanal ihnen gehört; wer mit E-Mail angemeldet ist, wird zu Twitch geschickt). Kurze Nachricht dazu, absenden – der Kanal **wartet auf Freischaltung**. Oben im Dashboard steht solange ein Hinweis.
3. **Freischalten** – im Admin-Bereich unter **Streamer-Kanäle**: **Freischalten**, **Sperren** (mit Grund, den der Streamer sieht) oder **Zurückstellen**. Beim Freischalten bekommt der Kanal seine Grundeinstellungen und als Vorlage die Kacheln, Glücksräder, Quizfragen und Sammelkarten (ohne Bilder) des Standard-Kanals.
4. Der Streamer landet nach dem Anmelden automatisch in **seinem** Kanal, verbindet unter **🟣 Twitch-Verbindung** seinen Twitch-Kanal (nur genau das Twitch-Konto, mit dem er sich beworben hat) und richtet OBS ein.

**Links**

- Webseite eines Kanals: `https://<deine-seite>/#/c/<twitch-name>` – steht im Dashboard unter **Kanal → Dein Kanal** zum Kopieren (gut fürs Twitch-Panel oder einen Chat-Befehl).
- OBS-Overlay eines Kanals: `overlay.html?live=1&c=<twitch-name>` – der Link im OBS-Fenster enthält das automatisch. **Ohne `c`** zeigt das Overlay den **Standard-Kanal** – bestehende OBS-Quellen laufen also unverändert weiter.

**Einrichten (einmal)**

1. **Backup machen** (Supabase → Database → Backups). Der Umbau lässt sich nicht einfach rückgängig machen.
2. Alle älteren Migrationen müssen gelaufen sein (zuletzt `20261027000000_overlay_presets.sql`). Dann im SQL Editor **`supabase/migrations/20261028000000_platform.sql`** ausführen. Die bisherigen Daten werden dem **Standard-Kanal** zugeordnet (dein bisheriger Kanal) – alles bleibt, wie es war.
3. Die Edge Functions gehen beim Merge automatisch raus (GitHub Action). Neue Secrets braucht es nicht; `BROADCASTER_LOGIN` gilt nur noch für den Standard-Kanal, solange der noch keine Twitch-ID hat.
4. **Danach ältere Migrationen nicht mehr erneut ausführen** – sie kennen die neue Struktur nicht. Neue Migrationen ändern Tabellen in `core` und rufen danach `select public.channel_view('tabelle');` auf (siehe Kommentar in der Migration).

**Technik in Kürze**

- Alle Tabellen eines Kanals liegen im Schema `core` mit Spalte `channel_id`. Unter dem alten Namen in `public` steht eine Sicht, die nur den aktuellen Kanal zeigt – so laufen alle bisherigen Datenbank-Funktionen unverändert, nur je Kanal.
- Welcher Kanal gemeint ist, sagt der Header `x-channel` (Kanal-ID oder Twitch-Login). Webseite, Overlay und Edge Functions schicken ihn mit (`js/channel.js`, `withChannel` in `supabase/functions/_shared/twitch.ts`); Twitch-Ereignisse (EventSub) ordnet die Funktion über die Twitch-ID des Streamers zu. Ohne Header gilt der Standard-Kanal.
- Rechte: Admin eines Kanals sind sein Inhaber, freigegebene Mods dieses Kanals und der Plattform-Admin (das StreamHelp-Admin-Konto). Das alte Admin-Häkchen gilt nur noch im Standard-Kanal.
- Live-Updates kommen aus den Tabellen in `core`, gefiltert nach `channel_id`.
- Die Chat-Bots (Bot 1 und Bot 2) verbindet und trennt nur der Plattform-Admin (Admin-Bereich); jeder Kanal liest danach mit seinem gewählten Bot mit.
- Der Twitch-Gesundheitscheck (GitHub Action) prüft alle freigeschalteten Kanäle mit Twitch-Verbindung.

## Games im Dashboard

Oben bei den **Content-Ideen** stehen die Games des Kanals (z. B. Fortnite, Minecraft, Just Chatting). Ein Klick auf ein Game zeigt zuerst die **passenden Ideen** (Fortnite: Glücksrad, Bingo, Kisten-Shop, Quiz, Win-Challenge, Zähler; Minecraft und Speedrun: Zähler, Spiel-Rad, Umfrage; Just Chatting: Unangenehme Fragen, Umfrage, Hot Words, Vorlesen, Dino, Spiel-Rad; Horror: Herzfrequenz, Zähler, Spiel-Rad), darunter alles, was **zu jedem Game** passt. Games ohne eigene Idee zeigen „**Wir arbeiten an einer Content-Idee für dieses Game**“ – mit Knopf zu den Vorschlägen. „Alle Ideen“ zeigt alles wie bisher.

- **Games verwalten** (Streamer, freigegebene Mods): Games anhaken – Fortnite, Minecraft, Just Chatting, **Speedrun**, **Horror** und Retro-Games (Super Mario 64, Super Mario World, Mario Kart 64, Zelda: Ocarina of Time, Pokémon Rot/Blau, Tetris, Sonic, Crash Bandicoot, GoldenEye 007, Street Fighter II, „Retro“). Dazu ein Standard-Game für die Zeit ohne Stream.
- **Automatisch**: Läuft das OBS-Overlay, liest StreamHelp alle 5 Minuten die **Twitch-Kategorie** des Streams. Passt sie zu einem Game, wird es angeschaltet und für alle Zuschauer vorausgewählt (mit „Live“-Plakette). Ausschaltbar in „Games verwalten“. „Horror“ erkennt bekannte Horror-Spiele (Phasmophobia, Lethal Company, Dead by Daylight, Outlast, Resident Evil, Five Nights at Freddy's, Silent Hill …); „Speedrun“ hat keine eigene Twitch-Kategorie und wird von Hand gewählt.
- Neue Games: in `js/games.js` (Name, Symbol, passende Ideen) **und** in `supabase/functions/_shared/games.ts` (Twitch-Kategorie) eintragen.
- Einmal nötig: Migration **`supabase/migrations/20261029000000_games.sql`** (nach der Plattform-Migration). Fehlt sie, zeigt die Seite die Content-Ideen wie bisher ohne Games.

## Game-Pakete: Zähler, Spiel-Rad, Herzfrequenz

Zu jedem Game-Paket (Fortnite, Minecraft, Just Chatting, Speedrun, Horror) gibt es passende **Zähler-Vorlagen** und **Challenges**; sie stehen in `js/games.js` (`PACKS`). Einmal nötig: Migration **`supabase/migrations/20261106000000_game_packs.sql`** (nach `…_polls.sql`). Im OBS-Fenster gibt es dazu die Ebenen **Zähler**, **Spiel-Rad** und **Herzfrequenz**.

**🔢 Zähler** (bis zu 12 je Kanal): Symbol, Name und Chat-Befehl, z. B. 💀 Tode mit `!tode`.
- Im Dashboard: **+1**, **−1**, **=** (Wert setzen), bearbeiten, Reihenfolge, löschen. **Vorlagen** legen auf einen Klick die passenden Zähler an (Minecraft: Tode, Diamanten, Creeper; Speedrun: Versuche, Resets, Bestzeiten; Horror: Jumpscares, Tode, Schreie; Fortnite: Kills, Wins, Tode; Just Chatting: Lacher, Ähms).
- Im Chat: `!tode` zeigt allen den Stand (je Zähler höchstens alle 10 Sekunden). **Mods und Streamer** zählen mit `!tode +`, `!tode +3`, `!tode -1` oder `!tode =42` (der Bot nennt den neuen Stand). Hat der Streamer einem Mod die „Mitmach-Spiele“ gesperrt, darf er nur noch nachsehen.
- Im Stream (Ebene „Zähler“) und im **Twitch-Panel** stehen alle Zähler mit „im Stream zeigen“; eine geänderte Zahl hüpft kurz.

**🎡 Spiel-Rad:**
- **🎮 Nächstes Game:** Das Rad dreht zwischen allen angeschalteten Games. Mit „Gewonnenes Game gleich im Dashboard einstellen“ (Standard) springt das Dashboard auf das Game.
- **🎯 Challenge:** Für das gewählte Game dreht das Rad eine Challenge (z. B. Minecraft: „Nur Holzwerkzeuge“, Horror: „Licht aus im Zimmer“). Eigene Challenges je Game (2–16, eine pro Zeile) speichert der Streamer im Dialog; „Vorlage“ stellt die Standardliste wieder her.
- Das Ergebnis lost die Datenbank aus. Im Stream (Ebene „Spiel-Rad“) taucht das Rad auf, dreht und zeigt das Ergebnis ein paar Sekunden; der Bot verkündet es im Chat, sobald das Rad steht. Drehen dürfen Streamer und Mods.

**❤️ Herzfrequenz:**
- Im Dialog **„Pulsgurt verbinden“** – geht mit Pulsgurten (Polar, Garmin, Wahoo …) und Uhren, die ihren Puls per Bluetooth senden. Das klappt in **Chrome oder Edge am PC oder unter Android** (Web Bluetooth); Firefox, Safari und das iPhone können es nicht. Das Fenster muss offen bleiben (darf im Hintergrund sein); reißt die Verbindung ab, verbindet die Seite sich bis zu fünfmal neu.
- Die Seite schickt höchstens alle 3 Sekunden den Puls. Gespeichert werden nur der **letzte Wert** und Min/Durchschnitt/Max der laufenden Sitzung (nach 10 Minuten ohne Werte beginnt eine neue).
- Im Stream (Ebene „Herzfrequenz“) schlägt ein Herz im Takt; ab der **Warnschwelle** (Standard 140) wird es rot und wackelt. Ohne frische Werte verschwindet es. Im Chat nennt `!puls` (oder `!herz`) den Wert. „Puls ausblenden“ beendet die Anzeige.
- Im Demo-Modus simuliert **🫀 Simulieren** einen Puls.

## Chat-Kommandos: Der Chat steuert das Spiel

Kachel **„Chat-Kommandos“** im Dashboard. Zuschauer tippen ein Kommando in den Chat (z. B. `!springen`) oder lösen eine Kanalpunkte-Belohnung ein – die OBS-Ebene **„Chat-Kommandos“** zeigt groß, was der Streamer tun muss („SPRING!“), und er führt es selbst im Spiel aus. (Echte Tastendrücke im Spiel bräuchten ein Programm auf dem PC – das macht StreamHelp bewusst nicht.) Einmal nötig: Migration **`supabase/migrations/20261107000000_chat_control.sql`** (nach `…_game_packs.sql`).

- **Kommandos** (bis zu 30): Befehl ohne `!`, was zu tun ist (bis 40 Zeichen), Symbol, **Abklingzeit** (für alle), **Kanalpunkte** (0 = keine Belohnung) und ob der **Chat-Befehl kostenlos** geht. Teure Kommandos (z. B. „Waffe wegwerfen“) am besten nur per Kanalpunkte. ▶ probiert ein Kommando im Overlay aus, ⏸ schaltet es aus.
- **Vorlagen** je Game: Fortnite (springen, bauen, tanzen, heilen, Waffe wegwerfen), Minecraft (springen, schleichen, graben, essen, Item wegwerfen), Just Chatting (winken, lachen, tanzen, Wasser, Akzent), Speedrun (schneller, Pause, Reset), Horror (umdrehen, Licht aus, rennen, verstecken, schreien). Sie stehen in `js/games.js` (`PACKS` → `commands`).
- **Modus „Direkt“:** Jedes Kommando kommt sofort ins Overlay (eins nach dem anderen, höchstens 5 warten). Dazu eine **Pause je Zuschauer** (Standard 20 s) und die Abklingzeit je Kommando.
- **Modus „Abstimmen“:** Das erste Kommando startet eine Runde (10–120 s). Jeder Zuschauer hat eine Stimme (änderbar); das Overlay zeigt die Balken und die Restzeit, am Ende gewinnt das häufigste Kommando (bei Gleichstand das Los).
- **Kanalpunkte:** Kommandos mit Kosten bekommen eine eigene Belohnung „🎮 …“ – im Dialog **„Kanalpunkte abgleichen“** legt sie an, passt Kosten, Abklingzeit und an/aus an und räumt Belohnungen gelöschter Kommandos weg. Einlösungen kommen in beiden Modi sofort; der Bot bestätigt sie im Chat. Sind die Kommandos aus oder läuft der Raid-Schutz, gibt es die Punkte zurück.
- Der Bot antwortet auf Chat-Kommandos nicht (sonst flutet er den Chat) – das Overlay zeigt alles. Kommandos haben Vorrang vor eigenen Bot-Befehlen gleichen Namens; Zähler-Befehle und eingebaute Befehle (`!vote`, `!puls` …) sind gesperrt.
- Mods brauchen den Bereich **„Mitmach-Spiele“** (Mod-Rechte). Im Demo-Modus spielt **💬 Chat simulieren** ein paar Zuschauer.

## Chat-Bot: Stream-Infos, Begrüßung, Auto-Nachrichten, Moderation, Song-Wünsche

Alles im Dashboard unter **🤖 Bot & Chat** (Streamer und freigegebene Mods mit dem Bereich Chat). Einmal nötig: Migration **`supabase/migrations/20261109000000_chat_bot_plus.sql`** (nach `…_overlay_usage.sql`). Für Moderation und Shoutouts braucht die Twitch-Verbindung neue Rechte (`moderator:manage:chat_messages`, `moderator:manage:banned_users`, `moderator:manage:shoutouts`) – der Gesundheitscheck meldet es, dann **Twitch einmal neu verbinden**. Ausgeführt werden Löschen, Timeout und Shoutout im Namen des Streamers; schreiben tut weiter nur der Bot.

- **Stream-Infos:** `!uptime`, `!game`, `!title`, `!followage` (holt die Edge Function bei Twitch) und für Mods `!so @name` – Nachricht mit Link und letztem Spiel, dazu der offizielle Twitch-Shoutout. An/aus, Pause je Befehl und der Shoutout-Text (`{target}`, `{login}`, `{game}`) sind einstellbar.
- **Begrüßung:** aus, nur ganz neue Zuschauer (erste Nachricht überhaupt) oder jeden einmal pro Stream – mit eigenem Text für Wiederkommende.
- **Danke:** für Follow (höchstens alle 5 s, gegen Follow-Bots), Abo, Resub (`{months}`), verschenkte Abos und Bits ab einer Mindestzahl (`{amount}`), Raids (`{amount}` = Zuschauer) – auf Wunsch mit automatischem Shoutout für den Raider. Raids kommen über das EventSub-Abo `channel.raid` (legt der Gesundheitscheck an).
- **Auto-Nachrichten:** Texte, die frühestens alle X Minuten kommen und erst nach N neuen Chat-Nachrichten (läuft nichts im Chat, schweigt der Bot); zwischen zwei Auto-Nachrichten liegt eine Pause für alle.
- **Moderation:** Links (mit erlaubten Seiten; Mods geben mit `!permit @name` einen Link frei), GROSSBUCHSTABEN (Anteil ab Mindestlänge), Spam (gleiches Zeichen zu oft hintereinander, zu viele Emotes), gesperrte Wörter (ganzes Wort). Folge: Nachricht löschen oder Timeout, auf Wunsch eine Ermahnung (höchstens alle 30 s je Person). Mods und der Streamer sind immer ausgenommen, VIPs und Abonnenten auf Wunsch. Moderierte Nachrichten zählen für nichts (Hot Words, Befehle, Watchtime).
- **Eigene Befehle** haben im Editor unter „Mehr Einstellungen“ zusätzlich: weitere Namen (Aliase), wer darf (alle, Abos, VIPs, Mods, Streamer), Pause je Zuschauer, Antwortart (normal, als Antwort auf die Nachricht, mit @Name) und „nur während des Streams“. Neue Platzhalter: `{touser}` (genannte Person – nur bekannte Namen aus der Watchtime-Liste, sonst der Schreiber), `{random}` bzw. `{random:1-6}`, `{uptime}`, `{game}`, `{title}`, `{followage}`.
- **Song-Wünsche:** `!sr <YouTube-Link>` trägt den Song in die Warteschlange ein (Titel und Länge von YouTube; nur einbettbare Videos, keine Livestreams). Einstellbar: wer darf, Wünsche je Person, Größe der Warteschlange, Höchstlänge, Pause je Person. Im Chat außerdem `!song`, `!queue`, `!wrongsong` (eigenen Wunsch zurücknehmen) und für Mods `!skip`. **Abgespielt wird im Dashboard**: „🔊 Hier abspielen“ in genau einem Browserfenster anschalten – der Player (youtube-nocookie.com) spielt die Wünsche nacheinander, OBS nimmt den Ton über das Desktop-Audio auf. Warteschlange sortieren, sofort spielen, entfernen, per Link selbst eintragen. Die OBS-Ebene **„Song-Wünsche“** (auch als Modul) zeigt den laufenden Song mit Namen und die nächsten drei.

Nebenbei repariert die Migration die Rechte der Edge Functions auf neuere Tabellen (z. B. Chat-Kommandos, Umfragen): Die Service-Rolle darf jetzt alle Tabellen in `core` lesen und schreiben.

## Plattform steuern: Kanäle moderieren, Notfall-Schalter, Wartung, Updates

Im **Admin-Bereich** (`admin.html`, nur der Plattform-Admin). Einmal nötig: Migration **`supabase/migrations/20261110000000_channel_moderation.sql`** (nach `…_chat_bot_plus.sql`).

- **Kanäle moderieren** (Tabelle „Streamer-Kanäle“, Häkchen links – auch mehrere oder alle auf einmal):
  - **⏱️ Timeout:** Kanal 15 Minuten bis 30 Tage sperren. Solange ist er für Zuschauer, Overlay, Panel und Chat-Bot weg; danach automatisch wieder da. Der Grund erscheint beim Streamer im Dashboard. Dauerhaft sperren geht weiter mit „Sperren“. Der Standard-Kanal bekommt keinen Timeout.
  - **📺 Overlay aus:** Das OBS-Overlay des Kanals zeigt auf Zeit oder bis zum Aufheben nichts (kein Bild, kein Ton, keine Abfragen) und läuft danach von selbst weiter. In der Vorschau des OBS-Fensters steht ein Hinweis.
  - **⚠️ Verwarnen:** Text, den der Streamer oben im Dashboard sieht, bis er „Verstanden“ klickt (im Admin-Bereich: gelesen/ungelesen).
- **Notfall-Schalter für alle Kanäle:** „Alle Overlays“ pausieren und „Chat-Bot (alle Kanäle)“ stummschalten – auf Zeit oder bis zum Aufheben. Der stumme Bot liest und schreibt nichts (keine Befehle, keine Moderation, kein Danke).
- **Wartung:** Hinweis mit Text oben im Dashboard aller Streamer, Overlays auf Wunsch solange leer. Beim Beenden laden alle die neue Version.
- **Update ausrollen:** „Alle Overlays & Dashboards neu laden“ – offene Overlays in OBS laden innerhalb einer Minute neu, Dashboards nach einem 10-Sekunden-Hinweis.
- **Neue Version:** Das Dashboard (auch das OBS-Fenster) prüft alle 10 Minuten, ob auf der Seite eine neuere Fassung liegt, und zeigt dann „Neue Version – Jetzt aktualisieren“.
- **Was ist neu:** Neuigkeiten (Titel und Text) für Streamer und ihre freigegebenen Mods. Ungelesene öffnen sich einmal von selbst, danach links unter „🆕 Was ist neu“. Im Admin-Bereich steht, wie oft eine Neuigkeit gelesen wurde.

## Schneller, für alle Streamer, YouTube mit Twitch live

Einmal nötig: Migration **`supabase/migrations/20261111000000_live_sync.sql`** (nach `…_channel_moderation.sql`). Die Edge Functions (neu: `youtube`) kommen beim Merge automatisch. Danach einmal **Twitch neu verbinden** (oder unter 🔔 Alerts „Jetzt prüfen & reparieren“): Dann legt StreamHelp die Abos `stream.online`/`stream.offline` an und merkt sich, ob der Kanal Affiliate ist.

- **Alerts ohne Verzögerung:** `twitch-eventsub` schickt jeden Alert sofort per **Realtime-Broadcast** an das Overlay (Thema `alerts:<Kanal-ID>`, privat: lesen darf jeder, senden nur der Server) und speichert ihn gleichzeitig in `stream_alerts`. Das Overlay nimmt, was zuerst ankommt, und erkennt Doppelte an der Event-ID – ein neuer Follower ist damit praktisch sofort im Bild (Twitch selbst braucht meist unter einer Sekunde). Ohne Migration läuft es wie bisher über die Tabelle. Voraussetzung in Supabase: unter **Realtime → Settings** private Kanäle nicht abschalten (Standard).
- **Ohne Affiliate:** Auch Kanäle ohne Twitch-Affiliate/Partner können sich anmelden und Twitch verbinden. Chat-Bot, Follower- und Raid-Alerts, Overlay und Content-Ideen laufen normal; bei **Kanalpunkten, Abo-/Bits-Alerts und der Bingo-Tipprunde** steht ein Hinweis, dass Twitch sie erst ab Affiliate anbietet, und die Bedienelemente sind gesperrt. Der Gesundheitscheck meldet dafür keine Fehler. Wird der Kanal Affiliate, merkt das der nächste Gesundheitscheck und legt die fehlenden Abos an.
- **Anmelden in einem Schritt:** „Ja, ich streame“ → (falls nötig) mit Twitch anmelden → der Kanal wird angemeldet und Twitch fragt **direkt** nach der Freigabe. Danach wartet der Kanal nur noch auf die Freischaltung. Wer auf Twitch abbricht, bekommt „Twitch jetzt verbinden“ noch einmal angeboten.
- **YouTube mit Twitch live schalten** (Dashboard → 🟣 Twitch-Verbindung → **YouTube**, nur der Streamer selbst):
  1. **YouTube verbinden** (Google-Login). StreamHelp legt einen Stream-Schlüssel „StreamHelp“ an – **🔑 Stream-Schlüssel für OBS** zeigt Server und Schlüssel. In OBS mit einem Multistream-Plugin (z. B. „Multiple RTMP outputs“ oder Aitum Multistream) als zweites Ziel eintragen.
  2. Schalter **„starten, wenn Twitch startet“** / **„beenden, wenn Twitch endet“**: Geht der Twitch-Stream online, legt StreamHelp sofort eine YouTube-Sendung an (Titel vom Twitch-Stream, Latenz **ultra niedrig**, startet von selbst, sobald Bild ankommt). Geht er offline, wartet StreamHelp 20 Sekunden (kurze Aussetzer) und beendet dann die Sendung.
  3. **YouTube-Chat im Overlay:** Die Video-ID der Sendung geht direkt an die Chat-Ebene – der YouTube-Chat ist mit dem Twitch-Start da, ohne Suchen über `@Kanal` und ohne Verwechslung mit geplanten Streams. Startet der Streamer YouTube selbst, sucht StreamHelp beim Twitch-Start die laufende Sendung.

  **Einrichtung (einmal, Plattform-Admin):** In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt anlegen, **YouTube Data API v3** aktivieren, unter „OAuth-Zustimmungsbildschirm“ die App anlegen (Bereich `…/auth/youtube`) und auf **„In Produktion“** stellen (im Testmodus laufen Zugänge nach 7 Tagen ab), dann unter „Anmeldedaten“ eine **OAuth-Client-ID (Webanwendung)** mit der Weiterleitungs-URI `https://<projekt>.supabase.co/functions/v1/youtube` erstellen. Client-ID und Secret in **Supabase → Edge Functions → Secrets** als `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` eintragen (nicht in den Code oder Chat). Google prüft Apps mit diesem Bereich; bis dahin sehen Streamer beim Verbinden einen Warnhinweis. Kontingent: eine Sendung starten und beenden kostet rund 200 der 10.000 Einheiten pro Tag.

## Impressum, Datenschutz, Cookies

- **Impressum** (`impressum.html`, § 5 DDG): Anbieter mit Name, ladungsfähiger Anschrift (kein Postfach) und E-Mail. Verlinkt im Fuß der Startseite und in der Datenschutzerklärung. Die Sicherheits-Checks schlagen fehl, solange dort oder in `datenschutz.html` noch Platzhalter `‹…›` stehen.
- **Datenschutz** (`datenschutz.html`): Verantwortlicher mit denselben Angaben, Abschnitt zu Cookies und Browser-Speicher, Limited-Use-Hinweis für Google/YouTube.
- **Kein Cookie-Banner:** StreamHelp nutzt kein Tracking. Im Browser liegen nur Anmeldung und Einstellungen (technisch nötig, § 25 Abs. 2 Nr. 2 TDDDG). Die Schriften liegen selbst gehostet unter `assets/fonts/` (`css/fonts.css`) – Google Fonts wird nicht mehr geladen. Kommt später ein Analyse- oder Werbedienst dazu, braucht es vorher eine Einwilligung.

## Overlay in Module aufteilen

Statt einer Browserquelle mit allem kann das Overlay auf mehrere Quellen verteilt werden – z. B. **Alerts** in jede Szene, den **Chat** nur in der Chatting-Szene, **Spiele** nur beim Zocken. OBS-Fenster → Reiter **„Module“**:

- Fertige Module (`js/overlay-modules.js`): 🔔 Alerts & Ziele · 💬 Chat · 📢 Laufband · 🎥 Kamera & Haustier · 🎮 Spiele & Mitmachen · 🖼️ Pause & Szenen. Je Modul **„Link kopieren“** (von Hand als Browserquelle 1920 × 1080 einfügen) oder **„In OBS anlegen“** (mit OBS verbunden: legt die Quelle „StreamHelp-Overlay · <Modul>“ in der aktuellen Szene an bzw. aktualisiert sie).
- **Eigenes Modul:** Ebenen anhaken, Namen geben – fertig.
- Die Adresse ist `overlay.html?live=1&only=<Ebenen>&m=<Modul>`: Plätze, Größen und Aussehen kommen wie gewohnt aus dem OBS-Fenster, die Quelle zeigt nur ihre Ebenen. Eine Ebene, die im OBS-Fenster aus ist, bleibt auch im Modul aus.
- **Entweder** das ganze Overlay **oder** Module – beides zusammen zeigt Ebenen doppelt (und spielt Sounds zweimal).

## Statistik: OBS & Daten

Unter **📈 Statistik → „OBS & Daten“** (Streamer und freigegebene Mods). Einmal nötig: Migration **`supabase/migrations/20261108000000_overlay_usage.sql`** (nach `…_chat_control.sql`).

- **Datenverbrauch des Overlays:** Jede Browserquelle misst, was sie lädt (`js/overlay-usage.js`: Seite/Bilder/Sounds über Resource Timing, Datenbank-Abfragen über `fetch`, Realtime und Twitch-Chat über die WebSockets) und meldet alle 5 Minuten die neuen Bytes an `overlay_usage_add` (ohne Anmeldung, höchstens eine Meldung pro Minute und Modul, Werte gedeckelt). Die Statistik zeigt je Tag gestapelte Balken (Dateien, Datenbank, Live-Verbindung, Twitch-Chat, Sonstiges), den Verbrauch je Quelle/Modul und den Schnitt pro Stunde. Gemessen wird nur im Live-Link (nicht in Vorschau, Test oder Aufnahme-Studio); Bilder von fremden Servern ohne `Timing-Allow-Origin` (z. B. Emotes) zählen oft nicht mit – es sind Richtwerte. Gespeichert werden 90 Tage.
- **OBS gerade:** Läuft OBS auf demselben PC, verbindet sich die Statistik über obs-websocket (gleiches gespeichertes Passwort wie im OBS-Fenster) und zeigt alle 2 Sekunden CPU, Arbeitsspeicher, Bilder pro Sekunde, Renderzeit, ausgelassene Bilder, freien Speicher – und während des Streams Laufzeit, hochgeladene Daten, **Bitrate**, Upload pro Stunde, verlorene Bilder und Netz-Auslastung. Diese Werte bleiben im Browser.

## Startseite: Balken „Auf einen Blick“

Der Balken unter der Vorschau zeigt **Live-Zahlen aus allen Streams** und fragt alle 30 Sekunden neu nach (nur solange die Startseite offen ist). Neue Werte zählen vom alten zum neuen Wert hoch, „+… heute“ zeigt, was seit Mitternacht dazukam, ein roter Punkt, wer gerade live ist.

- Gezeigt werden die ersten acht Zahlen, die schon etwas zählen: Streamer (und wie viele gerade live sind), Zuschauer gerade live, Watchtime, Alerts, Glücksrad-Drehungen, Streiche, Haustier-Momente, Hot Words, Fragen & Ideen, Sammelkarten, Quiz-Antworten, vorgelesene Nachrichten, Mitspieler, Verlosungs-Gewinner, gezählte Zuschauer.
- Darunter, was in StreamHelp steckt (Content-Ideen, Theme-Pakete, Tiere, Games, Alert- und Overlay-Designs) – direkt aus den Listen im Code, also immer aktuell.
- Die Zahlen kommen aus `public.platform_stats()`: nur Summen über alle freigeschalteten Kanäle, keine Namen; für 20 Sekunden zwischengespeichert, damit viele Besucher die Datenbank nicht ständig zählen lassen.
- Einmal nötig: Migration **`supabase/migrations/20261030000000_platform_stats.sql`** (nach der Plattform-Migration). Fehlt sie, zeigt der Balken nur, was in StreamHelp steckt.

## Startseite: Reise beim Scrollen

Nach dem Entwurf „StreamHelp Startseite v3“ aus Claude Design (`js/landing-journey.js`, Stile am Ende von `css/landing.css`):

- **Overlay-Kapitel:** Die Vorschau bleibt stehen, wandert in die Bildschirmmitte, klappt in ihre Ebenen auf (Alerts, Chat & Bot, Glücksrad, Laufband & Haustier, Subathon-Timer – mit Beschriftung und „Eine Browserquelle für alles.“) und setzt sich wieder zusammen. Nur zweispaltig ab 900 px Breite, wenn der Hero ins Fenster passt.
- **Danach:** Zahlen-Band wächst auf volle Breite, Überschriften erscheinen Wort für Wort, die Rollen-Karten fächern aus einem Stapel auf, Content-Ideen laufen in zwei Reihen gegeneinander, eine Linie zieht durch die Schritte, ein Scan schaltet die Sicherheits-Punkte frei, die FAQ klappt Zeile für Zeile auf, am Ende dreht sich das Logo auf und sprüht Funken.
- **Rundherum:** Licht im Hintergrund wandert mit (eins folgt der Maus), große Kapitelnummern, Kapitel-Leiste rechts (ab 1100 px), magnetische Knöpfe, Lichtfleck auf den Karten.
- **Vorschau-Szene:** Alerts mit Funken, Abos und Bits verlängern den Subathon-Timer, Glücksrad mit Konfetti, Chat mit hervorgehobenen `!Befehlen`, das Haustier hüpft bei `!füttern`, ab und zu ein Raid.
- Mit „Bewegung reduzieren“ (Systemeinstellung) bleibt die Seite ruhig wie vorher; Live-Zahlen und Streamer-Liste funktionieren unverändert.

## Sprachen, Kontakt & KI-Hilfe, Showcase

- **10 Sprachen** auf Startseite und Anmeldung: Deutsch, Englisch, Spanisch, Französisch, Italienisch, Niederländisch, Polnisch, Portugiesisch, Türkisch, Russisch. Die Seite nimmt die Browsersprache, oben rechts lässt sie sich wechseln (gemerkt in diesem Browser). Das Dashboard bleibt vorerst deutsch.
  - Quelle ist immer der deutsche Text: `js/i18n-keys.js` (Liste), Übersetzungen in `js/i18n-<sprache>.js` in derselben Reihenfolge. Neuer Text: in `i18n-keys.js` **ans Ende** hängen und in jeder Sprachdatei am Ende ergänzen. `node tools/check-i18n.mjs` prüft Anzahl, HTML-Tags und Platzhalter (läuft auch in den GitHub-Checks).
  - Vorlage für neue Texte: Startseite mit `?i18n-dump` öffnen, in der Konsole `i18nKeys()`.
- **Kontaktformular** statt öffentlicher E-Mail-Adresse (Startseite → „Kontakt“). Nachrichten landen im Admin-Bereich unter **Postfach**; mit Bot-Falle und Grenzen (3 pro Stunde je Person, 300 am Tag insgesamt).
- **KI-Hilfe** daneben: beantwortet Fragen zu StreamHelp. Ohne eingerichteten KI-Dienst (oder wenn er hakt) sucht die Seite selbst die passende Antwort in den FAQ – kostenlos, auch auf Deutsch gefragt bei englischer Seite.
  - KI einschalten (optional, kostenlose Stufen z. B. bei Google Gemini oder Groq): in Supabase unter **Edge Functions → Secrets** `HELP_AI_URL` (OpenAI-kompatible Adresse, z. B. `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` oder `https://api.groq.com/openai/v1/chat/completions`), `HELP_AI_KEY` (der API-Schlüssel – **nur dort eintragen, nie in den Code oder einen Chat**) und `HELP_AI_MODEL` (z. B. `gemini-2.0-flash` bzw. `llama-3.1-8b-instant`).
  - Grenzen: 8 Fragen pro Minute und 60 am Tag je Besucher, 3000 am Tag insgesamt. Was die KI über StreamHelp weiß, steht in `supabase/functions/_shared/help-kb.ts`.
- **Showcase** „Diese Streamer nutzen StreamHelp“ auf der Startseite: nur Kanäle, deren Streamer zugestimmt haben (Dashboard → Twitch-Verbindung → „Auf der Startseite zeigen“), live zuerst.
- **Preise:** in den FAQ – aktuell kostenlos, ein optionales Abo kommt später.
- Einmal nötig: Migration **`supabase/migrations/20261101000000_contact_showcase.sql`** (nach der Sicherheits-Migration). Die Edge Function `help-chat` kommt mit dem nächsten Deploy.

## Dashboard: Einstieg, Kacheln, Statistik, Handy-App

- **Dein Start:** Streamer sehen oben bei den Content-Ideen eine Checkliste – Twitch verbinden, Overlay in OBS, erste Idee ausprobieren, Mods freigeben, Zwei-Faktor einschalten. Erledigtes hakt sich von selbst ab; „Ausblenden“ blendet sie aus, „Einführung“ holt sie zurück.
- **Kacheln:** Suchfeld über den Content-Ideen und ein ☆ an jeder Kachel – Favoriten stehen vorne (in der Game-Ansicht als eigene Gruppe). Beides merkt sich dieser Browser. Die Countdown-Kachel „Subathon“ heißt jetzt „Countdown zum Subathon“, damit sie nicht mit dem Subathon-Timer verwechselt wird.
- **📈 Statistik** (Streamer und freigegebene Mods): Sendezeit, Zuschauer (Spitze und Ø), Follows, Abos, Bits, aktive Chatter, Glücksrad, Streiche, Kanalpunkte – für 7, 30 oder 90 Tage, je Tag als Balken, dazu die treuesten Zuschauer. **Live:** Während des Streams steht oben eine Karte „Live seit …“ mit Zuschauern jetzt, Spitze, Durchschnitt, Follows, Abos, Bits, Chattern und Kanalpunkten seit Beginn; die Seite lädt bei jeder Zählung (jede Minute) von selbst neu. **Nach jedem Stream:** Unter „Letzte Streams“ steht jeder Stream mit Dauer, Zuschauern, Follows, Abos, Bits und Chattern – festgehalten, sobald Twitch `stream.offline` meldet (oder die nächste Zählung den Stream offline sieht). Gezählt wird ohne OBS-Overlay auch über Chat und Twitch-Panel (Migration `20261116000000_bot_stats.sql`).
  Einmal nötig: Migration **`supabase/migrations/20261102000000_dashboard.sql`**.
- **Handy-App:** StreamHelp lässt sich auf dem Handy (und am PC) als App installieren – im Browser „Zum Startbildschirm hinzufügen“ bzw. links „📲 App installieren“. Gestartet als App geht es direkt zur Anmeldung, Abkürzungen führen zu Statistik und Raid-Schutz. `sw.js` holt immer die neueste Fassung und springt nur ohne Netz mit der zuletzt geladenen ein; das OBS-Overlay fasst er nie an.

## Suchmaschinen & Teilen

- **Vorschaubild:** `assets/og-image.png` (1200 × 630) erscheint, wenn jemand den Link auf Discord, X oder WhatsApp teilt (Open-Graph-/Twitter-Tags in `index.html` und `datenschutz.html`). Discord merkt sich Vorschauen eine Weile – ein neues Bild greift dort evtl. erst nach Stunden.
- **Titel & Beschreibung:** Die Startseite heißt „StreamHelp – OBS-Overlay, Chat-Bot & Content-Ideen für Twitch“. Ist ein Streamer verbunden, setzt die App „StreamHelp · Name“.
- **Strukturierte Daten:** `WebSite` und `SoftwareApplication` als JSON-LD in `index.html`.
- **FAQ:** Abschnitt „Häufige Fragen“ auf der Startseite (`#faq`).
- **Sitemap:** `sitemap.xml` (Startseite, Datenschutz) – in der [Google Search Console](https://search.google.com/search-console) einreichen. Werkzeugseiten (Overlay, Studio, Admin, 404) sind `noindex`.
- **robots.txt:** liegt bereit, wirkt aber erst mit eigener Domain: Bei `…github.io/twitch-content/` lesen Suchmaschinen nur die robots.txt der Domain-Wurzel.

## Video aufnehmen (Aufnahme-Studio)

Dashboard → **Video aufnehmen** → „Aufnahme-Studio öffnen“ (`record.html`, `js/record.js`). Damit nimmt der Streamer ein Video für YouTube, Shorts oder TikTok auf – im Browser, während OBS ganz normal streamt.

- **Ohne Overlay (Standard):** Das Overlay steckt nur in OBS. Das Studio nimmt den Bildschirm bzw. das Spielfenster direkt auf – Alerts, Chat, Laufband & Co. sind im Stream zu sehen, im Video nicht.
- **Mit Overlay, wenn gewünscht:** „Overlay-Elemente mit aufnehmen“ einschalten und einzelne Elemente anhaken (z. B. nur Alerts und Kamera-Rahmen). Das Studio zeigt dann eine stille Kopie des Live-Overlays (`overlay.html?live=1&rec=<Ebenen>`: ohne Ton, ohne Watchtime-Zählung) über dem Spiel und nimmt sich selbst auf („Diesen Tab teilen“). Geht in Chrome und Edge; je größer das Studio-Fenster, desto schärfer.
- **Kamera** (Ecke, Größe, runde Ecken oder „wie im Stream“ – dort, wo der Kamera-Rahmen des Overlays sitzt), **Mikrofon** und **Spielton** („Systemaudio teilen“ in der Freigabe) mit Pegelanzeige.
- **Format:** YouTube 16:9 oder Shorts/TikTok 9:16 (Kamera oben, Spiel darunter), 1080p/720p, 30/60 Bilder pro Sekunde.
- **Datei:** WebM (H.264, von der Grafikkarte gerechnet, wo möglich) – YouTube, Shorts und TikTok nehmen das direkt an. In Chrome/Edge schreibt das Studio direkt in eine Datei auf dem PC (auch stundenlange Aufnahmen), sonst am Ende „Herunterladen“. Nichts wird hochgeladen.
- Pause/Weiter, Stopp; die Aufnahme läuft weiter, wenn das Studio-Fenster im Hintergrund liegt und man spielt. Endet die Bildschirm-Freigabe, wird die Aufnahme gespeichert.
- Tipp: Für ein Video exakt wie im Stream (alles inklusive) einfach in OBS „Aufnahme starten“.

## Twitch-Erweiterung (Panel, Mobil, Komponente, Overlay)

Eine Erweiterung für twitch.tv (Ordner `extension/`, Edge Function `twitch-ext`) in vier Ansichten, jede mit eigenem Design und **eigener Datei**: `panel.html` (Panel), `component.html` (Komponente), `video-overlay.html` (Overlay) und `mobile.html` (Twitch-App). Alle nutzen dieselbe Logik (`panel.js`, `panel.css`); die Datei sagt mit `<html data-view="…">`, welches Design gilt (`html[data-mode]`, Styles am Ende von `panel.css`). Steht in der Entwicklerkonsole noch überall `panel.html`, geht es auch – dann entscheiden `?anchor=…` und `platform=mobile` wie früher:

| Ansicht | Wo | Besonderheit |
|---|---|---|
| **Panel** | unter dem Stream | Gaming-Look mit Neonkante und Glow, Kopfzeile (Kanalname, Logo) und Link zur Seite |
| **Mobil** | Twitch-App auf dem Handy | App-Look: farbige Hero-Karte fürs Game, ruhige Karten ohne Neon, Abschnittstitel, große Daumen-Knöpfe, Kopfzeile bleibt oben stehen; kein Link nach draußen |
| **Komponente** | kleines Feld auf dem Video | Look einer Stream-Einblendung: dunkles Glas, Titel als Etikett, eine Karte nach der anderen mit Fortschrittsbalken wie bei Stories (hält an, solange der Zuschauer etwas bedient); passt sich der Größe an, die der Streamer im Creator-Dashboard wählt |
| **Overlay** | über dem ganzen Videobild | dezente Glas-Karten mit Farbkante in der Ecke, höchstens drei, das Wichtigste zuerst (Umfrage, Verlosung, Warteschlange …); Ecke (4) und Größe (klein/mittel/groß) aus der Konfiguration; das Bild darunter bleibt klickbar |

Komponente und Overlay sieht man nur, wenn der Kanal live ist – so macht es Twitch.

**Was Zuschauer sehen** (der Streamer wählt die Module in der Konfiguration; leere Karten bleiben weg):

- **Aktuelles Game** (mit „Live“, wenn die Twitch-Kategorie passt) und die **passenden Content-Ideen**.
- **📊 Umfrage**: Antworten mit Balken, Restzeit, die eigene Stimme ist markiert und lässt sich ändern.
- **🦖 Haustier füttern**: dieselben Regeln wie `!füttern` im Chat (jeder alle 10 Minuten, insgesamt höchstens alle 15 Sekunden, Raid-Schutz).
- **🔢 Zähler**, **🍀 Verlosung** (wie `!mitmachen`, auch „nur Follower“) und **🎮 Mitspieler-Warteschlange** (mit Epic-Name).
- **🔊 Sounds** (neu): Zuschauer tippen auf einen Sound, das OBS-Overlay spielt ihn ab – **ohne Kanalpunkte**, also auch ohne Affiliate. Standard: aus. Siehe unten.
  - **💎 Sofort gegen Bits** (Affiliate/Partner): Umschalter „Gratis“ / „💎 Sofort · 100 Bits“ – ein bezahlter Sound läuft ohne Wartezeit. Twitch zeigt den Kauf-Dialog; `twitch-ext` prüft die signierte Quittung, jede Transaktion zählt genau einmal (`core.bits_transactions`, 13 Monate).
  - **⭐ Abonnenten**: einzelne Sounds nur für Abonnenten und eine eigene, kürzere Wartezeit. Ob jemand abonniert hat, fragt `twitch-ext` bei Twitch nach (Helix, Recht `channel:read:subscriptions` des Streamers) – nicht der Browser. In der Mitspieler-Warteschlange stehen Abonnenten mit ⭐ und – wenn „Abo-Vorrang“ an ist – weiter vorn, auch wenn sie sich übers Panel anstellen.
  - Migration `supabase/migrations/20261118000000_panel_bits_subs.sql`.
  - **Ist OBS nicht verbunden**, pausieren Streamer oder Mods die Soundkäufe (siehe **Sicherheit → OBS & Soundkäufe**) – das Panel zeigt dann „Gerade pausiert“ statt der Knöpfe.
- **Als Nächstes** (Termin) und im Panel ein Link **zur Seite**.
- **Sprache**: Standard „Automatisch“ – jeder Zuschauer sieht seine Twitch-Sprache (10 Sprachen, sonst Englisch). In der Konfiguration lässt sich eine feste Sprache wählen. Texte: `extension/panel-i18n.js`.
- **Hell/Dunkel** wie Twitch beim Zuschauer, oder fest.

Für Abstimmen, Füttern, Mitmachen und Sounds gibt der Zuschauer einmal seine Twitch-ID frei – Twitch fragt selbst nach.

**Keine Werbung in der Erweiterung:** Twitch verbietet Werbe- und Sponsoring-Inhalte in Erweiterungen (Extension-Richtlinie 4.4, [dev.twitch.tv/docs/extensions/guidelines-and-policies](https://dev.twitch.tv/docs/extensions/guidelines-and-policies/)). Gekennzeichnete Werbung geht über das Laufband im OBS-Overlay – „Werbung“ oder „Anzeige“ selbst davorschreiben.

### Schritt für Schritt: Erweiterung bei Twitch anlegen (einmal, Plattform-Admin)

**Vorher in Supabase:**

1. Migrationen `supabase/migrations/20261114000000_panel_sounds.sql` und `20261118000000_panel_bits_subs.sql` im SQL Editor ausführen (für Sounds, Bits und Abo-Sounds; alles andere läuft auch ohne).
2. Edge Function `twitch-ext` neu deployen (macht der GitHub-Workflow „Deploy Edge Functions“ nach dem Merge, sonst `npx supabase functions deploy twitch-ext`).

**In der Twitch-Entwicklerkonsole** ([dev.twitch.tv/console/extensions](https://dev.twitch.tv/console/extensions)):

3. **Erweiterung erstellen** (gibt es sie schon als Panel: die vorhandene öffnen und **Neue Version** anlegen). Name z. B. „StreamHelp“. Als Typen **Panel**, **Video – Komponente** und **Video – Vollbild (Overlay)** ankreuzen, dazu **Mobil**.
4. Version → **Asset-Hosting**:
   - Panel-Ansicht: `panel.html`, Panel-Höhe `500`
   - Video – Komponente: `component.html` (Seitenverhältnis z. B. Breite 3, Höhe 4; Zoom an)
   - Video – Vollbild: `video-overlay.html`
   - Mobil: `mobile.html`
   - **Konfigurationsseite: `config.html`**
   - Live-Konfiguration: leer lassen
5. Version → **Funktionen**:
   - **Identitätsverknüpfung anfordern** einschalten (nötig für Mitmachen und Sounds).
   - **Konfigurationsdienst**: „Konfigurationsdienst der Erweiterung verwenden“ wählen – ohne ihn speichert `config.html` nichts. **Erforderliche Konfiguration** leer lassen (die Erweiterung läuft auch ohne Einstellungen).
   - **Zulassungsliste für URL-Abrufdomänen**: `https://ssibsphuttjlphijilsc.supabase.co`
   - **Zulassungsliste für Panel-URLs**: die Adresse der Webseite (GitHub Pages), damit der Link zur Seite aufgeht.
5b. **Monetarisierung** (für Sounds gegen Bits und Abo-Extras):
   - **Onboarding** abschließen (einmal, Twitch fragt nach Steuer- und Auszahlungsdaten).
   - **Bits-Unterstützung: „Bits aktiviert“**. Unter **Bits-Produkte verwalten** vier Produkte anlegen (SKU genau so, „In Entwicklung“ zum Testen an, vor dem Einreichen aus; „Übertragen“ aus):
     | SKU | Name | Bits |
     |---|---|---|
     | `sound_50` | Sound sofort | 50 |
     | `sound_100` | Sound sofort | 100 |
     | `sound_250` | Sound sofort | 250 |
     | `sound_500` | Sound sofort | 500 |
   - **Abonnement-Unterstützung: „aktiviert“** (Abo-Sounds und Abo-Vorrang).
   - Der Streamer wählt den Preis im StreamHelp-Dashboard (Ärgere den Streamer → 💎 Sofort gegen Bits) und schaltet Bits für die Erweiterung im Creator-Dashboard ein.
6. **Erweiterungs-Secret** (nur beim ersten Mal): in den Einstellungen der Erweiterung das Secret kopieren und in Supabase als Secret **`EXTENSION_SECRET`** eintragen (Edge Functions → Secrets). Nicht ins Repo, nicht in den Chat.
7. **Dateien hochladen**: diese zwölf Dateien aus `extension/` direkt in ein ZIP (ohne Unterordner; Windows: markieren → Rechtsklick → Senden an → ZIP-komprimierter Ordner):
   `panel.html`, `component.html`, `video-overlay.html`, `mobile.html`, `panel.css`, `panel.js`, `panel-i18n.js`, `ext-config.js`, `config.html`, `config.css`, `config.js`, `favicon.svg`.
   Unter **Dateien** hochladen.
8. **In den gehosteten Test verschieben** und auf dem eigenen Kanal ausprobieren (Schritt 10–12).
9. **Zur Prüfung einreichen**. Twitch fragt dafür nach Beschreibung, Symbolen, Screenshots, Datenschutzerklärung (`…/datenschutz.html`), Kontakt und einer Testanleitung für die Prüfer (z. B. „Kanal X, Konfiguration öffnen, Modul Umfrage anhaken; im Dashboard eine Umfrage starten“). Die Größen der Bilder nennt die Konsole. Nach der Freigabe kann jeder Streamer die Erweiterung aktivieren.

### Schritt für Schritt: als Streamer aktivieren und einrichten

10. **twitch.tv → Creator-Dashboard → Erweiterungen** → StreamHelp **installieren**.
11. Unter **Meine Erweiterungen** auf das Zahnrad (**Konfigurieren**): Das öffnet `config.html` mit Live-Vorschau rechts.
    1. **Schnellstart** wählen: 🌱 Ich fange gerade an (wenig, ruhig) oder 💬 Ich bin (noch) kein Affiliate (alles ohne Kanalpunkte, inklusive Sounds).
    2. **Ansichten und Overlay-Ecke:** Wo die Erweiterung erscheint, legt Twitch beim Aktivieren fest (Schritt 12). Hier nur Ecke und Größe fürs Overlay. Über der Vorschau schaltest du zwischen Panel, Mobil, Komponente und Overlay um.
    3. **Module** anhaken, **Aussehen** (Farbschema, kompakt) und **Sprache** (Automatisch oder fest).
    4. **Speichern** – Zuschauer sehen es nach wenigen Sekunden, ohne neu zu laden.
12. **Aktivieren** (Pfeil neben der Erweiterung): als **Panel**, als **Komponente** (dann auf dem Video platzieren) oder als **Overlay**. Twitch erlaubt pro Kanal höchstens ein Overlay und zwei Komponenten.
13. **Sounds übers Panel** (optional): auf der StreamHelp-Seite im Dashboard → Kachel **„Ärgere den Streamer“** → „🔊 Sounds über die Twitch-Erweiterung“ einschalten und die Bremse wählen (pro Zuschauer höchstens alle … / Abstand zwischen zwei Sounds). Darunter: **💎 Sofort gegen Bits** (an/aus, Preis 50–500 Bits; dazu im Creator-Dashboard → Erweiterungen → StreamHelp Bits erlauben) und **⭐ Abonnenten** (eigene Wartezeit, Haken je Sound = nur für Abonnenten). Dazu in der Konfiguration das Modul **Sounds abspielen** anhaken. Gespielt wird über das OBS-Overlay (im OBS-Fenster muss die Ebene „Würfe & Sounds“ an sein). Gezeigt werden die ersten 20 Sounds der Liste (eingebaute zuerst, dann hochgeladene).

**Ohne Twitch ansehen:** `extension/config.html` direkt im Browser öffnen (Vorschau geht, Speichern nicht – die Einstellungen stehen unten als Text). `panel.html?demo` zeigt Beispieldaten; `component.html?demo`, `video-overlay.html?demo` bzw. `mobile.html?demo` die anderen Ansichten, `?theme=light` hell, `?platform=mobile` Handy, `?language=en` eine Sprache. **Nach jedem Update der Dateien in `extension/` eine neue Version hochladen** (Schritt 7–9). Neue Games kommen wie gehabt in `js/games.js` und `supabase/functions/_shared/games.ts`.

## Profil & Zeitplan

Im Dashboard unter **Profil & Zeitplan** (Streamer, Admins, freigegebene Mods; `js/dash-profile.js`). Einmal nötig: Migration **`supabase/migrations/20261129000000_profile_schedule.sql`** (nach `…_bot_pacing.sql`). Tests dazu: `supabase/tests/profile_schedule_test.sql`.

- **Wochenplan:** bis zu 21 feste Termine pro Woche – Wochentag, Startzeit, Dauer, Titel und Game. Rechts stehen die nächsten Termine (14 Tage), wie sie auf dem Profil erscheinen.
- **Pause:** „Pause bis …“ mit Hinweis (z. B. Urlaub) – Termine bis dahin fallen weg, das Profil zeigt den Hinweis.
- **Öffentliches Profil** `profil.html?c=<twitch-login>` (`js/profile.js`, `css/profile.css`): Bild und Name von Twitch, Live-Anzeige, Kurztext, Links mit Logo, nächster Stream mit Countdown, Wochenplan (Zeitzone des Streamers) und die nächsten Termine in der Zeitzone des Besuchers. **In den Kalender** lädt den Plan als `.ics` (wöchentlich wiederholt), **Teilen** nutzt das Teilen-Menü des Geräts. Hell/Dunkel folgt dem System.
- **Zustimmung:** Öffentlich wird das Profil erst, wenn der **Streamer selbst** den Schalter umlegt (Mods und Admins können Text, Links und Plan pflegen, aber nicht veröffentlichen). Ohne Zustimmung liefert `public_profile()` nichts. Links müssen mit `https://` beginnen.
- **Startseite:** Im Streamer-Showcase führt die Kachel aufs Profil, wenn es öffentlich ist – sonst wie bisher zu Twitch.

## Einführung

Nach der ersten Anmeldung (und nach „Bist du Streamer?“) öffnet sich einmal die Einführung (`js/intro.js`); danach jederzeit links unter **Einführung**.

- **Streamer:** Willkommen → drei kurze Fragen (Stream-Erfahrung, Ziel, Twitch und/oder YouTube) → **Dein Plan** mit den passenden Schritten (z. B. OBS einrichten, Look wählen, Twitch verbinden, YouTube dazuschalten, Affiliate-Ziele, Mods) → Tour. Die Antworten merkt sich der Browser.
- **Mods** und **Zuschauer:** Willkommen → Tour (Mods: die Werkzeuge; Zuschauer: Games, Als Nächstes, Content-Ideen, Konto).
- **Mitmach-Tour** (`js/tour.js`) durch das echte Dashboard: Schritte mit **Kurz erklärt** zum Ansehen und **Du bist dran** zum Selbstklicken (z. B. OBS-Overlay öffnen, Glücksrad öffnen) – weiter geht es erst nach dem Klick, der Rest der Seite ist solange gesperrt („Überspringen“ geht immer). Esc oder ✕ beendet die Tour; zum Schluss gibt es den Abschluss mit dem Weg zu **Dein Start**.
- **Überspringen** oben springt direkt in die Tour, ✕ schließt die Einführung.

## Admin-Bereich

Unter **`/admin.html`** (auch verlinkt unter dem Login-Formular) gibt es einen Admin-Zugang **ohne Registrierung**, nur mit Passwort. Er zeigt Live-Daten und aktualisiert sich alle 5 Sekunden:

- Kennzahlen: registrierte Nutzer, Drehungen heute und gesamt, Einlösungen per Kanalpunkte, ausgegebene Kanalpunkte
- Säulendiagramm der Drehungen pro Tag (Kanalpunkte / Webseite) für die letzten 14 Tage
- Live-Feed der letzten 40 Drehungen
- Verteilung auf die drei Glücksrad-Varianten
- Twitch-Status (Verbindung, Belohnung, Webhook, Token) mit Button „Live bei Twitch prüfen“
- **Streamer-Kanäle**: Bewerbungen neuer Streamer mit Nachricht – **Freischalten**, **Sperren** oder **Zurückstellen** (siehe „Plattform: viele Streamer“)
- Nutzerliste mit Suche. Hier lassen sich Admin-Rechte vergeben, also wer die Kacheln bearbeiten darf (gilt nur im Standard-Kanal; in den anderen Kanälen sind es Inhaber und freigegebene Mods).

Mit **„Webseite als Admin öffnen“** (oben rechts) öffnet sich die Webseite in einem neuen Tab, als interner Account „StreamHelp-Admin“ mit allen Admin-Rechten: Glücksrad drehen, Kacheln bearbeiten, Twitch verbinden. Dieser Account hat kein Passwort und ist nur über den Admin-Bereich erreichbar. Auf der Webseite führt der Button „Admin“ zurück.

Das Passwort steht **nicht** im Code, weil das Repo öffentlich ist. Es liegt als Secret `ADMIN_PASSWORD` in Supabase und wird im Setup-Skript abgefragt. Später ändern:

```bash
npx supabase secrets set "ADMIN_PASSWORD='neues-langes-passwort'"
```

Ein neues Passwort meldet alle offenen Admin-Sitzungen ab. Nach 10 Fehlversuchen in 15 Minuten ist der Login für 15 Minuten gesperrt. Im Demo-Modus lautet das Passwort `demo` (2FA-Code `123456`).

**Zwei-Faktor-Code (Pflicht, Migration …_security.sql):** Beim ersten Login nur mit Passwort zeigt der Admin-Bereich einen QR-Code für die Authenticator-App. Nach dem Bestätigen gilt: Passwort **und** Code. Das Geheimnis liegt in `public.admin_mfa` (nur die Edge Function liest es). Handy verloren: `NOTFALLPLAN.md`, Abschnitt 4. Die Admin-Sitzung liegt nur im Arbeitsspeicher des Tabs (nicht im Browser-Speicher) – nach dem Neuladen oder nach „Twitch-Bot verbinden“ einfach wieder einloggen. Unter **Sicherheits-Check** prüft der Admin-Bereich die Datenbank.

## Wichtig zu wissen

- **Kanalpunkte gibt es nur für Twitch-Affiliates und Partner.** Ohne diesen Status schlägt das Anlegen der Belohnung fehl.
- Die Belohnung muss von dieser App angelegt werden, sonst darf die App die Einlösungen nicht als erledigt markieren. Existiert schon eine gleichnamige, manuell erstellte Belohnung, lösche sie vorher im Twitch-Dashboard.
- Die Chat-Nachricht schreibt der Chat-Bot (Schritt 6), nie der Account des Streamers.
- **Edge Functions immer mit `--no-verify-jwt` deployen** (oder über `supabase/config.toml`, die CLI liest das). Twitch schickt beim Zurückleiten nach der Freigabe und beim Webhook keinen Supabase-Login mit. Ist die JWT-Prüfung an, endet der Streamer nach der Freigabe auf einer Seite mit `Missing authorization header`.
- **Glücksrad-Felder ändern:** in Supabase unter *Table Editor → wheel_variants → segments* (JSON mit `label` und `detail`). Die Werte in `js/defaults.js` gelten nur für den Demo-Modus.
- **Weitere Kacheln:** neue Zeile in der Tabelle `tiles` mit `kind = 'countdown'` anlegen.
- **Vorschläge:** stehen in `ideas`, die Stimmen in `idea_votes`. Solange die Migration `…_ideas.sql` nicht eingespielt ist, blendet die Seite den Bereich einfach aus.
