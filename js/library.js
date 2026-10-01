// Design-Bibliothek im Dashboard (Seite „Design-Bibliothek“): alle fertigen Overlay-Designs
// (OVERLAY_THEMES) und Alert-Designs (ALERT_PRESETS) mit großer Vorschau.
//   Overlay: „Übernehmen“ setzt otheme in den zentralen Overlay-Einstellungen (overlay_save) –
//            OBS mit live=1 zeigt es sofort.
//   Alerts:  „Übernehmen“ stellt das Design im Alert-Designer für alle Arten ein; gespeichert
//            wird dort (so sieht man vorher, was sich ändert).
// Die Vorschau ist overlay.html in einem iframe: fürs Overlay mit edit=1 (Beispielinhalte),
// für Alerts mit apreview=1 (Design per postMessage, wie im Alert-Designer).
import { ALERT_KINDS, ALERT_LOOKS, ALERT_PRESETS, builtinMediaUrl, normalizeAlertConfig, normalizeDesign } from './alerts.js';
import { OVERLAY_THEMES } from './overlay-stage.js';
import { setupThemes, showThemes } from './theme-gallery.js';

const $ = (sel) => document.querySelector(sel);
const STAGE_W = 1920;
const STAGE_H = 1080;
const ALERT_W = 820;
const ALERT_H = 440;
// Ohne eigene Einstellungen: ein paar Karten, damit man das Design sieht
const SAMPLE = 'next=tl&wheel=br&alerts=tc&labels=bl&goal=tr&chat=cr';
const OVERLAY_KEYS = ['wheel', 'next', 'bingo', 'quest', 'shop', 'challenge', 'alerts', 'recent', 'chat', 'forbid',
  'subathon', 'quiz', 'queue', 'tts', 'cards', 'labels', 'goal'];

const lib = {
  api: null, toast: null, germanError: String, canEdit: () => false, setPage: () => {}, useAlertPreset: null,
  localObsQuery: () => '',
  tab: 'themes', pick: { overlay: 'standard', alerts: ALERT_PRESETS[0]?.id }, kind: 'sub',
  params: '', current: 'standard', access: null, frameReady: false, busy: false,
};

export function setupLibrary(deps) {
  Object.assign(lib, deps);
  setupThemes({
    api: lib.api, toast: lib.toast, germanError: lib.germanError, canEdit: lib.canEdit,
    installAlertPreset: deps.installAlertPreset, liveUrl: deps.liveUrl,
    access: () => lib.access, params: () => lib.params, localParams: safeLocal,
    setParams: (query) => {
      lib.params = query;
      lib.current = new URLSearchParams(query).get('otheme') || 'standard';
      lib.pick.overlay = lib.current;
    },
  });
  $('#lib-kind').replaceChildren(...ALERT_KINDS.map((k) => new Option(k.label, k.kind)));
  $('#lib-kind').value = lib.kind;

  document.querySelectorAll('[data-lib-tab]').forEach((b) => b.addEventListener('click', () => {
    if (lib.tab === b.dataset.libTab) return;
    lib.tab = b.dataset.libTab;
    paint();
  }));
  $('#lib-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    lib.pick[lib.tab] = b.dataset.id;
    paint();
  });
  $('#lib-kind').addEventListener('change', (e) => { lib.kind = e.target.value; sendAlert(true); });
  $('#lib-replay').addEventListener('click', () => sendAlert(true));
  $('#lib-apply').addEventListener('click', apply);

  addEventListener('message', (e) => {
    const frame = $('#lib-preview iframe');
    if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
    if (e.data?.type !== 'sh-alert-preview-ready') return;
    lib.frameReady = true;
    sendAlert(true);
  });
  new ResizeObserver(fit).observe($('#lib-preview'));
}

// Beim Öffnen der Seite: aktuelle Overlay-Einstellungen laden (für Vorschau und „aktiv“)
export async function openLibrary() {
  const [config, access] = await Promise.all([
    lib.api.getOverlayConfig().catch(() => null),
    lib.api.overlayAccess().catch(() => null),
  ]);
  lib.access = access;
  lib.params = config?.params || safeLocal();
  lib.current = new URLSearchParams(lib.params).get('otheme') || 'standard';
  if (!OVERLAY_THEMES.some((t) => t.id === lib.pick.overlay)) lib.pick.overlay = lib.current;
  paint();
}

function safeLocal() {
  try { return lib.localObsQuery() ?? ''; } catch { return ''; }
}

