// Einführung (Design „Einführung neu“): erst drei kurze Fragen, dann ein Plan, der zu dir passt, dann die
// Mitmach-Tour (js/tour.js) durch das echte Dashboard – bei „Du bist dran“ klickst du selbst.
//   Streamer:  Willkommen → Erfahrung, Ziel, Plattform → Plan → Tour → Fertig
//   Mods:      Willkommen → Tour (Werkzeuge) → Fertig
//   Zuschauer: Willkommen → Tour (Games, Ideen, Konto) → Fertig
// Beim ersten Besuch öffnet sie sich von selbst, danach jederzeit links unter „Einführung“.
// Die Antworten merkt sich dieser Browser (sh_intro_v2_<user>), gefragt wurde (sh_tour_<user>) einmal.
import { h } from './extras-core.js';
import { startTour } from './tour.js';

const QUESTIONS = [
  { id: 'exp', title: 'Wie viel Stream-Erfahrung hast du?', sub: 'Damit wir nichts erklären, was du schon kannst.', options: [
    ['new', 'ph-plant', 'Ganz neu', 'Noch nie gestreamt oder gerade erst OBS installiert.'],
    ['some', 'ph-sneaker-move', 'Ein paar Mal', 'Schon live gewesen, aber noch ohne festes Setup.'],
    ['pro', 'ph-lightning', 'Regelmäßig', 'Ich streame öfter und will mehr aus dem Stream holen.']] },
  { id: 'goal', title: 'Was ist gerade dein Ziel?', sub: 'Wir stellen dir passende Tipps in den Vordergrund.', options: [
    ['fun', 'ph-smiley', 'Spaß haben', 'Mit Freunden und Chat eine gute Zeit haben.'],
    ['grow', 'ph-trend-up', 'Mehr Zuschauer', 'Wachsen, mehr Leute erreichen, wiederkommende Zuschauer.'],
    ['affiliate', 'ph-medal', 'Affiliate werden', 'Die Twitch-Ziele schaffen und erste Einnahmen.']] },
  { id: 'platform', title: 'Wo streamst du?', sub: 'Ein paar Funktionen gibt es nur auf Twitch.', options: [
    ['twitch', 'ph-twitch-logo', 'Twitch', 'Kanalpunkte, Bits und Abos inklusive.'],
    ['both', 'ph-arrows-split', 'Twitch + YouTube', 'Gleichzeitig live – der YouTube-Chat läuft im Overlay mit.'],
    ['youtube', 'ph-youtube-logo', 'Vor allem YouTube', 'StreamHelp läuft über deinen Twitch-Kanal, YouTube kommt dazu.']] },
];
const LABEL = { new: 'Einsteiger', some: 'Ein paar Streams', pro: 'Erfahren', fun: 'Spaß', grow: 'Wachstum', affiliate: 'Affiliate-Ziel', twitch: 'Twitch', youtube: 'YouTube', both: 'Twitch + YouTube' };
const PROMISES = [
  ['ph-user-focus', 'Auf dich zugeschnitten', 'Neu oder erfahren, mit oder ohne YouTube – du siehst nur, was passt.'],
  ['ph-cursor-click', 'Selbst ausprobieren', 'Kein Durchklicken: Du machst die Schritte direkt im Dashboard.'],
  ['ph-flag-checkered', 'Startklar in 5 Schritten', 'Danach weißt du, wie dein erster Stream gut läuft.'],
];
const ease = 380;

const intro = {
  deps: null, step: 0, ans: { exp: null, goal: null, platform: null }, phase: 'flow', timer: 0,
};

const icon = (cls, extra = '') => h('i', { class: `ph ${cls}${extra ? ` ${extra}` : ''}`, 'aria-hidden': 'true' });
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* privater Modus: dann eben nicht gemerkt */ } },
};
const askedKey = () => `sh_tour_${intro.deps.userId() ?? ''}`;
const ansKey = () => `sh_intro_v2_${intro.deps.userId() ?? ''}`;
const dlg = () => document.getElementById('intro');

