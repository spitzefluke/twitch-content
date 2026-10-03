// Alert-Designer im Dashboard (Seite „Alerts“): Aussehen je Alert-Art wie bei StreamElements.
// Fertige Designs, eigenes Bild/GIF/Video, drei Textzeilen mit Platzhaltern, Textanimation,
// Einblenden, Dauer, Sound und Varianten nach Menge. Gespeichert wird in alert_config
// (Migration …_overlay_designs.sql); das Overlay übernimmt Änderungen ohne Neuladen.
// Die Vorschau ist overlay.html?apreview=1 in einem iframe und bekommt das Design per postMessage.
import {
  ALERT_KINDS, ALERT_LAYOUTS, ALERT_LOOKS, ALERT_MEDIA, ALERT_PRESETS, ENTER_ANIMS, PLACEHOLDERS, TEXT_ANIMS,
  VARIANT_KINDS, alertLines, builtinMediaUrl, normalizeAlertConfig, normalizeDesign, playAlertSound, sampleAlert,
} from './alerts.js';
import { BOARD, Sfx } from './prank-fx.js';

const $ = (sel) => document.querySelector(sel);
const MAX_BYTES = 10 * 1024 * 1024;
const CONFIG_BYTES = 60000;
const PREVIEW_W = 820;
const PREVIEW_H = 440;
// Vorschlag für die erste Variante und die Probe-Menge
const VAR_START = { bits: 1000, gift: 5, resub: 12, redeem: 5000 };
// Länge der Einblende-Animation je Art (wie css/overlay.css), Ausgang immer 0,36 s
const ENTER_SECONDS = { '': 0.56, pop: 0.7, slide: 0.7, drop: 0.9, zoom: 0.7, fade: 0.9, flip: 0.9, spin: 0.9 };
const OUT_SECONDS = 0.36;
const TL_MAX = 30.5;

const ad = {
  api: null, toast: null, germanError: String, canEdit: () => false,
  cfg: normalizeAlertConfig(null), kind: 'follow', varId: null, dirty: false, loaded: false,
  media: [], sounds: [], alertSounds: [], obsParams: new URLSearchParams(), frameReady: false, sfx: null,
  lastText: null, hoverTimer: 0, waveKey: '', waveJob: 0,
};

