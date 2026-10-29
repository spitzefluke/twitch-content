// Anleitung „Overlay in OBS einrichten“ nach dem Entwurf „OBS-Anleitung“ (Claude Design, Designsystem Nocturne):
// links die Schritte mit Phasen und die Overlay-Adresse (immer griffbereit), oben der OBS-Status, rechts der Schritt
// mit Bild aus OBS (assets/obs-guide/, OBS 30, deutsch). Die Nummern ① ② im Text passen zu den Nummern im Bild.
// Öffnet sich beim ersten Öffnen des OBS-Editors von selbst – außer für Mods oder wenn OBS sich schon meldet
// (obs_status, …_obs_sound_pause.sql). Danach jederzeit über „In OBS einrichten“ im Dock „Steuerung“.
// Die Bilder sind OBS nachgebaut; echte Screenshots einfach unter denselben Dateinamen ablegen.
import { h } from './extras-core.js';

const SEEN_KEY = 'sh_obs_setup_seen';
const IMG = (name) => `assets/obs-guide/${name}.webp`;
const STATUS_MS = 5000;

let ctx = null;     // { url(), copy(), status(), connect(), testAlert() } aus app.js
let step = 0;
let statusTimer = 0;
let copiedTimer = 0;
let obsState = 'wait'; // wait | ok | unknown
let checks = {};       // Schritt „Adresse & Größe“: abgehakte Felder

const b = (text) => h('b', {}, text);
const icon = (name) => h('i', { class: `ph ${name}`, 'aria-hidden': 'true' });
const mark = (n) => h('span', { class: 'os-num', 'aria-hidden': 'true' }, String(n));
const line = (n, ...kids) => h('div', { class: 'os-line' }, mark(n), h('span', {}, ...kids));
const hint = (ico, ...kids) => h('div', { class: 'os-hint' }, icon(ico), h('span', {}, ...kids));
const copyBtn = (cls) => h('button', { class: `os-btn ${cls}`, type: 'button', 'data-copy': '', onclick: copy }, icon('ph-copy'), h('span', {}, 'Kopieren'));

// Felder in den Eigenschaften der Browserquelle (Schritt 6) – zum Abhaken
const CHECKS = [
  { k: 'url', field: 'URL', val: 'Deine Adresse einfügen', why: 'Alte Adresse vorher löschen, dann Strg + V', url: true },
  { k: 'size', field: 'Breite × Höhe', val: '1920 × 1080', why: 'Volle Bildgröße – sonst wirkt alles verschoben' },
  { k: 'audio', field: 'Audio über OBS steuern', val: 'Anhaken', why: 'Alerts und Sounds regelst du dann im Audio-Mixer' },
  { k: 'shut', field: 'Quelle herunterfahren, wenn nicht sichtbar', val: 'Aus lassen', why: 'Sonst verpasst das Overlay Alerts und Sounds' },
  { k: 'ok', field: 'Speichern', val: 'OK klicken', why: '' },
];

