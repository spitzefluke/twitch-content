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
    document.fonts?.ready.then(() => { this.cacheKey = null; this.draw(); });
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

  // Gezeichnet wird in zwei Puffer-Bildern, die nur neu entstehen, wenn sich Felder, Farbe oder Größe
  // ändern: die Scheibe (Felder + Beschriftung) und der Rand mit den Glühbirnen (zwei Muster).
  // Pro Bild beim Drehen bleibt dann nur: Rand kopieren, Scheibe gedreht kopieren – schont OBS.
  cache() {
    const { size, segments, dpr } = this;
    const key = `${size}|${dpr}|${this.color}|${segments.map((s) => `${s.label}:${s.color ?? ''}`).join(';')}`;
    if (this.cacheKey === key) return this.buffers;
    this.cacheKey = key;
    const px = Math.round(size * dpr);
    const make = () => {
      const cv = document.createElement('canvas');
      cv.width = px;
      cv.height = px;
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return [cv, g];
    };
    const n = segments.length;
    const arc = TAU / n;
    const c = size / 2;
    const rim = size * 0.045;
    const r = c - rim - 2;

    // Scheibe (Mitte im Ursprung gezeichnet, gedreht wird beim Kopieren)
    const [disc, d] = make();
    const fills = [this.color, '#161b28', shade(this.color, -0.45)];
    d.translate(c, c);
    for (let i = 0; i < n; i++) {
      // Eigene Farbe je Feld (z. B. Seltenheit), sonst abwechselnd in der Variantenfarbe
      const fill = segments[i].color || (n % 2 === 1 && i === n - 1 ? fills[2] : fills[i % 2]);
      d.beginPath();
      d.moveTo(0, 0);
      d.arc(0, 0, r, i * arc, (i + 1) * arc);
      d.closePath();
      d.fillStyle = fill;
      d.fill();
      d.lineWidth = 1.5;
      d.strokeStyle = 'rgba(0,0,0,.45)';
      d.stroke();

      d.save();
      d.rotate((i + 0.5) * arc);
      d.fillStyle = isLight(fill) ? '#17110a' : '#f2f4f8';
      d.textAlign = 'right';
      d.textBaseline = 'middle';
      const label = segments[i].label.toUpperCase();
      const maxW = r * 0.64;
      let fs = size * 0.052;
      d.font = `700 ${fs}px "Barlow Condensed", sans-serif`;
      while (d.measureText(label).width > maxW && fs > 9) {
        fs -= 0.5;
        d.font = `700 ${fs}px "Barlow Condensed", sans-serif`;
      }
      d.fillText(label, r - size * 0.04, 0);
      d.restore();
    }

    // Rand mit Glühbirnen: Muster 0 und 1 (beim Drehen blinken sie im Wechsel)
    const rims = [0, 1].map((phase) => {
      const [cv, g] = make();
      g.beginPath();
      g.arc(c, c, c - 2, 0, TAU);
      g.fillStyle = '#0c0f17';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = this.color;
      g.stroke();
      const bulbs = 24;
      for (let i = 0; i < bulbs; i++) {
        const a = (i / bulbs) * TAU;
        const x = c + Math.cos(a) * (c - rim / 2 - 2);
        const y = c + Math.sin(a) * (c - rim / 2 - 2);
        const on = (i + phase) % 2 === 0;
        g.beginPath();
        g.arc(x, y, size * 0.009, 0, TAU);
        g.fillStyle = on ? '#fff3cf' : 'rgba(255,255,255,.18)';
        if (on) { g.shadowColor = this.color; g.shadowBlur = 10; }
        g.fill();
        g.shadowBlur = 0;
      }
      return cv;
    });
    this.buffers = { disc, rims };
    return this.buffers;
  }

  draw() {
    const { ctx, size, segments } = this;
    if (!size || !segments.length) return;
    const { disc, rims } = this.cache();
    const c = size / 2;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const phase = this.mode === 'idle' ? 0 : Math.floor(performance.now() / 120) % 2;
    ctx.drawImage(rims[phase], 0, 0, size, size);
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(this.angle);
    ctx.drawImage(disc, -c, -c, size, size);
    ctx.restore();
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
