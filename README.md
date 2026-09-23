# Zugfahrer_DaveTV · Content-Stellwerk

Webseite zum Verwalten von Content-Ideen für den Twitch-Streamer **Zugfahrer_DaveTV**:

- **Intro als filmische Deutschland-Fahrt** mit sechs klaren Shots: Bergpass mit Zuglicht aus der Ferne → Fahrt um den Berg → Tunnel-Einfahrt → Tunnelausfahrt → Bahnhofseinfahrt → Türenöffnung und Einstieg. Die Bühne ist 3D-ready mit Tiefenebenen, filmischen Shot-Markern und proportionaler 4K-Darstellung ohne Bitmap-Vergrößerung; dazu **Bahnhofs-Gong, Zugrattern, Wind, Tunnelhall und wetterabhängige Klangkulisse**, Wetteranzeige, Bergsilhouette, Tunnellicht, Regen, Schnee, Gewitterblitze, Lichtreflexe und Filmkörnung. Wer das Tunnellicht dreimal schnell anklickt oder dreimal `T` drückt, aktiviert die geheime Sonderfahrt.
- **Animierter Hintergrund**: ziehende Lichter, Sternenfeld, Bodennebel, Oberleitung und alle paar Minuten ein kleiner Zug
- **Anmelden / Registrieren** (E-Mail + Passwort) oder per **Social-Login** (Twitch, Discord, Google, Spotify, GitHub)
- **Nächste Abfahrt** groß im Kopf des Dashboards, daneben die Karte fürs **Fortnite-Glücksrad** mit 3 Varianten (Waffen-Roulette, Lande-Lotto, Handicap-Express)
- **Fahrplan**: Kacheln mit Hintergrund, Hover-Animation, Kurzbeschreibung und **Countdown** (Dave kann Titel, Text, Datum und Hintergrund bearbeiten)
- **Archiv**: Termine, die mehr als sechs Stunden zurückliegen, mit Link zu den Twitch-Aufzeichnungen
- **Vorschläge**: Zuschauer reichen Ideen für den Fahrplan ein und stimmen darüber ab
- **OBS-Overlay** (`overlay.html`): Wird das Glücksrad gedreht, erscheint es klein im Stream, dreht sich und zeigt das Ergebnis. Dazu läuft die nächste Abfahrt mit Countdown. Den Link gibt's im Dashboard unter **OBS**.
- **Twitch-Integration**: Dave verbindet seinen Kanal, dann legt die Seite automatisch die Kanalpunkte-Belohnung **„Glücksrad“ (10.000 Punkte)** an. Löst ein Zuschauer sie ein, wird **ohne geöffnete Webseite** eine zufällige Variante gedreht und das Ergebnis im **Twitch-Chat** gepostet.

## Aufbau

```
index.html, css/, js/, assets/   → statische Seite für GitHub Pages
overlay.html                     → OBS-Browserquelle (Glücksrad + nächste Abfahrt)
supabase/migrations/             → Datenbank (Profile, Kacheln, Varianten, Drehungen, Vorschläge, Twitch-Tokens)
supabase/functions/
  twitch-oauth/                  → Twitch-Login für Dave, legt Belohnung + EventSub-Webhook an
  twitch-eventsub/               → empfängt Kanalpunkte-Einlösungen von Twitch, dreht, postet im Chat
  spin/                          → Drehung von der Webseite aus
```

GitHub Pages kann nur statische Dateien ausliefern. Damit Einlösungen auch ohne geöffnete Seite funktionieren, braucht Twitch einen Server, den es anrufen kann. Diese Rolle übernehmen die **Supabase Edge Functions** (der kostenlose Tarif reicht). Supabase kümmert sich außerdem um Accounts und die Datenbank.

## Demo-Modus

Solange in `js/config.js` nichts eingetragen ist, läuft die Seite im Demo-Modus. Accounts und Kacheln werden dann nur im Browser gespeichert, und der erste registrierte Account darf Kacheln bearbeiten. Mit „Kanalpunkte-Einlösung simulieren“ im Glücksrad lässt sich testen, wie eine Twitch-Einlösung aussieht.

