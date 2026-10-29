// deno test --allow-env --allow-net supabase/functions/_shared/raids_test.ts
// Raid-Netzwerk (…_raid_network.sql) – ohne echte Server: fetch wird abgefangen, jede Anfrage landet in calls.
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("TWITCH_CLIENT_ID", "test");
Deno.env.set("TWITCH_CLIENT_SECRET", "test");

const { withChannel } = await import("./twitch.ts");
const { cancelRaid, raidText, RAID_SCOPE, startRaid } = await import("./raids.ts");

const CH = "11111111-2222-3333-4444-555555555555";
type Call = { method: string; url: URL; body: unknown };
let calls: Call[] = [];
let scopes: string[] = [RAID_SCOPE];
let raidStatus = 200;
let targetError: string | null = null;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  const text = await req.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  calls.push({ method: req.method, url, body });
  if (url.pathname === "/rest/v1/twitch_connection") {
    return json({ broadcaster_id: "1001", broadcaster_login: "lena", display_name: "Lena", access_token: "user-token", refresh_token: "r",
      expires_at: new Date(Date.now() + 3600_000).toISOString(), scopes });
  }
  if (url.pathname === "/rest/v1/rpc/raid_target") {
    if (targetError) return json({ message: targetError, code: "P0001" }, 400);
    return json({ id: "22222222-0000-0000-0000-000000000002", twitch_id: "2002", login: "ben", display_name: "Ben", announce: false, raid_text: "Auf zu {target}!" });
  }
  if (url.pathname.startsWith("/rest/v1/rpc/")) return json(null);
  if (url.hostname === "api.twitch.tv" && url.pathname === "/helix/raids") {
    return raidStatus === 200 ? json({ data: [{ created_at: "2026-01-01T00:00:00Z", is_mature: false }] }) : json({ message: "nope" }, raidStatus);
  }
  return json({ error: `unerwartet: ${url}` }, 500);
}) as typeof fetch;

Deno.test("Ansage-Text: Ziel und Link", () => {
  assertEquals(raidText("Auf zu {target} ({link})!", { display_name: "Ben", login: "ben" }), "Auf zu Ben (twitch.tv/ben)!");
});

Deno.test("Raid: Twitch-Aufruf mit beiden Kanälen, danach gemerkt", async () => {
  calls = []; scopes = [RAID_SCOPE]; raidStatus = 200; targetError = null;
  const res = await withChannel(CH, () => startRaid("ben"));
  assertEquals(res, { ok: true, target: "Ben" });
  const raid = calls.find((c) => c.url.pathname === "/helix/raids");
  assert(raid, "kein Raid bei Twitch");
  assertEquals(raid.method, "POST");
  assertEquals(raid.url.searchParams.get("from_broadcaster_id"), "1001");
  assertEquals(raid.url.searchParams.get("to_broadcaster_id"), "2002");
  assert(calls.some((c) => c.url.pathname === "/rest/v1/rpc/raid_logged"), "Raid nicht gemerkt");
});

Deno.test("ohne Twitch-Recht: Hinweis zum Neu-Verbinden, kein Raid", async () => {
  calls = []; scopes = ["channel:bot"];
  const res = await withChannel(CH, () => startRaid("ben"));
  assertEquals(res.ok, false);
  assert(!res.ok && res.reconnect);
  assert(!calls.some((c) => c.url.pathname === "/helix/raids"));
  scopes = [RAID_SCOPE];
});

Deno.test("Datenbank lehnt ab (nicht im Netzwerk/offline): Text kommt an, kein Raid", async () => {
  calls = []; targetError = "Dieser Kanal ist gerade nicht live.";
  const res = await withChannel(CH, () => startRaid("ben"));
  assertEquals(res, { ok: false, error: "Dieser Kanal ist gerade nicht live." });
  assert(!calls.some((c) => c.url.pathname === "/helix/raids"));
  targetError = null;
});

Deno.test("Twitch 409: es läuft schon ein Raid – nichts gemerkt", async () => {
  calls = []; raidStatus = 409;
  const res = await withChannel(CH, () => startRaid("ben"));
  assertEquals(res, { ok: false, error: "Es läuft schon ein Raid." });
  assert(!calls.some((c) => c.url.pathname === "/rest/v1/rpc/raid_logged"));
  raidStatus = 200;
});

Deno.test("Raid abbrechen", async () => {
  calls = [];
  const res = await withChannel(CH, () => cancelRaid());
  assertEquals(res.ok, true);
  const del = calls.find((c) => c.url.pathname === "/helix/raids");
  assertEquals(del?.method, "DELETE");
  assertEquals(del?.url.searchParams.get("broadcaster_id"), "1001");
});
