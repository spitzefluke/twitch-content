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
