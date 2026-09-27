// YouTube-Livechat ohne API-Schlüssel: so, wie ihn auch das Chat-Fenster auf youtube.com lädt.
//   1. youtube.com/@kanal/live → läuft gerade ein Stream? Dann steht dort seine Video-ID.
//   2. youtube.com/live_chat?v=… → Startpunkt („continuation“) für den Chat „Livechat“ (alle Nachrichten)
//   3. youtubei/v1/live_chat/get_live_chat → neue Nachrichten und der nächste Startpunkt
// Inoffiziell: Ändert YouTube das Format, muss das hier angepasst werden.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
// SOCS=CAI: ohne Einwilligungsseite (sonst leitet YouTube in der EU auf consent.youtube.com um)
const HEADERS = { "User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9,en;q=0.8", Cookie: "SOCS=CAI; CONSENT=YES+1" };

export const CHANNEL_RE = /^(@[A-Za-z0-9._-]{3,30}|UC[A-Za-z0-9_-]{22})$/;
export const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;
export const CONTINUATION_RE = /^[A-Za-z0-9%_=-]{10,3000}$/;
const VERSION_RE = /^[0-9.]{5,30}$/;
const KEY_RE = /^[A-Za-z0-9_-]{20,60}$/;

export type ChatPart = { text: string } | { emoji: string; name: string };
export type ChatMessage = {
  id: string;
  name: string;
  channelId: string;
  badges: string[]; // owner, moderator, member, verified
  parts: ChatPart[];
  kind: "text" | "paid" | "member" | "sticker";
  paid?: string;
};

