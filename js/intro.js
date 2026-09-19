// 10-Sekunden-Intro: Signal springt auf Grün, der Zug fährt durch,
// dann blättert die Abfahrtstafel "ZUGFAHRER_DAVETV" auf.
// Dazu Bahnhofs-Gong und Durchsage (siehe sound.js).
import { IntroSound } from './sound.js';

const TITLE = 'ZUGFAHRER_DAVETV';
const SUB = 'Content-Stellwerk · Bitte einsteigen';
const ANNOUNCEMENT = 'Auf Gleis eins: das Content-Stellwerk von Zugfahrer Dave T V. Bitte einsteigen und Türen schließen!';
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_·';

export function playIntro({ duration = 10000 } = {}) {
  const root = document.getElementById('intro');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.style.setProperty('--intro-duration', `${duration}ms`);

  const now = new Date();
  root.querySelector('#intro-clock').textContent =
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const row = root.querySelector('#flap-title');
  const cells = [...TITLE].map(() => {
    const cell = document.createElement('span');
    cell.className = 'flap';
    cell.setAttribute('aria-hidden', 'true');
    row.append(cell);
    return cell;
  });
  const sub = root.querySelector('#flap-sub');

  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));

  const boardAt = reduced ? 200 : Math.round(duration * 0.47);
  const sound = new IntroSound();
  const soundBtn = root.querySelector('#intro-sound');
  const started = performance.now();
  const cues = [
    { t: 150, done: false, play: () => sound.chime() },
    { t: 1900, done: false, play: () => sound.whoosh(2.6) },
    { t: boardAt + 700, done: false, play: () => sound.speak(ANNOUNCEMENT) },
  ];

  const setSoundLabel = (state) => {
    soundBtn.dataset.state = state;
    soundBtn.textContent = state === 'on' ? 'Ton aus' : state === 'blocked' ? 'Ton einschalten' : 'Ton an';
    soundBtn.setAttribute('aria-pressed', String(state === 'on'));
  };

  const scheduleCues = () => {
    const elapsed = performance.now() - started;
    for (const cue of cues) {
      if (cue.done) continue;
      if (cue.t > elapsed) {
        cue.done = true;
        at(cue.t - elapsed, cue.play);
      } else if (cue.t > elapsed - 2500) {
        // knapp verpasst: sofort nachholen, damit es nicht still bleibt
        cue.done = true;
        cue.play();
      } else {
        cue.done = true;
      }
    }
  };

  const startSound = async () => {
    const ok = await sound.enable();
    setSoundLabel(ok ? 'on' : sound.wanted ? 'blocked' : 'off');
    if (ok) scheduleCues();
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

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      sound.stop();
      document.removeEventListener('keydown', onKey);
      root.classList.add('is-out');
      setTimeout(() => { root.remove(); resolve(); }, 700);
    };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(); };
    document.addEventListener('keydown', onKey);
    root.querySelector('.intro-skip').addEventListener('click', finish);

    at(boardAt, () => flipIn(cells, reduced, at));
    at(boardAt + (reduced ? 300 : 1900), () => typeIn(sub, SUB, at));
    at(duration - 700, finish);
  });
}

function flipIn(cells, reduced, at) {
  cells.forEach((cell, i) => {
    const final = TITLE[i];
    if (reduced) { cell.textContent = final; cell.classList.add('settled'); return; }
    const stop = 380 + i * 75;
    let t = 0;
    const step = () => {
      if (t >= stop) {
        cell.textContent = final;
        cell.classList.add('settled');
        return;
      }
      cell.textContent = CHARS[Math.floor(Math.random() * CHARS.length)];
      cell.classList.remove('tick');
      void cell.offsetWidth; // Animation neu starten
      cell.classList.add('tick');
      t += 55;
      at(55, step);
    };
    step();
  });
}

function typeIn(el, text, at) {
  [...text].forEach((_, i) => at(i * 32, () => { el.textContent = text.slice(0, i + 1); }));
}
