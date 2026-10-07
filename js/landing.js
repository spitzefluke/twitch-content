// Startseite: Vorschau als kleine Szene (Alert kommt und geht, Glücksrad dreht und stoppt,
// Chat schreibt weiter, das Haustier läuft auf dem Laufband), Balken mit Live-Zahlen aus allen Streams,
// Abschnitte gleiten beim Scrollen herein, Tiefe (Parallaxe) und Fortschrittsbalken.
// Läuft nur, solange die Startseite zu sehen ist; ohne Bewegung (prefers-reduced-motion) steht alles still.
import { dinoSvg } from './pet.js';

const ALERTS = [
  { kind: 'sub', icon: 'ph-star', name: 'NightOwl_Mia', sub: 'hat abonniert · 3 Monate' },
  { kind: 'follow', icon: 'ph-heart', name: 'PixelPaul', sub: 'folgt jetzt' },
  { kind: 'bits', icon: 'ph-bell-ringing', name: 'GG_Gina', sub: 'hat 500 Bits geschickt' },
];
const WHEEL = ['Nur Schrotflinten', 'Keine Heilung', 'Nur graue Waffen', 'Landen in Tilted', 'Bauen verboten', 'Nur Pistole'];
const CHAT = [
  ['PixelPaul', '!join'],
  ['GG_Gina', '500 Bits für den Dino'],
  ['StreamHelpBot', '@PixelPaul du bist Platz 3', true],
  ['LootLukas', '!füttern'],
  ['NightOwl_Mia', 'Bingo! B-Reihe voll 🎉'],
  ['CrispyCarl', 'dreh das Rad!!'],
  ['StreamHelpBot', 'Rexi ist satt – danke LootLukas', true],
  ['Mia_Mods', 'Raid-Schutz ist aus, viel Spaß'],
];
const ALERT_EVERY = 4500;

// Balken „Auf einen Blick“: Zahlen aus allen Streams (public.platform_stats), alle 30 Sekunden neu.
// Gezeigt werden die ersten acht, die schon etwas zählen; „today“ = wie viele davon heute.
const STATS_EVERY = 30_000;
const STATS_MAX = 8;
const LIVE_STATS = [
  { key: 'streamers', label: 'Streamer bei StreamHelp', always: true, sub: (s) => (s.live > 0 ? `${fmt(s.live)} gerade live` : ''), dot: (s) => s.live > 0 },
  { key: 'viewers_now', label: 'Zuschauer gerade live', dot: () => true },
  { key: 'watch_hours', label: 'Watchtime gezählt', unit: 'Std' },
  { key: 'alerts', label: 'Alerts im Stream', today: 'alerts_today' },
  { key: 'spins', label: 'Glücksrad-Drehungen', today: 'spins_today' },
  { key: 'pranks', label: 'Streiche am Streamer', today: 'pranks_today' },
  { key: 'pet_moments', label: 'Haustier-Momente' },
  { key: 'hotwords', label: 'Hot Words im Chat' },
  { key: 'chat', label: 'Fragen & Ideen aus dem Chat', value: (s) => (s.questions ?? 0) + (s.ideas ?? 0) },
  { key: 'cards', label: 'Sammelkarten gezogen' },
  { key: 'quiz_answers', label: 'Quiz-Antworten' },
  { key: 'tts', label: 'Nachrichten vorgelesen' },
  { key: 'players', label: 'Zuschauer mitgespielt' },
  { key: 'winners', label: 'Verlosungs-Gewinner' },
  { key: 'viewers_total', label: 'Zuschauer gezählt' },
];
const fmt = (n) => Math.round(n).toLocaleString('de-DE');

let started = false;

// opts.stats: () => Promise<Zahlen | null>; opts.facts: [{ key, n, label, unit? }] – was in StreamHelp steckt
export function setupLanding(root, opts = {}) {
  if (started || !root) return;
  started = true;
  root.classList.add('nc-js');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const visible = () => !root.hidden && document.visibilityState === 'visible';

  statsBand(root, still, visible, opts);
  revealOnScroll(root, still);
  depth(root, still);
  if (!still) previewScene(root, visible);
}

