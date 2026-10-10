// Games im Dashboard (Migration …_games.sql): Welche Games gibt es, welche Content-Ideen passen?
// Die Zuordnung Twitch-Kategorie → Game steht zusätzlich in supabase/functions/_shared/games.ts
// (für das automatische Anschalten beim Live-Gehen) – neue Games in beiden Dateien eintragen.
//   ideas: Content-Ideen (Kachel-Arten), die besonders zu diesem Game passen.
//          Leer = „Wir arbeiten an einer Content-Idee für dieses Game“.
export const GAMES = [
  { id: 'fortnite', name: 'Fortnite', icon: '🏝️', group: 'top', ideas: ['wheel', 'bingo', 'shop', 'quiz', 'challenge', 'counter'] },
  { id: 'minecraft', name: 'Minecraft', icon: '⛏️', group: 'top', ideas: ['counter', 'gamewheel', 'poll'] },
  { id: 'just-chatting', name: 'Just Chatting', icon: '💬', group: 'top', ideas: ['questions', 'poll', 'hotwords', 'tts', 'pet', 'gamewheel'] },
  { id: 'speedrun', name: 'Speedrun', icon: '⏱️', group: 'top', ideas: ['counter', 'gamewheel', 'poll'] },
  { id: 'horror', name: 'Horror', icon: '👻', group: 'top', ideas: ['heart', 'counter', 'gamewheel'] },
  { id: 'super-mario-64', name: 'Super Mario 64', icon: '🍄', group: 'retro', ideas: [] },
  { id: 'super-mario-world', name: 'Super Mario World', icon: '🦖', group: 'retro', ideas: [] },
  { id: 'mario-kart-64', name: 'Mario Kart 64', icon: '🏎️', group: 'retro', ideas: [] },
  { id: 'zelda-oot', name: 'Zelda: Ocarina of Time', icon: '🗡️', group: 'retro', ideas: [] },
  { id: 'pokemon-red-blue', name: 'Pokémon Rot/Blau', icon: '⚡', group: 'retro', ideas: [] },
  { id: 'tetris', name: 'Tetris', icon: '🧱', group: 'retro', ideas: [] },
  { id: 'sonic', name: 'Sonic the Hedgehog', icon: '💨', group: 'retro', ideas: [] },
  { id: 'crash', name: 'Crash Bandicoot', icon: '🦊', group: 'retro', ideas: [] },
  { id: 'goldeneye', name: 'GoldenEye 007', icon: '🔫', group: 'retro', ideas: [] },
  { id: 'street-fighter-2', name: 'Street Fighter II', icon: '🥊', group: 'retro', ideas: [] },
  { id: 'retro', name: 'Retro (alles andere)', icon: '🕹️', group: 'retro', ideas: [] },
];

export const GAME_GROUPS = [['top', 'Beliebt'], ['retro', 'Retro']];

// Game-Pakete (Migration …_game_packs.sql): Zähler-Vorlagen und Challenges fürs Spiel-Rad.
// command = Chat-Befehl ohne „!“ (Mods zählen mit „!tode +“). Eigene Challenges je Game speichert die
// Datenbank (gamewheel.challenges); ohne eigene gelten diese hier.
export const PACKS = {
  fortnite: {
    counters: [['Kills', '🔫', 'kills'], ['Wins', '👑', 'wins'], ['Tode', '💀', 'tode']],
    challenges: ['Nur graue Waffen', 'Landen, wo der Chat sagt', 'Keine Heilung', 'Nur Pistolen', 'Kein Bauen', 'Erste Kiste = Loadout', 'Nur Sniper', 'Rückwärts laufen bis zur Zone'],
  },
  minecraft: {
    counters: [['Tode', '💀', 'tode'], ['Diamanten', '💎', 'diamanten'], ['Creeper', '💥', 'creeper']],
    challenges: ['Nur Holzwerkzeuge', 'Keine Rüstung bis zum Nether', 'Kein Sprinten', 'Nur Fleisch essen', 'Chat wählt das nächste Ziel', 'Ein Haus in 5 Minuten', 'Kein Springen für 5 Minuten', 'Nur auf Blöcken laufen, die du platzierst'],
  },
  'just-chatting': {
    counters: [['Lacher', '😂', 'lacher'], ['Ähms', '🤔', 'aehm']],
    challenges: ['Erzähl eine peinliche Geschichte', 'Chat wählt das nächste Thema', '5 Minuten nur Englisch', 'Lies die letzte Chat-Nachricht dramatisch vor', 'Sing den Refrain deines Lieblingslieds', 'Beantworte 3 Fragen aus dem Chat ehrlich', 'Imitiere eine Person aus dem Chat', 'Ein Witz – lacht der Chat nicht, gibt’s eine Strafe'],
  },
  speedrun: {
    counters: [['Versuche', '🔁', 'versuche'], ['Resets', '♻️', 'resets'], ['Bestzeiten', '🏆', 'pb']],
    challenges: ['Kein Glitch erlaubt', 'Nur ein Leben', 'Mit der schwächsten Figur', 'Alles einsammeln (100 %)', 'Ohne Pause bis zum Ende', 'Chat wählt die Route', 'Blind: ohne Karte und Splits', 'Nächster Run rückwärts im Menü starten'],
  },
  horror: {
    counters: [['Jumpscares', '😱', 'jumpscares'], ['Tode', '💀', 'tode'], ['Schreie', '🗣️', 'schreie']],
    challenges: ['Licht aus im Zimmer', 'Lautstärke hoch', 'Ohne Taschenlampe', 'Nur flüstern', 'Bei jedem Jumpscare: 5 Liegestütze', 'Kamera näher ran', 'Kein Wegschauen – sonst Strafe', 'Chat wählt die nächste Tür'],
  },
};
export const packOf = (id) => PACKS[id] ?? null;

// Ideen, die nur zu ihrem Game passen (Fortnite-Bingo, Kisten-Shop, Fortnite-Quiz, Fortnite-Glücksrad) –
// bei anderen Games ausgeblendet. Alle anderen Ideen passen zu jedem Game.
export const GAME_ONLY = new Set(['wheel', 'bingo', 'shop', 'quiz']);

export const DEFAULT_GAMES = { active: ['fortnite', 'just-chatting'], current: '', auto: true, live_game: '', live_category: '', live_at: null };

export const gameById = (id) => GAMES.find((g) => g.id === id) ?? null;

// Gerade live in diesem Game? (Watchtime-Durchgang alle 5 Minuten, solange OBS läuft)
const LIVE_MS = 15 * 60_000;
export function liveGameId(sg) {
  return sg?.live_game && sg.live_at && Date.now() - Date.parse(sg.live_at) < LIVE_MS ? sg.live_game : '';
}

// Aktive Games in Katalog-Reihenfolge (unbekannte IDs fallen weg)
export function activeGames(sg) {
  const on = new Set(sg?.active ?? DEFAULT_GAMES.active);
  return GAMES.filter((g) => on.has(g.id));
}

// Kacheln für ein Game: passende zuerst, dann was zu jedem Game passt
export function splitTiles(tiles, gameId) {
  const game = gameById(gameId);
  if (!game) return { mine: [], general: tiles };
  const mine = tiles.filter((t) => game.ideas.includes(t.kind));
  const general = tiles.filter((t) => !game.ideas.includes(t.kind) && !GAME_ONLY.has(t.kind));
  return { mine, general };
}
