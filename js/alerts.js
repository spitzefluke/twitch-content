// Alerts im OBS-Overlay: neue Follower, Abos, Resubs, verschenkte Abos, Bits und Kanalpunkte.
// Die Zeilen kommen aus stream_alerts (twitch-eventsub schreibt sie, alert_test für Proben).
import { BOARD } from './prank-fx.js';

// Die Alert-Arten mit dem Namen ihres Sound-Parameters (overlay.html?sfollow=gong …)
export const ALERT_KINDS = [
  { kind: 'follow', param: 'sfollow', label: '💜 Follower' },
  { kind: 'sub', param: 'ssub', label: '⭐ Abo' },
  { kind: 'resub', param: 'sresub', label: '🔁 Resub' },
  { kind: 'gift', param: 'sgift', label: '🎁 Verschenkte Abos' },
  { kind: 'bits', param: 'sbits', label: '💎 Bits' },
  { kind: 'redeem', param: 'sredeem', label: '🎟️ Kanalpunkte' },
];

// Design-Bibliothek der Alerts (Overlay-Parameter alook). Neue Designs: hier eintragen und in
// css/overlay.css unter „Alert-Designs“ als .ov-alert[data-look="…"] gestalten.
export const ALERT_LOOKS = [
  { id: 'classic', name: 'Klassik', desc: 'Karte mit Konfetti und Lichtstreifen' },
  { id: 'neon', name: 'Neon', desc: 'Leuchtschrift, flackert beim Einschalten' },
  { id: 'banner', name: 'Banner', desc: 'Breiter Streifen, fährt von der Seite ein' },
  { id: 'bubble', name: 'Comic', desc: 'Bunte Sprechblase, springt ins Bild' },
  { id: 'glass', name: 'Glas', desc: 'Milchglas, ruhig und edel' },
  { id: 'minimal', name: 'Minimal', desc: 'Nur Schrift, ohne Karte' },
  { id: 'retro', name: 'Arcade', desc: 'Pixel-Look mit Scanlines' },
  { id: 'glitch', name: 'Glitch', desc: 'Digitaler Störeffekt' },
  { id: 'hype', name: 'Hype', desc: 'Regenbogen-Rand, der rundherum läuft' },
  { id: 'gold', name: 'Gold', desc: 'Edel in Schwarz und Gold' },
];
export const alertLook = (id) => (ALERT_LOOKS.some((l) => l.id === id) ? id : 'classic');

// Eigene Alert-Sounds: so lang und so groß dürfen sie sein (wie in …_alert_sound_length.sql)
export const ALERT_SOUND_SECONDS = 20;
export const ALERT_SOUND_BYTES = 4 * 1024 * 1024;

const TIERS = { 2000: 'Stufe 2', 3000: 'Stufe 3' };

// Was die Karte bei einem Alert zeigt
export function alertText(a) {
  const tier = TIERS[a.tier] ? ` · ${TIERS[a.tier]}` : '';
  switch (a.kind) {
    case 'follow':
      return { icon: '💜', title: 'Neuer Follower', sub: 'Willkommen in der Community!' };
    case 'sub':
      return { icon: '⭐', title: `Neues Abo${tier}`, sub: 'Danke fürs Abonnieren!' };
    case 'resub':
      return {
        icon: '🔁',
        title: a.months > 1 ? `${a.months} Monate Abo${tier}` : `Abo verlängert${tier}`,
        sub: a.message?.trim() || 'Danke für die Treue!',
      };
    case 'gift': {
      const n = Math.max(1, a.amount | 0);
      return { icon: '🎁', title: n === 1 ? `Abo verschenkt${tier}` : `${n} Abos verschenkt${tier}`, sub: 'Danke für die Geschenke!' };
    }
    case 'bits': {
      const n = Math.max(1, a.amount | 0);
      return { icon: '💎', title: `${n.toLocaleString('de-DE')} ${n === 1 ? 'Bit' : 'Bits'}`, sub: a.message?.trim() || 'Danke für die Bits!' };
    }
    case 'redeem': {
      const n = Math.max(0, a.amount | 0);
      return { icon: '🎟️', title: a.message?.trim() || 'Kanalpunkte eingelöst', sub: n ? `für ${n.toLocaleString('de-DE')} Kanalpunkte` : 'Kanalpunkte eingelöst' };
    }
    default:
      return { icon: '🔔', title: 'Alert', sub: '' };
  }
}

