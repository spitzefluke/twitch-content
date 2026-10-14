// YouTube zusammen mit Twitch live schalten (Migration …_live_sync.sql, Edge Function youtube):
//   · Der Streamer verbindet einmal seinen YouTube-Kanal (Google-Login, Recht „youtube“).
//   · StreamHelp legt einen eigenen Stream-Schlüssel „StreamHelp“ an. Den trägt der Streamer in OBS als
//     zweites Ziel ein (Multistream-Plugin) – dann sendet OBS gleichzeitig an Twitch und YouTube.
//   · Geht der Twitch-Stream online (EventSub stream.online), legt StreamHelp sofort eine YouTube-Sendung
//     an (Titel von Twitch, Latenz „ultra niedrig“, startet von selbst, sobald Bild ankommt) und bindet sie
//     an den Schlüssel. Geht er offline (stream.offline), beendet StreamHelp die Sendung.
//   · Die Video-ID steht in youtube_live – das Overlay holt den YouTube-Chat damit direkt, ohne zu suchen.
//     Startet der Streamer YouTube selbst, sucht StreamHelp beim Twitch-Start die laufende Sendung.
// Ohne die Secrets GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET ist das alles aus.
import { channelKey, db, env, getAppToken, getConnection, helix } from "./twitch.ts";
import { errorText } from "./errors.ts";

const API = "https://www.googleapis.com/youtube/v3";
export const YT_SCOPE = "https://www.googleapis.com/auth/youtube";
export const STREAM_TITLE = "StreamHelp";
export const youtubeRedirectUri = () => `${env("SUPABASE_URL")}/functions/v1/youtube`;
export const youtubeConfigured = () => !!(Deno.env.get("GOOGLE_CLIENT_ID") && Deno.env.get("GOOGLE_CLIENT_SECRET"));

export class YtError extends Error {
  constructor(public status: number, public reason: string, message: string) {
    super(message);
  }
}

// Verständliche Gründe für die häufigsten Absagen von YouTube
const REASONS: Record<string, string> = {
  liveStreamingNotEnabled: "Livestreams sind für diesen YouTube-Kanal noch nicht freigeschaltet (YouTube Studio → Livestream; die Freischaltung dauert bis zu 24 Stunden).",
  insufficientLivePermissions: "Der YouTube-Kanal darf gerade nicht live gehen (YouTube Studio → Livestream prüfen).",
  quotaExceeded: "Das Tageslimit der YouTube-Schnittstelle ist erreicht – morgen geht es wieder.",
  invalid_grant: "Der Zugang zu YouTube ist abgelaufen oder wurde widerrufen – bitte YouTube neu verbinden.",
  forbidden: "YouTube hat die Anfrage abgelehnt – bitte YouTube neu verbinden und alles erlauben.",
};
export const ytReason = (e: unknown) =>
  e instanceof YtError ? (REASONS[e.reason] ?? e.message) : errorText(e);

export async function googleToken(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new YtError(res.status, data.error ?? "token", `Google-Token: ${data.error_description ?? data.error ?? res.status}`);
  return data as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
}

export async function yt(
  path: string,
  token: string,
  init: { method?: string; query?: Record<string, string>; body?: unknown } = {},
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data?.error;
    throw new YtError(res.status, err?.errors?.[0]?.reason ?? "", `YouTube ${path}: ${res.status} ${err?.message ?? ""}`.trim());
  }
  return data;
}

export type YtConnection = {
  yt_channel_id: string;
  yt_title: string;
  yt_handle: string;
  access_token: string | null;
  refresh_token: string;
  expires_at: string | null;
  stream_id: string | null;
  auto_start: boolean;
  auto_stop: boolean;
  chat_merge: boolean;
  privacy: "public" | "unlisted" | "private";
};

// Verbindung des Kanals dieser Anfrage, Zugang wenn nötig erneuert. null: nicht verbunden.
export async function getYoutube(): Promise<YtConnection | null> {
  const { data, error } = await db.from("youtube_connection").select("*").eq("id", 1).maybeSingle();
  if (error || !data) return null;
  const conn = data as YtConnection;
  if (conn.access_token && conn.expires_at && Date.parse(conn.expires_at) - Date.now() > 60_000) return conn;
  const t = await googleToken({ grant_type: "refresh_token", refresh_token: conn.refresh_token });
  const upd = {
    access_token: t.access_token,
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}),
  };
  await db.from("youtube_connection").update(upd).eq("id", 1);
  return { ...conn, ...upd };
}

