// Prüft die Übersetzungen (js/i18n-<sprache>.js) gegen die deutschen Schlüssel (js/i18n-keys.js):
// gleiche Anzahl, gleiche HTML-Tags und Platzhalter wie {n}. Dazu das Twitch-Panel (extension/panel-i18n.js).
// Läuft in den GitHub-Checks.
//   node tools/check-i18n.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const js = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const keys = (await import(pathToFileURL(join(js, 'i18n-keys.js')))).default;
const tags = (s) => (s.match(/<\/?[a-z][^>]*>/g) ?? []).map((t) => t.replace(/\s+/g, ' ')).join('|');
const vars = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
const problems = [];
for (const f of readdirSync(js).filter((f) => /^i18n-[a-z]{2}\.js$/.test(f))) {
  const vals = (await import(pathToFileURL(join(js, f)))).default;
  if (vals.length !== keys.length) problems.push(`${f}: ${vals.length} statt ${keys.length} Einträge`);
  keys.forEach((k, i) => {
    const v = vals[i];
    if (typeof v !== 'string' || !v.trim()) { problems.push(`${f} #${i}: fehlt („${k.slice(0, 40)}“)`); return; }
    if (tags(k) !== tags(v)) problems.push(`${f} #${i}: HTML passt nicht („${k.slice(0, 40)}“)`);
    if (vars(k) !== vars(v)) problems.push(`${f} #${i}: Platzhalter passen nicht („${k.slice(0, 40)}“)`);
  });
}
// Twitch-Panel: eigenes kleines Wörterbuch (die Erweiterung lädt nur Dateien aus extension/)
const panel = {};
runInNewContext(readFileSync(join(js, '..', 'extension', 'panel-i18n.js'), 'utf8'), { window: panel });
const pk = panel.PANEL_I18N.keys;
for (const [lang, vals] of Object.entries(panel.PANEL_I18N.langs)) {
  if (vals.length !== pk.length) problems.push(`panel-i18n ${lang}: ${vals.length} statt ${pk.length} Einträge`);
  pk.forEach((k, i) => {
    if (typeof vals[i] !== 'string' || !vals[i].trim()) problems.push(`panel-i18n ${lang} #${i}: fehlt („${k.slice(0, 40)}“)`);
    else if (vars(k) !== vars(vals[i])) problems.push(`panel-i18n ${lang} #${i}: Platzhalter passen nicht („${k.slice(0, 40)}“)`);
  });
}

if (problems.length) {
  console.error(`Übersetzungen: ${problems.length} Problem(e)\n${problems.slice(0, 50).map((p) => `  · ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Übersetzungen: alle Sprachen vollständig (${keys.length} Texte, Panel ${pk.length}).`);
