// Anleitung „Overlay in OBS einrichten“: Schritt für Schritt mit Bildern aus OBS (assets/obs-guide/, OBS 30, deutsch).
// Öffnet sich beim ersten Öffnen des OBS-Editors von selbst – außer für Mods oder wenn OBS sich schon meldet
// (obs_status, …_obs_sound_pause.sql). Danach jederzeit über „In OBS einrichten“ im Dock „Steuerung“.
// Die Bilder sind OBS nachgebaut; echte Screenshots einfach unter denselben Dateinamen ablegen.
import { h } from './extras-core.js';

const SEEN_KEY = 'sh_obs_setup_seen';
const IMG = (name) => `assets/obs-guide/${name}.webp`;
const STATUS_MS = 5000;

let ctx = null;     // { url(), copy(), status(), connect() } aus app.js
let step = 0;
let statusTimer = 0;

// Jeder Schritt: Titel, Bild (oder eigener Inhalt) und Text. ① ② … passen zu den Nummern im Bild.
const STEPS = [
  {
    title: 'Overlay in OBS einrichten',
    img: '7-fertig', alt: 'OBS mit dem StreamHelp-Overlay über Spiel und Kamera',
    body: () => [
      h('p', {}, 'In zwei Minuten erledigt: Du legst in OBS eine ', h('b', {}, 'Browserquelle'), ' mit deiner StreamHelp-Adresse an. Danach erscheint alles, was du hier einstellst, sofort im Stream – Alerts, Laufband, Sounds und Spiele.'),
      h('p', { class: 'obs-setup-tip' }, '⚡ Schneller geht’s mit ', h('b', {}, '„Mit OBS verbinden“'), ': Dann legt StreamHelp die Quelle selbst an. ',
        h('button', { class: 'obs-setup-link', type: 'button', onclick: () => { close(); ctx.connect(); } }, 'Lieber verbinden')),
    ],
  },
  {
    title: 'Adresse kopieren',
    custom: () => h('div', { class: 'obs-setup-url' },
      h('input', { type: 'text', readonly: true, value: ctx.url(), 'aria-label': 'Adresse für die OBS-Browserquelle', onfocus: (e) => e.target.select() }),
      h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => ctx.copy() }, 'Kopieren')),
    body: () => [
      h('p', {}, 'Das ist ', h('b', {}, 'deine persönliche Overlay-Adresse'), '. Sie bleibt immer gleich – Änderungen hier im Editor kommen trotzdem sofort in OBS an.'),
      h('p', { class: 'obs-setup-tip' }, '🔒 Gib die Adresse nicht weiter: Wer sie hat, sieht dein Overlay.'),
    ],
  },
  {
    title: 'In OBS: Quelle hinzufügen',
    img: '1-plus', alt: 'OBS: unten im Bereich Quellen ist das Plus markiert',
    body: () => [
      h('p', {}, 'Öffne ', h('b', {}, 'OBS'), ' und wähle links unter ', h('b', {}, 'Szenen'), ' die Szene, in der das Overlay erscheinen soll (z. B. „Live“).'),
      h('p', {}, '① Unten im Bereich ', h('b', {}, 'Quellen'), ' auf ', h('b', {}, '+'), ' klicken.'),
    ],
  },
  {
    title: '„Browser“ wählen',
    img: '2-browser', alt: 'OBS: Liste der Quellen, Browser ist markiert',
    body: () => [h('p', {}, '① In der Liste ', h('b', {}, 'Browser'), ' anklicken.')],
  },
  {
    title: 'Namen geben',
    img: '3-name', alt: 'OBS: Dialog Quelle erstellen mit dem Namen StreamHelp',
    body: () => [
      h('p', {}, '① ', h('b', {}, 'Neu erstellen'), ' ist schon gewählt – als Namen ', h('b', {}, 'StreamHelp'), ' eintragen. „Quelle sichtbar machen“ bleibt angehakt.'),
      h('p', {}, '② Auf ', h('b', {}, 'OK'), ' klicken.'),
    ],
  },
  {
    title: 'Adresse und Größe eintragen',
    img: '4-eigenschaften', alt: 'OBS: Eigenschaften der Browserquelle mit URL, Breite, Höhe und Audio',
    body: () => h('ol', { class: 'obs-setup-list' },
      h('li', {}, 'Bei ', h('b', {}, 'URL'), ' die alte Adresse löschen und deine einfügen (', h('kbd', {}, 'Strg'), ' + ', h('kbd', {}, 'V'), ').'),
      h('li', {}, h('b', {}, 'Breite 1920'), ' und ', h('b', {}, 'Höhe 1080'), '.'),
      h('li', {}, h('b', {}, '„Audio über OBS steuern“'), ' anhaken – dann regelst du Alerts und Sounds im Audio-Mixer.'),
      h('li', {}, h('b', {}, '„Quelle herunterfahren, wenn nicht sichtbar“'), ' aus lassen – sonst verpasst das Overlay Alerts und Sounds.'),
      h('li', {}, 'Mit ', h('b', {}, 'OK'), ' speichern.')),
  },
  {
    title: 'Ganz nach oben schieben',
    img: '5-nach-oben', alt: 'OBS: StreamHelp steht in der Quellenliste ganz oben',
    body: () => [
      h('p', {}, '① ', h('b', {}, 'StreamHelp'), ' in der Liste anklicken. ② Mit dem Pfeil ', h('b', {}, '▲'), ' ganz nach oben schieben (oder mit der Maus ziehen).'),
      h('p', {}, 'Oben in der Liste heißt: vorn im Bild – das Overlay liegt dann über Kamera und Spiel.'),
      h('p', { class: 'obs-setup-tip' }, 'Füllt das Overlay nicht das ganze Bild? Rechtsklick auf StreamHelp → ', h('b', {}, 'Transformieren → An Bildschirm anpassen'), '.'),
    ],
  },
  {
    title: 'In weiteren Szenen',
    img: '6-weitere-szenen', alt: 'OBS: Vorhandene hinzufügen mit der Quelle StreamHelp',
    body: () => [
      h('p', {}, 'Soll das Overlay auch in „Just Chatting“ oder „Pause“ laufen? Dort ebenfalls ', h('b', {}, '+ → Browser'), ', dann:'),
      h('p', {}, '① ', h('b', {}, 'Vorhandene hinzufügen'), ' wählen, ② ', h('b', {}, 'StreamHelp'), ' anklicken, OK.'),
      h('p', { class: 'obs-setup-tip' }, 'So bleibt es eine einzige Quelle – Sounds und Alerts laufen nie doppelt.'),
    ],
  },
  {
    title: 'Fertig – kurz prüfen',
    img: '7-fertig', alt: 'OBS-Vorschau mit Overlay',
    body: () => [
      h('p', { class: 'obs-setup-status', 'data-state': 'wait', id: 'obs-setup-status' }, '⏳ Warte, bis sich OBS meldet … (OBS offen lassen, die Quelle muss sichtbar sein)'),
      h('p', {}, 'Teste es: Unter ', h('b', {}, 'Aussehen & Ton'), ' einen Alert abspielen – er erscheint in der OBS-Vorschau.'),
      h('p', { class: 'obs-setup-tip' }, 'Diese Anleitung findest du jederzeit unter ', h('b', {}, 'Steuerung → In OBS einrichten'), '.'),
    ],
  },
];

