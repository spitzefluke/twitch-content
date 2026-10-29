// Design-Bibliothek im Dashboard (Design „Design-Bibliothek neu“): alle Looks an einem Ort –
//   Komplett-Looks (THEME_PACKS, js/theme-packs.js): Overlay, Kamera-Rahmen, Alerts, Chat, Laufband, Bingo
//                 und fünf Szenen. „Look installieren“ setzt die Overlay-Werte zentral (overlay_save) und
//                 speichert das Alert-Design für alle Alert-Arten (alert_config).
//   Overlays (OVERLAY_THEMES): nur das Aussehen der Karten – setzt otheme (OBS mit live=1 zeigt es sofort).
//   Alerts (ALERT_PRESETS): stellt das Design im Alert-Designer für alle Arten ein; gespeichert wird dort.
//   Zweiter Reiter „Alert-Designer“ (js/alert-designer.js, früher eigene Seite „Alerts“): jede Alert-Art selbst gestalten.
//   Eigene Looks (js/look-builder.js): im Look-Baukasten zusammengestellt, gespeichert als Overlay-Vorlage
//                 mit look=1 – übernehmen setzt Overlay-Werte, Alert-Design (+ Farbe) und ggf. die Profilfarbe.
//   Von Artists (artist_gallery, Migration …_artists.sql): freigegebene Uploads mit Credit – Alert-Grafik
//                 (Bild für alle Alerts), Szenen-Hintergrund (scbg), Look (Grund-Design, Farbe, Hintergrund,
//                 optional Alert-Bild) und Sammelkarten-Bild. Übernehmen zählt artist_asset_use, Melden geht an den Admin.
// Oben die große Vorschau (overlay.html im iframe, mit Szenen und Vorher/Nachher), darunter die Galerie
// mit Art, Stimmung, Suche, Sortierung und Favoriten (Favoriten merkt sich dieser Browser).
import { ALERT_KINDS, ALERT_LOOKS, ALERT_PRESETS, builtinMediaUrl, normalizeAlertConfig, normalizeDesign } from './alerts.js';
import { h } from './extras-core.js';
import { artistFileUrl, isArtistVideo } from './artist-files.js';
import { LOOK_KEYS, openLookBuilder, parseLook } from './look-builder.js';
import { OVERLAY_THEMES, SCENE_MOTIONS } from './overlay-stage.js';
import { OVERLAY_DEFAULTS, THEME_CATEGORIES, THEME_PACKS, THEME_SCENES } from './theme-packs.js';

const $ = (sel) => document.querySelector(sel);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const FAV_KEY = 'sh_lib_favs_v1';

// Vorschau der Szenen: immer dieselben Beispielkarten, damit man Designs vergleichen kann
const SHOWCASE = {
  game: 'next=tl&alerts=tc&goal=tr&labels=bl&camframe=1&cam=70,55,28,33&edit=1',
  start: 'scene=start&labels=bl',
  brb: 'scene=brb&labels=bl',
  chat: 'scene=chat&alerts=tc&labels=bl',
  end: 'scene=end',
};
const TYPES = {
  look: { name: 'Komplett-Look', plural: 'Komplett-Looks', icon: 'ph-package', desc: 'Overlay, Kamera-Rahmen, Alerts, Chat und 5 Szenen – alles auf einmal.' },
  overlay: { name: 'Overlay', plural: 'Overlays', icon: 'ph-frame-corners', desc: 'Nur das Aussehen der Karten im Overlay. Alerts bleiben, wie sie sind.' },
  alert: { name: 'Alert', plural: 'Alerts', icon: 'ph-bell-ringing', desc: 'Nur Follow-, Abo- und Bits-Alerts. Texte und Sounds bleiben.' },
  mine: { name: 'Eigener Look', plural: 'Eigene Looks', icon: 'ph-sliders-horizontal', desc: 'Im Look-Baukasten selbst zusammengestellt – mit deiner Farbe.' },
  community: { name: 'Von Artists', plural: 'Von Artists', icon: 'ph-paint-brush', desc: 'Alerts, Hintergründe, Looks und Karten von Artists – kostenlos, mit Credit.' },
};
// Artist-Uploads: was genau es ist
const ART_KIND = {
  alert: 'Alert-Grafik', background: 'Szenen-Hintergrund', look: 'Look', card: 'Sammelkarte',
};
// Stimmung aus den Schlagwörtern eines Artist-Uploads raten
const TAG_MOOD = {
  gaming: 'gaming', game: 'gaming', hype: 'gaming', neon: 'gaming', esport: 'gaming', lofi: 'cozy', chill: 'cozy', cozy: 'cozy', gemütlich: 'cozy', cafe: 'cozy',
  bunt: 'fun', fun: 'fun', cute: 'fun', kawaii: 'fun', manga: 'fun', anime: 'fun', space: 'scifi', weltraum: 'scifi', cyberpunk: 'scifi', scifi: 'scifi', sci: 'scifi',
  natur: 'nature', wald: 'nature', nature: 'nature', ocean: 'nature', meer: 'nature', fantasy: 'fantasy', horror: 'fantasy', dark: 'fantasy',
  retro: 'retro', pixel: 'retro', arcade: 'retro', edel: 'elegant', gold: 'elegant', elegant: 'elegant', minimal: 'minimal', clean: 'minimal',
  halloween: 'seasonal', weihnachten: 'seasonal', xmas: 'seasonal', ostern: 'seasonal', sommer: 'seasonal', winter: 'seasonal', valentinstag: 'seasonal',
};
const MOOD_ICON = {
  all: 'ph-squares-four', gaming: 'ph-game-controller', cozy: 'ph-coffee', fun: 'ph-confetti', scifi: 'ph-planet', nature: 'ph-tree',
  fantasy: 'ph-skull', retro: 'ph-joystick', elegant: 'ph-crown', minimal: 'ph-minus', seasonal: 'ph-snowflake',
};
const OVERLAY_MOOD = {
  standard: 'minimal', neon: 'gaming', glass: 'elegant', gamer: 'gaming', retro: 'retro', gold: 'elegant', candy: 'fun', minimal: 'minimal',
  space: 'scifi', hud: 'scifi', kawaii: 'fun', horror: 'fantasy', forest: 'nature', fantasy: 'fantasy', ocean: 'nature', spooky: 'seasonal', xmas: 'seasonal',
  lofi: 'cozy', manga: 'fun', cyberpunk: 'scifi', valentine: 'seasonal', easter: 'seasonal', summer: 'seasonal', newyear: 'seasonal',
};
const OVERLAY_COLOR = {
  standard: '#9146ff', neon: '#ff4fd8', glass: '#cfb3ff', gamer: '#ff2e4d', retro: '#3ddc84', gold: '#e8c46a', candy: '#ff7ac8', minimal: '#ffb81c',
  space: '#8ea2ff', hud: '#35f0ff', kawaii: '#ff8fc8', horror: '#d1162f', forest: '#79c95a', fantasy: '#d8a64a', ocean: '#2fd3c6', spooky: '#ff8a1c', xmas: '#e3283e',
  lofi: '#f2a65a', manga: '#ff4d6d', cyberpunk: '#fcee0a', valentine: '#ff5c8a', easter: '#9be38b', summer: '#ffb02e', newyear: '#ffd76a',
};
const OVERLAY_BG = { space: 'bg-space', hud: 'bg-hud', kawaii: 'bg-kawaii', horror: 'bg-horror', forest: 'bg-forest', fantasy: 'bg-fantasy', ocean: 'bg-ocean', spooky: 'bg-spooky', xmas: 'bg-xmas',
  lofi: 'bg-lofi', manga: 'bg-manga', cyberpunk: 'bg-cyberpunk', valentine: 'bg-valentine', easter: 'bg-easter', summer: 'bg-summer', newyear: 'bg-newyear' };
