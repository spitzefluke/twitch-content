// Cookie-Fenster: StreamHelp setzt keine Werbe- oder Tracking-Cookies. Nötig (ohne Einwilligung, § 25 Abs. 2
// Nr. 2 TDDDG) sind nur Anmeldung und Einstellungen im Browser. Einwilligung braucht nur „Externe Medien“:
// der YouTube-Player für Song-Wünsche (js/bot-plus.js), der erst danach geladen wird.
// Die Wahl liegt im Browser unter sh_consent; „Cookie-Einstellungen“ (data-consent-open oder #cookies in der
// Adresse) öffnet das Fenster wieder. Details stehen in cookies.html.
import { t } from './i18n.js';

const KEY = 'sh_consent';
const VERSION = 1; // höher setzen, wenn neue Kategorien dazukommen – dann fragt das Fenster neu
const CHANGE = 'sh-consent';

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && v.v === VERSION ? v : null;
  } catch { return null; }
}

// Hat der Besucher dieser Kategorie zugestimmt? ('media' = YouTube-Player)
export const hasConsent = (what) => !!read()?.[what];

export function setConsent(choice) {
  const value = { v: VERSION, media: !!choice.media, at: new Date().toISOString() };
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* privater Modus: gilt nur bis zum Neuladen */ }
  dispatchEvent(new CustomEvent(CHANGE, { detail: value }));
}

// Benachrichtigung bei jeder Änderung (z. B. Player laden, sobald „Externe Medien“ erlaubt ist)
export const onConsent = (fn) => addEventListener(CHANGE, (e) => fn(e.detail));

let box = null;

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  n.append(...kids.filter((k) => k != null));
  return n;
};

function build() {
  const media = el('input', { type: 'checkbox', id: 'ck-media' });
  const settings = el('div', { class: 'ck-settings', id: 'ck-settings', hidden: true },
    el('label', { class: 'ck-row is-fixed' },
      el('input', { type: 'checkbox', checked: true, disabled: true }),
      el('span', {}, el('b', {}, t('Notwendig')), el('small', {}, t('Anmeldung, Sprache und deine Einstellungen. Ohne sie funktioniert die Seite nicht – immer an.')))),
    el('label', { class: 'ck-row', for: 'ck-media' }, media,
      el('span', {}, el('b', {}, t('Externe Medien')), el('small', {}, t('YouTube-Player für Song-Wünsche im Dashboard. Beim Laden erhält YouTube (Google) deine IP-Adresse.')))));
  const more = el('button', { type: 'button', class: 'ck-btn ck-btn--link', 'aria-expanded': 'false', 'aria-controls': 'ck-settings' }, t('Einstellungen'));
  const save = el('button', { type: 'button', class: 'ck-btn ck-btn--line', hidden: true }, t('Auswahl speichern'));
  const only = el('button', { type: 'button', class: 'ck-btn ck-btn--line' }, t('Nur notwendige'));
  const all = el('button', { type: 'button', class: 'ck-btn ck-btn--solid' }, t('Alle erlauben'));
  const root = el('section', { class: 'ck', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'ck-title', 'aria-describedby': 'ck-text', hidden: true },
    el('h2', { class: 'ck-title', id: 'ck-title' }, el('span', { 'aria-hidden': 'true' }, '🍪 '), t('Cookies & Speicher')),
    el('p', { class: 'ck-text', id: 'ck-text' },
      t('Keine Werbung, kein Tracking. Nötig sind nur Anmeldung und deine Einstellungen. Optional: der YouTube-Player für Song-Wünsche.'), ' ',
      el('a', { href: 'cookies.html' }, t('Cookie-Richtlinie'))),
    settings,
    el('div', { class: 'ck-actions' }, more, save, only, all));

  const close = (choice) => { setConsent(choice); root.hidden = true; };
  only.addEventListener('click', () => close({ media: false }));
  all.addEventListener('click', () => close({ media: true }));
  save.addEventListener('click', () => close({ media: media.checked }));
  more.addEventListener('click', () => {
    const open = settings.hidden;
    settings.hidden = !open;
    save.hidden = !open;
    more.setAttribute('aria-expanded', String(open));
    if (open) media.focus();
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && read()) root.hidden = true; });
  return { root, media, settings, save, more };
}

export function openConsent({ settings = false } = {}) {
  if (!box) return;
  box.media.checked = hasConsent('media');
  box.settings.hidden = !settings;
  box.save.hidden = !settings;
  box.more.setAttribute('aria-expanded', String(settings));
  box.root.hidden = false;
  box.root.querySelector('button')?.focus({ preventScroll: true });
}

// Einmal pro Seite: Fenster anlegen, beim ersten Besuch zeigen, Links „Cookie-Einstellungen“ verdrahten
export function setupConsent() {
  if (box || window.obsstudio) return; // OBS (Browserquelle) bekommt nie ein Fenster
  box = build();
  document.body.append(box.root);
  if (!read()) box.root.hidden = false;
  document.addEventListener('click', (e) => {
    const link = e.target.closest?.('[data-consent-open]');
    if (!link) return;
    e.preventDefault();
    openConsent({ settings: true });
  });
  const fromHash = () => {
    if (location.hash !== '#cookies') return;
    openConsent({ settings: true });
    history.replaceState(null, '', `${location.pathname}${location.search}`); // beim Neuladen nicht wieder öffnen
  };
  addEventListener('hashchange', fromHash);
  fromHash();
}
