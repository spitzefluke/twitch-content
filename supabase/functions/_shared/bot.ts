// Chat-Bot (Migration …_chat_bot_plus.sql). Läuft für jede Chat-Nachricht vor allem anderen:
//   · Moderation: Nachricht löschen oder Timeout (Twitch-Rechte moderator:manage:chat_messages und
//     moderator:manage:banned_users des Streamers), dazu auf Wunsch eine Ermahnung vom Bot
//   · Begrüßung und Auto-Nachrichten (Texte aus der Datenbank)
//   · Stream-Infos: !uptime, !followage, !game, !title, !so @name (holt die Daten bei Twitch)
//   · Song-Wünsche: !sr <YouTube-Link>
// Dazu Danke für Follow, Abo, Bits und Raid (aus twitch-eventsub) und die Platzhalter {uptime} {game}
// {title} {followage} in eigenen Befehlen. Was entschieden wird, steht in SQL (bot_chat, bot_event) –
// hier passiert nur, was Twitch oder YouTube braucht.
import { db, getAppToken, getConnection, helix, sendChat, type Connection } from "./twitch.ts";
import { lookupVideo, parseVideoId } from "./songs.ts";

type Fragment = { type: string; text: string };
export type BotChatEvent = {
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message_id?: string;
  badges?: { set_id: string }[];
  message?: { text?: string; fragments?: Fragment[] };
};

type BotResult = {
  stop?: boolean;
  mod?: { action: "delete" | "timeout"; seconds: number; reason: string; warn?: string | null };
  replies?: { text: string }[];
  info?: "uptime" | "followage" | "game" | "title" | "so";
  target?: string;
  text?: string;
  song?: "request";
};

const warn = (what: string) => (e: unknown) => console.warn(`${what}:`, (e as Error)?.message ?? e);

