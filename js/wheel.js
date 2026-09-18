// Glücksrad auf <canvas>. Der Zeiger steht oben (−90°).
// Ablauf einer Drehung: start() beschleunigt sofort, spinTo(index) bremst
// mit passender Anfangsgeschwindigkeit sanft auf das Ziel-Segment ab.
const TAU = Math.PI * 2;
const MAX_V = 0.014; // rad pro ms im freien Lauf
const mod = (a, n) => ((a % n) + n) % n;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Wheel {
  constructor(canvas, { onTick } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTick = onTick;
    this.segments = [];
    this.color = '#ffb81c';
    this.angle = 0;
    this.velocity = 0;
    this.mode = 'idle'; // idle | free | decel
    this.raf = null;
    this.lastIndex = -1;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    new ResizeObserver(() => this.resize()).observe(canvas);
    document.fonts?.ready.then(() => this.draw());
  }

  get busy() { return this.mode !== 'idle'; }

  setVariant(variant) {
    this.segments = variant.segments;
    this.color = variant.color;
    this.draw();
  }

  resize() {
    const size = this.canvas.clientWidth;
    if (!size) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = size;
    this.canvas.width = Math.round(size * this.dpr);
    this.canvas.height = Math.round(size * this.dpr);
    this.draw();
  }

  start() {
    if (this.mode === 'free' || this.reduced) return;
    this.mode = 'free';
    this.freeStart = performance.now();
    this.loop();
  }

  async spinTo(index) {
    const n = this.segments.length;
    const arc = TAU / n;
    const jitter = (Math.random() - 0.5) * arc * 0.6;
    const target = -Math.PI / 2 - (index + 0.5) * arc + jitter;

    if (this.reduced) {
      this.angle = target;
      this.mode = 'idle';
      this.draw();
      await wait(150);
      return;
    }
    if (this.mode !== 'free') {
      this.start();
      await wait(650);
    }

    // Kubische Abbremsung p(t) = a·t³ + b·t² + v0·t
    // mit p(0)=0, p'(0)=v0, p(T)=D, p'(T)=0 und T = 1.7·D/v0 (monoton fallende Geschwindigkeit)
    const v0 = this.velocity || MAX_V;
    const from = this.angle;
    const delta = mod(target - from, TAU);
    const minDistance = (v0 * 4800) / 1.7;
    const D = delta + TAU * Math.ceil(Math.max(0, minDistance - delta) / TAU);
    const T = (1.7 * D) / v0;
    const a = (v0 * T - 2 * D) / T ** 3;
    const b = -(3 * a * T ** 2 + v0) / (2 * T);

    return new Promise((resolve) => {
      this.decel = { start: performance.now(), from, D, T, a, b, v0, resolve };
      this.mode = 'decel';
      this.loop();
    });
  }

  loop() {
    if (this.raf) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(now - last, 50);
      last = now;
      this.update(now, dt);
      this.draw();
      this.checkTick();
      this.raf = this.mode === 'idle' ? null : requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  update(now, dt) {
    if (this.mode === 'free') {
      const ramp = Math.min(1, (now - this.freeStart) / 450);
      this.velocity = MAX_V * ramp * ramp;
      this.angle += this.velocity * dt;
    } else if (this.mode === 'decel') {
      const { start, from, D, T, a, b, v0, resolve } = this.decel;
      const t = Math.min(now - start, T);
      this.angle = from + a * t ** 3 + b * t ** 2 + v0 * t;
      this.velocity = 3 * a * t ** 2 + 2 * b * t + v0;
      if (t >= T) {
        this.angle = from + D;
        this.velocity = 0;
        this.mode = 'idle';
        resolve();
      }
    }
  }

  checkTick() {
    const n = this.segments.length;
    if (!n) return;
    const idx = Math.floor(mod(-Math.PI / 2 - this.angle, TAU) / (TAU / n));
    if (idx !== this.lastIndex) {
      this.lastIndex = idx;
      this.onTick?.();
    }
  }

  draw() {
    const { ctx, size, segments } = this;
    if (!size || !segments.length) return;
    const n = segments.length;
    const arc = TAU / n;
    const c = size / 2;
    const rim = size * 0.045;
    const r = c - rim - 2;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // Rand mit Lichtern
    ctx.beginPath();
    ctx.arc(c, c, c - 2, 0, TAU);
    ctx.fillStyle = '#0c0f17';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.color;
    ctx.stroke();

    const fills = [this.color, '#161b28', shade(this.color, -0.45)];
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(this.angle);
    for (let i = 0; i < n; i++) {
      const fill = n % 2 === 1 && i === n - 1 ? fills[2] : fills[i % 2];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, i * arc, (i + 1) * arc);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.stroke();

      ctx.save();
      ctx.rotate((i + 0.5) * arc);
      ctx.fillStyle = isLight(fill) ? '#17110a' : '#f2f4f8';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const label = segments[i].label.toUpperCase();
      const maxW = r * 0.64;
      let fs = size * 0.052;
      ctx.font = `700 ${fs}px "Barlow Condensed", sans-serif`;
      while (ctx.measureText(label).width > maxW && fs > 9) {
        fs -= 0.5;
        ctx.font = `700 ${fs}px "Barlow Condensed", sans-serif`;
      }
      ctx.fillText(label, r - size * 0.04, 0);
      ctx.restore();
    }
    ctx.restore();

    // Glühbirnen
    const bulbs = 24;
    for (let i = 0; i < bulbs; i++) {
      const a = (i / bulbs) * TAU;
      const x = c + Math.cos(a) * (c - rim / 2 - 2);
      const y = c + Math.sin(a) * (c - rim / 2 - 2);
      const on = (i + (this.mode === 'idle' ? 0 : Math.floor(performance.now() / 120))) % 2 === 0;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.009, 0, TAU);
      ctx.fillStyle = on ? '#fff3cf' : 'rgba(255,255,255,.18)';
      if (on) { ctx.shadowColor = this.color; ctx.shadowBlur = 10; }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? [...h].map((x) => x + x).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function isLight(color) {
  if (!color.startsWith('#')) return false;
  const [r, g, b] = hexToRgb(color);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
}
function shade(hex, amount) {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(Math.max(0, Math.min(255, v + v * amount))));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
