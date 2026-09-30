// Rexis Sounds (aus Claude Design „OBS Overlay v2“, rexi-sfx.js): alles Web Audio, keine Dateien.
// Neu gegenüber Sfx in prank-fx.js: rosa Rauschen, Rauheit per WaveShaper (grit),
// Amplitudenmodulation (trem), mehrere Filter hintereinander und voice() – ein
// Sägezahn durch drei Formant-Filter (a/o/u/e/r) klingt wie eine Stimme.
// Läuft über den Ausgang der Sfx-Instanz, also mit derselben Lautstärke und demselben Kompressor.
//
//   rexiSound(sfx, 'roar')   – roar, frenzy, chomp, bite, growl, hop, step, happy, burp, snore, whistle

const buffers = new WeakMap(); // AudioContext → { white, pink }
const DRIVE = (() => {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / n) * 2 - 1) * 3.2);
  return c;
})();
const rnd = (a, b) => a + Math.random() * (b - a);

function noiseBuffers(ctx) {
  let b = buffers.get(ctx);
  if (b) return b;
  const make = (fill) => {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    fill(buf.getChannelData(0));
    return buf;
  };
  b = {
    white: make((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }),
    pink: make((d) => {
      let b0 = 0; let b1 = 0; let b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
    }),
  };
  buffers.set(ctx, b);
  return b;
}

