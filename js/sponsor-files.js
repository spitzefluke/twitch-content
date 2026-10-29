// Sponsoring-Börse: Schalter, ob sie offen ist, und die Logos (Migration …_sponsoring.sql): Bucket sponsor-assets,
// Pfad <angebot-id>.<endung>. Genutzt von sponsoring.html, Dashboard, Admin-Bereich und Overlay. Im Demo-Modus
// liegen die Logos als data:-Adresse im Browser (zd_sponsor_logos).
import { CONFIG } from './config.js';

// Noch geschlossen: Die Börse braucht ein angemeldetes Gewerbe. Zum Öffnen hier true setzen und in Supabase das
// Secret SPONSORING_OPEN=1 für die Edge Function sponsoring hinterlegen (sie lehnt Angebote sonst ab).
export const SPONSORING_OPEN = false;
export const SPONSORING_SOON = 'Wir sind gerade dabei, dafür ein Gewerbe anzumelden. Sobald das erledigt ist, öffnen wir die Sponsoring-Börse.';

export const SPONSOR_LOGO_RE = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;
const live = () => !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);

export function sponsorLogoUrl(path) {
  if (!SPONSOR_LOGO_RE.test(path ?? '')) return '';
  if (live()) return `${CONFIG.SUPABASE_URL}/storage/v1/object/public/sponsor-assets/${path}`;
  try {
    const logos = JSON.parse(localStorage.getItem('zd_sponsor_logos') ?? '{}');
    return typeof logos[path] === 'string' && logos[path].startsWith('data:image/') ? logos[path] : '';
  } catch {
    return '';
  }
}

// Datei → data:-Adresse (fürs Hochladen über die Edge Function); höchstens 1 MB, PNG/JPG/WebP
export function readLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(''); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { reject(new Error('Logo: bitte PNG, JPG oder WebP.')); return; }
    if (file.size > 1024 * 1024) { reject(new Error('Logo: höchstens 1 MB.')); return; }
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Logo: Datei lässt sich nicht lesen.'));
    r.readAsDataURL(file);
  });
}
