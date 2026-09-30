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