const ALERT_MOOD = {
  party: 'fun', star: 'cozy', neon: 'gaming', arcade: 'retro', comic: 'fun', royal: 'elegant', hype: 'gaming', glitch: 'gaming', fire: 'gaming',
  diamond: 'elegant', gift: 'fun', ice: 'cozy', champ: 'gaming', clean: 'minimal', cosmos: 'scifi', mission: 'scifi', kawaii: 'fun',
  bloodmoon: 'fantasy', forest: 'nature', quest: 'fantasy', deepsea: 'nature', halloween: 'seasonal', xmas: 'seasonal',
  lofi: 'cozy', manga: 'fun', cyberpunk: 'scifi', valentine: 'seasonal', easter: 'seasonal', summer: 'seasonal', newyear: 'seasonal',
};
const HOT = new Set(['look:neon-night', 'look:pixel', 'look:cozy', 'look:party', 'look:halloween', 'overlay:neon', 'overlay:glass', 'alert:party', 'alert:hype', 'alert:neon']);
const NEW = new Set(['look:kosmos', 'look:mission', 'look:kawaii', 'look:bloodmoon', 'look:heroes', 'overlay:space', 'overlay:hud', 'overlay:kawaii',
  'alert:cosmos', 'alert:mission', 'alert:bloodmoon', 'alert:quest',
  'look:lofi', 'look:manga', 'look:neoncity', 'look:valentine', 'look:easter', 'look:summer', 'look:newyear',
  'overlay:lofi', 'overlay:manga', 'overlay:cyberpunk', 'overlay:valentine', 'overlay:easter', 'overlay:summer', 'overlay:newyear',
  'alert:lofi', 'alert:manga', 'alert:cyberpunk', 'alert:valentine', 'alert:easter', 'alert:summer', 'alert:newyear']);
const NAMES = {
  cfstyle: { glow: 'Leuchten', clean: 'Schlicht', corners: 'Ecken', neon: 'Neon' },
  tstyle: { bar: 'Laufband', neon: 'Neon', board: 'LED-Anzeige' },
  chstyle: { card: 'Karte', bubble: 'Sprechblasen', clean: 'Schlicht' },
  bstyle: { classic: 'Bunt', neon: 'Neon', paper: 'Papier' },
  scmove: Object.fromEntries(SCENE_MOTIONS.map((m) => [m.id, m.name])),
};

const pack = (id) => THEME_PACKS.find((t) => t.id === id);
const preset = (id) => ALERT_PRESETS.find((p) => p.id === id);
const overlayTheme = (id) => OVERLAY_THEMES.find((t) => t.id === id);
const lookName = (id) => ALERT_LOOKS.find((l) => l.id === id)?.name ?? id;
const moodName = (id) => THEME_CATEGORIES.find((c) => c.id === id)?.name ?? '';
const icon = (cls) => h('i', { class: `ph ${cls}`, 'aria-hidden': 'true' });
const RARITY = { common: 'Gewöhnlich', uncommon: 'Ungewöhnlich', rare: 'Selten', epic: 'Episch', legendary: 'Legendär' };

const BASE_ITEMS = [
  ...THEME_PACKS.map((t) => ({
    key: `look:${t.id}`, type: 'look', id: t.id, name: t.name, mood: t.cat, color: t.color, bg: t.bg,
    otheme: t.overlay.otheme, cf: t.overlay.cfstyle, media: preset(t.alert)?.design.media ?? '', desc: t.desc,
  })),
  ...OVERLAY_THEMES.map((o) => ({
    key: `overlay:${o.id}`, type: 'overlay', id: o.id, name: o.name, mood: OVERLAY_MOOD[o.id] ?? 'minimal', color: OVERLAY_COLOR[o.id] ?? '#9146ff',
    bg: OVERLAY_BG[o.id] ?? 'bg-storm', otheme: o.id, cf: 'glow', media: '', desc: `${o.desc}. Gilt für alle Karten im Overlay.`,
  })),
  ...ALERT_PRESETS.map((p) => ({
    key: `alert:${p.id}`, type: 'alert', id: p.id, name: p.name, mood: ALERT_MOOD[p.id] ?? 'fun', color: p.design.color || '#9146ff',
    bg: 'bg-city', otheme: 'standard', cf: 'glow', media: p.design.media,
    desc: `Look „${lookName(p.design.look)}“${p.design.color ? ' mit eigener Farbe' : ''} und eigener Animation – für Follow, Abo, Bits und Raids.`,
  })),
].map((x, i) => ({ ...x, order: i, hot: HOT.has(x.key), isNew: NEW.has(x.key) }));
let ITEMS = BASE_ITEMS;
const item = (key) => ITEMS.find((x) => x.key === key);

// Eigene Looks (Look-Baukasten) als Einträge der Bibliothek
function mineItem(look, i) {
  const o = look.overlay;
  const p = preset(look.apreset);
  return {
    key: `mine:${look.id}`, type: 'mine', id: look.id, look, name: look.name, mood: OVERLAY_MOOD[o.otheme] ?? 'minimal',
    color: o.accent ? `#${o.accent}` : OVERLAY_COLOR[o.otheme] ?? '#9146ff', bg: OVERLAY_BG[o.otheme] ?? 'bg-storm',
    otheme: o.otheme || 'standard', cf: o.cfstyle || 'glow', media: p?.design.media ?? '',
    desc: `Dein Look: ${overlayTheme(o.otheme)?.name ?? 'Standard'}${o.accent ? ` in #${o.accent}` : ''}${p ? `, Alerts „${p.name}“` : ''}${o.scmove ? `, Szenen mit ${NAMES.scmove[o.scmove]}` : ''}.`,
    order: -1000 + i, hot: false, isNew: false,
  };
}

// Artist-Uploads als Einträge der Bibliothek
function communityItem({ asset: a, artist }, i) {
  const mood = a.tags.map((t) => TAG_MOOD[t]).find(Boolean) ?? (a.kind === 'background' ? 'cozy' : 'fun');
  const fresh = a.approved_at && Date.now() - Date.parse(a.approved_at) < 21 * 86400000;
  return {
    key: `community:${a.id}`, type: 'community', id: a.id, art: a.kind, name: a.title, mood, color: a.extra?.accent || '#9146ff',
    bg: 'bg-city', otheme: a.extra?.base || 'standard', cf: 'glow', media: a.kind === 'alert' ? `a:${a.file}` : a.extra?.alert ? `a:${a.extra.alert}` : '',
    file: a.file, extra: a.extra ?? {}, tags: a.tags, uses: a.uses, artist,
    desc: a.description || `${ART_KIND[a.kind]} von ${artist.name}.`,
    order: BASE_ITEMS.length + i, hot: a.uses >= 10, isNew: !!fresh,
  };
}

