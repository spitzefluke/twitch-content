// Games im Dashboard (Migration …_games.sql): Welche Games gibt es, welche Content-Ideen passen?
// Die Zuordnung Twitch-Kategorie → Game steht zusätzlich in supabase/functions/_shared/games.ts
// (für das automatische Anschalten beim Live-Gehen) – neue Games in beiden Dateien eintragen.
//   ideas: Content-Ideen (Kachel-Arten), die besonders zu diesem Game passen.
//          Leer = „Wir arbeiten an einer Content-Idee für dieses Game“.
export const GAMES = [
  { id: 'fortnite', name: 'Fortnite', icon: '🏝️', group: 'top', ideas: ['wheel', 'bingo', 'shop', 'quiz', 'challenge'] },
  { id: 'minecraft', name: 'Minecraft', icon: '⛏️', group: 'top', ideas: [] },
  { id: 'just-chatting', name: 'Just Chatting', icon: '💬', group: 'top', ideas: ['questions', 'hotwords', 'tts', 'pet'] },
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
