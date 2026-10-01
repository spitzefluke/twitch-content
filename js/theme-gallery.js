// Themes in der Design-Bibliothek (Reiter „✨ Themes“), wie die Theme-Galerie bei StreamElements:
// Galerie mit Kategorien und Suche → Detailansicht mit Vorschau jeder Szene, Liste der Teile,
// „Theme installieren“ und den OBS-Adressen je Szene.
// Installieren setzt die Overlay-Werte des Pakets in den zentralen Einstellungen (overlay_save)
// und speichert das Alert-Design für alle Alert-Arten (alert_config).
import { ALERT_LOOKS, ALERT_PRESETS, builtinMediaUrl, normalizeAlertConfig, normalizeDesign, ALERT_KINDS } from './alerts.js';
import { OVERLAY_THEMES } from './overlay-stage.js';
import { OVERLAY_DEFAULTS, THEME_CATEGORIES, THEME_PACKS, THEME_SCENES } from './theme-packs.js';

const $ = (sel) => document.querySelector(sel);
// Vorschau der Szenen: immer dieselben Beispielkarten, damit man Themes vergleichen kann
const SHOWCASE = {
  game: 'next=tl&alerts=tc&goal=tr&labels=bl&camframe=1&cam=70,55,28,33&edit=1',
  start: 'scene=start&labels=bl',
  brb: 'scene=brb&labels=bl',
  chat: 'scene=chat&alerts=tc&labels=bl',
  end: 'scene=end',
};
const NAMES = {
  cfstyle: { glow: 'Leuchten', clean: 'Schlicht', corners: 'Ecken', neon: 'Neon' },
  tstyle: { bar: 'Laufband', neon: 'Neon', board: 'LED-Anzeige' },
  chstyle: { card: 'Karte', bubble: 'Sprechblasen', clean: 'Schlicht' },
  bstyle: { classic: 'Bunt', neon: 'Neon', paper: 'Papier' },
};

const th = {
  deps: null, cat: 'all', query: '', open: null, scene: 'game', kind: 'sub', frameReady: false, busy: false,
};

export function setupThemes(deps) {
  th.deps = deps;
  $('#th-cats').replaceChildren(...THEME_CATEGORIES.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'th-cat';
    b.dataset.cat = c.id;
    b.setAttribute('role', 'tab');
    b.textContent = c.name;
    return b;
  }));
  $('#th-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    th.cat = b.dataset.cat;
    paintGallery();
  });
  $('#th-search').addEventListener('input', (e) => { th.query = e.target.value.trim().toLowerCase(); paintGallery(); });
  $('#th-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-id]');
    if (b) openTheme(b.dataset.themeId);
  });
  $('#th-back').addEventListener('click', () => { th.open = null; showThemes(); });
  $('#th-scenes').replaceChildren(...THEME_SCENES.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'th-scene';
    b.dataset.scene = s.id;
    b.setAttribute('role', 'tab');
    b.innerHTML = '<span aria-hidden="true"></span><b></b>';
    b.querySelector('span').textContent = s.icon;
    b.querySelector('b').textContent = s.name;
    return b;
  }));
  $('#th-scenes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scene]');
    if (!b) return;
    th.scene = b.dataset.scene;
    paintDetail();
  });
  $('#th-install').addEventListener('click', install);
  $('#th-links').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      th.deps.toast('Adresse kopiert – in OBS als Browserquelle einfügen.', 'ok');
    } catch {
      b.previousElementSibling?.select?.();
      th.deps.toast('Adresse ist markiert – mit Strg+C kopieren.');
    }
  });
  addEventListener('message', (e) => {
    const frame = $('#th-preview iframe');
    if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
    if (e.data?.type !== 'sh-alert-preview-ready') return;
    th.frameReady = true;
    sendAlert();
  });
  new ResizeObserver(fit).observe($('#th-preview'));
}

// Galerie oder geöffnetes Theme zeigen (beim Öffnen des Reiters)
export function showThemes() {
  $('#th-gallery').hidden = !!th.open;
  $('#th-detail').hidden = !th.open;
  if (th.open) paintDetail();
  else {
    $('#th-preview').replaceChildren(); // keine Vorschau im Hintergrund laufen lassen
    paintGallery();
  }
}

const pack = (id) => THEME_PACKS.find((t) => t.id === id);
const preset = (id) => ALERT_PRESETS.find((p) => p.id === id);
const catName = (id) => THEME_CATEGORIES.find((c) => c.id === id)?.name ?? '';

// Installiert ist ein Theme, wenn alle seine Overlay-Werte gerade gelten
function isInstalled(t) {
  const p = new URLSearchParams(th.deps.params());
  return Object.entries(t.overlay).every(([k, v]) => (p.get(k) ?? OVERLAY_DEFAULTS[k]) === v);
}

