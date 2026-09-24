// OBS-Overlay: als Browserquelle in OBS einbinden (Breite 1920, Höhe 1080).
// Wird das Glücksrad gedreht – per Kanalpunkte oder auf der Webseite –,
// erscheint es klein im Bild, dreht sich und zeigt das Ergebnis.
// Daneben läuft "Nächste Abfahrt" mit den kommenden Content-Ideen.
//
// Die Adresse baut der OBS-Dialog im Dashboard. Optionen, z. B. overlay.html?wheel=br&wsize=120
//   wheel=br|bl|bc|tr|tl|tc|0  Position Glücksrad (Standard br = unten rechts, bc/tc = Mitte), 0 = aus;
//                              oder frei: wheel=62.5,70 (linke obere Ecke in Prozent des Bildes) –
//                              so speichert es der OBS-Dialog, wenn man die Karte in der Vorschau verschiebt
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
//   bingo=tr|…|0               Position der Bingo-Karte (Standard tr = oben rechts), 0 = aus
//   bsize=100                  Größe der Bingo-Karte in Prozent (50 – 200)
//   bstyle=classic|neon|paper  Design der Bingo-Karte: bunt (Standard), Neon oder Papier
//   prank=0                    „Ärgere den Dave“ aus (Würfe und Sounds)
//   cam=35,25,30,40            Daves Kamera im Bild: links,oben,Breite,Höhe in Prozent – dort landen die Würfe
//   psize=100                  Größe der Wurfgeschosse in Prozent (50 – 200)
//   quest=tc|…|0               Position der Karte „Unangenehme Frage“ (Standard tc = oben Mitte), 0 = aus
//   qsize=100                  Größe der Fragen-Karte in Prozent (50 – 200)
//   pet=0                      Daves Dino aus (läuft sonst unten durchs Bild)
//   dsize=100                  Größe des Dinos in Prozent (50 – 200)
//   test=1                     Probe-Drehungen und -Würfe, zum Einrichten in OBS
//   edit=1                     nur für die Vorschau im OBS-Dialog: alle Karten stehen still und
//                              lassen sich mit der Maus verschieben, dazu der Kamera-Rahmen
import { CONFIG } from './config.js';
import { DEFAULT_TILES, DEFAULT_VARIANTS } from './defaults.js';
import { Wheel } from './wheel.js';
import { Sfx, prankText, setPrankIcon, throwItem } from './prank-fx.js';
import { bingoState, renderBingoGrid } from './bingo.js';
import { paintQuestionCard } from './questions.js';
import { DEFAULT_PET, Dino, runDino } from './pet.js';

const POSITIONS = ['br', 'bl', 'bc', 'tr', 'tl', 'tc'];
const TEST_EVERY_MS = 20000;
const TILES_REFRESH_MS = 60000;
const STALE_MS = 2 * 60 * 1000; // ältere Drehungen (z. B. nach Pause) nicht mehr zeigen

const params = new URLSearchParams(location.search);
const FREE = /^\d{1,3}(\.\d+)?,\d{1,3}(\.\d+)?$/;
const position = (value, fallback) => (value === '0' || value === 'off' ? null
  : POSITIONS.includes(value) || FREE.test(value ?? '') ? value : fallback);
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
  bingo: position(params.get('bingo'), 'tr'),
  bsize: number('bsize', 100, 50, 200) / 100,
  bstyle: ['neon', 'paper'].includes(params.get('bstyle')) ? params.get('bstyle') : 'classic',
  prank: flag('prank', true),
  cam: camera(params.get('cam')),
  psize: number('psize', 100, 50, 200) / 100,
  quest: position(params.get('quest'), 'tc'),
  qsize: number('qsize', 100, 50, 200) / 100,
  pet: flag('pet', true),
  dsize: number('dsize', 100, 50, 200) / 100,
  test: flag('test', false),
  edit: flag('edit', false),
};