type LiveRow = { video_id?: string | null; status?: string; message?: string; started_at?: string | null; ended_at?: string | null; chat_merge?: boolean };
export async function setLive(row: LiveRow) {
  const { error } = await db.from("youtube_live")
    .upsert({ id: 1, ...row, updated_at: new Date().toISOString() }, { onConflict: await channelKey("id") });
  if (error) console.warn("youtube_live:", error.message);
}
async function currentLive() {
  const { data } = await db.from("youtube_live").select("*").eq("id", 1).maybeSingle();
  return data as (LiveRow & { updated_at: string }) | null;
}

// Eigener, wiederverwendbarer Stream-Schlüssel „StreamHelp“ (einmal anlegen, dann immer derselbe)
export async function ensureStream(conn: YtConnection): Promise<string> {
  const token = conn.access_token!;
  if (conn.stream_id) {
    const r = await yt("liveStreams", token, { query: { part: "id", id: conn.stream_id } });
    if (r.items?.length) return conn.stream_id;
  }
  const list = await yt("liveStreams", token, { query: { part: "id,snippet", mine: "true", maxResults: "50" } });
  let id: string | undefined = list.items?.find((s: { snippet?: { title?: string } }) => s.snippet?.title === STREAM_TITLE)?.id;
  if (!id) {
    const created = await yt("liveStreams", token, {
      method: "POST",
      query: { part: "snippet,cdn,contentDetails" },
      body: {
        snippet: { title: STREAM_TITLE, description: "Von StreamHelp angelegt – in OBS als zweites Ziel neben Twitch eintragen." },
        cdn: { ingestionType: "rtmp", resolution: "variable", frameRate: "variable" },
        contentDetails: { isReusable: true },
      },
    });
    id = created.id as string;
  }
  await db.from("youtube_connection").update({ stream_id: id }).eq("id", 1);
  conn.stream_id = id;
  return id;
}

// Für OBS: Server und Schlüssel (nur für den Streamer, wird nirgends gespeichert)
export async function streamKey(conn: YtConnection) {
  const id = await ensureStream(conn);
  const r = await yt("liveStreams", conn.access_token!, { query: { part: "cdn,status", id } });
  const s = r.items?.[0];
  return {
    server: s?.cdn?.ingestionInfo?.ingestionAddress ?? "rtmp://a.rtmp.youtube.com/live2",
    key: s?.cdn?.ingestionInfo?.streamName ?? "",
    status: s?.status?.streamStatus ?? "inactive",
  };
}

// Titel der Sendung: der Titel des Twitch-Streams (YouTube erlaubt höchstens 100 Zeichen und kein < >)
async function twitchTitle() {
  const conn = await getConnection().catch(() => null);
  if (!conn) return { title: "Live", login: "" };
  let title = "";
  try {
    const r = await helix("channels", await getAppToken(), { query: { broadcaster_id: conn.broadcaster_id } });
    title = String(r.data?.[0]?.title ?? "");
  } catch { /* dann der Name */ }
  title = title.replace(/[<>]/g, "").trim() || `${conn.display_name} ist live`;
  return { title: title.slice(0, 100), login: conn.broadcaster_login };
}

async function twitchStillLive(): Promise<boolean> {
  const conn = await getConnection().catch(() => null);
  if (!conn) return false;
  const r = await helix("streams", await getAppToken(), { query: { user_id: conn.broadcaster_id } }).catch(() => null);
  return !!r?.data?.length;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Läuft schon eine Sendung (vom Streamer selbst gestartet)? Für den Chat im Overlay.
async function findRunning(conn: YtConnection, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const r = await yt("liveBroadcasts", conn.access_token!, { query: { part: "id,status", broadcastStatus: "active", broadcastType: "all", maxResults: "5" } });
    const b = r.items?.[0];
    if (b?.id) {
      await setLive({ video_id: b.id, status: "live", message: "", started_at: new Date().toISOString(), ended_at: null, chat_merge: conn.chat_merge });
      return b.id as string;
    }
    if (i < tries - 1) await wait(15_000);
  }
  return null;
}