const theme = (id) => OVERLAY_THEMES.find((t) => t.id === id);
const preset = (id) => ALERT_PRESETS.find((p) => p.id === id);
const lookName = (id) => ALERT_LOOKS.find((l) => l.id === id)?.name ?? '';

function paint() {
  const tab = lib.tab;
  document.querySelectorAll('[data-lib-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.libTab === tab)));
  // Themes haben eine eigene Galerie (js/theme-gallery.js)
  const themes = tab === 'themes';
  $('#lib-themes').hidden = !themes;
  $('.lib .lib-grid').hidden = themes;
  if (themes) {
    $('#lib-preview').replaceChildren();
    $('#lib-status').textContent = 'Komplette Looks mit Overlay, Alerts und fünf Szenen – mit einem Klick installiert';
    showThemes();
    return;
  }
  $('#th-preview').replaceChildren();
  $('#lib-status').textContent = tab === 'overlay'
    ? `${OVERLAY_THEMES.length} Designs für alle Karten im Overlay – aktiv: ${theme(lib.current)?.name ?? 'Standard'}`
    : `${ALERT_PRESETS.length} fertige Alert-Designs – Bild, Look, Farbe und Animationen in einem Klick`;
  paintList();
  paintPick();
  mountPreview();
}

function paintList() {
  const list = $('#lib-list');
  list.dataset.tab = lib.tab;
  const picked = lib.pick[lib.tab];
  if (lib.tab === 'overlay') {
    list.replaceChildren(...OVERLAY_THEMES.map((t) => {
      const b = card(t.id, t.name, t.id === lib.current ? 'aktiv' : '');
      const thumb = document.createElement('span');
      thumb.className = 'obs-theme-thumb';
      thumb.dataset.theme = t.id;
      thumb.innerHTML = '<i></i><b></b><s></s>';
      b.prepend(thumb);
      b.title = t.desc;
      return b;
    }));
  } else {
    list.replaceChildren(...ALERT_PRESETS.map((p) => {
      const look = lookName(p.design.look);
      const b = card(p.id, p.name, look === p.name ? '' : look);
      b.style.setProperty('--pc', p.design.color || '#9146ff');
      const thumb = document.createElement('span');
      thumb.className = 'ad-preset-thumb';
      if (p.design.media.startsWith('b:')) {
        const img = new Image();
        img.alt = '';
        img.src = builtinMediaUrl(p.design.media.slice(2));
        thumb.append(img);
      } else thumb.textContent = 'Aa';
      b.prepend(thumb);
      return b;
    }));
  }
  list.querySelectorAll('[data-id]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === picked)));
}

function card(id, name, tag) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lib-card';
  b.dataset.id = id;
  b.setAttribute('role', 'option');
  const label = document.createElement('span');
  label.className = 'lib-card-name';
  label.textContent = name;
  b.append(label);
  if (tag) {
    const small = document.createElement('small');
    small.textContent = tag;
    small.classList.toggle('is-on', tag === 'aktiv');
    b.append(small);
  }
  return b;
}

function paintPick() {
  const overlay = lib.tab === 'overlay';
  const id = lib.pick[lib.tab];
  const item = overlay ? theme(id) : preset(id);
  $('#lib-name').textContent = item?.name ?? '';
  $('#lib-desc').textContent = overlay
    ? item?.desc ?? ''
    : [lookName(item?.design.look), item?.design.color ? 'eigene Farbe' : ''].filter(Boolean).join(' · ');
  $('#lib-kind-wrap').hidden = overlay;
  $('#lib-replay').hidden = overlay;
  const btn = $('#lib-apply');
  const active = overlay && id === lib.current;
  btn.textContent = active ? '✓ Aktiv' : overlay ? 'Fürs Overlay übernehmen' : 'Für alle Alerts übernehmen';
  btn.disabled = active || lib.busy || !lib.canEdit() || (overlay && lib.access && !lib.access.can_edit);
  $('#lib-note').textContent = !lib.canEdit()
    ? '🔒 Übernehmen dürfen der Streamer, Admins und freigegebene Mods.'
    : overlay && lib.access && !lib.access.can_edit
      ? '🔒 Das Overlay anpassen darf gerade nur der Streamer (Freigabe unter „Overlay & OBS“).'
      : overlay
        ? 'Gilt sofort für alle Karten im Overlay (OBS-Adresse mit live=1). Die Vorschau zeigt deine Ebenen – oder Beispielkarten, wenn noch keine an sind.'
        : 'Setzt Look, Bild, Farbe und Animationen für jede Alert-Art. Texte, Sounds und Varianten bleiben. Danach im Alert-Designer prüfen und speichern.';
}

// ---------- Vorschau ----------
function previewUrl() {
  const url = new URL('overlay.html', location.href);
  if (lib.tab === 'alerts') {
    url.searchParams.set('apreview', '1');
    url.searchParams.set('vol', '0');
    return url.href;
  }
  const p = new URLSearchParams(lib.params);
  // Nur Ebenen, die etwas zeigen – sonst Beispielkarten
  if (!OVERLAY_KEYS.some((k) => p.get(k) && p.get(k) !== '0')) {
    for (const [k, v] of new URLSearchParams(SAMPLE)) p.set(k, v);
  }
  p.delete('scene');
  p.set('otheme', lib.pick.overlay);
  p.set('edit', '1');
  p.set('test', '1');
  p.set('vol', '0');
  url.search = p.toString();
  return url.href;
}

function mountPreview() {
  const box = $('#lib-preview');
  box.classList.toggle('is-alert', lib.tab === 'alerts');
  const src = previewUrl();
  if (box.querySelector('iframe')?.dataset.src === src) { sendAlert(true); return; }
  const frame = document.createElement('iframe');
  frame.title = lib.tab === 'alerts' ? 'Vorschau des Alert-Designs' : 'Vorschau des Overlay-Designs';
  frame.src = frame.dataset.src = src;
  frame.width = lib.tab === 'alerts' ? ALERT_W : STAGE_W;
  frame.height = lib.tab === 'alerts' ? ALERT_H : STAGE_H;
  frame.setAttribute('tabindex', '-1');
  lib.frameReady = false;
  box.replaceChildren(frame);
  fit();
}

// Die Höhe kommt aus aspect-ratio – hier nur skalieren (nie die Höhe setzen, siehe Alert-Designer)
function fit() {
  const box = $('#lib-preview');
  const frame = box.querySelector('iframe');
  if (!frame || !box.clientWidth) return;
  frame.style.transform = `scale(${box.clientWidth / (lib.tab === 'alerts' ? ALERT_W : STAGE_W)})`;
}

function sendAlert(play) {
  const frame = $('#lib-preview iframe');
  const p = preset(lib.pick.alerts);
  if (lib.tab !== 'alerts' || !frame || !lib.frameReady || !p) return;
  const kinds = {};
  for (const k of ALERT_KINDS) kinds[k.kind] = normalizeDesign(p.design);
  frame.contentWindow.postMessage({
    type: 'sh-alert-preview', config: normalizeAlertConfig({ kinds }), kind: lib.kind, play,
  }, location.origin);
}

// ---------- Übernehmen ----------
async function apply() {
  if (lib.busy || !lib.canEdit()) return;
  lib.busy = true;
  paintPick();
  try {
    if (lib.tab === 'overlay') await applyOverlay(lib.pick.overlay);
    else await applyAlerts(lib.pick.alerts);
  } catch (err) {
    lib.toast(`Nicht übernommen: ${lib.germanError(err)}`, 'error');
  } finally {
    lib.busy = false;
    paintPick();
  }
}

async function applyOverlay(id) {
  const t = theme(id);
  if (!t) return;
  // Frisch laden, damit nichts überschrieben wird, was gerade jemand anderes geändert hat.
  // Noch nie zentral gespeichert: die Einstellungen aus diesem Browser mitnehmen.
  const config = await lib.api.getOverlayConfig();
  const p = new URLSearchParams(config?.params || safeLocal());
  if (id === 'standard') p.delete('otheme');
  else p.set('otheme', id);
  const query = p.toString();
  await lib.api.saveOverlayConfig(query);
  Object.assign(lib, { params: query, current: id });
  // Das OBS-Fenster in diesem Browser merkt sich die Auswahl auch
  const field = $('#obs-options')?.elements.otheme;
  if (field) field.value = id;
  lib.toast(`Overlay-Design „${t.name}“ ist aktiv – OBS zeigt es gleich.`, 'ok');
  paintList();
  paint();
}

async function applyAlerts(id) {
  const p = preset(id);
  if (!p) return;
  const ok = await lib.useAlertPreset(id);
  if (!ok) {
    lib.toast('Der Alert-Designer ist nicht bereit – öffne „Alerts“ und versuch es dort.', 'error');
    return;
  }
  lib.setPage('alerts');
  lib.toast(`„${p.name}“ ist für alle Alerts eingestellt. Prüfen und oben rechts „Speichern“ klicken.`, 'ok', 8000);
}
