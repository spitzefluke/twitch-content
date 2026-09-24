// „Ärgere den Dave“: Wurfgegenstände, eingebaute Sounds und die Wurf-Animation.
// Benutzt von der Webseite (Bühne im Dialog) und vom OBS-Overlay.
// Alle Töne entstehen im Browser (Web Audio) – es gibt keine Audiodateien.

export const ITEMS = [
  { id: 'banana', name: 'Banane', acc: 'eine Banane', emoji: '🍌', hit: 'thud', stick: true },
  { id: 'tomato', name: 'Tomate', acc: 'eine Tomate', emoji: '🍅', hit: 'splat', splat: '#d9281a', drip: true },
  { id: 'pie', name: 'Torte', acc: 'eine Torte', emoji: '🥧', hit: 'splat', splat: '#fff1cf', drip: true },
  { id: 'egg', name: 'Ei', acc: 'ein Ei', emoji: '🥚', hit: 'crack', splat: '#ffc62e', drip: true },
  { id: 'fish', name: 'Fisch', acc: 'einen Fisch', emoji: '🐟', hit: 'slap' },
  { id: 'duck', name: 'Quietscheente', acc: 'eine Quietscheente', emoji: '🦆', hit: 'squeak' },
  { id: 'sock', name: 'Stinkesocke', acc: 'eine Stinkesocke', emoji: '🧦', hit: 'thud', splat: '#86c83f', cloud: true },
  { id: 'snowball', name: 'Schneeball', acc: 'einen Schneeball', emoji: '❄️', hit: 'poof', splat: '#eef7ff' },
  { id: 'undies', name: 'Rote Unterhose', acc: 'eine rote Unterhose', emoji: '🩲', hit: 'slap', stick: true, svg: 'undies' },
  { id: 'nuke', name: 'Nuke', acc: 'eine Nuke', emoji: '☢️', hit: 'boom', boom: true, svg: 'nuke' },
  { id: 'flowers', name: 'Blumen', acc: 'Blumen', emoji: '💐', hit: 'bling', nice: true },
];

