// Overlay in Module aufteilen: Statt einer Browserquelle mit allem kann der Streamer in OBS mehrere
// Quellen anlegen – z. B. „Alerts“ in jeder Szene, „Chat“ nur in der Chatting-Szene, „Spiele“ nur beim Spielen.
// Jede Quelle ist overlay.html?live=1&only=<Ebenen>&m=<Modul>: gleiche Einstellungen (Plätze, Größen, Aussehen
// aus dem OBS-Fenster), sie zeigt nur ihre Ebenen und lädt nur, was die brauchen.
// Genutzt von js/overlay.js (Filter), js/app.js (OBS-Fenster → Reiter „Module“) und js/record.js (Ebenen-Liste).

// Ebenen (Namen wie im OBS-Fenster). kind: wie die Ebene in den Overlay-Einstellungen an ist
export const LAYERS = [
  ['alerts', 'Alerts'], ['chat', 'Chat'], ['ticker', 'Laufband', 'ticker'], ['camframe', 'Kamera-Rahmen', 'flag'],
  ['labels', 'Info-Leiste'], ['goal', 'Ziel-Balken'], ['recent', 'Letzter Follower & Abo'], ['next', 'Als Nächstes'],
  ['wheel', 'Glücksrad'], ['prank', 'Würfe & Sounds', 'flag'], ['pet', 'Haustier', 'flag'], ['quest', 'Unangenehme Fragen'],
  ['bingo', 'Fortnite-Bingo'], ['shop', 'Kisten-Shop'], ['challenge', 'Win-Challenge'], ['forbid', 'Verbotenes Wort'],
  ['subathon', 'Subathon-Timer'], ['quiz', 'Quiz'], ['queue', 'Mitspielen'], ['tts', 'Vorlesen'], ['cards', 'Sammelkarten'],
  ['giveaway', 'Verlosung'], ['hotwords', 'Hot Words'], ['poll', 'Umfrage'], ['counter', 'Zähler'], ['gamewheel', 'Spiel-Rad'],
  ['heart', 'Herzfrequenz'], ['chatcontrol', 'Chat-Kommandos'], ['songs', 'Song-Wünsche'], ['pause', 'Pausen-Bildschirm', 'flag'], ['scene', 'Szenen-Bildschirm', 'scene'],
];
export const LAYER_KEYS = LAYERS.map(([key]) => key);
export const layerName = (key) => LAYERS.find(([k]) => k === key)?.[1] ?? key;

// Fertige Module (je eine Browserquelle in OBS). id ist kurz – sie steht in der Adresse (m=…) und in der Statistik.
export const MODULES = [
  { id: 'alerts', icon: '🔔', name: 'Alerts & Ziele', layers: ['alerts', 'recent', 'goal', 'labels'], hint: 'In jede Szene – Follower, Abos, Bits, Ziel-Balken.' },
  { id: 'chat', icon: '💬', name: 'Chat', layers: ['chat'], hint: 'Twitch- und YouTube-Chat.' },
  { id: 'ticker', icon: '📢', name: 'Laufband', layers: ['ticker'], hint: 'Die Laufschrift unten.' },
  { id: 'songs', icon: '🎵', name: 'Song-Wünsche', layers: ['songs'], hint: 'Was gerade läuft und die nächsten Wünsche (!sr).' },
  { id: 'cam', icon: '🎥', name: 'Kamera & Haustier', layers: ['camframe', 'prank', 'pet', 'tts'], hint: 'Kamera-Rahmen, Würfe & Sounds, Haustier, Vorlesen.' },
  {
    id: 'games', icon: '🎮', name: 'Spiele & Mitmachen',
    layers: ['next', 'wheel', 'quest', 'bingo', 'shop', 'challenge', 'forbid', 'subathon', 'quiz', 'queue', 'cards', 'giveaway', 'hotwords', 'poll', 'counter', 'gamewheel', 'heart', 'chatcontrol'],
    hint: 'Alle Content-Ideen – nur in Spiel-Szenen nötig.',
  },
  { id: 'screens', icon: '🖼️', name: 'Pause & Szenen', layers: ['pause', 'scene'], hint: 'Pausen- und Szenen-Bildschirm (ganzes Bild) – in eine eigene Szene.' },
];

// Erlaubte Modul-Kennung in der Adresse (für Statistik): Buchstaben, Ziffern, Bindestrich
export const cleanModuleId = (raw) => (String(raw ?? '').toLowerCase().match(/^[a-z0-9-]{1,24}$/) ? String(raw).toLowerCase() : '');

// Nur diese Ebenen zeigen: alle anderen in den Parametern ausschalten (wie die Ebenen-Schalter im OBS-Fenster)
export function limitLayers(params, keep) {
  for (const [key, , kind] of LAYERS) {
    if (keep.has(key)) continue;
    if (kind === 'ticker') params.set('ticker_show', '0');
    else if (kind === 'scene') params.delete('scene');
    else params.set(key, '0');
  }
}

// Adresse für eine Modul-Quelle
export function moduleUrl(base, mod) {
  const url = new URL(base);
  url.searchParams.set('only', mod.layers.join(','));
  url.searchParams.set('m', mod.id);
  return url.href;
}
