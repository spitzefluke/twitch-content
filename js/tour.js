// Kurze Einführung: hebt Schritt für Schritt eine Stelle der Seite hervor (Spotlight) und erklärt sie.
// startTour([{ target: '#selector' | null, title, text }], { onEnd }) – Schritte, deren Ziel gerade
// nicht sichtbar ist (z. B. eingeklappte Leiste auf dem Handy), werden übersprungen.
import { h } from './extras-core.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PAD = 8;

const visible = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  // auch außerhalb des Bildschirms (z. B. eingeklappte Leiste auf dem Handy) zählt als unsichtbar
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden';
};

let running = null;

export function startTour(steps, { onEnd } = {}) {
  running?.end(false);
  const list = steps.filter((s) => !s.target || visible(document.querySelector(s.target)));
  if (!list.length) return;
  let i = 0;
  let target = null;

  const hole = h('div', { class: 'tour-hole', 'aria-hidden': 'true' });
  const title = h('h2', { class: 'tour-title', id: 'tour-title' });
  const text = h('p', { class: 'tour-text' });
  const count = h('span', { class: 'tour-count' });
  const back = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => go(-1) }, '← Zurück');
  const next = h('button', { type: 'button', class: 'btn btn--primary btn--sm', onclick: () => go(1) });
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title' },
    h('button', { type: 'button', class: 'tour-close', 'aria-label': 'Einführung beenden', onclick: () => end(true) }, '×'),
    title, text, h('div', { class: 'tour-foot' }, count, h('span', { class: 'tour-btns' }, back, next)));
  const root = h('div', { class: 'tour' }, hole, card);
  document.body.append(root);

  function place() {
    const step = list[i];
    target = step.target ? document.querySelector(step.target) : null;
    const center = !target || !visible(target);
    root.classList.toggle('is-center', center);
    if (center) {
      card.style.left = '';
      card.style.top = '';
      return;
    }
    const r = target.getBoundingClientRect();
    Object.assign(hole.style, {
      left: `${r.left - PAD}px`, top: `${r.top - PAD}px`, width: `${r.width + PAD * 2}px`, height: `${r.height + PAD * 2}px`,
    });
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const below = r.bottom + PAD + 14;
    const above = r.top - PAD - 14 - ch;
    let top = below + ch < innerHeight - 12 ? below : above > 12 ? above : Math.max(12, innerHeight - ch - 12);
    // Ziel füllt fast alles: Karte unten in den Bildschirm
    if (r.height > innerHeight * .7) top = innerHeight - ch - 16;
    const left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), innerWidth - cw - 12);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function show() {
    const step = list[i];
    title.textContent = step.title;
    text.textContent = step.text;
    count.textContent = `${i + 1} / ${list.length}`;
    back.hidden = i === 0;
    next.textContent = i === list.length - 1 ? 'Fertig' : 'Weiter →';
    const el = step.target ? document.querySelector(step.target) : null;
    if (el && visible(el)) {
      const r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: r.height > innerHeight * .6 ? 'start' : 'center', behavior: reduced ? 'auto' : 'smooth' });
    }
    place();
    // nach dem Scrollen nachziehen
    setTimeout(place, reduced ? 0 : 350);
    next.focus({ preventScroll: true });
  }

  function go(d) {
    if (i + d >= list.length) { end(true); return; }
    i = Math.max(0, i + d);
    show();
  }

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); end(true); }
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft' && i > 0) go(-1);
  };
  const onMove = () => place();

  function end(done) {
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onMove);
    removeEventListener('scroll', onMove, true);
    root.remove();
    running = null;
    if (done) onEnd?.();
  }

  addEventListener('keydown', onKey, true);
  addEventListener('resize', onMove);
  addEventListener('scroll', onMove, true);
  running = { end };
  show();
}