// Kurze Klänge, gebaut mit Sfx aus prank-fx.js (kein Audio-Download nötig)
export function alertSound(sfx, kind) {
  if (kind === 'follow') {
    // Zwei helle Glöckchen
    sfx.tone(784, { type: 'triangle', release: 0.5, peak: 0.22 });
    sfx.tone(1175, { at: 0.14, type: 'triangle', release: 0.8, peak: 0.2 });
    return;
  }
  if (kind === 'redeem') {
    // Kurzer „Plopp“ nach oben
    sfx.tone(660, { type: 'triangle', release: 0.25, peak: 0.18 });
    sfx.tone(990, { at: 0.09, type: 'triangle', release: 0.45, peak: 0.16 });
    return;
  }
  if (kind === 'bits') {
    // Münz-Klimpern: schnelle helle Töne nach oben
    [1319, 1568, 1976, 2637].forEach((f, i) => sfx.tone(f, { at: i * 0.07, type: 'square', release: 0.18, peak: 0.05, filter: { type: 'lowpass', freq: 5000 } }));
    sfx.tone(2637, { at: 0.3, type: 'sine', release: 0.9, peak: 0.12 });
    return;
  }
  // Abo: kleine Fanfare (C-E-G-C), Geschenke mit Glitzer obendrauf
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    const last = i === notes.length - 1;
    sfx.tone(f, { at: i * 0.11, type: 'sawtooth', attack: 0.01, hold: last ? 0.35 : 0.05, release: last ? 0.6 : 0.1, peak: 0.08, filter: { type: 'lowpass', freq: 2600 } });
    sfx.tone(f / 2, { at: i * 0.11, type: 'triangle', attack: 0.01, hold: last ? 0.35 : 0.05, release: last ? 0.6 : 0.1, peak: 0.1 });
  });
  if (kind === 'gift') {
    for (let i = 0; i < 6; i++) sfx.tone(1568 + i * 220, { at: 0.5 + i * 0.07, type: 'sine', release: 0.25, peak: 0.07 });
  }
}

// Sound eines Alerts: "default" (eigener Klang je Art), "none", ein Sound vom
// Soundboard (z. B. "gong"), ein eigener Alert-Sound als "a:<pfad>" oder ein
// Sound aus „Ärgere den Streamer“ als "c:<pfad>". urlFor bekommt den ganzen Wert.
// Liefert ein Promise, das endet, wenn eine Sound-Datei fertig ist – so bleibt
// der Alert stehen, solange sein Sound läuft.
export function playAlertSound(sfx, kind, choice = 'default', urlFor = null) {
  if (choice === 'none') return Promise.resolve();
  if (/^[ac]:/.test(choice)) {
    const url = urlFor?.(choice);
    if (url) return sfx.playUrl(url, choice.startsWith('a:') ? ALERT_SOUND_SECONDS : undefined);
  } else if (BOARD.some((b) => b.id === choice)) {
    sfx.play(choice);
    return Promise.resolve();
  }
  alertSound(sfx, kind);
  return Promise.resolve();
}

// Probe-Alerts zum Einrichten (test=1)
const NAMES = ['NightOwl_Mia', 'PixelPaul', 'GG_Gina', 'LootLukas', 'CrispyCarl', 'StreamSofia'];
export function sampleAlert(kind, n = 0) {
  return {
    id: `test-${Date.now()}-${n}`, created_at: new Date().toISOString(), kind, test: true, tier: '1000',
    user_name: NAMES[n % NAMES.length],
    months: kind === 'resub' ? 7 : 0,
    amount: kind === 'gift' ? 5 : kind === 'bits' ? 500 : kind === 'redeem' ? 1000 : 0,
    message: kind === 'resub' ? 'Weiter so!' : kind === 'redeem' ? '🎡 Glücksrad' : '',
  };
}

// ============================================================
// Alert-Designer (Tabelle alert_config, Migration …_overlay_designs.sql)
// ============================================================
// Je Alert-Art ein Design: Grund-Design (Look), Bild/GIF/Video, Layout, drei Textzeilen mit
// Platzhaltern, Textanimation, Einblenden, Dauer, Farbe und Sound. Varianten nach Menge
// (z. B. ab 1000 Bits) haben ein eigenes, vollständiges Design.
// { v: 1, kinds: { follow: {…}, … }, vars: [{ id, kind, min, design: {…} }] }

// Eingebaute, animierte Bilder (assets/alerts/*.svg)
export const ALERT_MEDIA = [
  { id: 'star', name: 'Stern' }, { id: 'heart', name: 'Herz' }, { id: 'crown', name: 'Krone' },
  { id: 'coin', name: 'Münze' }, { id: 'diamond', name: 'Diamant' }, { id: 'rocket', name: 'Rakete' },
  { id: 'gift', name: 'Geschenk' }, { id: 'boom', name: 'WOW!' }, { id: 'bolt', name: 'Blitz' },
  { id: 'flame', name: 'Feuer' }, { id: 'trophy', name: 'Pokal' }, { id: 'snow', name: 'Schneeflocke' },
  { id: 'party', name: 'Party' },
];
export const builtinMediaUrl = (id) => new URL(`../assets/alerts/${id}.svg`, import.meta.url).href;

