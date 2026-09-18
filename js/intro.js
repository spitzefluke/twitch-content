// 10-Sekunden-Intro: Signal springt auf Grün, der Zug fährt durch,
// dann blättert die Abfahrtstafel "ZUGFAHRER_DAVETV" auf.
const TITLE = 'ZUGFAHRER_DAVETV';
const SUB = 'Content-Stellwerk · Bitte einsteigen';
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

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      document.removeEventListener('keydown', onKey);
      root.classList.add('is-out');
      setTimeout(() => { root.remove(); resolve(); }, 700);
    };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(); };
    document.addEventListener('keydown', onKey);
    root.querySelector('.intro-skip').addEventListener('click', finish);

    const boardAt = reduced ? 200 : Math.round(duration * 0.47);
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
