// Fortnite-Bingo: gemeinsame Helfer für die Webseite (Dialog) und das OBS-Overlay.

// Seltenheit wie in Fortnite – Farben stehen in css/bingo.css (.r-common …)
export const RARITIES = [
  { id: 'common', name: 'Gewöhnlich', words: ['common', 'gewoehnlich', 'gewöhnlich', 'grau', 'gray', 'grey'] },
  { id: 'uncommon', name: 'Ungewöhnlich', words: ['uncommon', 'ungewoehnlich', 'ungewöhnlich', 'gruen', 'grün', 'green'] },
  { id: 'rare', name: 'Selten', words: ['rare', 'selten', 'blau', 'blue'] },
  { id: 'epic', name: 'Episch', words: ['epic', 'episch', 'lila', 'purple'] },
  { id: 'legendary', name: 'Legendär', words: ['legendary', 'legendaer', 'legendär', 'legend', 'gold', 'orange'] },
  { id: 'mythic', name: 'Mythisch', words: ['mythic', 'mythisch', 'mythical'] },
  { id: 'exotic', name: 'Exotisch', words: ['exotic', 'exotisch'] },
];
export const rarityName = (id) => RARITIES.find((r) => r.id === id)?.name ?? '';

// Seltenheit aus dem Dateinamen: "scar_legendary.png", "Pump Episch.png" …
// "uncommon" vor "common" prüfen, sonst wird Grün zu Grau.
export function rarityFromFile(fileName) {
  const words = fileName.toLowerCase().replace(/\.[^.]+$/, '').split(/[^a-zäöüß]+/).filter(Boolean);
  const hit = [...RARITIES].sort((a, b) => b.id.length - a.id.length)
    .find((r) => r.words.some((w) => words.includes(w)));
  return hit?.id ?? null;
}

// Zahl im Icon, z. B. bei Kills: "kill_5.png", "5-kills.png", "elim x10.png" → 5 bzw. 10
const AMOUNT = /^(?:x|×)?(\d{1,3})(?:x|×)?$/i;
export const MAX_AMOUNT = 999;
export function amountFromFile(fileName) {
  const words = fileName.replace(/\.[^.]+$/, '').split(/[-_\s]+/);
  const hit = words.map((w) => AMOUNT.exec(w)).find((m) => m && Number(m[1]) >= 1);
  return hit ? Number(hit[1]) : null;
}

// Name ohne Seltenheits-Wort und ohne Zahl: "scar_legendary.png" → "Scar", "kill_5.png" → "Kill"
function stripRarity(fileName) {
  // Farbwörter (gold, blau …) bleiben im Namen – "Gold Scar" heißt wirklich so.
  const colors = ['grau', 'gray', 'grey', 'gruen', 'grün', 'green', 'blau', 'blue', 'lila', 'purple', 'gold', 'orange'];
  const all = RARITIES.flatMap((r) => r.words).filter((w) => !colors.includes(w));
  const parts = fileName.replace(/\.[^.]+$/, '').split(/([-_\s]+)/);
  // Nur die erste Zahl ist die Zahl im Icon (wie in amountFromFile)
  const numberAt = parts.findIndex((part, i) => i % 2 === 0 && AMOUNT.test(part) && Number(AMOUNT.exec(part)[1]) >= 1);
  return parts.filter((part, i) => i !== numberAt && !all.includes(part.toLowerCase()))
    .join('').replace(/^[-_\s]+|[-_\s]+$/g, '');
}

// Was von einem Bild in eine Karte kommt (ohne leere Felder)
export function cardCell({ id, name, path, rarity, amount }) {
  return { id, name, path, ...(rarity ? { rarity } : {}), ...(amount ? { amount } : {}) };
}

// Alle Reihen, Spalten und die beiden Diagonalen als Listen von Feld-Nummern
function lines(size) {
  const all = [];
  for (let r = 0; r < size; r++) all.push(Array.from({ length: size }, (_, c) => r * size + c));
  for (let c = 0; c < size; c++) all.push(Array.from({ length: size }, (_, r) => r * size + c));
  all.push(Array.from({ length: size }, (_, i) => i * size + i));
  all.push(Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)));
  return all;
}

// Welche Linien sind voll? → Anzahl und die Felder darin
export function bingoState(card) {
  if (!card) return { count: 0, cells: new Set(), done: 0, total: 0 };
  const marked = new Set(card.marked ?? []);
  const full = lines(card.size).filter((line) => line.every((i) => marked.has(i)));
  const free = card.cells.filter((c) => c.free).length;
  return {
    count: full.length,
    cells: new Set(full.flat()),
    done: [...marked].filter((i) => !card.cells[i]?.free).length,
    total: card.cells.length - free,
  };
}

