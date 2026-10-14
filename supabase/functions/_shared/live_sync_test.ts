// deno test --allow-env --allow-net supabase/functions/_shared/live_sync_test.ts
// Sofort-Alerts (Realtime-Broadcast) und YouTube mit Twitch live schalten – ohne echte Server:
// fetch wird abgefangen, jede Anfrage landet in calls.
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("TWITCH_CLIENT_ID", "test");
Deno.env.set("TWITCH_CLIENT_SECRET", "test");
Deno.env.set("GOOGLE_CLIENT_ID", "g-id");
Deno.env.set("GOOGLE_CLIENT_SECRET", "g-secret");

const { withChannel } = await import("./twitch.ts");
const { saveAlert, alertTopic } = await import("./alerts.ts");
const { youtubeOnline, youtubeOffline } = await import("./ytlive.ts");

type Call = { method: string; url: URL; body: unknown; headers: Headers };
let calls: Call[] = [];
let tables: Record<string, unknown> = {};
let ytStreamStatus = "active";
const CH = "11111111-2222-3333-4444-555555555555";
const future = () => new Date(Date.now() + 3600_000).toISOString();

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  const text = await req.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  calls.push({ method: req.method, url, body, headers: req.headers });
  // Realtime-Broadcast
  if (url.pathname === "/realtime/v1/api/broadcast") return new Response(null, { status: 202 });
  // PostgREST
  if (url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length);
    if (req.method === "GET") return json(tables[table] ?? null);
    return new Response(null, { status: 201 });
  }
  // Twitch
  if (url.hostname === "id.twitch.tv") return json({ access_token: "app", expires_in: 3600 });
  if (url.hostname === "api.twitch.tv" && url.pathname.endsWith("/channels")) return json({ data: [{ title: "Ranked <heute> mit Chat" }] });
  if (url.hostname === "api.twitch.tv" && url.pathname.endsWith("/streams")) return json({ data: [] });
  // YouTube
  if (url.hostname === "www.googleapis.com") {
    const p = url.pathname.replace("/youtube/v3/", "");
    if (p === "liveStreams" && req.method === "GET" && url.searchParams.get("part") === "status") {
      return json({ items: [{ id: "stream1", status: { streamStatus: ytStreamStatus } }] });
    }
    if (p === "liveStreams" && req.method === "GET") return json({ items: [{ id: "stream1", snippet: { title: "StreamHelp" } }] });
    if (p === "liveBroadcasts" && req.method === "POST") return json({ id: "abcdefghijk" });
    if (p === "liveBroadcasts" && req.method === "GET") return json({ items: [{ id: "abcdefghijk", status: { lifeCycleStatus: "live" } }] });
    if (p.startsWith("liveBroadcasts/")) return json({ id: "abcdefghijk" });
  }
  return json({ error: `unerwartet: ${url}` }, 500);
}) as typeof fetch;

Deno.test("Alert geht sofort per Broadcast raus und landet in der Tabelle", async () => {
  calls = [];
  await withChannel(CH, () => saveAlert({ kind: "follow", user_name: "Lena" }, "msg-1"));
  const bc = calls.find((c) => c.url.pathname === "/realtime/v1/api/broadcast");
  assert(bc, "kein Broadcast");
  assertEquals(bc.headers.get("apikey"), "test-service-key");
  // deno-lint-ignore no-explicit-any
  const m = (bc.body as any).messages[0];
  assertEquals(m.topic, `alerts:${CH}`);
  assertEquals(m.private, true);
  assertEquals(m.payload.event_id, "msg-1");
  assertEquals(m.payload.user_name, "Lena");
  assert(m.payload.created_at);
  const up = calls.find((c) => c.url.pathname === "/rest/v1/stream_alerts" && c.method === "POST");
  assert(up, "nicht gespeichert");
  assertEquals(up.headers.get("x-channel"), CH);
});

Deno.test("ohne Event-ID kein Broadcast (nur Tabelle)", async () => {
  calls = [];
  await withChannel(CH, () => saveAlert({ kind: "follow", user_name: "Lena" }, null));
  assert(!calls.some((c) => c.url.pathname === "/realtime/v1/api/broadcast"));
  assertEquals(alertTopic(null), "alerts:default");
});