// Kleine Klangmaschine auf einem AudioContext und einem Ausgang
function engine(ctx, out) {
  function env(g, t0, { peak = 0.3, attack = 0.005, hold = 0, release = 0.3 }) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t0 + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
    return attack + hold + release;
  }
  function chain(src, t0, o, dur) {
    let node = src;
    for (const f of o.filters || (o.filter ? [o.filter] : [])) {
      const bq = ctx.createBiquadFilter();
      bq.type = f.type;
      bq.frequency.setValueAtTime(f.freq, t0);
      bq.Q.value = f.q ?? 1;
      if (f.to) bq.frequency.exponentialRampToValueAtTime(f.to, t0 + dur);
      node = node.connect(bq);
    }
    if (o.grit) {
      const ws = ctx.createWaveShaper();
      ws.curve = DRIVE;
      ws.oversample = '2x';
      const pre = ctx.createGain();
      pre.gain.value = o.grit;
      node = node.connect(pre).connect(ws);
    }
    return node;
  }
  function tone(freq, o = {}) {
    const t0 = ctx.currentTime + (o.at || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    const dur = env(g, t0, o);
    if (o.curve) osc.frequency.setValueCurveAtTime(o.curve, t0, dur);
    else {
      osc.frequency.setValueAtTime(freq, t0);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + (o.glide || dur));
    }
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const d = ctx.createGain();
      lfo.frequency.value = o.vibrato.rate;
      d.gain.setValueAtTime(o.vibrato.depth, t0);
      if (o.vibrato.fade) d.gain.exponentialRampToValueAtTime(0.5, t0 + dur);
      lfo.connect(d).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    if (o.trem) {
      const lfo = ctx.createOscillator();
      const d = ctx.createGain();
      const am = ctx.createGain();
      lfo.frequency.value = o.trem.rate;
      d.gain.value = o.trem.depth;
      am.gain.value = 1 - o.trem.depth;
      lfo.connect(d).connect(am.gain);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
      chain(osc, t0, o, dur).connect(am).connect(g).connect(out);
    } else {
      chain(osc, t0, o, dur).connect(g).connect(out);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  function noise(o = {}) {
    const t0 = ctx.currentTime + (o.at || 0);
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const { white, pink } = noiseBuffers(ctx);
    src.buffer = o.pink ? pink : white;
    src.loop = true;
    const dur = env(g, t0, o);
    const filters = o.filters || [{ type: o.type || 'lowpass', freq: o.freq || 1000, to: o.to, q: o.q }];
    chain(src, t0, { ...o, filters }, dur).connect(g).connect(out);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }
  // Vokal-Formanten: macht aus einem Sägezahn eine „Stimme“
  const FORMANTS = {
    a: [[800, 6, 1], [1150, 8, 0.5], [2900, 10, 0.25]],
    o: [[450, 6, 1], [800, 8, 0.45], [2830, 10, 0.15]],
    u: [[325, 6, 1], [700, 8, 0.3], [2530, 10, 0.1]],
    e: [[400, 6, 1], [1600, 8, 0.45], [2700, 10, 0.25]],
    r: [[600, 5, 1], [1040, 7, 0.5], [2250, 9, 0.3]],
  };
  function voice(freq, vowel, o) {
    for (const [f, q, a] of FORMANTS[vowel]) {
      tone(freq, { ...o, peak: (o.peak || 0.2) * a, filters: [{ type: 'bandpass', freq: f * (o.formant || 1), to: o.formantTo ? f * o.formantTo : undefined, q }] });
    }
  }
  return { tone, noise, voice };
}

const SOUNDS = {
  // Brüllen: Luft holen, dann ein kehliges „RAAWR“ mit Formant-Schwenk a→o und Rauheit
  roar({ tone, noise, voice }, big = 1) {
    const f = 150 / big;
    noise({ pink: true, type: 'bandpass', freq: 900, to: 1800, q: 1.2, attack: 0.18, release: 0.08, peak: 0.08 });
    const o = { at: 0.2, type: 'sawtooth', to: f * 0.62, glide: 0.9, attack: 0.06, hold: 0.45 * big, release: 0.5, peak: 0.34, grit: 2.2, vibrato: { rate: 31, depth: f * 0.14, fade: true }, formant: 1.15, formantTo: 0.8 };
    voice(f, 'a', o);
    voice(f * 1.5, 'r', { ...o, peak: 0.12, vibrato: { rate: 23, depth: f * 0.2, fade: true } });
    tone(f / 2, { at: 0.2, type: 'triangle', to: f * 0.3, attack: 0.05, hold: 0.4 * big, release: 0.6, peak: 0.35 * big });
    noise({ at: 0.2, pink: true, filters: [{ type: 'bandpass', freq: 1400, to: 500, q: 0.9 }], attack: 0.04, hold: 0.4 * big, release: 0.5, peak: 0.16, grit: 1.5 });
  },
  // Heißhunger: größer, tiefer, danach Magenknurren
  frenzy(e, _big, later) {
    SOUNDS.roar(e, 1.5);
    later(() => SOUNDS.growl(e), 1300);
  },
  // Kauen: Zähne klacken, dann kurzes Knuspern
  chomp({ tone, noise }) {
    tone(1900, { type: 'square', to: 900, release: 0.018, peak: 0.12, filter: { type: 'highpass', freq: 1200 } });
    tone(180, { to: 80, release: 0.07, peak: 0.3 });
    for (let i = 0; i < 5; i++) noise({ at: 0.02 + i * rnd(0.018, 0.032), type: 'bandpass', freq: rnd(1800, 3800), q: 2.5, release: rnd(0.015, 0.03), peak: rnd(0.12, 0.26) });
    noise({ at: 0.03, pink: true, type: 'lowpass', freq: 700, release: 0.09, peak: 0.12 });
  },
  // Karte anknabbern: splittert trockener, wie Pappe/Plastik
  bite({ tone, noise }) {
    tone(2400, { type: 'square', to: 1200, release: 0.015, peak: 0.1, filter: { type: 'highpass', freq: 1500 } });
    for (let i = 0; i < 9; i++) noise({ at: i * rnd(0.012, 0.028), type: 'bandpass', freq: rnd(2200, 5200), q: 4, release: rnd(0.01, 0.025), peak: rnd(0.1, 0.3) });
    noise({ at: 0.05, type: 'highpass', freq: 3000, attack: 0.01, release: 0.18, peak: 0.05 });
    for (let i = 0; i < 3; i++) tone(rnd(3200, 5200), { at: 0.2 + i * 0.07, type: 'triangle', release: 0.06, peak: 0.04 });
  },
  // Magenknurren: tiefes, blubberndes Grummeln mit unregelmäßigem Puls
  growl({ tone, voice }) {
    const n = 48;
    const curve = new Float32Array(n);
    let f = 70;
    for (let i = 0; i < n; i++) curve[i] = f = Math.min(95, Math.max(48, f + rnd(-9, 9)));
    tone(70, { type: 'sawtooth', curve, attack: 0.12, hold: 0.7, release: 0.4, peak: 0.26, grit: 1.8, trem: { rate: 11, depth: 0.7 }, filters: [{ type: 'lowpass', freq: 380, q: 3 }] });
    voice(95, 'u', { at: 0.05, type: 'sawtooth', attack: 0.15, hold: 0.55, release: 0.35, peak: 0.1, vibrato: { rate: 7, depth: 6 } });
    for (let i = 0; i < 3; i++) tone(rnd(140, 220), { at: 0.3 + i * rnd(0.15, 0.25), to: rnd(260, 380), release: 0.06, peak: 0.08 });
  },
  // Hüpfer: weicher Boing mit Fußaufsetzer
  hop({ tone }) {
    tone(300, { to: 700, release: 0.12, peak: 0.1, type: 'triangle' });
    tone(110, { at: 0.24, to: 60, release: 0.08, peak: 0.25 });
  },
  // Schritt: dumpfes Stapfen
  step({ tone, noise }) {
    tone(rnd(85, 105), { to: 45, release: 0.07, peak: 0.16 });
    noise({ pink: true, freq: 380, release: 0.04, peak: 0.05 });
  },
  // Freude: kleines „Juhu“ auf zwei Silben plus Glitzer
  happy({ tone, voice }) {
    voice(440, 'u', { type: 'sawtooth', to: 620, glide: 0.1, attack: 0.02, hold: 0.06, release: 0.08, peak: 0.12 });
    voice(660, 'e', { at: 0.16, type: 'sawtooth', to: 880, glide: 0.08, attack: 0.02, hold: 0.1, release: 0.18, peak: 0.12, vibrato: { rate: 9, depth: 18 } });
    [1568, 2093, 2637].forEach((f, i) => tone(f, { at: 0.34 + i * 0.06, release: 0.35, peak: 0.05 }));
  },
  // Satt: kurzes Schlucken und ein kleiner Rülpser
  burp({ tone, voice }) {
    tone(320, { to: 160, release: 0.08, peak: 0.12, filter: { type: 'bandpass', freq: 600, q: 3 } });
    voice(92, 'o', { at: 0.3, type: 'sawtooth', to: 70, attack: 0.03, hold: 0.22, release: 0.18, peak: 0.28, grit: 1.4, trem: { rate: 34, depth: 0.5 } });
  },
  // Schnarchen: rasselndes Einatmen, pfeifendes Ausatmen
  snore({ tone, noise }) {
    noise({ pink: true, filters: [{ type: 'bandpass', freq: 400, to: 650, q: 2 }], attack: 0.5, hold: 0.3, release: 0.3, peak: 0.2, grit: 1.2 });
    tone(60, { type: 'sawtooth', attack: 0.5, hold: 0.3, release: 0.3, peak: 0.12, trem: { rate: 26, depth: 0.85 }, filter: { type: 'lowpass', freq: 300 } });
    tone(1250, { at: 1.3, to: 950, attack: 0.3, hold: 0.25, release: 0.5, peak: 0.035, vibrato: { rate: 5, depth: 8 } });
    noise({ at: 1.3, pink: true, type: 'bandpass', freq: 1100, to: 700, q: 1, attack: 0.3, hold: 0.25, release: 0.5, peak: 0.07 });
  },
  // Trillerpfeife: Triller mit Kugel (Frequenz-Wackeln) – passt zur Mütze
  whistle({ tone, noise }) {
    for (const [at, hold] of [[0, 0.12], [0.24, 0.55]]) {
      tone(2750, { at, type: 'sine', attack: 0.02, hold, release: 0.08, peak: 0.12, vibrato: { rate: 38, depth: 180 } });
      tone(2780, { at, type: 'triangle', attack: 0.02, hold, release: 0.08, peak: 0.04, vibrato: { rate: 36, depth: 160 } });
      noise({ at, type: 'bandpass', freq: 2800, q: 2, attack: 0.02, hold, release: 0.08, peak: 0.05 });
    }
  },
};

export const REXI_SOUNDS = Object.keys(SOUNDS);

// Spielt einen von Rexis Sounds über die Sfx-Instanz (Lautstärke 0 oder ohne Freigabe: still)
export function rexiSound(sfx, id, big) {
  const ctx = sfx?.get?.();
  if (!ctx || !sfx.out || !SOUNDS[id]) return;
  try {
    SOUNDS[id](engine(ctx, sfx.out), big, (fn, ms) => setTimeout(fn, ms));
  } catch (err) {
    console.warn('Rexi-Sound fehlgeschlagen:', id, err);
  }
}