// ---------- Links erkennen ----------
// Mit http(s):// oder www. immer, sonst nur mit bekannter Endung (sonst wäre „z.B.“ schon ein Link).
const TLDS = "com|net|org|de|at|ch|tv|gg|io|ly|me|co|be|info|xyz|ru|eu|uk|app|link|shop|live|stream|to|cc|fm|tk|ml|ga|cf|gq|top|site|online|club|biz|us|nl|fr|it|es|pl|tr|pt|se|no|dk|fi|cz|sk|hu|ro|gr|jp|cn|kr|in|br|mx|ca|au|ai|so|sh|gl|lol|fun|win|bet|vip|pro|dev|page|store|tech|art|games|news|blog|one|ws|gift|click|ly";
const BARE = new RegExp(`(?:^|[^a-z0-9@._/-])((?:[a-z0-9-]+\\.)+(?:${TLDS}))(?=$|[/:?#\\s,!)\\]]|\\.(?:\\s|$))`, "gi");
export function linkHosts(text: string): string[] {
  const hosts = new Set<string>();
  for (const m of text.matchAll(/(?:https?:\/\/|www\.)([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) hosts.add(m[1].toLowerCase().replace(/^www\./, ""));
  for (const m of text.matchAll(BARE)) hosts.add(m[1].toLowerCase().replace(/^www\./, ""));
  return [...hosts].slice(0, 10);
}

// ---------- Jede Chat-Nachricht ----------
// Ergebnis: "mod" (gelöscht/Timeout – nichts weiter tun), "done" (Bot-Befehl erledigt), false (weiter wie gehabt)
export async function handleBot(event: BotChatEvent): Promise<"mod" | "done" | false> {
  const text = (event.message?.text ?? "").trim();
  const frags = event.message?.fragments ?? [];
  const emotes = frags.filter((f) => f.type === "emote").length;
  const plain = frags.length ? frags.filter((f) => f.type === "text").map((f) => f.text).join("") : text;
  const { data, error } = await db.rpc("bot_chat", {
    p_user_id: event.chatter_user_id,
    p_login: event.chatter_user_login,
    p_name: event.chatter_user_name || event.chatter_user_login,
    p_badges: (event.badges ?? []).map((b) => b.set_id),
    p_text: text.slice(0, 500),
    p_plain: plain.slice(0, 500),
    p_emotes: emotes,
    p_hosts: linkHosts(plain),
  });
  if (error) {
    if (!/bot_chat/.test(error.message)) console.warn("bot_chat:", error.message); // Migration fehlt: nichts tun
    return false;
  }
  const res = (data ?? {}) as BotResult;
  const conn = await getConnection().catch(() => null);
  if (!conn) return res.mod ? "mod" : res.stop ? "done" : false;
  if (res.mod) {
    await moderate(conn, event, res.mod).catch(warn("Moderation"));
    if (res.mod.warn) await sendChat(conn, res.mod.warn).catch(warn("Chat"));
    return "mod";
  }
  for (const r of res.replies ?? []) await sendChat(conn, r.text).catch(warn("Chat"));
  if (res.info) await streamInfo(conn, event, res).catch(warn("Stream-Info"));
  if (res.song === "request") await songRequest(conn, event, text).catch(warn("Song-Wunsch"));
  return res.stop ? "done" : false;
}

async function moderate(conn: Connection, event: BotChatEvent, mod: NonNullable<BotResult["mod"]>) {
  const who = { broadcaster_id: conn.broadcaster_id, moderator_id: conn.broadcaster_id };
  if (mod.action === "timeout") {
    await helix("moderation/bans", conn.access_token, {
      method: "POST", query: who,
      body: { data: { user_id: event.chatter_user_id, duration: mod.seconds, reason: `StreamHelp-Bot: ${REASONS[mod.reason] ?? mod.reason}` } },
    });
  } else if (event.message_id) {
    await helix("moderation/chat", conn.access_token, { method: "DELETE", query: { ...who, message_id: event.message_id } });
  }
}
const REASONS: Record<string, string> = { link: "Link", word: "gesperrtes Wort", caps: "Großbuchstaben", emotes: "zu viele Emotes", spam: "Spam" };

// ---------- Stream-Infos ----------
const nameOf = (event: BotChatEvent) => `@${event.chatter_user_name || event.chatter_user_login}`;

export function fmtDuration(ms: number) {
  const min = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return [d && `${d} ${d === 1 ? "Tag" : "Tage"}`, h && `${h} Std`, (m || (!d && !h)) && `${m} Min`].filter(Boolean).join(" ");
}

// „1 Jahr 3 Monate“ / „5 Monate 2 Tage“ / „12 Tage“
export function fmtSince(fromIso: string, now = new Date()) {
  const from = new Date(fromIso);
  let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) months--;
  const anchor = new Date(from);
  anchor.setMonth(from.getMonth() + months);
  const days = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / 86400_000));
  const y = Math.floor(months / 12);
  const mo = months % 12;
  const parts = [y && `${y} ${y === 1 ? "Jahr" : "Jahre"}`, mo && `${mo} ${mo === 1 ? "Monat" : "Monate"}`, !y && days && `${days} ${days === 1 ? "Tag" : "Tage"}`];
  return parts.filter(Boolean).join(" ") || "heute";
}

async function liveData(conn: Connection) {
  const app = await getAppToken();
  const [stream, channel] = await Promise.all([
    helix("streams", app, { query: { user_id: conn.broadcaster_id } }).catch(() => null),
    helix("channels", app, { query: { broadcaster_id: conn.broadcaster_id } }).catch(() => null),
  ]);
  const s = stream?.data?.[0];
  const c = channel?.data?.[0];
  return {
    live: !!s,
    uptime: s?.started_at ? fmtDuration(Date.now() - Date.parse(s.started_at)) : "",
    game: String(c?.game_name || s?.game_name || ""),
    title: String(c?.title || s?.title || ""),
  };
}

