// Zugfahrer_DaveTV · Intro v2 — eine durchgehende Reise:
// Berge → Tunnel → Frontal aus dem Tunnel → Einfahrt → Tafel → Signal → Einstieg.
//
// Aus Claude Design übernommen („Intro v2.dc.html“ / intro-scene.jsx) und für
// die Seite ohne React angepasst: h() (hier __h) und Shot kommen aus js/intro-engine.js.
// Der Browser lädt js/intro-scene.js – das wird aus DIESER Datei erzeugt:
//   npx esbuild js/intro-scene.jsx --jsx-factory=__h --jsx-fragment=Fragment --format=esm --outfile=js/intro-scene.js
// JSX wird zu __h(...) – die Szene benutzt h selbst als Variablennamen (Höhe)
import { h as __h, Fragment, Easing, animate, clamp, Shot } from './intro-engine.js';

// Die Szenen mit ihrer Dauer in Sekunden (wie OM_SCENES im Entwurf)
export const SCENES = [
  { name: 'Berge', dur: 8 },      // nächtliche Berglandschaft, der Zug fährt mit Licht an den Bergen entlang
  { name: 'Tunnel', dur: 3.5 },   // der Zug verschwindet im Tunnel, die Kamera folgt ins Portal
  { name: 'Frontal', dur: 2.5 },  // im Tunnel: der Zug rast frontal auf die Kamera zu, Lichtblitz
  { name: 'Einfahrt', dur: 3.5 }, // Bahnhof: der Zug fährt ein und bremst sanft an Gleis 1
  { name: 'Tafel', dur: 4 },      // ruhiger Push-in, die Tafel blättert ZUGFAHRER_DAVETV auf
  { name: 'Signal', dur: 2 },     // im selben Bild springt das Signal auf Grün
  { name: 'Einstieg', dur: 4.5 }, // Türen öffnen, Kamera fährt ins Licht und blendet zur Seite über
];

const C = {
  bg: '#161826', surface: '#232532', text: '#e9e9ed', accent: '#9184d9',
  n100: '#f3f5fe', n300: '#cfd3e5', n400: '#b2b6ca', n500: '#9397ab', n600: '#75798c', n700: '#595d6c', n800: '#3f424d', n900: '#292b31',
  a200: '#e7e5fe', a300: '#d2cefd', a400: '#b5abfc', a700: '#5d5294', a800: '#423a6a', a900: '#2b2741',
  section: '#262a60', sectionGlow: '#353b80', sectionGhost: '#4c5397',
  deep: 'color-mix(in oklab, #161826 70%, #0b0c14)',
  mid: 'color-mix(in oklab, #161826 55%, #232532)',
  red: 'oklch(0.66 0.19 25)', green: 'oklch(0.80 0.17 152)',
};
const FONT = 'Inter, system-ui, sans-serif';
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';