// Abschnitte gleiten herein, sobald sie ins Bild kommen
function revealOnScroll(root, still) {
  const items = root.querySelectorAll('.nc-rv');
  if (still || !('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  items.forEach((el) => io.observe(el));
}

// Balken „Auf einen Blick“: zählt beim ersten Hinsehen von 0 hoch und danach bei jeder neuen Zahl
// vom alten zum neuen Wert. Ohne Live-Zahlen (Migration fehlt, keine Verbindung) zeigt er, was drin ist.
function statsBand(root, still, visible, { stats, facts = [] }) {
  const band = root.querySelector('[data-stats]');
  if (!band) return;
  const grid = band.querySelector('[data-stats-grid]');
  const chips = band.querySelector('[data-stats-facts]');
  const head = band.querySelector('[data-stats-head]');
  const when = band.querySelector('[data-stats-when]');
  const animate = !still && 'IntersectionObserver' in window;
  let seen = !animate;
  let data = null;
  let at = 0;
  let built = false;

  // Zahl von ihrem jetzigen Wert zum Ziel laufen lassen
  const count = (el, to, from) => {
    el.dataset.value = String(to);
    if (!seen) { el.textContent = '0'; return; }
    if (!animate || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const dur = from ? 900 : 1400;
    const tick = (t) => {
      if (el.dataset.value !== String(to)) return;   // schon wieder eine neuere Zahl
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(from + (to - from) * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if (from && to > from) {
      const item = el.closest('.nc-band-item');
      item?.classList.remove('is-bump');
      void item?.offsetWidth;
      item?.classList.add('is-bump');
    }
  };

  const itemEl = (it, i) => {
    const num = document.createElement('span');
    num.dataset.count = '';
    const p = document.createElement('p');
    p.className = 'nc-band-num';
    p.append(num);
    if (it.unit) {
      const small = document.createElement('small');
      small.textContent = ` ${it.unit}`;
      p.append(small);
    }
    const label = document.createElement('p');
    label.className = 'nc-band-label';
    label.textContent = it.label;
    const sub = document.createElement('p');
    sub.className = 'nc-band-sub';
    const box = document.createElement('div');
    box.className = `nc-band-item nc-rv${built ? ' is-in is-new' : ''}`;
    box.style.setProperty('--i', String(i % 4));
    box.dataset.key = it.key;
    box.append(p, label, sub);
    return box;
  };

  // Liste fürs Raster: Live-Zahlen (falls da), aufgefüllt mit dem, was drin ist; Rest als Kärtchen darunter
  const items = () => {
    const live = data ? LIVE_STATS
      .map((d) => ({ ...d, n: Number(d.value ? d.value(data) : data[d.key]) || 0 }))
      .filter((d) => d.always || d.n > 0)
      .slice(0, STATS_MAX)
      .map((d) => ({ key: d.key, n: d.n, label: d.label, unit: d.unit,
        sub: d.sub ? d.sub(data) : d.today && data[d.today] > 0 ? `+${fmt(data[d.today])} heute` : '',
        dot: !!d.dot?.(data) })) : [];
    const fill = Math.max(0, 4 - live.length);
    return { grid: [...live, ...facts.slice(0, fill)], rest: facts.slice(fill) };
  };

  const render = () => {
    const { grid: list, rest } = items();
    const old = new Map([...grid.querySelectorAll('.nc-band-item')].map((el) => [el.dataset.key, el]));
    const same = old.size === list.length && list.every((it) => old.has(it.key));
    const nodes = list.map((it, i) => (same ? old.get(it.key) : old.get(it.key) ?? itemEl(it, i)));
    if (!same) grid.replaceChildren(...nodes);
    list.forEach((it, i) => {
      const el = nodes[i];
      const num = el.querySelector('[data-count]');
      count(num, it.n, Number(num.dataset.value ?? 0) || 0);
      const sub = el.querySelector('.nc-band-sub');
      sub.textContent = it.sub ?? '';
      sub.hidden = !it.sub;
      el.classList.toggle('has-dot', !!it.dot);
    });
    chips.replaceChildren(...rest.map((f) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = `${fmt(f.n)}${f.unit ? ` ${f.unit}` : ''}`;
      li.append(b, ` ${f.label}`);
      return li;
    }));
    chips.hidden = !rest.length;
    head.hidden = !data;
    built = true;
  };

  const ago = () => {
    if (!at) return;
    const s = Math.round((Date.now() - at) / 1000);
    when.textContent = s < 10 ? 'gerade aktualisiert' : s < 60 ? `vor ${s} s` : `vor ${Math.floor(s / 60)} Min`;
  };

  render();
  if (animate) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      seen = true;
      grid.querySelectorAll('[data-count]').forEach((el) => count(el, Number(el.dataset.value) || 0, 0));
    }, { threshold: 0.4 });
    io.observe(band);
  }
  if (!stats) return;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    for (;;) {
      while (!visible()) await wait(1000);
      try {
        const d = await stats();
        if (d) { data = d; at = Date.now(); render(); ago(); }
      } catch { /* letzte Zahlen bleiben stehen */ }
      for (let t = 0; t < STATS_EVERY; t += 5000) { await wait(5000); ago(); }
    }
  })();
}