async function followage(conn: Connection, userId: string) {
  if (userId === conn.broadcaster_id) return null;
  const r = await helix("channels/followers", conn.access_token, { query: { broadcaster_id: conn.broadcaster_id, user_id: userId } });
  const at = r?.data?.[0]?.followed_at;
  return at ? { since: fmtSince(at), date: new Date(at).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }) } : false;
}

async function streamInfo(conn: Connection, event: BotChatEvent, res: BotResult) {
  const streamer = conn.display_name || conn.broadcaster_login;
  if (res.info === "so") return shoutout(conn, res.target ?? "", res.text ?? "");
  if (res.info === "followage") {
    const f = await followage(conn, event.chatter_user_id);
    if (f === null) return;
    await sendChat(conn, f ? `${nameOf(event)} folgt ${streamer} seit ${f.since} (seit ${f.date}) 💜` : `${nameOf(event)} folgt ${streamer} noch nicht – einfach auf „Folgen“ klicken 💜`);
    return;
  }
  const d = await liveData(conn);
  if (res.info === "uptime") await sendChat(conn, d.live ? `${streamer} ist seit ${d.uptime} live 🔴` : `${streamer} ist gerade offline.`);
  if (res.info === "game") await sendChat(conn, d.game ? `🎮 Gerade läuft: ${d.game}` : "🎮 Gerade ist keine Kategorie eingestellt.");
  if (res.info === "title") await sendChat(conn, d.title ? `📺 ${d.title}` : "📺 Gerade gibt es keinen Titel.");
}

// !so @name und automatisch nach einem Raid: Nachricht vom Bot und – wenn Twitch es zulässt – der
// offizielle Twitch-Shoutout (höchstens alle 2 Minuten, dieselbe Person alle 60 Minuten).
export async function shoutout(conn: Connection, login: string, template: string, userId?: string) {
  const app = await getAppToken();
  const user = (await helix("users", app, { query: userId ? { id: userId } : { login } }).catch(() => null))?.data?.[0];
  if (!user || user.id === conn.broadcaster_id) return;
  const channel = (await helix("channels", app, { query: { broadcaster_id: user.id } }).catch(() => null))?.data?.[0];
  const text = (template || "Schaut bei {target} vorbei: https://twitch.tv/{login} 💜")
    .replaceAll("{target}", user.display_name || user.login)
    .replaceAll("{login}", user.login)
    .replaceAll("{game}", channel?.game_name || "etwas Tolles");
  await sendChat(conn, text.slice(0, 480)).catch(warn("Chat"));
  await helix("chat/shoutouts", conn.access_token, {
    method: "POST",
    query: { from_broadcaster_id: conn.broadcaster_id, to_broadcaster_id: user.id, moderator_id: conn.broadcaster_id },
  }).catch(warn("Twitch-Shoutout"));
}

// Platzhalter mit Twitch-Daten in eigenen Befehlen
export async function fillLive(conn: Connection, text: string, userId: string) {
  if (!/\{(uptime|game|title|followage)\}/.test(text)) return text;
  const d = await liveData(conn);
  let out = text
    .replaceAll("{uptime}", d.live ? d.uptime : "offline")
    .replaceAll("{game}", d.game || "–")
    .replaceAll("{title}", d.title || "–");
  if (out.includes("{followage}")) {
    const f = await followage(conn, userId).catch(() => null);
    out = out.replaceAll("{followage}", f ? f.since : "–");
  }
  return out.slice(0, 480);
}

