// Intro: eine einzige Kamerafahrt über eine 3000 × 1000 große Bühne.
//
//   Nachtbahnhof (Halt zeigt Rot) → Einfahrt auf Gleis 1 → Abfahrtstafel
//   blättert "ZUGFAHRER_DAVETV" auf → Bahnsteiguhr springt auf 20:15 (Gong
//   und Durchsage) → Signal auf Grün, Türen öffnen → Überblendung.
//
// Alles hängt am Fortschritt p (0 … 1). Die Länge steht in js/config.js.
// Das Bühnenbild selbst steht in index.html, die Maße in css/style.css.
import { IntroSound } from './sound.js';

const TITLE = 'ZUGFAHRER_DAVETV';
const SUB = 'Content-Stellwerk · Bitte einsteigen';
const ANNOUNCEMENT = 'Auf Gleis eins: das Content-Stellwerk von Zugfahrer Dave T V. Bitte einsteigen und Türen schließen!';
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_·';
const DEPART = '20:15';
const TICKER = 'Nächste Halte: <b>Fortnite-Glücksrad</b> · Nachtschicht Güterzug · Community-Cup · Geisterzug-Special · Subathon · <b>Content-Stellwerk</b> · Bitte alle einsteigen …';

// Kamera: [p, Blickpunkt-X, Blickpunkt-Y, Zoom] in Bühnen-Koordinaten
const CAM = [
  [0.000, 1900, 470, 0.72],
  [0.120, 2060, 500, 0.76],
  [0.220, 2060, 560, 0.76],
  [0.320, 1520, 640, 0.95],
  [0.420, 1160, 656, 1.04],
  [0.500, 1280, 250, 0.78],
  [0.680, 1280, 236, 0.84],
  [0.745, 520, 330, 1.12],
  [0.805, 520, 330, 1.20],
  [0.845, 2250, 440, 0.92],
  [0.885, 1396, 690, 1.12],
  [0.950, 1396, 692, 2.80],
  [1.000, 1396, 692, 7.20],
];

const BEATS = [
  [0.00, 'Nachtbahnhof · Halt zeigt Rot'],
  [0.20, 'Einfahrt Gleis 1'],
  [0.48, 'Abfahrtstafel'],
  [0.72, 'Bahnsteiguhr · Gong'],
  [0.84, 'Ausfahrt frei · Türen öffnen'],
];

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, x) => a + (b - a) * x;
// Weicher Anstieg von 0 auf 1 zwischen start und start + span
const ramp = (p, start, span) => smooth(clamp01((p - start) / span));

function sampleCam(p) {
  for (let i = 0; i < CAM.length - 1; i++) {
    const [t0, x0, y0, s0] = CAM[i];
    const [t1, x1, y1, s1] = CAM[i + 1];
    if (p <= t1 || i === CAM.length - 2) {
      const k = smooth(clamp01((p - t0) / (t1 - t0)));
      return { x: lerp(x0, x1, k), y: lerp(y0, y1, k), s: lerp(s0, s1, k) };
    }
  }
  return { x: CAM[0][1], y: CAM[0][2], s: CAM[0][3] };
}