const M = {
  run: (T, s, e, a, b) => animate({ from: a, to: b, start: s, end: e, ease: Easing.linear })(T),
  glide: (T, s, e, a, b) => animate({ from: a, to: b, start: s, end: e, ease: Easing.easeInOutCubic })(T),
  brake: (T, s, e, a, b) => animate({ from: a, to: b, start: s, end: e, ease: Easing.easeOutQuart })(T),
  approach: (T, s, e, a, b) => animate({ from: a, to: b, start: s, end: e, ease: Easing.easeInCubic })(T),
  pop: (T, s, e, a, b) => animate({ from: a, to: b, start: s, end: e, ease: Easing.easeOutBack })(T),
};
const keyed = (T, keys) => {
  const n = keys.length;
  if (T <= keys[0][0]) return keys[0].slice(1);
  if (T >= keys[n - 1][0]) return keys[n - 1].slice(1);
  let i = 0;
  while (T > keys[i + 1][0]) i++;
  const t0 = keys[i][0], t1 = keys[i + 1][0], dt = t1 - t0, u = (T - t0) / dt;
  const h00 = 2 * u * u * u - 3 * u * u + 1, h10 = u * u * u - 2 * u * u + u, h01 = -2 * u * u * u + 3 * u * u, h11 = u * u * u - u * u;
  const tan = (k, j) => (k <= 0 || k >= n - 1) ? 0 : (keys[k + 1][j] - keys[k - 1][j]) / (keys[k + 1][0] - keys[k - 1][0]);
  return [1, 2, 3].map((j) => h00 * keys[i][j] + h10 * dt * tan(i, j) + h01 * keys[i + 1][j] + h11 * dt * tan(i + 1, j));
};
// Tageszeit fürs Wetter-Schild (js/intro.js)
export const DAY_LABEL = { morning: 'Morgen', day: 'Tag', evening: 'Abend', night: 'Nacht' };
const SKY = {
  night: { top: C.deep, mid: C.bg, bottom: `color-mix(in oklab, ${C.section} 60%, ${C.bg})`, horizon: `color-mix(in oklab, ${C.a700} 35%, ${C.section})`, glow: C.section, stars: 1, orb: 'moon', orbY: 175,
    cloud: [`color-mix(in oklab, ${C.n800} 70%, ${C.deep})`, `color-mix(in oklab, ${C.n500} 55%, transparent)`] },
  evening: { top: C.deep, mid: `color-mix(in oklab, ${C.section} 70%, ${C.bg})`, bottom: `color-mix(in oklab, ${C.a700} 70%, ${C.section})`, horizon: `color-mix(in oklab, ${C.a300} 55%, ${C.a700})`, glow: `color-mix(in oklab, ${C.a400} 45%, ${C.section})`, stars: 0.35, orb: 'moon', orbY: 300,
    cloud: [`color-mix(in oklab, ${C.a900} 80%, ${C.deep})`, `color-mix(in oklab, ${C.a400} 70%, transparent)`] },
  morning: { top: `color-mix(in oklab, ${C.n700} 60%, ${C.bg})`, mid: `color-mix(in oklab, ${C.n600} 70%, ${C.section})`, bottom: `color-mix(in oklab, ${C.a300} 45%, ${C.n500})`, horizon: `color-mix(in oklab, ${C.a200} 70%, ${C.n300})`, glow: `color-mix(in oklab, ${C.n300} 50%, transparent)`, stars: 0, orb: 'sun', orbY: 320,
    cloud: [`color-mix(in oklab, ${C.n600} 80%, ${C.a700})`, `color-mix(in oklab, ${C.a200} 80%, transparent)`] },
  day: { top: `color-mix(in oklab, ${C.n600} 70%, ${C.section})`, mid: `color-mix(in oklab, ${C.n500} 70%, ${C.sectionGhost})`, bottom: C.n400, horizon: `color-mix(in oklab, ${C.n300} 85%, ${C.a200})`, glow: `color-mix(in oklab, ${C.n100} 30%, transparent)`, stars: 0, orb: 'sun', orbY: 110,
    cloud: [`color-mix(in oklab, ${C.n500} 80%, ${C.n600})`, `color-mix(in oklab, ${C.n100} 90%, transparent)`] },
};
const OVERCAST = { clear: 0, cloudy: 0.55, fog: 0.4, drizzle: 0.7, rain: 0.85, snow: 0.6, storm: 1 };
function Sky({ env, box }) {
  const k = SKY[env.daypart] || SKY.night;
  return (
    <>
      <div style={abs({ ...box, background: `radial-gradient(45% 30% at 58% 55%, ${k.glow} 0%, transparent 75%), linear-gradient(180deg, ${k.top} 0%, ${k.mid} 28%, ${k.bottom} 46%, ${k.horizon} 56%, ${k.bottom} 64%)` })}></div>
      <div style={abs({ ...box, background: `linear-gradient(180deg, color-mix(in oklab, ${C.n700} 70%, ${C.bg}) 0%, color-mix(in oklab, ${C.n800} 60%, transparent) 45%, transparent 70%)`, opacity: OVERCAST[env.kind] || 0 })}></div>
    </>
  );
}
function SkyDetail({ env, T, y = 0 }) {
  const k = SKY[env.daypart] || SKY.night, clear = 1 - (OVERCAST[env.kind] || 0), o = k.stars * clear;
  if (o <= 0.01) return null;
  const band = 'linear-gradient(160deg, transparent 30%, #000 44%, #000 50%, transparent 64%)';
  const shoot = clamp((T - 3.2) / 0.7, 0, 1);
  return (
    <div style={{ opacity: o }}>
      <div style={abs({ left: -400, top: y - 200, width: 4200, height: 900, background: `radial-gradient(40% 18% at 45% 50%, color-mix(in oklab, ${C.a300} 16%, transparent), transparent), radial-gradient(30% 12% at 62% 46%, color-mix(in oklab, ${C.n300} 12%, transparent), transparent)`, maskImage: band, WebkitMaskImage: band })}></div>
      <div style={abs({ left: -400, top: y - 200, width: 4200, height: 900, backgroundImage: `radial-gradient(circle, ${C.n100} 0 0.7px, transparent 1.2px), radial-gradient(circle, ${C.n300} 0 0.6px, transparent 1px)`, backgroundSize: '23px 19px, 37px 31px', backgroundPosition: '0 0, 11px 7px', opacity: 0.55, maskImage: band, WebkitMaskImage: band })}></div>
      <div style={abs({ left: -400, top: y - 200, width: 4200, height: 900, backgroundImage: `radial-gradient(circle, ${C.n300} 0 0.7px, transparent 1.2px)`, backgroundSize: '71px 53px', opacity: 0.35, maskImage: 'linear-gradient(180deg, #000 40%, transparent 75%)', WebkitMaskImage: 'linear-gradient(180deg, #000 40%, transparent 75%)' })}></div>
      {shoot > 0 && shoot < 1 && (
        <div style={abs({ left: 900 + shoot * 520, top: y + 40 + shoot * 180, width: 160, height: 2, transformOrigin: '100% 50%', transform: 'rotate(19deg)', background: `linear-gradient(90deg, transparent, ${C.n100})`, opacity: Math.sin(shoot * Math.PI) })}></div>
      )}
    </div>
  );
}
const CLOUD_SET = Array.from({ length: 12 }, (_, i) => ({
  x: -300 + i * 390 + rndC(i) * 200, y: 10 + rndC(i + 9) * 150, w: 240 + rndC(i + 3) * 380, puffs: 5 + Math.floor(rndC(i + 5) * 4), v: 10 + rndC(i + 7) * 16,
}));
function rndC(i) { const x = Math.sin(i * 91.7 + 17.3) * 24634.6345; return x - Math.floor(x); }
function Clouds({ env, T }) {
  const k = SKY[env.daypart] || SKY.night, oc = OVERCAST[env.kind] || 0;
  const n = Math.round(3 + oc * 9), dark = env.kind === 'rain' || env.kind === 'storm';
  const [base, rim] = dark ? [`color-mix(in oklab, ${C.n800} 80%, ${C.deep})`, `color-mix(in oklab, ${C.n600} 50%, transparent)`] : k.cloud;
  return (
    <>
      {oc < 0.6 && [0, 1, 2].map((i) => (
        <div key={'c' + i} style={abs({ left: 300 + i * 1300 + T * 6, top: 30 + i * 40, width: 1100, height: 60, borderRadius: '50%', background: `repeating-linear-gradient(172deg, transparent 0 10px, color-mix(in oklab, ${C.n300} 10%, transparent) 10px 13px)`, maskImage: 'radial-gradient(closest-side, #000, transparent)', WebkitMaskImage: 'radial-gradient(closest-side, #000, transparent)', opacity: 0.8 })}></div>
      ))}
      {CLOUD_SET.slice(0, n).map((c, i) => (
        <div key={i} style={abs({ left: c.x + T * c.v, top: c.y + oc * 40, width: c.w * (0.55 + oc * 1.1), height: c.w * (0.55 + oc * 1.1) * 0.4, opacity: 0.55 + oc * 0.45, maskImage: 'linear-gradient(180deg, #000 50%, transparent 78%)', WebkitMaskImage: 'linear-gradient(180deg, #000 50%, transparent 78%)' })}>
          {Array.from({ length: c.puffs }, (_, j) => {
            const px = (j + 0.5) / c.puffs, py = 0.55 - 0.3 * Math.sin(px * Math.PI) * (0.6 + 0.4 * rndC(i * 7 + j));
            const r = 0.22 + 0.16 * Math.sin(px * Math.PI) + 0.06 * rndC(i * 3 + j);
            const pos = { left: `${(px - r / 2) * 100}%`, top: `${(py - r * 0.8) * 100}%`, width: `${r * 100}%`, height: `${r * 160}%` };
            return (
              <Fragment key={j}>
                <div style={abs({ ...pos, borderRadius: '50%', background: `radial-gradient(closest-side, ${base}, transparent)`, opacity: 0.7 })}></div>
                <div style={abs({ ...pos, borderRadius: '50%', background: `radial-gradient(50% 45% at 45% 30%, ${rim}, transparent)`, opacity: 0.8 })}></div>
              </Fragment>
            );
          })}
        </div>
      ))}
    </>
  );
}
function Orb({ env, x }) {
  const k = SKY[env.daypart] || SKY.night, veil = 1 - 0.75 * (OVERCAST[env.kind] || 0);
  const sun = k.orb === 'sun';
  return (
    <div style={{ opacity: veil }}>
      <div style={abs({ left: x - 165, top: k.orbY - 165, width: 400, height: 400, borderRadius: '50%', background: `radial-gradient(circle, color-mix(in oklab, ${sun ? C.n100 : C.a300} ${sun ? 40 : 26}%, transparent), transparent 65%)` })}></div>
      <div style={abs({ left: x, top: k.orbY, width: 70, height: 70, borderRadius: '50%', background: sun ? C.n100 : `radial-gradient(circle at 38% 38%, ${C.n100}, ${C.n300} 70%, ${C.n500})`, boxShadow: sun ? `0 0 40px 12px color-mix(in oklab, ${C.n100} 60%, transparent)` : 'none' })}></div>
    </div>
  );
}
function Weather({ env, T }) {
  const k = env.kind, wet = k === 'rain' || k === 'storm' || k === 'drizzle';
  const strike = k === 'storm' ? Math.max(0, 1 - Math.abs(((T % 5.3) - 1.1) / 0.06)) + 0.6 * Math.max(0, 1 - Math.abs(((T % 5.3) - 1.3) / 0.05)) : 0;
  return (
    <>
      {wet && [[1500, 0.9, 14], [2200, 0.55, 22]].map(([v, o, g], i) => (
        <div key={i} style={abs({ inset: 0, opacity: (k === 'drizzle' ? 0.45 : 1) * o, backgroundImage: `repeating-linear-gradient(104deg, transparent 0 ${g}px, color-mix(in oklab, ${C.n300} 30%, transparent) ${g}px ${g + 1}px)`, backgroundSize: `${g * 7}px 180px`, backgroundPosition: `${-T * v * 0.26}px ${T * v}px` })}></div>
      ))}
      {k === 'snow' && [[60, 3, 0.9], [110, 5, 0.6]].map(([v, r, o], i) => (
        <div key={i} style={abs({ inset: 0, opacity: o, backgroundImage: `radial-gradient(circle, ${C.n100} 0 ${r / 2}px, transparent ${r}px)`, backgroundSize: `${90 + i * 50}px ${110 + i * 40}px`, backgroundPosition: `${Math.sin(T * 0.8 + i) * 30}px ${T * v}px` })}></div>
      ))}
      {k === 'fog' && <div style={abs({ inset: 0, background: `linear-gradient(180deg, transparent 20%, color-mix(in oklab, ${C.n500} 35%, transparent) 60%, color-mix(in oklab, ${C.n600} 45%, transparent))` })}></div>}
      {strike > 0 && <div style={abs({ inset: 0, background: C.n100, opacity: strike * 0.35 })}></div>}
    </>
  );
}
const abs = (o) => ({ position: 'absolute', ...o });
const cam = (cx, cy, s) => ({ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(960px, 540px) scale(${s}) translate(${-cx}px, ${-cy}px)` });
const FADE_MASK = 'linear-gradient(90deg, transparent, #000 48px, #000 calc(100% - 48px), transparent)';

const STARS = Array.from({ length: 70 }, (_, i) => ({
  x: (i * 739) % 3400 - 100, y: 120 + ((i * 373) % 380), r: i % 7 === 0 ? 2.4 : 1.4, o: 0.25 + ((i * 17) % 10) / 22,
}));
const SKYLINE = Array.from({ length: 26 }, (_, i) => ({
  x: -200 + i * 140, w: 90 + ((i * 53) % 70), h: 90 + ((i * 97) % 230),
}));

// ---------- Zug (Seitenansicht) ----------
function TrainSide({ x, y, scale = 1, doors = 0, beam = 0 }) {
  return (
    <div style={abs({ left: x, top: y, width: 1580, height: 200, transformOrigin: '0 0', transform: `scale(${scale})` })}>
      <div style={abs({ left: -1100, top: -40, width: 1150, height: 260, opacity: beam, background: `radial-gradient(100% 50% at 100% 55%, color-mix(in oklab, ${C.n100} 55%, transparent) 0%, transparent 70%)` })}></div>
      <div style={abs({ left: 0, top: 0, width: 420, height: 175, borderRadius: '110px 12px 8px 8px', background: `linear-gradient(180deg, ${C.n800} 0%, ${C.surface} 22%, ${C.surface} 100%)`, border: `1px solid ${C.n800}` })}>
        <div style={abs({ left: 34, top: 26, width: 118, height: 58, borderRadius: '44px 6px 6px 6px', background: `linear-gradient(160deg, ${C.a800}, ${C.a900})`, borderTop: `1px solid ${C.a700}` })}></div>
        <div style={abs({ left: 250, top: -30, width: 70, height: 30, borderTop: `3px solid ${C.n600}`, borderLeft: `3px solid ${C.n700}`, transform: 'skewX(-30deg)' })}></div>
        <div style={abs({ left: 196, top: 58, fontFamily: FONT, fontSize: 18, fontWeight: 500, letterSpacing: '0.2em', color: C.n300 })}>DAVE·TV</div>
        <div style={abs({ left: 6, top: 132, width: 14, height: 14, borderRadius: '50%', background: C.n100, boxShadow: `0 0 18px 6px ${C.n100}`, opacity: 0.35 + beam * 0.65 })}></div>
      </div>
      {[440, 1020].map((cx, ci) => (
        <div key={cx} style={abs({ left: cx, top: 0, width: 560, height: 175, borderRadius: 12, background: `linear-gradient(180deg, ${C.n800} 0%, ${C.surface} 18%, ${C.surface} 100%)`, border: `1px solid ${C.n800}`, overflow: 'hidden' })}>
          {(ci === 0 ? [40, 110, 380, 450] : [40, 120, 200, 280, 360, 440]).map((wx) => (
            <div key={wx} style={abs({ left: wx, top: 30, width: 60, height: 50, borderRadius: 6, background: `linear-gradient(180deg, ${C.a300}, ${C.a400})`, opacity: 0.55, boxShadow: `0 0 16px ${C.a700}` })}></div>
          ))}
          {ci === 0 && (
            <div style={abs({ left: 220, top: 24, width: 124, height: 151, overflow: 'hidden', background: C.a200, borderRadius: '6px 6px 0 0' })}>
              <div style={abs({ inset: 0, background: `radial-gradient(80% 70% at 50% 40%, ${C.n100}, ${C.a300})`, opacity: 0.4 + doors * 0.6 })}></div>
              {[0, 62].map((dx, di) => (
                <div key={dx} style={abs({ left: dx, top: 0, width: 62, height: 151, transform: `translateX(${(di ? 62 : -62) * doors}px)`, background: C.n800, [di ? 'borderLeft' : 'borderRight']: `1px solid ${C.n600}` })}>
                  <div style={abs({ left: 14, top: 18, width: 34, height: 52, borderRadius: 4, background: C.a800 })}></div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {[[8, 652], [792, 786]].map(([l, w]) => (
        <div key={l} style={abs({ left: l, top: 116, width: w, height: 3, background: C.accent, boxShadow: `0 0 14px ${C.accent}`, maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK })}></div>
      ))}
      <div style={abs({ left: 1566, top: 136, width: 12, height: 12, borderRadius: '50%', background: C.red, boxShadow: `0 0 14px 5px ${C.red}` })}></div>
      {[60, 130, 300, 370, 510, 580, 870, 940, 1090, 1160, 1450, 1520].map((wx) => (
        <div key={wx} style={abs({ left: wx - 17, top: 160, width: 34, height: 34, borderRadius: '50%', background: C.n900, border: `2px solid ${C.n700}` })}></div>
      ))}
    </div>
  );
}

// ---------- 1+2 · Berglandschaft & Tunnel ----------
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const poly = (pts) => `polygon(${pts.map(([x, y]) => `${x.toFixed(0)}px ${y.toFixed(0)}px`).join(',')})`;
// Gezackter Gebirgskamm: große Gipfel mit kleinen Zacken dazwischen
const ridge = (seed, w, step, amp, h) => {
  const pts = [[0, h]];
  for (let i = 0, x = 0; x <= w; i++, x += step) {
    const peak = i % 2 === 0;
    const y = peak ? amp * (0.05 + 0.35 * rnd(seed + i)) : amp * (0.55 + 0.4 * rnd(seed + i));
    pts.push([x, y]);
    pts.push([x + step * 0.5, (peak ? y + amp * 0.12 : y - amp * 0.1) + amp * 0.06 * rnd(seed + i + 50)]);
  }
  pts.push([w, h]);
  return poly(pts);
};
// Nadelwald: Sägezahn aus Tannen unterschiedlicher Höhe
const forest = (seed, w, base, minH, maxH, h) => {
  const pts = [[0, h], [0, base]];
  for (let i = 0, x = 0; x < w; i++) {
    const tw = 26 + 22 * rnd(seed + i), th = minH + (maxH - minH) * rnd(seed + i * 3);
    pts.push([x, base], [x + tw * 0.5, base - th], [x + tw, base]);
    x += tw * (0.7 + 0.25 * rnd(seed + i * 7));
  }
  pts.push([w, base], [w, h]);
  return poly(pts);
};
const FAR = ridge(1, 6600, 170, 420, 800);
const MIDR = ridge(40, 6600, 230, 300, 700);
const HILLS = ridge(90, 6600, 420, 120, 400);
const FOREST_MID = forest(7, 6600, 90, 30, 70, 200);
const FOREST_NEAR = forest(21, 6600, 120, 50, 120, 260);
const FACE = poly([[0, 494], [0, 120], [300, 40], [520, 0], [700, 90], [860, 210], [980, 330], [1060, 420], [1135, 470], [1200, 494]]);
const VOUSSOIRS = Array.from({ length: 11 }, (_, i) => -90 + (i * 180) / 10);
// Tannen entlang einer Kante (z. B. Bergflanke über dem Tunnel)
const edgeTrees = (pts, seed, depth) => {
  const out = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.floor(len / 26));
    for (let j = 0; j < n; j++) {
      const t0 = j / n, t1 = (j + 1) / n, h = 26 + 44 * rnd(seed + k * 31 + j);
      const bx0 = x0 + (x1 - x0) * t0, by0 = y0 + (y1 - y0) * t0, bx1 = x0 + (x1 - x0) * t1, by1 = y0 + (y1 - y0) * t1;
      out.push([bx0, by0 + 6], [(bx0 + bx1) / 2, (by0 + by1) / 2 - h], [bx1, by1 + 6]);
    }
  }
  for (let k = pts.length - 1; k >= 0; k--) out.push([pts[k][0], pts[k][1] + depth]);
  return poly(out);
};
const GRASS = forest(77, 7600, 30, 6, 22, 40);
const FACE_TOP = [[0, 120], [300, 40], [520, 0], [700, 90], [860, 210], [980, 330], [1060, 420]];
const FACE_TREES = edgeTrees(FACE_TOP, 5, 40);
const CLOUDS = [[400, 120, 900, 90], [1500, 60, 1200, 110], [2500, 200, 800, 70], [3300, 90, 1100, 100]];
const PORTAL_RINGS = [1, 0.82, 0.66, 0.52];
const TRAIN_WINDOWS = [93, 510, 580, 850, 920, 1090, 1170, 1250, 1330, 1410, 1490];
const MOUTH = 586, SPEED = (6000 - 40) / 1; // SPEED wird unten durch die Laufzeit geteilt

function Landscape({ T, CUES, env }) {
  const F = CUES.Frontal;
  const starO = (SKY[env.daypart] || SKY.night).stars * (1 - (OVERCAST[env.kind] || 0));
  const trainX = M.run(T, 0, F - 0.55, 6000, 40);
  const [off, cy, s] = keyed(T, [
    [0, -2300, 330, 0.72],
    [2.8, -260, 470, 0.9],
    [4.6, -40, 530, 1.1],
    [6.6, -240, 490, 0.95],
    [CUES.Tunnel, -300, 520, 1.02],
    [F - 1.0, -120, 610, 1.4],
    [F - 0.4, 0, 660, 1.9],
    [F, 0, 684, 3.2],
  ]);
  const follow = trainX + 253 + off;
  const cx = follow + (548 - follow) * M.glide(T, F - 2.0, F - 0.7, 0, 1);
  const runEnd = F - 0.55, v = SPEED / runEnd;
  const passT = (off) => (6000 - (MOUTH - off * 0.32)) / v;
  const tNose = passT(0), tTail = passT(1572);
  const dist = trainX - MOUTH;
  const faceLit = T < tNose ? clamp(1 - dist / 1400, 0, 1) : 1 - M.glide(T, tNose, tNose + 0.5, 0, 1);
  const spark = Math.max(0, 1 - Math.abs(T - tNose - 0.05) / 0.08) + 0.6 * Math.max(0, 1 - Math.abs(T - tNose - 0.35) / 0.06);
  const dust = T > tTail ? M.glide(T, tTail, tTail + 1.4, 0, 1) : 0;
  const recede = (t0, dur) => clamp((T - t0) / dur, 0, 1);
  const noseIn = M.glide(T, tNose, tNose + 0.4, 0, 1);
  const inside = noseIn * (1 - M.glide(T, F - 0.6, F - 0.1, 0, 1));
  const layer = (d) => ({ position: 'absolute', left: 0, top: 0, transform: `translateX(${(cx * (1 - d)).toFixed(1)}px)` });
  const mist = (top, o) => ({ position: 'absolute', left: -600, top, width: 7600, height: 160, background: `linear-gradient(180deg, transparent, color-mix(in oklab, ${C.n300} ${o}%, transparent) 50%, transparent)` });
  const moonX = 2325 + cx * 0.75;
  const shade = (clip, top, h, o) => (
    <div style={abs({ left: -600, top, width: 6600, height: h, clipPath: clip })}>
      <div style={abs({ left: 46, top: 10, width: 6600, height: h, clipPath: clip, background: C.deep, opacity: o })}></div>
    </div>
  );
  const snowMask = 'linear-gradient(180deg, #000 0 40px, transparent 230px)';
  return (
    <div style={cam(cx, cy, s)}>
      <Sky env={env} box={{ left: -1200, top: -500, width: 9000, height: 2000 }} />
      <div style={layer(0.05)}>
        <SkyDetail env={env} T={T} y={0} />
        {STARS.map((st, i) => <div key={i} style={abs({ left: st.x, top: st.y - 120, width: st.r, height: st.r, borderRadius: '50%', background: C.n300, opacity: starO * st.o * (0.75 + 0.25 * Math.sin(T * 1.6 + i)) })}></div>)}
        <Orb env={env} x={2325} />
      </div>
      <div style={layer(0.12)}>
        <Clouds env={env} T={T} />
      </div>
      <div style={layer(0.22)}>
        <div style={abs({ left: -600, top: 150, width: 6600, height: 800, clipPath: FAR, background: `linear-gradient(180deg, ${C.sectionGhost} 0%, ${C.sectionGlow} 25%, ${C.section} 55%, ${C.bg} 90%)` })}></div>
        <div style={abs({ left: -600, top: 150, width: 6600, height: 800, clipPath: FAR, background: `linear-gradient(180deg, color-mix(in oklab, ${C.n100} 75%, transparent) 0, color-mix(in oklab, ${C.n300} 40%, transparent) 60px, transparent 110px)` })}></div>
        <div style={abs({ left: -600, top: 150, width: 6600, height: 800, clipPath: FAR, background: `repeating-linear-gradient(98deg, transparent 0 30px, color-mix(in oklab, ${C.n100} 28%, transparent) 30px 34px, transparent 34px 80px, color-mix(in oklab, ${C.n300} 18%, transparent) 80px 83px, transparent 83px 130px)`, maskImage: snowMask, WebkitMaskImage: snowMask })}></div>
        {shade(FAR, 150, 800, 0.5)}
      </div>
      <div style={layer(0.32)}><div style={mist(470, 12)}></div></div>
      <div style={layer(0.5)}>
        <div style={abs({ left: -600, top: 300, width: 6600, height: 700, clipPath: MIDR, background: `linear-gradient(180deg, ${C.surface}, ${C.mid} 35%, ${C.bg})` })}></div>
        <div style={abs({ left: -600, top: 300, width: 6600, height: 700, clipPath: MIDR, background: `linear-gradient(180deg, color-mix(in oklab, ${C.n300} 34%, transparent) 0, transparent 40px)` })}></div>
        {shade(MIDR, 300, 700, 0.55)}
        <div style={abs({ left: -600, top: 520, width: 6600, height: 200, clipPath: FOREST_MID, background: C.deep, opacity: 0.85 })}></div>
      </div>
      <div style={layer(0.62)}><div style={mist(575, 10)}></div></div>
      <div style={layer(0.8)}>
        <div style={abs({ left: -600, top: 470, width: 6600, height: 400, clipPath: HILLS, background: `linear-gradient(180deg, ${C.mid}, ${C.deep})` })}></div>
        <div style={abs({ left: -600, top: 510, width: 6600, height: 260, clipPath: FOREST_NEAR, background: C.deep })}></div>
        <div style={abs({ left: -600, top: 640, width: 7600, height: 64, background: `linear-gradient(180deg, color-mix(in oklab, ${C.section} 38%, ${C.deep}), ${C.deep})`, borderTop: `1px solid color-mix(in oklab, ${C.n300} 25%, transparent)` })}></div>
        <div style={abs({ left: moonX - 30, top: 642, width: 60, height: 58, background: `repeating-linear-gradient(180deg, color-mix(in oklab, ${C.n100} ${Math.round(38 + 14 * Math.sin(T * 5))}%, transparent) 0 2px, transparent 2px 7px)`, maskImage: 'radial-gradient(closest-side, #000, transparent)', WebkitMaskImage: 'radial-gradient(closest-side, #000, transparent)' })}></div>
      </div>
      <div style={layer(1)}>
        <div style={abs({ left: -600, top: 700, width: 7600, height: 34, background: `linear-gradient(180deg, ${C.n800}, ${C.n900})` })}></div>
        <div style={abs({ left: 480, top: 700, width: 6200, height: 12, background: `repeating-linear-gradient(90deg, ${C.n800} 0 10px, transparent 10px 26px)` })}></div>
        <div style={abs({ left: 480, top: 697, width: 6200, height: 3, background: C.n500 })}></div>
        <div style={abs({ left: trainX - 380, top: 690, width: 400, height: 16, background: `linear-gradient(90deg, transparent, color-mix(in oklab, ${C.n100} 45%, transparent))`, opacity: trainX > 548 ? 1 : 0 })}></div>
        {Array.from({ length: 29 }, (_, i) => 760 + i * 210).map((px) => (
          <Fragment key={px}>
            <div style={abs({ left: px, top: 590, width: 4, height: 112, background: C.n800 })}></div>
            <div style={abs({ left: px - 22, top: 598, width: 48, height: 3, background: C.n800 })}></div>
          </Fragment>
        ))}
        <div style={abs({ left: 480, top: 604, width: 6200, height: 1, background: C.n700 })}></div>
        <div style={abs({ left: -500, top: 240, width: 1140, height: 900, clipPath: FACE, background: `linear-gradient(205deg, ${C.surface}, ${C.mid} 25%, ${C.deep} 65%)` })}></div>
        <div style={abs({ left: -500, top: 240, width: 1140, height: 900, clipPath: FACE, background: `radial-gradient(18% 10% at 62% 30%, color-mix(in oklab, ${C.n500} 18%, transparent), transparent), radial-gradient(22% 12% at 40% 48%, rgba(0,0,0,.25), transparent), radial-gradient(14% 8% at 75% 55%, color-mix(in oklab, ${C.n500} 14%, transparent), transparent), radial-gradient(30% 14% at 30% 20%, rgba(0,0,0,.2), transparent)` })}></div>
        <div style={abs({ left: -500, top: 240, width: 1140, height: 900, clipPath: FACE_TREES, background: C.deep })}></div>
        <div style={abs({ left: -600, top: 732, width: 7600, height: 500, background: `linear-gradient(180deg, ${C.n900}, ${C.deep} 22%)` })}></div>
        <div style={abs({ left: -600, top: 722, width: 7600, height: 40, clipPath: GRASS, background: C.deep })}></div>
        <div style={abs({ left: 470, top: 560, width: 260, height: 180, clipPath: 'polygon(0 100%, 0 30%, 30% 0, 100% 60%, 100% 100%)', background: `linear-gradient(200deg, ${C.mid}, ${C.deep})` })}></div>
        <div style={abs({ left: 560, top: 640, width: 150, height: 94, clipPath: 'polygon(0 0, 100% 70%, 100% 100%, 0 100%)', background: `linear-gradient(180deg, ${C.n700}, ${C.n800})` })}></div>
        <div style={abs({ left: 560, top: 640, width: 150, height: 94, clipPath: 'polygon(0 0, 100% 70%, 100% 100%, 0 100%)', background: `repeating-linear-gradient(-25deg, transparent 0 11px, ${C.n900} 11px 12px), repeating-linear-gradient(90deg, transparent 0 22px, ${C.n900} 22px 23px)`, opacity: 0.55 })}></div>
        <div style={abs({ left: 0, top: 0, width: 1200, height: 800, transformOrigin: '548px 734px', transform: 'scaleX(0.52) skewY(-6deg)' })}>
          <div style={abs({ left: 432, top: 590, width: 232, height: 144, background: `linear-gradient(90deg, ${C.n800}, ${C.n700} 60%, ${C.n600})` })}></div>
          <div style={abs({ left: 432, top: 590, width: 232, height: 144, background: `repeating-linear-gradient(0deg, transparent 0 15px, ${C.n900} 15px 16px), repeating-linear-gradient(90deg, transparent 0 31px, ${C.n900} 31px 32px)`, opacity: 0.45 })}></div>
          <div style={abs({ left: 472, top: 618, width: 152, height: 116, borderRadius: '76px 76px 0 0', background: C.deep, overflow: 'hidden' })}>
            {PORTAL_RINGS.map((r, i) => (
              <div key={i} style={abs({ left: 76 - 76 * r + 30 * (1 - r), top: 116 - 116 * r, width: 152 * r, height: 116 * r, borderRadius: `${76 * r}px ${76 * r}px 0 0`, border: `2px solid ${C.n600}`, borderBottom: 'none', boxSizing: 'border-box', opacity: inside * (0.9 - i * 0.18) })}></div>
            ))}
            <div style={abs({ inset: 0, background: `radial-gradient(70% 60% at 60% 85%, color-mix(in oklab, ${C.n100} 55%, transparent), transparent 75%)`, opacity: inside })}></div>
            {TRAIN_WINDOWS.map((wx) => {
              const p = recede(passT(wx), 0.9);
              if (p <= 0 || p >= 1) return null;
              const e = 1 - Math.pow(1 - p, 2), sc = 1 - 0.88 * e;
              return <div key={wx} style={abs({ left: 132 - 82 * e - 15 * sc, top: 78 - 8 * e - 8 * sc, width: 30 * sc, height: 16 * sc, borderRadius: 2, background: C.a300, opacity: 0.9 * (1 - p), boxShadow: `0 0 ${10 * sc}px ${C.a400}` })}></div>;
            })}
            {(() => {
              const p = recede(tTail, 0.9);
              if (p <= 0 || p >= 1) return null;
              const e = 1 - Math.pow(1 - p, 2), r = 10 * (1 - 0.85 * e);
              return <div style={abs({ left: 132 - 82 * e - r / 2, top: 84 - 8 * e - r / 2, width: r, height: r, borderRadius: '50%', background: C.red, boxShadow: `0 0 ${14 * (1 - e) + 4}px ${6 * (1 - e) + 1}px ${C.red}`, opacity: 1 - p * p })}></div>;
            })()}
            <div style={abs({ left: 30, top: 50, width: 60, height: 50, borderRadius: '50%', background: `radial-gradient(closest-side, color-mix(in oklab, ${C.n100} 60%, transparent), transparent)`, opacity: noseIn * (1 - recede(tNose + 0.6, 1.2)) })}></div>
            <div style={abs({ inset: 0, boxShadow: 'inset 18px 16px 30px rgba(0,0,0,.8)' })}></div>
          </div>
          <div style={abs({ left: 452, top: 598, width: 192, height: 136, borderRadius: '96px 96px 0 0', border: `20px solid ${C.n500}`, borderBottom: 'none', boxSizing: 'border-box' })}></div>
          {VOUSSOIRS.map((deg) => (
            <div key={deg} style={abs({ left: 547, top: 694, width: 2, height: 96, transformOrigin: '1px 0', transform: `rotate(${deg + 180}deg)`, background: `linear-gradient(180deg, transparent 0 76px, ${C.n700} 76px)` })}></div>
          ))}
          <div style={abs({ left: 432, top: 578, width: 248, height: 156, background: `radial-gradient(90% 70% at 100% 85%, color-mix(in oklab, ${C.n100} 45%, transparent), transparent 70%)`, opacity: faceLit })}></div>
          <div style={abs({ left: 534, top: 594, width: 28, height: 26, borderRadius: 3, background: C.n300 })}></div>
          <div style={abs({ left: 424, top: 578, width: 248, height: 12, borderRadius: 2, background: C.n600 })}></div>
          <div style={abs({ left: 664, top: 578, width: 16, height: 156, background: `linear-gradient(90deg, ${C.n500}, ${C.n600})` })}></div>
        </div>
        <div style={abs({ left: 548, top: 600, width: 6200, height: 200, overflow: 'hidden', clipPath: 'polygon(38px 0, 100% 0, 100% 100%, 38px 100%)' })}>
          <TrainSide x={trainX - 548} y={57} scale={0.32} beam={1} />
          <div style={abs({ inset: 0, filter: 'brightness(0.2)', maskImage: 'linear-gradient(90deg, #000 0 40px, transparent 220px)', WebkitMaskImage: 'linear-gradient(90deg, #000 0 40px, transparent 220px)' })}>
            <TrainSide x={trainX - 548} y={57} scale={0.32} beam={0} />
          </div>
        </div>
        <div style={abs({ left: 578, top: 590, width: 30, height: 30, borderRadius: '50%', background: `radial-gradient(closest-side, ${C.n100}, color-mix(in oklab, ${C.a300} 60%, transparent) 40%, transparent)`, opacity: clamp(spark, 0, 1) })}></div>
        <div style={abs({ left: 600 - 120 * (0.5 + dust), top: 700 - 60 * (0.5 + dust), width: 240 * (0.5 + dust), height: 120 * (0.5 + dust), borderRadius: '50%', background: `radial-gradient(closest-side, color-mix(in oklab, ${C.n500} 40%, transparent), transparent)`, opacity: dust > 0 ? Math.sin(dust * Math.PI) * 0.7 : 0 })}></div>
        <div style={abs({ left: 470, top: 540, width: 12, height: 8, borderRadius: 2, background: C.n300, boxShadow: `0 0 18px 6px color-mix(in oklab, ${C.a200} 40%, transparent)` })}></div>
        <div style={abs({ left: 430, top: 734, width: 260, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,.35)' })}></div>
        <div style={abs({ left: 420, top: 734, width: 240, height: 90, background: `radial-gradient(50% 40% at 50% 0%, color-mix(in oklab, ${C.n100} 30%, transparent), transparent)`, opacity: inside })}></div>
      </div>
    </div>
  );
}

// ---------- 3 · Frontal: der Zug kommt aus dem Tunnel auf uns zu ----------
function Frontal({ T, CUES }) {
  const F = CUES.Frontal, E = CUES.Einfahrt;
  const k = M.approach(T, F + 0.2, E - 0.05, 0.03, 4.2);
  const lit = M.approach(T, F + 0.2, E, 0.05, 1);
  const shake = k > 1 ? Math.sin(T * 90) * (k - 1) * 3 : 0;
  const rings = Array.from({ length: 8 }, (_, i) => Math.pow(0.66, i));
  const rail = (bx) => `polygon(${bx}px 1080px, ${bx + 16}px 1080px, 961px 560px, 959px 560px)`;
  return (
    <div style={abs({ inset: 0, background: C.deep, transform: `translate(${shake}px, ${shake * 0.6}px)` })}>
      {rings.map((r, i) => (
        <div key={i} style={abs({ left: 960 - 1000 * r, top: 560 - 900 * r, width: 2000 * r, height: 900 * r + 520 * r, borderRadius: `${1000 * r}px ${1000 * r}px 0 0`, border: `${Math.max(1, 6 * r)}px solid ${C.n700}`, borderBottom: 'none', opacity: (0.15 + 0.85 * lit) * (1 - i / 9) })}></div>
      ))}
      <div style={abs({ inset: 0, clipPath: rail(690), background: C.n500, opacity: 0.3 + 0.7 * lit })}></div>
      <div style={abs({ inset: 0, clipPath: rail(1214), background: C.n500, opacity: 0.3 + 0.7 * lit })}></div>
      <div style={abs({ left: 960 - 900, top: 560 - 500, width: 1800, height: 1000, background: `radial-gradient(closest-side, color-mix(in oklab, ${C.n100} ${Math.round(60 * lit)}%, transparent), transparent)` })}></div>
      <div style={abs({ left: 960 - 210, top: 600 - 200, width: 420, height: 400, transform: `scale(${k})`, transformOrigin: '50% 50%' })}>
        <div style={abs({ left: 0, top: 0, width: 420, height: 380, borderRadius: '150px 150px 16px 16px', background: `linear-gradient(180deg, ${C.n800}, ${C.surface} 30%)`, border: `2px solid ${C.n700}` })}></div>
        <div style={abs({ left: 50, top: 70, width: 320, height: 110, borderRadius: '90px 90px 10px 10px', background: `linear-gradient(170deg, ${C.a800}, ${C.a900})`, borderTop: `2px solid ${C.a700}` })}></div>
        <div style={abs({ left: 140, top: 205, fontFamily: FONT, fontSize: 22, fontWeight: 500, letterSpacing: '0.2em', color: C.n300 })}>DAVE·TV</div>
        <div style={abs({ left: 30, top: 250, width: 360, height: 4, background: C.accent, boxShadow: `0 0 16px ${C.accent}`, maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK })}></div>
        {[62, 322].map((lx) => <div key={lx} style={abs({ left: lx, top: 290, width: 36, height: 36, borderRadius: '50%', background: C.n100, boxShadow: `0 0 40px 16px ${C.n100}` })}></div>)}
      </div>
    </div>
  );
}

// ---------- 4–7 · Bahnhof ----------
function Station({ T, CUES, title, env }) {
  const starO = (SKY[env.daypart] || SKY.night).stars * (1 - (OVERCAST[env.kind] || 0));
  const E = CUES.Einfahrt, B = CUES.Tafel, S = CUES.Signal, D = CUES.Einstieg;
  const trainX = M.brake(T, E + 0.1, B - 0.2, 3700, 900);
  const beam = M.glide(T, E, E + 0.3, 0, 1) * (1 - M.glide(T, B - 0.3, B + 0.5, 0, 1));
  const boardOn = M.glide(T, B - 0.1, B + 0.5, 0, 1);
  const green = T >= S + 0.5;
  const greenGlow = green ? M.pop(T, S + 0.5, S + 1.0, 0, 1) : 0;
  const doors = M.glide(T, D + 0.5, D + 1.7, 0, 1);
  const spill = M.glide(T, D + 0.7, D + 2.2, 0, 1);
  const flaps = [...title].map((ch, i) => {
    const rollStart = B + 0.4 + i * 0.02, settle = B + 1.0 + i * 0.09;
    if (T < rollStart) return { ch: '', state: 'idle', y: 0 };
    if (T < settle) return { ch: CHARS[(Math.floor(T * 28) + i * 7) % CHARS.length], state: 'roll', y: 0 };
    return { ch, state: 'set', y: M.pop(T, settle, settle + 0.3, -8, 0) };
  });
  const SUB = 'Content-Stellwerk · Bitte einsteigen';
  const subN = Math.round(M.glide(T, B + 2.5, B + 3.3, 0, SUB.length));
  const caret = T > B + 2.4 && Math.floor(T * 2.5) % 2 === 0;
  const cellW = Math.min(54, Math.floor((954 - (title.length - 1) * 6) / Math.max(1, title.length)));
  const L = Math.log;
  const [cx, cy, ls] = keyed(T, [
    [E, 1560, 570, L(0.74)],
    [B - 0.2, 1500, 540, L(0.78)],
    [D, 1400, 490, L(0.9)],
    [D + 1.2, 1600, 630, L(1.1)],
    [D + 2.2, 1622, 652, L(1.5)],
    [D + 3.3, 1622, 658, L(3.6)],
    [CUES.__end, 1622, 659, L(10)],
  ]);
  const s = Math.exp(ls);
  return (
    <div style={cam(cx, cy, s)}>
      <Sky env={env} box={{ left: -600, top: -200, width: 4400, height: 1500 }} />
      <SkyDetail env={env} T={T} y={150} />
      <div style={abs({ left: 0, top: 110, width: 3200, height: 400 })}><Clouds env={env} T={T} /></div>
      {STARS.map((st, i) => <div key={i} style={abs({ left: st.x, top: st.y, width: st.r, height: st.r, borderRadius: '50%', background: C.n300, opacity: starO * st.o * (0.75 + 0.25 * Math.sin(T * 1.6 + i)) })}></div>)}
      {SKYLINE.map((b, i) => (
        <div key={i} style={abs({ left: b.x, top: 745 - b.h, width: b.w, height: b.h, background: C.mid, borderTop: `1px solid ${C.surface}` })}>
          {i % 3 === 0 && <div style={abs({ left: 18, top: 24, width: 6, height: 8, background: C.a700, opacity: 0.7 })}></div>}
        </div>
      ))}
      <div style={abs({ left: -400, top: 470, width: 4000, height: 280, background: `linear-gradient(180deg, ${C.surface}, ${C.mid})`, borderTop: `2px solid ${C.n800}` })}></div>
      {Array.from({ length: 26 }, (_, i) => -340 + i * 150).map((wx, i) => (
        <div key={wx} style={abs({ left: wx, top: 510, width: 64, height: 110, borderRadius: '32px 32px 4px 4px', background: i % 3 === 1 ? `linear-gradient(180deg, ${C.a700}, ${C.a800})` : C.deep, boxShadow: i % 3 === 1 ? `0 0 30px color-mix(in oklab, ${C.a700} 50%, transparent)` : 'none', border: `1px solid ${C.n800}` })}></div>
      ))}
      <div style={abs({ left: -400, top: 650, width: 4000, height: 2, background: C.n800 })}></div>
      {[300, 2760].map((x) => <div key={x} style={abs({ left: x, top: 90, width: 26, height: 700, background: C.surface, borderLeft: `1px solid ${C.n800}` })}></div>)}
      <div style={abs({ left: 2700, top: 330, width: 146, height: 58, background: C.bg, border: `1px solid ${C.n800}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, fontSize: 24, fontWeight: 500, letterSpacing: '0.12em', color: C.n300 })}>GLEIS 1</div>
      <div style={abs({ left: 548, top: 470, width: 10, height: 280, background: C.n800 })}></div>
      <div style={abs({ left: 518, top: 350, width: 70, height: 136, borderRadius: 34, background: C.n900, border: `1px solid ${C.n800}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-evenly' })}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: green ? C.n800 : C.red, boxShadow: green ? 'none' : `0 0 28px 6px ${C.red}` }}></div>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: green ? C.green : C.n800, boxShadow: green ? `0 0 ${20 + greenGlow * 40}px ${4 + greenGlow * 10}px ${C.green}` : 'none' }}></div>
      </div>
      <div style={abs({ left: 53, top: -80, width: 1000, height: 1000, borderRadius: '50%', background: `radial-gradient(circle, color-mix(in oklab, ${green ? C.green : C.red} 22%, transparent) 0%, transparent 55%)`, opacity: green ? greenGlow : 0.8 })}></div>
      <div style={abs({ left: -400, top: 750, width: 4000, height: 44, background: `linear-gradient(180deg, ${C.n900}, ${C.deep})` })}></div>
      <div style={abs({ left: -300, top: 748, width: 3800, height: 6, background: C.n700 })}></div>
      <div style={abs({ left: -300, top: 760, width: 3800, height: 22, background: `repeating-linear-gradient(90deg, ${C.n900} 0 26px, transparent 26px 70px)` })}></div>
      <TrainSide x={trainX} y={560} doors={doors} beam={beam} />
      <div style={abs({ left: -400, top: 792, width: 4000, height: 800, background: `linear-gradient(180deg, ${C.n900} 0%, ${C.bg} 30%)` })}></div>
      <div style={abs({ left: -400, top: 792, width: 4000, height: 2, background: C.n700 })}></div>
      <div style={abs({ left: -400, top: 812, width: 4000, height: 4, background: `repeating-linear-gradient(90deg, ${C.a400} 0 30px, transparent 30px 44px)`, opacity: 0.7 })}></div>
      <div style={abs({ left: -400, top: 794, width: 4000, height: 400, overflow: 'hidden', opacity: 0.22, maskImage: 'linear-gradient(180deg, #000, transparent 55%)', WebkitMaskImage: 'linear-gradient(180deg, #000, transparent 55%)' })}>
        <div style={abs({ left: 400, top: 0, width: 3800, height: 800, transformOrigin: '0 0', transform: 'translateY(794px) scaleY(-1)' })}>
          <div style={abs({ left: -400, top: 0, width: 3800, height: 800 })}><TrainSide x={trainX} y={560} doors={doors} beam={0} /></div>
        </div>
      </div>
      <div style={abs({ left: -400, top: 830, width: 4000, height: 260, background: `repeating-linear-gradient(90deg, transparent 0 118px, color-mix(in oklab, ${C.n800} 60%, transparent) 118px 120px), repeating-linear-gradient(0deg, transparent 0 58px, color-mix(in oklab, ${C.n800} 45%, transparent) 58px 60px)`, maskImage: 'linear-gradient(180deg, #000, transparent)', WebkitMaskImage: 'linear-gradient(180deg, #000, transparent)' })}></div>
      <div style={abs({ left: 2330, top: 862, width: 220, height: 14, borderRadius: 4, background: C.n800 })}></div>
      <div style={abs({ left: 2330, top: 830, width: 220, height: 26, borderRadius: 4, background: C.n900, border: `1px solid ${C.n800}` })}></div>
      {[2350, 2516].map((x) => <div key={x} style={abs({ left: x, top: 876, width: 12, height: 40, background: C.n800 })}></div>)}
      <div style={abs({ left: 1300, top: 794, width: 650, height: 280, opacity: spill, background: `radial-gradient(50% 60% at 50% 0%, color-mix(in oklab, ${C.a200} 45%, transparent), transparent 75%)` })}></div>
      <div style={abs({ left: -400, top: -200, width: 4000, height: 300, background: C.surface, borderBottom: `1px solid ${C.n800}` })}></div>
      <div style={abs({ left: -400, top: 100, width: 4000, height: 34, background: `repeating-linear-gradient(45deg, transparent 0 22px, ${C.n800} 22px 25px), repeating-linear-gradient(-45deg, transparent 0 22px, ${C.n800} 22px 25px)`, borderBottom: `3px solid ${C.n800}` })}></div>
      {[760, 2320, 3000].map((x) => (
        <Fragment key={x}>
          <div style={abs({ left: x - 60, top: 100, width: 120, height: 10, borderRadius: 4, background: C.n300 })}></div>
          <div style={abs({ left: x - 260, top: 110, width: 520, height: 690, clipPath: 'polygon(40% 0, 60% 0, 100% 100%, 0 100%)', background: `linear-gradient(180deg, color-mix(in oklab, ${C.n100} 12%, transparent), transparent 90%)` })}></div>
        </Fragment>
      ))}
      {[1250, 1950].map((x) => <div key={x} style={abs({ left: x, top: 100, width: 6, height: 62, background: C.n800 })}></div>)}
      <div style={abs({ left: 1095, top: 160, width: 1010, height: 290, borderRadius: 12, background: C.bg, border: `1px solid ${C.n800}`, boxShadow: `0 20px 60px rgba(0,0,0,.45), 0 0 ${80 * boardOn}px color-mix(in oklab, ${C.accent} ${Math.round(18 * boardOn)}%, transparent)`, padding: '24px 28px', boxSizing: 'border-box', fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 18 })}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, fontWeight: 500, letterSpacing: '0.14em', color: C.n300, opacity: 0.35 + boardOn * 0.65 }}>
          <span>GLEIS 1 · ABFAHRT</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: C.a300 }}>20:15</span>
        </div>
        <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${C.a700} 48px, ${C.a700} calc(100% - 48px), transparent)`, opacity: boardOn }}></div>
        <div style={{ display: 'flex', gap: 6 }}>
          {flaps.map((f, i) => (
            <div key={i} style={{ position: 'relative', width: cellW, height: 80, borderRadius: 6, background: C.surface, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(cellW * 0.9), fontWeight: 500, color: f.state === 'set' ? C.n100 : C.a400 }}>
              <span style={{ transform: `translateY(${f.y}px)` }}>{f.ch}</span>
              <div style={abs({ left: 0, right: 0, top: 39, height: 2, background: C.bg })}></div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 26, fontWeight: 400, color: C.n300, height: 34, display: 'flex', alignItems: 'center' }}>
          {SUB.slice(0, subN)}
          <span style={{ width: 2, height: 26, marginLeft: 3, background: C.a400, opacity: caret ? 1 : 0 }}></span>
        </div>
      </div>
    </div>
  );
}

