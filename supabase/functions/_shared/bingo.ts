// Fortnite-Bingo: Welche Linien der Karte kann man tippen? Steht genauso in
// js/bingo.js (betLines) – beide gleich halten.
export type BetLine = { key: string; title: string; cells: number[] };

// Twitch erlaubt höchstens 10 Antworten pro Vorhersage: Reihen und Spalten
// immer, die Diagonalen nur, wenn noch Platz ist (also nicht bei 5 × 5).
export function betLines(size: number): BetLine[] {
  const letters = size === 5 ? "BINGO" : "ABCDE".slice(0, size);
  const lines: BetLine[] = [];
  for (let r = 0; r < size; r++) {
    lines.push({ key: `r${r + 1}`, title: `Reihe ${r + 1}`, cells: Array.from({ length: size }, (_, c) => r * size + c) });
  }
  for (let c = 0; c < size; c++) {
    lines.push({ key: `c${c + 1}`, title: `Spalte ${letters[c]}`, cells: Array.from({ length: size }, (_, r) => r * size + c) });
  }
  if (lines.length + 2 <= 10) {
    lines.push({ key: "d1", title: "Diagonale ↘", cells: Array.from({ length: size }, (_, i) => i * size + i) });
    lines.push({ key: "d2", title: "Diagonale ↙", cells: Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)) });
  }
  return lines;
}

export const fullLines = (size: number, marked: number[]) => {
  const set = new Set(marked);
  return betLines(size).filter((l) => l.cells.every((i) => set.has(i)));
};