export function playIntro({ duration = 20000 } = {}) {
  const root = document.getElementById('intro');
  const el = (id) => root.querySelector(`#${id}`);

  const camera = el('intro-camera');
  const train = el('intro-train');
  const headlight = el('train-headlight');
  const brake = el('train-brake');
  const board = el('intro-board');
  const sub = el('flap-sub');
  const ticker = el('board-ticker');
  const hourHand = el('clock-hour');
  const minHand = el('clock-min');
  const red = el('signal-red');
  const green = el('signal-green');
  const doorLeft = el('door-left');
  const doorRight = el('door-right');
  const interior = el('door-interior');
  const fade = el('intro-fade');
  const beatNo = el('intro-beat-no');
  const beatLabel = el('intro-beat-label');
  const progress = el('intro-progress-bar');

  el('intro-clock').textContent = DEPART;
  ticker.firstElementChild.innerHTML = TICKER;

  const flaps = [...TITLE].map(() => {
    const cell = document.createElement('span');
    cell.className = 'flap';
    cell.setAttribute('aria-hidden', 'true');
    el('flap-title').append(cell);
    return cell;
  });

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sound = new IntroSound();
  const soundBtn = el('intro-sound');

  return new Promise((resolve) => {
    let timer = null;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(timer);
      sound.stop();
      document.removeEventListener('keydown', onKey);
      root.classList.add('is-out');
      setTimeout(() => { root.remove(); resolve(); }, 700);
    };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(); };
    document.addEventListener('keydown', onKey);
    root.querySelector('.intro-skip').addEventListener('click', finish);

    // Bei reduzierter Bewegung gibt es keine Kamerafahrt: einmal die Tafel
    // zeigen, dann direkt weiter zur Seite.
    if (reduced) {
      render(0.62);
      flaps.forEach((cell, i) => { cell.textContent = TITLE[i]; cell.classList.add('settled'); });
      sub.textContent = SUB;
      setTimeout(finish, 1200);
      return;
    }

    setupSound();
    const cues = { whoosh: false, gong: false, speak: false };
    const started = performance.now();

    const tick = () => {
      const p = clamp01((performance.now() - started) / duration);
      if (p >= 0.18 && !cues.whoosh) { cues.whoosh = true; sound.whoosh(Math.min(5.2, duration * 0.00026)); }
      if (p >= 0.745 && !cues.gong) { cues.gong = true; sound.chime(); }
      if (p >= 0.80 && !cues.speak) { cues.speak = true; sound.speak(ANNOUNCEMENT); }
      render(p);
      if (p >= 1) finish();
    };
    // Intervall statt requestAnimationFrame: läuft auch in Hintergrund-Tabs
    // weiter, sodass das Intro nicht stehen bleibt.
    timer = setInterval(tick, 1000 / 60);
    tick();

    function setupSound() {
      const label = (state) => {
        soundBtn.dataset.state = state;
        soundBtn.textContent = state === 'on' ? 'Ton aus' : state === 'blocked' ? 'Ton blockiert' : 'Ton einschalten';
        soundBtn.setAttribute('aria-pressed', String(state === 'on'));
      };
      const start = async () => {
        const ok = await sound.enable();
        label(ok ? 'on' : sound.wanted ? 'blocked' : 'off');
      };
      soundBtn.addEventListener('click', () => {
        if (soundBtn.dataset.state === 'on') {
          sound.wanted = false;
          sound.stop();
          label('off');
        } else {
          sound.wanted = true;
          start();
        }
      });
      start();
    }
  });

  function render(p) {
    // ---- Kamera ----
    const cam = sampleCam(p);
    camera.style.transform = `scale(${cam.s.toFixed(4)}) translate(${(-cam.x).toFixed(1)}px, ${(-cam.y).toFixed(1)}px)`;

    // ---- Zug rollt ein und bremst ----
    train.style.transform = `translateX(${lerp(3300, 520, ramp(p, 0.14, 0.26)).toFixed(1)}px)`;
    headlight.style.opacity = (clamp01((p - 0.07) / 0.06) * (1 - ramp(p, 0.3, 0.1)) * 0.9).toFixed(3);
    brake.style.opacity = (clamp01((p - 0.26) / 0.06) * (1 - ramp(p, 0.44, 0.1)) * 0.55).toFixed(3);

    // ---- Abfahrtstafel ----
    const boardK = ramp(p, 0.455, 0.055);
    board.style.opacity = boardK.toFixed(3);
    board.style.transform = `translateY(${((1 - boardK) * 22).toFixed(1)}px)`;
    ticker.classList.toggle('is-on', boardK > 0.9);

    // ---- Fallblätter ----
    const roll = Math.floor(p * 1400);
    flaps.forEach((cell, i) => {
      const on = p >= 0.50;
      const settled = p >= 0.50 + 0.0075 * i + 0.085;
      const ch = !on ? '' : settled ? TITLE[i] : CHARS[(roll + i * 7) % CHARS.length];
      if (cell.textContent !== ch) cell.textContent = ch;
      cell.classList.toggle('settled', settled);
    });

    const typed = p < 0.615 ? '' : SUB.slice(0, Math.max(0, Math.round((p - 0.615) / 0.09 * SUB.length)));
    if (sub.textContent !== typed) sub.textContent = typed;

    // ---- Bahnsteiguhr: springt zur Abfahrtszeit ----
    const jumped = p >= 0.752;
    const now = new Date();
    const hour = jumped ? 20 * 30 + 15 * 0.5 : now.getHours() * 30 + now.getMinutes() * 0.5;
    const minute = jumped ? 15 * 6 : now.getMinutes() * 6;
    hourHand.style.transform = `rotate(${hour}deg)`;
    minHand.style.transform = `rotate(${minute}deg)`;
    hourHand.classList.toggle('is-jumped', jumped);
    minHand.classList.toggle('is-jumped', jumped);

    // ---- Signal & Türen ----
    const greenOn = p >= 0.826;
    red.classList.toggle('is-off', greenOn);
    green.classList.toggle('is-on', greenOn);

    const doorK = ramp(p, 0.862, 0.075);
    doorLeft.style.transform = `translateX(${(-100 * doorK).toFixed(1)}%)`;
    doorRight.style.transform = `translateX(${(100 * doorK).toFixed(1)}%)`;
    interior.style.opacity = doorK.toFixed(3);

    // ---- Überblendung, Kapitel, Fortschritt ----
    fade.style.opacity = ramp(p, 0.915, 0.085).toFixed(3);
    progress.style.width = `${(p * 100).toFixed(2)}%`;

    const beat = BEATS.filter(([t]) => p >= t).pop() ?? BEATS[0];
    beatNo.textContent = `0${BEATS.indexOf(beat) + 1}`;
    beatLabel.textContent = beat[1];
  }
}
