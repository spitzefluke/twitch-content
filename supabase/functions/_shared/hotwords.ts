// Hot Words (Migration …_hotwords.sql): Jede Chat-Nachricht wird in Wörter zerlegt und gezählt.
// Füllwörter („und“, „ich“, „the“ …), Befehle, Links, @Namen und reine Zahlen zählen nicht;
// Mindestlänge, Sperrliste und Spam-Schutz prüft die Datenbank (hotwords_note).
import { db } from "./twitch.ts";

// Häufige deutsche und englische Füllwörter – die wären sonst immer ganz oben
const STOPWORDS = new Set(`
aber alle alles also auch auf aus bei beim bin bis bist da dann das dass dein deine dem den denn der des die dies diese
dir doch du ein eine einem einen einer eines er es etwas euch euer für hab habe haben hast hat hatte ich ihm ihn ihr im
in ist ja jetzt kann kannst kein keine man mal mein meine mich mir mit muss nach nein nicht nichts noch nur ob oder ohne
schon sehr sein seine sich sie sind so über um und uns unser vom von vor war waren was weil wenn wer wie wieder wir
wird wo zu zum zur gibt geht gut mehr noch heute hier immer einfach eben eig eigentlich halt mega voll bitte danke
the and you your are was were for that this with have has not but what all can just like get got its it's i'm dont
don't yes yeah lol omg too out who how why when
`.trim().split(/\s+/));

// "Hallo @Mia, guck https://x.y – KEKW!!" → ["Hallo", "guck", "KEKW"]
export function splitWords(text: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  const clean = text
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/@\w+/g, " ");
  for (const raw of clean.split(/[^\p{L}\p{N}_']+/u)) {
    const w = raw.replace(/^'+|'+$/g, "");
    if (w.length < 2 || w.length > 25 || !/\p{L}/u.test(w)) continue;
    const key = w.toLowerCase();
    if (STOPWORDS.has(key) || seen.has(key)) continue;
    // „aaaaaaa“ und ähnliches: kein Wort
    if (/(.)\1{3,}/u.test(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= 12) break;
  }
  return out;
}

export async function noteHotwords(chatterId: string, text: string) {
  if (!text || text.startsWith("!")) return;
  const words = splitWords(text);
  if (!words.length) return;
  const { error } = await db.rpc("hotwords_note", { p_player: `tw:${chatterId}`, p_words: words });
  // Migration …_hotwords.sql fehlt noch: einfach nichts tun
  if (error && !/hotwords_note/.test(error.message)) console.warn("Hot Words:", error.message);
}
