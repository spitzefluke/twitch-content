// Intro v2 aus Claude Design: eine durchgehende Reise durch die Nacht –
// Berge → Tunnel → Frontal aus dem Tunnel → Einfahrt → Tafel → Signal → Einstieg.
//
// Das Bild selbst steht in js/intro-scene.js (1920 × 1080, reine Funktion der
// Zeit), js/intro-engine.js zeichnet es ohne React. Hier läuft die Uhr, dazu
// Wetter-Schild, Fortschritt und Überspringen (Esc, Enter, Leertaste, Klick).
import { patch, setTime, cuesOf } from './intro-engine.js';
import { DAY_LABEL, Piece, SCENES } from './intro-scene.js';
import { daypart, getGermanyConditions } from './weather.js';

const W = 1920;
const H = 1080;
const TWEAKS = { title: 'ZUGFAHRER_DAVETV', weather: 'auto', daypart: 'auto' };

export function playIntro() {
  const root = document.getElementById('intro');
  const stage = root.querySelector('.intro-stage');
  const weather = root.querySelector('#intro-weather');
  const bar = root.querySelector('#intro-progress-bar');
  const { cues, total } = cuesOf(SCENES);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Wetter in Deutschland (Mitte) – bis es da ist: klarer Himmel zur Tageszeit von jetzt
  const live = { kind: 'clear', label: 'Wetter wird geladen', temp: null, daypart: daypart() };
  const paintWeather = () => {
    weather.lastElementChild.textContent = ['Deutschland', live.label, live.temp != null ? `${live.temp} °C` : null, DAY_LABEL[live.daypart]]
      .filter(Boolean).join(' · ');
  };
  paintWeather();
  getGermanyConditions().then((c) => {
    Object.assign(live, { kind: c.kind, label: c.label, temp: c.temperature, daypart: c.daypart });
    paintWeather();
  });

  // Die Bühne füllt das Fenster (wie ein Film: am Rand wird beschnitten)
  const fit = () => {
    const s = Math.max(innerWidth / W, innerHeight / H);
    stage.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`;
  };
  fit();
  addEventListener('resize', fit);

  let tree = [];
  const draw = (T) => {
    setTime(T);
    const next = [Piece({ T, cues, time: T, authoredTotal: total, tweaks: TWEAKS, live })];
    patch(stage, tree, next);
    tree = next;
    bar.style.width = `${(T / total) * 100}%`;
  };

  return new Promise((resolve) => {
    let frame = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      removeEventListener('resize', fit);
      document.removeEventListener('keydown', onKey);
      root.classList.add('is-out');
      setTimeout(() => { root.remove(); resolve(); }, 700);
    };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(); };
    document.addEventListener('keydown', onKey);
    root.querySelector('.intro-skip').addEventListener('click', finish);

    // Weniger Bewegung gewünscht: ein ruhiges Bild von der Tafel, dann weiter
    if (reduced) {
      draw(cues.Signal + 1);
      setTimeout(finish, 1600);
      return;
    }

    const started = performance.now();
    const tick = (now) => {
      const T = Math.min(total, (now - started) / 1000);
      draw(T);
      if (T >= total) finish();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  });
}
