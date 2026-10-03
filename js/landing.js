// Startseite: Vorschau als kleine Szene (Alert kommt und geht, Glücksrad dreht und stoppt,
// Chat schreibt weiter, das Haustier läuft auf dem Laufband), Zahlen zählen hoch,
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

let started = false;

export function setupLanding(root) {
  if (started || !root) return;
  started = true;
  root.classList.add('nc-js');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const visible = () => !root.hidden && document.visibilityState === 'visible';

  revealOnScroll(root, still);
  countUp(root, still);
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

// Zahlen im Band zählen hoch, wenn man hinscrollt
function countUp(root, still) {
  const nums = root.querySelectorAll('[data-count]');
  if (still || !('IntersectionObserver' in window)) return;
  nums.forEach((el) => { el.textContent = '0'; });
  const run = (el) => {
    const end = Number(el.dataset.count);
    const t0 = performance.now();
    const dur = 1400;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = String(Math.round(end * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      run(e.target);
      io.unobserve(e.target);
    }
  }, { threshold: 0.6 });
  nums.forEach((el) => io.observe(el));
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
