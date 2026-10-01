# StreamHelp

Die Stream-Zentrale für einen Twitch-Kanal – Content-Ideen, Chat-Bot, Kanalpunkte, Alerts und OBS-Overlay an einem Ort (wie StreamElements und ein Chat-Bot zusammen, nur für diesen einen Kanal):

- **Öffentliche Startseite** nach dem Entwurf „StreamHelp Startseite“ aus Claude Design (Designsystem Nocturne, `css/landing.css`, Icons von Phosphor lokal in `assets/fonts/`): „Dein Stream. Eine Zentrale.“, Overlay-Vorschau, Funktionen, Rollen, drei Schritte, Sicherheit. „Mit Twitch anmelden“ springt direkt zu Twitch, wenn der Anbieter in Supabase aktiv ist
- **Animierte Anmeldeseite**: schwebende Lichter, Ringe und Funken, leuchtender Rand um die Karte – nach dem Anmelden fliegt die Karte weg und ein lila Kreis öffnet das Dashboard
- **Dashboard mit Seitenleiste links**: eingeklappt nur Symbole, zuerst die Kacheln der **Content-Ideen**; ausgeklappt alles – Vorschläge & Archiv, Bot & Chat, Kanalpunkte, Alerts, Overlay & OBS, Raid-Schutz, Mods, Twitch-Verbindung
- **Streameransicht / Modansicht** oben zum Umschalten, **OBS** oben rechts
- **Twitch-Gesundheitscheck**: prüft automatisch, ob die Twitch-Verbindung alle Rechte für die neuesten Funktionen hat und die Abos für Alerts, Kanalpunkte und Chat laufen – repariert, was geht, und meldet den Rest Streamer, Mods und Admin
- **Anmelden / Registrieren** (E-Mail + Passwort) oder per **Social-Login** (Twitch, Discord, Google, Spotify, GitHub)
- **Als Nächstes** groß im Kopf der Content-Ideen, daneben die Karte fürs **Fortnite-Glücksrad** mit 4 Varianten (Waffen-Roulette, Lande-Lotto, Handicap-Runde, Waffen-Lotto – dort dreht nach der Waffe sofort ein zweites Rad die Seltenheit) – Admins ändern Ergebnisse, Varianten und Kanalpunkte-Kosten direkt auf der Seite
- **Content-Ideen**: Kacheln mit Hintergrund, Hover-Animation, Kurzbeschreibung und **Countdown** (der Streamer kann Titel, Text, Datum und Hintergrund bearbeiten)
- **Archiv**: Termine, die mehr als sechs Stunden zurückliegen, mit Link zu den Twitch-Aufzeichnungen
- **Vorschläge**: Zuschauer reichen Ideen für den Stream ein und stimmen darüber ab
- **Ärgere den Streamer**: Zuschauer lösen mit Kanalpunkten „🍅 Wirf was auf ‹Kanal›“ oder „🔊 Sound für ‹Kanal›“ ein und tippen ein, was fliegen bzw. laufen soll – Bananen, Tomaten, Torten & Co. landen auf Kamera des Streamers, Sounds (eingebaute oder selbst hochgeladene) laufen im Stream. Admins stellen Kosten, Abklingzeit und An/Aus ein und können auf der Seite direkt auslösen.
- **Fortnite-Bingo**: Die Bilder kommen automatisch aus einer eingebauten Item-Liste oder – mit Schlüssel – aus dem aktuellen Fortnite-Lootpool (dazu eigene Bilder, z. B. Kills), daraus zieht die Seite eine zufällige Bingo-Karte (3×3, 4×4 oder 5×5). die Stream-Karte wird im Stream abgehakt und ist im OBS-Overlay zu sehen; dazu kann sich jeder seine eigene Karte ziehen und selbst abkreuzen.
- **Sieben weitere Ideen**: Verbotenes Wort, Subathon-Timer, Pausen-Bildschirm mit Zahlenraten, Quiz, Mitspieler-Warteschlange, Vorlesen per Kanalpunkte und Sammelkarten – jeweils mit Chat-Befehlen und eigener OBS-Ebene.
- **Raid-Schutz**: ein Klick pausiert alle Zuschauer-Aktionen (siehe „Sicherheit“).
- **OBS-Overlay** (`overlay.html`): Wird das Glücksrad gedreht, erscheint es klein im Stream, dreht sich und zeigt das Ergebnis. Dazu läuft „Als Nächstes“ mit Countdown, und ein Alert-Feld zeigt neue Follower, Abos, Bits und Kanalpunkte-Einlösungen. Den Link gibt's im Dashboard unter **OBS** (oben rechts) und **Overlay & OBS**.
- **Twitch-Integration**: Der Streamer verbindet seinen Kanal, dann legt die Seite automatisch die Kanalpunkte-Belohnung **„Glücksrad“ (10.000 Punkte, änderbar)** an. Löst ein Zuschauer sie ein, wird **ohne geöffnete Webseite** eine zufällige Variante gedreht, und ein eigener **Chat-Bot** schreibt das Ergebnis in den Twitch-Chat – nie im Namen des Streamers.

