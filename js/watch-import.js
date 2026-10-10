// Alte Watchtime aus einem anderen Bot einlesen (Dashboard → Bot & Chat → Watchtime).
// Twitch selbst gibt keine alte Zuschauzeit heraus – wer vorher StreamElements, Streamlabs & Co.
// genutzt hat, kann deren Export (CSV) hier hochladen. Erkannt werden:
//   · Spalte für den Namen: user, username, name, login, display name, viewer, nutzer …
//   · Spalte für die Zeit: minutes/minuten, hours/stunden, seconds/sekunden, watchtime/zeit
//     Zahlen bekommen die Einheit aus der Überschrift (bei „watchtime“ ohne Einheit: Minuten wie bei
//     StreamElements), Texte wie „12h 30m“, „3 Std 5 Min“, „1d 2h“ oder „1:23:45“ werden umgerechnet.
// Ergebnis: { rows: [{ login, name, seconds }], skipped, source }

const NAME_COL = /^(user ?name|user|name|login|display ?name|viewer|nutzer(name)?|zuschauer|benutzer(name)?|twitch ?name)$/i;
const TIME_COL = /(watch ?time|minute|minuten|mins?\b|hours?|stunden|hrs?\b|seconds?|sekunden|secs?\b|zeit|time)/i;
const MAX_SECONDS = 3153600000; // 100 Jahre – alles darüber ist ein Lesefehler

function splitLine(line, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function unitOf(header) {
  const h = header.toLowerCase();
  if (/sec|sek/.test(h)) return 1;
  if (/hour|stund|hrs?\b/.test(h)) return 3600;
  if (/day|tag/.test(h)) return 86400;
  return 60; // minutes / watchtime ohne Einheit
}

// „12h 30m“, „3 Std 5 Min“, „1d 2h“, „1:23:45“, „90“ (mit Einheit der Spalte)
export function parseDuration(value, unit = 60) {
  const v = String(value ?? '').trim().toLowerCase().replace(',', '.');
  if (!v) return 0;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * unit);
  const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(v);
  if (clock) {
    const [, a, b, c] = clock;
    return c === undefined ? Number(a) * 3600 + Number(b) * 60 : Number(a) * 3600 + Number(b) * 60 + Number(c);
  }
  const parts = [...v.matchAll(/(\d+(?:\.\d+)?)\s*(d|t|tag|tage|day|days|h|std|stunde|stunden|hour|hours|hrs?|m|min|mins|minute|minuten|minutes|s|sek|sec|secs|sekunden|seconds)\b/g)];
  if (!parts.length) return 0;
  let total = 0;
  for (const [, n, u] of parts) {
    const mult = /^(d|t|tag|tage|day|days)$/.test(u) ? 86400 : /^(h|std|stunde|stunden|hour|hours|hrs?)$/.test(u) ? 3600 : /^(s|sek|sec|secs|sekunden|seconds)$/.test(u) ? 1 : 60;
    total += Number(n) * mult;
  }
  return Math.round(total);
}

export function parseWatchCsv(text, fileName = '') {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('Die Datei ist leer oder hat keine Kopfzeile.');
  const head = lines[0];
  const sep = [';', '\t', ','].sort((a, b) => head.split(b).length - head.split(a).length)[0];
  const cols = splitLine(head, sep);
  const nameIdx = cols.findIndex((c) => NAME_COL.test(c.trim()));
  // Zeit-Spalte: bevorzugt eine mit „watch“ im Namen, sonst die erste passende (nicht „points“)
  let timeIdx = cols.findIndex((c) => /watch/i.test(c));
  if (timeIdx < 0) timeIdx = cols.findIndex((c, i) => i !== nameIdx && TIME_COL.test(c) && !/point|punkt/i.test(c));
  if (nameIdx < 0 || timeIdx < 0) {
    throw new Error(`Spalten nicht erkannt (gefunden: ${cols.join(', ')}). Gebraucht werden eine Namens-Spalte (z. B. „username“) und eine Zeit-Spalte (z. B. „minutes“ oder „hours“).`);
  }
  const unit = unitOf(cols[timeIdx]);
  const byLogin = new Map();
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, sep);
    const name = (cells[nameIdx] ?? '').replace(/^@/, '').trim();
    const login = name.toLowerCase();
    const seconds = parseDuration(cells[timeIdx], unit);
    if (!/^[a-z0-9_]{1,25}$/.test(login) || !(seconds > 0) || seconds > MAX_SECONDS) { skipped++; continue; }
    const prev = byLogin.get(login);
    byLogin.set(login, { login, name: prev?.name || name, seconds: (prev?.seconds ?? 0) + seconds });
  }
  const source = /streamelements|se[_-]/i.test(fileName) ? 'StreamElements'
    : /streamlabs|cloudbot/i.test(fileName) ? 'Streamlabs'
      : /nightbot/i.test(fileName) ? 'Nightbot'
        : /wizebot/i.test(fileName) ? 'WizeBot' : 'CSV-Import';
  return { rows: [...byLogin.values()].sort((a, b) => b.seconds - a.seconds), skipped, source, unit };
}