// Jeder Schritt: Kurzname (links), Überschrift, Phase (beginnt hier eine neue, steht sie links darüber), Bild, Inhalt
const STEPS = [
  {
    t: 'Weg wählen', head: 'Wie soll das Overlay in OBS kommen?', ph: 'Start',
    body: () => [
      h('p', { class: 'os-lead' }, 'Das Overlay kommt als ', b('Browserquelle'), ' in OBS. Danach erscheint alles, was du hier einstellst, sofort im Stream – Alerts, Laufband, Sounds und Spiele.'),
      h('div', { class: 'os-ways' },
        h('div', { class: 'os-way is-best' },
          h('div', { class: 'os-way-head' }, icon('ph-plugs-connected'), h('span', {}, 'Automatisch verbinden'), h('span', { class: 'os-tag os-tag--acc' }, 'schnellster Weg')),
          h('p', {}, 'StreamHelp legt die Quelle selbst in OBS an. OBS muss dafür offen sein.'),
          h('button', { class: 'os-btn os-btn--primary', type: 'button', onclick: () => { close(); ctx.connect(); } }, 'Mit OBS verbinden')),
        h('div', { class: 'os-way' },
          h('div', { class: 'os-way-head' }, icon('ph-hand-pointing'), h('span', {}, 'Von Hand einrichten'), h('span', { class: 'os-tag' }, 'ca. 2 Minuten')),
          h('p', {}, '7 kurze Schritte mit Bildern aus OBS. Klappt immer, auch ohne Verbindung.'),
          h('button', { class: 'os-btn os-btn--secondary', type: 'button', onclick: () => go(1) }, 'Anleitung starten', icon('ph-arrow-right')))),
      h('figure', { class: 'os-final' },
        h('img', { src: IMG('7-fertig'), alt: 'OBS mit dem StreamHelp-Overlay über Spiel und Kamera', width: 1440, height: 900, decoding: 'async' }),
        h('figcaption', {}, 'So sieht es am Ende aus: Das Overlay liegt in OBS über Spiel und Kamera.')),
    ],
  },
  {
    t: 'Adresse kopieren', head: 'Deine Overlay-Adresse kopieren', ph: 'Vorbereiten',
    body: () => [
      h('div', { class: 'os-url' },
        h('input', { type: 'text', readonly: true, value: ctx.url(), 'aria-label': 'Adresse für die OBS-Browserquelle', onfocus: (e) => e.target.select() }),
        copyBtn('os-btn--primary')),
      h('p', { class: 'os-lead' }, 'Das ist ', b('deine persönliche Overlay-Adresse'), '. Sie bleibt immer gleich – was du im Editor änderst, kommt trotzdem sofort in OBS an.'),
      h('div', { class: 'os-hints' },
        hint('ph-push-pin', 'Du brauchst sie gleich in Schritt 6. Bis dahin bleibt sie links unten griffbereit.'),
        hint('ph-lock-simple', 'Gib sie nicht weiter: Wer die Adresse hat, sieht dein Overlay.')),
    ],
  },
  {
    t: 'Quelle hinzufügen', head: 'In OBS eine Quelle hinzufügen', ph: 'In OBS',
    img: '1-plus', alt: 'OBS: unten im Bereich Quellen ist das Plus markiert',
    body: () => [
      h('p', { class: 'os-lead' }, 'Öffne ', b('OBS'), ' und wähle unter ', b('Szenen'), ' die Szene, in der das Overlay laufen soll (z. B. „Live“).'),
      line(1, 'Unten im Bereich ', b('Quellen'), ' auf ', b('+'), ' klicken.'),
    ],
  },
  {
    t: '„Browser“ wählen', head: '„Browser“ als Quelle wählen',
    img: '2-browser', alt: 'OBS: Liste der Quellen, Browser ist markiert',
    body: () => [line(1, 'In der Liste ', b('Browser'), ' anklicken.')],
  },
  {
    t: 'Namen geben', head: 'Der Quelle einen Namen geben',
    img: '3-name', alt: 'OBS: Dialog Quelle erstellen mit dem Namen StreamHelp',
    body: () => [h('div', { class: 'os-lines' },
      line(1, 'Bei ', b('Neu erstellen'), ' als Namen ', b('StreamHelp'), ' eintragen. „Quelle sichtbar machen“ bleibt angehakt.'),
      line(2, 'Auf ', b('OK'), ' klicken.'))],
  },
  {
    t: 'Adresse & Größe', head: 'Adresse und Größe eintragen',
    img: '4-eigenschaften', alt: 'OBS: Eigenschaften der Browserquelle mit URL, Breite, Höhe und Audio',
    body: () => [
      h('p', { class: 'os-lead' }, 'Trag diese Werte ein und hak sie hier ab:'),
      h('div', { class: 'os-checks' }, ...CHECKS.map((c, i) => h('div', { class: 'os-check' },
        mark(i + 1),
        h('span', { class: 'os-check-field' }, c.field),
        h('span', { class: 'os-check-val' }, h('b', {}, c.val), c.why ? h('small', {}, c.why) : null),
        h('span', { class: 'os-check-act' },
          c.url ? copyBtn('os-btn--secondary os-btn--sm') : null,
          h('button', {
            class: 'os-box', type: 'button', 'aria-pressed': String(!!checks[c.k]), 'aria-label': `${c.field}: abhaken`,
            onclick: (e) => { checks[c.k] = !checks[c.k]; e.currentTarget.setAttribute('aria-pressed', String(checks[c.k])); },
          }, icon('ph-check')))))),
    ],
  },
  {
    t: 'Nach oben schieben', head: 'Overlay ganz nach oben schieben', ph: 'Feinschliff',
    img: '5-nach-oben', alt: 'OBS: StreamHelp steht in der Quellenliste ganz oben',
    body: () => [
      h('div', { class: 'os-lines' },
        line(1, b('StreamHelp'), ' in der Liste anklicken.'),
        line(2, 'Mit dem Pfeil ', b('▲'), ' ganz nach oben schieben (oder mit der Maus ziehen). Oben in der Liste heißt: vorn im Bild.')),
      hint('ph-frame-corners', 'Füllt das Overlay nicht das ganze Bild? Rechtsklick auf StreamHelp → ', b('Transformieren → An Bildschirm anpassen'), '.'),
    ],
  },
  {
    t: 'Weitere Szenen', head: 'Auch in anderen Szenen zeigen', opt: true,
    img: '6-weitere-szenen', alt: 'OBS: Vorhandene hinzufügen mit der Quelle StreamHelp',
    body: () => [
      h('p', { class: 'os-lead' }, 'Nur nötig, wenn das Overlay auch in „Just Chatting“ oder „Pause“ laufen soll. Dort ebenfalls ', b('+ → Browser'), ', dann:'),
      h('div', { class: 'os-lines' },
        line(1, b('Vorhandene hinzufügen'), ' wählen – nicht „Neu erstellen“.'),
        line(2, b('StreamHelp'), ' anklicken, OK.')),
      hint('ph-speaker-high', 'So bleibt es eine einzige Quelle – Sounds und Alerts laufen nie doppelt.'),
    ],
  },
  {
    t: 'Prüfen', head: 'Fertig – kurz prüfen', ph: 'Prüfen',
    img: '7-fertig', alt: 'OBS-Vorschau mit Overlay',
    body: () => [
      h('div', { class: 'os-result', id: 'obs-setup-result' }),
      h('div', { class: 'os-row' },
        h('button', { class: 'os-btn os-btn--secondary', type: 'button', onclick: (e) => ctx.testAlert?.(e.currentTarget) }, icon('ph-play'), 'Test-Alert abspielen'),
        h('span', { class: 'os-note' }, 'Die Anleitung findest du jederzeit unter ', b('Steuerung → In OBS einrichten'), '.')),
    ],
  },
];