// Items ohne Seltenheit bekommen eine von drei bunten Farben, die es bei
// Waffen nicht gibt – so verwechselt man sie nicht mit einer Seltenheit.
const FUN = ['fun-pink', 'fun-teal', 'fun-red'];
function funColor(id = '') {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FUN[h % FUN.length];
}

// Zeichnet die Karte in `el`. Mit onCell werden die Felder zu Knöpfen.
// itemOf(cell) liefert das Bild aus der aktuellen Liste (falls ein Admin Seltenheit
// oder Zahl nachträglich geändert hat); sonst gilt, was beim Ziehen in der Karte steht.
export function renderBingoGrid(el, card, { urlFor, onCell = null, stamped = null, itemOf = null } = {}) {
  const { cells: winning } = bingoState(card);
  const marked = new Set(card.marked ?? []);
  el.style.setProperty('--n', card.size);
  // Bei 5 × 5 steht B-I-N-G-O über den Spalten
  const letters = card.size === 5
    ? [...'BINGO'].map((ch, i) => {
      const l = document.createElement('span');
      l.className = `bingo-letter bingo-letter--${i}`;
      l.textContent = ch;
      l.setAttribute('aria-hidden', 'true');
      return l;
    })
    : [];
  el.replaceChildren(...letters, ...card.cells.map((cell, i) => {
    const node = document.createElement(onCell && !cell.free ? 'button' : 'div');
    node.className = 'bingo-cell';
    const live = cell.free ? null : itemOf?.(cell) ?? cell;
    const rarity = live?.rarity ?? null;
    const amount = live?.amount ?? null;
    if (!cell.free) node.classList.add(rarity ? `r-${rarity}` : funColor(cell.id));
    if (onCell && !cell.free) {
      node.type = 'button';
      node.setAttribute('aria-pressed', String(marked.has(i)));
      node.addEventListener('click', () => onCell(i, node));
    }
    if (cell.free) {
      node.classList.add('is-free');
      node.innerHTML = '<span class="bingo-free">★<b>Frei</b></span>';
    } else {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = urlFor(cell.path);
      const name = document.createElement('span');
      name.className = 'bingo-name';
      name.textContent = cell.name;
      node.append(img, name);
      node.title = [cell.name, amount, rarity && rarityName(rarity)].filter(Boolean).join(' · ');
      if (amount) {
        // Die Zahl steht groß im Icon, z. B. 5 auf dem Kill-Symbol
        const num = document.createElement('span');
        num.className = 'bingo-amount';
        num.textContent = amount;
        node.append(num);
      }
      if (rarity) {
        const badge = document.createElement('span');
        badge.className = 'bingo-rarity';
        badge.textContent = rarityName(rarity);
        node.append(badge);
      }
    }
    if (marked.has(i) && !cell.free) {
      node.classList.add('is-marked');
      const stamp = document.createElement('span');
      stamp.className = 'bingo-stamp';
      stamp.setAttribute('aria-hidden', 'true');
      node.append(stamp);
    }
    if (winning.has(i)) node.classList.add('is-line');
    if (i === stamped) node.classList.add('is-stamped');
    return node;
  }));
}

// Zufällige Karte aus den hochgeladenen Bildern (für die eigene Karte).
// Daves Karte zieht die Datenbank (bingo_new_card), mit derselben Regel.
export function drawCard(items, size, free = true) {
  const withFree = free && size % 2 === 1;
  const need = size * size - (withFree ? 1 : 0);
  if (items.length < need) {
    throw new Error(`Für eine ${size}×${size}-Karte braucht es ${need} Bilder – hochgeladen sind erst ${items.length}.`);
  }
  const pool = items.map(cardCell);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const cells = pool.slice(0, need);
  const center = Math.floor((size * size) / 2);
  if (withFree) cells.splice(center, 0, { free: true });
  return { size, cells, marked: withFree ? [center] : [], created_at: new Date().toISOString() };
}

// "chug-jug_legendary.png" → "Chug Jug" (Seltenheit und Zahl stecken extra in rarityFromFile/amountFromFile)
export function nameFromFile(fileName) {
  return (stripRarity(fileName) || fileName)
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase())
    .slice(0, 40) || 'Item';
}

// Bilder vor dem Hochladen verkleinern: Auf der Karte sind sie klein,
// und kleine Dateien laden in OBS schneller.
export async function shrinkImage(file, max = 256) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`„${file.name}“ ist kein Bild, das der Browser lesen kann.`);
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
  if (blob?.type === 'image/webp') return blob;
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
