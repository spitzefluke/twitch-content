// Mehrsprachigkeit für Startseite und Anmeldung (das Dashboard ist noch deutsch).
// Quelle ist immer der deutsche Text (Liste in js/i18n-keys.js); js/i18n-<sprache>.js enthält die
// Übersetzungen in derselben Reihenfolge. Fehlt ein Eintrag, bleibt der deutsche Text – nichts geht kaputt.
//
//   · applyI18n(root): übersetzt alle Texte unter root. Hat ein Element genau einen Text, wird nur
//     dieser ersetzt (Symbole davor bleiben). Mischt es Text und Tags (z. B. <b>), ist der Schlüssel
//     das ganze innere HTML.
//   · t('Deutscher Text', { name }) für Texte aus JavaScript; {name} wird ersetzt.
//   · Wörterbuch-Vorlage erzeugen: Seite mit ?i18n-dump öffnen, dann in der Konsole i18nKeys().
export const LANGS = [
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
];
const LOCALES = { de: 'de-DE', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', nl: 'nl-NL', pl: 'pl-PL', pt: 'pt-BR', tr: 'tr-TR', ru: 'ru-RU' };
const KEY = 'sh_lang';

let lang = 'de';
let dict = {};

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
// Den Streamer-Namen setzt die Seite erst später ein – im Schlüssel steht immer „Streamer“
const mixedKey = (el) => norm(el.innerHTML).replace(/(<(\w+) data-streamer="">)[^<]*(<\/\2>)/g, '$1Streamer$3');

// Gewählte Sprache: gespeichert, sonst Browsersprache, sonst Deutsch
export function pickLang() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* privater Modus */ }
  const wanted = [saved, ...(navigator.languages ?? [navigator.language])].filter(Boolean).map((l) => String(l).slice(0, 2).toLowerCase());
  return wanted.find((l) => LANGS.some((x) => x.code === l)) ?? 'de';
}

export async function initI18n() {
  lang = pickLang();
  document.documentElement.lang = lang;
  if (lang !== 'de') {
    try {
      const [keys, vals] = await Promise.all([import('./i18n-keys.js'), import(`./i18n-${lang}.js`)]);
      dict = Object.fromEntries(keys.default.map((k, i) => [norm(k), vals.default[i]]).filter(([, v]) => v));
    } catch (err) {
      console.warn('Übersetzung nicht geladen:', err);
      lang = 'de';
      dict = {};
    }
  }
  // Schlüssel jetzt sammeln – bevor die Startseite Texte umbaut (Wörter einzeln, Zahlen-Band …)
  if (new URLSearchParams(location.search).has('i18n-dump')) { const keys = collectKeys(document); window.i18nKeys = () => keys; }
  return lang;
}

export const currentLang = () => lang;
export const locale = () => LOCALES[lang] ?? 'de-DE';

export function setLang(code) {
  try { localStorage.setItem(KEY, code); } catch { /* egal */ }
  location.reload();
}

export function t(source, vars) {
  let out = dict[norm(source)] ?? source;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

const SKIP = 'script, style, [translate="no"], [data-no-i18n]';
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

// Elemente mit eigenem Text (direkte Textknoten)
function textElements(root) {
  const out = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.closest(SKIP)) continue;
    const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!texts.length) continue;
    // Gemischter Inhalt unter einem schon gemischten Eltern-Element wird dort mit übersetzt
    if (el.parentElement?.closest('[data-i18n-mixed]')) continue;
    if (texts.length > 1 || [...el.children].some((c) => !c.matches('i, svg, img, br') && c.textContent.trim())) {
      el.dataset.i18nMixed = '';
    }
    out.push(el);
  }
  return out;
}

export function applyI18n(root) {
  if (!root) return;
  const els = textElements(root);
  if (lang === 'de') { els.forEach((el) => delete el.dataset.i18nMixed); return; }
  for (const el of els) {
    if ('i18nMixed' in el.dataset) {
      const tr = dict[mixedKey(el)];
      if (tr) el.innerHTML = tr; // Übersetzungen sind Teil des Codes (kein fremder Text)
      continue;
    }
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    const src = norm(node.textContent);
    const tr = dict[src];
    if (tr) node.textContent = node.textContent.replace(node.textContent.trim(), tr);
  }
  for (const el of root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))) {
    if (el.closest(SKIP)) continue;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && dict[norm(v)]) el.setAttribute(a, dict[norm(v)]);
    }
  }
}

// Alle Schlüssel einer Seite (für neue Wörterbücher), ohne sie zu übersetzen
function collectKeys(doc) {
  const keys = new Set();
  for (const sel of ['#landing', '#auth']) {
    const root = doc.querySelector(sel);
    if (!root) continue;
    for (const el of textElements(root)) {
      const k = 'i18nMixed' in el.dataset ? mixedKey(el) : norm([...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()).textContent);
      if (/[a-zäöüß]{2}/i.test(k.replace(/<[^>]+>/g, ''))) keys.add(k);
    }
    for (const el of root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))) {
      for (const a of ATTRS) { const v = el.getAttribute(a); if (v && /[a-zäöüß]{3}/i.test(v)) keys.add(norm(v)); }
    }
  }
  return [...keys];
}

// Sprachauswahl (ein <select>), z. B. in der Kopfzeile der Startseite
export function langPicker(cls = '') {
  const sel = document.createElement('select');
  sel.className = `lang-pick ${cls}`.trim();
  sel.translate = false;
  sel.setAttribute('aria-label', t('Sprache'));
  for (const l of LANGS) {
    const o = document.createElement('option');
    o.value = l.code;
    o.textContent = `${l.flag} ${l.name}`;
    o.selected = l.code === lang;
    sel.append(o);
  }
  sel.addEventListener('change', () => setLang(sel.value));
  return sel;
}
