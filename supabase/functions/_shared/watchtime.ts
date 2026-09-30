// Watchtime (Migration …_chat_bot_commands.sql): Solange der Stream live ist, bekommt
// jeder Zuschauer im Chat die vergangene Zeit gutgeschrieben. Angestoßen wird das vom
// OBS-Overlay (läuft genau während des Streams) über stream-tools {action:"watch_tick"} –
// die Datenbank lässt höchstens alle 4,5 Minuten einen Durchgang zu.
// Wer im Chat ist, sagt Twitch („Get Chatters“, Recht moderator:read:chatters des Streamers).
// Fehlt das Recht, zählen alle, die in den letzten 10 Minuten geschrieben haben.
import { db, getAppToken, getBot, getConnection, helix } from "./twitch.ts";

type Viewer = { id: string; login: string; name: string };
const CHAT_WINDOW_MS = 10 * 60_000;

export async function watchTick() {
  const { data: claim, error } = await db.rpc("watch_tick_claim");
  if (error) return { skipped: "migration" };
  if (!claim) return { skipped: "throttled" };

  const conn = await getConnection().catch(() => null);
  if (!conn) return { skipped: "not_connected" };
  const appToken = await getAppToken();
  const stream = await helix("streams", appToken, { query: { user_id: conn.broadcaster_id } }).catch(() => null);
  if (!stream?.data?.length) {
    await db.rpc("watch_offline");
    return { live: false };
  }

  // Gutgeschrieben wird die echte Zeit seit dem letzten Durchgang (1–10 Minuten),
  // beim ersten Durchgang eines Streams 5 Minuten.
  const now = Date.now();
  const prev = claim.prev ? Date.parse(claim.prev) : NaN;
  const seconds = claim.was_live && Number.isFinite(prev)
    ? Math.round(Math.min(600, Math.max(60, (now - prev) / 1000)))
    : 300;

  let viewers: Viewer[] = [];
  let source = "chatters";
  try {
    viewers = await chatters(conn.broadcaster_id, conn.access_token);
  } catch {
    source = "chat";
    const { data } = await db.from("watchtime").select("twitch_id, login, display_name")
      .gt("last_chat_at", new Date(now - CHAT_WINDOW_MS).toISOString()).limit(5000);
    viewers = (data ?? []).map((w) => ({ id: w.twitch_id, login: w.login, name: w.display_name }));
  }
  // Streamer und Bot zählen nicht
  const bot = await getBot().catch(() => null);
  const skip = new Set([conn.broadcaster_id, bot?.user_id].filter(Boolean));
  viewers = viewers.filter((v) => !skip.has(v.id));

  const { data: counted, error: addErr } = await db.rpc("watch_add", { p_users: viewers, p_seconds: seconds, p_source: source });
  if (addErr) throw addErr;
  return { live: true, seconds, viewers: counted ?? viewers.length, source };
}

async function chatters(broadcasterId: string, token: string) {
  const out: Viewer[] = [];
  let after = "";
  for (let page = 0; page < 10; page++) {
    const r = await helix("chat/chatters", token, {
      query: { broadcaster_id: broadcasterId, moderator_id: broadcasterId, first: "1000", ...(after ? { after } : {}) },
    });
    for (const u of r.data ?? []) out.push({ id: u.user_id, login: u.user_login, name: u.user_name });
    after = r.pagination?.cursor ?? "";
    if (!after) break;
  }
  return out;
}

// Jede Chat-Nachricht: „zuletzt geschrieben“ merken (für die Zählung ohne Chatters-Recht)
export async function noteChatter(id: string, login: string, name: string) {
  await db.rpc("watch_seen", { p_id: id, p_login: login, p_name: name });
}
