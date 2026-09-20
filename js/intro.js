// Intro "Nachtbahnhof": eine Bühne von 3000 × 1000 Punkten, über die eine Kamera
// fährt. Der Zug rollt ein, die Abfahrtstafel blättert auf, die Uhr springt auf
// Abfahrtszeit, das Signal zeigt Grün und die Türen öffnen sich.
// Alle Zeiten sind Anteile der Gesamtlänge (0 = Start, 1 = Ende), Länge: js/config.js.
import { IntroSound } from './sound.js';

const TITLE = 'ZUGFAHRER_DAVETV';
const SUB = 'Content-Stellwerk · Bitte einsteigen';
const ANNOUNCEMENT = 'Auf Gleis eins: das Content-Stellwerk von Zugfahrer Dave T V. Bitte einsteigen und Türen schließen!';
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_·';
const DEPART = '20:15';

// Kamera: [Anteil, Blickpunkt X, Blickpunkt Y, Zoom]
const CAM = [
  [0.00, 1900, 470, 0.72],
  [0.12, 2060, 500, 0.76],
  [0.22, 2060, 560, 0.76],
  [0.32, 1520, 640, 0.95],
  [0.42, 1160, 656, 1.04],
  [0.50, 1280, 250, 0.78],
  [0.68, 1280, 236, 0.84],
  [0.745, 520, 330, 1.12],
  [0.805, 520, 330, 1.20],
  [0.845, 2250, 440, 0.92],
  [0.885, 1396, 690, 1.12],
  [0.95, 1396, 692, 2.80],
  [1.00, 1396, 692, 7.20],
];

const BEATS = [
  [0.00, 'Nachtbahnhof · Halt zeigt Rot'],
  [0.20, 'Einfahrt Gleis 1'],
  [0.48, 'Abfahrtstafel'],
  [0.72, 'Bahnsteiguhr · Gong'],
  [0.84, 'Ausfahrt frei · Türen öffnen'],
];

const clamp = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, x) => a + (b - a) * x;
const pad = (n) => String(n).padStart(2, '0');

function sampleCam(p) {
  for (let i = 0; i < CAM.length - 1; i++) {
    const [t0, x0, y0, s0] = CAM[i];
    const [t1, x1, y1, s1] = CAM[i + 1];
    if (p <= t1 || i === CAM.length - 2) {
      const k = smooth(clamp((p - t0) / (t1 - t0)));
      return { x: lerp(x0, x1, k), y: lerp(y0, y1, k), s: lerp(s0, s1, k) };
    }
  }
  return { x: CAM[0][1], y: CAM[0][2], s: CAM[0][3] };
}

