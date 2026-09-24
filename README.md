# Zugfahrer_DaveTV · Content-Stellwerk

Webseite zum Verwalten von Content-Ideen für den Twitch-Streamer **Zugfahrer_DaveTV**:

- **Intro als filmische Deutschland-Fahrt** mit sechs klaren Shots: Bergpass mit Zuglicht aus der Ferne → Fahrt um den Berg → Tunnel-Einfahrt → Tunnelausfahrt → Bahnhofseinfahrt → Türenöffnung und Einstieg. Die Bühne ist 3D-ready mit Tiefenebenen, filmischen Shot-Markern und proportionaler 4K-Darstellung ohne Bitmap-Vergrößerung; dazu **Bahnhofs-Gong, Zugrattern, Wind, Tunnelhall und wetterabhängige Klangkulisse**, Wetteranzeige, Bergsilhouette, Tunnellicht, Regen, Schnee, Gewitterblitze, Lichtreflexe und Filmkörnung. Wer das Tunnellicht dreimal schnell anklickt oder dreimal `T` drückt, aktiviert die geheime Sonderfahrt.
- **Animierter Hintergrund**: ziehende Lichter, Sternenfeld, Bodennebel, Oberleitung und alle paar Minuten ein kleiner Zug
- **Anmelden / Registrieren** (E-Mail + Passwort) oder per **Social-Login** (Twitch, Discord, Google, Spotify, GitHub)
- **Nächste Abfahrt** groß im Kopf des Dashboards, daneben die Karte fürs **Fortnite-Glücksrad** mit 3 Varianten (Waffen-Roulette, Lande-Lotto, Handicap-Express)
- **Fahrplan**: Kacheln mit Hintergrund, Hover-Animation, Kurzbeschreibung und **Countdown** (Dave kann Titel, Text, Datum und Hintergrund bearbeiten)
- **Archiv**: Termine, die mehr als sechs Stunden zurückliegen, mit Link zu den Twitch-Aufzeichnungen
- **Vorschläge**: Zuschauer reichen Ideen für den Fahrplan ein und stimmen darüber ab
- **Ärgere den Dave**: Zuschauer lösen mit Kanalpunkten „🍅 Wirf was auf Dave“ oder „🔊 Sound für Dave“ ein und tippen ein, was fliegen bzw. laufen soll – Bananen, Tomaten, Torten & Co. landen auf Daves Kamera, Sounds (eingebaute oder selbst hochgeladene) laufen im Stream. Admins stellen Kosten, Abklingzeit und An/Aus ein und können auf der Seite direkt auslösen.
- **Fortnite-Bingo**: Admins laden Bilder von Fortnite-Items hoch, daraus zieht die Seite eine zufällige Bingo-Karte (3×3, 4×4 oder 5×5). Daves Karte wird im Stream abgehakt und ist im OBS-Overlay zu sehen; dazu kann sich jeder seine eigene Karte ziehen und selbst abkreuzen.
- **OBS-Overlay** (`overlay.html`): Wird das Glücksrad gedreht, erscheint es klein im Stream, dreht sich und zeigt das Ergebnis. Dazu läuft die nächste Abfahrt mit Countdown. Den Link gibt's im Dashboard unter **OBS**.
- **Twitch-Integration**: Dave verbindet seinen Kanal, dann legt die Seite automatisch die Kanalpunkte-Belohnung **„Glücksrad“ (10.000 Punkte)** an. Löst ein Zuschauer sie ein, wird **ohne geöffnete Webseite** eine zufällige Variante gedreht, und ein eigener **Chat-Bot** schreibt das Ergebnis in den Twitch-Chat – nie in Daves Namen.

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
2. **SQL Editor** öffnen und die Dateien aus `supabase/migrations/` nacheinander in der Reihenfolge ihrer Namen einfügen und ausführen (`…_init.sql`, `…_admin.sql`, `…_social_login.sql`, `…_ideas.sql`, `…_overlay.sql`, `…_chat_bot.sql`, `…_pranks.sql`, `…_bingo.sql`, `…_start_dates.sql`, `…_channel_points.sql`, `…_bingo_rarity.sql`).
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
   - `channel:bot` (der Chat-Bot darf in seinem Chat schreiben)
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

Dreht Dave selbst auf der Webseite, kann er mit dem Schalter „Ergebnis als … im Chat posten“ bestimmen, ob das Ergebnis auch im Chat landet.

### 6. Chat-Bot verbinden

