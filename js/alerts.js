// Alerts im OBS-Overlay: neue Follower, Abos, Resubs und verschenkte Abos.
// Die Zeilen kommen aus stream_alerts (twitch-eventsub schreibt sie, alert_test für Proben).
import { BOARD } from './prank-fx.js';

// Die Alert-Arten mit dem Namen ihres Sound-Parameters (overlay.html?sfollow=gong …)
export const ALERT_KINDS = [
  { kind: 'follow', param: 'sfollow', label: '💜 Follower' },
  { kind: 'sub', param: 'ssub', label: '⭐ Abo' },
  { kind: 'resub', param: 'sresub', label: '🚂 Resub' },
  { kind: 'gift', param: 'sgift', label: '🎁 Verschenkte Abos' },
];

const TIERS = { 2000: 'Stufe 2', 3000: 'Stufe 3' };

// Was die Karte bei einem Alert zeigt
export function alertText(a) {
  const tier = TIERS[a.tier] ? ` · ${TIERS[a.tier]}` : '';
  switch (a.kind) {
    case 'follow':
      return { icon: '💜', title: 'Neuer Follower', sub: 'Willkommen an Bord!' };
    case 'sub':
      return { icon: '⭐', title: `Neues Abo${tier}`, sub: 'Danke fürs Abonnieren!' };
    case 'resub':
      return {
        icon: '🚂',
        title: a.months > 1 ? `${a.months} Monate Abo${tier}` : `Abo verlängert${tier}`,
        sub: a.message?.trim() || 'Danke für die Treue!',
      };
    case 'gift': {
      const n = Math.max(1, a.amount | 0);
      return { icon: '🎁', title: n === 1 ? `Abo verschenkt${tier}` : `${n} Abos verschenkt${tier}`, sub: 'Danke für die Geschenke!' };
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
// Soundboard (z. B. "gong") oder ein hochgeladener Sound als "c:<pfad>".
export function playAlertSound(sfx, kind, choice = 'default', urlFor = null) {
  if (choice === 'none') return;
  if (choice.startsWith('c:')) {
    const url = urlFor?.(choice.slice(2));
    if (url) { sfx.playUrl(url); return; }
  } else if (BOARD.some((b) => b.id === choice)) {
    sfx.play(choice);
    return;
  }
  alertSound(sfx, kind);
}

// Probe-Alerts zum Einrichten (test=1)
const NAMES = ['Lokfuehrer_Lena', 'SchienenSeb', 'TTV_Weichensteller', 'Bahnhofskater', 'ICE_Irina', 'Gleis9dreiviertel'];
export function sampleAlert(kind, n = 0) {
  return {
    id: `test-${Date.now()}-${n}`, created_at: new Date().toISOString(), kind, test: true, tier: '1000',
    user_name: NAMES[n % NAMES.length],
    months: kind === 'resub' ? 7 : 0,
    amount: kind === 'gift' ? 5 : 0,
    message: kind === 'resub' ? 'Weiter so, Dave!' : '',
  };
}
