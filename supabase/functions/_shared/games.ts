// Games (Migration …_games.sql): Twitch-Kategorie → Game auf StreamHelp, dazu Name, Symbol und
// passende Content-Ideen (für das Twitch-Panel, twitch-ext). Die Webseite hat dieselbe Liste in
// js/games.js – neue Games in beiden Dateien eintragen.
import { db } from "./twitch.ts";

export type Game = { id: string; name: string; icon: string; twitch: string[]; ideas: string[] };

export const GAMES: Game[] = [
  { id: "fortnite", name: "Fortnite", icon: "🏝️", twitch: ["Fortnite"], ideas: ["wheel", "bingo", "shop", "quiz", "challenge", "counter"] },
  { id: "minecraft", name: "Minecraft", icon: "⛏️", twitch: ["Minecraft"], ideas: ["counter", "gamewheel", "poll"] },
  { id: "just-chatting", name: "Just Chatting", icon: "💬", twitch: ["Just Chatting"], ideas: ["questions", "poll", "hotwords", "tts", "pet", "gamewheel"] },
  // Speedruns laufen unter der Kategorie des jeweiligen Spiels – deshalb nur von Hand
  { id: "speedrun", name: "Speedrun", icon: "⏱️", twitch: [], ideas: ["counter", "gamewheel", "poll"] },
  {
    id: "horror", name: "Horror", icon: "👻", ideas: ["heart", "counter", "gamewheel"],
    twitch: ["Phasmophobia", "Lethal Company", "Dead by Daylight", "Outlast", "Outlast 2", "The Outlast Trials", "Resident Evil 4",
      "Resident Evil Village", "Resident Evil 2", "Five Nights at Freddy's", "Five Nights at Freddy's: Security Breach", "Silent Hill 2",
      "Silent Hill f", "Content Warning", "Amnesia: The Bunker", "Alien: Isolation", "Dead Space", "Visage", "The Mortuary Assistant",
      "Little Nightmares", "Little Nightmares II", "Poppy Playtime", "Devour", "The Forest", "Sons of the Forest", "Dredge", "Inscryption", "Horror"],
  },
  { id: "super-mario-64", name: "Super Mario 64", icon: "🍄", twitch: ["Super Mario 64"], ideas: [] },
  { id: "super-mario-world", name: "Super Mario World", icon: "🦖", twitch: ["Super Mario World"], ideas: [] },
  { id: "mario-kart-64", name: "Mario Kart 64", icon: "🏎️", twitch: ["Mario Kart 64"], ideas: [] },
  { id: "zelda-oot", name: "Zelda: Ocarina of Time", icon: "🗡️", twitch: ["The Legend of Zelda: Ocarina of Time"], ideas: [] },
  { id: "pokemon-red-blue", name: "Pokémon Rot/Blau", icon: "⚡", twitch: ["Pokémon Red/Blue", "Pokémon Red", "Pokémon Blue", "Pokémon Red and Blue"], ideas: [] },
  { id: "tetris", name: "Tetris", icon: "🧱", twitch: ["Tetris", "Tetris 99", "Tetris Effect"], ideas: [] },
  { id: "sonic", name: "Sonic the Hedgehog", icon: "💨", twitch: ["Sonic the Hedgehog", "Sonic the Hedgehog 2"], ideas: [] },
  { id: "crash", name: "Crash Bandicoot", icon: "🦊", twitch: ["Crash Bandicoot", "Crash Bandicoot N. Sane Trilogy"], ideas: [] },
  { id: "goldeneye", name: "GoldenEye 007", icon: "🔫", twitch: ["GoldenEye 007"], ideas: [] },
  { id: "street-fighter-2", name: "Street Fighter II", icon: "🥊", twitch: ["Street Fighter II", "Street Fighter II: The World Warrior", "Super Street Fighter II Turbo"], ideas: [] },
  { id: "retro", name: "Retro (alles andere)", icon: "🕹️", twitch: ["Retro"], ideas: [] },
];

// Ideen, die nur zu ihrem Game passen – bei anderen Games ausgeblendet (wie auf der Webseite)
export const GAME_ONLY = new Set(["wheel", "bingo", "shop", "quiz"]);

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const BY_NAME = new Map(GAMES.flatMap((g) => g.twitch.map((n) => [norm(n), g.id] as const)));

export function gameForCategory(category: string): string {
  return BY_NAME.get(norm(category)) ?? "";
}

export const gameById = (id: string) => GAMES.find((g) => g.id === id) ?? null;

// Stream ist live in dieser Kategorie – fehlt die Migration, passiert einfach nichts
export async function noteLiveCategory(category: string) {
  if (!category) return;
  const { error } = await db.rpc("games_live", { p_category: category, p_game: gameForCategory(category) });
  if (error && !/games_live/.test(error.message)) console.warn("Games:", error.message);
}
