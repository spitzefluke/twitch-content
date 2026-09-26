// Versionsnummern für JS und CSS – damit Browser nach einem Update nie alte und
// neue Dateien mischen (GitHub Pages lässt Dateien 10 Minuten im Cache).
//
// Jede Datei bekommt ?v=<Hash ihres Inhalts>. Für die JS-Module steht das in einer
// Import-Map in index.html, overlay.html und admin.html (zwischen den Markierungen
// <!-- versions:start --> und <!-- versions:end -->), für CSS direkt am <link>.
// Ändert sich eine Datei, ändert sich ihre Adresse – der Browser lädt sie neu.
//
//   node tools/stamp-versions.mjs          Nummern aktualisieren (vor jedem Commit)
//   node tools/stamp-versions.mjs --check  nur prüfen (für GitHub Actions)
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = { 'index.html': 'app.js', 'overlay.html': 'overlay.js', 'admin.html': 'admin.js' };
const check = process.argv.includes('--check');

const hash = (path) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex').slice(0, 10);

const imports = Object.fromEntries(readdirSync(join(root, 'js'))
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => [`./js/${f}`, `./js/${f}?v=${hash(`js/${f}`)}`]));

let stale = [];
for (const [page, entry] of Object.entries(PAGES)) {
  const file = join(root, page);
  const before = readFileSync(file, 'utf8');
  const block = [
    '<!-- versions:start (node tools/stamp-versions.mjs) -->',
    `  <script type="importmap">${JSON.stringify({ imports }, null, 2).replace(/\n/g, '\n  ')}</script>`,
    `  <script type="module">import './js/${entry}';</script>`,
    '  <!-- versions:end -->',
  ].join('\n');
  let after = before.replace(/<!-- versions:start[\s\S]*?<!-- versions:end -->/, block);
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

if (check && stale.length) {
  console.error(`Versionsnummern veraltet in: ${stale.join(', ')} – bitte "node tools/stamp-versions.mjs" ausführen und committen.`);
  process.exit(1);
}
console.log(stale.length ? `Aktualisiert: ${stale.join(', ')}` : 'Versionsnummern sind aktuell.');
