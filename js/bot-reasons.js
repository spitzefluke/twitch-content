// Bot-Protokoll: Warum Twitch eine Nachricht des Bots geblockt hat – auf Deutsch und mit dem Weg, es zu beheben.
// Twitch liefert den Grund als englischen Text (drop_reason.message, siehe _shared/twitch.ts sendChat).
// Fast alle Chat-Modi gelten nicht für Mods: Den Bot zum Mod machen ist meist die Lösung.
const mod = (bot) => `Mach den Bot zum Mod – im Twitch-Chat: /mod ${bot || 'BotName'}`;
const RULES = [
  [/followers?[- ]only/i, 'Der Chat ist im Nur-Follower-Modus.', mod],
  [/subscribers?[- ]only|subs[- ]only/i, 'Der Chat ist im Nur-Abonnenten-Modus.', mod],
  [/emote[- ]only/i, 'Der Chat ist im Nur-Emote-Modus.', mod],
  [/slow ?mode/i, 'Der Chat ist im langsamen Modus.', mod],
  [/unique|r9k/i, 'Der Chat lässt keine gleichen Nachrichten zu (Unique-Chat).', mod],
  [/identical|duplicate/i, 'Dieselbe Nachricht zweimal innerhalb von 30 Sekunden.', mod],
  [/timed out|timeout/i, 'Der Bot ist im Kanal im Timeout.', (bot) => `Im Twitch-Chat: /untimeout ${bot || 'BotName'}`],
  [/banned/i, 'Der Bot ist im Kanal gebannt.', (bot) => `Im Twitch-Chat: /unban ${bot || 'BotName'}, danach /mod ${bot || 'BotName'}`],
  [/verified (e-?mail|phone)|phone number|email/i, 'Der Kanal verlangt eine bestätigte E-Mail oder Telefonnummer.', mod],
  [/automod|blocked term|link|held/i, 'AutoMod oder ein gesperrtes Wort bzw. ein Link hat die Nachricht gestoppt.',
    (bot) => `${mod(bot)} – oder im Creator-Dashboard unter Moderation die Einstellungen prüfen`],
  [/rate ?limit|too many/i, 'Zu viele Nachrichten in kurzer Zeit.', () => 'Kurz warten – als Mod hat der Bot ein höheres Limit'],
];

// { why, fix } oder null, wenn der Grund unbekannt ist
export function botHint(reason, bot) {
  if (!reason) return null;
  for (const [re, why, fix] of RULES) if (re.test(reason)) return { why, fix: fix(bot) };
  return null;
}