// Phase je Schritt (die letzte davor genannte)
const PHASE = STEPS.reduce((acc, s, i) => [...acc, s.ph ?? acc[i - 1]], []);

export function setupObsSetup(options) {
  ctx = options;
  const dlg = document.getElementById('obs-setup');
  if (!dlg) return;
  document.getElementById('obs-setup-prev').addEventListener('click', () => go(step - 1));
  document.getElementById('obs-setup-next').addEventListener('click', () => (step === STEPS.length - 1 ? close() : go(step + 1)));
  document.getElementById('obs-setup-addr-copy').addEventListener('click', copy);
  document.getElementById('obs-setup-addr').addEventListener('focus', (e) => e.target.select());
  dlg.querySelector('[data-close]').addEventListener('click', close);
  dlg.addEventListener('close', () => clearInterval(statusTimer));
  dlg.addEventListener('keydown', (e) => {
    if (e.target.closest('input, button')) return;
    if (e.key === 'ArrowRight' && step < STEPS.length - 1) go(step + 1);
    if (e.key === 'ArrowLeft' && step > 0) go(step - 1);
  });
  document.getElementById('obs-setup-rail').replaceChildren(...STEPS.flatMap((s, i) => [
    s.ph ? h('p', { class: 'os-phase' }, s.ph) : null,
    h('button', { class: 'os-step', type: 'button', 'data-step': i, onclick: () => go(i) },
      h('span', { class: 'os-step-num', 'aria-hidden': 'true' }, h('span', {}, String(i + 1)), icon('ph-check')),
      h('span', { class: 'os-step-t' }, s.t),
      s.opt ? h('small', {}, 'optional') : null),
  ].filter(Boolean)));
}