Die Ergebnisse schreibt ein eigener Twitch-Account in den Chat, nicht Dave. Ohne verbundenen Bot bleibt der Chat still, das Rad dreht trotzdem.

1. Auf Twitch einen eigenen Account für den Bot anlegen, z. B. `StellwerkBot`. Sein Name steht später im Chat.
2. Auf twitch.tv mit **diesem Bot-Account** anmelden (in einem privaten Fenster geht es am einfachsten).
3. Im selben Fenster den **Admin-Bereich** (`admin.html`) öffnen, mit dem Admin-Passwort anmelden und im Kasten **Twitch → Chat-Bot** auf **„Bot verbinden“** klicken. Nur dort geht das – auf der Webseite gibt es den Knopf nicht.
4. Twitch fragt jetzt den Bot-Account nach `user:write:chat` und `user:bot`. Erlauben. Danach geht es zurück in den Admin-Bereich, dort steht „Chat-Bot … ist verbunden“.

Gesendet wird mit dem App-Token der Twitch-App. Twitch zeigt am Bot dann das Bot-Abzeichen. Dafür braucht es Daves Recht `channel:bot` aus Schritt 5. Hat Dave schon vorher verbunden, einmal **„Neu verbinden“**, oder den Bot im Kanal zum Moderator machen (`/mod StellwerkBot`).

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

Im Dashboard oben auf **OBS** klicken – das kann jeder, der angemeldet ist. Am einfachsten auf dem PC, auf dem OBS läuft:

1. **Mit OBS verbinden:** In OBS unter **Werkzeuge → WebSocket-Servereinstellungen** „WebSocket-Server aktivieren“ anhaken, über „Verbindungsinfo anzeigen“ das Passwort kopieren und im Dialog eintragen (OBS 28 oder neuer). Fragt der Browser nach Zugriff aufs lokale Netzwerk: zulassen.
2. Die Vorschau zeigt jetzt das **echte OBS-Bild** (etwa jede Sekunde neu). Die Seite erkennt Daves Kamera in der Szene und legt den **roten Rahmen** darauf – dort landen die Würfe. Stimmt die Erkennung nicht, eine andere Quelle wählen oder den Rahmen selbst verschieben und an der Ecke in der Größe ändern.
3. **Karten verschieben:** Glücksrad, nächste Abfahrt und Bingo in der Vorschau mit der Maus an ihren Platz ziehen; sie rasten am Rand und in der Mitte ein. Darunter: was zu sehen ist, Größen, Lautstärke – der Rest unter „Mehr Einstellungen“.
4. **In OBS übernehmen:** legt in der aktuellen Szene die Browserquelle **„Stellwerk-Overlay“** an (1920 × 1080, Ton über OBS) und schiebt sie ganz nach oben, über die Kamera. Nach Änderungen einfach noch einmal klicken – dann wird nur die Adresse aktualisiert.

Das Passwort bleibt nur in diesem Browser; die Verbindung geht direkt an OBS auf `127.0.0.1:4455`, nicht ins Internet. Ohne Verbindung geht es auch: „OBS-Fenster teilen“ zeigt ein geteiltes Fenster (z. B. einen Fenster-Projektor) als Hintergrund der Vorschau, und die Adresse lässt sich kopieren und von Hand als Browserquelle (Breite 1920, Höhe 1080) einfügen.

Das Overlay ist durchsichtig, zu sehen sind nur die Karten. Das Glücksrad taucht nur auf, wenn jemand dreht – per Kanalpunkte oder auf der Webseite –, und verschwindet nach dem Ergebnis wieder (außer mit `always=1`). Für verschiedene Szenen kannst du mehrere Browserquellen mit unterschiedlichen Adressen anlegen.