export function setupAlertDesigner({ api, toast, germanError, canEdit }) {
  Object.assign(ad, { api, toast, germanError, canEdit });
  const form = $('#ad-form');
  const opts = (sel, list) => form.elements[sel].replaceChildren(...list.map((x) => new Option(x.name, x.id)));
  opts('anim', TEXT_ANIMS);
  opts('enter', ENTER_ANIMS);
  opts('layout', ALERT_LAYOUTS);
  form.elements.look.replaceChildren(new Option('wie im OBS-Fenster', ''), ...ALERT_LOOKS.map((l) => new Option(l.name, l.id)));

  $('#ad-kinds').replaceChildren(...ALERT_KINDS.map((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ad-kind';
    b.setAttribute('role', 'tab');
    b.dataset.kind = k.kind;
    b.textContent = k.label;
    return b;
  }));
  $('#ad-kinds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    ad.kind = b.dataset.kind;
    ad.varId = null;
    $('#ad-amount').value = baseAmount();
    paint({ play: true });
  });
  $('#ad-vars').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.add) { addVariant(); return; }
    ad.varId = b.dataset.var || null;
    $('#ad-amount').value = ad.cfg.vars.find((x) => x.id === ad.varId)?.min ?? baseAmount();
    paint({ play: true });
  });
  $('#ad-var-min').addEventListener('change', (e) => {
    const v = ad.cfg.vars.find((x) => x.id === ad.varId);
    if (!v) return;
    v.min = Math.min(10000000, Math.max(1, Math.round(Number(e.target.value)) || 1));
    $('#ad-amount').value = v.min;
    changed();
    paint();
  });
  $('#ad-var-del').addEventListener('click', () => {
    ad.cfg.vars = ad.cfg.vars.filter((x) => x.id !== ad.varId);
    ad.varId = null;
    changed();
    paint();
  });

  $('#ad-presets').replaceChildren(...ALERT_PRESETS.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ad-preset';
    b.dataset.preset = p.id;
    b.setAttribute('role', 'listitem');
    b.style.setProperty('--pc', p.design.color || '#9146ff');
    const thumb = document.createElement('span');
    thumb.className = 'ad-preset-thumb';
    thumb.dataset.look = p.design.look;
    if (p.design.media.startsWith('b:')) {
      const img = new Image();
      img.alt = '';
      img.src = builtinMediaUrl(p.design.media.slice(2));
      thumb.append(img);
    } else thumb.textContent = 'Aa';
    const name = document.createElement('span');
    name.textContent = p.name;
    b.append(thumb, name);
    return b;
  }));
  $('#ad-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    const preset = b && ALERT_PRESETS.find((p) => p.id === b.dataset.preset);
    if (!preset || !ad.canEdit()) return;
    const targets = $('#ad-preset-all').checked
      ? ALERT_KINDS.map((k) => (ad.cfg.kinds[k.kind] ??= normalizeDesign(null)))
      : [design()];
    for (const d of targets) Object.assign(d, preset.design);
    changed();
    paint({ play: true });
  });

  // Maus auf einem fertigen Design: in der großen Vorschau abspielen, ohne etwas zu ändern
  const presets = $('#ad-presets');
  const hover = (b) => {
    clearTimeout(ad.hoverTimer);
    presets.querySelectorAll('.is-hover').forEach((x) => x.classList.remove('is-hover'));
    if (!b) { ad.hoverTimer = setTimeout(() => sendPreview(), 120); return; }
    b.classList.add('is-hover');
    ad.hoverTimer = setTimeout(() => {
      const preset = ALERT_PRESETS.find((p) => p.id === b.dataset.preset);
      if (preset) previewDesign({ ...design(), ...preset.design });
    }, 140);
  };
  presets.addEventListener('pointerover', (e) => { const b = e.target.closest('[data-preset]'); if (b && !b.classList.contains('is-hover')) hover(b); });
  presets.addEventListener('pointerleave', () => hover(null));
  presets.addEventListener('focusin', (e) => hover(e.target.closest('[data-preset]')));
  presets.addEventListener('focusout', (e) => { if (!presets.contains(e.relatedTarget)) hover(null); });

  // 🎲 Würfeln: zufälliges Design für die gewählte Alert-Art
  $('#ad-dice').addEventListener('click', (e) => {
    if (!ad.canEdit()) return;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const hue = Math.floor(Math.random() * 360);
    const hex = hslHex(hue, 85, 60);
    Object.assign(design(), {
      look: pick(ALERT_LOOKS).id, layout: pick(ALERT_LAYOUTS).id, enter: pick(ENTER_ANIMS).id, anim: pick(TEXT_ANIMS).id,
      media: Math.random() < 0.85 ? `b:${pick(ALERT_MEDIA).id}` : '', color: hex, confetti: Math.random() < 0.7,
      msize: pick([80, 100, 120, 140]),
    });
    const btn = e.currentTarget;
    btn.classList.remove('is-rolling');
    void btn.offsetWidth;
    btn.classList.add('is-rolling');
    changed();
    paint({ play: true });
  });

  // Zeitleiste: ziehen setzt die Dauer
  const tl = $('#ad-timeline');
  const fromX = (x) => {
    const r = tl.querySelector('.ad-tl-track').getBoundingClientRect();
    const sec = ((x - r.left) / r.width) * TL_MAX - OUT_SECONDS;
    return Math.min(30, Math.max(3, Math.round(sec)));
  };
  tl.addEventListener('pointerdown', (e) => {
    if (!ad.canEdit() || e.button !== 0) return;
    e.preventDefault();
    tl.setPointerCapture(e.pointerId);
    tl.classList.add('is-dragging');
    const set = (ev) => {
      const el = form.elements.duration;
      const v = String(fromX(ev.clientX));
      if (el.value === v) return;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(e);
    tl.addEventListener('pointermove', set);
    tl.addEventListener('pointerup', () => {
      tl.removeEventListener('pointermove', set);
      tl.classList.remove('is-dragging');
      sendPreview({ play: true });
    }, { once: true });
  });

  $('#ad-media').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { deleteMedia(del.dataset.del); return; }
    const b = e.target.closest('[data-media]');
    if (!b || !ad.canEdit()) return;
    design().media = b.dataset.media;
    changed();
    paint({ play: true });
  });
  $('#ad-upload-btn').addEventListener('click', uploadMedia);
  $('#ad-file').addEventListener('change', () => {
    const f = $('#ad-file').files[0];
    if (f && !$('#ad-file-name').value.trim()) $('#ad-file-name').value = f.name.replace(/\.[^.]+$/, '').slice(0, 40);
  });

  $('#ad-chips').append(...PLACEHOLDERS.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ad-chip';
    b.textContent = p;
    return b;
  }));
  form.addEventListener('focusin', (e) => { if (['label', 'title', 'text'].includes(e.target.name)) ad.lastText = e.target; });
  $('#ad-chips').addEventListener('mousedown', (e) => { if (e.target.closest('.ad-chip')) e.preventDefault(); });
  $('#ad-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.ad-chip');
    if (!chip) return;
    const input = ad.lastText ?? form.elements.title;
    const at = input.selectionStart ?? input.value.length;
    input.setRangeText(chip.textContent, at, input.selectionEnd ?? at, 'end');
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const onField = (e) => {
    const el = e.target;
    if (!el.name || el.closest('#ad-upload')) return;
    readForm();
    changed();
    paintOutputs();
    sendPreview({ play: e.type === 'change' && ['anim', 'enter', 'layout', 'look'].includes(el.name) });
  };
  form.addEventListener('change', (e) => { if (e.target.name === 'sound') paintWave(); });
  form.addEventListener('input', onField);
  form.addEventListener('change', onField);
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#ad-play').addEventListener('click', () => { sendPreview({ play: true }); playSound(); });
  $('#ad-amount').addEventListener('change', () => sendPreview({ play: true }));
  $('#ad-sound-test').addEventListener('click', playSound);
  $('#ad-save').addEventListener('click', save);

  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'sh-alert-preview-ready') return;
    if (e.source !== $('#ad-preview iframe')?.contentWindow) return;
    ad.frameReady = true;
    sendPreview();
  });
  new ResizeObserver(fitPreview).observe($('#ad-preview'));
  addEventListener('beforeunload', (e) => { if (ad.dirty) e.preventDefault(); });
}

