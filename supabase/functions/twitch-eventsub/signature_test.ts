// Lokaler Test der Webhook-Signaturprüfung:
//   deno test --allow-env --allow-net supabase/functions/twitch-eventsub/signature_test.ts
import { assertEquals } from "jsr:@std/assert@1";

const SECRET = "test-secret-1234567890";
Deno.env.set("EVENTSUB_SECRET", SECRET);
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test");
Deno.env.set("TWITCH_CLIENT_ID", "test");
Deno.env.set("TWITCH_CLIENT_SECRET", "test");

// Deno.serve abfangen, damit index.ts keinen echten Server startet
let handler!: (req: Request) => Promise<Response>;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: typeof handler) => { handler = h; return {}; };
await import("./index.ts");

async function sign(id: string, ts: string, body: string, secret = SECRET) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id + ts + body)));
  return "sha256=" + [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function request(body: string, headers: Record<string, string>) {
  return new Request("http://localhost/twitch-eventsub", { method: "POST", body, headers });
}

Deno.test("beantwortet die Verifizierungsanfrage mit der Challenge", async () => {
  const body = JSON.stringify({ challenge: "pogchamp-kappa-360", subscription: { type: "x" } });
  const ts = new Date().toISOString();
  const res = await handler(request(body, {
    "Twitch-Eventsub-Message-Id": "msg-1",
    "Twitch-Eventsub-Message-Timestamp": ts,
    "Twitch-Eventsub-Message-Signature": await sign("msg-1", ts, body),
    "Twitch-Eventsub-Message-Type": "webhook_callback_verification",
  }));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "pogchamp-kappa-360");
});

Deno.test("lehnt falsche Signaturen ab", async () => {
  const body = JSON.stringify({ challenge: "x" });
  const ts = new Date().toISOString();
  const res = await handler(request(body, {
    "Twitch-Eventsub-Message-Id": "msg-2",
    "Twitch-Eventsub-Message-Timestamp": ts,
    "Twitch-Eventsub-Message-Signature": await sign("msg-2", ts, body, "falsches-secret-123"),
    "Twitch-Eventsub-Message-Type": "webhook_callback_verification",
  }));
  assertEquals(res.status, 403);
});

Deno.test("lehnt alte Nachrichten ab (Replay-Schutz)", async () => {
  const body = JSON.stringify({ challenge: "x" });
  const ts = new Date(Date.now() - 20 * 60_000).toISOString();
  const res = await handler(request(body, {
    "Twitch-Eventsub-Message-Id": "msg-3",
    "Twitch-Eventsub-Message-Timestamp": ts,
    "Twitch-Eventsub-Message-Signature": await sign("msg-3", ts, body),
    "Twitch-Eventsub-Message-Type": "webhook_callback_verification",
  }));
  assertEquals(res.status, 403);
});