// ---------- Galerie ----------
function paintGallery() {
  document.querySelectorAll('#th-cats [data-cat]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.cat === th.cat)));
  const q = th.query;
  const list = THEME_PACKS.filter((t) => (th.cat === 'all' || t.cat === th.cat)
    && (!q || `${t.name} ${t.desc} ${catName(t.cat)}`.toLowerCase().includes(q)));
  $('#th-list').replaceChildren(...list.map(themeCard));
  $('#th-empty').hidden = list.length > 0;
}

function themeCard(t) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'th-card';
  b.dataset.themeId = t.id;
  b.style.setProperty('--tc', t.color);
  b.append(thumb(t));
  const body = document.createElement('span');
  body.className = 'th-card-body';
  body.innerHTML = '<b></b><small></small>';
  body.querySelector('b').textContent = t.name;
  body.querySelector('small').textContent = `${catName(t.cat)} · 5 Szenen · Alerts`;
  b.append(body);
  if (isInstalled(t)) {
    const tag = document.createElement('i');
    tag.className = 'th-installed';
    tag.textContent = '✓ Installiert';
    b.append(tag);
  }
  return b;
}

// Kachel: kleine Szene mit Hintergrund, Kamera-Rahmen, Info-Leiste und dem Alert-Bild
function thumb(t) {
  const el = document.createElement('span');
  el.className = 'th-thumb';
  el.dataset.otheme = t.overlay.otheme;
  el.dataset.cf = t.overlay.cfstyle;
  el.style.backgroundImage = `linear-gradient(160deg, color-mix(in srgb, ${t.color} 30%, transparent), rgba(7, 6, 13, .78)), url("assets/${t.bg}.svg")`;
  el.innerHTML = '<span class="th-t-cam"></span><span class="th-t-bar"><i></i><i></i></span><span class="th-t-alert"></span><span class="th-t-name"></span>';
  el.querySelector('.th-t-name').textContent = t.name;
  const p = preset(t.alert);
  if (p?.design.media.startsWith('b:')) {
    const img = new Image();
    img.alt = '';
    img.src = builtinMediaUrl(p.design.media.slice(2));
    el.querySelector('.th-t-alert').append(img);
  }
  return el;
}

