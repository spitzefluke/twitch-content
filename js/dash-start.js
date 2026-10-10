// Ruhiger Einstieg: Checkliste für Streamer oben auf der Dashboard-Startseite.
// Fünf Schritte; was die Seite selbst erkennen kann, hakt sie von allein ab (Twitch verbunden,
// Mods freigegeben, 2FA an). OBS und „erste Idee“ merkt sich dieser Browser.
// Ausblenden geht jederzeit – danach steht die Liste unter „❓ Einführung“ nicht mehr im Weg.
import { h } from './extras-core.js';

const key = (ctx, what) => `sh_start_${what}_${ctx.userId() ?? ''}_${ctx.channelId() ?? 'default'}`;
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* privater Modus */ } };

// Von außen: „OBS geöffnet“ bzw. „eine Idee ausprobiert“ merken
export function markStart(ctx, what) {
  if (get(key(ctx, what))) return;
  put(key(ctx, what), '1');
  renderStart(ctx);
}

let mfaOn = null;

export async function renderStart(ctx) {
  const slot = document.getElementById('start-slot');
  if (!slot) return;
  if (!ctx.isStreamer() || get(key(ctx, 'hidden'))) { slot.replaceChildren(); slot.hidden = true; return; }
  if (mfaOn === null) {
    mfaOn = false;
    ctx.mfaStatus().then((st) => { mfaOn = !!st?.factors?.length; renderStart(ctx); }).catch(() => {});
  }
  const steps = [
    { id: 'twitch', ico: '🟣', title: 'Twitch verbinden', text: 'Damit Kanalpunkte, Chat-Bot und Alerts laufen.', done: ctx.twitchConnected(), go: () => ctx.setPage('twitch'), cta: 'Verbinden' },
    { id: 'obs', ico: '🎛️', title: 'Overlay in OBS einfügen', text: 'Eine Browserquelle für alles – Adresse kopieren, fertig.', done: !!get(key(ctx, 'obs')), go: () => { markStart(ctx, 'obs'); ctx.openObs(); }, cta: 'OBS öffnen' },
    { id: 'idea', ico: '🎬', title: 'Erste Content-Idee ausprobieren', text: 'Zum Beispiel das Glücksrad drehen – Zuschauer sehen es sofort im Overlay.', done: !!get(key(ctx, 'idea')), go: () => document.getElementById('grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), cta: 'Zu den Ideen' },
    { id: 'mods', ico: '👥', title: 'Mods freigeben', text: 'Optional: Deine Mods steuern mit – du sperrst sie mit einem Klick wieder.', done: !!ctx.modsEnabled(), go: () => ctx.setPage('mods'), cta: 'Mods' },
    { id: 'mfa', ico: '🔐', title: 'Zwei-Faktor-Anmeldung einschalten', text: 'Schützt deinen Kanal, falls dein Passwort mal in falsche Hände gerät.', done: !!mfaOn, go: () => ctx.setPage('security'), cta: 'Einschalten' },
  ];
  const done = steps.filter((s) => s.done).length;
  const all = done === steps.length;
  const hide = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, all ? 'Schließen' : 'Ausblenden');
  hide.addEventListener('click', () => { put(key(ctx, 'hidden'), '1'); renderStart(ctx); });
  slot.hidden = false;
  slot.replaceChildren(h('article', { class: `start-card${all ? ' is-done' : ''}`, 'aria-labelledby': 'start-title' },
    h('div', { class: 'start-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, all ? 'Alles eingerichtet 🎉' : 'Dein Start'),
        h('h2', { id: 'start-title' }, all ? 'Bereit für den nächsten Stream' : 'In fünf Schritten startklar'),
      ),
      h('div', { class: 'start-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(steps.length), 'aria-valuenow': String(done), 'aria-label': 'Fortschritt' },
        h('span', { class: 'start-progress-text' }, `${done} von ${steps.length}`),
        h('span', { class: 'start-progress-bar' }, h('i', { style: { width: `${(done / steps.length) * 100}%` } })),
      ),
      hide,
    ),
    h('ol', { class: 'start-steps' }, ...steps.map((s) => {
      const btn = h('button', { type: 'button', class: `btn btn--sm ${s.done ? 'btn--ghost' : 'btn--primary'}` }, s.done ? 'Ansehen' : s.cta);
      btn.addEventListener('click', s.go);
      return h('li', { class: `start-step${s.done ? ' is-done' : ''}`, 'data-step': s.id },
        h('span', { class: 'start-check', 'aria-hidden': 'true' }, s.done ? '✓' : s.ico),
        h('div', {}, h('b', {}, s.title), h('small', {}, s.done ? 'Erledigt' : s.text)),
        btn,
      );
    })),
  ));
}

// „❓ Einführung“ in der Leiste blendet die Liste wieder ein
export function showStartAgain(ctx) {
  try { localStorage.removeItem(key(ctx, 'hidden')); } catch { /* egal */ }
  renderStart(ctx);
}