export function playIntro({ duration = 18000 } = {}) {
  const root = document.getElementById('intro');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel) => root.querySelector(sel);

  const camera = $('#intro-camera');
  const train = $('#st-train');
  const headlight = $('#tr-headlight');
  const brake = $('#tr-brake');
  const board = $('#st-board');
  const sub = $('#flap-sub');
  const ticker = $('#board-ticker');
  const doorLeft = $('#door-left');
  const doorRight = $('#door-right');
  const interior = $('#door-interior');
  const hourHand = $('#clock-hour');
  const minHand = $('#clock-min');
  const fade = $('#intro-fade');
  const progress = $('#intro-progress');
  const beatNo = $('#beat-no');
  const beatLabel = $('#beat-label');
  const soundBtn = $('#intro-sound');
  $('#board-time').textContent = DEPART;

  const cells = [...TITLE].map(() => {
    const cell = document.createElement('span');
    cell.className = 'flap';
    cell.setAttribute('aria-hidden', 'true');
    $('#flap-title').append(cell);
    return cell;
  });

  const now = new Date();
  let jumped = false;
  let greenOn = false;
  let lastBeat = -1;
  setHands(now.getHours() * 30 + now.getMinutes() * 0.5, now.getMinutes() * 6, false);

  function setHands(hour, minute, animate) {
    for (const [hand, angle] of [[hourHand, hour], [minHand, minute]]) {
      hand.style.transition = animate ? 'transform .5s cubic-bezier(.34,1.4,.64,1)' : 'none';
      hand.style.transform = `rotate(${angle}deg)`;
    }
  }

  // ---------- Ton ----------
  const sound = new IntroSound();
  const cues = [
    { at: 0.13, done: false, play: () => sound.whoosh(Math.min(4.4, duration * 0.00026)) },
    { at: 0.60, done: false, play: () => sound.speak(ANNOUNCEMENT) },
    { at: 0.72, done: false, play: () => sound.chime() },
  ];
  const setSoundLabel = (state) => {
    soundBtn.dataset.state = state;
    soundBtn.textContent = state === 'on' ? 'Ton aus' : state === 'blocked' ? 'Ton einschalten' : 'Ton an';
    soundBtn.setAttribute('aria-pressed', String(state === 'on'));
  };
  const startSound = async () => {
    const ok = await sound.enable();
    setSoundLabel(ok ? 'on' : sound.wanted ? 'blocked' : 'off');
    return ok;
  };
  soundBtn.addEventListener('click', async () => {
    if (soundBtn.dataset.state === 'on') {
      sound.wanted = false;
      sound.stop();
      setSoundLabel('off');
    } else {
      sound.wanted = true;
      await startSound();
    }
  });
  startSound();

  // ---------- Ablauf ----------
  return new Promise((resolve) => {
    const started = performance.now();
    let raf = 0;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      sound.stop();
      document.removeEventListener('keydown', onKey);
      root.classList.add('is-out');
      setTimeout(() => { root.remove(); resolve(); }, 600);
    };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(); };
    document.addEventListener('keydown', onKey);
    $('.intro-skip').addEventListener('click', finish);

    if (reduced) {
      // Ruhige Fassung: Endbild zeigen, kein Schwenk
      frame(0.62);
      setTimeout(finish, Math.min(duration, 6000));
      return;
    }

    const step = (t) => {
      const p = clamp((t - started) / duration);
      frame(p);
      if (p >= 1) { finish(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    function frame(p) {
      const cam = sampleCam(p);
      camera.style.transform = `scale(${cam.s.toFixed(4)}) translate(${(-cam.x).toFixed(1)}px, ${(-cam.y).toFixed(1)}px)`;

      // Zug rollt ein und bremst
      const trainK = smooth(clamp((p - 0.14) / 0.26));
      train.style.transform = `translateX(${lerp(3300, 520, trainK).toFixed(1)}px)`;
      headlight.style.opacity = String(clamp((p - 0.07) / 0.06) * (1 - smooth(clamp((p - 0.3) / 0.1))) * 0.9);
      brake.style.opacity = String(clamp((p - 0.26) / 0.06) * (1 - smooth(clamp((p - 0.44) / 0.1))) * 0.55);

      // Abfahrtstafel
      const boardK = smooth(clamp((p - 0.455) / 0.055));
      board.style.opacity = String(boardK);
      board.style.transform = `translateY(${((1 - boardK) * 22).toFixed(1)}px)`;

      // Fallblätter
      const flapStart = 0.5;
      for (let i = 0; i < cells.length; i++) {
        const stop = flapStart + 0.0075 * i + 0.085;
        const cell = cells[i];
        if (p < flapStart) { cell.textContent = ' '; cell.classList.remove('settled'); continue; }
        if (p >= stop) {
          if (!cell.classList.contains('settled')) { cell.textContent = TITLE[i]; cell.classList.add('settled'); }
        } else {
          cell.textContent = CHARS[(Math.floor(p * 1400) + i * 7) % CHARS.length];
        }
      }

      sub.textContent = p >= 0.615 ? SUB.slice(0, Math.max(0, Math.round((p - 0.615) / 0.09 * SUB.length))) : '';
      ticker.hidden = p < 0.70;

      // Uhr springt auf Abfahrtszeit, Signal auf Grün, Türen auf
      if (!jumped && p >= 0.752) { jumped = true; setHands(20 * 30 + 15 * 0.5, 15 * 6, true); }
      if (!greenOn && p >= 0.826) { greenOn = true; root.classList.add('is-clear'); }
      const doorK = smooth(clamp((p - 0.862) / 0.075));
      doorLeft.style.transform = `translateX(${(-100 * doorK).toFixed(1)}%)`;
      doorRight.style.transform = `translateX(${(100 * doorK).toFixed(1)}%)`;
      interior.style.opacity = String(doorK);

      fade.style.opacity = String(smooth(clamp((p - 0.915) / 0.085)));
      progress.style.width = `${(p * 100).toFixed(2)}%`;

      const beatIndex = BEATS.reduce((acc, b, i) => (p >= b[0] ? i : acc), 0);
      if (beatIndex !== lastBeat) {
        lastBeat = beatIndex;
        beatNo.textContent = pad(beatIndex + 1);
        beatLabel.textContent = BEATS[beatIndex][1];
      }

      for (const cue of cues) {
        if (!cue.done && p >= cue.at) { cue.done = true; cue.play(); }
      }
    }
  });
}