| Option in der Adresse | Wirkung |
|---|---|
| `wheel=br` / `bc` / `bl` / `tr` / `tc` / `tl` / `0` | Position Glücksrad (unten rechts, unten Mitte, unten links, oben …, aus) – oder frei wie `wheel=62.5,70` (linke obere Ecke in Prozent; so speichert es das Verschieben in der Vorschau) |
| `next=bl` / … / `0` | Position „Nächste Abfahrt“ (auch frei wie beim Glücksrad) |
| `wsize=120`, `nsize=80` | Größe der Karten in Prozent (50 bis 200); `scale=1.2` gilt für beide |
| `from=twitch` / `web` | nur Kanalpunkte-Drehungen bzw. nur Drehungen auf der Seite zeigen |
| `hold=15` | Sekunden, die das Ergebnis stehen bleibt (3 bis 60) |
| `always=1` | Glücksrad dauerhaft zeigen, zwischen den Drehungen mit „Kanalpunkte einlösen zum Drehen“ |
| `vcolor=0` | Glücksrad in der Akzentfarbe statt in der Farbe der Variante |
| `wlabel=…`, `nlabel=…` | eigene Überschriften der Karten |
| `rotate=20` | Sekunden bis zur nächsten Content-Idee (5 bis 120) |
| `margin=80` | Abstand zum Bildrand in Pixeln |
| `bg=50` | Deckkraft des Kartenhintergrunds in Prozent (0 = nur Schrift) |
| `accent=3ddc84` | Akzentfarbe (Hex ohne `#`) |
| `vol=40` | Lautstärke in Prozent, `0` = ohne Ton |
| `bingo=tl` / … / `0` | Position der Bingo-Karte (Standard oben rechts) |
| `bsize=80` | Größe der Bingo-Karte in Prozent |
| `bstyle=classic` / `neon` / `paper` | Design der Bingo-Karte: Klassisch (dunkel), Neon (leuchtende Rahmen) oder Papier (Bingo-Schein mit Stempel) |
| `prank=0` | „Ärgere den Dave“ ausblenden (keine Würfe, keine Sounds) |
| `cam=73,72,25,25` | Daves Kamera im Bild: links, oben, Breite, Höhe in Prozent – dort landen die Würfe |
| `psize=150` | Größe der Wurfgeschosse in Prozent |
| `test=1` | alle 20 Sekunden eine Probe-Drehung – nur zum Ausrichten, danach wieder entfernen |

**Daves Kamera:** Im OBS-Dialog unter „Ärgere den Dave“ eine Vorlage wählen oder in der Vorschau einen Rahmen um die Stelle ziehen, an der die Kamera im Stream sitzt. In OBS die Browserquelle **über** die Kamera-Quelle schieben, sonst fliegt alles hinter Dave vorbei. Läuft das Overlay in mehreren Browserquellen, bei allen außer einer `prank=0` setzen – sonst kommt jeder Sound doppelt.

**Einmal nötig:** die Migration `supabase/migrations/20260923000000_overlay.sql` im SQL Editor ausführen. OBS hat keine Anmeldung, das Overlay liest deshalb ohne Login. Die Migration gibt dafür genau das frei, was ohnehin im Stream zu sehen ist: Kacheln, Glücksrad-Varianten und einen Feed der Drehungen (`overlay_spins`, ohne Nutzer-IDs). Fehlt sie, weist der OBS-Dialog darauf hin.

## Ärgere den Dave

Kachel im Fahrplan, jederzeit verfügbar. Einmal nötig: `supabase/migrations/20260924000000_pranks.sql` im SQL Editor ausführen. Das legt die Kachel an, die Tabellen und den Storage-Bucket `sounds` für eigene Sounds.

- **Kanalpunkte:** Beim Verbinden mit Twitch (und bei jedem Speichern der Einstellungen) legt die Seite in Daves Kanal zwei Belohnungen an: **„🍅 Wirf was auf Dave“** (Standard 500 Punkte) und **„🔊 Sound für Dave“** (300 Punkte). Zuschauer tippen beim Einlösen ein, was fliegen bzw. welcher Sound laufen soll – Tippfehler und Emojis werden erkannt. Unbekanntes gibt die Punkte zurück, der Chat-Bot sagt, was es gibt. Die Webseite zeigt Zuschauern die Liste zum Kopieren und eine Vorschau; direkt auslösen können dort nur Admins. Migration `20260925000000_channel_points.sql` nötig; bei Belohnungen, die schon vorher bestanden, einmal im Dialog „Auf Twitch übernehmen“ klicken.
- **Werfen:** Banane, Tomate, Torte, Ei, Fisch, Quietscheente, Stinkesocke, Schneeball – oder Blumen, wenn man nett sein will. Im Overlay fliegt das Geschoss auf Daves Kamera und hinterlässt einen Fleck.
- **Sounds:** neun eingebaute Töne (vom Browser erzeugt, keine Dateien) und eigene Sounds. Hochladen darf jeder Angemeldete bis zu 8 Sounds, je höchstens 10 Sekunden und 1 MB (MP3, OGG, WAV, M4A). Löschen kann man die eigenen, Admins alle.
- **Für Admins** im Dialog: Belohnungen an/aus, Kosten, Abklingzeit auf Twitch (Standard 20 Sekunden), eigene Sounds erlauben, Startdatum. „Auf Twitch übernehmen“ gleicht die Belohnungen an; vor dem Startdatum sind sie auf Twitch aus – danach beim nächsten Öffnen des Dialogs durch einen Admin automatisch an.

