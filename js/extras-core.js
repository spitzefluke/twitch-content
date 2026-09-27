// Gemeinsames für die neueren Content-Ideen auf der Webseite (js/extras.js und Co.).
// app.js gibt beim Start seine Helfer herein (X.ctx), die Daten kommen aus js/extras-api.js (X.api).
export const X = { ctx: null, api: null };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const isAdmin = () => !!X.ctx?.state.profile?.is_admin;
export const toast = (...args) => X.ctx.toast(...args);
export const germanError = (err) => X.ctx.germanError(err);

// Kleines DOM-Werkzeug: h('button', {class: 'btn', onclick}, 'Text', kind …) – Texte immer als Text, nie als HTML
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// Dialog anlegen (die Grundform ist fest, der Inhalt ist statisches HTML ohne Nutzerdaten)
export function makeDialog({ id, cls = '', eyebrow, title, body }) {
  const dlg = document.createElement('dialog');
  dlg.id = id;
  dlg.className = `dialog dialog--extra ${cls}`;
  dlg.setAttribute('aria-labelledby', `${id}-title`);
  dlg.innerHTML = `
    <div class="dialog-head">
      <div>
        <p class="eyebrow">${eyebrow}</p>
        <h2 id="${id}-title">${title}</h2>
      </div>
      <button class="icon-btn" type="button" data-close aria-label="Schließen">&times;</button>
    </div>
    <p class="prank-note x-note" data-note hidden></p>
    ${body}`;
  document.body.append(dlg);
  return dlg;
}

// Hinweis oben im Dialog, wenn die Migration fehlt
export function paintNote(dlg, feature) {
  const note = $('[data-note]', dlg);
  note.hidden = feature.on;
  if (!feature.on) {
    note.textContent = isAdmin()
      ? `Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20261014000000_stream_extras.sql ausführen.${feature.error ? ` (${feature.error})` : ''}`
      : 'Das ist noch nicht eingerichtet. Schau später noch mal vorbei.';
  }
}

// Knopf sperren, Aktion ausführen, Fehler als Meldung
export async function act(btn, fn, okText = '') {
  if (btn) btn.disabled = true;
  try {
    const result = await fn();
    if (okText) toast(okText, 'ok');
    return result;
  } catch (err) {
    toast(germanError(err), 'error');
    return undefined;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Formular abschicken ohne Neuladen
export function onSubmit(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    await act(btn, () => fn(form));
  });
}

export const pad = (n) => String(n).padStart(2, '0');
// 3725 → "1:02:05", 125 → "2:05"
export function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh ? `${hh}:${pad(mm)}:${pad(s % 60)}` : `${mm}:${pad(s % 60)}`;
}
// Sekunden als Text: 90 → "1 Min 30 s", 3600 → "1 Std"
export function span(sec) {
  const s = Math.abs(Math.round(sec));
  if (s < 60) return `${s} s`;
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [hh && `${hh} Std`, mm && `${mm} Min`, ss && `${ss} s`].filter(Boolean).join(' ');
}
export const timeOf = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
export const secondsUntil = (iso) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 1000)) : 0);

// Eine Uhr für alle Dialoge: tickt jede Sekunde, solange einer offen ist
const tickers = new Set();
let tickTimer = 0;
export function onTick(fn) {
  tickers.add(fn);
  if (!tickTimer) {
    tickTimer = setInterval(() => {
      for (const t of tickers) {
        try { t(); } catch (err) { console.warn(err); }
      }
    }, 1000);
  }
}

// Kachel mit Live-Status (Grundform aus app.js)
export function buildTile(feature, tile, i) {
  const el = X.ctx.buildActionTile(tile, i, { cls: `tile--x tile--x-${feature.kind}`, cta: feature.cta, onClick: () => feature.open() });
  paintTile(feature, el);
  return el;
}
export function paintTile(feature, el = document.querySelector(`.tile--x-${feature.kind}`)) {
  const label = el?.querySelector('.tile-live-status');
  if (label) label.textContent = feature.tileStatus();
}

// Öffnen: vor dem Starttermin sehen Zuschauer die Countdown-Karte
export function openFeature(feature) {
  const tile = X.ctx.tileByKind(feature.kind);
  if (tile && X.ctx.isLocked(tile)) { X.ctx.openTile(tile.id); return false; }
  const dlg = feature.dialog;
  if (!dlg.open) dlg.showModal();
  return true;
}

// Liste leeren und mit Einträgen füllen (oder Leer-Text)
export function fill(list, items, render, empty = 'Noch nichts da.') {
  list.replaceChildren(...(items.length ? items.map(render) : [h('li', { class: 'x-empty' }, empty)]));
}

export const RARITY_LABEL = { common: 'Gewöhnlich', uncommon: 'Ungewöhnlich', rare: 'Selten', epic: 'Episch', legendary: 'Legendär' };