export const TEXT_ANIMS = [
  { id: 'none', name: 'Keine' }, { id: 'wave', name: 'Welle' }, { id: 'bounce', name: 'Hüpfen' },
  { id: 'shake', name: 'Wackeln' }, { id: 'glow', name: 'Leuchten' }, { id: 'type', name: 'Schreibmaschine' },
  { id: 'rubber', name: 'Gummi' }, { id: 'rainbow', name: 'Regenbogen' },
];
export const ENTER_ANIMS = [
  { id: '', name: 'wie das Design' }, { id: 'pop', name: 'Aufploppen' }, { id: 'slide', name: 'Reinschieben' },
  { id: 'drop', name: 'Von oben fallen' }, { id: 'zoom', name: 'Heranzoomen' }, { id: 'fade', name: 'Einblenden' },
  { id: 'flip', name: 'Umdrehen' }, { id: 'spin', name: 'Wirbeln' },
];
export const ALERT_LAYOUTS = [
  { id: 'top', name: 'Bild oben' }, { id: 'side', name: 'Bild links' }, { id: 'bg', name: 'Bild als Hintergrund' },
];
export const PLACEHOLDERS = ['{name}', '{amount}', '{months}', '{tier}', '{message}', '{reward}'];
// Varianten gibt es nur, wo es eine Menge gibt
export const VARIANT_KINDS = { bits: 'Bits', gift: 'Abos', resub: 'Monate', redeem: 'Kanalpunkte' };

// Fertige Designs – ein Klick setzt Look, Bild, Animationen und Farbe
export const ALERT_PRESETS = [
  { id: 'party', name: 'Lila Party', design: { look: 'classic', media: 'b:party', layout: 'top', anim: 'wave', enter: 'pop', color: '#9146ff' } },
  { id: 'star', name: 'Sternstunde', design: { look: 'glass', media: 'b:star', layout: 'top', anim: 'bounce', enter: 'zoom', color: '#ffd23f' } },
  { id: 'neon', name: 'Neon-Herz', design: { look: 'neon', media: 'b:heart', layout: 'top', anim: 'glow', enter: 'fade', color: '#ff4fd8' } },
  { id: 'arcade', name: 'Arcade', design: { look: 'retro', media: 'b:coin', layout: 'side', anim: 'type', enter: 'drop', color: '#3ddc84' } },
  { id: 'comic', name: 'Comic', design: { look: 'bubble', media: 'b:boom', layout: 'top', anim: 'shake', enter: 'pop', color: '' } },
  { id: 'royal', name: 'Königlich', design: { look: 'gold', media: 'b:crown', layout: 'top', anim: 'glow', enter: 'fade', color: '' } },
  { id: 'hype', name: 'Hype-Rakete', design: { look: 'hype', media: 'b:rocket', layout: 'side', anim: 'rainbow', enter: 'slide', color: '' } },
  { id: 'glitch', name: 'Stromschlag', design: { look: 'glitch', media: 'b:bolt', layout: 'side', anim: 'shake', enter: 'zoom', color: '#35c7ff' } },
  { id: 'fire', name: 'Feuer', design: { look: 'banner', media: 'b:flame', layout: 'side', anim: 'rubber', enter: 'slide', color: '#ff5a2e' } },
  { id: 'diamond', name: 'Diamant', design: { look: 'glass', media: 'b:diamond', layout: 'top', anim: 'wave', enter: 'flip', color: '#35c7ff' } },
  { id: 'gift', name: 'Bescherung', design: { look: 'classic', media: 'b:gift', layout: 'top', anim: 'bounce', enter: 'drop', color: '#ff7ac8' } },
  { id: 'ice', name: 'Eiskalt', design: { look: 'minimal', media: 'b:snow', layout: 'bg', anim: 'type', enter: 'fade', color: '#7fd6ff' } },
  { id: 'champ', name: 'Champion', design: { look: 'banner', media: 'b:trophy', layout: 'side', anim: 'bounce', enter: 'spin', color: '#ffb81c' } },
  { id: 'clean', name: 'Schlicht', design: { look: 'minimal', media: 'none', layout: 'top', anim: 'none', enter: 'fade', color: '' } },
];

const HEX = /^#[0-9a-f]{6}$/i;
const MEDIA = /^(b:[a-z]{2,20}|u:[a-z0-9-]{1,64}\.(png|jpe?g|gif|webp|webm|mp4))$/;
const pick = (v, list, fallback) => (list.some((x) => x.id === v) ? v : fallback);
const clampNum = (v, min, max, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.min(max, Math.max(min, Math.round(Number(v)))) : fallback);
const tpl = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, 120) : '');

