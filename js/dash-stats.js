// Stream-Statistik (Dashboard → 📈 Statistik): Sendezeit, Zuschauer, Follows, Abos, Bits und
// was im Stream los war – je Tag als Balken. Daten: public.channel_stats (Migration …_dashboard.sql),
// nur für Streamer und freigegebene Mods. Darunter „OBS & Daten“ (js/dash-obsdata.js).
// opts: { obs: () => ObsSocket|null, openObs: () => void } aus js/app.js
import { h } from './extras-core.js';
import { renderObsLive, renderOverlayUsage } from './dash-obsdata.js';

let range = 7;

const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} Std ${m % 60 ? `${m % 60} Min` : ''}`.trim() : `${m} Min`);
const fmtNum = (n) => Number(n || 0).toLocaleString('de-DE');
const fmtDay = (iso, long) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', long ? { weekday: 'short', day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit' });

const METRICS = [
  { id: 'live_minutes', label: 'Sendezeit', fmt: fmtMin },
  { id: 'peak_viewers', label: 'Zuschauer (Spitze)', fmt: fmtNum },
  { id: 'follows', label: 'Follows', fmt: fmtNum },
  { id: 'subs', label: 'Abos', fmt: fmtNum },
];
let metric = 'live_minutes';
let renderGen = 0; // schnelles Umschalten: nur die neueste Abfrage zeichnet

export async function renderStats(root, api, opts = {}) {
  if (!root) return;
  const gen = ++renderGen;
  root.replaceChildren(h('p', { class: 'stats-muted' }, 'Lädt …'));
  let data;
  try {
    data = await api.channelStats(range);
  } catch (err) {
    if (gen !== renderGen) return;
    root.replaceChildren(h('article', { class: 'dash-card dash-card--wide' },
      h('p', {}, /channel_stats|could not find/i.test(err?.message ?? '')
        ? 'In der Datenbank fehlt die Statistik: supabase/migrations/20261102000000_dashboard.sql im SQL Editor ausführen.'
        : `Statistik nicht geladen: ${err?.message ?? err}`)));
    return;
  }
  if (gen !== renderGen) return;
  const t = data.totals ?? {};
  const series = data.series ?? [];

  const rangeBtns = h('div', { class: 'stats-range', role: 'group', 'aria-label': 'Zeitraum' },
    ...[7, 30, 90].map((d) => {
      const b = h('button', { type: 'button', class: `stats-chip${d === range ? ' is-on' : ''}`, 'aria-pressed': String(d === range) }, `${d} Tage`);
      b.addEventListener('click', () => { range = d; renderStats(root, api, opts); });
      return b;
    }));

  const kpi = (ico, label, value, sub) => h('div', { class: 'stats-kpi' },
    h('span', { class: 'stats-kpi-ico', 'aria-hidden': 'true' }, ico),
    h('b', {}, value), h('small', {}, label), sub ? h('em', {}, sub) : null);

  const kpis = h('div', { class: 'stats-kpis' },
    kpi('⏱️', 'Sendezeit', fmtMin(t.live_minutes ?? 0)),
    kpi('👀', 'Zuschauer', fmtNum(t.peak_viewers), t.avg_viewers ? `Ø ${fmtNum(t.avg_viewers)}` : 'Spitze'),
    kpi('💜', 'Follows', fmtNum(t.follows)),
    kpi('⭐', 'Abos', fmtNum(t.subs)),
    kpi('💎', 'Bits', fmtNum(t.bits)),
    kpi('💬', 'Aktive im Chat', fmtNum(data.chatters)),
    kpi('🎡', 'Glücksrad', fmtNum(t.spins)),
    kpi('🍅', 'Streiche', fmtNum(t.pranks)),
    kpi('🎟️', 'Kanalpunkte', fmtNum(t.redeems)),
  );

  // Balken je Tag für die gewählte Kennzahl
  const m = METRICS.find((x) => x.id === metric) ?? METRICS[0];
  const max = Math.max(1, ...series.map((d) => Number(d[m.id]) || 0));
  const tabs = h('div', { class: 'stats-tabs', role: 'tablist', 'aria-label': 'Kennzahl' },
    ...METRICS.map((x) => {
      const b = h('button', { type: 'button', role: 'tab', class: 'stats-chip', 'aria-selected': String(x.id === m.id) }, x.label);
      b.addEventListener('click', () => { metric = x.id; renderStats(root, api, opts); });
      return b;
    }));
  const bars = h('div', { class: 'stats-bars' },
    ...series.map((d) => {
      const v = Number(d[m.id]) || 0;
      return h('div', { class: 'stats-bar', title: `${fmtDay(d.day, true)}: ${m.fmt(v)}` },
        h('span', { class: 'stats-bar-fill', style: { height: `${Math.round((v / max) * 100)}%` } }),
        series.length <= 31 ? h('small', {}, fmtDay(d.day)) : null);
    }));
  const empty = !series.some((d) => Number(d[m.id]) > 0);

  const top = (data.top_viewers ?? []).length
    ? h('ol', { class: 'stats-top' }, ...data.top_viewers.map((v) => h('li', {}, h('b', {}, v.name), h('span', {}, fmtMin(Math.round(v.seconds / 60))))))
    : h('p', { class: 'stats-muted' }, 'Noch keine Watchtime gezählt – das passiert automatisch, sobald du live bist und das Overlay in OBS läuft.');

  root.replaceChildren(
    h('article', { class: 'dash-card dash-card--wide stats-card' },
      h('div', { class: 'dash-card-head' },
        h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, '📈'),
        h('div', {}, h('h2', {}, 'Dein Stream in Zahlen'), h('p', { class: 'dash-status' }, `Die letzten ${range} Tage`)),
        rangeBtns),
      kpis),
    h('article', { class: 'dash-card dash-card--wide' },
      h('div', { class: 'stats-chart-head' }, h('h2', {}, 'Je Tag'), tabs),
      bars,
      empty ? h('p', { class: 'stats-muted' }, 'In diesem Zeitraum noch keine Werte. Sendezeit und Zuschauer zählen ab jetzt mit, sobald du live bist.') : null),
    h('article', { class: 'dash-card' },
      h('div', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, '🏆'), h('div', {}, h('h2', {}, 'Treueste Zuschauer'), h('p', { class: 'dash-status' }, 'Watchtime insgesamt'))),
      top),
  );
  // OBS & Daten: eigener Abschnitt, lädt danach (die Zahlen oben sollen nicht darauf warten)
  const usage = await renderOverlayUsage(api, range);
  if (gen !== renderGen || !root.isConnected) return;
  root.append(
    h('h2', { class: 'stats-section', id: 'stats-obsdata' }, '🎛️ OBS & Daten'),
    renderObsLive(opts),
    ...usage,
  );
}