// deps: { userId, userName, role: () => 'streamer' | 'team' | 'viewer', prepare, goStart }
export function setupIntro(deps) {
  intro.deps = deps;
  const d = dlg();
  // Esc oder Schließen: gefragt ist gefragt
  d.addEventListener('close', () => {
    clearTimeout(intro.timer);
    if (!store.get(askedKey())) store.set(askedKey(), 'no');
  });
}

function loadAnswers() {
  try {
    const s = JSON.parse(store.get(ansKey()) || 'null');
    if (s?.ans) intro.ans = { exp: s.ans.exp ?? null, goal: s.ans.goal ?? null, platform: s.ans.platform ?? null };
  } catch { intro.ans = { exp: null, goal: null, platform: null }; }
}

// Von vorn (Leiste „Einführung“ oder erster Besuch)
export function openIntro() {
  loadAnswers();
  intro.step = 0;
  intro.phase = 'flow';
  render();
  const d = dlg();
  if (!d.open) d.showModal();
}

// Erster Besuch: einmal von selbst
export function maybeOpenIntro() {
  if (!intro.deps?.userId()) return;
  let asked = null;
  try { asked = localStorage.getItem(askedKey()); } catch { return; }
  if (asked) return;
  // Erst andere Fenster (Kontoart, „Was ist neu“) zu Ende
  const other = document.querySelector('dialog[open]:not(#intro)');
  if (other) {
    other.addEventListener('close', () => setTimeout(maybeOpenIntro, 400), { once: true });
    return;
  }
  if (!dlg().open) openIntro();
}

// ---------- Ablauf ----------
const role = () => intro.deps.role();
const asksQuestions = () => role() === 'streamer';

function go(step) {
  clearTimeout(intro.timer);
  intro.step = Math.max(0, Math.min(step, 4));
  render();
}

function pick(q, id) {
  intro.ans = { ...intro.ans, [q.id]: id };
  store.set(ansKey(), JSON.stringify({ ans: intro.ans }));
  render();
  // kurz zeigen, was gewählt ist, dann weiter
  const at = intro.step;
  clearTimeout(intro.timer);
  intro.timer = setTimeout(() => { if (intro.step === at && dlg().open) go(at + 1); }, ease);
}

function runTour() {
  clearTimeout(intro.timer);
  store.set(askedKey(), 'done');
  dlg().close();
  intro.deps.prepare();
  // Seite und Raster erst aufbauen lassen
  setTimeout(() => startTour(tourSteps(), { onEnd: () => finish() }), 300);
}

function finish() {
  intro.phase = 'done';
  render();
  const d = dlg();
  if (!d.open) d.showModal();
}

// ---------- Inhalte ----------
function planSteps() {
  const a = intro.ans;
  const yt = a.platform === 'youtube' || a.platform === 'both';
  return [
    a.exp === 'new' && { title: 'OBS einrichten', text: 'Eine Browserquelle, fertig – mit Bildern Schritt für Schritt.', where: 'OBS-Overlay · Anleitung' },
    { title: 'Overlay & Look wählen', text: 'Ein Komplett-Look aus der Design-Bibliothek, mit einem Klick.', where: 'Design-Bibliothek' },
    a.exp !== 'pro' && { title: 'Twitch verbinden', text: 'Damit Chat-Bot, Alerts und Kanalpunkte laufen.', where: 'Dein Start' },
    yt && { title: 'YouTube dazuschalten', text: 'Gleichzeitig auf YouTube live – der YouTube-Chat läuft im Overlay mit.', where: 'Twitch-Verbindung' },
    a.goal === 'grow' && { title: 'Zuschauer halten', text: 'Interaktive Ideen, Kanalpunkte und Chat-Befehle geben dem Chat etwas zu tun.', where: 'Content-Ideen' },
    a.goal === 'affiliate' && { title: 'Affiliate-Ziele im Blick', text: 'Twitch will 50 Follower, 500 Minuten an 7 Streamtagen und Ø 3 Zuschauer. Deine Streams siehst du in der Statistik.', where: 'Statistik' },
    a.goal === 'fun' && { title: 'Erste Content-Idee ausprobieren', text: 'Glücksrad, Bingo oder Quiz – sofort im Overlay.', where: 'Content-Ideen' },
    { title: 'Mods freigeben', text: 'Optional: Deine Mods steuern mit.', where: 'Kanal & Team' },
  ].filter(Boolean);
}