## Aufbau

```
index.html, css/, js/, assets/   → statische Seite für GitHub Pages
overlay.html                     → OBS-Browserquelle (alle Ebenen, live eingestellt)
supabase/migrations/             → Datenbank (Profile, Kacheln, Varianten, Drehungen, Vorschläge, Twitch-Tokens)
supabase/functions/
  twitch-oauth/                  → Twitch-Login für Streamer und Bot, Belohnungen, EventSub-Abos, Gesundheitscheck
  twitch-eventsub/               → empfängt Kanalpunkte-Einlösungen von Twitch, dreht, postet im Chat
  spin/                          → Drehung von der Webseite aus
  bingo-bet/                     → Bingo-Tipprunde als Twitch-Vorhersage (starten, auflösen, abbrechen)
  youtube-chat/                  → YouTube-Livechat fürs Overlay (ohne API-Schlüssel)
  bingo-loot/                    → Bingo-Bilder: eingebaute Item-Liste oder aktueller Lootpool (api-fortnite.com)
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
2. **SQL Editor** öffnen und die Dateien aus `supabase/migrations/` nacheinander in der Reihenfolge ihrer Namen einfügen und ausführen (`…_init.sql`, `…_admin.sql`, `…_social_login.sql`, `…_ideas.sql`, `…_overlay.sql`, `…_chat_bot.sql`, `…_pranks.sql`, `…_bingo.sql`, `…_start_dates.sql`, `…_channel_points.sql`, `…_bingo_rarity.sql`, `…_bingo_amount.sql`, `…_bingo_bet.sql`, `…_security.sql`, `…_questions_pet.sql`, `…_ticker.sql`, `…_live_overlay.sql`, `…_loot_shop.sql`, `…_shop_versus.sql`, `…_win_challenge.sql`, `…_challenge_start.sql`, `…_stream_alerts.sql`, `…_wheel_edit.sql`, `…_wheel_bonus.sql`, `…_shop_lobby_access.sql`, `…_alert_bits_sounds.sql`, `…_alert_sound_length.sql`, `…_streamer_mods.sql`, `…_bingo_lootpool.sql`, `…_stream_extras.sql`, `…_security_hardening.sql`, `…_streamhelp.sql`, `…_chat_bot_commands.sql`, `…_overlay_designs.sql`, `…_overlay_hack.sql`, `…_channel_anniversary.sql`).
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
| `API_FORTNITE_KEY` *(fürs Bingo, optional)* | Schlüssel von [api-fortnite.com](https://api-fortnite.com) (der Lootpool braucht dort einen bezahlten Tarif) – damit holt `bingo-loot` den aktuellen Lootpool statt der eingebauten Item-Liste |

### 5. Der Streamer verbindet Twitch

1. Der Streamer registriert sich auf der Webseite und meldet sich an.
2. In der Seitenleiste auf **🟣 Twitch-Verbindung** (nur in der Streameransicht) und **„Mit Twitch verbinden“** klicken.
3. Auf Twitch mit dem Kanal aus `BROADCASTER_LOGIN` anmelden und den Zugriff erlauben:
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

### 7. Eigene Befehle und !watchtime

Im Dashboard unter **🤖 Bot & Chat** legen Streamer, Admins und freigegebene Mods **eigene Befehle** an: Befehl (z. B. `!discord`) und feste Antwort, dazu Pause in Sekunden, „Nur Mods“ und an/aus. Platzhalter in der Antwort: `{user}` (Name des Schreibers), `{count}` (wie oft der Befehl benutzt wurde), `{watchtime}` (Watchtime des Schreibers), `{streamer}`. Eingebaute Befehle (`!join`, `!watchtime` …) lassen sich nicht überschreiben; `!befehle` listet alle aktiven im Chat. Beispiele `!lurk`, `!hydrate` und `!socials` sind vorbereitet.

**`!watchtime`** antwortet mit der eigenen Zuschauzeit, `!watchtime @name` mit der eines anderen (nur, wenn der Name bekannt ist – der Bot wiederholt nie eingetippten Text). Gezählt wird, solange der Stream live ist: Das OBS-Overlay stößt alle 5 Minuten die Edge Function `stream-tools` an, die bei Twitch nachsieht, ob der Kanal live ist, und allen im Chat die Zeit gutschreibt (höchstens alle 4,5 Minuten, Streamer und Bot zählen nicht). Dafür braucht die Seite das neue Twitch-Recht `moderator:read:chatters` – der Gesundheitscheck meldet es, dann **Twitch einmal neu verbinden**. Bis dahin zählen alle, die in den letzten 10 Minuten geschrieben haben. Die Rangliste steht im Dashboard unter Bot & Chat.

Einmal nötig: Migration `20261017000000_chat_bot_commands.sql`.

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

Nach dem Anmelden kommt das **Dashboard**. Links die **Seitenleiste** (☰ klappt sie aus, der Zustand bleibt gespeichert; auf dem Handy öffnet ☰ sie über dem Inhalt). Zuerst stehen immer die **🎬 Content-Ideen**. Zuschauer sehen nur Content-Ideen und Vorschläge & Archiv; Streamer, Admins und freigegebene Mods zusätzlich die **Stream-Werkzeuge**:

| Bereich | Was es dort gibt |
|---|---|
| 🤖 **Bot & Chat** | Bot-Konto verbinden/trennen, alle Chat-Befehle, was der Bot von selbst schreibt |
| 🎟️ **Kanalpunkte** | alle Belohnungen mit Kosten und Stand; „Kosten & Einstellungen“ öffnet das passende Fenster |
| 🔔 **Alerts** | Twitch-Gesundheitscheck mit „Jetzt prüfen & reparieren“, Probe-Alerts (auch Kanalpunkte) |
| 🎛️ **Overlay & OBS** | Adresse der Browserquelle, OBS-Fenster öffnen |
| 🛡️ **Raid-Schutz** | alle Zuschauer-Aktionen mit einem Klick pausieren |
| 👥 **Mods** | Mods von Twitch holen, Freigabe (nur Streamer) |
| 🟣 **Twitch-Verbindung** | Kanal verbinden, neu verbinden, trennen (nur Streameransicht) |

Oben schaltest du zwischen **🎥 Streameransicht** und **🛡️ Modansicht** um. Die Modansicht zeigt genau das, was freigegebene Mods sehen: alles – auch die **Kanalpunkte-Kosten** und das **Bot-Konto** – außer Twitch verbinden/trennen und der Mod-Freigabe. Mods haben nur die Modansicht. **🎛️ OBS** oben rechts öffnet das OBS-Fenster.

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

1. **Mit OBS verbinden:** In OBS unter **Werkzeuge → WebSocket-Servereinstellungen** „WebSocket-Server aktivieren“ anhaken, über „Verbindungsinfo anzeigen“ das Passwort kopieren und im Dialog eintragen (OBS 28 oder neuer). Fragt der Browser nach Zugriff aufs lokale Netzwerk: zulassen.
2. Die Vorschau zeigt jetzt das **echte OBS-Bild** (etwa jede Sekunde neu). Die Seite erkennt die Kamera des Streamers in der Szene und legt den **roten Rahmen** darauf – dort landen die Würfe. Stimmt die Erkennung nicht, eine andere Quelle wählen oder den Rahmen selbst verschieben und an der Ecke in der Größe ändern.
3. **Karten verschieben:** Karten in der Vorschau mit der Maus an ihren Platz ziehen; sie rasten am Rand und in der Mitte ein. Rechts bei den Ebenen: was zu sehen ist, Größen und die Einstellungen jeder Karte.
4. **In OBS übernehmen:** legt in der aktuellen Szene die Browserquelle **„StreamHelp-Overlay“** an (eine alte „Stellwerk-Overlay“-Quelle wird dabei umbenannt) (1920 × 1080, Ton über OBS) und schiebt sie ganz nach oben, über die Kamera.

**Live:** Die Browserquelle bekommt die feste Adresse `overlay.html?live=1`. Alle Einstellungen aus dem Dialog liegen in der Datenbank (`overlay_config`) – jede Änderung im Dialog wird sofort gespeichert und das Overlay in OBS lädt sich von selbst neu. Einmal einrichten reicht, danach nie wieder die Adresse tauschen. Ändern darf **der Streamer** (wer Twitch verbunden hat, und der Admin-Bereich); im Dialog kann der Streamer mit **„Admins (Mods) dürfen das Overlay anpassen“** den Admins der Seite das Anpassen erlauben. Alle anderen sehen die aktuellen Einstellungen nur an. Migration `20260930000000_live_overlay.sql` nötig – ohne sie enthält die Adresse wie früher alle Einstellungen.

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
| `quiz=bl` / … · `qzsize=120` | Quizfrage (nur solange eine läuft) |
| `queue=tl` / … · `qusize=120` | Mitspielen: wer dran ist, wer wartet |
| `tts=bc` / … · `ttsize=120` | Vorlesen – ohne diese Ebene liest das Overlay nichts vor |
| `cards=br` / … · `cdsize=120` | Sammelkarten: epische und legendäre Ziehungen |
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

Alles, was im Overlay Töne macht, hat im OBS-Fenster unter **„Aussehen & Ton“ → 🎚️ Lautstärke je Ebene** einen eigenen Regler: Glücksrad, Alerts, Würfe & Sounds, Dino, Fragen, Bingo, Kisten-Shop, Win-Challenge, Vorlesen, Quiz, Verbotenes Wort, Subathon, Pause und Sammelkarten. 100 % = so laut wie die Gesamtlautstärke, 0 % = stumm (🔇), bis 200 % lauter. Regler ausgeschalteter Ebenen sind abgeblendet. Wie alles andere gilt die Änderung nach wenigen Sekunden in OBS (Parameter `vwheel`, `valert`, `vprank`, `vpet`, `vquest`, `vbingo`, `vshop`, `vchal`, `vtts`, `vquiz`, `vforbid`, `vsub`, `vpause`, `vcards`). Keine Migration nötig.

### Chat im Overlay (Twitch + YouTube)

Im OBS-Dialog unter „Immer im Bild“ → **Chat (Twitch + YouTube)** einschalten: Der Chat des Kanals läuft als Karte im Bild mit – mit Emotes, Namensfarben und Abzeichen (Streamer, Mod, VIP, Abo bzw. YouTube-Mitglied). Löschen Mods eine Nachricht oder sperren jemanden, verschwindet sie auch im Overlay. Befehle und bekannte Bots sind standardmäßig ausgeblendet; Größe, Zeilenzahl und Ausblenden stehen beim Chat im OBS-Dialog. Ohne Nachrichten ist die Karte unsichtbar.

- **Twitch:** Das Overlay liest den Chat **anonym** über Twitchs Chat-Schnittstelle mit (wie ein ausgeloggter Zuschauer) – kein Login, kein Bot. Der Kanal kommt aus `CHANNEL` in `js/config.js`.
- **YouTube:** Im Feld **YouTube** den Kanal eintragen (`@Kanalname`). Sobald dort ein Livestream läuft, kommen die Nachrichten dazu – gemischt mit Twitch, vor jedem Namen das Logo der Plattform; Super Chats mit Betrag, neue Mitglieder hervorgehoben. Läuft kein Stream, schaut das Overlay jede Minute wieder nach. Weil der Browser YouTube nicht direkt abfragen darf, holt die Edge Function `youtube-chat` die Nachrichten (wird mit den anderen Functions automatisch deployt). **Kein API-Schlüssel nötig** – sie liest den Chat so, wie ihn das Chat-Fenster auf youtube.com lädt. Das ist inoffiziell: Ändert YouTube etwas daran, muss die Funktion angepasst werden.

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
- **Live-Vorschau** direkt daneben; „▶ Abspielen“ zeigt den Alert mit der eingestellten Menge. Nach **Speichern** gelten die Designs sofort in allen OBS-Quellen, ohne Neuladen.

Die Design-Bibliothek im OBS-Editor (`alook`) ist das **Grund-Design**, das der Designer übernimmt, solange eine Alert-Art „wie im OBS-Fenster“ steht. Gestalten dürfen der Streamer, Admins und freigegebene Mods. Einmal nötig: Migration `20261018000000_overlay_designs.sql` (Tabellen `alert_config` und `alert_media`, Bucket `alert-media`) – ohne sie laufen die Alerts wie bisher.

Unter **🔔 Alert-Sounds** (im OBS-Dialog) stellst du pro Alert-Art den Ton ein: Standard, kein Ton, ein eigener Alert-Sound, ein Sound vom Soundboard oder ein Sound aus „Ärgere den Streamer“ – mit ▶ zum Anhören. **Eigene Alert-Sounds** laden Admins direkt dort hoch (MP3, OGG, WAV, M4A, höchstens 4 MB und 20 Sekunden, bis zu 30 Stück). Der Alert bleibt stehen, solange sein Sound läuft. Sie liegen getrennt von den Zuschauer-Sounds, Zuschauer können sie also nicht per Kanalpunkte abspielen. Wird ein Sound gelöscht, bekommt die Alert-Art wieder den Standardklang. Admins und Mods schicken im Dashboard unter **🔔 Alerts** Probe-Alerts in alle OBS-Quellen (Probe-Alerts zählen nicht als „letzter Follower“).

Einmal nötig: Migration `20261005000000_stream_alerts.sql` ausführen und **der Streamer muss Twitch einmal neu verbinden** (Seitenleiste → Twitch-Verbindung) – für Follower und Abos braucht die Seite die neuen Berechtigungen `moderator:read:followers` und `channel:read:subscriptions`. Danach meldet Twitch die Ereignisse an `twitch-eventsub`; die Abos dafür legt die Seite selbst an (auch beim Klick auf „Auf Twitch übernehmen“ im Ärgern-Dialog). Der Gesundheitscheck unter **🔔 Alerts** zeigt, ob die Rechte schon da sind.

**Kommen echte Alerts nicht an** (Probe-Alerts gehen aber)? Im Dashboard unter **🔔 Alerts** auf **„Jetzt prüfen & reparieren“**: Fehlende oder von Twitch abgeschaltete Abos (z. B. nach Zustellfehlern) legt die Seite sofort neu an; die Liste zeigt je Art ✓ aktiv, … wird freigeschaltet oder ✕ mit der genauen Meldung. Fehlen Rechte, steht dort „Twitch neu verbinden“. Das passiert auch automatisch (siehe „Twitch-Gesundheitscheck“).

**Bits und eigene Alert-Sounds:** Einmal nötig: Migrationen `20261009000000_alert_bits_sounds.sql` und `20261010000000_alert_sound_length.sql` (20 Sekunden, 4 MB) ausführen und **der Streamer verbindet Twitch noch einmal neu** – für Bits braucht die Seite das Recht `bits:read`.

### Design-Bibliothek

Im Dashboard unter **📚 Design-Bibliothek** (Streamer, Admins, freigegebene Mods) stehen alle fertigen Designs nebeneinander – mit großer Vorschau:

- **Overlay-Designs:** die 8 Designs fürs ganze Overlay. Die Vorschau zeigt die eigenen Ebenen (oder Beispielkarten, solange keine an sind). **Fürs Overlay übernehmen** speichert das Design in den zentralen Overlay-Einstellungen – OBS mit `live=1` zeigt es sofort. Das aktive Design ist markiert.
- **Alert-Designs:** die 14 fertigen Alert-Designs, abspielbar für jede Alert-Art. **Für alle Alerts übernehmen** setzt Look, Bild, Farbe und Animationen bei allen Alert-Arten (Texte, Sounds und Varianten bleiben) und öffnet den Alert-Designer – dort prüfen und **Speichern**.

### Overlay-Design, Szenen, Kamera-Rahmen, Info-Leiste und Ziel-Balken

- **Design des ganzen Overlays:** OBS-Editor → „Aussehen & Ton“ → 🎨: Standard, Neon, Glas, Gamer, Arcade, Gold, Candy oder Minimal. Gilt für alle Karten, das Laufband und den Kamera-Rahmen; Alerts, Bingo, Chat und Laufband mit eigenem Stil behalten ihn (Parameter `otheme`).
- **Szenen-Bildschirm** (Gruppe „Stream-Grafiken“): füllt das ganze Bild hinter allen Karten – 🚀 *Gleich geht's los* mit Countdown bis zu einer Uhrzeit, ☕ *Bin gleich zurück* (auch mit Countdown) und 💜 *Danke fürs Zuschauen* mit den letzten Unterstützern. Überschrift und Zeile darunter sind frei. Tipp: Mit den Knöpfen „📋 Start-/Pause-/Ende-Quelle“ bekommt jede OBS-Szene eine eigene Browserquelle (`overlay.html?live=1&scene=start`) – dann schaltest du nur noch die OBS-Szene um.
- **Kamera-Rahmen:** Rahmen um die Kamera (Leuchten, Schlicht, Nur Ecken, Neon) mit Namensschild. Der Bereich ist derselbe rote Rahmen wie bei „Würfe & Sounds“.
- **Info-Leiste:** letzter Follower, letztes Abo, letzte Bits, Zuschauerzahl und „Live seit“ – was davon zu sehen ist, wählst du per Häkchen.
- **Ziel-Balken:** Follower-, Abo- oder Bits-Ziel mit Titel, Zielwert und Startdatum (ohne Datum: letzte 30 Tage). Der Balken füllt sich bei jedem neuen Alert und feiert, wenn das Ziel erreicht ist. Probe-Alerts zählen nicht.

Zuschauerzahl und Laufzeit schreibt die Watchtime-Zählung mit (alle paar Minuten, solange das Overlay in OBS läuft). Einmal nötig: Migration `20261018000000_overlay_designs.sql` (`goal_progress()`, `stream_live_info()`) – ohne sie bleiben Ziel und Zuschauerzahl bei 0 bzw. „offline“, alles andere geht auch so.

### Laufband

Unten im Overlay laufen langsam von rechts nach links weitere Seiten und Socials durch (z. B. Twitch, YouTube, TikTok, die StreamHelp-Seite). Das Laufband ist immer da und lässt sich nicht ausschalten, aber in der Vorschau des OBS-Dialogs verschieben; Design (Laufband, Neon, LED-Anzeige), Größe und Tempo stehen im Dialog. Die Texte pflegen Admins im OBS-Dialog unter **📢 Laufband-Texte bearbeiten** (eine Zeile pro Eintrag, `{seite}` = Adresse dieser Webseite, `{kanal}` = Twitch-Name des Streamers). Für bekannte Plattformen – Twitch, YouTube, TikTok, Instagram, Discord, X, Kick, Spotify, Steam, Facebook, Threads, Bluesky, Reddit, Patreon, Ko-fi, PayPal, Streamlabs, Snapchat, WhatsApp, Telegram, GitHub – steht automatisch das echte Logo davor (Simple Icons, CC0); es reicht die Adresse, z. B. `youtube.com/@kanal`. Änderungen laufen sofort in allen OBS-Quellen. Einmal nötig: Migration `20260929000000_ticker.sql` – ohne sie läuft das Band mit Twitch und der StreamHelp-Seite.

## Ärgere den Streamer

Kachel bei den Content-Ideen, jederzeit verfügbar. Einmal nötig: `supabase/migrations/20260924000000_pranks.sql` im SQL Editor ausführen. Das legt die Kachel an, die Tabellen und den Storage-Bucket `sounds` für eigene Sounds.

- **Kanalpunkte:** Beim Verbinden mit Twitch (und bei jedem Speichern der Einstellungen) legt die Seite im Kanal des Streamers zwei Belohnungen an: **„🍅 Wirf was auf ‹Kanal›“** (Standard 500 Punkte) und **„🔊 Sound für ‹Kanal›“** (300 Punkte). Zuschauer tippen beim Einlösen ein, was fliegen bzw. welcher Sound laufen soll – Tippfehler und Emojis werden erkannt. Unbekanntes gibt die Punkte zurück, der Chat-Bot sagt, was es gibt. Die Webseite zeigt Zuschauern die Liste zum Kopieren und eine Vorschau; direkt auslösen können dort nur Admins. Migration `20260925000000_channel_points.sql` nötig; bei Belohnungen, die schon vorher bestanden, einmal im Dialog „Auf Twitch übernehmen“ klicken.
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
   **Lootpool:** Die Fortnite-Items kommen von selbst – siehe [Bilder aus dem aktuellen Lootpool](#bilder-aus-dem-aktuellen-lootpool). Hochladen braucht es nur für Eigenes wie Kills oder Siege.
3. Größe wählen und **Neue Karte ziehen**. Für 5×5 mit freier Mitte braucht es 24 Bilder, für 4×4 16, für 3×3 8.
4. Im Stream die gefundenen Items auf der Karte anklicken. Eine volle Reihe, Spalte oder Diagonale zeigt „Bingo!“ – auf der Seite und im Overlay, mit Applaus.

Zuschauer sehen die Stream-Karte nur an. Unter **Meine Karte** zieht sich jeder seine eigene Karte aus denselben Bildern und kreuzt selbst ab (gespeichert in `bingo_player_cards`, nur für einen selbst sichtbar). **Im Stream zeigen** blendet die Stream-Karte im Overlay aus und ein, **Haken entfernen** fängt dieselbe Karte neu an.

Im OBS-Dialog unter **🎨 Bingo-Design** gibt es drei Looks für die Karte im Overlay: **Klassisch**, **Neon** und **Papier**.

### Bilder aus dem aktuellen Lootpool

**Eingebaute Item-Liste (Standard):** Ohne Schlüssel füllt `bingo-loot` das Bingo mit einer eingebauten Liste – 17 klassische Fortnite-Items mit eigenen Icons (`assets/bingo/*.svg`): Sturmgewehr, Pump- und Taktische Schrotflinte, MP, Scharfschützen- und Jagdgewehr, Pistole, Revolver, Raketen- und Granatwerfer, Minigun, Granate, Verband, Medikit, kleiner Schildtrank, Schildtrank und Lagerfeuer – Waffen in mehreren Seltenheiten, zusammen 37 Bilder (Abzeichen „Liste“). Die Liste springt auch ein, wenn der Lootpool mit Schlüssel nicht zu holen ist und es noch keine Items von dort gibt; der Grund steht dann im Bingo-Dialog. Klappt der Lootpool später, löst er die Liste ab (und umgekehrt). Liste in `supabase/functions/_shared/lootpool.ts` (`LOOT_CATALOG`).

**Mit Schlüssel:** Die Bingo-Bilder passen sich von selbst an den aktuellen Fortnite-Lootpool an. Die Edge Function `bingo-loot` holt ihn von [api-fortnite.com](https://api-fortnite.com) (`/api/v2/weapons`, Name auf Deutsch, Seltenheit, Bild, „im aktuellen Lootpool“) und gleicht ab. Vorher kam er von fortniteapi.io, das am 31.03.2026 eingestellt wurde.

- **Neu im Lootpool** → kommt als Bild dazu (mit Abzeichen „Loot“ in der Liste).
- **Aus dem Lootpool geflogen** → bleibt blass in der Liste („nicht mehr im Lootpool“) und kommt auf **keine neue Karte** mehr – weder auf die Stream-Karte noch auf die eigenen Karten. Karten, die schon gezogen sind, behalten ihre Bilder. Kommt das Item zurück, ist es wieder dabei.
- Abgeglichen wird, sobald jemand den Bingo-Dialog öffnet – aber höchstens alle 6 Stunden. Admins können unter **Bilder** mit **🔄 Lootpool jetzt abgleichen** sofort abgleichen (nach einem Update oder Season-Start).
- Ein Lootpool-Item, das nicht aufs Bingo soll, blendet ein Admin mit **🙈** aus – der Abgleich holt es nicht zurück. **… ausgeblendete wieder zeigen** holt alle zurück. Name und Seltenheit kommen von Fortnite; die **Zahl** und **⧉** (Kopie mit Zahl) gehen auch bei Lootpool-Items.
- Eigene hochgeladene Bilder bleiben immer dabei.

Einmal nötig:
1. Migration `supabase/migrations/20261013000000_bingo_lootpool.sql` im SQL Editor ausführen.
2. *(Optional, nur für den echten Lootpool)* Bei [api-fortnite.com](https://api-fortnite.com) ein Konto mit einem Tarif anlegen, der den Waffen-Endpunkt enthält (im kostenlosen Tarif antwortet er mit „403: Insufficient plan“), den API-Schlüssel kopieren und in Supabase unter **Edge Functions → Secrets** als `API_FORTNITE_KEY` eintragen. Das alte Secret `FORTNITEAPI_IO_KEY` kann weg.
3. Die Function `bingo-loot` wird mit dem nächsten Merge automatisch hochgeladen (GitHub Action). Dann im Bingo-Dialog **🔄 Lootpool jetzt abgleichen** klicken.

Ohne Schlüssel läuft das Bingo mit der eingebauten Item-Liste; im Bingo-Dialog steht, welche Quelle gerade aktiv ist.

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

## Stream-Dino

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

## Sicherheit

Einmal nötig: `supabase/migrations/20261015000000_security_hardening.sql` im SQL Editor ausführen.

- **🛡️ Raid-Schutz:** In der **Streameransicht → Content** ganz oben. Ein Klick pausiert alle Zuschauer-Aktionen – Chat-Befehle, Kanalpunkte (Glücksrad, Würfe, Vorlesen, Karten: die Punkte gehen automatisch zurück) und Aktionen auf der Seite – für 15 Minuten, 1 Stunde oder bis zum Ausschalten. Streamer und Mods können weiter alles. Der Bot sagt es im Chat an, auf der Seite erscheint ein Hinweis.
- **Content-Security-Policy** auf allen Seiten: Nur eigene Skripte laufen; die beiden Inline-Skripte sind per Hash freigegeben (`node tools/stamp-versions.mjs` schreibt die Policy mit). Die Supabase-Bibliothek liegt lokal (`js/supabase-js.js`) statt vom CDN.
- **Kein Einbetten in fremde Seiten** (Schutz gegen Clickjacking), Referrer nur innerhalb der Seite.
- **OBS sieht weniger:** Das Overlay (ohne Anmeldung) bekommt keine Konto-IDs oder Twitch-Einlösungs-IDs mehr.
- **Uploads:** höchstens 10 Sound-Dateien pro Person; neue Passwörter brauchen mindestens 10 Zeichen und dürfen nicht den Namen enthalten.
- Siehe auch `SECURITY.md` (Lücken privat melden).

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

## Admin-Bereich

Unter **`/admin.html`** (auch verlinkt unter dem Login-Formular) gibt es einen Admin-Zugang **ohne Registrierung**, nur mit Passwort. Er zeigt Live-Daten und aktualisiert sich alle 5 Sekunden:

- Kennzahlen: registrierte Nutzer, Drehungen heute und gesamt, Einlösungen per Kanalpunkte, ausgegebene Kanalpunkte
- Säulendiagramm der Drehungen pro Tag (Kanalpunkte / Webseite) für die letzten 14 Tage
- Live-Feed der letzten 40 Drehungen
- Verteilung auf die drei Glücksrad-Varianten
- Twitch-Status (Verbindung, Belohnung, Webhook, Token) mit Button „Live bei Twitch prüfen“
- Nutzerliste mit Suche. Hier lassen sich Admin-Rechte vergeben, also wer die Kacheln bearbeiten darf.

Mit **„Webseite als Admin öffnen“** (oben rechts) landest du direkt auf der Webseite, als interner Account „StreamHelp-Admin“ mit allen Admin-Rechten: Glücksrad drehen, Kacheln bearbeiten, Twitch verbinden. Dieser Account hat kein Passwort und ist nur über den Admin-Bereich erreichbar. Auf der Webseite führt der Button „Admin“ zurück.

Das Passwort steht **nicht** im Code, weil das Repo öffentlich ist. Es liegt als Secret `ADMIN_PASSWORD` in Supabase und wird im Setup-Skript abgefragt. Später ändern:

```bash
npx supabase secrets set "ADMIN_PASSWORD='neues-langes-passwort'"
```

Ein neues Passwort meldet alle offenen Admin-Sitzungen ab. Nach 10 Fehlversuchen in 15 Minuten ist der Login für 15 Minuten gesperrt. Im Demo-Modus lautet das Passwort `demo`.

## Wichtig zu wissen

- **Kanalpunkte gibt es nur für Twitch-Affiliates und Partner.** Ohne diesen Status schlägt das Anlegen der Belohnung fehl.
- Die Belohnung muss von dieser App angelegt werden, sonst darf die App die Einlösungen nicht als erledigt markieren. Existiert schon eine gleichnamige, manuell erstellte Belohnung, lösche sie vorher im Twitch-Dashboard.
- Die Chat-Nachricht schreibt der Chat-Bot (Schritt 6), nie der Account des Streamers.
- **Edge Functions immer mit `--no-verify-jwt` deployen** (oder über `supabase/config.toml`, die CLI liest das). Twitch schickt beim Zurückleiten nach der Freigabe und beim Webhook keinen Supabase-Login mit. Ist die JWT-Prüfung an, endet der Streamer nach der Freigabe auf einer Seite mit `Missing authorization header`.
- **Glücksrad-Felder ändern:** in Supabase unter *Table Editor → wheel_variants → segments* (JSON mit `label` und `detail`). Die Werte in `js/defaults.js` gelten nur für den Demo-Modus.
- **Weitere Kacheln:** neue Zeile in der Tabelle `tiles` mit `kind = 'countdown'` anlegen.
- **Vorschläge:** stehen in `ideas`, die Stimmen in `idea_votes`. Solange die Migration `…_ideas.sql` nicht eingespielt ist, blendet die Seite den Bereich einfach aus.
