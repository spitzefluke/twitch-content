// Kanalbilder: Twitch-Profilbilder kommen über die Edge Function avatar (supabase/functions/avatar),
// damit Besucher sie nicht direkt bei Twitch laden (keine IP-Adresse an Twitch). Bilder aus dem eigenen
// Supabase bleiben, wie sie sind; alles andere wird gar nicht geladen (dann zeigt die Seite den Anfangsbuchstaben).
import { CONFIG } from './config.js';

const TWITCH = /^https:\/\/static-cdn\.jtvnw\.net\/(?:jtv_user_pictures|user-default-pictures-uv)\//i;

export function avatarSrc(url) {
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return null;
  const base = String(CONFIG.SUPABASE_URL ?? '').replace(/\/+$/, '');
  if (TWITCH.test(url)) return base ? `${base}/functions/v1/avatar?u=${encodeURIComponent(url)}` : null;
  try {
    if (base && new URL(url).origin === new URL(base).origin) return url;
  } catch { /* kaputte Adresse: kein Bild */ }
  return null;
}