// Eigene Zeichnungen, wo es kein passendes Emoji gibt (🩲 ist meist blau)
const ICONS = {
  undies: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <path d="M9 31h82l-4 22c-13 3-21 12-24 29H37c-3-17-11-26-24-29z" fill="#e3202b" stroke="#7d0c12" stroke-width="3" stroke-linejoin="round"/>
    <path d="M37 82c1-10 5-17 13-17s12 7 13 17" fill="#b5121c"/>
    <path d="M20 38c10 1 18 5 22 12" stroke="#ff7b82" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/>
    <rect x="8" y="18" width="84" height="14" rx="4" fill="#fff" stroke="#7d0c12" stroke-width="3"/>
    <path d="M18 25h64" stroke="#e3202b" stroke-width="2" stroke-dasharray="4 4"/>
  </svg>`,
  nuke: `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="translate(50 50) rotate(-35) scale(.95) translate(-50 -50)">
    <path d="M22 50 6 36v28z" fill="#3f4a36" stroke="#1d2419" stroke-width="3" stroke-linejoin="round"/>
    <path d="M26 50 12 22h14l12 18zM26 50 12 78h14l12-18z" fill="#56644a" stroke="#1d2419" stroke-width="3" stroke-linejoin="round"/>
    <ellipse cx="58" cy="50" rx="36" ry="23" fill="#5d6d4f" stroke="#1d2419" stroke-width="3"/>
    <ellipse cx="66" cy="42" rx="18" ry="6" fill="#8fa27c" opacity=".7"/>
    <circle cx="60" cy="52" r="14" fill="#ffd21f" stroke="#1d2419" stroke-width="2.5"/>
    <g fill="#1d2419"><circle cx="60" cy="52" r="2.6"/>
      <path d="M60 52 53 40a14 14 0 0 1 14 0z"/><path d="M60 52l14 0a14 14 0 0 1-7 12z"/><path d="M60 52l-7 12a14 14 0 0 1-7-12z"/></g>
  </g></svg>`,
};

// Symbol eines Gegenstands in `el`: Zeichnung oder Emoji
export function setItemIcon(el, it) {
  if (it?.svg) {
    el.innerHTML = ICONS[it.svg].replace(/>\s+</g, '><');
    el.classList.add('pf-icon');
  } else {
    el.textContent = it?.emoji ?? '🍌';
    el.classList.remove('pf-icon');
  }
}

// Symbol einer Aktion (Wurf oder Sound) in `el`
export function setPrankIcon(el, p) {
  if (p.kind === 'throw') setItemIcon(el, itemById(p.item) ?? ITEMS[0]);
  else el.textContent = prankEmoji(p);
}

export const BOARD = [
  { id: 'whistle', name: 'Zugpfeife', emoji: '🚂' },
  { id: 'horn', name: 'Tröte', emoji: '📯' },
  { id: 'rimshot', name: 'Ba-dum-tss', emoji: '🥁' },
  { id: 'buzzer', name: 'Falsch!', emoji: '❌' },
  { id: 'fart', name: 'Pupskissen', emoji: '💨' },
  { id: 'boing', name: 'Boing', emoji: '🌀' },
  { id: 'quack', name: 'Quak', emoji: '🦆' },
  { id: 'applause', name: 'Applaus', emoji: '👏' },
  { id: 'gong', name: 'Bahnhofsgong', emoji: '🔔' },
];

export const MAX_SOUND_SECONDS = 10;
export const itemById = (id) => ITEMS.find((i) => i.id === id);
export const boardById = (id) => BOARD.find((b) => b.id === id);

// "Lena wirft eine Tomate" / "Lena spielt „Zugpfeife“"
export function prankText(p) {
  if (p.kind === 'throw') {
    const item = itemById(p.item);
    return item?.nice ? `${p.requested_by} schenkt Dave ${item.acc}` : `${p.requested_by} wirft ${item?.acc ?? 'etwas'}`;
  }
  const name = p.item === 'custom' ? p.label : boardById(p.item)?.name ?? p.item;
  return `${p.requested_by} spielt „${name}“`;
}

export function prankEmoji(p) {
  if (p.kind === 'throw') return itemById(p.item)?.emoji ?? '🍌';
  return p.item === 'custom' ? '🔊' : boardById(p.item)?.emoji ?? '🔊';
}

// ============================================================
// Töne
// ============================================================
export class Sfx {
  constructor({ volume = 1 } = {}) {
    this.volume = volume;
    this.ctx = null;
    this.out = null;
  }

  // null, solange der Browser keinen Ton erlaubt (vor dem ersten Klick) oder die Lautstärke 0 ist
  get() {
    if (!this.volume) return null;
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext ?? window.webkitAudioContext)();
        // Kompressor: Mehrere Töne gleichzeitig sollen nicht übersteuern.
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.out = this.ctx.createGain();
        this.out.connect(comp).connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      this.out.gain.value = this.volume;
    } catch { return null; }
    return this.ctx.state === 'running' ? this.ctx : null;
  }

  // Hüllkurve: Anstieg, Halten, Ausklingen
  env(ctx, gain, t0, { peak, attack = 0.005, hold = 0, release = 0.3 }) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    gain.gain.setValueAtTime(Math.max(0.0002, peak), t0 + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
    return attack + hold + release;
  }

  tone(freq, { type = 'sine', at = 0, to = null, curve = null, vibrato = null, filter = null, ...env } = {}) {
    const ctx = this.get();
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    const dur = this.env(ctx, gain, t0, { peak: 0.3, ...env });
    if (curve) osc.frequency.setValueCurveAtTime(curve, t0, dur);
    else {
      osc.frequency.setValueAtTime(freq, t0);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    }
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = vibrato.rate;
      depth.gain.setValueAtTime(vibrato.depth, t0);
      if (vibrato.fade) depth.gain.exponentialRampToValueAtTime(1, t0 + dur);
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.frequency.value = filter.freq;
      f.Q.value = filter.q ?? 1;
      node = node.connect(f);
    }
    node.connect(gain).connect(this.out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ at = 0, type = 'lowpass', freq = 1000, to = null, q = 1, buffer = null, ...env } = {}) {
    const ctx = this.get();
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = buffer ?? this.whiteNoise(ctx);
    src.loop = !buffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    const gain = ctx.createGain();
    const dur = this.env(ctx, gain, t0, { peak: 0.3, ...env });
    if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    src.connect(f).connect(gain).connect(this.out);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  whiteNoise(ctx) {
    if (this.noiseBuf) return this.noiseBuf;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return (this.noiseBuf = buf);
  }

  // ---------- Aufprall ----------
  hit(kind) {
    const s = this;
    ({
      thud() {
        s.tone(150, { to: 55, release: 0.22, peak: 0.55 });
        s.noise({ freq: 500, release: 0.08, peak: 0.2 });
      },
      splat() {
        s.noise({ freq: 1400, to: 250, release: 0.3, peak: 0.5 });
        s.tone(110, { to: 50, release: 0.16, peak: 0.35 });
      },
      crack() {
        [0, 0.03, 0.07].forEach((at) => s.noise({ at, type: 'highpass', freq: 2500, release: 0.03, peak: 0.35 }));
        s.noise({ at: 0.06, freq: 1200, to: 300, release: 0.25, peak: 0.35 });
      },
      slap() {
        s.noise({ type: 'bandpass', freq: 1400, q: 0.8, release: 0.09, peak: 0.7 });
        s.tone(300, { to: 120, release: 0.07, peak: 0.3 });
      },
      squeak() {
        s.tone(900, { to: 1500, attack: 0.01, hold: 0.06, release: 0.1, peak: 0.25 });
        s.tone(1300, { at: 0.2, to: 900, attack: 0.01, hold: 0.05, release: 0.1, peak: 0.22 });
      },
      poof() { s.noise({ freq: 2500, to: 600, attack: 0.02, release: 0.35, peak: 0.35 }); },
      // Nuke: Knall, dann tiefes Grollen
      boom() {
        s.noise({ type: 'highpass', freq: 1800, release: 0.12, peak: 0.5 });
        s.tone(95, { to: 26, attack: 0.01, release: 1.6, peak: 0.9 });
        s.noise({ freq: 1100, to: 70, attack: 0.01, hold: 0.2, release: 2.4, peak: 0.75 });
        s.noise({ at: 0.35, freq: 300, to: 60, attack: 0.3, release: 1.8, peak: 0.35 });
      },
      bling() {
        s.tone(1318.5, { release: 0.8, peak: 0.2 });
        s.tone(1975.5, { at: 0.08, release: 1, peak: 0.15 });
      },
    })[kind]?.();
  }

  whoosh() { this.noise({ type: 'bandpass', freq: 500, to: 2200, q: 1.2, attack: 0.15, release: 0.2, peak: 0.12 }); }

  // ---------- Soundboard ----------
  play(id) {
    const s = this;
    const board = {
      // Dreiklang-Pfeife mit etwas Luft, zweimal gezogen
      whistle() {
        for (const [at, hold] of [[0, 0.25], [0.55, 0.9]]) {
          for (const f of [466.2, 554.4, 698.5]) {
            s.tone(f, { at, type: 'triangle', attack: 0.08, hold, release: 0.3, peak: 0.1, vibrato: { rate: 5.5, depth: 4 } });
          }
          s.noise({ at, type: 'bandpass', freq: 2500, attack: 0.08, hold, release: 0.3, peak: 0.04 });
        }
      },
      horn() {
        for (const [at, hold] of [[0, 0.12], [0.22, 0.12], [0.44, 0.7]]) {
          for (const f of [233, 294, 349]) {
            s.tone(f, { at, type: 'sawtooth', attack: 0.02, hold, release: 0.1, peak: 0.08, filter: { type: 'lowpass', freq: 1800 } });
          }
        }
      },
      rimshot() {
        s.tone(200, { to: 110, attack: 0.003, release: 0.25, peak: 0.5 });
        s.tone(150, { at: 0.2, to: 85, attack: 0.003, release: 0.3, peak: 0.5 });
        s.noise({ at: 0.42, type: 'bandpass', freq: 1800, release: 0.18, peak: 0.35 });
        s.noise({ at: 0.42, type: 'highpass', freq: 6000, release: 1.4, peak: 0.25 });
      },
      buzzer() {
        s.tone(100, { type: 'square', attack: 0.01, hold: 0.55, release: 0.08, peak: 0.12, filter: { type: 'lowpass', freq: 900 } });
        s.tone(104, { type: 'sawtooth', attack: 0.01, hold: 0.55, release: 0.08, peak: 0.12, filter: { type: 'lowpass', freq: 900 } });
      },
      fart() {
        const curve = new Float32Array(64);
        let f = 90;
        for (let i = 0; i < curve.length; i++) curve[i] = f = Math.min(130, Math.max(55, f + (Math.random() - 0.5) * 30));
        s.tone(90, { type: 'sawtooth', curve, attack: 0.03, hold: 0.5, release: 0.25, peak: 0.4, filter: { type: 'lowpass', freq: 500, q: 4 } });
        s.noise({ freq: 300, attack: 0.03, hold: 0.5, release: 0.25, peak: 0.1 });
      },
      boing() {
        s.tone(180, { to: 420, release: 0.7, peak: 0.35, vibrato: { rate: 14, depth: 70, fade: true } });
        s.tone(360, { type: 'triangle', to: 840, release: 0.5, peak: 0.08, vibrato: { rate: 14, depth: 120, fade: true } });
      },
      quack() {
        for (const at of [0, 0.2]) s.tone(620, { at, type: 'sawtooth', to: 420, attack: 0.01, hold: 0.06, release: 0.07, peak: 0.3, filter: { type: 'bandpass', freq: 1100, q: 3 } });
      },
      applause() {
        const ctx = s.get();
        if (!ctx) return;
        const len = Math.floor(ctx.sampleRate * 2.4);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        // viele kurze Klatscher, am Ende weniger
        for (let c = 0; c < 110; c++) {
          const start = Math.floor(Math.pow(Math.random(), 1.6) * (len - 2000));
          const decay = ctx.sampleRate * (0.008 + Math.random() * 0.01);
          const amp = 0.4 + Math.random() * 0.6;
          for (let i = 0; i < decay * 5 && start + i < len; i++) data[start + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / decay);
        }
        s.noise({ buffer: buf, type: 'bandpass', freq: 1500, q: 0.7, attack: 0.05, hold: 1.8, release: 0.5, peak: 0.55 });
      },
      gong() {
        s.tone(659.25, { release: 1.2, peak: 0.25 });
        s.tone(880, { at: 0.22, release: 1.6, peak: 0.22 });
      },
    };
    board[id]?.();
  }

  // Eigener Sound: höchstens MAX_SOUND_SECONDS lang
  playUrl(url) {
    return new Promise((resolve) => {
      if (!this.volume) { resolve(); return; }
      const audio = new Audio(url);
      audio.volume = Math.min(1, this.volume);
      const done = () => { clearTimeout(timer); audio.pause(); resolve(); };
      const timer = setTimeout(done, MAX_SOUND_SECONDS * 1000);
      audio.addEventListener('ended', done, { once: true });
      audio.addEventListener('error', done, { once: true });
      audio.play().catch(done);
    });
  }
}

// ============================================================
// Wurf
// ============================================================
const rand = (a, b) => a + Math.random() * (b - a);
const SVG = 'http://www.w3.org/2000/svg';

// Fliegt von unten seitlich ins Bild, landet bei (x, y) in `layer` und
// hinterlässt je nach Gegenstand einen Fleck. Gibt ein Promise zurück,
// das nach dem Aufprall erfüllt ist.
export function throwItem(layer, { item, x, y, size = 110, sfx = null, onHit = null, reducedMotion = false }) {
  const it = itemById(item) ?? ITEMS[0];
  const w = layer.clientWidth;
  const h = layer.clientHeight;
  const dir = Math.random() < 0.5 ? -1 : 1;
  const tx = x + rand(-0.3, 0.3) * size;
  const ty = y + rand(-0.25, 0.25) * size;
  const sx = dir < 0 ? rand(-size, w * 0.15) : rand(w * 0.85, w + size);
  const sy = h + size;
  const cx = (sx + tx) / 2;
  const cy = Math.min(ty, h) - h * rand(0.35, 0.55);
  const spin = dir * -rand(360, 720);

  const el = document.createElement('span');
  el.className = 'pf-item';
  setItemIcon(el, it);
  el.style.fontSize = `${size}px`;
  layer.append(el);

  const at = (t) => {
    const u = 1 - t;
    const bx = u * u * sx + 2 * u * t * cx + t * t * tx;
    const by = u * u * sy + 2 * u * t * cy + t * t * ty;
    return `translate(${bx - size / 2}px, ${by - size / 2}px) rotate(${spin * t}deg) scale(${0.75 + 0.35 * t})`;
  };
  const frames = reducedMotion
    ? [{ transform: at(1), opacity: 0 }, { transform: at(1), opacity: 1 }]
    : Array.from({ length: 25 }, (_, i) => ({ transform: at(i / 24) }));
  const flight = el.animate(frames, { duration: reducedMotion ? 150 : rand(650, 800), easing: 'linear', fill: 'forwards' });
  sfx?.whoosh();

  return flight.finished.then(async () => {
    sfx?.hit(it.hit);
    onHit?.(it);
    if (it.splat) splat(layer, tx, ty, size * (it.cloud ? 2 : 1.6), it);
    if (it.nice) sparkles(layer, tx, ty, size);
    const end = at(1);
    if (it.boom) {
      el.remove();
      await explode(layer, tx, ty, size, reducedMotion);
      return;
    }
    if (it.stick) {
      // Banane und Unterhose bleiben kurz kleben und rutschen dann ab.
      await el.animate([
        { transform: `${end} scale(1.25, 0.8)` },
        { transform: end, offset: 0.1 },
        { transform: `${end} translateY(${size * 0.25}px)`, offset: 0.7 },
        { transform: `${end} translateY(${size * 1.4}px) rotate(40deg)`, opacity: 0 },
      ], { duration: 2600, easing: 'ease-in', fill: 'forwards' }).finished;
    } else {
      await el.animate([
        { transform: `${end} scale(1.3, 0.7)` },
        { transform: `${end} translateY(-${size * 0.2}px)`, offset: 0.2 },
        { transform: `${end} translateY(${h - ty + size}px) rotate(${dir * 160}deg)`, opacity: 0.9 },
      ], { duration: 1100, easing: 'cubic-bezier(.4,0,.9,.6)', fill: 'forwards' }).finished;
    }
    el.remove();
  });
}

// Fleck als SVG: zackiger Klecks mit Spritzern, bei Flüssigem mit Tropfen.
function splat(layer, x, y, size, it) {
  const r = size / 2;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', `pf-splat${it.cloud ? ' pf-splat--cloud' : ''}`);
  svg.setAttribute('viewBox', `${-r * 1.9} ${-r * 1.9} ${r * 3.8} ${r * 3.8}`);
  svg.style.width = svg.style.height = `${r * 3.8}px`;
  svg.style.left = `${x - r * 1.9}px`;
  svg.style.top = `${y - r * 1.9}px`;

  const n = 16;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (i % 2 ? rand(0.55, 0.8) : rand(0.85, 1.15));
    d += `${i ? 'L' : 'M'}${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr).toFixed(1)}`;
  }
  const blob = document.createElementNS(SVG, 'path');
  blob.setAttribute('d', `${d}Z`);
  blob.setAttribute('fill', it.splat);
  blob.setAttribute('stroke', it.splat);
  blob.setAttribute('stroke-width', String(r * 0.25));
  blob.setAttribute('stroke-linejoin', 'round');
  svg.append(blob);

  for (let i = 0; i < 7; i++) {
    const a = rand(0, Math.PI * 2);
    const dist = r * rand(1.2, 1.75);
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', (Math.cos(a) * dist).toFixed(1));
    c.setAttribute('cy', (Math.sin(a) * dist).toFixed(1));
    c.setAttribute('r', (r * rand(0.06, 0.16)).toFixed(1));
    c.setAttribute('fill', it.splat);
    svg.append(c);
  }
  if (it.drip) {
    for (let i = 0; i < 3; i++) {
      const drip = document.createElementNS(SVG, 'rect');
      const dw = r * rand(0.12, 0.2);
      drip.setAttribute('x', (rand(-0.6, 0.6) * r - dw / 2).toFixed(1));
      drip.setAttribute('y', '0');
      drip.setAttribute('width', dw.toFixed(1));
      drip.setAttribute('height', (r * rand(1.1, 1.7)).toFixed(1));
      drip.setAttribute('rx', (dw / 2).toFixed(1));
      drip.setAttribute('fill', it.splat);
      drip.setAttribute('class', 'pf-drip');
      drip.style.animationDelay = `${rand(0.2, 0.6).toFixed(2)}s`;
      svg.append(drip);
    }
  }
  const shine = document.createElementNS(SVG, 'ellipse');
  shine.setAttribute('cx', String(-r * 0.3));
  shine.setAttribute('cy', String(-r * 0.35));
  shine.setAttribute('rx', String(r * 0.28));
  shine.setAttribute('ry', String(r * 0.14));
  shine.setAttribute('fill', 'rgba(255,255,255,.35)');
  shine.setAttribute('transform', `rotate(-30 ${-r * 0.3} ${-r * 0.35})`);
  svg.append(shine);

  layer.append(svg);
  svg.animate([
    { transform: 'scale(.2)', opacity: 0.4 },
    { transform: 'scale(1.1)', opacity: 1, offset: 0.25 },
    { transform: 'scale(1)', opacity: 1, offset: 0.35 },
    { transform: 'scale(1)', opacity: 1, offset: 0.8 },
    { transform: 'scale(1.02) translateY(8px)', opacity: 0 },
  ], { duration: 3800, easing: 'ease-out', fill: 'forwards' }).finished.then(() => svg.remove());
}

// Blumen sind nett gemeint: Herzen steigen auf.
function sparkles(layer, x, y, size) {
  for (let i = 0; i < 7; i++) {
    const s = document.createElement('span');
    s.className = 'pf-item pf-spark';
    s.textContent = ['💖', '✨', '💕'][i % 3];
    s.style.fontSize = `${size * rand(0.25, 0.4)}px`;
    layer.append(s);
    const dx = rand(-1, 1) * size;
    const from = `translate(${x}px, ${y}px)`;
    s.animate([
      { transform: `${from} scale(.3)`, opacity: 0 },
      { transform: `${from} translate(${dx * 0.4}px, ${-size * 0.4}px) scale(1)`, opacity: 1, offset: 0.25 },
      { transform: `${from} translate(${dx}px, ${-size * rand(1.4, 2.2)}px) scale(.8)`, opacity: 0 },
    ], { duration: rand(1400, 2200), delay: i * 60, easing: 'ease-out', fill: 'both' }).finished.then(() => s.remove());
  }
}


// Nuke: Blitz, Feuerball, Druckwelle und ein Rauchpilz, der aufsteigt.
function explode(layer, x, y, size, reducedMotion = false) {
  const made = [];
  const add = (cls, css = {}) => {
    const el = document.createElement('span');
    el.className = cls;
    Object.assign(el.style, css);
    layer.append(el);
    made.push(el);
    return el;
  };
  const px = (v) => `${v}px`;
  const flash = add('pf-flash', { background: `radial-gradient(circle at ${px(x)} ${px(y)}, rgba(255, 255, 235, .95), rgba(255, 196, 80, .55) ${px(size * 1.4)}, rgba(255, 120, 30, 0) ${px(size * 4)})` });
  const runs = [flash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 0 }], { duration: reducedMotion ? 500 : 900, easing: 'ease-out', fill: 'forwards' })];
  if (!reducedMotion) {
    const fire = add('pf-fireball', { left: px(x - size * 1.2), top: px(y - size * 1.2), width: px(size * 2.4), height: px(size * 2.4) });
    runs.push(fire.animate([
      { transform: 'scale(.15)', opacity: 1 },
      { transform: 'scale(1.1)', opacity: 1, offset: 0.3 },
      { transform: 'scale(1.35)', opacity: 0 },
    ], { duration: 1300, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' }));
    const ring = add('pf-shock', { left: px(x - size), top: px(y - size), width: px(size * 2), height: px(size * 2), borderWidth: px(size * 0.1) });
    runs.push(ring.animate([{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(3.2)', opacity: 0 }], { duration: 950, easing: 'ease-out', fill: 'forwards' }));
    // Rauchpilz: Stiel-Wolken steigen, oben breitet sich der Hut aus
    const puffs = [
      ...Array.from({ length: 5 }, (_, i) => ({ dx: rand(-0.15, 0.15), dy: -0.4 - i * 0.35, r: 0.45 + i * 0.04 })),
      ...Array.from({ length: 7 }, (_, i) => ({ dx: (i - 3) * 0.32, dy: -2.1 + Math.abs(i - 3) * 0.14, r: 0.7 - Math.abs(i - 3) * 0.06 })),
    ];
    puffs.forEach((p, i) => {
      const r = size * p.r;
      const puff = add('pf-puff', { left: px(x - r), top: px(y - r), width: px(r * 2), height: px(r * 2) });
      runs.push(puff.animate([
        { transform: 'translate(0, 0) scale(.2)', opacity: 0 },
        { transform: `translate(${p.dx * size * 0.5}px, ${p.dy * size * 0.4}px) scale(.8)`, opacity: 0.95, offset: 0.2 },
        { transform: `translate(${p.dx * size}px, ${p.dy * size}px) scale(1.1)`, opacity: 0.9, offset: 0.65 },
        { transform: `translate(${p.dx * size * 1.2}px, ${(p.dy - 0.3) * size}px) scale(1.35)`, opacity: 0 },
      ], { duration: rand(2600, 3200), delay: 120 + i * 35, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'both' }));
    });
  }
  return Promise.all(runs.map((a) => a.finished)).then(() => made.forEach((el) => el.remove()));
}
