// Kanal-Jubiläum im OBS-Overlay (nur Mods lösen es aus): ein zweiminütiger Film über das ganze
// Bild, nach dem Claude-Design „1 Jahr Kanal v2“ (Nocturne). Die Choreografie ist dieselbe –
// jede Szene ist eine Funktion der Film-Zeit T –, nur ohne React: die Elemente werden einmal
// gebaut und je Bild neu gestellt.
// Alle Daten kommen vom Kanal, in dem der Film läuft (Edge Function stream-tools
// {action:"anniversary"} → pranks.data): Name, Profilbild, Tage/Jahre auf Twitch, Follower,
// Watchtime, Content-Ideen, Mods, nächster Termin. Der Chat kommt live dazu.
import { CHAT_BOTS, connectTwitchChat } from './twitch-chat.js';

const SCENES = [['Intro', 8], ['Anfang', 12], ['Zahlen', 22], ['Content', 22], ['Community', 20], ['Mods', 16], ['Ausblick', 12], ['Finale', 8]];
const CUES = {};
let TOTAL = 0;
for (const [name, dur] of SCENES) { CUES[name] = TOTAL; TOTAL += dur; }

const C = {
  bg: '#161826', surface: '#232532', text: '#e9e9ed',
  n300: '#cfd3e5', n400: '#b2b6ca', n500: '#9397ab', n700: '#595d6c', n800: '#3f424d', n900: '#292b31',
  a300: '#d2cefd', a400: '#b5abfc', a900: '#2b2741', sectionGhost: '#4c5397', divider: 'rgba(233,233,237,0.16)',
};
const L = 160;
const LOGO = new URL('../assets/favicon.svg', import.meta.url).href;

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const Easing = {
  easeOutCubic: (t) => (--t) * t * t + 1,
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
const P = (t, a, b) => clamp((t - a) / (b - a));
const MOTION = {
  enter: (t, a, d = 0.8) => Easing.easeOutCubic(P(t, a, a + d)),
  draw: (t, a, d = 1.2) => Easing.easeInOutSine(P(t, a, a + d)),
  pop: (t, a, d = 0.7) => Easing.easeOutBack(P(t, a, a + d)),
};
const win = (T, a, b, fi = 0.8, fo = 0.7) => MOTION.enter(T, a, fi) * (1 - MOTION.enter(T, b - fo, fo));
const rise = (e, px = 36) => `translateY(${(1 - e) * px}px)`;
const rgba = (hex, a) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const fmt = (n) => Math.max(0, Math.round(n) || 0).toLocaleString('de-DE');
const fadeRule = (color) => `linear-gradient(to right, transparent, ${color} 48px, ${color} calc(100% - 48px), transparent)`;
const rnd = (i, n) => { const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };

// Kleines DOM-Werkzeug: Element mit Stil (und Text) an ein Elternelement hängen
function node(parent, style = {}, text = null, tag = 'div') {
  const el = document.createElement(tag);
  Object.assign(el.style, style);
  if (text !== null) el.textContent = text;
  parent.append(el);
  return el;
}
const abs = (parent, x, y, style = {}, text = null) => node(parent, { position: 'absolute', left: `${x}px`, top: `${y}px`, ...style }, text);
function kicker(parent, accent, text, color = C.n400) {
  const k = node(parent, { display: 'flex', alignItems: 'center', gap: '16px', fontSize: '26px', letterSpacing: '0.16em', textTransform: 'uppercase', color, fontWeight: '500' });
  node(k, { width: '32px', height: '2px', background: accent, display: 'block' }, null, 'span');
  node(k, {}, text, 'span');
  return k;
}
const show = (el, o, transform = null) => {
  el.style.opacity = o;
  if (transform !== null) el.style.transform = transform;
};

// Alles, was der Film zeigt, aus den Kanaldaten ableiten
export function anniversaryProps(data, accent) {
  const d = data ?? {};
  const since = d.since && !Number.isNaN(Date.parse(d.since)) ? new Date(d.since) : null;
  const days = since ? Math.max(1, Math.round((Date.now() - since) / 864e5)) : 365;
  const years = Math.max(1, Math.floor(days / 365.25));
  const name = String(d.name || d.login || 'Kanal');
  const stats = [
    [d.followers, 'Follower'], [d.watch_hours, 'Stunden zusammen geschaut'], [d.chatters, 'Zuschauer im Chat'],
    [d.bits, 'Bits gecheert'], [d.subs, 'Abos gefeiert'], [days, 'Tage auf Twitch'], [d.content_count, 'Content-Ideen'],
  ].filter(([v]) => Number(v) > 0).slice(0, 4).map(([value, label]) => ({ value: Number(value), label }));
  const next = d.next?.title && !Number.isNaN(Date.parse(d.next.at)) ? d.next : null;
  return {
    days, years, yearWord: years === 1 ? 'Jahr' : 'Jahre', accent: accent || '#9184d9',
    channel: name, login: String(d.login || '').toLowerCase(), avatar: d.avatar || '',
    introLine: `Happy Birthday, ${name}.`,
    startDate: since ? since.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Tag 1',
    firstTitle: d.since_kind === 'custom' ? 'Der erste Stream' : `${name} startet auf Twitch`,
    bridgeLine: d.followers > 0 ? `Heute sind wir ${fmt(d.followers)} Follower.` : 'Heute sind wir ein paar mehr.',
    stats,
    statsKicker: years === 1 ? 'Ein Jahr in Zahlen' : `${years} Jahre in Zahlen`,
    statsLine: 'Und jede Minute davon hat sich gelohnt.',
    highlights: (d.content ?? []).slice(0, 8),
    communityLine: 'Ihr habt diesen Kanal gemacht.',
    communitySub: 'Danke für jede Nachricht, jeden Follow und jedes Abo.',
    top: (d.top ?? []).slice(0, 10),
    mods: (d.mods ?? []).slice(0, 12),
    modsLine: 'Ohne euch wäre hier jeden Abend Chaos.',
    outlookKicker: `Jahr ${years + 1}`,
    outlookLine: 'Wir fangen gerade erst an.',
    nextTitle: next?.title ?? '',
    nextDate: next ? new Date(next.at).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : '',
    finaleLine: 'Bis zum nächsten Stream.',
  };
}

// host: document.body · data: pranks.data · accent: Akzentfarbe des Overlays · sfx: Ton der Ebene „Würfe & Sounds“
export function startAnniversary({ host = document.body, data, accent, sfx, onEnd = () => {} }) {
  const p = anniversaryProps(data, accent);
  const root = node(host, { position: 'fixed', inset: '0', zIndex: '65', overflow: 'hidden', background: C.bg, pointerEvents: 'none', opacity: '0', transition: 'opacity .8s ease' });
  root.className = 'ov-anniv';
  root.setAttribute('aria-hidden', 'true');
  const stage = node(root, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', transformOrigin: '0 0', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif', color: C.text, fontWeight: '500', textShadow: 'none' });
  const fit = () => {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `translate(${(innerWidth - 1920 * s) / 2}px, ${(innerHeight - 1080 * s) / 2}px) scale(${s})`;
  };
  fit();
  addEventListener('resize', fit);
  requestAnimationFrame(() => { root.style.opacity = '1'; });

  // Live-Chat für die Community-Szene
  const chat = [];
  const stopChat = p.login ? connectTwitchChat(p.login, {
    message: (m) => {
      if (CHAT_BOTS.includes(String(m.login).toLowerCase())) return;
      chat.push({ name: m.name, text: String(m.text).slice(0, 90), at: tNow() });
      if (chat.length > 40) chat.shift();
    },
  }) : () => {};

  const scenes = [background, intro, anfang, zahlen, content, community, mods, ausblick, finale, sparklesGlobal, bursts]
    .map((build) => build(stage, p));
  const start = performance.now();
  const tNow = () => (performance.now() - start) / 1000;
  let raf = 0;
  let ended = false;
  const chimes = [
    [CUES.Intro + 4.3, () => chord([523.25, 659.25, 783.99, 1046.5])],
    [CUES.Zahlen + 14.2, () => chord([659.25, 783.99, 987.77])],
    [CUES.Finale + 0.7, () => chord([523.25, 659.25, 783.99, 1046.5, 1318.5])],
  ];
  function chord(notes) {
    notes.forEach((f, i) => sfx?.tone(f, { at: i * 0.08, type: 'triangle', release: 0.9, peak: 0.1 }));
  }
  const frame = () => {
    const T = tNow();
    for (const update of scenes) update(T, chat);
    while (chimes.length && T >= chimes[0][0]) chimes.shift()[1]();
    if (T >= TOTAL) { stop(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  function stop() {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    stopChat();
    root.style.opacity = '0';
    setTimeout(() => { removeEventListener('resize', fit); root.remove(); onEnd(); }, 900);
  }
  return { stop };
}

// ---------- Szenen (jede baut ihre Elemente und liefert update(T)) ----------
function background(stage, p) {
  const base = node(stage, { position: 'absolute', inset: '0', background: C.bg });
  const glow = node(stage, { position: 'absolute', inset: '0' });
  const sec = node(stage, { position: 'absolute', inset: '0' });
  return (T) => {
    const s = win(T, CUES.Zahlen, CUES.Content, 1.0, 1.0);
    const gx = 1400 + Math.sin(T * 0.11) * 260, gy = 300 + Math.cos(T * 0.09) * 160;
    const hx = 300 + Math.cos(T * 0.07) * 200, hy = 900 + Math.sin(T * 0.13) * 90;
    glow.style.background = `radial-gradient(900px 700px at ${gx}px ${gy}px, ${rgba(C.n500, 0.10)}, transparent 70%), radial-gradient(800px 600px at ${hx}px ${hy}px, ${rgba(C.sectionGhost, 0.14)}, transparent 70%)`;
    sec.style.opacity = s;
    if (s > 0) sec.style.background = `radial-gradient(1200px 900px at ${gx}px ${gy}px, ${C.n800}, ${C.surface} 75%)`;
    void base;
  };
}

function intro(stage, p) {
  const s = CUES.Intro, e = CUES.Anfang;
  const wrap = node(stage, { position: 'absolute', inset: '0', transformOrigin: '20% 50%' });
  const rule = abs(wrap, L, 650, { height: '1px', background: fadeRule(rgba(p.accent, 0.6)) });
  const daysBox = abs(wrap, L, 300);
  kicker(daysBox, p.accent, p.channel);
  const row = node(daysBox, { display: 'flex', alignItems: 'baseline', gap: '32px', marginTop: '20px' });
  const daysNum = node(row, { fontSize: '260px', lineHeight: '1', letterSpacing: '-0.04em', fontWeight: '500', fontVariantNumeric: 'tabular-nums' }, '0', 'span');
  node(row, { fontSize: '72px', color: C.n400, fontWeight: '500' }, 'Tage', 'span');
  const yearBox = abs(wrap, L, 300, { transformOrigin: 'left center' });
  kicker(yearBox, p.accent, p.channel);
  const yl = node(yearBox, { fontSize: '280px', lineHeight: '1', letterSpacing: '-0.045em', fontWeight: '500', marginTop: '20px' }, `${p.years} `);
  node(yl, { color: p.accent }, p.yearWord, 'span');
  const sub = abs(wrap, L, 690, { fontSize: '44px', color: C.n300, fontWeight: '500' }, p.introLine);
  return (T) => {
    const o = 1 - MOTION.enter(T, e - 0.7, 0.7);
    wrap.style.display = o <= 0 ? 'none' : '';
    if (o <= 0) return;
    show(wrap, o, `scale(${1 + 0.04 * P(T, s, e)})`);
    rule.style.width = `${1600 * MOTION.draw(T, s + 0.2, 1.6)}px`;
    const di = MOTION.enter(T, s + 0.7) * (1 - MOTION.enter(T, s + 3.9, 0.5));
    show(daysBox, di, rise(di));
    daysNum.textContent = fmt(p.days * MOTION.draw(T, s + 0.8, 2.6));
    const yi = MOTION.pop(T, s + 4.3, 0.9);
    show(yearBox, clamp(yi), `translateY(${(1 - yi) * 40}px) scale(${0.92 + 0.08 * yi})`);
    const si = MOTION.enter(T, s + 5.2);
    show(sub, si, rise(si, 20));
  };
}

function anfang(stage, p) {
  const s = CUES.Anfang, e = CUES.Zahlen;
  const wrap = node(stage, { position: 'absolute', inset: '0', transformOrigin: '30% 45%' });
  const k = abs(wrap, L, 250);
  kicker(k, p.accent, 'Tag 1');
  const d = abs(wrap, L, 310, { fontSize: '120px', fontWeight: '500', letterSpacing: '-0.035em', lineHeight: '1.05', width: '900px' }, p.startDate);
  const l = abs(wrap, L, 590, { fontSize: '44px', color: C.n300, fontWeight: '500' }, 'So hat alles angefangen.');
  const bridge = abs(wrap, L, 680, { fontSize: '36px', color: C.a300, fontWeight: '500' }, p.bridgeLine);
  const card = abs(wrap, 1100, 250, { width: '660px', background: C.surface, borderRadius: '14px', boxShadow: `0 0 0 1px ${C.n700}, 0 6px 18px rgba(0,0,0,0.55)`, overflow: 'hidden' });
  const top = node(card, { height: '340px', background: `linear-gradient(160deg, ${C.n900}, ${C.a900})`, position: 'relative' });
  const badge = node(top, { position: 'absolute', left: '24px', top: '24px', display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 14px', borderRadius: '4px', border: `1px solid ${p.accent}`, color: C.a300, fontSize: '20px', fontWeight: '600', letterSpacing: '0.1em' });
  const dot = node(badge, { width: '10px', height: '10px', borderRadius: '5px', background: p.accent }, null, 'span');
  node(badge, {}, 'LIVE', 'span');
  const img = node(top, { position: 'absolute', left: '50%', top: '50%', width: p.avatar ? '170px' : '120px', height: p.avatar ? '170px' : '120px', transform: 'translate(-50%,-50%)', borderRadius: p.avatar ? '50%' : '0', boxShadow: p.avatar ? `0 0 0 4px ${p.accent}, 0 0 60px ${rgba(p.accent, 0.35)}` : 'none', opacity: '0.95' }, null, 'img');
  img.src = p.avatar || LOGO;
  img.alt = '';
  const body = node(card, { padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '10px' });
  node(body, { fontSize: '30px', fontWeight: '500', lineHeight: '1.2' }, p.firstTitle);
  const meta = node(body, { display: 'flex', justifyContent: 'space-between', fontSize: '22px', color: C.n400 });
  node(meta, {}, p.login ? `twitch.tv/${p.login}` : p.channel, 'span');
  node(meta, {}, 'Tag 1', 'span');
  return (T) => {
    const o = win(T, s, e, 0.6, 0.8);
    wrap.style.display = o <= 0 ? 'none' : '';
    if (o <= 0) return;
    show(wrap, o, `scale(${1 + 0.035 * P(T, s, e)})`);
    const ki = MOTION.enter(T, s + 0.3), di = MOTION.enter(T, s + 0.8), li = MOTION.enter(T, s + 1.6);
    show(k, ki, rise(ki)); show(d, di, rise(di)); show(l, li, rise(li));
    const bi = MOTION.enter(T, s + 8.0);
    show(bridge, bi, rise(bi, 20));
    const ci = MOTION.enter(T, s + 2.6, 1.0);
    show(card, ci, `translateX(${(1 - ci) * 120}px)`);
    dot.style.opacity = 0.55 + 0.45 * Math.abs(Math.sin(T * 2.2));
  };
}

function zahlen(stage, p) {
  const s = CUES.Zahlen, e = CUES.Content;
  const wrap = node(stage, { position: 'absolute', inset: '0' });
  const h = abs(wrap, L, 130);
  kicker(h, p.accent, p.statsKicker);
  const rule = abs(wrap, L, 190, { height: '1px', background: fadeRule(C.divider) });
  const items = p.stats.map((st, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const box = abs(wrap, L + col * 820, 260 + row * 310);
    const num = node(box, { fontSize: '176px', lineHeight: '1', fontWeight: '500', letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }, '0');
    node(box, { fontSize: '36px', color: C.n300, fontWeight: '500', marginTop: '14px' }, st.label);
    return { box, num, st, a: s + 1.8 + i * 3.2 };
  });
  const outro = abs(wrap, L, 920, { fontSize: '40px', fontWeight: '500', color: C.text }, p.statsLine);
  return (T) => {
    const o = win(T, s + 0.4, e, 0.8, 0.8);
    wrap.style.display = o <= 0 ? 'none' : '';
    if (o <= 0) return;
    wrap.style.opacity = o;
    const hi = MOTION.enter(T, s + 0.6);
    show(h, hi, rise(hi));
    rule.style.width = `${1600 * MOTION.draw(T, s + 0.8, 1.6)}px`;
    for (const it of items) {
      const ei = MOTION.enter(T, it.a);
      show(it.box, ei, rise(ei, 50));
      it.num.textContent = fmt(it.st.value * MOTION.draw(T, it.a, 2.4));
    }
    const oi = MOTION.enter(T, s + 15.5);
    show(outro, oi, rise(oi, 20));
  };
}

function content(stage, p) {
  const s = CUES.Content, e = CUES.Community;
  const wrap = node(stage, { position: 'absolute', inset: '0' });
  const h = abs(wrap, L, 150);
  kicker(h, p.accent, 'Content');
  node(h, { fontSize: '88px', fontWeight: '500', letterSpacing: '-0.03em', marginTop: '18px' }, p.highlights.length ? 'Was wir zusammen gebaut haben.' : 'Was wir zusammen erlebt haben.');
  const TW = 500, GAP = 40, total = p.highlights.length * (TW + GAP) - GAP;
  const x1 = Math.min(L, 1760 - total);
  const tiles = p.highlights.map((t, i) => {
    const box = abs(wrap, 0, 430, { width: `${TW}px`, height: '400px', transformOrigin: 'center bottom' });
    node(box, { position: 'absolute', inset: '0', borderRadius: '14px', background: C.surface, boxShadow: `0 0 0 1px ${C.n800}` });
    const focus = node(box, { position: 'absolute', inset: '0', borderRadius: '14px', boxShadow: `0 0 0 1px ${p.accent}, 0 0 60px ${rgba(p.accent, 0.28)}`, background: `linear-gradient(180deg, ${rgba(p.accent, 0.12)}, transparent 60%)` });
    const inner = node(box, { position: 'absolute', inset: '0', padding: '36px', display: 'flex', flexDirection: 'column', gap: '16px' });
    node(inner, { fontSize: '22px', letterSpacing: '0.14em', textTransform: 'uppercase', color: C.n500, fontWeight: '500' }, String(i + 1).padStart(2, '0'));
    node(inner, { fontSize: '44px', fontWeight: '500', letterSpacing: '-0.02em', lineHeight: '1.1' }, t.title);
    node(inner, { fontSize: '26px', color: C.n300, lineHeight: '1.4' }, t.text);
    return { box, focus, i };
  });
  return (T) => {
    const o = win(T, s, e, 0.8, 0.8);
    wrap.style.display = o <= 0 ? 'none' : '';
    if (o <= 0) return;
    wrap.style.opacity = o;
    const hi = MOTION.enter(T, s + 0.4);
    show(h, hi, rise(hi));
    const x = L + (x1 - L) * MOTION.draw(T, s + 2.5, (e - s) - 4.5);
    for (const t of tiles) {
      const left = x + t.i * (TW + GAP);
      const f = clamp(1 - Math.abs(left + TW / 2 - 960) / 700);
      const pe = MOTION.pop(T, s + 0.9 + t.i * 0.12, 0.8);
      t.box.style.left = `${left}px`;
      show(t.box, clamp(pe), `translateY(${(1 - pe) * 60}px) scale(${0.95 + 0.05 * f})`);
      t.focus.style.opacity = f;
    }
  };
}

function community(stage, p) {
  const s = CUES.Community, e = CUES.Mods;
  const wrap = node(stage, { position: 'absolute', inset: '0' });
  const h = abs(wrap, L, 300, { width: '860px' });
  kicker(h, p.accent, 'Community');
  node(h, { fontSize: '100px', fontWeight: '500', letterSpacing: '-0.035em', lineHeight: '1.05', marginTop: '20px', textWrap: 'pretty' }, p.communityLine);
  const sub = abs(wrap, L, 700, { width: '800px', fontSize: '36px', color: C.n300, lineHeight: '1.4' }, p.communitySub);
  const card = abs(wrap, 1120, 120, { width: '640px', height: '840px', background: C.surface, borderRadius: '14px', boxShadow: `0 0 0 1px ${C.n700}, 0 6px 18px rgba(0,0,0,0.55)`, overflow: 'hidden' });
  const head = node(card, { height: '80px', display: 'flex', alignItems: 'center', gap: '14px', padding: '0 28px', fontSize: '24px', fontWeight: '500', color: C.n300, boxShadow: `inset 0 -1px 0 ${C.n800}` });
  node(head, { width: '12px', height: '12px', borderRadius: '6px', background: p.accent }, null, 'span');
  node(head, {}, 'Chat', 'span');
  const H = 680, MH = 84;
  const list = node(card, { position: 'absolute', left: '0', right: '0', top: '110px', height: `${H}px`, overflow: 'hidden' });
  const nameCols = [C.a300, C.n300, C.a400, '#e7e5fe', C.n400];
  // Nachrichten: was der Chat seit dem Start geschrieben hat, aufgefüllt mit den treuesten Zuschauern
  // (echte Watchtime). Was während der Szene reinkommt, läuft hinten an.
  const lines = [];
  let used = 0;
  let snap = false;
  const add = (name, text, earliest) => {
    if (lines.length >= 14) return;
    const at = Math.max(s + 2.0, earliest, (lines[lines.length - 1]?.at ?? 0) + 1.3);
    const row = abs(list, 28, H, { right: '28px', fontSize: '28px', lineHeight: '1.3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: '0' });
    node(row, { color: nameCols[lines.length % nameCols.length], fontWeight: '600' }, name, 'b');
    node(row, { color: C.n500 }, ': ', 'span');
    node(row, { color: C.text }, text, 'span');
    lines.push({ row, at });
  };
  return (T, chat) => {
    const o = win(T, s, e, 0.8, 0.8);
    wrap.style.display = o <= 0 ? 'none' : '';
    if (o <= 0) return;
    if (!snap) {
      snap = true;
      const live = chat.slice(-8);
      used = chat.length;
      for (const m of live) add(m.name, m.text, 0);
      for (const t of p.top) { if (lines.length >= 10) break; add(t.name, `seit ${String(t.hours).replace('.', ',')} Stunden dabei 💜`, 0); }
      if (!lines.length) add(p.channel, 'Danke, dass ihr da seid! 💜', 0);
    }
    while (used < chat.length) { const m = chat[used++]; add(m.name, m.text, T); }
    wrap.style.opacity = o;
    const hi = MOTION.enter(T, s + 0.4), si = MOTION.enter(T, s + 1.4), ci = MOTION.enter(T, s + 0.9, 1.0);
    show(h, hi, rise(hi)); show(sub, si, rise(si, 20));
    show(card, ci, `translateX(${(1 - ci) * 100}px)`);
    const prog = lines.map((l) => MOTION.enter(T, l.at, 0.5));
    const shift = prog.reduce((a, b) => a + b, 0) * MH;
    lines.forEach((l, i) => { l.row.style.top = `${H - shift + i * MH}px`; l.row.style.opacity = prog[i]; });
  };
}

function mods(stage, p) {
  const s = CUES.Mods, e = CUES.Ausblick;
  const team = p.mods.length ? p.mods : p.top.map((t) => t.name);
  const badgeText = p.mods.length ? 'Mod' : 'Stammgast';
  const title = p.mods.length ? 'Danke an die Mods.' : team.length ? 'Danke an die Stammgäste.' : 'Danke an die Community.';
  const wrap = node(stage, { position: 'absolute', inset: '0', transformOrigin: '10% 30%' });
  const h = abs(wrap, L, 150);
  kicker(h, p.accent, p.mods.length ? 'Das Team im Hintergrund' : 'Die Treuesten');
  node(h, { fontSize: '110px', fontWeight: '500', letterSpacing: '-0.035em', marginTop: '18px' }, title);
  const list = team.slice(0, 12);
  const cols = Math.max(1, list.length <= 4 ? list.length : list.length <= 6 ? 3 : 4);
  const CW = cols <= 3 ? 500 : 380;
  const cards = list.map((m, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const c = abs(wrap, L + col * (CW + 32), 420 + row * 180, { width: `${CW}px`, height: '148px', transformOrigin: 'left center', background: C.surface, borderRadius: '14px', boxShadow: `0 0 0 1px ${C.n800}`, padding: '26px 30px', display: 'flex', flexDirection: 'column', gap: '12px', boxSizing: 'border-box' });
    node(c, { alignSelf: 'flex-start', fontSize: '18px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase', color: C.a300, background: C.a900, borderRadius: '4px', padding: '4px 10px' }, badgeText, 'span');
    node(c, { fontSize: '40px', fontWeight: '500', letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, m, 'span');
    return { c, i };
  });
  const thanks = abs(wrap, L, list.length ? 440 + Math.ceil(list.length / cols) * 180 : 420, { fontSize: '40px', color: C.n300, fontWeight: '500' }, p.mods.length ? p.modsLine : 'Ohne euch wäre das hier nur ein Selbstgespräch.');
  return (T) => {
    const o = win(T, s, e, 0.8, 0.8);
    wrap.style.display = o <= 0 ? 'none' : '';
    if (o <= 0) return;
    show(wrap, o, `scale(${1 + 0.03 * P(T, s, e)})`);
    const hi = MOTION.enter(T, s + 0.4);
    show(h, hi, rise(hi));
    for (const { c, i } of cards) {
      const pe = MOTION.pop(T, s + 1.8 + i * 0.45);
      show(c, clamp(pe), `scale(${0.85 + 0.15 * pe})`);
    }
    const ti = MOTION.enter(T, s + 2.4 + list.length * 0.45 + 0.6);
    show(thanks, ti, rise(ti, 20));
  };
}

function ausblick(stage, p) {
  const s = CUES.Ausblick, e = CUES.Finale;
  const wrap = node(stage, { position: 'absolute', inset: '0', transformOrigin: '10% 50%' });
  const k = abs(wrap, L, 250);
  kicker(k, p.accent, p.outlookKicker);
  const hd = abs(wrap, L, 310, { fontSize: '130px', fontWeight: '500', letterSpacing: '-0.04em', lineHeight: '1.02', width: '1500px' }, p.outlookLine);
  let card = null;
  if (p.nextTitle) {
    card = abs(wrap, L, 640, { width: '900px', background: C.surface, borderRadius: '14px', boxShadow: `0 0 0 1px ${C.n700}, 0 6px 18px rgba(0,0,0,0.55)`, padding: '30px 36px', display: 'flex', flexDirection: 'column', gap: '12px', boxSizing: 'border-box' });
    const meta = node(card, { display: 'flex', alignItems: 'center', gap: '12px', fontSize: '24px', color: C.n400, fontWeight: '500' });
    node(meta, { width: '12px', height: '12px', borderRadius: '6px', background: p.accent }, null, 'span');
    node(meta, {}, 'Als Nächstes', 'span');
    node(meta, {}, '·', 'span');
    node(meta, {}, p.nextDate, 'span');
    node(card, { fontSize: '60px', fontWeight: '500', letterSpacing: '-0.025em' }, p.nextTitle);
  }
  return (T) => {
    const o = win(T, s, e, 0.8, 0.8);
    wrap.style.display = o <= 0 ? 'none' : '';
    if (o <= 0) return;
    show(wrap, o, `scale(${1 + 0.03 * P(T, s, e)})`);
    const ki = MOTION.enter(T, s + 0.3), hi = MOTION.enter(T, s + 0.8), ci = MOTION.enter(T, s + 3.2, 1.0);
    show(k, ki, rise(ki)); show(hd, hi, rise(hi));
    if (card) show(card, ci, rise(ci, 40));
  };
}

// ---------- Konfetti und Funkeln ----------
const PIECES = Array.from({ length: 80 }, (_, i) => ({
  ang: -Math.PI / 2 + (rnd(i, 1) - 0.5) * 2.6, v: 900 + rnd(i, 2) * 1300, w: 8 + rnd(i, 3) * 10, h: 14 + rnd(i, 4) * 16,
  spin: (rnd(i, 5) - 0.5) * 1100, fl: 3 + rnd(i, 6) * 6, c: Math.floor(rnd(i, 7) * 6), round: rnd(i, 8) > 0.8,
}));
const confColors = (p) => ['#f3f5fe', C.n300, C.n500, p.accent, C.a300, '#f3f5fe'];
function piece(parent, c, p) {
  return node(parent, { position: 'absolute', left: '0', top: '0', width: `${c.w}px`, height: `${c.round ? c.w : c.h}px`, borderRadius: c.round ? `${c.w}px` : '2px', background: confColors(p)[c.c], willChange: 'transform' });
}
function burst(stage, p, { at, x, y, n = 80, dur = 3.6 }) {
  const layer = node(stage, { position: 'absolute', inset: '0', display: 'none' });
  const els = PIECES.slice(0, n).map((c) => ({ c, el: piece(layer, c, p) }));
  return (T) => {
    const t = T - at;
    const on = t >= 0 && t <= dur;
    layer.style.display = on ? '' : 'none';
    if (!on) return;
    layer.style.opacity = 1 - P(t, dur - 1.0, dur);
    els.forEach(({ c, el }, i) => {
      const dist = c.v * (1 - Math.exp(-3 * t)) / 3;
      const px = x + Math.cos(c.ang) * dist + Math.sin(t * 2 + i) * 18;
      const py = y + Math.sin(c.ang) * dist + 240 * t * t;
      el.style.transform = `translate(${px}px, ${py}px) rotate(${c.spin * t}deg) scaleX(${Math.cos(t * c.fl)})`;
    });
  };
}
function bursts(stage, p) {
  const list = [
    burst(stage, p, { at: CUES.Intro + 4.35, x: 520, y: 560 }),
    burst(stage, p, { at: CUES.Zahlen + 14.2, x: 1500, y: 960, n: 45 }),
    burst(stage, p, { at: CUES.Finale + 0.7, x: 420, y: 620 }),
    burst(stage, p, { at: CUES.Finale + 1.0, x: 1450, y: 760, n: 60 }),
  ];
  return (T) => list.forEach((u) => u(T));
}
function sparkles(parent, seed = 0, area = [980, 80, 880, 900]) {
  const layer = node(parent, { position: 'absolute', inset: '0' });
  const els = Array.from({ length: 14 }, (_, i) => {
    const k = i + seed * 31, sz = 14 + rnd(k, 1) * 26;
    const el = node(layer, { position: 'absolute', left: `${area[0] + rnd(k, 4) * area[2]}px`, top: `${area[1] + rnd(k, 5) * area[3]}px`, width: `${sz}px`, height: `${sz}px` });
    node(el, { position: 'absolute', left: '50%', top: '0', bottom: '0', width: '2px', marginLeft: '-1px', background: 'linear-gradient(transparent, #f3f5fe, transparent)' });
    node(el, { position: 'absolute', top: '50%', left: '0', right: '0', height: '2px', marginTop: '-1px', background: 'linear-gradient(to right, transparent, #f3f5fe, transparent)' });
    return { el, k };
  });
  return (T, o) => {
    layer.style.display = o <= 0 ? 'none' : '';
    if (o <= 0) return;
    for (const { el, k } of els) {
      const tw = Math.max(0, Math.sin(T * (1.4 + rnd(k, 2)) + rnd(k, 3) * 6.28));
      el.style.opacity = o * tw;
      el.style.transform = `rotate(45deg) scale(${0.6 + 0.4 * tw})`;
    }
  };
}
function sparklesGlobal(stage) {
  const sp = sparkles(stage, 0);
  return (T) => sp(T, MOTION.enter(T, CUES.Intro + 4.4, 1.0) * (1 - MOTION.enter(T, CUES.Anfang - 0.7, 0.7)));
}

function finale(stage, p) {
  const s = CUES.Finale;
  const wrap = node(stage, { position: 'absolute', inset: '0' });
  const rain = node(wrap, { position: 'absolute', inset: '0' });
  const drops = PIECES.slice(0, 60).map((c, i) => ({ c, i, el: piece(rain, c, p) }));
  const sp = sparkles(wrap, 2);
  const cam = node(wrap, { position: 'absolute', inset: '0', transformOrigin: '12% 50%' });
  const logo = abs(cam, L, 250, { transformOrigin: 'left center' });
  const img = node(logo, { width: '150px', height: '150px', borderRadius: p.avatar ? '50%' : '36px', boxShadow: `0 0 80px ${rgba(p.accent, 0.35)}` }, null, 'img');
  img.src = p.avatar || LOGO;
  img.alt = '';
  const hd = abs(cam, L, 450, { fontSize: '160px', fontWeight: '500', letterSpacing: '-0.045em', lineHeight: '1' }, 'Danke für ');
  node(hd, { color: p.accent }, `${p.years} ${p.yearWord}.`, 'span');
  const url = abs(cam, L, 660, { display: 'flex', alignItems: 'center', gap: '24px', fontSize: '44px', fontWeight: '500', color: C.a300 }, p.login ? `twitch.tv/${p.login}` : p.channel);
  const line = abs(cam, L, 740, { fontSize: '32px', color: C.n400 }, p.finaleLine);
  return (T) => {
    const o = MOTION.enter(T, s, 0.8);
    wrap.style.display = o <= 0 ? 'none' : '';
    if (o <= 0) return;
    wrap.style.opacity = o;
    const ro = MOTION.enter(T, s + 1.2, 1.5), tt = T - s;
    rain.style.opacity = ro;
    if (ro > 0) {
      for (const { c, i, el } of drops) {
        const y = -60 + ((rnd(i, 9) * 1200 + tt * (120 + rnd(i, 10) * 160)) % 1200);
        const x = rnd(i, 11) * 1920 + Math.sin(tt * 1.2 + i) * 40;
        el.style.opacity = 0.8;
        el.style.transform = `translate(${x}px, ${y}px) rotate(${c.spin * tt * 0.3}deg) scaleX(${Math.cos(tt * c.fl * 0.6)})`;
      }
    }
    sp(T, o);
    cam.style.transform = `scale(${1 + 0.04 * P(T, s, TOTAL)})`;
    const li = MOTION.pop(T, s + 0.4, 0.9), hi = MOTION.enter(T, s + 1.0), ui = MOTION.enter(T, s + 2.0);
    show(logo, clamp(li), `scale(${0.7 + 0.3 * li})`);
    show(hd, hi, rise(hi));
    show(url, ui, rise(ui, 20));
    show(line, ui, rise(ui, 20));
  };
}
