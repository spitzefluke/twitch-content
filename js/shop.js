// Kisten-Shop: gemeinsame Helfer für die Webseite und das OBS-Overlay.
// Regeln: Kiste wählen → Goldbarren → Items kaufen (seltener = teurer) →
// Items im Spiel finden: je gefundenes Item 1 Punkt, alle gefunden 10 extra.
import { RARITIES, rarityName } from './bingo.js';

export const DEFAULT_SHOP = {
  items: [
    { name: 'Pistole', rarity: 'common' }, { name: 'Sturmgewehr', rarity: 'common' },
    { name: 'Taktische Schrotflinte', rarity: 'common' }, { name: 'Verband', rarity: 'common' },
    { name: 'Pump', rarity: 'uncommon' }, { name: 'MP', rarity: 'uncommon' },
    { name: 'Mini-Schild', rarity: 'uncommon' }, { name: 'Granate', rarity: 'uncommon' },
    { name: 'Scharfschützengewehr', rarity: 'rare' }, { name: 'Schildtrank', rarity: 'rare' },
    { name: 'Enterhaken', rarity: 'rare' }, { name: 'Burst-Sturmgewehr', rarity: 'rare' },
    { name: 'SCAR', rarity: 'epic' }, { name: 'Raketenwerfer', rarity: 'epic' },
    { name: 'Medkit', rarity: 'epic' }, { name: 'Sprungpad', rarity: 'epic' },
    { name: 'Gold-SCAR', rarity: 'legendary' }, { name: 'Gold-Pump', rarity: 'legendary' },
    { name: 'Heilsprudel', rarity: 'legendary' },
    { name: 'Boss-Waffe', rarity: 'mythic' }, { name: 'Mythisches Item', rarity: 'mythic' },
  ],
  prices: { common: 10, uncommon: 20, rare: 35, epic: 55, legendary: 85, mythic: 130, exotic: 110 },
  shop_seconds: 90,
};
export const ALL_FOUND_BONUS = 10;
const RARITY_ORDER = RARITIES.map((r) => r.id);

export const priceOf = (item, prices = DEFAULT_SHOP.prices) => Number(prices?.[item.rarity] ?? 10);
export const coinsLeft = (run) => (run ? run.coins - run.spent : 0);
export function scoreOf(items = []) {
  const found = items.filter((i) => i.found).length;
  return found + (items.length && found === items.length ? ALL_FOUND_BONUS : 0);
}
export const sortByRarity = (items) => [...items].sort((a, b) =>
  RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name, 'de'));

// Katalog als Text (eine Zeile „Name | Seltenheit“) – zum Bearbeiten im Dialog
export const catalogToText = (items) => items.map((i) => `${i.name} | ${rarityName(i.rarity) || i.rarity}`).join('\n');
export function catalogFromText(text) {
  const byWord = (w) => {
    const low = w.trim().toLowerCase();
    return RARITIES.find((r) => r.id === low || r.name.toLowerCase() === low || r.words.includes(low))?.id;
  };
  return text.split('\n').map((line) => {
    const [name, rar = ''] = line.split('|');
    return { name: (name ?? '').trim().slice(0, 30), rarity: byWord(rar) ?? 'common' };
  }).filter((i) => i.name);
}

// Symbol nach Art des Items, falls es kein Bild gibt
const ICONS = [
  [/verband|medkit|heil|sprudel/i, '🩹'], [/schild/i, '🛡️'], [/granate/i, '💣'], [/rakete/i, '🚀'],
  [/enterhaken|haken/i, '🪝'], [/sprungpad|pad/i, '🦘'], [/scharf|sniper/i, '🎯'], [/boss|mythisch/i, '👑'],
  [/pump|schrot/i, '💥'], [/fisch/i, '🐟'], [/truhe|kiste/i, '🧰'],
];
export const itemIcon = (name) => ICONS.find(([re]) => re.test(name))?.[1] ?? '🔫';

// Eine Fortnite-artige Truhe; der Deckel (.chest-lid) klappt beim Öffnen auf.
export function chestSvg() {
  return `<svg class="chest-svg" viewBox="0 0 120 100" aria-hidden="true">
    <ellipse cx="60" cy="93" rx="44" ry="5" fill="rgba(0,0,0,.35)"/>
    <rect x="14" y="44" width="92" height="46" rx="6" fill="#8a4b1f" stroke="#3a1d08" stroke-width="3"/>
    <rect x="14" y="44" width="92" height="10" fill="#6d3814"/>
    <rect x="22" y="44" width="10" height="46" fill="#f2b92b" stroke="#7a4a00" stroke-width="2"/>
    <rect x="88" y="44" width="10" height="46" fill="#f2b92b" stroke="#7a4a00" stroke-width="2"/>
    <rect x="50" y="52" width="20" height="18" rx="3" fill="#ffd84a" stroke="#7a4a00" stroke-width="2"/>
    <circle cx="60" cy="60" r="3" fill="#7a4a00"/>
    <g class="chest-glow"><ellipse cx="60" cy="44" rx="40" ry="10" fill="#fff3b0" opacity=".9"/></g>
    <g class="chest-lid">
      <path d="M14 46 C14 22 106 22 106 46 Z" fill="#a0582a" stroke="#3a1d08" stroke-width="3" stroke-linejoin="round"/>
      <path d="M22 46 C22 28 32 26 32 26 L32 46 Z M88 46 L88 26 C88 26 98 28 98 46 Z" fill="#f2b92b" stroke="#7a4a00" stroke-width="2"/>
      <path d="M40 30 C52 26 68 26 80 30" stroke="#ffd6a0" stroke-width="3" fill="none" opacity=".6" stroke-linecap="round"/>
    </g>
  </svg>`;
}

// Goldbarren-Symbol für Preise und Guthaben
export const GOLD = '<svg class="gold-bar" viewBox="0 0 24 16" aria-hidden="true"><path d="M5 3h14l4 10H1z" fill="#ffc933" stroke="#8a5a00" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 5h10" stroke="#fff3b0" stroke-width="1.5" stroke-linecap="round"/></svg>';

// Liste der gekauften Items; onMark(index, found) macht sie abhakbar
export function renderLoadout(list, run, { onMark = null, imageFor = null } = {}) {
  const items = run?.items ?? [];
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = run?.status === 'shopping' ? 'Noch nichts gekauft.' : 'Nichts gekauft.';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...items.map((item, i) => {
    const li = document.createElement('li');
    li.className = `loadout-item rar-${item.rarity}${item.found ? ' is-found' : ''}`;
    const icon = document.createElement('span');
    icon.className = 'loadout-icon';
    const img = imageFor?.(item.name);
    if (img) {
      const pic = document.createElement('img');
      pic.src = img;
      pic.alt = '';
      icon.append(pic);
    } else {
      icon.textContent = itemIcon(item.name);
    }
    const name = document.createElement('span');
    name.className = 'loadout-name';
    name.textContent = item.name;
    const rar = document.createElement('small');
    rar.textContent = rarityName(item.rarity);
    name.append(rar);
    let mark;
    if (onMark) {
      mark = document.createElement('button');
      mark.type = 'button';
      mark.className = 'loadout-mark';
      mark.setAttribute('aria-pressed', String(!!item.found));
      mark.textContent = item.found ? '✓ Gefunden' : 'Gefunden?';
      mark.addEventListener('click', () => onMark(i, !item.found, mark));
    } else {
      mark = document.createElement('span');
      mark.className = 'loadout-mark';
      mark.textContent = item.found ? '✓' : '';
    }
    li.append(icon, name, mark);
    return li;
  }));
}
