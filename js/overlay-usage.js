// Datenverbrauch des OBS-Overlays messen (Migration …_overlay_usage.sql). Jede Browserquelle zählt, was sie
// über das Netz lädt, und meldet alle 5 Minuten die neuen Bytes an overlay_usage_add – die Statistik im
// Dashboard zeigt es je Tag und je Modul.
//   files  Seite, Skripte, Stile, Bilder, Sounds, Schriften (Resource Timing)
//   db     Datenbank-Abfragen und Edge Functions (fetch an Supabase)
//   live   Realtime-Verbindung zu Supabase (WebSocket, beide Richtungen)
//   chat   Twitch-Chat (WebSocket)
//   other  alles andere
// Genau ist das nicht: Fremde Server ohne „Timing-Allow-Origin“ (z. B. Twitch-Emotes) melden 0 Bytes, für
// Antworten ohne Content-Length wird die Länge gezählt. Für einen Eindruck „wie viel ist es ungefähr“ reicht es.
const REPORT_MS = 5 * 60_000;
const totals = { files: 0, db: 0, live: 0, chat: 0, other: 0 };
let supabaseHost = '';

const byteLength = (data) => {
  if (data == null) return 0;
  if (typeof data === 'string') return new TextEncoder().encode(data).length;
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
};
const hostOf = (url) => { try { return new URL(url, location.href).host; } catch { return ''; } };
const kindOfSocket = (url) => {
  const host = hostOf(url);
  if (supabaseHost && host === supabaseHost) return 'live';
  if (/twitch\.tv$/i.test(host)) return 'chat';
  return 'other';
};

// Muss vor dem ersten fetch/WebSocket laufen – js/overlay.js ruft es gleich beim Start auf.
let started = false;
export function startUsageMeter(supabaseUrl) {
  if (started) return;
  started = true;
  supabaseHost = hostOf(supabaseUrl || '');

  // fetch: Supabase-Abfragen (Anfrage + Antwort). Andere fetches zählt Resource Timing.
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    const res = await origFetch(input, init);
    if (supabaseHost && hostOf(url) === supabaseHost) {
      totals.db += byteLength(init?.body) + 400; // + Kopfzeilen (grob)
      const len = Number(res.headers.get('content-length'));
      if (Number.isFinite(len) && len > 0) totals.db += len;
      else res.clone().arrayBuffer().then((b) => { totals.db += b.byteLength; }, () => {});
    }
    return res;
  };

  // WebSocket: Realtime (Supabase) und Twitch-Chat, beide Richtungen
  const Orig = window.WebSocket;
  if (Orig) {
    window.WebSocket = class extends Orig {
      constructor(url, protocols) {
        super(url, protocols);
        const kind = kindOfSocket(url);
        this.addEventListener('message', (e) => { totals[kind] += byteLength(e.data); });
        this._usageKind = kind;
      }
      send(data) {
        totals[this._usageKind ?? 'other'] += byteLength(data);
        super.send(data);
      }
    };
  }

  // Alles, was der Browser selbst lädt (Seite, Bilder, Sounds …). fetch an Supabase zählt oben.
  try {
    performance.setResourceTimingBufferSize?.(1000);
    const seen = (entry) => {
      if ((entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest') && supabaseHost && hostOf(entry.name) === supabaseHost) return;
      const bytes = entry.transferSize || 0;
      if (!bytes) return; // aus dem Cache oder fremder Server ohne Zahlen
      const host = hostOf(entry.name);
      if (host === location.host) totals.files += bytes;
      else if (supabaseHost && host === supabaseHost) totals.files += bytes; // Bilder/Sounds aus dem Storage
      else if (/twitch|jtvnw/i.test(host)) totals.chat += bytes;
      else totals.other += bytes;
    };
    performance.getEntriesByType('navigation').forEach((e) => { totals.files += e.transferSize || 0; });
    new PerformanceObserver((list) => {
      list.getEntries().forEach(seen);
      if (performance.getEntriesByType('resource').length > 800) performance.clearResourceTimings();
    }).observe({ type: 'resource', buffered: true });
  } catch { /* alter Browser: dann eben ohne Dateien */ }
}

// Regelmäßig melden. send(delta) liefert true, wenn die Datenbank die Meldung angenommen hat.
export function reportUsage(send) {
  const sent = { files: 0, db: 0, live: 0, chat: 0, other: 0 };
  let since = Date.now();
  const flush = async (keepalive = false) => {
    const delta = {};
    for (const k of Object.keys(totals)) delta[k] = Math.round(totals[k] - sent[k]);
    const seconds = Math.round((Date.now() - since) / 1000);
    if (seconds < 30) return;
    const ok = await send({ ...delta, seconds }, keepalive).catch(() => false);
    if (ok) {
      for (const k of Object.keys(totals)) sent[k] += delta[k];
      since = Date.now();
    }
  };
  setTimeout(() => flush(), 60_000); // erste Meldung nach einer Minute (Seite ist geladen)
  setInterval(() => flush(), REPORT_MS);
  addEventListener('pagehide', () => flush(true));
}

export const usageTotals = () => ({ ...totals });
