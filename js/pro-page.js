// Vergleichsseite Free und Pro (pro.html). Was Pro ist und kostet, steht in js/pro.js; die kostenlosen
// Content-Ideen kommen aus js/defaults.js – neue Ideen erscheinen hier also von selbst.
import { DEFAULT_TILES } from './defaults.js';
import { h } from './extras-core.js';
import { PRO_KINDS, PRO_PRICE, PRO_SOON, isProKind } from './pro.js';

const $ = (sel) => document.querySelector(sel);
const icon = (cls) => h('i', { class: `ph ${cls}`, 'aria-hidden': 'true' });
const yes = () => h('span', { class: 'pr-yes', title: 'Enthalten' }, icon('ph-check'), h('span', { class: 'pr-sr' }, 'enthalten'));
const no = () => h('span', { class: 'pr-no', title: 'Nicht enthalten' }, '–', h('span', { class: 'pr-sr' }, 'nicht enthalten'));
// Ideen ohne Spiel im Namen („Fortnite-Bingo“ → „Bingo“)
const ideaName = (t) => t.title.replace(/^Fortnite-/, '');

// Alles außer den Content-Ideen ist in Free und Pro gleich
const BASICS = [
  'Chat-Bot mit eigenen Befehlen, Auto-Nachrichten und Moderation',
  'Alerts mit Alert-Designer und Probe-Alerts',
  'OBS-Overlay mit allen Ebenen, Szenen und Laufband',
  'Design-Bibliothek mit Looks, Look-Baukasten und Artist-Designs',
  'Kanalpunkte, Raid-Schutz und Mods',
  'Statistik, Profil & Zeitplan',
  'Raid-Netzwerk, Discord und Freunde werben',
  'Twitch-Erweiterung (Panel, Komponente, Overlay)',
];

const free = DEFAULT_TILES.filter((t) => !isProKind(t.kind));
const pro = Object.entries(PRO_KINDS);

$('#pr-soon').textContent = PRO_SOON;
$('#pr-price').textContent = PRO_PRICE.month;
$('#pr-price-lead').textContent = PRO_PRICE.label;
$('#pr-free-list').replaceChildren(
  ...BASICS.slice(0, 4).map((t) => h('li', {}, icon('ph-check'), t)),
  h('li', {}, icon('ph-check'), `${free.length} Content-Ideen, z. B. ${free.slice(0, 4).map(ideaName).join(', ')}`));
$('#pr-pro-list').replaceChildren(
  ...pro.map(([, p]) => h('li', {}, icon('ph-star'), h('span', {}, h('b', {}, p.name), ' – ', p.desc))),
  h('li', {}, icon('ph-star'), h('span', {}, h('b', {}, 'Pro-Abzeichen'), ' im Dashboard')));

const group = (title) => h('tr', { class: 'pr-group' }, h('th', { scope: 'colgroup', colspan: 3 }, title));
const row = (name, inFree, extra) => h('tr', {}, h('th', { scope: 'row' }, name, extra ?? null), h('td', {}, inFree ? yes() : no()), h('td', {}, yes()));
$('#pr-table').append(h('tbody', {},
  group('Grundlagen'),
  ...BASICS.map((b) => row(b, true)),
  group('Content-Ideen'),
  ...free.map((t) => row(ideaName(t), true)),
  group('Nur mit Pro'),
  ...pro.map(([, p]) => row(p.name, false, h('small', {}, p.desc)))));
