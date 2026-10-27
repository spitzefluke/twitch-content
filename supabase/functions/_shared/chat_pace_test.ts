// Chat-Bot: „Your message was not sent because you are sending messages too quickly“ (HTTP 429).
// sendChat wartet seinen Sendeplatz ab, versucht es bei 429 noch zweimal und stellt die Nachricht
// danach in die Warteschlange, statt sie zu verlieren (…_bot_pacing.sql).
//   deno test --allow-env --allow-net supabase/functions/_shared/chat_pace_test.ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { chatPace, CodedError, sendChat, type Connection } from "./twitch.ts";

const conn = { broadcaster_id: "4711" } as Connection;

// Supabase und Twitch nachgebildet: chat/messages antwortet die ersten `fails` Male mit 429
function fakeServer(opts: { fails: number; slotMs?: number }) {
  const seen = { sends: 0, logs: [] as { status: string; reason: string }[], queued: [] as Record<string, unknown>[] };
  const fetchFake = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : input instanceof URL ? input.href : String(input));
    const body = init?.body ?? (req ? await req.text() : null);
    const json = () => (typeof body === "string" && body ? JSON.parse(body) : {});
    const accept = new Headers(init?.headers ?? req?.headers).get("accept") ?? "";
    if (url.pathname.endsWith("/rpc/bot_gate")) return Response.json({ off: false });
    if (url.pathname.endsWith("/rpc/channel_bot_id")) return Response.json(1);
    if (url.pathname.endsWith("/rpc/bot_send_slot")) return Response.json(opts.slotMs ?? 0);
    if (url.pathname.endsWith("/rpc/bot_log_add")) {
      const b = json();
      seen.logs.push({ status: b.p_status, reason: b.p_reason });
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/twitch_bot")) {
      const bot = { id: 1, user_id: "999", login: "streamhelpbot", display_name: "StreamHelpBot" };
      return Response.json(accept.includes("vnd.pgrst.object") ? bot : [bot]);
    }
    if (url.pathname.endsWith("/bot_outbox")) {
      seen.queued.push(json());
      return new Response(null, { status: 201 });
    }
    if (url.hostname === "id.twitch.tv") return Response.json({ access_token: "app-token", expires_in: 3600 });
    if (url.pathname === "/helix/chat/messages") {
      seen.sends++;
      if (seen.sends <= opts.fails) {
        return Response.json({ error: "Too Many Requests", status: 429, message: "Your message was not sent because you are sending messages too quickly." }, { status: 429 });
      }
      return Response.json({ data: [{ message_id: "m1", is_sent: true }] });
    }
    throw new Error(`Unerwartete Anfrage im Test: ${url.href}`);
  };
  return { seen, fetchFake };
}

async function withFake<T>(server: ReturnType<typeof fakeServer>, fn: () => Promise<T>): Promise<T> {
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  Deno.env.set("TWITCH_CLIENT_ID", "client");
  Deno.env.set("TWITCH_CLIENT_SECRET", "secret");
  const old = globalThis.fetch;
  const oldPace = { ...chatPace, retryMs: [...chatPace.retryMs] };
  Object.assign(chatPace, { gapMs: 10, maxWaitMs: 200, retryMs: [5, 5], requeueMs: 1000 });
  globalThis.fetch = server.fetchFake as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = old;
    Object.assign(chatPace, oldPace);
  }
}

Deno.test("429: wartet und schickt die Nachricht beim nächsten Versuch", async () => {
  const server = fakeServer({ fails: 2 });
  const ms = await withFake(server, () => sendChat(conn, "Hallo Chat", undefined, "chat"));
  assert(typeof ms === "number");
  assertEquals(server.seen.sends, 3);
  assertEquals(server.seen.logs.map((l) => l.status), ["sent"]);
  assertEquals(server.seen.queued.length, 0);
});

Deno.test("429 bleibt: Nachricht kommt in die Warteschlange statt verloren zu gehen", async () => {
  const server = fakeServer({ fails: 99 });
  const res = await withFake(server, () => sendChat(conn, "Danke für den Follow!", undefined, "system"));
  assertEquals(res, null);
  assertEquals(server.seen.sends, 3);
  assertEquals(server.seen.queued.length, 1);
  assertEquals(server.seen.queued[0].text, "Danke für den Follow!");
  assert(typeof server.seen.queued[0].send_after === "string", "später senden (send_after)");
  assertEquals(server.seen.logs.map((l) => l.status), ["retry"]);
});

Deno.test("429 bei Nachrichten aus der Warteschlange: nicht noch einmal einreihen (kein Kreislauf)", async () => {
  const server = fakeServer({ fails: 99 });
  await withFake(server, () =>
    assertRejects(() => sendChat(conn, "Quizfrage …", undefined, "outbox"), CodedError, "Twitch bremst den Bot")
  );
  assertEquals(server.seen.queued.length, 0);
  assertEquals(server.seen.logs.map((l) => l.status), ["error"]);
});

Deno.test("Sendeplatz: wartet die vergebene Zeit ab, bevor gesendet wird", async () => {
  const server = fakeServer({ fails: 0, slotMs: 120 });
  const started = Date.now();
  await withFake(server, () => sendChat(conn, "Hi", undefined, "chat"));
  assert(Date.now() - started >= 110, "mindestens die Wartezeit vom Sendeplatz");
  assertEquals(server.seen.sends, 1);
});