// Kamera-Bereich "links,oben,Breite,Höhe" in Prozent des Bildes
function camera(value) {
  const parts = (value ?? '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return { x: 35, y: 25, w: 30, h: 40 };
  const [x, y, w, h] = parts.map((n) => Math.min(100, Math.max(0, n)));
  return { x, y, w: Math.max(2, Math.min(w, 100 - x)), h: Math.max(2, Math.min(h, 100 - y)) };
}

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

const root = document.documentElement.style;
root.setProperty('--ws', opt.wsize);
root.setProperty('--ns', opt.nsize);
root.setProperty('--m', `${opt.margin}px`);
root.setProperty('--bga', opt.bg);
root.setProperty('--ps', opt.psize);
root.setProperty('--bs', opt.bsize);
root.setProperty('--qs', opt.qsize);
root.setProperty('--dsz', `${Math.round(170 * opt.dsize)}px`);
if (opt.accent) root.setProperty('--accent', opt.accent);
$('ov-wlabel').textContent = opt.wlabel;
$('ov-nlabel').textContent = opt.nlabel;
if (opt.wheel) place($('ov-spin'), opt.wheel);
else $('ov-spin').remove();
if (opt.next) place($('ov-next'), opt.next);
else $('ov-next').remove();
if (opt.bingo) {
  place($('ov-bingo'), opt.bingo);
  $('ov-bingo').classList.add(`bingo-style-${opt.bstyle}`);
}
else $('ov-bingo').remove();
if (opt.quest) place($('ov-quest'), opt.quest);
else $('ov-quest').remove();
if (!opt.pet) $('ov-pet').remove();
if (opt.edit) setupEdit();

// Ecke (br, tl, …) per CSS-Klasse, freie Position als linke obere Ecke in Prozent.
// Frei platzierte Karten bleiben immer ganz im Bild, auch wenn sie wachsen.
function place(el, pos) {
  if (!FREE.test(pos)) { el.classList.add(`pos-${pos}`); return; }
  const [x, y] = pos.split(',').map(Number);
  el.classList.add('pos-free');
  el.dataset.x = x;
  el.dataset.y = y;
  keepInside(el);
  new ResizeObserver(() => keepInside(el)).observe(el);
  addEventListener('resize', () => keepInside(el));
}

function keepInside(el) {
  if (!el.classList.contains('pos-free')) return;
  const W = innerWidth;
  const H = innerHeight;
  const left = Math.min((Number(el.dataset.x) / 100) * W, Math.max(0, W - el.offsetWidth));
  const top = Math.min((Number(el.dataset.y) / 100) * H, Math.max(0, H - el.offsetHeight));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

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
  if (opt.prank) setupPranks(source);
  else $('ov-pranks').remove();
  if (opt.bingo) setupBingo(source);
  if (opt.quest) setupQuestions(source);
  if (opt.pet) setupPet(source);
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
    onPrank(cb) {
      sb.channel('overlay-pranks')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pranks' }, (p) => cb(p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal für Würfe fehlgeschlagen'); });
    },
    soundUrl: (path) => `${CONFIG.SUPABASE_URL}/storage/v1/object/public/sounds/${path.split('/').map(encodeURIComponent).join('/')}`,
    bingoCard: async () => (await rows(sb.from('bingo_card').select('*').eq('id', 1).maybeSingle())) ?? null,
    bingoItems: () => rows(sb.from('bingo_items').select('*')),
    onBingo(cb) {
      sb.channel('overlay-bingo')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bingo_card' }, (p) => cb(p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal fürs Bingo fehlgeschlagen'); });
    },
    bingoUrl: (path) => `${CONFIG.SUPABASE_URL}/storage/v1/object/public/bingo/${path.split('/').map(encodeURIComponent).join('/')}`,
    questionStage: async () => (await rows(sb.from('question_stage').select('*').eq('id', 1).maybeSingle())) ?? null,
    onQuestionStage(cb) {
      sb.channel('overlay-question')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'question_stage' }, (p) => cb(p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal für Fragen fehlgeschlagen'); });
    },
    pet: async () => {
      const row = await rows(sb.from('pet').select('*').eq('id', 1).maybeSingle());
      if (!row) throw new Error('Kein Dino in der Datenbank');
      return row;
    },
    onPet(cb) {
      sb.channel('overlay-pet')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pet' }, (p) => cb(p.new))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pet_events' }, (p) => cb(null, p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal für den Dino fehlgeschlagen'); });
    },
    // An wem darf der Dino knabbern? Wer zuletzt gefüttert, geworfen oder gedreht hat.
    async recentNames() {
      const since = new Date(Date.now() - 86400000).toISOString();
      const names = (q, key) => rows(q).then((r) => r.map((x) => x[key])).catch(() => []);
      const lists = await Promise.all([
        names(sb.from('pet_events').select('who').gte('created_at', since).limit(60), 'who'),
        names(sb.from('pranks').select('requested_by').gte('created_at', since).limit(60), 'requested_by'),
        names(sb.from('overlay_spins').select('requested_by').gte('created_at', since).limit(60), 'requested_by'),
      ]);
      return [...new Set(lists.flat().filter(Boolean))];
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
    onPrank(cb) {
      const known = new Set(read('pranks', []).map((p) => p.id));
      addEventListener('storage', (e) => {
        if (e.key !== 'zd_pranks') return;
        for (const prank of read('pranks', []).reverse()) {
          if (known.has(prank.id)) continue;
          known.add(prank.id);
          cb(prank);
        }
      });
    },
    soundUrl: (path) => read('sounds', []).find((x) => x.path === path)?.url ?? '',
    bingoCard: async () => read('bingo_card', null),
    bingoItems: async () => read('bingo_items', []),
    onBingo(cb) {
      addEventListener('storage', (e) => { if (e.key === 'zd_bingo_card') cb(read('bingo_card', null)); });
    },
    bingoUrl: (path) => read('bingo_items', []).find((i) => i.path === path)?.url ?? '',
    questionStage: async () => read('question_stage', null),
    onQuestionStage(cb) {
      addEventListener('storage', (e) => { if (e.key === 'zd_question_stage') cb(read('question_stage', null)); });
    },
    pet: async () => ({ ...DEFAULT_PET, last_fed_at: new Date().toISOString(), ...read('pet', {}) }),
    onPet(cb) {
      const known = new Set(read('pet_events', []).map((x) => x.id));
      addEventListener('storage', (e) => {
        if (e.key === 'zd_pet') cb(read('pet', null));
        if (e.key !== 'zd_pet_events') return;
        for (const ev of read('pet_events', []).reverse()) {
          if (known.has(ev.id)) continue;
          known.add(ev.id);
          cb(null, ev);
        }
      });
    },
    async recentNames() {
      const names = [...read('pet_events', []).map((x) => x.who), ...read('pranks', []).map((x) => x.requested_by), ...read('spins', []).map((x) => x.requested_by)];
      return [...new Set(names.filter(Boolean))];
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

  // Beim Einrichten steht das Rad still mit einem Beispiel-Ergebnis da.
  if (opt.edit) {
    const v = variants[0];
    card.style.setProperty('--c', opt.variantColor ? v.color : 'var(--accent)');
    $('ov-who').textContent = '@Beispiel löst Kanalpunkte ein';
    $('ov-variant').textContent = v.name;
    $('ov-result').textContent = v.segments[0].label;
    $('ov-detail').textContent = v.segments[0].detail;
    card.classList.add('is-in', 'is-done');
    requestAnimationFrame(() => wheel.resize());
    return;
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
    if (!list.length && opt.edit) {
      // Zum Einrichten auch ohne geplanten Termin zeigen, wo die Karte sitzt
      current = { title: 'Hier steht die nächste Idee', target_at: new Date(Date.now() + 3 * 86400e3 + 4 * 3600e3).toISOString() };
    } else if (!list.length) { current = null; card.hidden = true; return; } else current = null;
    current ??= list[index % list.length];
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
// Ärgere den Dave
// ============================================================
// Würfe fliegen sofort (auch mehrere gleichzeitig), Sounds laufen nacheinander.
function setupPranks(source) {
  const layer = $('ov-pranks');
  const feed = $('ov-prank-feed');
  const sfx = new Sfx({ volume: opt.volume });
  const box = () => ({
    x: (opt.cam.x / 100) * layer.clientWidth,
    y: (opt.cam.y / 100) * layer.clientHeight,
    w: (opt.cam.w / 100) * layer.clientWidth,
    h: (opt.cam.h / 100) * layer.clientHeight,
  });

  // Die Meldungen stehen über der Kamera – oder darunter, wenn oben kein Platz ist.
  const place = () => {
    const b = box();
    const above = b.y > 90;
    feed.style.left = `${b.x + b.w / 2}px`;
    feed.style.top = above ? '' : `${b.y + b.h + 12}px`;
    feed.style.bottom = above ? `${layer.clientHeight - b.y + 12}px` : '';
    feed.classList.toggle('is-below', !above);
  };
  place();
  addEventListener('resize', place);

  const say = (p) => {
    const el = document.createElement('p');
    el.className = 'ov-prank-msg';
    el.innerHTML = '<span aria-hidden="true"></span><b></b>';
    setPrankIcon(el.firstChild, p);
    el.lastChild.textContent = prankText(p);
    feed.append(el);
    while (feed.children.length > 4) feed.firstChild.remove();
    setTimeout(() => el.remove(), 4200);
  };

  const sounds = [];
  let playing = false;
  async function playSounds() {
    playing = true;
    while (sounds.length) {
      const p = sounds.shift();
      say(p);
      if (p.item === 'custom') await sfx.playUrl(source.soundUrl(p.sound_path));
      else { sfx.play(p.item); await wait(1800); }
      await wait(250);
    }
    playing = false;
  }

  function handle(p) {
    if (Date.now() - Date.parse(p.created_at) > STALE_MS) return;
    place(); // der Kamera-Rahmen kann sich beim Einrichten verschoben haben
    if (p.kind === 'throw') {
      const b = box();
      // Ziel: Gesichtshöhe, also eher die obere Mitte des Kamerabilds
      say(p);
      throwItem(layer, {
        item: p.item,
        x: b.x + b.w * (0.5 + (Math.random() - 0.5) * 0.35),
        y: b.y + b.h * (0.42 + (Math.random() - 0.5) * 0.3),
        size: Math.max(60, Math.min(b.w, b.h) * 0.42) * opt.psize,
        sfx,
      });
    } else if (sounds.length < 6) {
      sounds.push(p);
      if (!playing) playSounds();
    }
  }

  source.onPrank(handle);

  if (opt.test) {
    const items = ['tomato', 'banana', 'pie', 'egg', 'duck', 'flowers', 'snowball', 'sock', 'fish', 'undies', 'nuke', 'flashbang'];
    const names = ['Lokfuehrer_Lena', 'SchienenSeb', 'TTV_Weichensteller', 'Bahnhofskater', 'ICE_Irina'];
    let n = 0;
    const fake = () => {
      const who = names[Math.floor(Math.random() * names.length)];
      const now = new Date().toISOString();
      handle(n++ % 4 === 3
        ? { id: `test-${n}`, created_at: now, kind: 'sound', item: 'rimshot', requested_by: who }
        : { id: `test-${n}`, created_at: now, kind: 'throw', item: items[Math.floor(Math.random() * items.length)], requested_by: who });
    };
    setTimeout(fake, 4000);
    setInterval(fake, 7000);
  }
}

// ============================================================
// Fortnite-Bingo
// ============================================================
// Zeigt die aktuelle Karte; neue Haken bekommen einen Stempel, eine volle
// Linie ein großes "Bingo!". Ausgeblendete oder fehlende Karte = nichts zu sehen.
async function setupBingo(source) {
  const card$ = $('ov-bingo');
  const grid = $('ov-bingo-grid');
  const win = $('ov-bingo-win');
  const sfx = new Sfx({ volume: opt.volume });
  const urlFor = (path) => (path.startsWith('data:') ? path : source.bingoUrl(path));
  let card = await source.bingoCard().catch((err) => { console.warn('Overlay: Bingo nicht verfügbar', err); return null; });
  if (!card && opt.test) card = testCard();
  // Aktuelle Bilder – ein Admin kann Seltenheit und Zahl nachträglich ändern
  let items = new Map();
  const loadItems = async () => {
    const list = await source.bingoItems().catch(() => []);
    items = new Map(list.map((i) => [i.id, i]));
  };
  await loadItems();
  const itemOf = (cell) => items.get(cell.id);

  function show(next, stamped = null) {
    card = next;
    const visible = !!card?.cells?.length && (card.visible !== false || opt.edit);
    card$.hidden = !visible;
    if (!visible) return;
    card$.style.setProperty('--n', card.size);
    const bet = card.bet;
    const labels = bet?.status === 'active' || bet?.status === 'resolved';
    card$.classList.toggle('has-bet', labels);
    renderBingoGrid(grid, card, { urlFor, stamped, itemOf, labels });
    paintBet(bet);
    const st = bingoState(card);
    $('ov-bingo-progress').textContent = `${st.done}/${st.total}${st.count ? ` · ${st.count}× Bingo` : ''}`;
  }

  // Tipprunde: Aufruf mit Countdown, danach wer gewonnen hat
  const betEl = $('ov-bingo-bet');
  let betTimer = null;
  function paintBet(bet) {
    clearInterval(betTimer);
    const tick = () => {
      const left = bet?.status === 'active' ? Date.parse(bet.lock_at) - Date.now() : 0;
      if (bet?.status === 'active' && left > 0) {
        const s = Math.ceil(left / 1000);
        betEl.innerHTML = `🎯 Tippt mit Kanalpunkten: Welche Reihe wird zuerst voll? <b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b>`;
      } else if (bet?.status === 'active') {
        betEl.textContent = '🎯 Tipps sind zu – welche Reihe wird zuerst voll?';
        clearInterval(betTimer);
      } else if (bet?.status === 'resolved') {
        betEl.textContent = `🎯 ${bet.winner_title ?? 'Eine Reihe'} gewinnt – Kanalpunkte verteilt!`;
      }
    };
    const shown = bet?.status === 'active' || bet?.status === 'resolved';
    betEl.hidden = !shown;
    betEl.classList.toggle('is-won', bet?.status === 'resolved');
    if (!shown) return;
    tick();
    if (bet.status === 'active') betTimer = setInterval(tick, 1000);
  }

  async function update(next) {
    const same = card && next && card.created_at === next.created_at;
    if (!same) await loadItems(); // neue Karte: vielleicht neue Bilder
    const before = same ? bingoState(card).count : 0;
    const known = new Set(same ? card.marked : []);
    const stamped = same ? (next.marked ?? []).find((i) => !known.has(i)) ?? null : null;
    show(next, stamped);
    if (stamped !== null) sfx.hit('thud');
    if (same && bingoState(next).count > before) {
      win.classList.remove('is-on');
      void win.offsetWidth;
      win.classList.add('is-on');
      sfx.play('applause');
      sfx.play('gong');
    }
  }

  show(card);
  source.onBingo(update);

  // Probe: alle 9 Sekunden ein zufälliges Feld abhaken (nur hier, nicht gespeichert)
  if (opt.test) {
    setInterval(() => {
      if (!card) return;
      const open = card.cells.map((c, i) => i).filter((i) => !card.cells[i].free && !card.marked.includes(i));
      const marked = open.length ? [...card.marked, open[Math.floor(Math.random() * open.length)]] : card.cells.flatMap((c, i) => (c.free ? [i] : []));
      update({ ...card, marked });
    }, 9000);
  }
}

// ============================================================
// Unangenehme Fragen
// ============================================================
// Die Karte erscheint, sobald ein Admin eine Frage zeigt: erst die Frage (Gong),
// dann das Ergebnis – beantwortet (Applaus) oder Bestrafung (Buzzer).
async function setupQuestions(source) {
  const card = $('ov-quest');
  const sfx = new Sfx({ volume: opt.volume });
  let last = null;
  const show = (stage, { sound = true } = {}) => {
    const state = stage?.state ?? 'hidden';
    const visible = state !== 'hidden' && !!stage?.text;
    card.hidden = !visible;
    if (!visible) { last = stage; return; }
    const isNew = !last || last.question_id !== stage.question_id || last.state === 'hidden';
    const changed = !last || last.state !== state || isNew;
    paintQuestionCard(card, stage);
    if (isNew) {
      card.classList.remove('is-new');
      void card.offsetWidth;
      card.classList.add('is-new');
    }
    if (sound && changed) {
      if (state === 'ask') sfx.play('gong');
      else if (state === 'punished') { sfx.play('buzzer'); sfx.hit('thud'); }
      else if (state === 'answered') sfx.play('applause');
    }
    last = stage;
  };

  let stage = await source.questionStage().catch((err) => { console.warn('Overlay: Fragen nicht verfügbar', err); return null; });
  if (opt.test || opt.edit) {
    const samples = [
      { question_id: 't1', text: 'Was war dein peinlichster Moment im Stream?', author: 'Lokfuehrer_Lena' },
      { question_id: 't2', text: 'Wie oft hast du schon wegen einem Zug verschlafen?', author: 'Anonym' },
    ];
    let n = 0;
    const next = () => {
      const q = samples[n % samples.length];
      const step = Math.floor(n / samples.length) % 2 ? 'answered' : 'punished';
      show({ ...q, state: 'ask' });
      if (!opt.edit) setTimeout(() => show({ ...q, state: step, punishment: '10 Liegestütze – jetzt sofort' }), 6000);
      n++;
    };
    if (!stage || stage.state === 'hidden' || opt.edit) next();
    else show(stage, { sound: false });
    if (opt.test) setInterval(next, 14000);
  } else {
    show(stage, { sound: false });
  }
  source.onQuestionStage((next) => { if (next) show(next); });
}

// ============================================================
// Daves Dino
// ============================================================
async function setupPet(source) {
  const layer = $('ov-pet');
  let pet;
  try {
    pet = await source.pet();
  } catch (err) {
    console.warn('Overlay: kein Dino (Migration …_questions_pet.sql fehlt?)', err);
    layer.remove();
    return;
  }
  const sfx = new Sfx({ volume: opt.volume * 0.8 });
  const dino = new Dino(layer, { size: Math.round(170 * opt.dsize), sfx, name: pet.name });
  if (opt.test) {
    // Probe: Sprüche und Knabbern im Schnelldurchlauf
    pet = { ...pet, last_fed_at: new Date(Date.now() - 86400000).toISOString() };
  }
  runDino(dino, {
    getPet: () => pet,
    names: async () => {
      const list = await source.recentNames().catch(() => []);
      return list.length ? list : opt.test ? ['Lokfuehrer_Lena', 'SchienenSeb', 'Bahnhofskater'] : [];
    },
    idleEvery: opt.test ? [8, 14] : [45, 90],
    nibbleEvery: opt.test ? [16, 24] : [40, 75],
  });
  source.onPet((row, ev) => {
    if (row) {
      pet = row;
      dino.setName(row.name);
    }
    if (!ev || Date.now() - Date.parse(ev.created_at) > STALE_MS) return;
    if (ev.kind === 'feed') {
      pet = { ...pet, last_fed_at: ev.created_at, last_fed_by: ev.who };
      dino.eat(ev.who);
    } else if (ev.kind === 'pet') {
      dino.cuddle(ev.who);
    } else if (ev.kind === 'say') {
      dino.say(ev.text, 5500);
    }
  });
}

// Probekarte für die Vorschau, solange noch keine echte gezogen ist
function testCard() {
  const items = [['🔫', 'Sturmgewehr'], ['💊', 'Medkit'], ['🧪', 'Schildtrank'], ['🎣', 'Angel'], ['🏹', 'Bogen'],
    ['💣', 'Granate'], ['🍌', 'Banane'], ['🛡️', 'Schild'], ['🚗', 'Auto'], ['🔑', 'Tresorschlüssel'], ['🍄', 'Pilz'], ['📦', 'Truhe']];
  const svg = (emoji) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="72" font-size="70" text-anchor="middle">${emoji}</text></svg>`)}`;
  const rarities = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common', 'exotic', null];
  const cells = [['💀', 'Kill', 5], ...items.sort(() => Math.random() - 0.5).slice(0, 7)].sort(() => Math.random() - 0.5)
    .map(([e, name, amount], i) => ({ id: `t${i}`, name, path: svg(e), ...(rarities[i] ? { rarity: rarities[i] } : {}), ...(amount ? { amount } : {}) }));
  cells.splice(4, 0, { free: true });
  return { size: 3, cells, marked: [4], visible: true, created_at: 'test' };
}

// ============================================================
// Einrichten (edit=1): Karten und Kamera-Rahmen mit der Maus verschieben
// ============================================================
// Läuft nur in der Vorschau des OBS-Dialogs. Jede fertige Bewegung geht per
// postMessage an die Seite, die daraus die Adresse für OBS baut.
function setupEdit() {
  document.body.classList.add('is-edit');
  if (opt.prank) {
    const cam = document.createElement('div');
    cam.id = 'ov-cam';
    cam.className = 'ov-cam-frame';
    cam.dataset.drag = 'cam';
    cam.innerHTML = '<span>Daves Kamera</span><i class="ov-cam-handle" data-resize title="Größe ändern"></i>';
    document.body.append(cam);
    setCam(opt.cam);
  }
  for (const [id, key] of [['ov-spin', 'wheel'], ['ov-next', 'next'], ['ov-bingo', 'bingo'], ['ov-quest', 'quest']]) {
    if ($(id)) $(id).dataset.drag = key;
  }
  addEventListener('pointerdown', startDrag);
  // Die Seite schickt den Kamera-Bereich, wenn sie ihn aus OBS ausgelesen hat.
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'stellwerk-cam') return;
    opt.cam = camera(e.data.value);
    setCam(opt.cam);
  });
}

