// Welcher Streamer-Kanal? (Plattform, Migration …_platform.sql)
// Die Webseite zeigt immer genau einen Kanal: aus dem Link (#/c/<login>), aus dem OBS-Overlay
// (overlay.html?c=<login>), den zuletzt besuchten, den eigenen oder sonst den Standard-Kanal.
// Jede Anfrage an Supabase trägt ihn im Header x-channel; die Datenbank zeigt dann nur dessen
// Inhalte. Live-Updates (Realtime) kommen aus den Tabellen in „core“, gefiltert nach channel_id.
// Solange die Plattform-Migration fehlt, bleibt alles wie vorher (kein Header, Realtime auf public).
const KEY_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9_]{1,25})$/;
const STORE_KEY = 'sh_channel';

export function cleanChannel(value) {
  const v = String(value ?? '').trim().toLowerCase().replace(/^@/, '');
  return KEY_RE.test(v) ? v : null;
}

// #/c/<login> (Webseite) oder ?c=<login> (Overlay, OBS-Fenster)
export function channelFromUrl(loc = location) {
  const hash = /^#\/c\/([^/?#&]+)/.exec(loc.hash);
  if (hash) return cleanChannel(decodeURIComponent(hash[1]));
  return cleanChannel(new URLSearchParams(loc.search).get('c'));
}

export function rememberChannel(key) {
  try {
    if (key) localStorage.setItem(STORE_KEY, key);
    else localStorage.removeItem(STORE_KEY);
  } catch { /* nur Komfort */ }
}
export function rememberedChannel() {
  try { return cleanChannel(localStorage.getItem(STORE_KEY)); } catch { return null; }
}

// Der aktuelle Kanal: info = {id, login, display_name, avatar_url, is_default, status, is_owner}
export const current = { info: null, id: null, platform: false };

export function setChannel(info, platform = true) {
  current.info = info ?? null;
  current.id = info?.id ?? null;
  current.platform = platform && !!info;
}

// Kennung für Links: Twitch-Login, sonst die ID. Der Standard-Kanal braucht keine.
export function channelParam() {
  const info = current.info;
  if (!current.platform || !info || info.is_default) return null;
  return info.login || info.id;
}

// Für fetch(): Header x-channel an Anfragen an die Datenbank, Edge Functions und Dateien
export function channelHeaders() {
  return current.platform && current.id ? { 'x-channel': current.id } : {};
}
const NEEDS_CHANNEL = /\/(rest|functions|storage)\/v1\//;
export function channelFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (!current.platform || !current.id || !NEEDS_CHANNEL.test(url)) return fetch(input, init);
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('x-channel', current.id);
  return fetch(input, { ...init, headers });
}

// Realtime: {event, schema, table, filter} für .on('postgres_changes', …)
export function rtSpec(table, event = '*') {
  return current.platform && current.id
    ? { event, schema: 'core', table, filter: `channel_id=eq.${current.id}` }
    : { event, schema: 'public', table };
}

// Ohne Anmeldung (Overlay, Startseite): Kanal über die Datenbank suchen.
// Antwort: {platform:false} ohne Plattform-Migration, sonst {platform:true, channel|null}.
export async function lookupChannel(config, key) {
  const res = await fetch(`${config.SUPABASE_URL}/rest/v1/rpc/channel_info`, {
    method: 'POST',
    headers: { apikey: config.SUPABASE_ANON_KEY, Authorization: `Bearer ${config.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: key ?? null }),
    cache: 'no-store',
  });
  if (res.status === 404) return { platform: false, channel: null };
  if (!res.ok) throw new Error(`Kanal nicht lesbar (${res.status})`);
  return { platform: true, channel: await res.json() };
}

// Ordner für Admin-Dateien (Bingo-Bilder, Alert-Sounds, Karten …): <Kanal-ID>/…
export function storageFolder() {
  return current.platform && current.id ? `${current.id}/` : '';
}

// Links aufs Overlay und ins OBS-Fenster: ?c=<Kanal> (nicht nötig beim Standard-Kanal)
export function withChannelParam(url) {
  const p = channelParam();
  if (p) url.searchParams.set('c', p);
  else url.searchParams.delete('c');
  return url;
}
