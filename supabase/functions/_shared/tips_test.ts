// deno test --allow-env --allow-net supabase/functions/_shared/tips_test.ts
// Trinkgeld über Ko-fi (…_tips_sponsors_pro.sql) – ohne echte Server: fetch wird abgefangen.
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("TWITCH_CLIENT_ID", "test");
Deno.env.set("TWITCH_CLIENT_SECRET", "test");

const { withChannel } = await import("./twitch.ts");
const { cents, formatMoney, handleKofi, parseKofi, thankText } = await import("./tips.ts");

const CH = "11111111-2222-3333-4444-555555555555";
const TOKEN = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
type Call = { method: string; url: URL; body: unknown };
let calls: Call[] = [];
let seen = new Set<string>();
let settings: unknown = { alert: true, thank: false, thank_text: "Danke {name} für {amount}!", min_cents: 100 };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  const text = await req.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  calls.push({ method: req.method, url, body });
  if (url.pathname === "/rest/v1/rpc/tip_kofi_check") return json((body as { p_token: string }).p_token === TOKEN ? settings : null);
  if (url.pathname === "/rest/v1/chat_cooldowns") {
    const slot = (body as { slot: string }).slot;
    if (seen.has(slot)) return json({ code: "23505", message: "duplicate key" }, 409);
    seen.add(slot);
    return new Response(null, { status: 201 });
  }
  if (url.pathname === "/realtime/v1/api/broadcast") return new Response(null, { status: 202 });
  if (url.pathname.startsWith("/rest/v1/")) return new Response(null, { status: 201 });
  return json({ error: `unerwartet: ${url}` }, 500);
}) as typeof fetch;

const kofi = (over: Record<string, unknown> = {}) => ({
  verification_token: TOKEN, message_id: "m1", kofi_transaction_id: "tx-1", type: "Donation", is_public: true,
  from_name: "Lena", message: "Weiter so!", amount: "5.00", currency: "EUR", email: "lena@example.com", ...over,
});

Deno.test("Ko-fi-Formular lesen, Beträge in Cent", () => {
  const body = new URLSearchParams({ data: JSON.stringify(kofi()) }).toString();
  assertEquals(parseKofi(body)?.from_name, "Lena");
  assertEquals(parseKofi("data=kaputt"), null);
  assertEquals(parseKofi(""), null);
  assertEquals(cents("3.50"), 350);
  assertEquals(cents("0"), 0);
  assertEquals(cents("abc"), 0);
  assert(formatMoney(350, "EUR").includes("3,50"));
  assertEquals(thankText("Danke {name} für {amount}! {message}", { name: "Lena", amount: "5,00 €", message: "" }), "Danke Lena für 5,00 €!");
});

Deno.test("Trinkgeld: Alert mit Betrag in Cent und Währung, keine E-Mail", async () => {
  calls = []; seen = new Set();
  const res = await withChannel(CH, () => handleKofi(kofi()));
  assertEquals(res, { status: 200, result: "ok" });
  const alert = calls.find((c) => c.url.pathname === "/rest/v1/stream_alerts");
  assert(alert, "kein Alert gespeichert");
  // deno-lint-ignore no-explicit-any
  const row = alert.body as any;
  assertEquals([row.kind, row.user_name, row.amount, row.tier, row.message, row.event_id], ["tip", "Lena", 500, "EUR", "Weiter so!", "kofi:tx-1"]);
  assert(!JSON.stringify(calls.map((c) => c.body)).includes("lena@example.com"), "E-Mail darf nirgends hin");
});

Deno.test("falscher Token: 401, nichts gespeichert", async () => {
  calls = []; seen = new Set();
  const res = await withChannel(CH, () => handleKofi(kofi({ verification_token: "falsch" })));
  assertEquals(res.status, 401);
  assert(!calls.some((c) => c.url.pathname === "/rest/v1/stream_alerts"));
});

Deno.test("doppelt zugestellt: nur ein Alert", async () => {
  calls = []; seen = new Set();
  await withChannel(CH, () => handleKofi(kofi()));
  const again = await withChannel(CH, () => handleKofi(kofi()));
  assertEquals(again.result, "duplicate");
  assertEquals(calls.filter((c) => c.url.pathname === "/rest/v1/stream_alerts" && c.method === "POST").length, 1);
});

Deno.test("anonym: kein Name, keine Nachricht; unter Mindestbetrag und Shop-Käufe: kein Alert", async () => {
  calls = []; seen = new Set();
  await withChannel(CH, () => handleKofi(kofi({ is_public: false, kofi_transaction_id: "tx-2" })));
  // deno-lint-ignore no-explicit-any
  const row = calls.find((c) => c.url.pathname === "/rest/v1/stream_alerts")?.body as any;
  assertEquals([row.user_name, row.message], ["Anonym", ""]);
  calls = [];
  assertEquals((await withChannel(CH, () => handleKofi(kofi({ amount: "0.50", kofi_transaction_id: "tx-3" })))).result, "below_min");
  assertEquals((await withChannel(CH, () => handleKofi(kofi({ type: "Shop Order", kofi_transaction_id: "tx-4" })))).result, "ignored");
  assert(!calls.some((c) => c.url.pathname === "/rest/v1/stream_alerts"));
});