export function setupObsSetup(options) {
  ctx = options;
  const dlg = document.getElementById('obs-setup');
  if (!dlg) return;
  document.getElementById('obs-setup-prev').addEventListener('click', () => go(step - 1));
  document.getElementById('obs-setup-next').addEventListener('click', () => (step === STEPS.length - 1 ? close() : go(step + 1)));
  dlg.querySelector('[data-close]').addEventListener('click', close);
  dlg.addEventListener('close', () => clearInterval(statusTimer));
  dlg.addEventListener('keydown', (e) => {
    if (e.target.closest('input')) return;
    if (e.key === 'ArrowRight' && step < STEPS.length - 1) go(step + 1);
    if (e.key === 'ArrowLeft' && step > 0) go(step - 1);
  });
  document.getElementById('obs-setup-dots').replaceChildren(...STEPS.map((s, i) =>
    h('button', { type: 'button', role: 'tab', class: 'obs-setup-dot', 'aria-label': `Schritt ${i + 1}: ${s.title}`, onclick: () => go(i) })));
}

export function openObsSetup(at = 0) {
  const dlg = document.getElementById('obs-setup');
  if (!dlg || !ctx) return;
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ohne Speicher: egal */ }
  go(at);
  if (!dlg.open) dlg.showModal();
}