// Ein JSON-Objekt aus einer Seite holen, das hinter „name =“ steht (Klammern zählen, Strings beachten)
export function extractJson(html: string, name: string): any | null {
  const at = html.search(new RegExp(`${name}"?\\]?\\s*=\\s*\\{`));
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  let depth = 0;
  let inStr = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

// Seite „/live“ des Kanals: Video-ID, wenn gerade live
export function liveVideoFromPage(html: string): string | null {
  const id = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/.exec(html)?.[1]
    ?? /"videoDetails":\{"videoId":"([A-Za-z0-9_-]{11})"/.exec(html)?.[1];
  if (!id) return null;
  return /"isLiveNow":true/.test(html) || /"isLive":true/.test(html) ? id : null;
}

// Chat-Seite: Startpunkt für „Livechat“ (nicht „Top-Chat“) und die Client-Version
export function chatStartFromPage(html: string) {
  const data = extractJson(html, "ytInitialData");
  const chat = data?.contents?.liveChatRenderer;
  if (!chat) return null;
  const items = chat.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems ?? [];
  const all = items.at(-1)?.continuation?.reloadContinuationData?.continuation;
  const continuation = all ?? continuationOf(chat.continuations);
  const clientVersion = /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([0-9.]+)"/.exec(html)?.[1]
    ?? /"clientVersion":"([0-9.]+)"/.exec(html)?.[1] ?? "2.20240101.00.00";
  const apiKey = /"INNERTUBE_API_KEY":"([A-Za-z0-9_-]+)"/.exec(html)?.[1] ?? null;
  return continuation ? { continuation, clientVersion, apiKey } : null;
}

function continuationOf(list: any[] | undefined): string | null {
  const c = list?.[0];
  const d = c?.invalidationContinuationData ?? c?.timedContinuationData ?? c?.reloadContinuationData;
  return d?.continuation ?? null;
}

const text = (t: any): string => t?.simpleText ?? (t?.runs ?? []).map((r: any) => r.text ?? "").join("");

function parts(runs: any[] | undefined): ChatPart[] {
  const out: ChatPart[] = [];
  for (const r of runs ?? []) {
    if (typeof r.text === "string") out.push({ text: r.text });
    else if (r.emoji) {
      const name = r.emoji.shortcuts?.[0] ?? r.emoji.searchTerms?.[0] ?? "";
      const url: string | undefined = r.emoji.image?.thumbnails?.at(-1)?.url;
      // Normale Emojis (😀) als Text, eigene Kanal-Emojis als Bild
      if (!r.emoji.isCustomEmoji && r.emoji.emojiId && !/^UC/.test(r.emoji.emojiId)) out.push({ text: r.emoji.emojiId });
      else if (url && /^https:\/\/[a-z0-9.-]+\.(ggpht|googleusercontent|ytimg|youtube)\.com\//.test(url)) out.push({ emoji: url, name });
      else out.push({ text: name });
    }
  }
  return out;
}

function badges(list: any[] | undefined): string[] {
  const out = new Set<string>();
  for (const b of list ?? []) {
    const r = b.liveChatAuthorBadgeRenderer;
    const icon = r?.icon?.iconType;
    if (icon === "OWNER") out.add("owner");
    else if (icon === "MODERATOR") out.add("moderator");
    else if (icon === "VERIFIED") out.add("verified");
    else if (r?.customThumbnail) out.add("member");
  }
  return [...out];
}

function message(item: any): ChatMessage | null {
  const [type, r] = Object.entries(item ?? {})[0] ?? [];
  if (!r || typeof r !== "object") return null;
  const m = r as any;
  const base = {
    id: String(m.id ?? ""),
    name: text(m.authorName).replace(/^@/, "").slice(0, 60) || "YouTube",
    channelId: String(m.authorExternalChannelId ?? ""),
    badges: badges(m.authorBadges),
  };
  if (type === "liveChatTextMessageRenderer") return { ...base, kind: "text", parts: parts(m.message?.runs) };
  if (type === "liveChatPaidMessageRenderer") {
    return { ...base, kind: "paid", paid: text(m.purchaseAmountText), parts: parts(m.message?.runs) };
  }
  if (type === "liveChatPaidStickerRenderer") return { ...base, kind: "sticker", paid: text(m.purchaseAmountText), parts: [] };
  if (type === "liveChatMembershipItemRenderer") {
    const sub = text(m.headerSubtext) || "ist jetzt Mitglied";
    return { ...base, kind: "member", parts: [{ text: sub }, ...parts(m.message?.runs)] };
  }
  return null;
}

// Antwort von get_live_chat → Nachrichten, Löschungen, nächster Startpunkt
export function parseChatResponse(data: any) {
  const live = data?.continuationContents?.liveChatContinuation;
  if (!live) return { ended: true as const };
  const c = live.continuations?.[0];
  const d = c?.invalidationContinuationData ?? c?.timedContinuationData ?? c?.reloadContinuationData;
  const messages: ChatMessage[] = [];
  const removed: string[] = [];
  const removedAuthors: string[] = [];
  for (const a of live.actions ?? []) {
    if (a.addChatItemAction) {
      const m = message(a.addChatItemAction.item);
      if (m && m.id) messages.push(m);
    } else if (a.markChatItemAsDeletedAction) removed.push(String(a.markChatItemAsDeletedAction.targetItemId ?? ""));
    else if (a.markChatItemsByAuthorAsDeletedAction) removedAuthors.push(String(a.markChatItemsByAuthorAsDeletedAction.externalChannelId ?? ""));
  }
  return {
    ended: false as const,
    messages, removed, removedAuthors,
    continuation: d?.continuation ?? null,
    timeoutMs: Math.min(10_000, Math.max(1_500, Number(d?.timeoutMs) || 4_000)),
  };
}

async function page(url: string) {
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`YouTube ${res.status}`);
  return await res.text();
}

// Läuft der Kanal gerade? Dann Video-ID und Startpunkt des Chats
export async function startChat(channel: string) {
  const path = channel.startsWith("@") ? channel : `channel/${channel}`;
  const videoId = liveVideoFromPage(await page(`https://www.youtube.com/${path}/live`));
  if (!videoId) return { live: false as const };
  const start = chatStartFromPage(await page(`https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`));
  if (!start) return { live: false as const };
  return { live: true as const, videoId, ...start };
}

export async function pollChat(continuation: string, clientVersion: string, apiKey: string | null) {
  if (!CONTINUATION_RE.test(continuation)) throw new Error("Ungültiger Startpunkt");
  const version = VERSION_RE.test(clientVersion) ? clientVersion : "2.20240101.00.00";
  const key = apiKey && KEY_RE.test(apiKey) ? `&key=${apiKey}` : "";
  const res = await fetch(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false${key}`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: version, hl: "de", gl: "DE" } }, continuation }),
  });
  if (!res.ok) throw new Error(`YouTube ${res.status}`);
  return parseChatResponse(await res.json());
}