// Beim Öffnen der Seite: Designs, Dateien, Sounds und OBS-Einstellungen frisch laden
export async function openAlertDesigner() {
  if (ad.dirty && ad.loaded) { paint(); return; }
  const status = $('#ad-status');
  const [cfg, media, sounds, alertSounds, obsCfg] = await Promise.all([
    ad.api.getAlertConfig().catch((err) => { status.textContent = ad.germanError(err); return null; }),
    ad.api.getAlertMedia().catch(() => []),
    ad.api.getSounds().catch(() => []),
    ad.api.getAlertSounds().catch(() => []),
    ad.api.getOverlayConfig().catch(() => null),
  ]);
  ad.cfg = normalizeAlertConfig(cfg);
  Object.assign(ad, { media, sounds, alertSounds, loaded: cfg !== null, dirty: false });
  ad.obsParams = new URLSearchParams(obsCfg?.params ?? '');
  if (ad.loaded) status.textContent = ad.canEdit() ? 'Design, Bild oder Video, Texte und Animationen – für jede Alert-Art einzeln.' : '🔒 Gestalten dürfen der Streamer, Admins und freigegebene Mods.';
  paintSoundOptions();
  mountPreview();
  paint();
}

// Aus der Design-Bibliothek: fertiges Design für alle Alert-Arten einstellen (noch nicht gespeichert –
// die Seite „Alerts“ zeigt es, „Speichern“ macht es fest). Liefert false, wenn es nicht geht.
export async function useAlertPreset(id) {
  const preset = ALERT_PRESETS.find((p) => p.id === id);
  if (!preset) return false;
  await openAlertDesigner();
  if (!ad.loaded || !ad.canEdit()) return false;
  for (const k of ALERT_KINDS) Object.assign((ad.cfg.kinds[k.kind] ??= normalizeDesign(null)), preset.design);
  ad.varId = null;
  changed();
  paint({ play: true });
  return true;
}

