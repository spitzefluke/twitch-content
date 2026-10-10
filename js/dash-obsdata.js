// Statistik → „OBS & Daten“: wie viel Daten das Overlay in OBS verbraucht (je Tag und je Modul, gemessen von
// js/overlay-usage.js, Migration …_overlay_usage.sql) und – wenn das Dashboard mit OBS verbunden ist – was OBS
// gerade selbst meldet: CPU, Arbeitsspeicher, Bilder pro Sekunde, ausgelassene Bilder und der Stream-Upload.
// Eingebunden von js/dash-stats.js.
import { h } from './extras-core.js';
import { MODULES } from './overlay-modules.js';

// Farben: Dataviz-Palette (dunkel, auf #161027 geprüft). Immer mit Legende und Text im Tooltip – nie nur Farbe.
const KINDS = [
  { id: 'files', label: 'Dateien', hint: 'Seite, Bilder, Sounds, Schriften', color: '#3987e5' },
  { id: 'db', label: 'Datenbank', hint: 'Abfragen und Edge Functions', color: '#d95926' },
  { id: 'live', label: 'Live-Verbindung', hint: 'Realtime – Änderungen sofort im Overlay', color: '#199e70' },
  { id: 'chat', label: 'Twitch-Chat', hint: 'Chat-Verbindung und Emotes', color: '#c98500' },
  { id: 'other', label: 'Sonstiges', hint: 'andere Server', color: '#d55181' },
];

const fmtNum = (n, d = 0) => Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
export function fmtBytes(b) {
  const n = Number(b) || 0;
  if (n < 1000) return `${fmtNum(n)} B`;
  if (n < 1e6) return `${fmtNum(n / 1e3, n < 1e4 ? 1 : 0)} KB`;
  if (n < 1e9) return `${fmtNum(n / 1e6, n < 1e7 ? 1 : 0)} MB`;
  return `${fmtNum(n / 1e9, 2)} GB`;
}
const fmtDur = (sec) => {
  const m = Math.round((Number(sec) || 0) / 60);
  if (m < 60) return `${m} Min`;
  return `${Math.floor(m / 60)} Std${m % 60 ? ` ${m % 60} Min` : ''}`;
};
const fmtDay = (iso, long) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', long ? { weekday: 'short', day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit' });
const moduleLabel = (id) => {
  const m = MODULES.find((x) => x.id === id);
  if (m) return `${m.icon} ${m.name}`;
  if (id === 'all') return '🧩 Ganzes Overlay';
  if (id === 'custom') return '🛠️ Eigene Auswahl';
  return `🛠️ ${id}`;
};
const sumKinds = (o) => KINDS.reduce((a, k) => a + (Number(o?.[k.id]) || 0), 0);

const head = (ico, title, sub, extra) => h('div', { class: 'dash-card-head' },
  h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, ico),
  h('div', {}, h('h2', {}, title), sub ? h('p', { class: 'dash-status' }, sub) : null), extra ?? null);

