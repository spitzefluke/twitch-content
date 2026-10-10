// Versionsnummern für JS und CSS – damit Browser nach einem Update nie alte und
// neue Dateien mischen (GitHub Pages lässt Dateien 10 Minuten im Cache).
//
// Jede Datei bekommt ?v=<Hash ihres Inhalts>. Für die JS-Module steht das in einer
// Import-Map in index.html, overlay.html, admin.html und record.html (zwischen den Markierungen
// <!-- versions:start --> und <!-- versions:end -->), für CSS direkt am <link>.
// Ändert sich eine Datei, ändert sich ihre Adresse – der Browser lädt sie neu.
//
//   node tools/stamp-versions.mjs          Nummern aktualisieren (vor jedem Commit)
//   node tools/stamp-versions.mjs --check  nur prüfen (für GitHub Actions)
//
// Dazu schreibt es die Content-Security-Policy jeder Seite (<meta http-equiv=…>): Skripte nur
// von der eigenen Seite plus die beiden Inline-Skripte oben (per SHA-256-Hash freigegeben).
// GitHub Pages kann keine eigenen HTTP-Header setzen – deshalb als Meta-Tag.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = { 'index.html': 'app.js', 'overlay.html': 'overlay.js', 'admin.html': 'admin.js', 'record.html': 'record.js' };
const check = process.argv.includes('--check');

// Bot-Schutz bei Anmelden/Registrieren (Cloudflare Turnstile, nur wenn in js/config.js eingerichtet):
// Skript und Prüf-Fenster kommen von dort – nur auf der Startseite mit den Anmeldeformularen.
const CAPTCHA = 'https://challenges.cloudflare.com';
const CAPTCHA_PAGES = ['index.html'];

// Wohin die Seiten Verbindungen aufbauen dürfen (Supabase, Wetter, Twitch-Chat, OBS auf dem eigenen PC)
const CSP = (scriptHashes, page) => [
  "default-src 'self'",
  `script-src 'self' ${scriptHashes.map((h) => `'sha256-${h}'`).join(' ')}${CAPTCHA_PAGES.includes(page) ? ` ${CAPTCHA}` : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co wss://irc-ws.chat.twitch.tv ws://127.0.0.1:* ws://localhost:*",
  `frame-src 'self'${CAPTCHA_PAGES.includes(page) ? ` ${CAPTCHA}` : ''}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const sha = (text) => createHash('sha256').update(text).digest('base64');

const hash = (path) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex').slice(0, 10);

const imports = Object.fromEntries(readdirSync(join(root, 'js'))
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => [`./js/${f}`, `./js/${f}?v=${hash(`js/${f}`)}`]));

let stale = [];
for (const [page, entry] of Object.entries(PAGES)) {
  const file = join(root, page);
  const before = readFileSync(file, 'utf8');
  const importmap = JSON.stringify({ imports }, null, 2).replace(/\n/g, '\n  ');
  const loader = `import './js/${entry}';`;
  const block = [
    '<!-- versions:start (node tools/stamp-versions.mjs) -->',
    `  <script type="importmap">${importmap}</script>`,
    `  <script type="module">${loader}</script>`,
    '  <!-- versions:end -->',
  ].join('\n');
  let after = before.replace(/<!-- versions:start[\s\S]*?<!-- versions:end -->/, block);
  // Content-Security-Policy direkt nach <meta charset> (muss vor allen Skripten stehen)
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP([sha(importmap), sha(loader)], page)}">`;
  after = after.includes('http-equiv="Content-Security-Policy"')
    ? after.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, meta)
    : after.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  ${meta}\n  <meta name="referrer" content="same-origin">`);
  if (after === before && !before.includes('<!-- versions:start')) {
    throw new Error(`${page}: Markierung <!-- versions:start --> … <!-- versions:end --> fehlt`);
  }
  // CSS: ?v=<Hash> an jedem lokalen Stylesheet
  after = after.replace(/href="(css\/[\w.-]+\.css)(\?v=[0-9a-f]+)?"/g, (_, path) => `href="${path}?v=${hash(path)}"`);
  if (after !== before) {
    stale.push(page);
    if (!check) writeFileSync(file, after);
  }
}

// Statische Seiten ohne Module (404.html, datenschutz.html): eigene, enge Content-Security-Policy mit dem Hash des Inline-Skripts
const STATIC_CSP = (scriptHashes) => [
  "default-src 'none'",
  `script-src ${scriptHashes.length ? scriptHashes.map((h) => `'sha256-${h}'`).join(' ') : "'none'"}`,
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
for (const page of ['404.html', 'datenschutz.html']) {
  const file = join(root, page);
  const before = readFileSync(file, 'utf8');
  // Inline-Skripte (ohne src); Schlusstag auch mit Leerzeichen/Großbuchstaben, z. B. </SCRIPT >
  const scripts = [...before.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)]
    .filter((m) => !/\bsrc\s*=/i.test(m[1]))
    .map((m) => sha(m[2]));
  const after = before.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/,
    `<meta http-equiv="Content-Security-Policy" content="${STATIC_CSP(scripts)}">`);
  if (after !== before) {
    stale.push(page);
    if (!check) writeFileSync(file, after);
  }
}

if (check && stale.length) {
  console.error(`Versionsnummern veraltet in: ${stale.join(', ')} – bitte "node tools/stamp-versions.mjs" ausführen und committen.`);
  process.exit(1);
}
console.log(stale.length ? `Aktualisiert: ${stale.join(', ')}` : 'Versionsnummern sind aktuell.');