// Theme-Paket aus der Design-Bibliothek: Design für alle Alert-Arten einstellen und gleich speichern.
// 'ok' | 'dirty' (ungespeicherte Änderungen im Designer) | 'locked' | 'missing' | 'error'
export async function installAlertPreset(id) {
  const preset = ALERT_PRESETS.find((p) => p.id === id);
  if (!preset) return 'missing';
  if (ad.dirty && ad.loaded) return 'dirty';
  await openAlertDesigner();
  if (!ad.loaded) return 'missing';
  if (!ad.canEdit()) return 'locked';
  for (const k of ALERT_KINDS) Object.assign((ad.cfg.kinds[k.kind] ??= normalizeDesign(null)), preset.design);
  changed();
  paint();
  await save({ quiet: true });
  return ad.dirty ? 'error' : 'ok';
}

function design() {
  if (ad.varId) {
    const v = ad.cfg.vars.find((x) => x.id === ad.varId);
    if (v) return v.design;
    ad.varId = null;
  }
  return (ad.cfg.kinds[ad.kind] ??= normalizeDesign(null));
}

function addVariant() {
  if (!ad.canEdit()) return;
  if (ad.cfg.vars.length >= 30) { ad.toast('Höchstens 30 Varianten.', 'error'); return; }
  const mine = ad.cfg.vars.filter((v) => v.kind === ad.kind);
  const min = mine.length ? Math.min(10000000, Math.max(...mine.map((v) => v.min)) * 10) : VAR_START[ad.kind];
  const v = { id: Math.random().toString(36).slice(2, 10), kind: ad.kind, min, design: { ...normalizeDesign(ad.cfg.kinds[ad.kind]) } };
  ad.cfg.vars.push(v);
  ad.varId = v.id;
  $('#ad-amount').value = min;
  changed();
  paint({ play: true });
}

// Probe-Menge für „Standard“: unter der kleinsten Variante
function baseAmount() {
  const sample = sampleAlert(ad.kind);
  const n = ad.kind === 'resub' ? sample.months : sample.amount;
  const mins = ad.cfg.vars.filter((v) => v.kind === ad.kind).map((v) => v.min);
  return Math.max(1, Math.min(n, ...mins.map((m) => m - 1)));
}

function changed() {
  ad.dirty = true;
  paintSave();
}

function paintSave() {
  const btn = $('#ad-save');
  btn.disabled = !ad.dirty || !ad.canEdit() || !ad.loaded;
  btn.textContent = ad.dirty ? 'Speichern' : '✓ Gespeichert';
}

// Formular → Design
function readForm() {
  const f = $('#ad-form').elements;
  const d = design();
  Object.assign(d, normalizeDesign({
    ...d,
    look: f.look.value, layout: f.layout.value, enter: f.enter.value, anim: f.anim.value,
    label: f.label.value, title: f.title.value, text: f.text.value,
    duration: f.duration.value, msize: f.msize.value, sound: f.sound.value,
    color: f.color_on.checked ? f.color.value : '',
    vsound: f.vsound.checked, confetti: f.confetti.checked,
  }));
}