export const DEFAULT_DESIGN = Object.freeze({
  look: '', media: '', layout: 'top', label: '', title: '', text: '', anim: 'none', enter: '',
  duration: 7, msize: 100, color: '', sound: '', vsound: true, confetti: true,
});

// Alles aus der Datenbank wird hier geprüft – unbekannte Werte werden zum Standard
export function normalizeDesign(d) {
  const x = d && typeof d === 'object' ? d : {};
  return {
    look: x.look === '' || ALERT_LOOKS.some((l) => l.id === x.look) ? (x.look ?? '') : '',
    media: x.media === 'none' || MEDIA.test(x.media ?? '') ? x.media : '',
    layout: pick(x.layout, ALERT_LAYOUTS, 'top'),
    label: tpl(x.label), title: tpl(x.title), text: tpl(x.text),
    anim: pick(x.anim, TEXT_ANIMS, 'none'),
    enter: pick(x.enter ?? '', ENTER_ANIMS, ''),
    duration: clampNum(x.duration, 3, 30, 7),
    msize: clampNum(x.msize, 50, 200, 100),
    color: HEX.test(x.color ?? '') ? x.color.toLowerCase() : '',
    sound: typeof x.sound === 'string' ? x.sound.slice(0, 300) : '',
    vsound: x.vsound !== false,
    confetti: x.confetti !== false,
  };
}

export function normalizeAlertConfig(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const kinds = {};
  for (const { kind } of ALERT_KINDS) if (c.kinds?.[kind]) kinds[kind] = normalizeDesign(c.kinds[kind]);
  const vars = (Array.isArray(c.vars) ? c.vars : [])
    .filter((v) => v && VARIANT_KINDS[v.kind])
    .slice(0, 30)
    .map((v) => ({
      id: String(v.id ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 24) || Math.random().toString(36).slice(2, 10),
      kind: v.kind, min: clampNum(v.min, 1, 10000000, 100), design: normalizeDesign(v.design),
    }));
  return { v: 1, kinds, vars };
}

// Menge, nach der Varianten gewählt werden
export const alertMeasure = (a) => (a.kind === 'resub' ? a.months | 0 : a.amount | 0);

// Design für einen Alert: Variante mit der größten passenden Mindestmenge, sonst das der Art
export function resolveDesign(cfg, a) {
  const n = alertMeasure(a);
  const v = (cfg?.vars ?? []).filter((x) => x.kind === a.kind && n >= x.min).sort((x, y) => y.min - x.min)[0];
  return v ? v.design : cfg?.kinds?.[a.kind] ?? normalizeDesign(null);
}

export function alertVars(a) {
  const n = Math.max(0, a.amount | 0);
  return {
    name: a.user_name || 'Jemand',
    amount: n.toLocaleString('de-DE'),
    months: String(Math.max(0, a.months | 0)),
    tier: TIERS[a.tier] ?? 'Stufe 1',
    message: (a.message ?? '').trim(),
    reward: a.kind === 'redeem' ? (a.message ?? '').trim() : '',
  };
}

// Vorlage → Knoten (nie innerHTML: Namen und Nachrichten kommen von Zuschauern)
export function fillTemplate(el, template, vars) {
  el.replaceChildren();
  for (const part of template.split(/(\{[a-z]+\})/)) {
    if (!part) continue;
    const key = /^\{([a-z]+)\}$/.exec(part)?.[1];
    if (key && key in vars) {
      const em = document.createElement('em');
      em.className = 'ov-al-var';
      em.textContent = vars[key];
      el.append(em);
    } else el.append(part);
  }
}

// Buchstaben einzeln verpacken (Welle, Schreibmaschine) – Hervorhebungen bleiben
export function splitLetters(el) {
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('de', { granularity: 'grapheme' }) : null;
  let i = 0;
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) { walk(child); continue; }
      if (child.nodeType !== 3) continue;
      const frag = document.createDocumentFragment();
      const parts = seg ? [...seg.segment(child.textContent)].map((s) => s.segment) : Array.from(child.textContent);
      for (const ch of parts) {
        const s = document.createElement('span');
        s.className = 'ov-ch';
        s.style.setProperty('--i', i++);
        s.textContent = ch;
        frag.append(s);
      }
      child.replaceWith(frag);
    }
  };
  walk(el);
  return i;
}

// Die drei Zeilen: klein oben, groß (Name), darunter
export function alertLines(a, d) {
  const t = alertText(a);
  return { icon: t.icon, label: d.label || t.title, title: d.title || '{name}', text: d.text || t.sub };
}
