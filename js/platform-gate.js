// Plattform-Steuerung aus dem Admin-Bereich (Migration …_channel_moderation.sql), für Overlay und Dashboard:
//   · overlay_gate: Ist das Overlay gerade pausiert (Kanal, Notfall-Schalter, Wartung)?
//   · platform_ping: Sollen alle neu laden („Alle neu laden“)? Läuft eine Wartung?
//   · neue Version: Steht auf der Seite eine neuere app.js/overlay.js als die geladene? (ohne Datenbank)
// Fehlt die Migration oder läuft die Demo, ist einfach nichts pausiert.
import { CONFIG } from './config.js';
import { channelHeaders } from './channel.js';

const LOADED_AT = Date.now();

async function rpc(name) {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return null;
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', ...channelHeaders() },
    body: '{}',
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

export const overlayGate = () => rpc('overlay_gate').catch(() => null);
export const platformPing = () => rpc('platform_ping').catch(() => null);

// Neu laden – mit frischer Adresse, damit kein Zwischenspeicher die alte Seite liefert
export function reloadFresh() {
  const url = new URL(location.href);
  url.searchParams.set('_r', Date.now().toString(36));
  location.replace(url.href);
}

// „Alle neu laden“ kam nach dem Öffnen dieser Seite?
export const reloadWanted = (reloadAt) => !!reloadAt && Date.parse(reloadAt) > LOADED_AT;

// Läuft eine neuere Version? Vergleicht die ?v=… des Einstiegs-Skripts in der frisch geladenen Seite
// mit der eigenen (tools/stamp-versions.mjs schreibt sie in die Import-Map).
export async function newVersionAvailable(page, entry) {
  try {
    const pick = (text) => text?.match(new RegExp(`"\\./js/${entry.replace('.', '\\.')}\\?v=([0-9a-f]+)"`))?.[1] ?? null;
    const loaded = pick(document.querySelector('script[type="importmap"]')?.textContent);
    if (!loaded) return false;
    const res = await fetch(`${page}?_v=${Date.now().toString(36)}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const fresh = pick(await res.text());
    return !!fresh && fresh !== loaded;
  } catch {
    return false;
  }
}

// Overlay: pausiert? Dann leer bleiben (kein Bild, kein Ton) und jede Minute nachsehen; wieder frei → neu laden.
// In der Vorschau des OBS-Fensters (edit/test) steht ein Hinweis statt nichts.
export async function holdOverlayIfPaused() {
  const gate = await overlayGate();
  if (!gate?.off) return gate;
  const preview = /[?&](edit|test)=/.test(location.search);
  document.documentElement.classList.add('ov-paused');
  if (preview) {
    const until = gate.until && !gate.until.startsWith('9999') ? new Date(gate.until).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const box = document.createElement('div');
    box.className = 'ov-paused-note';
    box.textContent = `⏸️ Overlay pausiert${gate.by === 'maintenance' ? ' (Wartung)' : ' vom StreamHelp-Team'}${until ? ` bis ${until}` : ''}`;
    document.body.append(box);
  }
  setInterval(async () => {
    const g = await overlayGate();
    if (g && !g.off) reloadFresh();
  }, 60_000);
  return new Promise(() => {}); // hier geht es nicht weiter
}

// Overlay läuft: jede Minute prüfen – pausiert oder „Alle neu laden“ → neu laden
export function watchOverlayGate() {
  setInterval(async () => {
    const g = await overlayGate();
    if (g && (g.off || reloadWanted(g.reload_at))) reloadFresh();
  }, 60_000);
}