Direkt von der Webseite lässt die Datenbank nur Admins werfen (`send_prank`); alle anderen gehen über Kanalpunkte (`twitch-eventsub`). Der Feed `pranks` enthält nur Anzeigename, Gegenstand und Sound – keine Nutzer-IDs –, damit OBS ihn ohne Anmeldung lesen kann.

## Fortnite-Bingo

Kachel im Fahrplan. Einmal nötig: `supabase/migrations/20260924120000_bingo.sql` im SQL Editor ausführen. Das legt die Kachel an, die Tabellen und den Storage-Bucket `bingo`.

1. Auf der Webseite als Admin die Kachel **Fortnite-Bingo** öffnen.
2. Rechts unter **Bilder** Bilder der Items wählen – mehrere auf einmal gehen. Der Name kommt aus dem Dateinamen (`chug-jug.png` → „Chug Jug“) und lässt sich danach ändern. Die Bilder werden vor dem Hochladen verkleinert.
   Jedes Bild kann eine **Seltenheit** wie in Fortnite haben – Gewöhnlich (grau), Ungewöhnlich (grün), Selten (blau), Episch (lila), Legendär (gold), **Mythisch** (gold mit Glanz) oder Exotisch. Steht sie im Dateinamen (`scar_legendary.png`, `pump-episch.png`, `mythic_goldfish.png`), wird sie gleich erkannt; sonst in der Liste neben dem Bild wählen. Items ohne Seltenheit (z. B. Heilung) bekommen eine bunte Farbe, die es bei Waffen nicht gibt. Migration `20260925120000_bingo_rarity.sql` nötig.
3. Größe wählen und **Neue Karte ziehen**. Für 5×5 mit freier Mitte braucht es 24 Bilder, für 4×4 16, für 3×3 8.
4. Im Stream die gefundenen Items auf der Karte anklicken. Eine volle Reihe, Spalte oder Diagonale zeigt „Bingo!“ – auf der Seite und im Overlay, mit Applaus.

Zuschauer sehen Daves Karte nur an. Unter **Meine Karte** zieht sich jeder seine eigene Karte aus denselben Bildern und kreuzt selbst ab (gespeichert in `bingo_player_cards`, nur für einen selbst sichtbar). **Im Stream zeigen** blendet Daves Karte im Overlay aus und ein, **Haken entfernen** fängt dieselbe Karte neu an.

Im OBS-Dialog unter **🎨 Bingo-Design** gibt es drei Looks für die Karte im Overlay: **Klassisch**, **Neon** und **Papier**.

## Startdatum für Zuschauer

„Ärgere den Dave“ und das Fortnite-Bingo können einen Starttermin haben (Migration `20260924180000_start_dates.sql`, Standard: 01.10.2026, 20 Uhr). Bis dahin sehen Zuschauer auf der Kachel einen Countdown und können nichts werfen – das prüft auch die Datenbank. Admins benutzen beides schon vorher und sehen auf der Kachel „🔒 Zuschauer ab …“. Den Termin ändert ein Admin im jeweiligen Dialog unter „Für Zuschauer freigeschaltet ab“; leer lassen heißt: sofort für alle.

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
- Die Chat-Nachricht schreibt der Chat-Bot (Schritt 6), nie Daves Account.
- **Edge Functions immer mit `--no-verify-jwt` deployen** (oder über `supabase/config.toml`, die CLI liest das). Twitch schickt beim Zurückleiten nach der Freigabe und beim Webhook keinen Supabase-Login mit. Ist die JWT-Prüfung an, endet Dave nach der Freigabe auf einer Seite mit `Missing authorization header`.
- **Glücksrad-Felder ändern:** in Supabase unter *Table Editor → wheel_variants → segments* (JSON mit `label` und `detail`). Die Werte in `js/defaults.js` gelten nur für den Demo-Modus.
- **Weitere Kacheln:** neue Zeile in der Tabelle `tiles` mit `kind = 'countdown'` anlegen.
- **Vorschläge:** stehen in `ideas`, die Stimmen in `idea_votes`. Solange die Migration `…_ideas.sql` nicht eingespielt ist, blendet die Seite den Bereich einfach aus.