Lokal starten (ES-Module brauchen einen Webserver):

```bash
npx http-server -p 5317
```

Das Intro erzwingen: `http://localhost:5317/?intro=1` (Länge über `INTRO_SECONDS` in `js/config.js`)

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
2. **SQL Editor** öffnen und die Dateien aus `supabase/migrations/` nacheinander in der Reihenfolge ihrer Namen einfügen und ausführen (`…_init.sql`, `…_admin.sql`, `…_social_login.sql`, `…_ideas.sql`, `…_overlay.sql`).
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

Mit der [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
```

```bash
supabase link --project-ref <projekt-ref>
```

```bash
supabase secrets set TWITCH_CLIENT_ID=xxx TWITCH_CLIENT_SECRET=xxx EVENTSUB_SECRET=<zufällige-zeichenkette-32-zeichen> SITE_URL=https://<dein-name>.github.io/<repo>/ BROADCASTER_LOGIN=zugfahrer_davetv
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
| `SITE_URL` | wohin Dave nach dem Twitch-Login zurückgeschickt wird |
| `BROADCASTER_LOGIN` | nur dieser Twitch-Kanal darf sich verbinden |
| `REWARD_TITLE` *(optional)* | Name der Belohnung, Standard `Glücksrad` |
| `REWARD_COST` *(optional)* | Kosten in Kanalpunkten, Standard `10000` |

### 5. Dave verbindet Twitch

1. Dave registriert sich auf der Webseite und meldet sich an.
2. Oben rechts auf **„Mit Twitch verbinden“** klicken, die Berechtigungen lesen und **„Weiter zu Twitch“** wählen.
3. Auf Twitch mit `zugfahrer_davetv` anmelden und den Zugriff erlauben:
   - `channel:manage:redemptions` (Belohnung anlegen, Einlösungen erledigen)
   - `channel:read:redemptions` (Einlösungen empfangen)
   - `user:write:chat` (Ergebnis im Chat posten)
4. Danach passiert automatisch Folgendes:
   - Die Belohnung „Glücksrad“ für 10.000 Kanalpunkte wird angelegt.
   - Der EventSub-Webhook wird registriert.
   - Daves Account wird Admin und darf die Kacheln bearbeiten.

Löst ab jetzt ein Zuschauer die Belohnung ein, passiert Folgendes:

1. Twitch ruft `twitch-eventsub` auf.
2. Eine zufällige Variante und ein zufälliges Feld werden ausgelost.
3. Im Chat erscheint zum Beispiel:
   > 🎡 Glücksrad für @Zuschauer: [Waffen-Roulette] Nur Schrotflinten – Nur Shotguns (und die Spitzhacke) sind erlaubt. Gilt für die nächste Runde!
4. Die Einlösung wird als erledigt markiert. Schlägt das Drehen fehl, bekommt der Zuschauer seine Punkte zurück.
5. Ist die Webseite gerade offen, dreht sich das Rad dort live mit (Supabase Realtime).

Dreht Dave selbst auf der Webseite, kann er mit dem Schalter „Ergebnis im Twitch-Chat posten“ bestimmen, ob das Ergebnis auch im Chat landet.

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

Neue Nutzer bekommen automatisch den Anzeigenamen vom jeweiligen Anbieter. „Mit Twitch anmelden“ (für Zuschauer) und „Mit Twitch verbinden“ (für Dave, Kanalpunkte und Chat) sind zwei getrennte Dinge.

## OBS-Overlay

Im Dashboard oben auf **OBS** klicken (nur für Admins sichtbar). Dort stellst du ein, in welcher Ecke das Glücksrad und die nächste Abfahrt erscheinen, siehst eine Vorschau und kopierst die fertige Adresse.

In OBS:

1. Unter **Quellen** auf **+** klicken → **Browser**.
2. Die kopierte Adresse einfügen, **Breite 1920**, **Höhe 1080**.
3. Optional **„Audio über OBS steuern“** anhaken, dann erscheinen Tick und Gong im Audio-Mixer.

Das Overlay ist durchsichtig, zu sehen sind nur die Karten. Das Glücksrad taucht nur auf, wenn jemand dreht – per Kanalpunkte oder auf der Webseite –, und verschwindet nach dem Ergebnis wieder.

| Option in der Adresse | Wirkung |
|---|---|
| `wheel=br` / `bl` / `tr` / `tl` / `0` | Ecke fürs Glücksrad (unten rechts, unten links, oben rechts, oben links, aus) |
| `next=bl` / … / `0` | Ecke für „Nächste Abfahrt“ |
| `scale=1.25` | Größe (0.5 bis 2) |
| `sound=0` | ohne Ton |
| `test=1` | alle 20 Sekunden eine Probe-Drehung – nur zum Ausrichten, danach wieder entfernen |

**Einmal nötig:** die Migration `supabase/migrations/20260923000000_overlay.sql` im SQL Editor ausführen. OBS hat keine Anmeldung, das Overlay liest deshalb ohne Login. Die Migration gibt dafür genau das frei, was ohnehin im Stream zu sehen ist: Kacheln, Glücksrad-Varianten und einen Feed der Drehungen (`overlay_spins`, ohne Nutzer-IDs). Fehlt sie, weist der OBS-Dialog darauf hin.

## Admin-Bereich

Unter **`/admin.html`** (auch verlinkt unter dem Login-Formular) gibt es einen Admin-Zugang **ohne Registrierung**, nur mit Passwort. Er zeigt Live-Daten und aktualisiert sich alle 5 Sekunden:

- Kennzahlen: registrierte Nutzer, Drehungen heute und gesamt, Einlösungen per Kanalpunkte, ausgegebene Kanalpunkte
- Säulendiagramm der Drehungen pro Tag (Kanalpunkte / Webseite) für die letzten 14 Tage
- Live-Feed der letzten 40 Drehungen
- Verteilung auf die drei Glücksrad-Varianten
- Twitch-Status (Verbindung, Belohnung, Webhook, Token) mit Button „Live bei Twitch prüfen“
- Nutzerliste mit Suche. Hier lassen sich Admin-Rechte vergeben, also wer die Kacheln bearbeiten darf.

Mit **„Webseite als Admin öffnen“** (oben rechts) landest du direkt auf der Webseite, als interner Account „Stellwerk-Admin“ mit allen Admin-Rechten: Glücksrad drehen, Kacheln bearbeiten, Twitch verbinden. Dieser Account hat kein Passwort und ist nur über den Admin-Bereich erreichbar. Auf der Webseite führt der Button „Admin“ zurück.

Das Passwort steht **nicht** im Code, weil das Repo öffentlich ist. Es liegt als Secret `ADMIN_PASSWORD` in Supabase und wird im Setup-Skript abgefragt. Später ändern:

```bash
npx supabase secrets set "ADMIN_PASSWORD='neues-langes-passwort'"
```

Ein neues Passwort meldet alle offenen Admin-Sitzungen ab. Nach 10 Fehlversuchen in 15 Minuten ist der Login für 15 Minuten gesperrt. Im Demo-Modus lautet das Passwort `demo`.

## Wichtig zu wissen

- **Kanalpunkte gibt es nur für Twitch-Affiliates und Partner.** Ohne diesen Status schlägt das Anlegen der Belohnung fehl.
- Die Belohnung muss von dieser App angelegt werden, sonst darf die App die Einlösungen nicht als erledigt markieren. Existiert schon eine gleichnamige, manuell erstellte Belohnung, lösche sie vorher im Twitch-Dashboard.
- Die Chat-Nachricht wird im Namen von Daves Account gesendet.
- **Glücksrad-Felder ändern:** in Supabase unter *Table Editor → wheel_variants → segments* (JSON mit `label` und `detail`). Die Werte in `js/defaults.js` gelten nur für den Demo-Modus.
- **Weitere Kacheln:** neue Zeile in der Tabelle `tiles` mit `kind = 'countdown'` anlegen.
- **Vorschläge:** stehen in `ideas`, die Stimmen in `idea_votes`. Solange die Migration `…_ideas.sql` nicht eingespielt ist, blendet die Seite den Bereich einfach aus.