// ---------- Detail ----------
function openTheme(id) {
  if (!pack(id)) return;
  th.open = id;
  th.scene = 'game';
  showThemes();
  // Unter die feste Kopfzeile scrollen, nicht dahinter
  const top = $('#lib-themes').getBoundingClientRect().top + scrollY - 90;
  if (top < scrollY) scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function paintDetail() {
  const t = pack(th.open);
  if (!t) return;
  const p = preset(t.alert);
  const installed = isInstalled(t);
  $('#th-detail').style.setProperty('--tc', t.color);
  $('#th-name').textContent = t.name;
  $('#th-desc').textContent = t.desc;
  document.querySelectorAll('#th-scenes [data-scene]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.scene === th.scene)));
  $('#th-scene-desc').textContent = THEME_SCENES.find((s) => s.id === th.scene)?.desc ?? '';

  const look = (id) => ALERT_LOOKS.find((l) => l.id === id)?.name ?? id;
  const parts = [
    ['🎛️', 'Overlay-Design', OVERLAY_THEMES.find((o) => o.id === t.overlay.otheme)?.name],
    ['🔔', 'Alerts', `${p?.name ?? ''} (${look(t.overlay.alook)}) – für alle Alert-Arten`],
    ['📷', 'Kamera-Rahmen', NAMES.cfstyle[t.overlay.cfstyle]],
    ['📰', 'Laufband', NAMES.tstyle[t.overlay.tstyle]],
    ['💬', 'Chat', NAMES.chstyle[t.overlay.chstyle]],
    ['🎯', 'Bingo-Karte', NAMES.bstyle[t.overlay.bstyle]],
    ['🎬', 'Szenen', 'Gleich live, Pause, Just Chatting, Stream-Ende'],
  ];
  $('#th-parts').replaceChildren(...parts.map(([icon, label, value]) => {
    const li = document.createElement('li');
    li.innerHTML = '<span aria-hidden="true"></span><b></b><small></small>';
    li.querySelector('span').textContent = icon;
    li.querySelector('b').textContent = label;
    li.querySelector('small').textContent = value ?? '';
    return li;
  }));

  const canEdit = th.deps.canEdit() && th.deps.access()?.can_edit !== false;
  const btn = $('#th-install');
  btn.textContent = th.busy ? 'Installiert …' : installed ? '✓ Installiert' : 'Theme installieren';
  btn.disabled = th.busy || installed || !canEdit;
  $('#th-note').textContent = !canEdit
    ? '🔒 Installieren dürfen der Streamer, Admins und freigegebene Mods.'
    : 'Ändert nur das Aussehen – welche Ebenen an sind und wo sie stehen, bleibt wie es ist. Für Szenen: Ebene „Szene“ oder die Adressen unten.';

  const base = th.deps.liveUrl();
  $('#th-links').replaceChildren(...THEME_SCENES.filter((s) => s.id !== 'alert').map((s) => {
    const url = s.id === 'game' ? base : `${base}&scene=${s.id}`;
    const li = document.createElement('li');
    li.innerHTML = '<span></span><input type="text" readonly><button class="btn btn--ghost btn--sm" type="button">Kopieren</button>';
    li.querySelector('span').textContent = `${s.icon} ${s.name}`;
    li.querySelector('input').value = url;
    li.querySelector('button').dataset.copy = url;
    return li;
  }));
  mountPreview();
}

function previewUrl() {
  const t = pack(th.open);
  const url = new URL('overlay.html', location.href);
  const p = url.searchParams;
  if (th.scene === 'alert') {
    p.set('apreview', '1');
    p.set('vol', '0');
    if (t.overlay.alook !== OVERLAY_DEFAULTS.alook) p.set('alook', t.overlay.alook);
    return url.href;
  }
  for (const [k, v] of new URLSearchParams(SHOWCASE[th.scene])) p.set(k, v);
  for (const [k, v] of Object.entries(t.overlay)) p.set(k, v);
  if (th.scene === 'start' || th.scene === 'brb') {
    const at = new Date(Date.now() + 12 * 60_000);
    p.set('sctime', `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`);
  }
  p.set('test', '1');
  p.set('vol', '0');
  return url.href;
}

function mountPreview() {
  const box = $('#th-preview');
  const alert = th.scene === 'alert';
  box.classList.toggle('is-alert', alert);
  const src = previewUrl();
  if (box.querySelector('iframe')?.dataset.src === src) { sendAlert(); return; }
  const frame = document.createElement('iframe');
  frame.title = `Vorschau: ${THEME_SCENES.find((s) => s.id === th.scene)?.name ?? ''}`;
  frame.src = frame.dataset.src = src;
  frame.width = alert ? 820 : 1920;
  frame.height = alert ? 440 : 1080;
  frame.setAttribute('tabindex', '-1');
  th.frameReady = false;
  box.replaceChildren(frame);
  fit();
}

// Die Höhe kommt aus aspect-ratio – hier nur skalieren
function fit() {
  const box = $('#th-preview');
  const frame = box.querySelector('iframe');
  if (!frame || !box.clientWidth) return;
  frame.style.transform = `scale(${box.clientWidth / Number(frame.width)})`;
}

function sendAlert() {
  const frame = $('#th-preview iframe');
  const t = pack(th.open);
  const p = t && preset(t.alert);
  if (th.scene !== 'alert' || !frame || !th.frameReady || !p) return;
  const kinds = {};
  for (const k of ALERT_KINDS) kinds[k.kind] = normalizeDesign(p.design);
  frame.contentWindow.postMessage({ type: 'sh-alert-preview', config: normalizeAlertConfig({ kinds }), kind: th.kind, play: true }, location.origin);
}

// ---------- Installieren ----------
async function install() {
  const t = pack(th.open);
  if (!t || th.busy) return;
  const p = preset(t.alert);
  if (!confirm(`Theme „${t.name}“ installieren?\n\nDas ändert das Overlay-Design, den Kamera-Rahmen, Laufband, Chat und Bingo-Karte und setzt das Alert-Design „${p?.name}“ für alle Alert-Arten. Eigene Texte, Sounds und Varianten der Alerts bleiben.`)) return;
  th.busy = true;
  paintDetail();
  const { api, toast, germanError } = th.deps;
  try {
    // Overlay: frisch laden, damit nichts überschrieben wird, was gerade jemand anderes geändert hat
    const config = await api.getOverlayConfig();
    const params = new URLSearchParams(config?.params || th.deps.localParams());
    for (const [k, v] of Object.entries(t.overlay)) {
      if (v === OVERLAY_DEFAULTS[k]) params.delete(k);
      else params.set(k, v);
    }
    const query = params.toString();
    await api.saveOverlayConfig(query);
    th.deps.setParams(query);
  } catch (err) {
    toast(`Theme nicht installiert: ${germanError(err)}`, 'error');
    th.busy = false;
    paintDetail();
    return;
  }
  const alerts = await th.deps.installAlertPreset(t.alert).catch(() => 'error');
  th.busy = false;
  paintDetail();
  const msg = {
    ok: `Theme „${t.name}“ ist installiert – Overlay und Alerts zeigen es sofort.`,
    dirty: `Overlay-Design von „${t.name}“ ist aktiv. Die Alerts nicht: Im Alert-Designer gibt es ungespeicherte Änderungen – erst speichern oder verwerfen, dann noch einmal installieren.`,
    locked: `Overlay-Design von „${t.name}“ ist aktiv. Die Alerts darfst du nicht ändern.`,
    missing: `Overlay-Design von „${t.name}“ ist aktiv. Die Alerts fehlen noch in der Datenbank (Migration …_overlay_designs.sql).`,
    error: `Overlay-Design von „${t.name}“ ist aktiv, die Alerts wurden nicht gespeichert.`,
  }[alerts] ?? '';
  toast(msg, alerts === 'ok' ? 'ok' : 'error', alerts === 'ok' ? 6000 : 10000);
}