function tourSteps() {
  const a = intro.ans;
  const r = role();
  if (r === 'viewer') {
    return [
      { target: '#games-section', kind: 'look', title: 'Games', text: 'Wähle das Game – darunter stehen die passenden Content-Ideen. Ist der Stream live, ist das richtige Game schon ausgewählt.' },
      { target: '#next-departure', kind: 'look', title: 'Als Nächstes', text: 'Hier steht, was als Nächstes im Stream passiert – mit Countdown.' },
      { target: '#grid .tile', kind: 'look', title: 'Content-Ideen', text: 'Ein Klick auf eine Kachel zeigt, worum es geht – Glücksrad, Bingo, Verlosung, Hot Words und mehr.' },
      { target: '#acct-btn', kind: 'look', title: 'Kanal & Konto', text: 'Hier wechselst du zwischen den Streamern auf StreamHelp, stellst Hell/Dunkel ein und meldest dich ab.' },
    ];
  }
  const tile = document.querySelector('#grid .tile--wheel') ? '#grid .tile--wheel' : '#grid .tile:not(.tile--placeholder)';
  const wheel = tile.includes('wheel');
  return [
    { target: '#sidebar', kind: 'look', title: 'Alles an einem Ort', text: 'Links findest du jeden Bereich – von Content-Ideen über Alerts bis zur Design-Bibliothek. Mit „/“ suchst du direkt.' },
    r === 'streamer' && { target: '#start-slot', kind: 'look', title: 'Hier siehst du deinen Fortschritt',
      text: a.goal === 'affiliate' ? 'Dein Start führt dich durch die ersten Schritte bis zum ersten Stream. Erledigtes hakt sich von selbst ab – dann bleibt Zeit für die Affiliate-Ziele.' : 'Erledigte Schritte haken sich von selbst ab. Was fehlt, ist immer einen Klick entfernt.' },
    { target: '#obs-btn', kind: 'do', title: 'Klick auf „OBS-Overlay“', text: 'Eine Browserquelle in OBS reicht für alles: Alerts, Glücksrad, Ziele. Im OBS-Editor kopierst du die Adresse.', ok: 'Der OBS-Editor ist offen – dort kopierst du die Adresse und fügst sie in OBS als Browserquelle ein.' },
    { target: tile, kind: 'do',
      title: wheel ? (a.goal === 'grow' ? 'Halte den Chat in Bewegung' : 'Öffne das Glücksrad') : 'Öffne eine Content-Idee',
      text: a.goal === 'grow' ? 'Interaktive Ideen wie das Glücksrad halten Zuschauer länger im Stream. Klick drauf – gedreht wird erst, wenn du es willst.' : 'Content-Ideen laufen im Overlay. Klick auf die Kachel – im Fenster siehst du, was deine Zuschauer sehen würden.',
      ok: 'Da ist es. Schließ das Fenster, wenn du fertig bist.' },
    { target: '.sb-item[data-page="library"]', kind: 'look', title: 'Dein Look', text: 'In der Design-Bibliothek findest du Komplett-Looks, Overlays und Alerts – mit Vorschau und Vorher/Nachher.' },
    { target: '#tour-btn', kind: 'look', title: 'Jederzeit wieder', text: a.exp === 'pro' ? 'Hier startest du die Einführung neu – zum Beispiel, wenn ein Mod sie sehen soll.' : 'Hier findest du die Einführung wieder, wenn du etwas nachschauen willst.' },
  ].filter(Boolean);
}