// ---------- Song-Wünsche ----------
async function songRequest(conn: Connection, event: BotChatEvent, text: string) {
  const arg = text.replace(/^!\S+\s*/, "");
  const id = parseVideoId(arg);
  if (!id) {
    await sendChat(conn, `${nameOf(event)} So geht's: !sr und dahinter ein YouTube-Link 🎵`);
    return;
  }
  const v = await lookupVideo(id);
  if (!v.ok) {
    await sendChat(conn, v.reason === "live"
      ? `${nameOf(event)} Livestreams gehen nicht – bitte ein normales Video.`
      : `${nameOf(event)} Das Video gibt es nicht oder es darf nicht eingebettet werden.`);
    return;
  }
  const { data, error } = await db.rpc("bot_song_add", {
    p_user_id: event.chatter_user_id, p_name: event.chatter_user_name || event.chatter_user_login,
    p_video: id, p_title: v.title, p_seconds: v.seconds, p_source: "chat",
  });
  if (error) throw error;
  if (data?.reply) await sendChat(conn, String(data.reply));
}

// Dashboard: Song per Link eintragen (stream-tools → song_add)
export async function addSongFromWeb(url: string, by: string) {
  const id = parseVideoId(String(url ?? ""));
  if (!id) return { ok: false, error: "Das ist kein YouTube-Link." };
  const v = await lookupVideo(id);
  if (!v.ok) return { ok: false, error: v.reason === "live" ? "Livestreams gehen nicht." : "Das Video gibt es nicht oder es darf nicht eingebettet werden." };
  const { data, error } = await db.rpc("bot_song_add", { p_user_id: null, p_name: by, p_video: id, p_title: v.title, p_seconds: v.seconds, p_source: "web" });
  if (error) throw error;
  if (!data?.ok) return { ok: false, error: data?.reason === "full" ? "Die Warteschlange ist voll." : data?.reason === "dupe" ? "Der Song ist schon drin." : "Nicht eingetragen." };
  return { ok: true, position: data.position, title: v.title };
}

// ---------- Danke für Follow, Abo, Bits, Raid (twitch-eventsub) ----------
type TwitchEvent = {
  user_name?: string; user_login?: string; is_anonymous?: boolean; is_gift?: boolean; total?: number; cumulative_months?: number;
  bits?: number; from_broadcaster_user_id?: string; from_broadcaster_user_name?: string; from_broadcaster_user_login?: string; viewers?: number;
};

export async function thankEvent(type: string, event: TwitchEvent, messageId: string | null) {
  let kind = "";
  let name = event.user_name || event.user_login || "";
  let amount = 0;
  let months = 0;
  if (type === "channel.follow") kind = "follow";
  else if (type === "channel.subscribe" && !event.is_gift) kind = "sub";
  else if (type === "channel.subscription.message") { kind = "resub"; months = event.cumulative_months ?? 0; }
  else if (type === "channel.subscription.gift") { kind = "gift"; amount = event.total ?? 1; if (event.is_anonymous) name = "Anonym"; }
  else if (type === "channel.cheer") { kind = "bits"; amount = event.bits ?? 0; if (event.is_anonymous) name = "Anonym"; }
  else if (type === "channel.raid") { kind = "raid"; name = event.from_broadcaster_user_name || event.from_broadcaster_user_login || ""; amount = event.viewers ?? 0; }
  if (!kind) return;
  // Twitch stellt manchmal doppelt zu: jede Meldung nur einmal bedanken
  if (messageId) {
    const { error } = await db.from("chat_cooldowns").insert({ slot: `ev:${messageId}`.slice(0, 80) });
    if (error) return;
  }
  const { data, error } = await db.rpc("bot_event", { p_kind: kind, p_name: name.slice(0, 60), p_amount: amount, p_months: months });
  if (error || !data) return;
  const conn = await getConnection().catch(() => null);
  if (!conn) return;
  if (data.text) await sendChat(conn, String(data.text)).catch(warn("Chat"));
  if (data.shoutout && kind === "raid" && event.from_broadcaster_user_id) {
    const { data: s } = await db.from("bot_settings").select("so_text").eq("id", 1).maybeSingle();
    await shoutout(conn, "", s?.so_text ?? "", event.from_broadcaster_user_id).catch(warn("Raid-Shoutout"));
  }
}
