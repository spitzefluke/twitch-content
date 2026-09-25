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
// „1 Punkt“, „3 Punkte“
export const pointsText = (n) => `${n} Punkt${n === 1 ? '' : 'e'}`;
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

// ============================================================
// Koop-Versus: Tauziehen um die Punkte
// ============================================================
// Farben der Spieler in der Reihenfolge, in der sie beigetreten sind
export const PLAYER_COLORS = ['#4fb6ff', '#ff5d73', '#7bd02f', '#c46cff'];
export const versusOrder = (runs) => [...runs].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
export const colorOf = (runs, run) => PLAYER_COLORS[Math.max(0, versusOrder(runs).findIndex((r) => r.id === run.id)) % PLAYER_COLORS.length];
// Alle haben eingekauft: Das Duell läuft (oder ist vorbei)
export const versusLive = (runs) => runs.length > 1 && runs.every((r) => ['playing', 'done'].includes(r.status));
export function winnersOf(runs) {
  if (!runs.length) return [];
  const best = Math.max(...runs.map((r) => scoreOf(r.items)));
  return runs.filter((r) => scoreOf(r.items) === best);
}

// Der Balken: Jede Seite ist so breit wie ihre Punkte (+2, damit bei 0:0 alle gleich
// breit starten). Findet jemand etwas, wächst seine Seite und schiebt die anderen weg.
export function renderTug(el, runs, { me = null, winners = null } = {}) {
  const list = versusOrder(runs);
  let bar = el.querySelector('.tug-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'tug-bar';
    el.replaceChildren(bar);
  }
  el.classList.toggle('is-duo', list.length === 2);
  const old = new Map([...bar.children].map((seg) => [seg.dataset.id, seg]));
  const segs = list.map((r, i) => {
    let seg = old.get(String(r.id));
    const score = scoreOf(r.items);
    if (!seg) {
      seg = document.createElement('div');
      seg.className = 'tug-seg';
      seg.dataset.id = r.id;
      seg.innerHTML = '<span class="tug-who"><span class="tug-name"></span><small class="tug-found"></small></span><b class="tug-score"></b>';
      seg.dataset.score = score;
    }
    const before = Number(seg.dataset.score);
    if (score > before) {
      seg.classList.remove('is-push');
      void seg.offsetWidth;
      seg.classList.add('is-push');
    }
    seg.dataset.score = score;
    seg.style.setProperty('--pc', PLAYER_COLORS[i % PLAYER_COLORS.length]);
    seg.style.flexGrow = score + 2;
    seg.classList.toggle('is-me', r.user_id === me);
    seg.classList.toggle('is-last', i === list.length - 1);
    seg.classList.toggle('is-right', list.length === 2 && i === 1);
    seg.classList.toggle('is-winner', !!winners?.some((w) => w.id === r.id));
    seg.classList.toggle('is-done', r.status === 'done');
    seg.querySelector('.tug-name').textContent = r.player;
    seg.querySelector('.tug-found').textContent = `${r.items.filter((x) => x.found).length}/${r.items.length}`;
    seg.querySelector('.tug-score').textContent = score;
    return seg;
  });
  bar.replaceChildren(...segs);
}

// VS-Bildschirm: Namensschilder fliegen von beiden Seiten rein, dazwischen knallt „VS“
export function versusIntro(host, runs, { onDone = null, sfx = null } = {}) {
  const list = versusOrder(runs);
  const fx = document.createElement('div');
  fx.className = 'vs-intro';
  fx.style.setProperty('--n', list.length);
  const bg = document.createElement('div');
  bg.className = 'vs-bg';
  bg.append(...list.map((r, i) => {
    const s = document.createElement('span');
    s.style.setProperty('--pc', PLAYER_COLORS[i % PLAYER_COLORS.length]);
    return s;
  }));
  const row = document.createElement('div');
  row.className = 'vs-row';
  list.forEach((r, i) => {
    if (i) {
      const x = document.createElement('b');
      x.className = 'vs-x';
      x.textContent = 'VS';
      x.style.setProperty('--d', `${0.35 + i * 0.25}s`);
      row.append(x);
    }
    const plate = document.createElement('span');
    plate.className = `vs-plate${i % 2 ? ' from-right' : ''}`;
    plate.style.setProperty('--pc', PLAYER_COLORS[i % PLAYER_COLORS.length]);
    plate.style.setProperty('--d', `${i * 0.25}s`);
    plate.textContent = r.player;
    row.append(plate);
  });
  const sub = document.createElement('p');
  sub.className = 'vs-sub';
  sub.textContent = 'Alle haben eingekauft – findet eure Items!';
  fx.append(bg, row, sub);
  host.append(fx);
  sfx?.whoosh?.();
  setTimeout(() => { sfx?.hit?.('boom'); fx.classList.add('is-slam'); }, 450 + (list.length - 1) * 250);
  const end = () => {
    if (!fx.isConnected) return;
    fx.classList.add('is-out');
    setTimeout(() => { fx.remove(); onDone?.(); }, 450);
  };
  fx.addEventListener('click', end);
  setTimeout(end, 2600 + list.length * 250);
  return fx;
}

// Sieger-Feier: Krone, Name, Konfetti in den Farben des Siegers
export function versusWinner(host, runs, { sfx = null, me = null } = {}) {
  const list = versusOrder(runs);
  const wins = winnersOf(list);
  const fx = document.createElement('div');
  fx.className = 'vs-win';
  const color = wins.length === 1 ? PLAYER_COLORS[list.indexOf(wins[0]) % PLAYER_COLORS.length] : '#ffd36b';
  fx.style.setProperty('--pc', color);
  const score = wins.length ? scoreOf(wins[0].items) : 0;
  const title = wins.length === 1 ? `${wins[0].player} gewinnt!` : `Unentschieden!`;
  const subText = wins.length === 1
    ? `mit ${score} Punkt${score === 1 ? '' : 'en'}${wins[0].user_id === me ? ' – das bist du! 🎉' : ''}`
    : `${wins.map((w) => w.player).join(' & ')} mit je ${score} Punkt${score === 1 ? '' : 'en'}`;
  fx.innerHTML = '<div class="vs-rays"></div><div class="vs-crown">👑</div><div class="vs-win-name"></div><p class="vs-win-sub"></p><div class="vs-confetti"></div>';
  fx.querySelector('.vs-win-name').textContent = title;
  fx.querySelector('.vs-win-sub').textContent = subText;
  const confetti = fx.querySelector('.vs-confetti');
  const colors = [color, '#ffd36b', '#ffffff', ...PLAYER_COLORS];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.style.setProperty('--x', `${Math.random() * 100}%`);
    c.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
    c.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    c.style.setProperty('--d', `${Math.random() * 0.9}s`);
    c.style.setProperty('--t', `${2.2 + Math.random() * 1.6}s`);
    c.style.background = colors[i % colors.length];
    confetti.append(c);
  }
  host.append(fx);
  sfx?.play?.('applause');
  setTimeout(() => sfx?.play?.('gong'), 300);
  const end = () => {
    if (!fx.isConnected) return;
    fx.classList.add('is-out');
    setTimeout(() => fx.remove(), 450);
  };
  fx.addEventListener('click', end);
  setTimeout(end, 6500);
  return fx;
}
