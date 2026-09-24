// OBS-Overlay: als Browserquelle in OBS einbinden (Breite 1920, Höhe 1080).
// Wird das Glücksrad gedreht – per Kanalpunkte oder auf der Webseite –,
// erscheint es klein im Bild, dreht sich und zeigt das Ergebnis.
// Daneben läuft "Nächste Abfahrt" mit den kommenden Content-Ideen.
//
// Die Adresse baut der OBS-Dialog im Dashboard. Optionen, z. B. overlay.html?wheel=br&wsize=120
//   wheel=br|bl|bc|tr|tl|tc|0  Position Glücksrad (Standard br = unten rechts, bc/tc = Mitte), 0 = aus
//   next=…|0                   Position "Nächste Abfahrt" (Standard bl)
//   wsize=100 / nsize=100      Größe der Karten in Prozent (50 – 200); scale=1.2 gilt für beide
//   hold=9                     Sekunden, die das Ergebnis stehen bleibt (3 – 60)
//   from=all|twitch|web        welche Drehungen: alle, nur Kanalpunkte, nur Webseite
//   always=1                   Glücksrad dauerhaft zeigen, nicht nur beim Drehen
//   vcolor=0                   Glücksrad-Karte in der Akzentfarbe statt in der Farbe der Variante
//   wlabel=… / nlabel=…        Überschriften der Karten
//   rotate=12                  Sekunden bis zur nächsten Content-Idee (5 – 120)
//   margin=40                  Abstand zum Bildrand in Pixeln (0 – 300)
//   bg=94                      Deckkraft des Kartenhintergrunds in Prozent (0 – 100)
//   accent=ffb81c              Akzentfarbe (Hex)
//   vol=100                    Lautstärke in Prozent, 0 = ohne Ton (sound=0 geht auch)
//   test=1                     alle 20 Sekunden eine Probe-Drehung, zum Einrichten in OBS
import { CONFIG } from './config.js';
import { DEFAULT_TILES, DEFAULT_VARIANTS } from './defaults.js';
import { Wheel } from './wheel.js';

const POSITIONS = ['br', 'bl', 'bc', 'tr', 'tl', 'tc'];
const TEST_EVERY_MS = 20000;
const TILES_REFRESH_MS = 60000;
const STALE_MS = 2 * 60 * 1000; // ältere Drehungen (z. B. nach Pause) nicht mehr zeigen

const params = new URLSearchParams(location.search);
const position = (value, fallback) => (value === '0' || value === 'off' ? null : POSITIONS.includes(value) ? value : fallback);
const flag = (name, fallback) => (params.has(name) ? !['0', 'false', 'off'].includes(params.get(name)) : fallback);
const number = (name, fallback, min, max) => {
  const raw = params.get(name);
  const n = raw === null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (name, fallback) => (params.get(name) ?? '').trim().slice(0, 40) || fallback;
const legacyScale = number('scale', 1, 0.5, 2) * 100;
const accent = (params.get('accent') ?? '').replace(/^#/, '');
const opt = {
  wheel: position(params.get('wheel'), 'br'),
  next: position(params.get('next'), 'bl'),
  wsize: number('wsize', legacyScale, 50, 200) / 100,
  nsize: number('nsize', legacyScale, 50, 200) / 100,
  holdMs: number('hold', 9, 3, 60) * 1000,
  from: ['twitch', 'web'].includes(params.get('from')) ? params.get('from') : 'all',
  always: flag('always', false),
  variantColor: flag('vcolor', true),
  wlabel: text('wlabel', 'Glücksrad'),
  nlabel: text('nlabel', 'Nächste Abfahrt'),
  rotateMs: number('rotate', 12, 5, 120) * 1000,
  margin: number('margin', 40, 0, 300),
  bg: number('bg', 94, 0, 100) / 100,
  accent: /^[0-9a-f]{6}$/i.test(accent) ? `#${accent}` : null,
  volume: params.get('sound') === '0' ? 0 : number('vol', 100, 0, 100) / 100,
  test: flag('test', false),
};

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

const root = document.documentElement.style;
root.setProperty('--ws', opt.wsize);
root.setProperty('--ns', opt.nsize);
root.setProperty('--m', `${opt.margin}px`);
root.setProperty('--bga', opt.bg);
if (opt.accent) root.setProperty('--accent', opt.accent);
$('ov-wlabel').textContent = opt.wlabel;
$('ov-nlabel').textContent = opt.nlabel;
if (opt.wheel) $('ov-spin').classList.add(`pos-${opt.wheel}`);
else $('ov-spin').remove();
if (opt.next) $('ov-next').classList.add(`pos-${opt.next}`);

let variants = DEFAULT_VARIANTS;
let tiles = [];

start();

async function start() {
  const source = await connect().catch((err) => {
    console.error('Overlay: keine Verbindung zu Supabase', err);
    return demoSource();
  });
  const loaded = await source.variants().catch(() => null);
  if (loaded?.length) variants = loaded;
  tiles = await source.tiles().catch(() => []);

  if (opt.wheel) setupSpins(source);
  if (opt.next) setupNext(source);
}

// ============================================================
// Datenquelle
// ============================================================
// Live liest das Overlay ohne Anmeldung (anon) – freigegeben sind nur
// Kacheln, Varianten und der Feed overlay_spins (Migration …_overlay.sql).
async function connect() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return demoSource();
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows = async (query) => { const { data, error } = await query; if (error) throw error; return data; };
  return {
    variants: () => rows(sb.from('wheel_variants').select('*').order('position')),
    tiles: () => rows(sb.from('tiles').select('*').order('position')),
    onSpin(cb) {
      sb.channel('overlay-feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'overlay_spins' }, (p) => cb(p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal fehlgeschlagen'); });
    },
  };
}