function render() {
  const d = dlg();
  const r = role();
  const done = intro.phase === 'done';
  const total = asksQuestions() ? 5 : 1;
  const dots = h('div', { class: 'intro-dots', 'aria-hidden': 'true', hidden: done || total === 1 },
    ...Array.from({ length: total }, (_, i) => h('span', { class: `${i === intro.step ? 'is-on' : ''}${i <= intro.step ? ' is-past' : ''}` })));
  const top = h('div', { class: 'intro-top' },
    h('div', { class: 'intro-brand' }, h('img', { src: 'assets/favicon.svg', alt: '', width: '28', height: '28' }), h('span', {}, 'Stream', h('b', {}, 'help'))),
    h('div', { class: 'intro-top-right' }, dots,
      !done && h('button', { type: 'button', class: 'btn btn--ghost btn--sm intro-skip', onclick: runTour }, 'Überspringen'),
      h('button', { type: 'button', class: 'intro-close', 'aria-label': 'Einführung schließen', title: 'Schließen', onclick: () => d.close() }, icon('ph-x'))));
  const body = done ? doneView(r) : intro.step === 0 ? welcomeView(r) : intro.step <= 3 ? questionView(QUESTIONS[intro.step - 1]) : planView();
  d.replaceChildren(h('div', { class: 'intro-glow', 'aria-hidden': 'true' }), h('div', { class: 'intro-wrap' }, top, body));
  // Fokus auf die Überschrift, damit Screenreader den neuen Schritt vorlesen
  d.querySelector('.intro-title')?.focus({ preventScroll: true });
}

function welcomeView(r) {
  const name = intro.deps.userName();
  const streamer = r === 'streamer';
  const actions = h('div', { class: 'intro-actions' },
    h('button', { type: 'button', class: 'btn btn--primary intro-cta', onclick: () => (streamer ? go(1) : runTour()) },
      streamer ? 'Los geht’s' : 'Tour starten', icon('ph-arrow-right')),
    h('span', { class: 'intro-hint' }, `Dauert ca. ${streamer ? '1 Minute' : '30 Sekunden'} · jederzeit links unter „Einführung“`));
  return h('section', { class: 'intro-step intro-step--welcome' },
    h('div', { class: 'intro-head' },
      h('p', { class: 'intro-eyebrow is-acc' }, name ? `Willkommen, ${name}` : 'Willkommen'),
      h('h2', { class: 'intro-title intro-title--xl', id: 'intro-title', tabindex: '-1' },
        streamer ? 'Dein Stream, nur besser. In einer Minute bist du startklar.' : r === 'team' ? 'Schön, dass du mithilfst.' : 'Schön, dass du da bist.'),
      h('p', { class: 'intro-lead' }, streamer
        ? 'Drei kurze Fragen, dann zeigen wir dir genau die Stellen, die du brauchst – und du probierst sie direkt selbst aus.'
        : r === 'team'
          ? 'Wir zeigen dir die Werkzeuge, mit denen du den Stream mitsteuerst – und du probierst sie direkt selbst aus.'
          : 'In einer halben Minute zeigen wir dir, wo was ist: Games, Content-Ideen und dein Konto.')),
    streamer && h('div', { class: 'intro-promises' }, ...PROMISES.map(([ic, title, text]) => h('div', { class: 'intro-promise' },
      icon(ic), h('b', {}, title), h('span', {}, text)))),
    actions);
}