function setCam({ x, y, w, h }) {
  const cam = $('ov-cam');
  if (cam) Object.assign(cam.style, { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` });
}

function startDrag(e) {
  const el = e.target.closest('[data-drag]');
  if (!el || e.button !== 0) return;
  e.preventDefault();
  const resize = !!e.target.closest('[data-resize]');
  const W = innerWidth;
  const H = innerHeight;
  const r = el.getBoundingClientRect();
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let moved = false;
  el.setPointerCapture(e.pointerId);
  el.classList.add('is-dragging');

  const move = (ev) => {
    const dx = ev.clientX - e.clientX;
    const dy = ev.clientY - e.clientY;
    moved ||= Math.abs(dx) + Math.abs(dy) > 2;
    if (resize) {
      el.style.width = `${clamp(r.width + dx, 60, W - r.left)}px`;
      el.style.height = `${clamp(r.height + dy, 60, H - r.top)}px`;
      return;
    }
    let left = clamp(r.left + dx, 0, W - r.width);
    let top = clamp(r.top + dy, 0, H - r.height);
    // Einrasten am Rand (im eingestellten Abstand) und in der Mitte
    const snap = (v, size, total) => {
      for (const t of [opt.margin, (total - size) / 2, total - size - opt.margin, 0, total - size]) {
        if (Math.abs(v - t) < 18) return t;
      }
      return v;
    };
    left = snap(left, r.width, W);
    top = snap(top, r.height, H);
    el.classList.remove(...POSITIONS.map((p) => `pos-${p}`));
    el.classList.add('pos-free');
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };

  const up = () => {
    el.removeEventListener('pointermove', move);
    el.classList.remove('is-dragging');
    if (!moved) return;
    const pct = (v, total) => Math.round((v / total) * 1000) / 10;
    const b = el.getBoundingClientRect();
    const key = el.dataset.drag;
    const value = key === 'cam'
      ? [pct(b.left, W), pct(b.top, H), pct(b.width, W), pct(b.height, H)].join(',')
      : `${pct(b.left, W)},${pct(b.top, H)}`;
    if (key !== 'cam') {
      el.dataset.x = pct(b.left, W);
      el.dataset.y = pct(b.top, H);
    } else {
      opt.cam = camera(value);
    }
    parent.postMessage({ type: 'stellwerk-obs', key, value }, location.origin);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up, { once: true });
  el.addEventListener('pointercancel', up, { once: true });
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
