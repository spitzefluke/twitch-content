// deno test --allow-env --allow-net supabase/functions/admin/admin_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("ADMIN_PASSWORD", "richtiges-passwort-123");
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("TWITCH_CLIENT_ID", "test");
Deno.env.set("TWITCH_CLIENT_SECRET", "test");

let handler!: (req: Request) => Promise<Response>;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: typeof handler) => { handler = h; return {}; };
const { createToken, verifyToken, passwordMatches } = await import("./index.ts");

Deno.test("Passwortvergleich", async () => {
  assert(await passwordMatches("richtiges-passwort-123"));
  assert(!(await passwordMatches("richtiges-passwort-12")));
  assert(!(await passwordMatches("")));
  assert(!(await passwordMatches(undefined)));
});

Deno.test("gültiges Token wird akzeptiert", async () => {
  const { token } = await createToken();
  assert(await verifyToken(token));
});

Deno.test("manipuliertes Token wird abgelehnt", async () => {
  const { token } = await createToken();
  const [payload, sig] = token.split(".");
  const forged = btoa(JSON.stringify({ exp: Date.now() + 1e12 })).replace(/=+$/, "");
  assert(!(await verifyToken(`${forged}.${sig}`)));
  assert(!(await verifyToken(`${payload}.${sig.slice(0, -2)}xx`)));
  assert(!(await verifyToken("kaputt")));
  assert(!(await verifyToken(null)));
});

Deno.test("abgelaufenes Token wird abgelehnt", async () => {
  const { token } = await createToken(Date.now() - 13 * 3600_000);
  assert(!(await verifyToken(token)));
});

Deno.test("Daten nur mit Token", async () => {
  const res = await handler(new Request("http://localhost/admin", {
    method: "POST",
    body: JSON.stringify({ action: "overview" }),
  }));
  assertEquals(res.status, 401);
});

Deno.test("Base32 hin und zurück", async () => {
  const { base32Encode, base32Decode } = await import("./index.ts");
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  assertEquals(base32Encode(bytes).length, 32);
  assertEquals(base32Decode(base32Encode(bytes)), bytes);
  assertEquals(base32Encode(new TextEncoder().encode("foobar")), "MZXW6YTBOI");
});

Deno.test("TOTP nach RFC 6238 (SHA-1)", async () => {
  const { totp } = await import("./index.ts");
  const secret = new TextEncoder().encode("12345678901234567890");
  // Testwerte aus RFC 6238, Anhang B (8 Ziffern)
  assertEquals(await totp(secret, Math.floor(59 / 30), 8), "94287082");
  assertEquals(await totp(secret, Math.floor(1111111109 / 30), 8), "07081804");
  assertEquals(await totp(secret, Math.floor(20000000000 / 30), 8), "65353130");
});

Deno.test("Code gilt ±30 s und nur einmal", async () => {
  const { base32Encode, matchTotp, totp } = await import("./index.ts");
  const raw = crypto.getRandomValues(new Uint8Array(20));
  const secret = base32Encode(raw);
  const now = 1_800_000_000_000;
  const step = Math.floor(now / 30_000);
  const code = await totp(raw, step);
  assertEquals(await matchTotp(secret, code, 0, now), step);
  assertEquals(await matchTotp(secret, ` ${code.slice(0, 3)} ${code.slice(3)} `, 0, now), step);
  assertEquals(await matchTotp(secret, await totp(raw, step - 1), 0, now), step - 1);
  assertEquals(await matchTotp(secret, await totp(raw, step - 2), 0, now), null);
  assertEquals(await matchTotp(secret, code, step, now), null); // schon benutzt
  assertEquals(await matchTotp(secret, "12345", 0, now), null);
  assertEquals(await matchTotp(secret, undefined, 0, now), null);
});

Deno.test("Token ohne 2FA gilt nur zum Einrichten", async () => {
  const { token } = await createToken(Date.now(), false);
  assertEquals((await verifyToken(token))?.mfa, false);
  const full = await createToken();
  assertEquals((await verifyToken(full.token))?.mfa, true);
});