function paint({ play = false } = {}) {
  const d = design();
  const f = $('#ad-form').elements;
  const locked = !ad.canEdit();
  document.querySelectorAll('#ad-kinds .ad-kind').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.kind === ad.kind)));

  // Varianten nur, wo es eine Menge gibt
  const unit = VARIANT_KINDS[ad.kind];
  const vars = ad.cfg.vars.filter((v) => v.kind === ad.kind).sort((a, b) => a.min - b.min);
  const bar = $('#ad-vars');
  bar.hidden = !unit;
  if (unit) {
    const chip = (label, id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ad-var';
      b.dataset.var = id ?? '';
      b.setAttribute('aria-pressed', String((ad.varId ?? '') === (id ?? '')));
      b.textContent = label;
      return b;
    };
    const add = chip('+ Variante', null);
    add.dataset.add = '1';
    add.removeAttribute('aria-pressed');
    add.className = 'ad-var ad-var-add';
    add.disabled = locked;
    bar.replaceChildren(
      Object.assign(document.createElement('span'), { className: 'ad-vars-label', textContent: 'Varianten nach Menge:' }),
      chip('Standard'), ...vars.map((v) => chip(`ab ${v.min.toLocaleString('de-DE')} ${unit}`, v.id)), add,
    );
  }
  const v = vars.find((x) => x.id === ad.varId);
  $('#ad-var-edit').hidden = !v;
  if (v) { $('#ad-var-min').value = v.min; $('#ad-var-unit').textContent = unit; }
  $('#ad-amount-wrap').hidden = !unit;
  $('#ad-amount-label').textContent = unit ?? 'Menge';
  if (unit && !Number($('#ad-amount').value)) $('#ad-amount').value = v?.min ?? baseAmount();

  // Felder
  setValue(f.look, d.look);
  setValue(f.layout, d.layout);
  setValue(f.enter, d.enter);
  setValue(f.anim, d.anim);
  setValue(f.sound, d.sound);
  const lines = alertLines(sampleAlert(ad.kind), normalizeDesign(null));
  f.label.value = d.label;
  f.label.placeholder = lines.label;
  f.title.value = d.title;
  f.title.placeholder = lines.title;
  f.text.value = d.text;
  f.text.placeholder = lines.text;
  f.duration.value = d.duration;
  f.msize.value = d.msize;
  f.color_on.checked = !!d.color;
  f.color.value = d.color || '#9146ff';
  f.vsound.checked = d.vsound;
  f.confetti.checked = d.confetti;
  for (const el of $('#ad-form').elements) if (!el.closest('#ad-upload')) el.disabled = locked;
  $('#ad-upload').hidden = locked;
  paintOutputs();
  paintMedia(d);
  paintSave();
  paintWave();
  sendPreview({ play });
}

function setValue(select, value) {
  select.value = value;
  if (select.value !== value) select.value = select.options[0]?.value ?? '';
}

function paintOutputs() {
  const f = $('#ad-form').elements;
  $('#ad-duration-out').textContent = `${f.duration.value} s`;
  paintTimeline();
  $('#ad-msize-out').textContent = `${f.msize.value} %`;
  f.color.disabled = !f.color_on.checked || !ad.canEdit();
}

function paintMedia(d) {
  const tile = (value, label, content, del) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ad-mtile';
    b.dataset.media = value;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(d.media === value));
    b.title = label;
    b.disabled = !ad.canEdit();
    b.append(content, Object.assign(document.createElement('small'), { textContent: label }));
    if (!del) return b;
    const wrap = document.createElement('span');
    wrap.className = 'ad-mtile-wrap';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'ad-mtile-del';
    x.dataset.del = del;
    x.title = `„${label}“ löschen`;
    x.setAttribute('aria-label', x.title);
    x.textContent = '×';
    x.hidden = !ad.canEdit();
    wrap.append(b, x);
    return wrap;
  };
  const text = (t) => Object.assign(document.createElement('span'), { className: 'ad-mtile-emoji', textContent: t });
  const img = (src) => Object.assign(new Image(), { src, alt: '', loading: 'lazy' });
  const vid = (src) => Object.assign(document.createElement('video'), { src, muted: true, preload: 'metadata', playsInline: true });
  const own = ad.media.map((m) => tile(`u:${m.path}`, m.name, m.kind === 'video' ? vid(m.url) : img(m.url), m.id));
  $('#ad-media').replaceChildren(
    tile('', 'Symbol', text(alertLines(sampleAlert(ad.kind), d).icon)),
    tile('none', 'Nichts', text('⌀')),
    ...ALERT_MEDIA.map((m) => tile(`b:${m.id}`, m.name, img(builtinMediaUrl(m.id)))),
    ...own,
  );
}