export function openObsSetup(at = 0) {
  const dlg = document.getElementById('obs-setup');
  if (!dlg || !ctx) return;
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ohne Speicher: egal */ }
  checks = {};
  document.getElementById('obs-setup-addr').value = ctx.url();
  go(at);
  if (!dlg.open) dlg.showModal();
  // Der Status oben gilt für die ganze Anleitung
  clearInterval(statusTimer);
  checkStatus();
  statusTimer = setInterval(checkStatus, STATUS_MS);
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

async function copy() {
  await ctx.copy();
  const dlg = document.getElementById('obs-setup');
  dlg.querySelectorAll('[data-copy] span').forEach((s) => { s.textContent = 'Kopiert'; });
  document.getElementById('obs-setup-copied').hidden = false;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    dlg.querySelectorAll('[data-copy] span').forEach((s) => { s.textContent = 'Kopieren'; });
    document.getElementById('obs-setup-copied').hidden = true;
  }, 2000);
}

function go(i) {
  step = Math.max(0, Math.min(STEPS.length - 1, i));
  const s = STEPS[step];
  document.getElementById('obs-setup-count').textContent = `Schritt ${step + 1} von ${STEPS.length} · ${PHASE[step]}`;
  document.getElementById('obs-setup-head').textContent = s.head;
  const shot = s.img && h('figure', { class: 'os-shot' },
    h('img', { src: IMG(s.img), alt: s.alt, width: 1440, height: 900, loading: 'eager', decoding: 'async' }),
    h('a', { href: IMG(s.img), target: '_blank', rel: 'noopener' }, icon('ph-magnifying-glass-plus'), 'Vergrößern'));
  document.getElementById('obs-setup-body').replaceChildren(...s.body(), ...(shot ? [shot] : []));
  document.querySelectorAll('#obs-setup-rail .os-step').forEach((el) => {
    const k = Number(el.dataset.step);
    el.dataset.state = k === step ? 'on' : k < step ? 'done' : 'todo';
    if (k === step) el.setAttribute('aria-current', 'step');
    else el.removeAttribute('aria-current');
  });
  document.querySelector('#obs-setup-rail .os-step[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  document.getElementById('obs-setup-content').scrollTop = 0;
  document.getElementById('obs-setup-prev').disabled = step === 0;
  document.getElementById('obs-setup-next').replaceChildren(
    step === 0 ? 'Von Hand einrichten' : step === STEPS.length - 1 ? 'Fertig' : `Weiter: ${STEPS[step + 1].t}`,
    ...(step === STEPS.length - 1 ? [] : [icon('ph-arrow-right')]));
  // Bilder der nächsten Schritte schon laden
  for (const n of STEPS.slice(step + 1, step + 3)) if (n.img) new Image().src = IMG(n.img);
  paintStatus();
}

// Meldet sich OBS? (braucht …_obs_sound_pause.sql, sonst „Status unbekannt“ und der Hinweis zum Selbstprüfen)
async function checkStatus() {
  let s = null;
  try { s = await ctx.status(); } catch { s = null; }
  obsState = !s ? 'unknown' : s.online ? 'ok' : 'wait';
  if (obsState !== 'wait') clearInterval(statusTimer);
  paintStatus();
}

const PILL = { wait: 'OBS noch nicht verbunden', ok: 'OBS verbunden – Overlay läuft', unknown: 'Status unbekannt' };
function paintStatus() {
  const pill = document.getElementById('obs-setup-pill');
  if (!pill) return;
  pill.dataset.state = obsState;
  pill.lastChild.textContent = PILL[obsState];
  const box = document.getElementById('obs-setup-result');
  if (!box) return;
  box.dataset.state = obsState;
  box.replaceChildren(...(obsState === 'ok'
    ? [icon('ph-check-circle'), h('span', {}, h('b', {}, 'OBS ist verbunden – das Overlay läuft.'), h('small', {}, 'Spiel zum Test einen Alert ab, er erscheint in der OBS-Vorschau.'))]
    : obsState === 'wait'
      ? [icon('ph-circle-notch'), h('span', {}, h('b', {}, 'Warte, bis sich OBS meldet …'), h('small', {}, 'OBS offen lassen, die Quelle muss sichtbar sein.'))]
      : [icon('ph-eye'), h('span', {}, 'Siehst du das Overlay in der OBS-Vorschau? Dann passt alles.')]));
}
