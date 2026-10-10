// Zufall aus crypto.getRandomValues – für alles, was über Gewinne, Lose, Geheimzahlen oder Reihenfolgen
// entscheidet (auch im Demo-Modus). Math.random bleibt nur für Optik wie Konfetti.

// Unverzerrte Zufallszahl 0..max-1 (wie randomInt in den Edge Functions: verwirft den Rest-Bereich)
export function randomInt(max) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

// Kommazahl in [0, 1) mit 53 Bit Genauigkeit
export function randomFloat() {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return ((buf[0] >>> 5) * 0x4000000 + (buf[1] >>> 6)) / 0x20000000000000;
}

export const pickRandom = (list) => list[randomInt(list.length)];

// Fisher-Yates auf einer Kopie
export function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