// Demo-Modus: dieselben Daten wie die Demo-Seite. Läuft die Seite im selben
// Browser, kommen neue Drehungen über das storage-Ereignis von localStorage.
function demoSource() {
  const read = (key, fallback) => {
    try { const v = localStorage.getItem(`zd_${key}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  };
  return {
    variants: async () => DEFAULT_VARIANTS,
    tiles: async () => read('tiles', DEFAULT_TILES),
    onSpin(cb) {
      const known = new Set(read('spins', []).map((s) => s.id));
      addEventListener('storage', (e) => {
        if (e.key !== 'zd_spins') return;
        for (const spin of read('spins', []).reverse()) {
          if (known.has(spin.id)) continue;
          known.add(spin.id);
          cb(spin);
        }
      });
    },
  };
}

// ============================================================
// Glücksrad
// ============================================================
function setupSpins(source) {
  const card = $('ov-spin');
  const pointer = $('ov-pointer');
  const wheel = new Wheel($('ov-canvas'), {
    onTick() {
      pointer.classList.remove('tick');
      void pointer.offsetWidth;
      pointer.classList.add('tick');
      sound.tick();
    },
  });
  wheel.setVariant(variants[0]);

  const queue = [];
  let playing = false;

  const enqueue = (spin) => {
    if (opt.from !== 'all' && spin.source !== opt.from) return;
    queue.push(spin);
    if (!playing) play();
  };

  // Dauerhaft sichtbar: zwischen den Drehungen wartet das Rad mit einem Hinweis.
  function idle() {
    $('ov-who').textContent = opt.from === 'web' ? 'wartet auf die nächste Drehung' : 'Kanalpunkte einlösen zum Drehen';
    $('ov-status').textContent = 'Bereit';
    card.classList.remove('is-done');
    card.classList.add('is-idle');
  }
  if (opt.always) {
    const first = variants[0];
    card.style.setProperty('--c', opt.variantColor ? first.color : 'var(--accent)');
    $('ov-variant').textContent = first.name;
    idle();
    card.classList.add('is-in');
  }

  async function play() {
    playing = true;
    while (queue.length) {
      const spin = queue.shift();
      if (Date.now() - Date.parse(spin.created_at) > STALE_MS) continue;
      await show(spin).catch((err) => console.error('Overlay: Anzeige fehlgeschlagen', err));
    }
    playing = false;
  }

  async function show(spin) {
    const variant = variants.find((v) => v.id === spin.variant_id) ?? variants[0];
    const index = Math.min(Math.max(0, spin.segment_index | 0), variant.segments.length - 1);

    card.style.setProperty('--c', opt.variantColor ? variant.color : 'var(--accent)');
    $('ov-who').textContent = spin.source === 'twitch'
      ? `@${spin.requested_by} löst Kanalpunkte ein`
      : `${spin.requested_by} dreht`;
    $('ov-variant').textContent = variant.name;
    $('ov-status').textContent = 'Das Rad dreht sich …';
    $('ov-result').textContent = spin.result;
    $('ov-detail').textContent = spin.detail;
    card.classList.remove('is-done', 'is-idle');
    wheel.setVariant(variant);

    const entering = !card.classList.contains('is-in');
    card.classList.add('is-in');
    sound.whoosh();
    if (entering) await wait(600);
    wheel.resize();
    wheel.start();
    await wait(900);
    await wheel.spinTo(index);

    card.classList.add('is-done');
    sound.ding();
    await wait(opt.holdMs);
    if (opt.always) { idle(); return; }
    card.classList.remove('is-in');
    await wait(700);
  }

  source.onSpin(enqueue);

  if (opt.test) {
    const fake = () => {
      if (playing) return;
      const v = variants[Math.floor(Math.random() * variants.length)];
      const i = Math.floor(Math.random() * v.segments.length);
      const names = ['Lokfuehrer_Lena', 'SchienenSeb', 'TTV_Weichensteller', 'Bahnhofskater', 'ICE_Irina'];
      enqueue({
        id: `test-${Date.now()}`, created_at: new Date().toISOString(), source: opt.from === 'web' ? 'web' : 'twitch',
        variant_id: v.id, variant_name: v.name, segment_index: i,
        result: v.segments[i].label, detail: v.segments[i].detail,
        requested_by: names[Math.floor(Math.random() * names.length)],
      });
    };
    setTimeout(fake, 1500);
    setInterval(fake, TEST_EVERY_MS);
  }
}

// ============================================================
// Nächste Abfahrt
// ============================================================
function setupNext(source) {
  const card = $('ov-next');
  const body = $('ov-next-body');
  const units = [...$('ov-countdown').querySelectorAll('b')];
  let index = 0;
  let current = null;

  const upcoming = () => tiles
    .filter((t) => t.kind === 'countdown' && t.target_at && Date.parse(t.target_at) > Date.now())
    .sort((a, b) => Date.parse(a.target_at) - Date.parse(b.target_at));

  function pick() {
    const list = upcoming();
    if (!list.length) { current = null; card.hidden = true; return; }
    current = list[index % list.length];
    card.hidden = false;
    $('ov-next-title').textContent = current.title;
    const d = new Date(current.target_at);
    $('ov-next-date').textContent = `${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} · ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    tick();
  }

  function tick() {
    if (!current) return;
    let s = Math.max(0, Math.floor((Date.parse(current.target_at) - Date.now()) / 1000));
    if (s === 0) { pick(); return; }
    const values = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
    units.forEach((u, i) => { const t = pad(values[i]); if (u.textContent !== t) u.textContent = t; });
  }

  async function rotate() {
    if (upcoming().length < 2) return;
    body.classList.add('is-switching');
    await wait(350);
    index++;
    pick();
    body.classList.remove('is-switching');
  }

  pick();
  setInterval(tick, 1000);
  setInterval(rotate, opt.rotateMs);
  setInterval(async () => {
    tiles = await source.tiles().catch(() => tiles);
    pick();
  }, TILES_REFRESH_MS);
  addEventListener('storage', (e) => { if (e.key === 'zd_tiles') source.tiles().then((t) => { tiles = t; pick(); }); });
}

// ============================================================
// Ton – in OBS darf die Browserquelle ohne Klick abspielen.
// "Audio über OBS steuern" in der Quelle macht ihn im Mixer regelbar.
// ============================================================
const sound = {
  ctx: null,
  get() {
    if (!opt.volume) return null;
    try {
      this.ctx ??= new (window.AudioContext ?? window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { return null; }
    return this.ctx.state === 'running' ? this.ctx : null;
  },
  tone(freq, { type = 'sine', at = 0, peak = 0.2, decay = 0.4 } = {}) {
    const ctx = this.get();
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * opt.volume), t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + decay + 0.05);
  },
  tick() { this.tone(1900, { type: 'triangle', peak: 0.05, decay: 0.03 }); },
  whoosh() { this.tone(220, { type: 'sine', peak: 0.06, decay: 0.35 }); },
  // Zweiklang wie ein kurzer Bahnhofsgong
  ding() {
    this.tone(659.25, { peak: 0.22, decay: 1.2 });
    this.tone(880, { at: 0.22, peak: 0.2, decay: 1.6 });
  },
};
