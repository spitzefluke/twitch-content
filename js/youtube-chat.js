// YouTube-Livechat fürs OBS-Overlay. Das Overlay fragt die Edge Function youtube-chat
// (supabase/functions/youtube-chat) regelmäßig nach neuen Nachrichten – YouTube selbst
// lässt sich aus dem Browser nicht abfragen. Kein API-Schlüssel nötig, nichts wird gespeichert.
// Läuft gerade kein Stream, schaut es jede Minute wieder nach.
import { CONFIG } from './config.js';

const OFFLINE_RETRY_MS = 60_000;
const ERROR_RETRY_MS = 20_000;

// Kanal aus Eingabe: „@name“, „youtube.com/@name“, „youtube.com/channel/UC…“ oder die Kanal-ID
export function youtubeChannel(value) {
  const v = String(value ?? '').trim();
  const handle = /(?:^|youtube\.com\/)(@[A-Za-z0-9._-]{3,30})/.exec(v)?.[1];
  if (handle) return handle;
  const id = /(?:^|channel\/)(UC[A-Za-z0-9_-]{22})/.exec(v)?.[1];
  if (id) return id;
  if (/^[A-Za-z0-9._-]{3,30}$/.test(v)) return `@${v}`;
  return null;
}

const BADGE_MAP = { owner: 'broadcaster', moderator: 'moderator', member: 'member', verified: 'partner' };

// Antwort der Edge Function → Nachricht im selben Format wie beim Twitch-Chat
export function youtubeMessage(m) {
  const parts = (m.parts ?? []).map((p) => (p.emoji ? { image: p.emoji, name: p.name } : { text: String(p.text ?? '') }));
  if (m.kind === 'sticker') parts.push({ text: 'hat einen Super Sticker geschickt' });
  return {
    id: `yt-${m.id}`,
    platform: 'youtube',
    login: `yt:${m.channelId}`,
    name: m.name,
    color: null,
    badges: (m.badges ?? []).map((b) => BADGE_MAP[b]).filter(Boolean),
    text: parts.map((p) => p.text ?? p.name ?? '').join(''),
    parts,
    paid: m.paid || null,
    highlight: m.kind !== 'text',
  };
}

async function call(body) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/youtube-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `youtube-chat: ${res.status}`);
  return data;
}

// on.message(msg), on.remove(id), on.clear(login), on.status(text). Liefert eine Stopp-Funktion.
export function connectYouTubeChat(channel, on = {}) {
  const ch = youtubeChannel(channel);
  if (!ch || !CONFIG.SUPABASE_URL) return () => {};
  let stopped = false;
  let timer = 0;
  const next = (fn, ms) => { if (!stopped) timer = setTimeout(fn, ms); };

  const start = async () => {
    try {
      const s = await call({ channel: ch });
      if (!s.live) { on.status?.('offline'); next(start, OFFLINE_RETRY_MS); return; }
      on.status?.('live');
      poll({ continuation: s.continuation, clientVersion: s.clientVersion, apiKey: s.apiKey }, true);
    } catch (err) {
      console.warn('YouTube-Chat:', err);
      next(start, ERROR_RETRY_MS);
    }
  };

  const poll = async (state, first = false) => {
    if (stopped) return;
    try {
      const r = await call(state);
      if (r.ended || !r.continuation) { on.status?.('offline'); next(start, OFFLINE_RETRY_MS); return; }
      // Die erste Antwort bringt die letzten Nachrichten vor dem Start mit – die nicht noch mal zeigen
      if (!first) for (const m of r.messages ?? []) on.message?.(youtubeMessage(m));
      for (const id of r.removed ?? []) on.remove?.(`yt-${id}`);
      for (const id of r.removedAuthors ?? []) on.clear?.(`yt:${id}`);
      next(() => poll({ ...state, continuation: r.continuation }), r.timeoutMs ?? 4000);
    } catch (err) {
      console.warn('YouTube-Chat:', err);
      next(start, ERROR_RETRY_MS);
    }
  };

  start();
  return () => { stopped = true; clearTimeout(timer); };
}