// Tiefe: Fortschrittsbalken oben, die Vorschau bewegt sich langsamer als die Seite, der Hintergrund noch langsamer
function depth(root, still) {
  const bar = root.querySelector('.nc-progress');
  const layers = [...root.querySelectorAll('[data-parallax]')];
  let queued = false;
  const update = () => {
    queued = false;
    if (root.hidden) return;
    const y = scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar?.style.setProperty('--p', max > 0 ? (y / max).toFixed(4) : '0');
    if (still) return;
    root.style.setProperty('--sy', String(Math.round(y)));
    for (const el of layers) el.style.setProperty('--py', `${(y * Number(el.dataset.parallax)).toFixed(1)}px`);
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();
}

// Die Vorschau als Szene
function previewScene(root, visible) {
  const stage = root.querySelector('[data-pv]');
  if (!stage) return;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async () => { while (!visible()) await wait(800); };

  // Haustier auf dem Laufband
  const pet = stage.querySelector('[data-pv-pet]');
  if (pet) {
    pet.innerHTML = `<div class="dino is-walking" data-species="dino"><div class="dino-pose"><div class="dino-grow"><div class="dino-body">${dinoSvg('schaffner', 'dino')}</div></div></div></div>`;
    const size = () => stage.style.setProperty('--stage-w', `${stage.clientWidth}px`);
    size();
    if ('ResizeObserver' in window) new ResizeObserver(size).observe(stage);
  }

  // Alert: kommt, steht, geht – alle 4,5 Sekunden, drei Arten im Wechsel
  const alert = stage.querySelector('[data-pv-alert]');
  (async () => {
    let n = 0;
    for (;;) {
      await until();
      const a = ALERTS[n++ % ALERTS.length];
      alert.dataset.kind = a.kind;
      alert.querySelector('.ph').className = `ph ${a.icon}`;
      alert.querySelector('[data-pv-alert-name]').textContent = a.name;
      alert.querySelector('[data-pv-alert-sub]').textContent = a.sub;
      alert.style.setProperty('--dur', `${(ALERT_EVERY - 900) / 1000}s`);
      alert.classList.remove('is-out', 'is-in');
      void alert.offsetWidth;
      alert.classList.add('is-in');
      await wait(ALERT_EVERY - 900);
      alert.classList.replace('is-in', 'is-out');
      await wait(900);
    }
  })();

  // Glücksrad: ausholen, drehen, auf einem Ergebnis stehen bleiben
  const wheel = stage.querySelector('[data-pv-wheel]');
  const disc = wheel.querySelector('.nc-pv-disc');
  const result = wheel.querySelector('[data-pv-result]');
  (async () => {
    let rot = 0;
    for (;;) {
      await wait(2600);
      await until();
      wheel.classList.remove('is-done');
      wheel.classList.add('is-spinning');
      result.textContent = 'Dreht …';
      const windUp = rot - 25;
      const target = windUp + 1080 + Math.floor(Math.random() * 360);
      await disc.animate([{ transform: `rotate(${rot}deg)` }, { transform: `rotate(${windUp}deg)` }], { duration: 380, easing: 'cubic-bezier(.3, 0, .4, 1)', fill: 'forwards' }).finished;
      await disc.animate([{ transform: `rotate(${windUp}deg)` }, { transform: `rotate(${target}deg)` }], { duration: 2600, easing: 'cubic-bezier(.15, .6, .15, 1)', fill: 'forwards' }).finished;
      rot = target % 360;
      disc.getAnimations().forEach((an) => an.cancel());
      disc.style.setProperty('--rot', `${rot}deg`);
      wheel.classList.replace('is-spinning', 'is-done');
      result.textContent = WHEEL[Math.floor(Math.random() * WHEEL.length)];
      await wait(3200);
    }
  })();

  // Chat schreibt weiter (höchstens vier Zeilen)
  const chat = stage.querySelector('[data-pv-chat]');
  (async () => {
    let n = 0;
    for (;;) {
      await until();
      const [who, text, bot] = CHAT[n++ % CHAT.length];
      const line = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = who;
      if (bot) { b.className = 'nc-bot'; line.className = 'nc-muted'; }
      line.append(b, ` ${text}`);
      chat.append(line);
      const lines = [...chat.children].filter((l) => !l.classList.contains('is-old'));
      if (lines.length > 4) {
        lines[0].classList.add('is-old');
        setTimeout(() => lines[0].remove(), 400);
      }
      await wait(1700 + Math.random() * 1300);
    }
  })();
}
