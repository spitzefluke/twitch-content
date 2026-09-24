// Fortnite-Bingo: gemeinsame Helfer für die Webseite (Dialog) und das OBS-Overlay.

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

// Zeichnet die Karte in `el`. Mit onCell werden die Felder zu Knöpfen (Admins).
export function renderBingoGrid(el, card, { urlFor, onCell = null, stamped = null } = {}) {
  const { cells: winning } = bingoState(card);
  const marked = new Set(card.marked ?? []);
  el.style.setProperty('--n', card.size);
  el.replaceChildren(...card.cells.map((cell, i) => {
    const node = document.createElement(onCell && !cell.free ? 'button' : 'div');
    node.className = 'bingo-cell';
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
      node.title = cell.name;
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

// "chug-jug_legendary.png" → "Chug Jug Legendary"
export function nameFromFile(fileName) {
  return fileName
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