// ---------- Vorschau ----------
function mountPreview() {
  const box = $('#ad-preview');
  if (box.querySelector('iframe')) return;
  const url = new URL('overlay.html', location.href);
  url.searchParams.set('apreview', '1');
  url.searchParams.set('vol', '0');
  const look = ad.obsParams.get('alook');
  if (look) url.searchParams.set('alook', look);
  const frame = document.createElement('iframe');
  frame.title = 'Vorschau des Alerts';
  frame.src = url.href;
  frame.width = PREVIEW_W;
  frame.height = PREVIEW_H;
  frame.setAttribute('tabindex', '-1');
  ad.frameReady = false;
  box.replaceChildren(frame);
  fitPreview();
}

function fitPreview() {
  const box = $('#ad-preview');
  const frame = box.querySelector('iframe');
  if (!frame || !box.clientWidth) return;
  // Die Höhe kommt aus aspect-ratio (css/style.css). Nicht selbst setzen: Mit fester Höhe
  // rechnet aspect-ratio die Breite daraus zurück, und die Vorschau schrumpfte Runde um Runde.
  frame.style.transform = `scale(${box.clientWidth / PREVIEW_W})`;
}

function sendPreview({ play = false } = {}) {
  const frame = $('#ad-preview iframe');
  if (!frame || !ad.frameReady) return;
  const amount = VARIANT_KINDS[ad.kind] ? Number($('#ad-amount').value) || 0 : 0;
  frame.contentWindow.postMessage({ type: 'sh-alert-preview', config: ad.cfg, kind: ad.kind, amount, play }, location.origin);
  if (play) runPlayhead(design());
}

// Vorschau mit einem anderen Design (Maus auf einem fertigen Design) – ad.cfg bleibt unverändert
function previewDesign(d) {
  const frame = $('#ad-preview iframe');
  if (!frame || !ad.frameReady) return;
  const cfg = structuredClone(ad.cfg);
  const v = ad.varId && cfg.vars.find((x) => x.id === ad.varId);
  if (v) v.design = normalizeDesign(d);
  else cfg.kinds[ad.kind] = normalizeDesign(d);
  const amount = VARIANT_KINDS[ad.kind] ? Number($('#ad-amount').value) || 0 : 0;
  frame.contentWindow.postMessage({ type: 'sh-alert-preview', config: cfg, kind: ad.kind, amount, play: true }, location.origin);
  runPlayhead(normalizeDesign(d));
}

// ---------- Zeitleiste: Ein – Halten – Aus ----------
function timing(d) {
  const enter = ENTER_SECONDS[d.enter] ?? ENTER_SECONDS[''];
  const total = Number(d.duration) || 7;
  return { enter, hold: Math.max(0, total - enter), out: OUT_SECONDS, total: total + OUT_SECONDS };
}
const sec = (n) => `${n.toLocaleString('de-DE', { maximumFractionDigits: 2 })} s`;
function paintTimeline() {
  const f = $('#ad-form').elements;
  const t = timing({ enter: f.enter.value, duration: f.duration.value });
  const block = $('#ad-tl-block');
  block.style.setProperty('--tl-w', `${(t.total / TL_MAX) * 100}%`);
  block.style.setProperty('--tl-in', t.enter);
  block.style.setProperty('--tl-hold', t.hold);
  block.style.setProperty('--tl-out', t.out);
  block.style.setProperty('--tl-c', f.color_on.checked ? f.color.value : '#9146ff');
  $('#ad-tl-in').textContent = sec(t.enter);
  $('#ad-tl-hold').textContent = sec(Math.round(t.hold * 100) / 100);
}
function runPlayhead(d) {
  const head = $('#ad-tl-head');
  if (!head?.animate) return;
  const t = timing(d);
  head.getAnimations().forEach((a) => a.cancel());
  head.animate([
    { left: '0%', opacity: 1 }, { left: `${(t.total / TL_MAX) * 100}%`, opacity: 1, offset: 0.98 }, { left: `${(t.total / TL_MAX) * 100}%`, opacity: 0 },
  ], { duration: t.total * 1000, easing: 'linear' });
}

