// Sicherheits-Prüfung der Migrationen (läuft in GitHub Actions, .github/workflows/security-checks.yml):
//   · jede Funktion mit „security definer“ hat einen festen search_path (sonst könnte jemand
//     eigene Tabellen/Funktionen unterschieben)
//   · jede neue Tabelle bekommt Row Level Security (in derselben Datei)
//   · keine Rechte für anon/authenticated auf Tabellen mit Geheimnissen
//
//   node tools/check-sql.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const SECRET_TABLES = ['twitch_connection', 'pause_secret', 'quiz_secret', 'bot_outbox', 'twitch_bot', 'oauth_states', 'admin_login_failures', 'admin_mfa', 'rate_hits'];
const problems = [];

for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(dir, file), 'utf8').replace(/--[^\n]*/g, '');
  const line = (i) => sql.slice(0, i).split('\n').length;

  // Funktionskopf bis zum Körper ($$ oder $function$)
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(([\s\S]*?)\bas\s+\$(\w*)\$/gi)) {
    const head = m[0];
    if (/security\s+definer/i.test(head) && !/set\s+search_path/i.test(head)) {
      problems.push(`${file}:${line(m.index)} ${m[1]}: security definer ohne „set search_path“`);
    }
  }

  for (const m of sql.matchAll(/create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w.]+)/gi)) {
    const name = m[1].replace(/^(public|core)\./, '');
    const rls = new RegExp(`alter\\s+table\\s+(?:public\\.|core\\.)?${name}\\s+enable\\s+row\\s+level\\s+security`, 'i');
    if (!rls.test(sql)) problems.push(`${file}:${line(m.index)} Tabelle ${m[1]} ohne „enable row level security“`);
  }

  for (const m of sql.matchAll(/grant\s+([\w\s,()]+?)\s+on\s+(?:table\s+)?([\w.]+)\s+to\s+([\w\s,]+)/gi)) {
    const table = m[2].replace(/^(public|core)\./, '');
    if (SECRET_TABLES.includes(table) && /\b(anon|authenticated)\b/i.test(m[3])) {
      problems.push(`${file}:${line(m.index)} Rechte für ${m[3].trim()} auf geheime Tabelle ${m[2]}`);
    }
  }
}

if (problems.length) {
  console.error(`Sicherheits-Prüfung der Migrationen: ${problems.length} Problem(e)\n${problems.map((p) => `  · ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('Migrationen: alle Prüfungen bestanden.');
