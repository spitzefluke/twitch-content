// Games (Migration …_games.sql): Twitch-Kategorie → Game auf StreamHelp.
// Die vollständige Liste mit Namen und Content-Ideen steht in js/games.js – hier nur die Zuordnung,
// damit beim Live-Gehen das passende Game angeschaltet wird. Neue Games in beiden Dateien eintragen.
import { db } from "./twitch.ts";

const GAMES: [string, string[]][] = [
  ["fortnite", ["Fortnite"]],
  ["minecraft", ["Minecraft"]],
  ["just-chatting", ["Just Chatting"]],
  ["super-mario-64", ["Super Mario 64"]],
  ["mario-kart-64", ["Mario Kart 64"]],
  ["zelda-oot", ["The Legend of Zelda: Ocarina of Time"]],
  ["pokemon-red-blue", ["Pokémon Red/Blue", "Pokémon Red", "Pokémon Blue", "Pokémon Red and Blue"]],
  ["tetris", ["Tetris", "Tetris 99", "Tetris Effect"]],
  ["sonic", ["Sonic the Hedgehog", "Sonic the Hedgehog 2"]],
  ["crash", ["Crash Bandicoot", "Crash Bandicoot N. Sane Trilogy"]],
  ["goldeneye", ["GoldenEye 007"]],
  ["street-fighter-2", ["Street Fighter II", "Street Fighter II: The World Warrior", "Super Street Fighter II Turbo"]],
  ["super-mario-world", ["Super Mario World"]],
  ["retro", ["Retro"]],
];

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const BY_NAME = new Map(GAMES.flatMap(([id, names]) => names.map((n) => [norm(n), id] as const)));

export function gameForCategory(category: string): string {
  return BY_NAME.get(norm(category)) ?? "";
}

// Stream ist live in dieser Kategorie – fehlt die Migration, passiert einfach nichts
export async function noteLiveCategory(category: string) {
  if (!category) return;
  const { error } = await db.rpc("games_live", { p_category: category, p_game: gameForCategory(category) });
  if (error && !/games_live/.test(error.message)) console.warn("Games:", error.message);
}