// ---------- Wellenform des Sounds ----------
// Eigene Sounds werden dekodiert, eingebaute (Synthesizer) in einem OfflineAudioContext aufgenommen.
function soundChoice() {
  const d = design();
  const param = ALERT_KINDS.find((k) => k.kind === ad.kind)?.param;
  return d.sound || ad.obsParams.get(param) || 'default';
}
function soundUrl(value) {
  const [prefix, path] = [value.slice(0, 1), value.slice(2)];
  return (prefix === 'a' ? ad.alertSounds : ad.sounds).find((x) => x.path === path)?.url;
}
async function renderSound(choice) {
  const OAC = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;
  if (!OAC || choice === 'none') return null;
  if (/^[ac]:/.test(choice)) {
    const url = soundUrl(choice);
    if (!url) return null;
    let bytes;
    if (url.startsWith('data:')) {
      const b64 = url.slice(url.indexOf(',') + 1);
      bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    } else {
      const res = await fetch(url);
      if (!res.ok) return null;
      bytes = await res.arrayBuffer();
    }
    return new OAC(1, 44100, 44100).decodeAudioData(bytes);
  }
  const ctx = new OAC(1, 44100 * 3, 44100);
  const rec = new Sfx();
  rec.ctx = ctx;
  rec.out = ctx.createGain();
  rec.out.connect(ctx.destination);
  rec.get = () => ctx;
  playAlertSound(rec, ad.kind, choice);
  return ctx.startRendering();
}
async function paintWave() {
  const canvas = $('#ad-wave');
  if (!canvas) return;
  const choice = soundChoice();
  const color = design().color || '#b57bff';
  const key = `${ad.kind}|${choice}|${color}`;
  if (key === ad.waveKey) return;
  ad.waveKey = key;
  const job = ++ad.waveJob;
  const info = $('#ad-wave-info');
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);
  if (choice === 'none') { info.textContent = 'kein Ton'; return; }
  info.textContent = '…';
  let buf = null;
  try { buf = await renderSound(choice); } catch (err) { console.warn('Wellenform:', err); }
  if (job !== ad.waveJob) return;
  if (!buf) { info.textContent = 'Wellenform nicht verfügbar'; return; }
  const data = buf.getChannelData(0);
  // Stille am Ende abschneiden (eingebaute Sounds sind kürzer als 3 Sekunden)
  let end = data.length;
  while (end > 1 && Math.abs(data[end - 1]) < 0.002) end--;
  const step = Math.max(1, Math.floor(end / W));
  let peak = 0.0001;
  for (let i = 0; i < end; i++) peak = Math.max(peak, Math.abs(data[i]));
  g.fillStyle = color;
  g.globalAlpha = 0.9;
  for (let x = 0; x < W; x++) {
    let lo = 0;
    let hi = 0;
    for (let i = x * step, n = Math.min(end, i + step); i < n; i++) { if (data[i] < lo) lo = data[i]; if (data[i] > hi) hi = data[i]; }
    const y1 = H / 2 - (hi / peak) * (H / 2 - 3);
    const y2 = H / 2 - (lo / peak) * (H / 2 - 3);
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  g.globalAlpha = 0.25;
  g.fillRect(0, H / 2, W, 1);
  info.textContent = sec(Math.round((end / buf.sampleRate) * 10) / 10);
}