const lib = {
  api: null, toast: null, germanError: String, canEdit: () => false, setPage: () => {}, openDesigner: async () => {}, useAlertPreset: null, installAlertPreset: null,
  useAlertMedia: async () => 'missing', useAlertColor: async () => 'missing', presets: null, gallery: [], addArtistCard: async () => { throw new Error('Sammelkarten sind nicht bereit.'); },
  liveUrl: () => '', localObsQuery: () => '',
  type: 'all', mood: 'all', query: '', favOnly: false, favs: [], sort: 'hot',
  sel: 'look:neon-night', scene: 'game', compare: false, split: 50, kind: 'follow',
  params: '', access: null, alertCfg: null, busy: false, full: false, view: 'gallery',
};

export function setupLibrary(deps) {
  Object.assign(lib, deps);
  $('#lb-views').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lb-view]');
    if (b) showLibraryView(b.dataset.lbView);
  });
  // Favoriten aus der Community kommen erst mit der Galerie – deshalb hier nicht ausfiltern
  try { lib.favs = JSON.parse(localStorage.getItem(FAV_KEY) || '[]').filter((k) => typeof k === 'string').slice(0, 200); } catch { lib.favs = []; }
  $('#lb-kind').replaceChildren(...ALERT_KINDS.map((k) => new Option(k.label, k.kind)));
  $('#lb-kind').value = lib.kind;

  $('#lb-q').addEventListener('input', (e) => { lib.query = e.target.value.trim().toLowerCase(); paintGallery(); });
  $('#lb-favonly').addEventListener('click', () => { lib.favOnly = !lib.favOnly; paintGallery(); });
  $('#lb-sort').addEventListener('change', (e) => { lib.sort = e.target.value; paintGallery(); });
  $('#lb-reset').addEventListener('click', () => {
    Object.assign(lib, { type: 'all', mood: 'all', query: '', favOnly: false });
    $('#lb-q').value = '';
    paintGallery();
  });
  $('#lb-types').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (b) { lib.type = lib.type === b.dataset.type ? 'all' : b.dataset.type; paintGallery(); }
  });
  $('#lb-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (b) { lib.type = b.dataset.type; paintGallery(); }
  });
  $('#lb-moods').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mood]');
    if (b) { lib.mood = b.dataset.mood; paintGallery(); }
  });
  $('#lb-grid').addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { toggleFav(fav.dataset.fav); return; }
    const b = e.target.closest('[data-key]');
    if (!b) return;
    select(b.dataset.key);
    // Auf dem Handy liegt die Vorschau weiter oben – hinscrollen
    const hero = $('#lb-hero');
    if (hero.getBoundingClientRect().top < 60) hero.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  });
  for (const box of ['#lb-scenes', '#lb-full-scenes']) {
    $(box).addEventListener('click', (e) => {
      const b = e.target.closest('[data-scene]');
      if (b) { lib.scene = b.dataset.scene; paintHero(); }
    });
  }
  $('#lb-compare').addEventListener('change', (e) => { lib.compare = e.target.checked; paintHero(); });
  $('#lb-split').addEventListener('input', (e) => { lib.split = Number(e.target.value); paintSplit(); });
  $('#lb-kind').addEventListener('change', (e) => { lib.kind = e.target.value; sendAlerts(); });
  $('#lb-replay').addEventListener('click', sendAlerts);
  $('#lb-fav').addEventListener('click', () => toggleFav(lib.sel));
  for (const b of document.querySelectorAll('[data-lb-apply]')) b.addEventListener('click', apply);
  $('#lb-build').addEventListener('click', () => openLookBuilder(builderDeps()));
  $('#lb-credit').addEventListener('click', (e) => {
    if (e.target.closest('[data-report]')) report();
    if (e.target.closest('[data-edit-look]')) openLookBuilder(builderDeps(), item(lib.sel)?.look);
    if (e.target.closest('[data-del-look]')) deleteLook();
  });
  $('#lb-links').addEventListener('click', copyLink);

  // Vollbild: dieselbe Vorschau wandert in das Fenster und wieder zurück
  const full = $('#lb-full');
  $('#lb-open-full').addEventListener('click', () => {
    lib.full = true;
    $('#lb-full-stage').append($('#lb-screen'));
    paintHero();
    full.showModal();
  });
  full.addEventListener('close', () => {
    lib.full = false;
    $('#lb-stage-slot').append($('#lb-screen'));
    paintHero();
  });
  $('#lb-prev').addEventListener('click', () => step(-1));
  $('#lb-next').addEventListener('click', () => step(1));
  full.addEventListener('keydown', (e) => {
    if (e.target.closest('select, input')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  });

  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'sh-alert-preview-ready') return;
    const frame = [...document.querySelectorAll('#lb-screen iframe')].find((f) => f.contentWindow === e.source);
    if (!frame) return;
    frame.dataset.ready = '1';
    sendAlert(frame, true);
  });
  new ResizeObserver(fit).observe($('#lb-screen'));
  paintGallery();
}

// Beim Öffnen der Seite: aktuelle Overlay-Einstellungen und Alerts laden (für Vorschau, Vorher und „aktiv“)
export async function openLibrary() {
  showLibraryView(lib.view);
  const [config, access, alerts, gallery] = await Promise.all([
    lib.api.getOverlayConfig().catch(() => null),
    lib.api.overlayAccess().catch(() => null),
    lib.api.getAlertConfig().catch(() => null),
    // Ohne Migration …_artists.sql: einfach keine Artist-Designs
    lib.api.artistGallery?.().catch(() => []) ?? [],
    loadPresets(),
  ]);
  lib.gallery = Array.isArray(gallery) ? gallery : [];
  rebuildItems();
  lib.access = access;
  lib.params = config?.params || safeLocal();
  lib.alertCfg = alerts ? normalizeAlertConfig(alerts) : null;
  paintGallery();
}