const conn = (over: Record<string, unknown> = {}) => ({
  yt_channel_id: "UC1", yt_title: "Kanal", yt_handle: "@kanal", access_token: "yt-token", refresh_token: "r", expires_at: future(),
  stream_id: "stream1", auto_start: true, auto_stop: true, chat_merge: true, privacy: "unlisted", ...over,
});
const twitch = { broadcaster_id: "42", broadcaster_login: "lena", display_name: "Lena", access_token: "t", refresh_token: "r", expires_at: future() };

Deno.test("Twitch online → YouTube-Sendung (ultraLow), gebunden, sofort live", async () => {
  calls = [];
  ytStreamStatus = "active";
  tables = { youtube_connection: conn(), youtube_live: null, twitch_connection: twitch };
  const r = await withChannel(CH, () => youtubeOnline());
  assertEquals(r.ok, true);
  assertEquals(r.video_id, "abcdefghijk");
  const insert = calls.find((c) => c.url.pathname.endsWith("/liveBroadcasts") && c.method === "POST");
  // deno-lint-ignore no-explicit-any
  const b = insert!.body as any;
  assertEquals(b.contentDetails.latencyPreference, "ultraLow");
  assertEquals(b.contentDetails.enableAutoStart, true);
  assertEquals(b.status.privacyStatus, "unlisted");
  assertEquals(b.snippet.title, "Ranked heute mit Chat"); // ohne < >
  const bind = calls.find((c) => c.url.pathname.endsWith("/liveBroadcasts/bind"));
  assertEquals(bind?.url.searchParams.get("streamId"), "stream1");
  const tr = calls.find((c) => c.url.pathname.endsWith("/liveBroadcasts/transition"));
  assertEquals(tr?.url.searchParams.get("broadcastStatus"), "live");
  // Video-ID für den Chat im Overlay
  const live = calls.filter((c) => c.url.pathname === "/rest/v1/youtube_live" && c.method === "POST");
  // deno-lint-ignore no-explicit-any
  assert(live.some((c) => (c.body as any).video_id === "abcdefghijk"));
});

Deno.test("Kommt noch kein Bild an: Sendung wartet auf Auto-Start (kein Umschalten)", async () => {
  calls = [];
  ytStreamStatus = "inactive";
  tables = { youtube_connection: conn(), youtube_live: null, twitch_connection: twitch };
  await withChannel(CH, () => youtubeOnline());
  assert(!calls.some((c) => c.url.pathname.endsWith("/liveBroadcasts/transition")));
});

Deno.test("Auto-Start aus: keine neue Sendung", async () => {
  calls = [];
  tables = { youtube_connection: conn({ auto_start: false, chat_merge: false }), youtube_live: null, twitch_connection: twitch };
  const r = await withChannel(CH, () => youtubeOnline());
  assertEquals(r.started, false);
  assert(!calls.some((c) => c.url.hostname === "www.googleapis.com" && c.method === "POST"));
});

Deno.test("Twitch offline → YouTube-Sendung beenden", async () => {
  calls = [];
  tables = { youtube_connection: conn(), youtube_live: { video_id: "abcdefghijk", status: "live" }, twitch_connection: twitch };
  const r = await withChannel(CH, () => youtubeOffline({ graceMs: 0 }));
  assertEquals(r.ended, true);
  const tr = calls.find((c) => c.url.pathname.endsWith("/liveBroadcasts/transition"));
  assertEquals(tr?.url.searchParams.get("broadcastStatus"), "complete");
});

Deno.test("Auto-Stop aus: YouTube läuft weiter", async () => {
  calls = [];
  tables = { youtube_connection: conn({ auto_stop: false }), youtube_live: { video_id: "abcdefghijk", status: "live" }, twitch_connection: twitch };
  const r = await withChannel(CH, () => youtubeOffline({ graceMs: 0 }));
  assertEquals(r.ended, false);
  assert(!calls.some((c) => c.url.pathname.endsWith("/liveBroadcasts/transition")));
});

Deno.test("nicht verbunden: nichts passiert", async () => {
  calls = [];
  tables = { youtube_connection: null };
  const r = await withChannel(CH, () => youtubeOnline());
  assertEquals(r.ok, false);
  assert(!calls.some((c) => c.url.hostname === "www.googleapis.com"));
});
