// deno test --allow-env --allow-net supabase/functions/_shared/sponsoring_test.ts
// Sponsoring-Börse (…_sponsoring.sql) – ohne echte Server: fetch wird abgefangen.
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("TWITCH_CLIENT_ID", "test");
Deno.env.set("TWITCH_CLIENT_SECRET", "test");

const { friendly, hashToken, newToken, offerFields, parseLogo, submitOffer, TOKEN_RE } = await import("./sponsoring.ts");

type Call = { method: string; url: URL; body: unknown };
let calls: Call[] = [];
let rpcError: string | null = null;
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  const text = url.pathname.startsWith("/storage/") ? "" : await req.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  calls.push({ method: req.method, url, body });
  if (url.pathname.startsWith("/storage/v1/object/")) return new Response(JSON.stringify({ Key: "ok" }), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.pathname === "/rest/v1/rpc/sponsoring_submit") {
    return rpcError ? new Response(JSON.stringify({ message: rpcError, code: "23514" }), { status: 400, headers: { "Content-Type": "application/json" } })
      : new Response(JSON.stringify((body as { p_id: string }).p_id), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: `unerwartet: ${url}` }), { status: 500 });
}) as typeof fetch;

const PNG = "data:image/png;base64," + btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82));
const offer = { company: "GamerFuel", contact_email: "deals@gamerfuel.example", title: "Energy-Partner", description: "Wir suchen Streamer.", min_viewers: "5", max_viewers: "", slots: "3" };

Deno.test("Schlüssel: zufällig, 64 Zeichen; gespeichert wird nur der Hash", async () => {
  const t = newToken();
  assert(TOKEN_RE.test(t));
  assert(t !== newToken());
  const h = await hashToken(t);
  assert(TOKEN_RE.test(h) && h !== t);
  assertEquals(await hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

Deno.test("Logo: nur echte PNG/JPG/WebP bis 1 MB", () => {
  assertEquals(parseLogo(""), null);
  const ok = parseLogo(PNG);
  assert(ok && !("error" in ok) && ok.ext === "png");
  assert("error" in (parseLogo("data:image/svg+xml;base64,PHN2Zz4=") ?? {}), "SVG abgelehnt");
  assert("error" in (parseLogo("data:image/png;base64," + btoa("GIF89a-nicht-png")) ?? {}), "falscher Dateikopf abgelehnt");
  assert("error" in (parseLogo("data:image/png;base64," + "A".repeat(1_500_000)) ?? {}), "zu groß abgelehnt");
});

Deno.test("Formular-Felder: Zahlen, Datum, Zahlungsart", () => {
  const f = offerFields({ ...offer, pay_mode: "irgendwas", ends_on: "morgen", every_min: "abc", amount_cents: "" });
  assertEquals([f.pay_mode, f.ends_on, f.every_min, f.amount_cents, f.max_viewers], ["direct", "", "15", "", ""]);
  assertEquals(offerFields({ ...offer, pay_mode: "streamhelp", ends_on: "2030-01-31" }).ends_on, "2030-01-31");
});

Deno.test("Einreichen: Logo hochladen, dann Angebot mit Hash speichern", async () => {
  calls = []; rpcError = null;
  const res = await submitOffer(offer, PNG);
  assertEquals(res.status, 200);
  // deno-lint-ignore no-explicit-any
  const b = res.body as any;
  assert(TOKEN_RE.test(b.token));
  const rpc = calls.find((c) => c.url.pathname === "/rest/v1/rpc/sponsoring_submit");
  // deno-lint-ignore no-explicit-any
  const args = rpc?.body as any;
  assertEquals(args.p_token_hash, await hashToken(b.token));
  assert(!JSON.stringify(args).includes(b.token), "der Schlüssel selbst geht nie in die Datenbank");
  assertEquals(args.p_logo, `${b.id}.png`);
  assert(calls.some((c) => c.url.pathname.includes(`/sponsor-assets/${b.id}.png`)), "Logo hochgeladen");
});

Deno.test("Datenbank lehnt ab: Logo wird wieder gelöscht, Fehler verständlich", async () => {
  calls = []; rpcError = 'new row violates check constraint "sponsor_offers_contact_email_check"';
  const res = await submitOffer(offer, PNG);
  assertEquals(res.status, 400);
  assertEquals((res.body as { error: string }).error, "Bitte eine gültige E-Mail-Adresse angeben.");
  assert(calls.some((c) => c.method === "DELETE" && c.url.pathname.includes("/sponsor-assets")), "Logo entfernt");
  rpcError = null;
  assertEquals(friendly("x out of range y"), "Bitte die Zahlen und das Datum prüfen.");
});