// Reiter „Designs entdecken“ ↔ „Alert-Designer“. open=false: nur umschalten (die Seite lädt den Designer beim Öffnen)
export function showLibraryView(view, { open = true } = {}) {
  lib.view = view === 'designer' ? 'designer' : 'gallery';
  const designer = lib.view === 'designer';
  $('#lb-gallery-view').hidden = designer;
  $('#lb-designer-view').hidden = !designer;
  $('#lb').querySelector('.lb-tools').hidden = designer;
  document.querySelectorAll('#lb-views [data-lb-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.lbView === lib.view)));
  if (designer && open) lib.openDesigner();
}

// Nach „Übernehmen“ eines Alert-Designs: Reiter Alert-Designer zeigen, dort wird gespeichert
function goDesigner() {
  showLibraryView('designer', { open: false });
  scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
}

async function loadPresets() {
  lib.presets = await lib.api.getOverlayPresets?.().catch(() => null) ?? null;
}
function rebuildItems() {
  const mine = (lib.presets ?? []).map(parseLook).filter(Boolean);
  ITEMS = [...mine.map(mineItem), ...BASE_ITEMS, ...lib.gallery.map(communityItem)];
}

function builderDeps() {
  return {
    api: lib.api, toast: lib.toast, germanError: lib.germanError, presets: () => lib.presets,
    onSaved: async (name, applyNow) => {
      await loadPresets();
      rebuildItems();
      const x = ITEMS.find((i) => i.type === 'mine' && i.name.toLowerCase() === name.toLowerCase());
      lib.type = 'mine';
      if (x) lib.sel = x.key;
      paintGallery();
      if (x && applyNow) await apply({ confirmed: true });
      else lib.toast(`Look „${name}“ gespeichert – du findest ihn unter „Eigene Looks“.`, 'ok');
    },
  };
}

async function deleteLook() {
  const x = item(lib.sel);
  if (x?.type !== 'mine' || !confirm(`Look „${x.name}“ löschen? Dein Overlay bleibt, wie es gerade ist.`)) return;
  try {
    await lib.api.deleteOverlayPreset(x.id);
    await loadPresets();
    rebuildItems();
    lib.sel = ITEMS[0].key;
    paintGallery();
  } catch (err) {
    lib.toast(lib.germanError(err), 'error');
  }
}

function safeLocal() {
  try { return lib.localObsQuery() ?? ''; } catch { return ''; }
}

// ---------- Was gerade gilt ----------
function current(k) {
  return new URLSearchParams(lib.params).get(k) ?? OVERLAY_DEFAULTS[k];
}
const isInstalled = (t) => Object.entries(t.overlay).every(([k, v]) => current(k) === v);
// Alert-Design aus der Bibliothek, das gerade für alle Alert-Arten gilt
function alertInUse() {
  const kinds = lib.alertCfg?.kinds;
  if (!kinds) return null;
  return ALERT_PRESETS.find((p) => ALERT_KINDS.every((k) => {
    const d = kinds[k.kind];
    return d && Object.entries(p.design).every(([f, v]) => (d[f] ?? '') === v);
  }))?.id ?? null;
}
function isActive(x) {
  if (x.type === 'look') return isInstalled(pack(x.id));
  if (x.type === 'overlay') return current('otheme') === x.id;
  if (x.type === 'community') return communityActive(x);
  if (x.type === 'mine') return LOOK_KEYS.every((k) => (current(k) ?? '') === (x.look.overlay[k] ?? OVERLAY_DEFAULTS[k] ?? ''));
  return alertInUse() === x.id;
}
const alertsShow = (media) => !!lib.alertCfg?.kinds && ALERT_KINDS.every((k) => lib.alertCfg.kinds[k.kind]?.media === media);
const accentOf = (x) => (x.extra.accent ?? '').replace(/^#/, '');
function communityActive(x) {
  if (x.art === 'alert') return alertsShow(x.media);
  if (x.art === 'background') return current('scbg') === x.file;
  if (x.art === 'look') return current('scbg') === x.file && current('otheme') === x.otheme && (!x.extra.accent || current('accent') === accentOf(x));
  return false;
}
function activeName(type) {
  if (type === 'look') return THEME_PACKS.find(isInstalled)?.name ?? 'Dein Overlay';
  if (type === 'overlay') return overlayTheme(current('otheme'))?.name ?? 'Standard';
  if (type === 'community' || type === 'mine') return 'Dein Overlay';
  return preset(alertInUse())?.name ?? 'Deine Alerts';
}
const editable = (x) => lib.canEdit() && (x.type === 'alert' || (x.type === 'community' && ['alert', 'card'].includes(x.art)) || lib.access?.can_edit !== false);

// ---------- Galerie ----------
function filtered() {
  const q = lib.query;
  const list = ITEMS.filter((x) => (lib.type === 'all' || x.type === lib.type)
    && (lib.mood === 'all' || x.mood === lib.mood)
    && (!lib.favOnly || lib.favs.includes(x.key))
    && (!q || `${x.name} ${x.desc} ${moodName(x.mood)} ${TYPES[x.type].name} ${x.artist?.name ?? ''} ${(x.tags ?? []).join(' ')} ${ART_KIND[x.art] ?? ''}`.toLowerCase().includes(q)));
  const by = lib.sort === 'az' ? (a, b) => a.name.localeCompare(b.name, 'de')
    : lib.sort === 'new' ? (a, b) => (b.isNew - a.isNew) || a.order - b.order
      : (a, b) => (b.hot - a.hot) || a.order - b.order;
  return list.sort(by);
}

function paintGallery() {
  const counts = { all: ITEMS.length, look: 0, overlay: 0, alert: 0, community: 0, mine: 0 };
  for (const x of ITEMS) counts[x.type]++;
  const types = ['look', 'overlay', 'alert', 'community'].filter((t) => t !== 'community' || counts.community);
  if ((lib.type === 'community' || lib.type === 'mine') && !counts[lib.type]) lib.type = 'all';
  $('#lb-build').hidden = !lib.canEdit();
  $('#lb-types').replaceChildren(...types.map((t) => h('button', {
    type: 'button', class: 'lb-type', 'data-type': t, 'aria-pressed': String(lib.type === t),
  }, icon(TYPES[t].icon), h('b', {}, TYPES[t].plural, ' ', h('span', {}, String(counts[t]))), h('small', {}, TYPES[t].desc))));
  $('#lb-tabs').replaceChildren(...[['all', 'Alle'], ['mine', 'Eigene Looks'], ['look', 'Komplett-Looks'], ['overlay', 'Overlays'], ['alert', 'Alerts'], ['community', 'Von Artists']]
    .filter(([t]) => !['community', 'mine'].includes(t) || counts[t]).map(([t, n]) => h('button', {
    type: 'button', role: 'tab', 'data-type': t, 'aria-selected': String(lib.type === t),
  }, n, ' ', h('span', {}, String(counts[t])))));
  $('#lb-moods').replaceChildren(...THEME_CATEGORIES.map((c) => h('button', {
    type: 'button', class: 'lb-mood', 'data-mood': c.id, 'aria-pressed': String(lib.mood === c.id),
  }, icon(MOOD_ICON[c.id] ?? 'ph-squares-four'), c.name)));
  const fav = $('#lb-favonly');
  fav.setAttribute('aria-pressed', String(lib.favOnly));
  fav.querySelector('span').textContent = String(lib.favs.filter((k) => item(k)).length);
  $('#lb-sort').value = lib.sort;

  const list = filtered();
  $('#lb-count').textContent = `${list.length} ${list.length === 1 ? 'Design' : 'Designs'}${lib.favOnly ? ' in deinen Favoriten' : ''}`;
  $('#lb-grid').replaceChildren(...list.map(card));
  $('#lb-empty').hidden = list.length > 0;
  paintHero();
}

function artMedia(path, alt = '') {
  const src = artistFileUrl(path);
  if (!src) return null;
  return isArtistVideo(path) ? h('video', { src, muted: true, loop: true, autoplay: !reduced(), playsinline: true, preload: 'metadata', 'aria-hidden': 'true' })
    : h('img', { src, alt, loading: 'lazy', decoding: 'async' });
}

function thumb(x) {
  if (x.type === 'community') {
    const el = h('span', { class: `th-thumb lb-art-thumb is-${x.art}` });
    el.style.setProperty('--tc', x.color);
    if (x.art === 'background' || x.art === 'look') {
      const src = artistFileUrl(x.file);
      if (src) el.style.backgroundImage = `url("${src.replace(/["\\]/g, '')}")`;
      if (x.media) el.append(h('span', { class: 'th-t-alert' }, artMedia(x.media.slice(2))));
    } else el.append(h('span', { class: 'lb-art-obj' }, artMedia(x.file)));
    return el;
  }
  const el = h('span', { class: 'th-thumb', 'data-otheme': x.otheme, 'data-cf': x.cf },
    h('span', { class: 'th-t-cam' }), h('span', { class: 'th-t-bar' }, h('i'), h('i')));
  el.style.setProperty('--tc', x.color);
  el.style.backgroundImage = `linear-gradient(160deg, color-mix(in srgb, ${x.color} 30%, transparent), rgba(7, 6, 13, .72)), url("assets/${x.bg}.svg")`;
  if (x.media.startsWith('b:')) el.append(h('span', { class: 'th-t-alert' }, h('img', { src: builtinMediaUrl(x.media.slice(2)), alt: '' })));
  return el;
}

function card(x) {
  const fav = lib.favs.includes(x.key);
  const active = isActive(x);
  const pick = h('button', {
    type: 'button', class: 'lb-pick', 'data-key': x.key, 'aria-pressed': String(x.key === lib.sel),
    'aria-label': `${x.name} – ${TYPES[x.type].name}, ${moodName(x.mood)}${active ? ', aktiv' : ''}`,
  }, thumb(x), h('span', { class: 'lb-badges' },
    x.isNew && h('span', { class: 'lb-badge is-new' }, 'Neu'),
    x.hot && h('span', { class: 'lb-badge' }, 'Beliebt'),
    active && h('span', { class: 'lb-badge is-on' }, '✓ Aktiv')));
  return h('div', { class: 'lb-item' }, pick,
    h('button', { type: 'button', class: 'lb-fav', 'data-fav': x.key, 'aria-pressed': String(fav), 'aria-label': `${x.name} als Favorit merken`, title: 'Favorit' }, icon('ph-heart')),
    h('span', { class: 'lb-item-text' }, h('b', {}, x.name),
      h('small', {}, x.type === 'community' ? `${ART_KIND[x.art]} · von ${x.artist.name}` : x.type === 'mine' ? 'Eigener Look' : `${TYPES[x.type].name} · ${moodName(x.mood)}`)));
}

function toggleFav(key) {
  lib.favs = lib.favs.includes(key) ? lib.favs.filter((k) => k !== key) : [...lib.favs, key];
  try { localStorage.setItem(FAV_KEY, JSON.stringify(lib.favs)); } catch { /* privater Modus: nur für diese Sitzung */ }
  paintGallery();
}

function select(key) {
  if (!item(key)) return;
  lib.sel = key;
  const x = item(key);
  if (x.type === 'alert' || (x.type === 'community' && x.art === 'alert')) lib.scene = 'alert';
  else if (x.type === 'community' && x.art === 'background') lib.scene = 'start';
  else if (x.type === 'overlay' && lib.scene === 'alert') lib.scene = 'game';
  document.querySelectorAll('#lb-grid [data-key]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === key)));
  paintHero();
}

function step(d) {
  const list = filtered();
  if (!list.length) return;
  const i = list.findIndex((x) => x.key === lib.sel);
  select(list[(i + d + list.length) % list.length].key);
}

// ---------- Vorschau und Details ----------
function scenesFor(x) {
  if (x.type === 'community') {
    if (x.art === 'alert') return THEME_SCENES.filter((s) => s.id === 'alert');
    if (x.art === 'background') return THEME_SCENES.filter((s) => ['start', 'brb', 'end'].includes(s.id));
    if (x.art === 'card') return [{ id: 'card', name: 'Karte' }];
    return THEME_SCENES.filter((s) => s.id !== 'chat' && (s.id !== 'alert' || x.media));
  }
  if (x.type === 'alert') return THEME_SCENES.filter((s) => s.id === 'alert');
  if (x.type === 'overlay') return THEME_SCENES.filter((s) => s.id !== 'alert');
  if (x.type === 'mine') return THEME_SCENES.filter((s) => s.id !== 'alert' || x.look.apreset);
  return THEME_SCENES;
}

function parts(x) {
  if (x.type === 'community') {
    if (x.art === 'alert') return [['ph-image', 'Bild aller Alerts', x.name], ['ph-speaker-high', 'Look, Texte & Sounds', 'bleiben']];
    if (x.art === 'background') return [['ph-monitor-play', 'Hintergrund der Szenen', 'Gleich live, Pause, Ende'], ['ph-frame-corners', 'Overlay-Karten', 'bleiben']];
    if (x.art === 'card') return [['ph-cards', 'Neue Sammelkarte', RARITY[x.extra.rarity] ?? 'Selten'], ['ph-gift', 'Packs der Zuschauer', 'enthalten sie danach']];
    return [
      ['ph-frame-corners', 'Overlay-Karten', overlayTheme(x.otheme)?.name],
      ['ph-palette', 'Akzentfarbe', x.extra.accent ?? 'bleibt'],
      ['ph-monitor-play', 'Hintergrund der Szenen', x.name],
      ['ph-bell-ringing', 'Bild aller Alerts', x.media ? 'vom Artist' : 'bleibt'],
    ];
  }
  if (x.type === 'overlay') return [['ph-frame-corners', 'Overlay-Karten', x.name], ['ph-bell-ringing', 'Alerts', 'bleiben']];
  if (x.type === 'mine') {
    const o = x.look.overlay;
    return [
      ['ph-palette', 'Farbe', o.accent ? `#${o.accent}` : 'Design-Farbe'],
      ['ph-frame-corners', 'Overlay-Karten', overlayTheme(o.otheme)?.name],
      ['ph-webcam', 'Kamera-Rahmen', NAMES.cfstyle[o.cfstyle ?? 'glow']],
      ['ph-bell-ringing', 'Alerts (alle Arten)', x.look.apreset ? `${preset(x.look.apreset)?.name}${x.look.acolor ? ' · deine Farbe' : ''}` : 'bleiben'],
      ['ph-chat-circle-text', 'Chat', NAMES.chstyle[o.chstyle ?? 'card']],
      ['ph-text-align-left', 'Laufband', NAMES.tstyle[o.tstyle ?? 'bar']],
      ['ph-grid-nine', 'Bingo-Karte', NAMES.bstyle[o.bstyle ?? 'classic']],
      ['ph-monitor-play', 'Szenen-Bewegung', o.scmove ? NAMES.scmove[o.scmove] : 'ohne'],
      ...(x.look.pacc ? [['ph-identification-card', 'Öffentliches Profil', 'deine Farbe']] : []),
    ];
  }
  if (x.type === 'alert') return [['ph-bell-ringing', 'Look, Bild, Farbe, Animation', x.name], ['ph-speaker-high', 'Texte & Sounds', 'bleiben']];
  const t = pack(x.id);
  return [
    ['ph-frame-corners', 'Overlay-Karten', overlayTheme(t.overlay.otheme)?.name],
    ['ph-webcam', 'Kamera-Rahmen', NAMES.cfstyle[t.overlay.cfstyle]],
    ['ph-bell-ringing', 'Alerts (alle Arten)', preset(t.alert)?.name],
    ['ph-chat-circle-text', 'Chat', NAMES.chstyle[t.overlay.chstyle]],
    ['ph-text-align-left', 'Laufband', NAMES.tstyle[t.overlay.tstyle]],
    ['ph-grid-nine', 'Bingo-Karte', NAMES.bstyle[t.overlay.bstyle]],
    ['ph-monitor-play', 'Szenen', t.overlay.scmove ? `5 Stück · ${NAMES.scmove[t.overlay.scmove]}` : '5 Stück'],
  ];
}

function paintHero() {
  const x = item(lib.sel) ?? ITEMS[0];
  const scenes = scenesFor(x);
  if (!scenes.some((s) => s.id === lib.scene)) lib.scene = scenes[0].id;
  const active = isActive(x);
  const can = editable(x);
  $('#lb-hero').style.setProperty('--tc', x.color);

  $('#lb-tags').replaceChildren(...[
    h('span', { class: 'lb-tag is-acc' }, x.type === 'community' ? ART_KIND[x.art] : TYPES[x.type].name),
    x.type === 'mine' && h('span', { class: 'lb-tag is-line' }, 'Von dir'),
    h('span', { class: 'lb-tag' }, x.type === 'community' ? 'Von Artists' : moodName(x.mood)),
    x.isNew && h('span', { class: 'lb-tag is-line' }, 'Neu'),
    x.hot && h('span', { class: 'lb-tag is-line' }, 'Beliebt'),
    active && h('span', { class: 'lb-tag is-on' }, '✓ Aktiv'),
  ].filter(Boolean));
  $('#lb-name').textContent = x.name;
  $('#lb-desc').textContent = x.desc;
  // Credit: Name und Links des Artists, dazu „Melden“
  const credit = $('#lb-credit');
  credit.hidden = x.type !== 'community' && x.type !== 'mine';
  if (x.type === 'mine') {
    credit.replaceChildren(icon('ph-sliders-horizontal'), h('span', {}, 'Im Look-Baukasten gebaut'),
      lib.canEdit() ? h('button', { type: 'button', class: 'lb-report lb-edit', 'data-edit-look': '' }, icon('ph-pencil-simple'), 'Bearbeiten') : null,
      lib.canEdit() ? h('button', { type: 'button', class: 'lb-report', 'data-del-look': '' }, icon('ph-trash'), 'Löschen') : null);
  }
  if (x.type === 'community') {
    credit.replaceChildren(icon('ph-paint-brush'), h('span', {}, 'Von ', h('b', {}, x.artist.name)),
      ...x.artist.links.map((l) => h('a', { href: l, target: '_blank', rel: 'noopener noreferrer nofollow' }, linkLabel(l))),
      h('small', {}, `${x.uses} ${x.uses === 1 ? 'Kanal nutzt' : 'Kanäle nutzen'} es`),
      lib.canEdit() ? h('button', { type: 'button', class: 'lb-report', 'data-report': '' }, icon('ph-flag'), 'Melden') : null);
  }
  const fav = lib.favs.includes(x.key);
  $('#lb-fav').setAttribute('aria-pressed', String(fav));
  $('#lb-fav').setAttribute('aria-label', fav ? `${x.name}: Favorit entfernen` : `${x.name} als Favorit merken`);
  $('#lb-parts').replaceChildren(...parts(x).map(([ic, label, value]) => h('li', {}, icon(ic), h('span', {}, label), h('small', {}, value ?? ''))));

  const label = lib.busy ? 'Wird übernommen …' : active ? 'Aktiv' : x.type === 'look' || x.type === 'mine' ? 'Look installieren' : x.type === 'overlay' ? 'Fürs Overlay übernehmen'
    : x.type === 'community' ? { alert: 'Als Bild für alle Alerts', background: 'Als Szenen-Hintergrund', look: 'Look übernehmen', card: 'Als Sammelkarte hinzufügen' }[x.art]
      : 'Für alle Alerts übernehmen';
  for (const b of document.querySelectorAll('[data-lb-apply]')) {
    b.replaceChildren(icon(active ? 'ph-check' : 'ph-download-simple'), label);
    b.disabled = lib.busy || active || !can;
  }
  $('#lb-note').textContent = !lib.canEdit()
    ? '🔒 Übernehmen dürfen der Streamer, Admins und freigegebene Mods.'
    : !can
      ? '🔒 Das Overlay anpassen darf gerade nur der Streamer (Freigabe unter „Overlay & OBS“).'
      : x.type === 'mine'
        ? `Übernimmt deinen Look für Overlay${x.look.apreset ? ' und Alerts' : ''}${x.look.pacc ? ' und die Farbe deines Profils' : ''}. Welche Ebenen an sind und wo sie stehen, bleibt.`
      : x.type === 'community'
        ? {
          alert: 'Setzt das Bild für jede Alert-Art. Danach im Alert-Designer prüfen und speichern.',
          background: 'Gilt für die Szenen „Gleich live“, „Pause“ und „Stream-Ende“ (OBS-Adressen mit scene=…).',
          look: `Setzt Grund-Design, Farbe und Szenen-Hintergrund${x.media ? ' und speichert das Bild für alle Alerts' : ''}. OBS übernimmt es nach wenigen Sekunden.`,
          card: 'Kommt als neue Karte zu deinen Sammelkarten – Name und Seltenheit kannst du dort ändern.',
        }[x.art]
        : x.type === 'look'
        ? 'Installiert Overlay und Alerts zusammen – OBS übernimmt es nach wenigen Sekunden. Welche Ebenen an sind und wo sie stehen, bleibt.'
        : x.type === 'overlay'
          ? 'Gilt sofort für alle Karten im Overlay (OBS-Adresse mit live=1).'
          : 'Setzt Look, Bild, Farbe und Animationen für jede Alert-Art. Danach im Alert-Designer prüfen und speichern.';

  // OBS-Adressen je Szene (nur Komplett-Looks bringen Szenen mit)
  $('#lb-links-wrap').hidden = x.type !== 'look';
  if (x.type === 'look') {
    const base = lib.liveUrl();
    $('#lb-links').replaceChildren(...THEME_SCENES.filter((s) => s.id !== 'alert').map((s) => {
      const url = s.id === 'game' ? base : `${base}&scene=${s.id}`;
      return h('li', {}, h('span', {}, `${s.icon} ${s.name}`), h('input', { type: 'text', readonly: true, value: url, 'aria-label': `Adresse ${s.name}` }),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-copy': url }, icon('ph-copy'), 'Kopieren'));
    }));
  }

  // Szenen (auch im Vollbild)
  const sceneBtns = () => scenes.map((s) => h('button', {
    type: 'button', class: 'lb-scene', role: 'tab', 'data-scene': s.id, 'aria-selected': String(s.id === lib.scene),
  }, s.name));
  $('#lb-scenes').replaceChildren(...sceneBtns());
  $('#lb-full-scenes').replaceChildren(...sceneBtns());
  $('#lb-scenes').hidden = scenes.length < 2;
  $('#lb-full-scenes').hidden = scenes.length < 2;
  const alert = lib.scene === 'alert';
  $('#lb-kind-wrap').hidden = !alert;
  $('#lb-replay').hidden = !alert;
  $('#lb-compare').checked = lib.compare;
  $('#lb-compare').closest('label').hidden = lib.scene === 'card';
  $('#lb-split').hidden = !lib.compare;
  $('#lb-full-name').textContent = x.name;
  $('#lb-full-sub').textContent = `${TYPES[x.type].name} · ${THEME_SCENES.find((s) => s.id === lib.scene)?.name ?? ''}`;
  $('#lb-before-label').textContent = `Vorher · ${activeName(x.type)}`;
  $('#lb-after-label').textContent = `Nachher · ${x.name}`;
  mountPreview(x);
}

// Overlay-Werte vorher (was gerade gilt) und nachher (mit diesem Design)
function overlayValues(x, side) {
  const vals = {};
  for (const k of Object.keys(OVERLAY_DEFAULTS)) vals[k] = current(k);
  // Hintergrund und Farbe aus Artist-Designs stehen nicht in OVERLAY_DEFAULTS
  for (const k of ['scbg', 'accent', 'scmove']) if (current(k)) vals[k] = current(k);
  if (side === 'before') return vals;
  if (x.type === 'look') Object.assign(vals, pack(x.id).overlay);
  if (x.type === 'overlay') vals.otheme = x.id;
  if (x.type === 'community') Object.assign(vals, communityOverlay(x));
  if (x.type === 'mine') for (const k of LOOK_KEYS) vals[k] = x.look.overlay[k] ?? OVERLAY_DEFAULTS[k];
  return vals;
}

function previewUrl(x, side) {
  const url = new URL('overlay.html', location.href);
  const p = url.searchParams;
  const vals = overlayValues(x, side);
  if (lib.scene === 'alert') {
    p.set('apreview', '1');
    p.set('vol', '0');
    if (vals.alook !== OVERLAY_DEFAULTS.alook) p.set('alook', vals.alook);
    return url.href;
  }
  for (const [k, v] of new URLSearchParams(SHOWCASE[lib.scene])) p.set(k, v);
  for (const [k, v] of Object.entries(vals)) if (v !== undefined && v !== '' && v !== OVERLAY_DEFAULTS[k]) p.set(k, v);
  if (lib.scene === 'start' || lib.scene === 'brb') {
    const at = new Date(Date.now() + 12 * 60_000);
    p.set('sctime', `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`);
  }
  p.set('test', '1');
  p.set('vol', '0');
  return url.href;
}

function mountLayer(layer, src, title) {
  const old = layer.querySelector('iframe');
  if (old?.dataset.src === src) return;
  const alert = lib.scene === 'alert';
  const frame = h('iframe', { title, tabindex: '-1', width: alert ? '820' : '1920', height: alert ? '440' : '1080' });
  frame.src = frame.dataset.src = src;
  layer.replaceChildren(frame);
}

// Sammelkarte: kein Overlay, nur die Karte
function mountCard(x) {
  const layer = $('#lb-after');
  if (layer.dataset.card === x.id) return;
  layer.dataset.card = x.id;
  layer.replaceChildren(h('div', { class: 'lb-card-prev' }, h('div', { class: `lb-card-face is-${x.extra.rarity ?? 'rare'}` },
    artMedia(x.file, x.name), h('b', {}, `${x.extra.emoji ?? ''} ${x.name}`.trim()), h('small', {}, RARITY[x.extra.rarity] ?? 'Selten'))));
}

function mountPreview(x) {
  const screen = $('#lb-screen');
  // Vorschau nur, solange die Seite offen ist
  if ($('#lb').closest('.page')?.hidden && !lib.full) return;
  screen.classList.toggle('is-card', lib.scene === 'card');
  if (lib.scene === 'card') {
    screen.classList.remove('is-alert', 'is-compare');
    $('#lb-before').replaceChildren();
    mountCard(x);
    return;
  }
  delete $('#lb-after').dataset.card;
  screen.classList.toggle('is-alert', lib.scene === 'alert');
  screen.classList.toggle('is-compare', lib.compare);
  const scene = THEME_SCENES.find((s) => s.id === lib.scene)?.name ?? '';
  mountLayer($('#lb-after'), previewUrl(x, 'after'), `Vorschau: ${x.name}, ${scene}`);
  if (lib.compare) mountLayer($('#lb-before'), previewUrl(x, 'before'), `Vorschau vorher: ${scene}`);
  else $('#lb-before').replaceChildren();
  paintSplit();
  fit();
  sendAlerts();
}

function paintSplit() {
  $('#lb-screen').style.setProperty('--split', `${lib.split}%`);
  $('#lb-split').value = String(lib.split);
}

// Die Höhe kommt aus aspect-ratio – hier nur skalieren
function fit() {
  const screen = $('#lb-screen');
  if (!screen.clientWidth) return;
  for (const frame of screen.querySelectorAll('iframe')) frame.style.transform = `scale(${screen.clientWidth / Number(frame.width)})`;
}

// Alert-Vorschau: nachher das gewählte Design für alle Arten, vorher die gespeicherten Alerts
function alertConfig(side) {
  const x = item(lib.sel);
  if (side === 'before') return lib.alertCfg ?? normalizeAlertConfig(null);
  if (x.type === 'community' && x.media) {
    const base = lib.alertCfg ?? normalizeAlertConfig(null);
    const kinds = {};
    for (const k of ALERT_KINDS) kinds[k.kind] = normalizeDesign({ ...(base.kinds?.[k.kind] ?? {}), media: x.media });
    return normalizeAlertConfig({ ...base, kinds });
  }
  const id = x.type === 'look' ? pack(x.id).alert : x.type === 'alert' ? x.id : x.type === 'mine' ? x.look.apreset : null;
  const p = preset(id);
  if (!p) return lib.alertCfg ?? normalizeAlertConfig(null);
  const kinds = {};
  const color = x.type === 'mine' && x.look.acolor && x.look.overlay.accent ? `#${x.look.overlay.accent}` : null;
  for (const k of ALERT_KINDS) kinds[k.kind] = normalizeDesign(color ? { ...p.design, color } : p.design);
  return normalizeAlertConfig({ kinds });
}

function sendAlert(frame, play) {
  if (lib.scene !== 'alert' || frame.dataset.ready !== '1') return;
  const side = frame.closest('#lb-before') ? 'before' : 'after';
  frame.contentWindow.postMessage({ type: 'sh-alert-preview', config: alertConfig(side), kind: lib.kind, play }, location.origin);
}
function sendAlerts() {
  for (const frame of document.querySelectorAll('#lb-screen iframe')) sendAlert(frame, true);
}

async function copyLink(e) {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    lib.toast('Adresse kopiert – in OBS als Browserquelle einfügen.', 'ok');
  } catch {
    b.previousElementSibling?.select?.();
    lib.toast('Adresse ist markiert – mit Strg+C kopieren.');
  }
}

// ---------- Übernehmen ----------
async function apply({ confirmed = false } = {}) {
  const x = item(lib.sel);
  if (!x || lib.busy || !editable(x) || isActive(x)) return;
  if (x.type === 'mine' && !confirmed && !confirm(`Deinen Look „${x.name}“ übernehmen?\n\nDas ändert Design, Farbe, Kamera-Rahmen, Chat, Laufband, Bingo${x.look.apreset ? ' und Alerts' : ''}. Ebenen und Plätze bleiben.`)) return;
  if (x.type === 'community' && x.art === 'look'
      && !confirm(`Look „${x.name}“ von ${x.artist.name} übernehmen?\n\nDas ändert Grund-Design, Akzentfarbe und den Hintergrund der Szenen${x.media ? ' und setzt das Bild für alle Alert-Arten' : ''}. Ebenen, Plätze, Texte und Sounds bleiben.`)) return;
  if (x.type === 'look') {
    const t = pack(x.id);
    if (!confirm(`Look „${t.name}“ installieren?\n\nDas ändert das Overlay-Design, den Kamera-Rahmen, Laufband, Chat und Bingo-Karte und setzt das Alert-Design „${preset(t.alert)?.name}“ für alle Alert-Arten. Eigene Texte, Sounds und Varianten der Alerts bleiben.`)) return;
  }
  lib.busy = true;
  paintHero();
  try {
    if (x.type === 'look') await installLook(pack(x.id));
    else if (x.type === 'community') await applyCommunity(x);
    else if (x.type === 'mine') await applyMine(x);
    else if (x.type === 'overlay') await applyOverlay(x);
    else await applyAlerts(x);
  } catch (err) {
    lib.toast(`Nicht übernommen: ${lib.germanError(err)}`, 'error');
  } finally {
    lib.busy = false;
    paintGallery();
  }
}

// Overlay-Werte frisch laden, damit nichts überschrieben wird, was gerade jemand anderes geändert hat.
// Noch nie zentral gespeichert: die Einstellungen aus diesem Browser mitnehmen.
async function saveOverlay(values) {
  const config = await lib.api.getOverlayConfig();
  const p = new URLSearchParams(config?.params || safeLocal());
  for (const [k, v] of Object.entries(values)) {
    if (v === OVERLAY_DEFAULTS[k] || v === '' || v === undefined || v === null) p.delete(k);
    else p.set(k, v);
  }
  const query = p.toString();
  await lib.api.saveOverlayConfig(query);
  lib.params = query;
  // Das OBS-Fenster in diesem Browser merkt sich das Design auch
  const field = $('#obs-options')?.elements.otheme;
  if (field && values.otheme) field.value = values.otheme;
}

async function applyOverlay(x) {
  await saveOverlay({ otheme: x.id });
  lib.toast(`Overlay-Design „${x.name}“ ist aktiv – OBS zeigt es gleich.`, 'ok');
}

async function installLook(t) {
  await saveOverlay(t.overlay);
  const alerts = await lib.installAlertPreset(t.alert).catch(() => 'error');
  if (alerts === 'ok') lib.alertCfg = await lib.api.getAlertConfig().then(normalizeAlertConfig).catch(() => lib.alertCfg);
  const msg = {
    ok: `Look „${t.name}“ ist installiert – Overlay und Alerts zeigen es sofort.`,
    dirty: `Overlay-Design von „${t.name}“ ist aktiv. Die Alerts nicht: Im Alert-Designer gibt es ungespeicherte Änderungen – erst speichern oder verwerfen, dann noch einmal installieren.`,
    locked: `Overlay-Design von „${t.name}“ ist aktiv. Die Alerts darfst du nicht ändern.`,
    missing: `Overlay-Design von „${t.name}“ ist aktiv. Die Alerts fehlen noch in der Datenbank (Migration …_overlay_designs.sql).`,
    error: `Overlay-Design von „${t.name}“ ist aktiv, die Alerts wurden nicht gespeichert.`,
  }[alerts] ?? '';
  lib.toast(msg, alerts === 'ok' ? 'ok' : 'error', alerts === 'ok' ? 6000 : 10000);
}

// ---------- Eigene Looks ----------
async function applyMine(x) {
  const { look } = x;
  const values = {};
  for (const k of LOOK_KEYS) values[k] = look.overlay[k] ?? OVERLAY_DEFAULTS[k] ?? '';
  await saveOverlay(values);
  const problems = [];
  if (look.apreset) {
    const r = await lib.installAlertPreset(look.apreset).catch(() => 'error');
    if (r === 'ok' && look.acolor && look.overlay.accent) {
      const c = await lib.useAlertColor?.(`#${look.overlay.accent}`, { save: true }).catch(() => 'error');
      if (c !== 'ok') problems.push('Alert-Farbe');
    }
    if (r !== 'ok') problems.push(r === 'dirty' ? 'Alerts (ungespeicherte Änderungen im Alert-Designer)' : 'Alerts');
    lib.alertCfg = await lib.api.getAlertConfig().then(normalizeAlertConfig).catch(() => lib.alertCfg);
  }
  if (look.pacc && look.overlay.accent) {
    await lib.api.profileAccentSave?.(`#${look.overlay.accent}`).catch(() => problems.push('Profilfarbe'));
  }
  lib.toast(problems.length ? `Look „${x.name}“ ist im Overlay aktiv – nicht übernommen: ${problems.join(', ')}.` : `Look „${x.name}“ ist installiert – OBS zeigt ihn gleich.`,
    problems.length ? 'error' : 'ok', 8000);
}

// ---------- Von Artists ----------
function communityOverlay(x) {
  if (x.art === 'background') return { scbg: x.file };
  if (x.art === 'look') return { otheme: x.otheme, scbg: x.file, ...(x.extra.accent ? { accent: accentOf(x) } : {}) };
  return {};
}

async function applyCommunity(x) {
  let msg = '';
  let ok = true;
  if (x.art === 'alert') {
    const r = await lib.useAlertMedia(x.media);
    if (r !== 'ok') { lib.toast(r === 'locked' ? 'Die Alerts darfst du nicht ändern.' : 'Der Alert-Designer ist nicht bereit – öffne den Reiter „Alert-Designer“ und versuch es dort.', 'error'); return; }
    goDesigner();
    msg = `„${x.name}“ von ${x.artist.name} ist das Bild für alle Alerts. Prüfen und oben rechts „Speichern“ klicken.`;
  } else if (x.art === 'card') {
    await lib.addArtistCard({ name: x.name.slice(0, 40), image: `a:${x.file}`, rarity: x.extra.rarity ?? 'rare', emoji: x.extra.emoji ?? '🃏', description: `Design: ${x.artist.name}`.slice(0, 120) });
    msg = `Karte „${x.name}“ ist in deinen Sammelkarten – Zuschauer können sie ab jetzt ziehen.`;
  } else {
    await saveOverlay(communityOverlay(x));
    msg = x.art === 'background'
      ? `„${x.name}“ ist jetzt der Hintergrund von „Gleich live“, „Pause“ und „Stream-Ende“.`
      : `Look „${x.name}“ ist aktiv – OBS zeigt ihn gleich.`;
    if (x.art === 'look' && x.media) {
      const r = await lib.useAlertMedia(x.media, { save: true }).catch(() => 'error');
      if (r === 'ok') lib.alertCfg = await lib.api.getAlertConfig().then(normalizeAlertConfig).catch(() => lib.alertCfg);
      else { ok = false; msg += r === 'dirty' ? ' Das Alert-Bild nicht: Im Alert-Designer gibt es ungespeicherte Änderungen.' : ' Das Alert-Bild wurde nicht gespeichert.'; }
    }
  }
  // Zählt für den Artist (je Kanal einmal); klappt das nicht, ist das Design trotzdem übernommen
  lib.api.artistUse?.(x.id).then((a) => { if (a && item(x.key)) { item(x.key).uses = a.uses; paintHero(); } }).catch(() => {});
  lib.toast(msg, ok ? 'ok' : 'error', 8000);
}

async function report() {
  const x = item(lib.sel);
  if (x?.type !== 'community') return;
  const reason = prompt(`„${x.name}“ von ${x.artist.name} melden – was stimmt nicht? (z. B. geklaut, unpassend, kaputt)`);
  if (reason === null) return;
  try {
    await lib.api.artistReport(x.id, reason);
    lib.toast('Danke – wir schauen es uns an.', 'ok');
  } catch (err) {
    lib.toast(lib.germanError(err), 'error');
  }
}

function linkLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Link'; }
}

async function applyAlerts(x) {
  const ok = await lib.useAlertPreset(x.id);
  if (!ok) {
    lib.toast('Der Alert-Designer ist nicht bereit – öffne den Reiter „Alert-Designer“ und versuch es dort.', 'error');
    return;
  }
  goDesigner();
  lib.toast(`„${x.name}“ ist für alle Alerts eingestellt. Prüfen und oben rechts „Speichern“ klicken.`, 'ok', 8000);
}