function questionView(q) {
  const chosen = intro.ans[q.id];
  return h('section', { class: 'intro-step' },
    h('div', { class: 'intro-head' },
      h('p', { class: 'intro-eyebrow' }, `Frage ${intro.step} von 3`),
      h('h2', { class: 'intro-title', id: 'intro-title', tabindex: '-1' }, q.title),
      h('p', { class: 'intro-lead' }, q.sub)),
    h('div', { class: 'intro-options', role: 'group', 'aria-labelledby': 'intro-title' }, ...q.options.map(([id, ic, label, text]) => h('button', {
      type: 'button', class: 'intro-option', 'aria-pressed': String(chosen === id), onclick: () => pick(q, id),
    }, icon(ic, 'intro-option-ico'), h('b', {}, label), h('span', {}, text), chosen === id && icon('ph-check-circle', 'intro-option-ok')))),
    h('div', { class: 'intro-actions' },
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => go(intro.step - 1) }, icon('ph-arrow-left'), 'Zurück'),
      h('button', { type: 'button', class: 'btn btn--primary', disabled: !chosen, onclick: () => go(intro.step + 1) }, 'Weiter', icon('ph-arrow-right'))));
}

function planView() {
  const a = intro.ans;
  const steps = planSteps();
  const yt = a.platform === 'youtube' || a.platform === 'both';
  return h('section', { class: 'intro-step' },
    h('div', { class: 'intro-head' },
      h('p', { class: 'intro-eyebrow is-acc' }, 'Dein Plan'),
      h('h2', { class: 'intro-title', id: 'intro-title', tabindex: '-1' }, a.exp === 'new'
        ? 'Wir fangen ganz vorne an – in deinem Tempo.'
        : a.exp === 'pro' ? 'Du kennst die Basics. Wir zeigen dir, was StreamHelp extra kann.' : 'Wir machen aus deinen ersten Streams ein festes Setup.'),
      h('div', { class: 'intro-tags' }, ...[a.exp, a.goal, a.platform].filter(Boolean).map((x) => h('span', { class: 'intro-tag' }, LABEL[x])))),
    h('ol', { class: 'intro-plan' }, ...steps.map((s, i) => h('li', {},
      h('span', { class: 'intro-plan-n', 'aria-hidden': 'true' }, String(i + 1)),
      h('div', {}, h('b', {}, s.title), h('span', {}, s.text)),
      h('small', {}, s.where)))),
    yt && h('p', { class: 'intro-note' }, icon('ph-info'), 'Kanalpunkte, Bits und Abos gibt es nur auf Twitch. YouTube schaltest du unter „Twitch-Verbindung → YouTube“ dazu.'),
    h('div', { class: 'intro-actions' },
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => go(3) }, icon('ph-arrow-left'), 'Zurück'),
      h('button', { type: 'button', class: 'btn btn--primary intro-cta', onclick: runTour }, icon('ph-cursor-click'), 'Tour starten – ich klicke selbst')));
}

function doneView(r) {
  const n = planSteps().length;
  const streamer = r === 'streamer';
  return h('section', { class: 'intro-step intro-step--done' },
    h('span', { class: 'intro-done-ico', 'aria-hidden': 'true' }, icon('ph-check')),
    h('h2', { class: 'intro-title intro-title--lg', id: 'intro-title', tabindex: '-1' }, 'Du kennst dich aus.'),
    h('p', { class: 'intro-lead' }, streamer
      ? `Als Nächstes wartet „Dein Start“ auf den Content-Ideen – dein Plan hat ${n} Schritte${intro.ans.goal === 'affiliate' ? ', die Affiliate-Ziele behältst du in der Statistik im Blick' : ''}. Die Einführung findest du jederzeit links unter „Einführung“.`
      : 'Die Einführung findest du jederzeit links unter „Einführung“. Viel Spaß im Stream!'),
    h('div', { class: 'intro-actions' },
      h('button', { type: 'button', class: 'btn btn--primary intro-cta', onclick: () => { dlg().close(); if (streamer) intro.deps.goStart(); } },
        icon(streamer ? 'ph-rocket-launch' : 'ph-check'), streamer ? 'Zu deinem Start' : 'Los geht’s'),
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { intro.phase = 'flow'; go(0); } }, icon('ph-arrow-counter-clockwise'), 'Nochmal ansehen')));
}
