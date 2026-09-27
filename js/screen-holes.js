// Löcher im Bildschirm: Bei Heißhunger frisst Rexi das Streambild an (js/pet.js, eatScreen).
// Jedes Loch ist ein SVG mit gezacktem Bissrand, dunklem „Nichts“ dahinter, Farbversatz am
// Rand wie bei einem kaputten Display und Sprüngen nach außen; bunte Pixel-Krümel fallen.
// Nach dem Füttern repariert sich der Bildschirm wieder (repair). Aussehen in css/pet.css.

const NS = 'http://www.w3.org/2000/svg';
const MAX_HOLES = 40;
const PIXEL_COLORS = ['#ff3355', '#33ff88', '#3399ff', '#ffe14d', '#ff66ff', '#ffffff'];
let holeCount = 0;
const rand = (a, b) => a + Math.random() * (b - a);

function svgEl(name, attrs) {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Umriss eines Bisses: Kreis mit Zahnabdrücken (Bögen) und ausgefransten Stellen
function biteOutline(c, r) {
  const n = 36;
  const teeth = Math.round(rand(6, 9));
  const phase = rand(0, Math.PI);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = r * (0.9 + 0.12 * Math.abs(Math.sin(a * teeth / 2 + phase)) + rand(-0.05, 0.05));
    pts.push(`${(c + Math.cos(a) * k).toFixed(1)},${(c + Math.sin(a) * k).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

// Sprünge vom Rand nach außen, jeweils mit ein paar Knicken
function cracks(c, r) {
  const out = [];
  const count = Math.round(rand(3, 6));
  for (let i = 0; i < count; i++) {
    let a = rand(0, Math.PI * 2);
    let d = r * 0.95;
    let x = c + Math.cos(a) * d;
    let y = c + Math.sin(a) * d;
    const pts = [`${x.toFixed(1)},${y.toFixed(1)}`];
    const len = r * rand(0.35, 0.9);
    for (let s = 0; s < 3; s++) {
      a += rand(-0.5, 0.5);
      d += len / 3;
      x = c + Math.cos(a) * d;
      y = c + Math.sin(a) * d;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    out.push(pts.join(' '));
  }
  return out;
}

export class ScreenHoles {
  // Zwei Ebenen: unten Ränder und Sprünge, darüber das Schwarz – so verschmelzen
  // überlappende Bissen zu einem ausgefressenen Stück ohne Linien mittendrin.
  constructor(parent = document.body) {
    this.layer = document.createElement('div');
    this.layer.className = 'screen-holes';
    this.layer.setAttribute('aria-hidden', 'true');
    this.edges = document.createElement('div');
    this.voids = document.createElement('div');
    this.edges.className = 'screen-holes-edges';
    this.voids.className = 'screen-holes-voids';
    this.layer.append(this.edges, this.voids);
    parent.append(this.layer);
  }

  get count() { return this.voids.querySelectorAll('.screen-hole:not(.is-repair)').length; }

  // Ein Biss bei (x, y) in Bildschirm-Pixeln mit Radius r
  bite(x, y, r, { reducedMotion = false } = {}) {
    const old = [...this.voids.querySelectorAll('.screen-hole:not(.is-repair)')];
    if (old.length >= MAX_HOLES) this.remove(old[0].dataset.hole);
    const id = `sh${++holeCount}`;
    const size = r * 3.2;
    const c = size / 2;
    const make = () => {
      const el = svgEl('svg', { class: 'screen-hole', width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'data-hole': id });
      el.style.left = `${x - c}px`;
      el.style.top = `${y - c}px`;
      el.style.setProperty('--rot', `${rand(-25, 25).toFixed(0)}deg`);
      return el;
    };
    const svg = make();
    const edge = make();
    edge.classList.add('screen-hole-edge');
    const defs = svgEl('defs', {});
    const grad = svgEl('radialGradient', { id: `${id}-void` });
    for (const [o, col] of [['0', '#000'], ['.62', '#04020a'], ['.9', '#140a26'], ['1', '#2a1446']]) grad.append(svgEl('stop', { offset: o, 'stop-color': col }));
    defs.append(grad);
    svg.append(defs);
    const outline = biteOutline(c, r);
    const g = svgEl('g', { class: 'screen-hole-cracks' });
    for (const p of cracks(c, r)) {
      g.append(svgEl('polyline', { points: p, fill: 'none', stroke: 'rgba(255,255,255,.55)', 'stroke-width': '1.4', 'stroke-linejoin': 'round' }));
    }
    edge.append(
      g,
      // Farbversatz am Rand: rot und blau leicht verschoben – wie ein kaputtes Display
      svgEl('path', { d: outline, fill: 'none', stroke: 'rgba(255,40,90,.75)', 'stroke-width': '4', transform: 'translate(2.5 0)' }),
      svgEl('path', { d: outline, fill: 'none', stroke: 'rgba(0,220,255,.75)', 'stroke-width': '4', transform: 'translate(-2.5 0)' }),
      svgEl('path', { d: outline, fill: 'none', stroke: 'rgba(255,255,255,.85)', 'stroke-width': '3', 'stroke-linejoin': 'round' }),
    );
    svg.append(svgEl('path', { d: outline, fill: `url(#${id}-void)` }));
    // Ein paar tote Pixel im Loch
    for (let i = 0; i < 4; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(0.2, 0.7) * r;
      const s = rand(2, 5);
      svg.append(svgEl('rect', {
        class: 'screen-hole-pixel', x: (c + Math.cos(a) * d).toFixed(1), y: (c + Math.sin(a) * d).toFixed(1), width: s, height: s,
        fill: PIXEL_COLORS[Math.floor(Math.random() * PIXEL_COLORS.length)], style: `animation-delay:${rand(0, 2).toFixed(2)}s`,
      }));
    }
    this.edges.append(edge);
    this.voids.append(svg);
    if (!reducedMotion) this.crumbs(x, y, r);
    return svg;
  }

  // Bunte Pixel fallen aus dem Loch
  crumbs(x, y, r) {
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('span');
      p.className = 'screen-crumb';
      const s = rand(4, 9);
      p.style.cssText = `left:${(x + rand(-r, r) * 0.6).toFixed(0)}px;top:${(y + rand(-r, r) * 0.4).toFixed(0)}px;width:${s.toFixed(0)}px;height:${s.toFixed(0)}px;`
        + `background:${PIXEL_COLORS[Math.floor(Math.random() * PIXEL_COLORS.length)]};animation-delay:${(i * 40)}ms`;
      p.style.setProperty('--dx', `${rand(-70, 70).toFixed(0)}px`);
      p.style.setProperty('--dy', `${rand(120, 260).toFixed(0)}px`);
      this.layer.append(p);
      setTimeout(() => p.remove(), 1500 + i * 40);
    }
  }

  // Der ganze Bildschirm wackelt kurz (die Karten im Overlay – das Spielbild selbst kann er nicht bewegen)
  shake() {
    for (const el of document.querySelectorAll('.ov-card, .screen-holes')) {
      el.animate?.([{ translate: '0 0' }, { translate: '-4px 2px' }, { translate: '4px -2px' }, { translate: '-2px 1px' }, { translate: '0 0' }], { duration: 260, easing: 'ease-in-out' });
    }
  }

  remove(id) {
    for (const el of this.layer.querySelectorAll(`[data-hole="${id}"]`)) el.remove();
  }

  // Nach dem Füttern: Löcher wachsen nacheinander wieder zu (die neuesten zuerst)
  repair() {
    const holes = [...this.voids.querySelectorAll('.screen-hole:not(.is-repair)')].reverse();
    holes.forEach((h, i) => {
      setTimeout(() => {
        const parts = this.layer.querySelectorAll(`[data-hole="${h.dataset.hole}"]`);
        parts.forEach((p) => p.classList.add('is-repair'));
        setTimeout(() => parts.forEach((p) => p.remove()), 900);
      }, i * 70);
    });
    return holes.length;
  }

  destroy() { this.layer.remove(); }
}