// Beim ersten Öffnen des Editors: nur für Streamer, und nur, wenn OBS sich noch nicht meldet
export async function autoOpenObsSetup({ isMod = false } = {}) {
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { /* zeigen */ }
  if (seen || isMod) return;
  const online = await Promise.race([ctx.status().then((s) => !!s?.online).catch(() => false), new Promise((r) => setTimeout(() => r(false), 1500))]);
  if (online) { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* egal */ } return; }
  openObsSetup(0);
}

function close() {
  clearInterval(statusTimer);
  document.getElementById('obs-setup')?.close();
}

function go(i) {
  step = Math.max(0, Math.min(STEPS.length - 1, i));
  const s = STEPS[step];
  document.getElementById('obs-setup-count').textContent = `Schritt ${step + 1} von ${STEPS.length}`;
  document.getElementById('obs-setup-title').textContent = s.title;
  const media = s.custom
    ? s.custom()
    : h('figure', { class: 'obs-setup-shot' },
      // Antippen öffnet das Bild groß (am Handy sonst zu klein zum Lesen)
      h('a', { href: IMG(s.img), target: '_blank', rel: 'noopener', title: 'Bild groß öffnen' },
        h('img', { src: IMG(s.img), alt: s.alt, width: 1440, height: 900, loading: 'eager', decoding: 'async' })));
  const text = s.body();
  document.getElementById('obs-setup-body').replaceChildren(media, h('div', { class: 'obs-setup-text' }, ...(Array.isArray(text) ? text : [text])));
  document.querySelectorAll('#obs-setup-dots .obs-setup-dot').forEach((d, k) => {
    d.classList.toggle('is-on', k === step);
    d.classList.toggle('is-done', k < step);
    d.setAttribute('aria-selected', String(k === step));
  });
  document.getElementById('obs-setup-prev').disabled = step === 0;
  document.getElementById('obs-setup-next').textContent = step === 0 ? 'Los geht’s' : step === STEPS.length - 1 ? 'Fertig' : 'Weiter';
  // Bilder der nächsten Schritte schon laden
  for (const n of STEPS.slice(step + 1, step + 3)) if (n.img) new Image().src = IMG(n.img);
  clearInterval(statusTimer);
  if (step === STEPS.length - 1) { checkStatus(); statusTimer = setInterval(checkStatus, STATUS_MS); }
}

// Letzter Schritt: meldet sich OBS? (braucht …_obs_sound_pause.sql, sonst bleibt der Hinweis zum Selbstprüfen)
async function checkStatus() {
  const el = document.getElementById('obs-setup-status');
  if (!el) return;
  let s = null;
  try { s = await ctx.status(); } catch { s = null; }
  if (!document.getElementById('obs-setup-status')) return;
  if (!s) {
    el.dataset.state = 'unknown';
    el.textContent = '👀 Siehst du das Overlay in der OBS-Vorschau? Dann passt alles.';
    clearInterval(statusTimer);
  } else if (s.online) {
    el.dataset.state = 'ok';
    el.textContent = '✅ OBS ist verbunden – das Overlay läuft.';
    clearInterval(statusTimer);
  } else {
    el.dataset.state = 'wait';
    el.textContent = '⏳ Warte, bis sich OBS meldet … (OBS offen lassen, die Quelle muss sichtbar sein)';
  }
}
