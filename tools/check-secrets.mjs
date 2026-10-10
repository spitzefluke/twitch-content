// Prüft, dass im Code der Webseite nur öffentliche Schlüssel stehen (läuft in GitHub Actions):
//   · jeder JWT in js/ und extension/ hat role „anon“ (nie „service_role“)
//   · kein neuer geheimer Supabase-Schlüssel (sb_secret_…), kein privater Schlüssel
//
//   node tools/check-secrets.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|html|json)$/.test(f)) files.push(p);
  }
};
['js', 'extension'].forEach((d) => walk(join(root, d)));
files.push(...readdirSync(root).filter((f) => f.endsWith('.html')).map((f) => join(root, f)));

const problems = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const name = relative(root, file);
  for (const [jwt] of text.matchAll(/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g)) {
    let role = '?';
    try { role = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role ?? '?'; } catch { /* kein JSON */ }
    if (role !== 'anon') problems.push(`${name}: Schlüssel mit role „${role}“ – nur der Anon-Key darf in den Code`);
  }
  if (/sb_secret_[\w-]{10,}/.test(text)) problems.push(`${name}: geheimer Supabase-Schlüssel (sb_secret_…)`);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) problems.push(`${name}: privater Schlüssel`);
}
if (problems.length) {
  console.error(`Geheimnisse im Code gefunden:\n${problems.map((p) => `  · ${p}`).join('\n')}\nSofort entfernen UND den Schlüssel austauschen (NOTFALLPLAN.md).`);
  process.exit(1);
}
console.log(`Keine Geheimnisse im Code (${files.length} Dateien geprüft).`);
