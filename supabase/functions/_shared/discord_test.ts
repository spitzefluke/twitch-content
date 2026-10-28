// deno test --allow-env --allow-net supabase/functions/_shared/discord_test.ts
// Discord-Nachrichten (…_discord.sql) – ohne echte Server: fetch wird abgefangen, jede Anfrage landet in calls.
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("TWITCH_CLIENT_ID", "test");
Deno.env.set("TWITCH_CLIENT_SECRET", "test");

const { withChannel } = await import("./twitch.ts");
const { discordAnnounce, fillLiveText, inspectWebhook, livePayload, mentionOf, postDiscord, recapPayload, WEBHOOK_RE } = await import("./discord.ts");

const HOOK = "https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz_-1234";
const CH = "11111111-2222-3333-4444-555555555555";
type Call = { method: string; url: URL; body: unknown };
let calls: Call[] = [];
let rpc: Record<string, unknown> = {};
let discordStatus = 204;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  const text = await req.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  calls.push({ method: req.method, url, body });
  if (url.pathname.startsWith("/rest/v1/rpc/")) return json(rpc[url.pathname.slice("/rest/v1/rpc/".length)] ?? null);
  if (url.hostname === "discord.com") {
    if (req.method === "GET") return discordStatus === 404 ? json({ message: "Unknown Webhook" }, 404) : json({ name: "Ankündigungen", token: "geheim" });
    return new Response(null, { status: discordStatus });
  }
  return json({ error: `unerwartet: ${url}` }, 500);
}) as typeof fetch;

const T = { url: HOOK, live_text: "🔴 {streamer} ist jetzt live: {title}", mention: "", login: "lena_live", display_name: "Lena" };

Deno.test("nur echte Discord-Webhooks", () => {
  assert(WEBHOOK_RE.test(HOOK));
  assert(WEBHOOK_RE.test("https://canary.discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz"));
  assert(!WEBHOOK_RE.test("https://discord.com.evil.example/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz"));
  assert(!WEBHOOK_RE.test("http://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz"));
  assert(!WEBHOOK_RE.test(`${HOOK}/../../users/@me`));
});

Deno.test("fremde Adresse wird nie angefragt", async () => {
  calls = [];
  const res = await postDiscord("https://evil.example/api/webhooks/1/x", { allowed_mentions: { parse: [] } });
  assertEquals(res.ok, false);
  assertEquals(calls.length, 0);
});

Deno.test("Erwähnungen pingen nur, was eingestellt ist", () => {
  assertEquals(mentionOf(""), { text: "", allowed: { parse: [] } });
  assertEquals(mentionOf("here").allowed, { parse: ["everyone"] });
  assertEquals(mentionOf("123456789"), { text: "<@&123456789> ", allowed: { parse: [], roles: ["123456789"] } });
  // ein @everyone im Titel pingt ohne Einstellung niemanden
  const p = livePayload({ ...T }, { title: "@everyone kommt rein", game: "" });
  assertEquals(p.allowed_mentions, { parse: [] });
});

Deno.test("Live-Text: Platzhalter, leerer Titel am Ende", () => {
  assertEquals(fillLiveText("{streamer} spielt {game}: {title}", { streamer: "Lena", game: "Tetris", title: "", link: "" }), "Lena spielt Tetris");
  const p = livePayload({ ...T, mention: "here" }, { title: "Ranked", game: "Valorant" }, Date.UTC(2026, 0, 1));
  assertEquals(p.content, "@here 🔴 Lena ist jetzt live: Ranked");
  assertEquals(p.embeds?.[0].url, "https://twitch.tv/lena_live");
  assert(p.embeds?.[0].image?.url.startsWith("https://static-cdn.jtvnw.net/previews-ttv/live_user_lena_live-1280x720.jpg"));
});

Deno.test("Rückblick: nur Zahlen, die es gab", () => {
  const p = recapPayload(T, { started_at: "2026-01-01T18:00:00Z", ended_at: "2026-01-01T21:30:00Z", game: "Tetris", peak: 40, avg: 25, follows: 3, subs: 0, bits: 0, chatters: 12 });
  const names = p.embeds?.[0].fields?.map((f) => f.name) ?? [];
  assert(names.includes("💜 Neue Follower"));
  assert(!names.includes("⭐ Abos"));
  assert(p.embeds?.[0].fields?.[0].value.startsWith("3"));
});

Deno.test("Webhook prüfen: Name von Discord, nie der Token", async () => {
  discordStatus = 204;
  const ok = await inspectWebhook(HOOK);
  assertEquals(ok, { ok: true, name: "Ankündigungen" });
  discordStatus = 404;
  const gone = await inspectWebhook(HOOK);
  assertEquals(gone.ok, false);
  discordStatus = 204;
});

Deno.test("Ankündigung: Termin automatisch nur einmal", async () => {
  rpc = {
    discord_target: T,
    discord_announce_data: { upcoming: [], tz: "Europe/Berlin", ideas: [{ id: "horror", title: "Horror-Nacht", description: "", target_at: "2030-01-01T18:00:00Z" }] },
    discord_idea_claim: true,
  };
  calls = [];
  const first = await withChannel(CH, () => discordAnnounce("idea", "horror", true));
  assertEquals(first, { ok: true });
  const post = calls.find((c) => c.url.hostname === "discord.com");
  // deno-lint-ignore no-explicit-any
  assert((post?.body as any).embeds[0].description.includes("<t:1893520800:F>"));
  assert(calls.some((c) => c.url.pathname.endsWith("/discord_mark")));
  rpc.discord_idea_claim = false;
  calls = [];
  const again = await withChannel(CH, () => discordAnnounce("idea", "horror", true));
  assertEquals(again.skipped, true);
  assert(!calls.some((c) => c.url.hostname === "discord.com"));
});

Deno.test("Ankündigung ohne Webhook: Hinweis statt Fehler", async () => {
  rpc = { discord_target: null };
  const res = await withChannel(CH, () => discordAnnounce("schedule"));
  assertEquals(res.ok, false);
  const auto = await withChannel(CH, () => discordAnnounce("idea", "x", true));
  assertEquals(auto.skipped, true);
});
