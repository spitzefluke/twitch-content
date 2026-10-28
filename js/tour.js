// Mitmach-Tour der Einführung: hebt Schritt für Schritt eine Stelle der Seite hervor (Spotlight).
// Zwei Arten von Schritten:
//   look – „Kurz erklärt“: ansehen, weiter mit „Weiter“
//   do   – „Du bist dran“: weiter geht es erst, wenn die markierte Stelle angeklickt wurde. Der Klick
//          passiert wirklich (das Fenster öffnet sich usw.) – der Rest der Seite ist solange gesperrt.
// startTour([{ target: '#selector' | null, title, text, kind: 'look' | 'do', ok }], { onEnd }) – Schritte,
// deren Ziel gerade nicht sichtbar ist (z. B. eingeklappte Leiste auf dem Handy), werden übersprungen.
// onEnd({ completed, tried }) – completed: bis „Fertig“ durchgeklickt, tried: so viele Mitmach-Schritte erledigt.
import { h } from './extras-core.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PAD = 6;
const GAP = 14;

const visible = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  // auch außerhalb des Bildschirms (z. B. eingeklappte Leiste auf dem Handy) zählt als unsichtbar
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden';
};
const icon = (cls) => h('i', { class: `ph ${cls}`, 'aria-hidden': 'true' });

let running = null;