// ---------- Datenverbrauch des Overlays ----------
export async function renderOverlayUsage(api, days) {
  let data;
  try {
    data = await api.overlayUsage(days);
  } catch (err) {
    return [h('article', { class: 'dash-card dash-card--wide' }, head('📡', 'Datenverbrauch des Overlays'),
      h('p', {}, /overlay_usage|could not find/i.test(err?.message ?? '')
        ? 'In der Datenbank fehlt die Messung: supabase/migrations/20261108000000_overlay_usage.sql im SQL Editor ausführen.'
        : `Nicht geladen: ${err?.message ?? err}`))];
  }
  const t = data.totals ?? {};
  const total = sumKinds(t);
  const seconds = Number(t.seconds) || 0;
  const perHour = seconds > 60 ? total / (seconds / 3600) : 0;
  const series = data.series ?? [];
  const modules = data.modules ?? [];
  const biggest = [...KINDS].sort((a, b) => (Number(t[b.id]) || 0) - (Number(t[a.id]) || 0))[0];

  const kpi = (ico, label, value, sub) => h('div', { class: 'stats-kpi' },
    h('span', { class: 'stats-kpi-ico', 'aria-hidden': 'true' }, ico), h('b', {}, value), h('small', {}, label), sub ? h('em', {}, sub) : null);
  const kpis = h('div', { class: 'stats-kpis' },
    kpi('📦', 'Verbraucht', fmtBytes(total), `in ${days} Tagen`),
    kpi('⏱️', 'Je Quelle und Stunde', perHour ? fmtBytes(perHour) : '–', 'Durchschnitt'),
    kpi('🖥️', 'Laufzeit der Quellen', fmtDur(seconds), modules.length > 1 ? `${modules.length} Quellen zusammen` : null),
    kpi('🔝', 'Größter Posten', total ? biggest.label : '–', total ? `${fmtNum((Number(t[biggest.id]) || 0) / total * 100)} %` : null));

  // Gestapelte Balken je Tag
  const max = Math.max(1, ...series.map(sumKinds));
  const bars = h('div', { class: 'stats-bars usage-bars' },
    ...series.map((d) => {
      const sum = sumKinds(d);
      const title = [`${fmtDay(d.day, true)}: ${fmtBytes(sum)}${d.seconds ? ` · ${fmtDur(d.seconds)} gelaufen` : ''}`,
        ...KINDS.filter((k) => Number(d[k.id]) > 0).map((k) => `${k.label}: ${fmtBytes(d[k.id])}`)].join('\n');
      return h('div', { class: 'stats-bar', title, role: 'img', 'aria-label': title.replaceAll('\n', ', ') },
        h('span', { class: 'usage-stack', style: { height: `${Math.round((sum / max) * 100)}%` } },
          ...KINDS.filter((k) => Number(d[k.id]) > 0).map((k) => h('i', { style: { flexGrow: String(Number(d[k.id])), background: k.color } }))),
        series.length <= 31 ? h('small', {}, fmtDay(d.day)) : null);
    }));
  const legend = h('ul', { class: 'usage-legend' },
    ...KINDS.map((k) => h('li', { title: k.hint },
      h('span', { class: 'usage-swatch', style: { background: k.color }, 'aria-hidden': 'true' }),
      h('span', {}, k.label), h('b', {}, fmtBytes(t[k.id])))));

  const table = modules.length
    ? h('table', { class: 'usage-table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Quelle'), h('th', { scope: 'col' }, 'Daten'), h('th', { scope: 'col' }, 'Laufzeit'),
        h('th', { scope: 'col' }, 'Je Stunde'), h('th', { scope: 'col' }, 'Zuletzt'))),
      h('tbody', {}, ...modules.map((m) => {
        const sec = Number(m.seconds) || 0;
        return h('tr', {},
          h('th', { scope: 'row' }, moduleLabel(m.module)),
          h('td', {}, fmtBytes(m.total)), h('td', {}, fmtDur(sec)),
          h('td', {}, sec > 60 ? fmtBytes(Number(m.total) / (sec / 3600)) : '–'),
          h('td', {}, m.last_at ? new Date(m.last_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–'));
      })))
    : null;

  return [
    h('article', { class: 'dash-card dash-card--wide usage-card' },
      head('📡', 'Datenverbrauch des Overlays', 'Was die Browserquellen in OBS laden – ohne deinen Stream-Upload'),
      kpis,
      total
        ? h('div', { class: 'usage-chart' }, bars, legend)
        : h('p', { class: 'stats-muted' }, 'Noch nichts gemessen. Das Overlay meldet seinen Verbrauch automatisch alle 5 Minuten, sobald es in OBS läuft (Live-Link, nicht die Vorschau).'),
      table ? h('h3', { class: 'usage-sub' }, 'Je Quelle') : null,
      table,
      h('p', { class: 'stats-muted' }, 'Ungefähre Werte: Bilder und Emotes von fremden Servern zählen oft nicht mit. Mehr Quellen (Module) laden mehr – jede hält ihre eigene Verbindung.')),
  ];
}

// ---------- OBS live ----------
let loop = 0; // jede neue Seite startet eine neue Schleife, die alte endet
export function renderObsLive({ obs, openObs, connect, savedPassword } = {}) {
  const gen = ++loop;
  const body = h('div', { class: 'obslive-body' });
  const card = h('article', { class: 'dash-card dash-card--wide obslive-card' },
    head('🎛️', 'OBS gerade', 'Live aus OBS – alle 2 Sekunden'), body);
  let last = null; // für die Bitrate: Bytes und Zeit der letzten Abfrage
  let shown = '';

  const row = (label, value, warn) => h('div', { class: `obslive-row${warn ? ' is-warn' : ''}` }, h('small', {}, label), h('b', {}, value));
  const pct = (a, b) => {
    if (!(b > 0) || !a) return '0 %';
    return a / b < 0.0001 ? '< 0,01 %' : `${fmtNum((a / b) * 100, a / b < 0.01 ? 2 : 1)} %`;
  };

  // Nicht verbunden: Passwort eingeben (oder das gespeicherte nutzen) und direkt hier verbinden
  const offline = (msg = '') => {
    if (shown === 'off' && !msg) return;
    shown = 'off';
    last = null;
    const form = h('form', { class: 'obslive-connect' },
      h('label', { class: 'field' }, h('span', {}, 'Passwort des OBS-WebSocket-Servers'),
        h('input', { type: 'password', name: 'password', autocomplete: 'off', placeholder: 'leer lassen, wenn keins gesetzt ist' })),
      h('button', { type: 'submit', class: 'btn btn--primary' }, 'Mit OBS verbinden'));
    const note = h('p', { class: 'stats-muted', role: 'status' }, msg);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      note.textContent = 'Verbinde …';
      try {
        await connect?.(form.password.value);
        note.textContent = '';
        shown = '';
      } catch (err) {
        note.textContent = err?.message ?? String(err);
      } finally {
        btn.disabled = false;
      }
    });
    const open = h('button', { type: 'button', class: 'btn btn--ghost' }, 'OBS-Fenster öffnen');
    open.addEventListener('click', () => openObs?.());
    body.replaceChildren(
      h('p', { class: 'stats-muted' }, 'Nicht mit OBS verbunden. Läuft OBS auf diesem PC, verbinde dich hier (OBS → Werkzeuge → WebSocket-Server-Einstellungen) – dann siehst du CPU, Bilder pro Sekunde und wie viel dein Stream gerade hochlädt.'),
      form, note, open);
  };
  // Gespeichertes Passwort: einmal leise versuchen
  const autoConnect = async () => {
    if (obs?.()?.connected || !savedPassword) return;
    const pw = await savedPassword();
    if (pw == null || gen !== loop) return;
    try { await connect?.(pw); } catch { /* dann eben von Hand */ }
  };

  let attached = false;
  const tick = async () => {
    if (gen !== loop) return; // Seite neu aufgebaut
    if (!card.isConnected) {
      if (attached) return; // Seite verlassen
      setTimeout(tick, 300); // noch nicht eingehängt
      return;
    }
    attached = true;
    if (!card.closest('[hidden]')) {
      const ws = obs?.();
      if (!ws?.connected) offline();
      else {
        try {
          const { obsStats } = await import('./obs-ws.js');
          const { stats: s, stream: st } = await obsStats(ws);
          if (gen !== loop) return;
          shown = 'on';
          const now = performance.now();
          let kbps = null;
          if (st?.outputActive && last && st.outputBytes >= last.bytes) kbps = ((st.outputBytes - last.bytes) * 8) / ((now - last.at) / 1000) / 1000;
          last = st?.outputActive ? { bytes: st.outputBytes, at: now } : null;

          const renderSkip = (s.renderSkippedFrames ?? 0) / Math.max(1, s.renderTotalFrames ?? 0);
          const encSkip = (s.outputSkippedFrames ?? 0) / Math.max(1, s.outputTotalFrames ?? 0);
          const system = h('div', { class: 'obslive-grid' },
            row('CPU (OBS)', `${fmtNum(s.cpuUsage, 1)} %`, s.cpuUsage > 80),
            row('Arbeitsspeicher', `${fmtNum(s.memoryUsage)} MB`),
            row('Bilder pro Sekunde', fmtNum(s.activeFps, 1)),
            row('Renderzeit je Bild', `${fmtNum(s.averageFrameRenderTime, 1)} ms`, s.averageFrameRenderTime > 16),
            row('Ausgelassen (Rendern)', `${fmtNum(s.renderSkippedFrames)} · ${pct(s.renderSkippedFrames ?? 0, s.renderTotalFrames ?? 0)}`, renderSkip > 0.01),
            row('Ausgelassen (Encoder)', `${fmtNum(s.outputSkippedFrames)} · ${pct(s.outputSkippedFrames ?? 0, s.outputTotalFrames ?? 0)}`, encSkip > 0.01),
            s.availableDiskSpace ? row('Freier Speicher', fmtBytes(s.availableDiskSpace * 1024 * 1024), s.availableDiskSpace < 5000) : null);

          let stream;
          if (!st) stream = h('p', { class: 'stats-muted' }, 'Stream-Status nicht abrufbar.');
          else if (!st.outputActive) stream = h('p', { class: 'stats-muted' }, 'Du streamst gerade nicht. Sobald der Stream läuft, steht hier, wie viel hochgeladen wird.');
          else {
            const dropped = (st.outputSkippedFrames ?? 0) / Math.max(1, st.outputTotalFrames ?? 0);
            stream = h('div', { class: 'obslive-grid' },
              row('Läuft seit', fmtDur((st.outputDuration ?? 0) / 1000)),
              row('Hochgeladen', fmtBytes(st.outputBytes)),
              row('Bitrate', kbps == null ? 'misst …' : `${fmtNum(kbps)} kbit/s`),
              row('Pro Stunde (bei dieser Bitrate)', kbps == null ? '–' : fmtBytes((kbps * 1000 / 8) * 3600)),
              row('Verlorene Bilder (Netz)', `${fmtNum(st.outputSkippedFrames)} · ${pct(st.outputSkippedFrames ?? 0, st.outputTotalFrames ?? 0)}`, dropped > 0.01),
              row('Netz-Auslastung', `${fmtNum((st.outputCongestion ?? 0) * 100)} %`, st.outputCongestion > 0.3),
              st.outputReconnecting ? row('Status', 'Verbindet neu …', true) : null);
          }
          body.replaceChildren(h('h3', { class: 'usage-sub' }, 'Rechner & OBS'), system, h('h3', { class: 'usage-sub' }, 'Stream'), stream);
        } catch (err) {
          if (gen !== loop) return;
          shown = 'err';
          body.replaceChildren(h('p', { class: 'stats-muted' }, `OBS antwortet nicht: ${err?.message ?? err}`));
        }
      }
    }
    if (gen === loop && card.isConnected) setTimeout(tick, 2000);
  };
  offline();
  autoConnect();
  setTimeout(tick, 0);
  return card;
}
