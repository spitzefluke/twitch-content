// Stream-Statistik (Dashboard → 📈 Statistik): Sendezeit, Zuschauer, Follows, Abos, Bits und
// was im Stream los war – je Tag als Balken. Daten: public.channel_stats (Migration …_dashboard.sql),
// nur für Streamer und freigegebene Mods. Darunter „OBS & Daten“ (js/dash-obsdata.js).
// Oben der laufende Stream und die letzten Streams (public.channel_sessions, …_bot_stats.sql): Die Zahlen
// zählen jede Minute mit (Chat, Panel, Overlay) und werden beim Stream-Ende festgehalten. Die Seite
// lädt bei jeder Zählung von selbst neu (Realtime auf watch_state).
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
let liveUnsub = null;
let liveTimer = 0;

const fmtWhen = (iso) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Laufender Stream: groß oben, mit allem, was seit Beginn passiert ist
function liveCard(live, lastTick) {
  const kpi = (ico, label, value) => h('div', { class: 'stats-kpi' }, h('span', { class: 'stats-kpi-ico', 'aria-hidden': 'true' }, ico), h('b', {}, value), h('small', {}, label));
  return h('article', { class: 'dash-card dash-card--wide stats-card stats-live' },
    h('div', { class: 'dash-card-head' },
      h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, '🔴'),
      h('div', {}, h('h2', {}, `Live seit ${fmtMin(live.minutes ?? 0)}`),
        h('p', { class: 'dash-status' }, `${live.game ? `${live.game} · ` : ''}gestartet ${fmtWhen(live.started_at)}${lastTick ? ` · zuletzt gezählt ${new Date(lastTick).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : ''}`))),
    h('div', { class: 'stats-kpis' },
      kpi('👀', 'Zuschauer jetzt', fmtNum(live.viewers)),
      kpi('📈', 'Spitze', fmtNum(live.peak_viewers)),
      kpi('➗', 'Durchschnitt', fmtNum(live.avg_viewers)),
      kpi('💜', 'Follows', fmtNum(live.follows)),
      kpi('⭐', 'Abos', fmtNum(live.subs)),
      kpi('💎', 'Bits', fmtNum(live.bits)),
      kpi('💬', 'Im Chat aktiv', fmtNum(live.chatters)),
      kpi('🎟️', 'Kanalpunkte', fmtNum(live.redeems))));
}

// Die letzten Streams: je Stream eine Zeile, festgehalten beim Ende
function sessionsCard(sessions) {
  const rows = sessions.map((s) => h('tr', {},
    h('td', {}, h('b', {}, fmtWhen(s.started_at)), s.game ? h('small', {}, s.game) : null),
    h('td', {}, fmtMin(s.minutes ?? 0)),
    h('td', {}, `${fmtNum(s.peak_viewers)} / Ø ${fmtNum(s.avg_viewers)}`),
    h('td', {}, fmtNum(s.follows)), h('td', {}, fmtNum(s.subs)), h('td', {}, fmtNum(s.bits)), h('td', {}, fmtNum(s.chatters))));
  return h('article', { class: 'dash-card dash-card--wide' },
    h('div', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, '🗓️'),
      h('div', {}, h('h2', {}, 'Letzte Streams'), h('p', { class: 'dash-status' }, 'Festgehalten, sobald ein Stream endet'))),
    sessions.length
      ? h('div', { class: 'stats-table-wrap' }, h('table', { class: 'stats-table' },
        h('thead', {}, h('tr', {}, ...['Stream', 'Dauer', 'Zuschauer (Spitze / Ø)', 'Follows', 'Abos', 'Bits', 'Chatter'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, ...rows)))
      : h('p', { class: 'stats-muted' }, 'Noch kein Stream abgeschlossen. Ab jetzt wird jeder Stream mit Dauer, Zuschauern, Follows, Abos, Bits und Chattern festgehalten.'));
}

// Live: bei jeder Zählung neu zeichnen, solange die Seite offen ist
function followLive(root, api, opts) {
  if (liveUnsub || !api.onWatchState) return;
  liveUnsub = api.onWatchState(() => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      const page = root.closest('section.page');
      if (root.isConnected && !(page && page.hidden)) renderStats(root, api, { ...opts, quiet: true });
    }, 2000);
  });
}

export async function renderStats(root, api, opts = {}) {
  if (!root) return;
  const gen = ++renderGen;
  if (!opts.quiet) root.replaceChildren(h('p', { class: 'stats-muted' }, 'Lädt …'));
  followLive(root, api, opts);
  let data;
  // Laufender und letzte Streams: fehlt die Migration, bleibt der Teil einfach weg
  const sessionsP = api.channelSessions ? api.channelSessions(10).catch(() => null) : Promise.resolve(null);
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
  const sessions = await sessionsP;
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
    : h('p', { class: 'stats-muted' }, 'Noch keine Watchtime gezählt – das passiert automatisch, sobald du live bist (Chat, Twitch-Panel oder OBS-Overlay).');

  root.replaceChildren(
    ...(sessions?.live ? [liveCard(sessions.live, sessions.last_tick_at)] : []),
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
    ...(sessions ? [sessionsCard(sessions.sessions ?? [])] : []),
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