export function startTour(steps, { onEnd } = {}) {
  running?.end(false);
  const list = steps.filter((s) => !s.target || visible(document.querySelector(s.target)));
  if (!list.length) return;
  let i = 0;
  const did = new Set();

  // Spotlight: Loch mit Schatten drumherum; die vier Blenden sperren den Rest der Seite,
  // die Abdeckung sperrt das Loch bei „Kurz erklärt“
  const hole = h('div', { class: 'tour-hole', 'aria-hidden': 'true' }, h('span', { class: 'tour-ping' }));
  const shades = [0, 1, 2, 3].map(() => h('div', { class: 'tour-shade' }));
  const cover = h('div', { class: 'tour-shade tour-cover' });
  const tag = h('span', { class: 'tour-tag' });
  const title = h('h2', { class: 'tour-title', id: 'tour-title' });
  const text = h('p', { class: 'tour-text', id: 'tour-text' });
  const ok = h('p', { class: 'tour-ok', role: 'status' });
  const count = h('span', { class: 'tour-count' });
  const back = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => go(-1) }, 'Zurück');
  const skip = h('button', { type: 'button', class: 'tour-skip', onclick: () => go(1) }, 'Überspringen');
  const next = h('button', { type: 'button', class: 'btn btn--primary btn--sm', onclick: () => go(1) });
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'tour-title', 'aria-describedby': 'tour-text' },
    h('div', { class: 'tour-head' }, tag,
      h('button', { type: 'button', class: 'tour-close', 'aria-label': 'Einführung beenden', title: 'Beenden', onclick: () => end(false) }, icon('ph-x'))),
    title, text, ok,
    h('div', { class: 'tour-foot' }, count, h('span', { class: 'tour-btns' }, skip, back, next)));
  const root = h('div', { class: 'tour' }, ...shades, cover, hole, card);
  document.body.append(root);

  const step = () => list[i];
  const target = () => (step().target ? document.querySelector(step().target) : null);
  const isDo = () => step().kind === 'do';

  function place() {
    const el = target();
    const center = !el || !visible(el);
    root.classList.toggle('is-center', center);
    const [top, bottom, left, right] = shades;
    if (center) {
      Object.assign(top.style, { left: '0', top: '0', width: '100%', height: '100%' });
      for (const s of [bottom, left, right]) s.style.height = '0';
      card.style.left = '';
      card.style.top = '';
      return;
    }
    const r = el.getBoundingClientRect();
    const box = { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
    const px = (n) => `${Math.round(n)}px`;
    const rect = { left: px(box.left), top: px(box.top), width: px(box.width), height: px(box.height) };
    Object.assign(hole.style, rect);
    Object.assign(cover.style, rect);
    const bottomY = box.top + box.height;
    const rightX = box.left + box.width;
    Object.assign(top.style, { left: '0', top: '0', width: '100%', height: px(Math.max(0, box.top)) });
    Object.assign(bottom.style, { left: '0', top: px(bottomY), width: '100%', height: px(Math.max(0, innerHeight - bottomY)) });
    Object.assign(left.style, { left: '0', top: px(box.top), width: px(Math.max(0, box.left)), height: px(box.height) });
    Object.assign(right.style, { left: px(rightX), top: px(box.top), width: px(Math.max(0, innerWidth - rightX)), height: px(box.height) });

    // Hohe Ziele (Seitenleiste): Karte daneben, sonst darunter oder darüber
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let x;
    let y;
    if (box.height > 200 && rightX + GAP + cw < innerWidth - 12) {
      x = rightX + GAP;
      y = Math.max(12, Math.min(box.top + 20, innerHeight - ch - 12));
    } else {
      x = Math.min(Math.max(12, box.left + box.width / 2 - cw / 2), innerWidth - cw - 12);
      const below = bottomY + GAP;
      const above = box.top - GAP - ch;
      y = below + ch < innerHeight - 12 ? below : above > 12 ? above : Math.max(12, innerHeight - ch - 12);
    }
    card.style.left = px(x);
    card.style.top = px(y);
  }

  function paint() {
    const done = did.has(i);
    const doStep = isDo();
    root.classList.toggle('is-do', doStep);
    root.classList.toggle('is-done', done);
    tag.className = `tour-tag${doStep ? ' is-do' : ''}`;
    tag.replaceChildren(icon(doStep ? 'ph-cursor-click' : 'ph-eye'), doStep ? 'Du bist dran' : 'Kurz erklärt');
    ok.hidden = !(doStep && done);
    ok.replaceChildren(icon('ph-check-circle'), step().ok ?? 'Erledigt.');
    const last = i === list.length - 1;
    const waiting = doStep && !done;
    next.disabled = waiting;
    next.textContent = waiting ? 'Erst ausprobieren' : last ? 'Fertig' : 'Weiter';
    skip.hidden = !waiting;
    back.hidden = i === 0;
  }

  function show() {
    const s = step();
    title.textContent = s.title;
    text.textContent = s.text;
    count.textContent = `${i + 1} / ${list.length}`;
    paint();
    const el = target();
    if (el && visible(el)) {
      const r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: r.height > innerHeight * .6 ? 'start' : 'center', behavior: reduced ? 'auto' : 'smooth' });
    }
    place();
    // nach dem Scrollen nachziehen
    setTimeout(place, reduced ? 0 : 350);
    (next.disabled ? card.querySelector('.tour-close') : next).focus({ preventScroll: true });
  }

  function go(d) {
    if (i + d >= list.length) { end(true); return; }
    i = Math.max(0, i + d);
    show();
  }

  // Mitmach-Schritt: der echte Klick auf die markierte Stelle zählt
  const onClick = (e) => {
    if (!isDo() || did.has(i)) return;
    const el = target();
    if (!el || !el.contains(e.target)) return;
    did.add(i);
    paint();
    // Öffnet der Klick ein Fenster, bleibt der Fokus dort
    setTimeout(() => { if (running && !document.querySelector('dialog[open]')) next.focus({ preventScroll: true }); }, 50);
  };
  const onKey = (e) => {
    // Ein offenes Fenster (z. B. vom Mitmach-Schritt) bekommt seine Tasten selbst
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { e.preventDefault(); end(false); }
    else if (e.key === 'ArrowRight' && !next.disabled) go(1);
    else if (e.key === 'ArrowLeft' && i > 0) go(-1);
  };
  const onMove = () => place();
  // Die Seite kann sich unter der Tour verändern (Fenster zu, Daten geladen) – Spotlight nachziehen
  const timer = setInterval(place, 400);

  function end(completed) {
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onMove);
    removeEventListener('scroll', onMove, true);
    document.removeEventListener('click', onClick, true);
    clearInterval(timer);
    root.remove();
    running = null;
    onEnd?.({ completed, tried: did.size });
  }

  addEventListener('keydown', onKey, true);
  addEventListener('resize', onMove);
  addEventListener('scroll', onMove, true);
  document.addEventListener('click', onClick, true);
  running = { end };
  show();
}
