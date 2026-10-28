// Dateien aus dem Artist-Upload (Migration …_artists.sql): Bucket artist-assets, Pfad <user-id>/<uuid>.<endung>.
// Genutzt von Dashboard, Design-Bibliothek, Alert-Designer und Overlay. Im Demo-Modus liegen die Dateien als
// data:-Adresse im Browser (zd_artist_files) – dazu ein paar mitgelieferte Beispiele.
import { CONFIG } from './config.js';

export const ARTIST_FILE_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|gif|webp|webm|mp4)$/;
export const isArtistVideo = (path) => /\.(webm|mp4)$/.test(path ?? '');
const live = () => !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);

// Beispiel-Artist im Demo-Modus (Dateien aus assets/)
export const DEMO_ARTIST_ID = 'dddddddd-0000-4000-8000-000000000001';
const seed = (n) => `${DEMO_ARTIST_ID}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}.png`;
export const DEMO_SEED = {
  [seed(1)]: 'assets/alerts/vinyl.svg',
  [seed(2)]: 'assets/bg-lofi.svg',
  [seed(3)]: 'assets/bg-cyberpunk.svg',
  [seed(4)]: 'assets/alerts/chip.svg',
  [seed(5)]: 'assets/alerts/sakura.svg',
};
export const demoSeedPath = seed;

export function artistFileUrl(path) {
  if (!ARTIST_FILE_RE.test(path ?? '')) return '';
  if (live()) return `${CONFIG.SUPABASE_URL}/storage/v1/object/public/artist-assets/${path}`;
  if (DEMO_SEED[path]) return new URL(DEMO_SEED[path], location.href).href;
  try {
    const files = JSON.parse(localStorage.getItem('zd_artist_files') ?? '{}');
    return typeof files[path] === 'string' && files[path].startsWith('data:') ? files[path] : '';
  } catch {
    return '';
  }
}
