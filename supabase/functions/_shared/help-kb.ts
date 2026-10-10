// Wissen für die KI-Hilfe auf der Startseite (Edge Function help-chat).
// Kurz halten: Alles hier geht bei jeder Frage mit an den KI-Dienst. Neue Funktionen hier nachtragen.
export const HELP_KB = `
StreamHelp ist eine Stream-Zentrale für Twitch-Streamer, ihre Mods und Zuschauer. Webseite: spitzefluke.github.io/twitch-content

Preis: Aktuell ist StreamHelp kostenlos. Später kommt ein optionales Abo mit Extras; bevor sich etwas ändert, sagen wir rechtzeitig Bescheid. Keine weiteren Preisangaben machen.

Anmelden: mit Twitch (empfohlen), Discord, Google, Spotify, GitHub oder E-Mail. Zwei-Faktor-Anmeldung (Authenticator-App) im Dashboard unter „Sicherheit“.

Streamer werden: Mit Twitch anmelden, „Kanal anmelden“ wählen, kurze Nachricht schreiben. Jeder Kanal wird von Hand freigeschaltet. Danach im Dashboard unter „Twitch-Verbindung“ Twitch verbinden (Kanalpunkte, Chat-Bot, Alerts, Mods).

OBS-Overlay: Dashboard → „Overlay & OBS“ → Adresse kopieren → in OBS eine Browserquelle mit 1920×1080 anlegen und die Adresse einfügen. Eine einzige Browserquelle zeigt alles: Alerts, Chat, Glücksrad, Bingo, Laufband, Haustier, Subathon-Timer, Verlosung usw. Ebenen, Designs und Szenen stellt man im OBS-Fenster von StreamHelp ein. Funktioniert auch mit Streamlabs Desktop und anderen Programmen mit Browserquelle.

Alerts: Follower, Abos, Resubs, verschenkte Abos, Bits und Kanalpunkte. Eigene Designs im Alert-Designer, fertige Designs in der Design-Bibliothek. Kommen keine Alerts: Dashboard → „Alerts“ → Twitch-Gesundheitscheck, ggf. Twitch neu verbinden.

Chat-Bot: Der StreamHelp-Bot schreibt Ergebnisse in den Chat, nie im Namen des Streamers. Eigene Befehle unter „Bot & Chat“. !watchtime zeigt die Zuschauzeit, !befehle die Befehle.

Content-Ideen (Kacheln im Dashboard, Zuschauer machen über Seite oder Chat mit): Glücksrad (auch per Kanalpunkte), Fortnite-Bingo mit eigener Karte und Tipprunde, Ärgere den Streamer (Würfe und Sounds per Kanalpunkte), Unangenehme Fragen, Stream-Haustier (füttern mit !füttern), Kisten-Shop, Win-Challenge, Verbotenes Wort, Subathon-Timer, Pausen-Bildschirm, Quiz, Mitspieler-Warteschlange, Vorlesen (Text-to-Speech), Sammelkarten, Verlosung, Hot Words. Games: Fortnite, Minecraft, Just Chatting, Retro-Games u. a. – jedes Game zeigt passende Ideen.

Mods: Der Streamer holt seine Mods von Twitch und gibt sie frei („Für Mods freigeben“). Er kann einzelnen Mods Bereiche sperren (Rechte je Mod) und sieht im Mod-Protokoll, wer was geändert hat. Twitch-Verbindung, Freigabe und Export bleiben beim Streamer.

Raid-Schutz: Ein Klick pausiert alle Zuschauer-Aktionen; Kanalpunkte gehen automatisch zurück.

Aufnahme-Studio: Videos für YouTube, Shorts und TikTok aufnehmen, auf Wunsch ohne Overlay. Dashboard → „Video aufnehmen“.

Twitch-Panel: eine Twitch-Erweiterung unter dem Stream mit aktuellem Game, Ideen, Verlosung und Mitspieler-Warteschlange.

YouTube: Chat im Overlay zeigt Twitch und YouTube zusammen. Kanalpunkte, Alerts und Chat-Bot gibt es nur für Twitch.

Sicherheit und Daten: Anmeldung über Twitch, das Passwort sieht StreamHelp nie. Verbindung jederzeit in den Twitch-Einstellungen unter „Verbindungen“ trennbar. Streamer können alle Kanal-Daten exportieren (Dashboard → Sicherheit). Details auf der Seite „Datenschutz“.

Sprachen: Startseite und Anmeldung gibt es in mehreren Sprachen, das Dashboard ist bisher deutsch.

Kontakt: Für alles, was die Hilfe nicht beantworten kann, gibt es das Kontaktformular auf der Startseite (Abschnitt „Kontakt“). Eine E-Mail-Adresse wird nicht veröffentlicht.
`.trim();