function hslHex(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ---------- Sound ----------
function paintSoundOptions() {
  const el = $('#ad-form').elements.sound;
  const group = (label, options) => {
    const g = document.createElement('optgroup');
    g.label = label;
    g.append(...options);
    return g;
  };
  el.replaceChildren(
    new Option('wie im OBS-Fenster', ''), new Option('Standard-Klang', 'default'), new Option('Kein Ton', 'none'),
    ...[
      ad.alertSounds.length && group('Eigene Alert-Sounds', ad.alertSounds.map((x) => new Option(`🔔 ${x.name}`, `a:${x.path}`))),
      group('Soundboard', BOARD.map((b) => new Option(`${b.emoji} ${b.name}`, b.id))),
      ad.sounds.length && group('Aus „Ärgere den Streamer“', ad.sounds.map((x) => new Option(x.name, `c:${x.path}`))),
    ].filter(Boolean),
  );
}

async function playSound() {
  const d = design();
  const param = ALERT_KINDS.find((k) => k.kind === ad.kind)?.param;
  const choice = d.sound || ad.obsParams.get(param) || 'default';
  ad.sfx ??= new Sfx();
  if (!ad.sfx.get()) await ad.sfx.ctx?.resume().catch(() => {});
  playAlertSound(ad.sfx, ad.kind, choice, (value) => {
    const [prefix, path] = [value.slice(0, 1), value.slice(2)];
    return (prefix === 'a' ? ad.alertSounds : ad.sounds).find((x) => x.path === path)?.url;
  });
}

// ---------- Eigene Dateien ----------
async function uploadMedia() {
  const msg = $('#ad-upload-msg');
  const file = $('#ad-file').files[0];
  const name = $('#ad-file-name').value.trim().slice(0, 40);
  msg.classList.remove('is-ok');
  if (!file) { msg.textContent = 'Wähl zuerst eine Datei aus.'; return; }
  if (!/^(image\/(png|jpeg|gif|webp)|video\/(webm|mp4))$/.test(file.type)) { msg.textContent = 'Nur PNG, JPG, GIF, WebP, WebM oder MP4.'; return; }
  if (file.size > MAX_BYTES) { msg.textContent = 'Die Datei ist größer als 10 MB.'; return; }
  if (!name) { msg.textContent = 'Gib der Datei einen Namen.'; return; }
  const btn = $('#ad-upload-btn');
  btn.disabled = true;
  msg.textContent = 'Lädt hoch …';
  try {
    const media = await ad.api.uploadAlertMedia(file, name);
    ad.media = [media, ...ad.media];
    design().media = `u:${media.path}`;
    $('#ad-file').value = '';
    $('#ad-file-name').value = '';
    msg.textContent = '✓ Hochgeladen und ausgewählt – nicht vergessen zu speichern.';
    msg.classList.add('is-ok');
    changed();
    paint({ play: true });
  } catch (err) {
    msg.textContent = ad.germanError(err);
  } finally {
    btn.disabled = false;
  }
}

async function deleteMedia(id) {
  const media = ad.media.find((m) => m.id === id);
  if (!media || !ad.canEdit()) return;
  const value = `u:${media.path}`;
  const used = [...Object.values(ad.cfg.kinds), ...ad.cfg.vars.map((v) => v.design)].filter((d) => d.media === value).length;
  if (!confirm(`„${media.name}“ löschen?${used ? ` Es wird in ${used} Design${used === 1 ? '' : 's'} benutzt – dort steht dann wieder das Symbol.` : ''}`)) return;
  try {
    await ad.api.deleteAlertMedia(media);
    ad.media = ad.media.filter((m) => m.id !== id);
    if (used) {
      for (const d of [...Object.values(ad.cfg.kinds), ...ad.cfg.vars.map((v) => v.design)]) if (d.media === value) d.media = '';
      await save();
    }
    paint();
  } catch (err) {
    ad.toast(ad.germanError(err), 'error');
  }
}

async function save({ quiet = false } = {}) {
  if (!ad.canEdit()) return;
  const config = normalizeAlertConfig(ad.cfg);
  if (new TextEncoder().encode(JSON.stringify(config)).length > CONFIG_BYTES) {
    ad.toast('Zu viele Varianten oder zu lange Texte – bitte etwas kürzen.', 'error');
    return;
  }
  const btn = $('#ad-save');
  btn.disabled = true;
  btn.textContent = 'Speichert …';
  try {
    await ad.api.saveAlertConfig(config);
    ad.cfg = config;
    ad.dirty = false;
    if (!quiet) ad.toast('✓ Alert-Designs gespeichert – sie gelten sofort im Overlay.', 'ok');
  } catch (err) {
    ad.toast(ad.germanError(err), 'error');
  }
  paintSave();
}
