// Kleine Render-Engine für das Intro (js/intro-scene.js) – statt React.
//
// Die Szene ist eine reine Funktion der Zeit T: Sie liefert bei jedem Frame
// einen Baum aus h()-Knoten, und patch() gleicht ihn mit dem DOM ab. Geändert
// werden nur die Styles, die sich wirklich ändern – so bleibt es flüssig.
// Easing, animate und clamp entsprechen der Animations-Engine aus Claude Design
// (animations-v3.jsx), damit die Choreografie genau wie im Entwurf läuft.

export const Fragment = Symbol('Fragment');

// h(type, props, ...children): Komponenten (Funktionen) werden sofort
// aufgelöst, Fragmente und Arrays flachgeklopft.
export function h(type, props, ...children) {
  const kids = flatten(children);
  if (type === Fragment) return kids;
  if (typeof type === 'function') return type({ ...props, children: kids });
  return { type, props: props ?? {}, children: kids };
}

function flatten(list, out = []) {
  for (const c of list) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) flatten(c, out);
    else if (typeof c === 'object') out.push(c);
    else out.push({ type: '#text', value: String(c) });
  }
  return out;
}

// Zahlen ohne Einheit bleiben so, alle anderen bekommen px (wie in React)
const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'flex', 'flexGrow', 'flexShrink', 'lineHeight', 'order', 'zoom']);
const cssName = (k) => (k.startsWith('Webkit') ? `webkit${k.slice(6)}` : k);
const cssValue = (k, v) => (typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : v == null ? '' : String(v));

function create(node) {
  if (node.type === '#text') return document.createTextNode(node.value);
  const el = document.createElement(node.type);
  update(el, { props: {} }, node);
  node.children.forEach((c) => el.append(create(c)));
  return el;
}

function update(el, prev, next) {
  const a = prev.props.style ?? {};
  const b = next.props.style ?? {};
  for (const k in a) if (!(k in b)) el.style[cssName(k)] = '';
  for (const k in b) {
    if (a[k] !== b[k]) el.style[cssName(k)] = cssValue(k, b[k]);
  }
  for (const [k, v] of Object.entries(next.props)) {
    if (k === 'style' || k === 'key' || k === 'children') continue;
    if (prev.props[k] !== v) el.setAttribute(k === 'className' ? 'class' : k, v);
  }
}

// Gleicht die Kinder von parent (DOM) von prev auf next ab
export function patch(parent, prev, next) {
  const nodes = parent.childNodes;
  for (let i = 0; i < next.length; i++) {
    const n = next[i];
    const p = prev[i];
    const el = nodes[i];
    if (!p || !el) { parent.append(create(n)); continue; }
    if (p.type !== n.type) { parent.replaceChild(create(n), el); continue; }
    if (n.type === '#text') {
      if (p.value !== n.value) el.nodeValue = n.value;
      continue;
    }
    update(el, p, n);
    patch(el, p.children, n.children);
  }
  while (nodes.length > next.length) parent.lastChild.remove();
}

// ---------- Choreografie-Helfer (wie in animations-v3.jsx) ----------
export const Easing = {
  linear: (t) => t,
  easeInCubic: (t) => t * t * t,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeOutQuart: (t) => 1 - (--t) * t * t * t,
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// animate({from, to, start, end, ease})(t): vor start from, nach end to
export function animate({ from = 0, to = 1, start = 0, end = 1, ease = Easing.easeInOutCubic }) {
  return (t) => {
    if (t <= start) return from;
    if (t >= end) return to;
    return from + (to - from) * ease((t - start) / (end - start));
  };
}

// Aktuelle Zeit für <Shot>: setzt die Schleife vor jedem Frame
const clock = { T: 0 };
export const setTime = (T) => { clock.T = T; };

// <Shot from to>: Inhalt nur zwischen zwei Zeitpunkten (harter Schnitt)
export function Shot({ from, to = Infinity, children }) {
  const on = clock.T >= from && clock.T < to;
  return h('div', { style: { position: 'absolute', inset: 0, visibility: on ? 'visible' : 'hidden' } }, on ? children : null);
}

// Szenen der Reise mit Dauer in Sekunden → Startzeiten (CUES) und Gesamtlänge
export function cuesOf(scenes) {
  const cues = {};
  let t = 0;
  for (const s of scenes) {
    if (!(s.name in cues)) cues[s.name] = t;
    t += s.dur;
  }
  return { cues, total: t };
}
