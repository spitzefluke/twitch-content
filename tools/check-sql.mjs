// Sicherheits-Prüfung der Migrationen (läuft in GitHub Actions, .github/workflows/security-checks.yml):
//   · jede Funktion mit „security definer“ hat einen festen search_path (sonst könnte jemand
//     eigene Tabellen/Funktionen unterschieben)
//   · jede neue Tabelle bekommt Row Level Security (in derselben Datei)
//   · keine Rechte für anon/authenticated auf Tabellen mit Geheimnissen
//   · Policies auf Kanal-Tabellen prüfen Admin-Rechte für den Kanal der Zeile (is_admin_of(channel_id)),
//     nicht nur für den Kanal der Anfrage (is_admin() ohne channel_id gilt sonst für alle Kanäle)
//
//   node tools/check-sql.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const SECRET_TABLES = ['twitch_connection', 'pause_secret', 'quiz_secret', 'bot_outbox', 'twitch_bot', 'oauth_states', 'admin_login_failures', 'admin_mfa', 'rate_hits', 'contact_messages', 'youtube_connection', 'discord_settings'];
const problems = [];
// Policies, die nach allen Migrationen gelten: "tabelle|name" → {file, line, body}
const policies = new Map();
// Tabellen ohne Kanal-Spalte (dort ist is_admin() ohne channel_id richtig)
const PLATFORM = '20261028000000_platform.sql';
const NO_CHANNEL = new Set(['profiles', 'channels', 'platform_state', 'platform_updates', 'platform_update_reads', 'contact_messages']);

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

  // Die Plattform-Migration schreibt is_admin() in allen bis dahin angelegten Policies auf
  // is_admin_of(channel_id) um (DO-Block über pg_policies) – geprüft wird, was danach dazukommt.
  if (file === PLATFORM) policies.clear();
  // Reihenfolge zählt: drop und create in der Datei der Reihe nach
  for (const m of sql.matchAll(/(drop|create)\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+(?:(?:public|core)\.)?(\w+)([^;]*);/gi)) {
    const key = `${m[3]}|${m[2]}`;
    if (m[1].toLowerCase() === 'drop') policies.delete(key);
    else policies.set(key, { file, line: line(m.index), table: m[3], name: m[2], body: m[4] });
  }

  for (const m of sql.matchAll(/grant\s+([\w\s,()]+?)\s+on\s+(?:table\s+)?([\w.]+)\s+to\s+([\w\s,]+)/gi)) {
    const table = m[2].replace(/^(public|core)\./, '');
    if (SECRET_TABLES.includes(table) && /\b(anon|authenticated)\b/i.test(m[3])) {
      problems.push(`${file}:${line(m.index)} Rechte für ${m[3].trim()} auf geheime Tabelle ${m[2]}`);
    }
  }
}

for (const p of policies.values()) {
  if (NO_CHANNEL.has(p.table)) continue;
  if (/\b(is_admin|is_owner|is_mod)\s*\(\s*\)/i.test(p.body) && !/channel_id/i.test(p.body)) {
    problems.push(`${p.file}:${p.line} Policy „${p.name}“ auf ${p.table}: is_admin() ohne channel_id – gilt für alle Kanäle (is_admin_of(channel_id) nehmen)`);
  }
}

if (problems.length) {
  console.error(`Sicherheits-Prüfung der Migrationen: ${problems.length} Problem(e)\n${problems.map((p) => `  · ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('Migrationen: alle Prüfungen bestanden.');