// Twitch ist online gegangen (oder „Jetzt starten“ im Dashboard)
export async function youtubeOnline({ force = false } = {}) {
  let conn: YtConnection | null = null;
  try {
    conn = await getYoutube();
    if (!conn) return { ok: false, reason: "not_connected" };
    if (!conn.auto_start && !force) {
      if (conn.chat_merge) await findRunning(conn);
      return { ok: true, started: false };
    }
    const token = conn.access_token!;
    // Läuft schon eine Sendung von StreamHelp (Twitch schickt manchmal doppelt)? Dann die nehmen.
    const cur = await currentLive();
    if (cur?.video_id && ["starting", "live"].includes(cur.status ?? "")) {
      const b = await yt("liveBroadcasts", token, { query: { part: "status", id: cur.video_id } }).catch(() => null);
      const life = b?.items?.[0]?.status?.lifeCycleStatus;
      if (life && !["complete", "revoked"].includes(life)) return { ok: true, started: false, video_id: cur.video_id };
    }
    const streamId = await ensureStream(conn);
    const { title, login } = await twitchTitle();
    const broadcast = await yt("liveBroadcasts", token, {
      method: "POST",
      query: { part: "snippet,status,contentDetails" },
      body: {
        snippet: {
          title,
          description: login ? `Gleichzeitig live auf Twitch: https://twitch.tv/${login}` : "",
          scheduledStartTime: new Date().toISOString(),
        },
        status: { privacyStatus: conn.privacy, selfDeclaredMadeForKids: false },
        contentDetails: {
          enableAutoStart: true, enableAutoStop: true, enableDvr: true,
          latencyPreference: "ultraLow", monitorStream: { enableMonitorStream: false },
        },
      },
    });
    await yt("liveBroadcasts/bind", token, { method: "POST", query: { part: "id,contentDetails", id: broadcast.id, streamId } });
    await setLive({ video_id: broadcast.id, status: "starting", message: "", started_at: new Date().toISOString(), ended_at: null, chat_merge: conn.chat_merge });
    // Kommt das Bild aus OBS schon an? Dann sofort live – sonst startet YouTube von selbst, sobald es ankommt.
    try {
      const s = await yt("liveStreams", token, { query: { part: "status", id: streamId } });
      if (s.items?.[0]?.status?.streamStatus === "active") {
        await yt("liveBroadcasts/transition", token, { method: "POST", query: { part: "status", id: broadcast.id, broadcastStatus: "live" } });
        await setLive({ status: "live" });
      }
    } catch (e) {
      console.info("YouTube startet von selbst, sobald Bild ankommt:", errorText(e));
    }
    return { ok: true, started: true, video_id: broadcast.id as string };
  } catch (e) {
    console.warn("YouTube-Start fehlgeschlagen:", e);
    await setLive({ status: "error", message: ytReason(e).slice(0, 300), chat_merge: conn?.chat_merge ?? true });
    return { ok: false, reason: ytReason(e) };
  }
}

// Twitch ist offline gegangen (oder „Jetzt beenden“ im Dashboard). Kurze Aussetzer überbrücken:
// erst nach 20 Sekunden nachsehen, ob Twitch wirklich aus ist.
export async function youtubeOffline({ force = false, graceMs = 20_000 } = {}) {
  try {
    const conn = await getYoutube();
    if (!conn) return { ok: false, reason: "not_connected" };
    const cur = await currentLive();
    if (!cur?.video_id || !["starting", "live"].includes(cur.status ?? "")) return { ok: true, ended: false };
    if (!conn.auto_stop && !force) return { ok: true, ended: false };
    if (!force && graceMs > 0) {
      await wait(graceMs);
      if (await twitchStillLive()) return { ok: true, ended: false, reason: "twitch_back" };
    }
    try {
      await yt("liveBroadcasts/transition", conn.access_token!, { method: "POST", query: { part: "status", id: cur.video_id, broadcastStatus: "complete" } });
    } catch (e) {
      // Noch nicht live (nie Bild bekommen) oder schon beendet: dann einfach löschen bzw. so lassen
      if (e instanceof YtError && /invalidTransition|redundantTransition/.test(e.reason)) {
        const b = await yt("liveBroadcasts", conn.access_token!, { query: { part: "status", id: cur.video_id } }).catch(() => null);
        const life = b?.items?.[0]?.status?.lifeCycleStatus;
        if (life && ["created", "ready", "testStarting", "testing"].includes(life)) {
          await yt("liveBroadcasts", conn.access_token!, { method: "DELETE", query: { id: cur.video_id } }).catch(() => null);
        }
      } else throw e;
    }
    await setLive({ status: "ended", ended_at: new Date().toISOString(), message: "" });
    return { ok: true, ended: true };
  } catch (e) {
    console.warn("YouTube-Ende fehlgeschlagen:", e);
    await setLive({ status: "error", message: ytReason(e).slice(0, 300) });
    return { ok: false, reason: ytReason(e) };
  }
}