// Das ganze Bild zur Zeit T (Sekunden). Wetter-Schild, Überspringen und
// Fortschritt stehen als echtes HTML in index.html (js/intro.js füllt sie).
export function Piece({ T, cues, time, authoredTotal, tweaks, live }) {
  const CUES = { ...cues, __end: authoredTotal };
  const F = CUES.Frontal, E = CUES.Einfahrt;
  const fade = Math.max(1 - M.glide(T, 0, 0.7, 0, 1), M.glide(T, authoredTotal - 0.7, authoredTotal, 0, 1));
  const bloom = M.glide(T, authoredTotal - 1.4, authoredTotal - 0.5, 0, 1) * (1 - M.glide(T, authoredTotal - 0.5, authoredTotal, 0, 1));
  const flash = T < E ? M.approach(T, E - 0.45, E, 0, 1) : 1 - M.glide(T, E, E + 0.9, 0, 1);
  const title = (tweaks.title || 'ZUGFAHRER_DAVETV').toUpperCase().slice(0, 18);
  const env = {
    kind: tweaks.weather && tweaks.weather !== 'auto' ? tweaks.weather : live.kind,
    daypart: tweaks.daypart && tweaks.daypart !== 'auto' ? tweaks.daypart : live.daypart,
  };
  return (
    <div data-screen-label={`Intro ${Math.floor(time)}s`} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: C.bg, fontFamily: FONT }}>
      <Shot from={0} to={F}><Landscape T={T} CUES={CUES} env={env} /></Shot>
      <Shot from={F} to={E}><Frontal T={T} CUES={CUES} /></Shot>
      <Shot from={E} to={authoredTotal + 1}><Station T={T} CUES={CUES} title={title} env={env} /></Shot>
      <div style={abs({ inset: 0, pointerEvents: 'none', background: 'radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(0,0,0,.45) 100%)' })}></div>
      <Weather env={env} T={T} />
      <div style={abs({ inset: 0, background: `radial-gradient(circle, ${C.n100}, ${C.a200})`, opacity: flash })}></div>
      <div style={abs({ inset: 0, background: `radial-gradient(60% 60% at 50% 50%, ${C.a200}, color-mix(in oklab, ${C.a300} 60%, transparent) 60%, transparent)`, opacity: bloom * 0.7 })}></div>
      <div style={abs({ inset: 0, background: C.bg, opacity: fade })}></div>
    </div>
  );
}

