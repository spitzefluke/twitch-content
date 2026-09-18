// Webhook für Twitch EventSub.
// Wird von Twitch aufgerufen, wenn ein Zuschauer die Kanalpunkte-Belohnung „Glücksrad“ einlöst –
// funktioniert also auch, wenn niemand die Website offen hat.
import {
  chatText, CodedError, db, env, getConnection, helix, performSpin, sendChat, type Connection,
} from "../_shared/twitch.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const enc = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;
const hmacKey = () =>
  keyPromise ??= crypto.subtle.importKey(
    "raw", enc.encode(env("EVENTSUB_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );

function hexToBytes(hex: string) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return null;
  return new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

// Signatur prüfen: HMAC-SHA256(secret, id + timestamp + body)
async function verify(req: Request, body: string) {
  const id = req.headers.get("Twitch-Eventsub-Message-Id");
  const ts = req.headers.get("Twitch-Eventsub-Message-Timestamp");
  const sig = req.headers.get("Twitch-Eventsub-Message-Signature");
  if (!id || !ts || !sig?.startsWith("sha256=")) return false;
  if (Math.abs(Date.now() - Date.parse(ts)) > 10 * 60_000) return false;
  const bytes = hexToBytes(sig.slice(7));
  if (!bytes) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(), bytes, enc.encode(id + ts + body));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Methode nicht erlaubt", { status: 405 });
  const body = await req.text();
  if (!(await verify(req, body))) return new Response("Ungültige Signatur", { status: 403 });

  const type = req.headers.get("Twitch-Eventsub-Message-Type");
  const payload = JSON.parse(body);

  if (type === "webhook_callback_verification") {
    return new Response(payload.challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  if (type === "revocation") {
    console.warn("EventSub widerrufen:", payload.subscription?.status);
    await db.from("twitch_connection").update({ subscription_id: null }).eq("subscription_id", payload.subscription.id);
    return new Response(null, { status: 204 });
  }

  if (type === "notification" && payload.subscription?.type === "channel.channel_points_custom_reward_redemption.add") {
    const task = handleRedemption(payload.event).catch((e) => console.error("Einlösung fehlgeschlagen:", e));
    // Twitch sofort antworten, die Arbeit läuft im Hintergrund weiter
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);
    else await task;
  }
  return new Response(null, { status: 204 });
});

type Redemption = {
  id: string;
  broadcaster_user_id: string;
  user_login: string;
  user_name: string;
  reward: { id: string; title: string; cost: number };
};

async function handleRedemption(event: Redemption) {
  const conn = await getConnection();
  if (!conn || event.reward.id !== conn.reward_id) return;

  let spin;
  try {
    spin = await performSpin({ source: "twitch", requestedBy: event.user_name, redemptionId: event.id });
  } catch (e) {
    if (e instanceof CodedError && e.code === "duplicate") return; // Twitch hat erneut zugestellt
    await setStatus(conn, event, "CANCELED").catch(console.error); // Punkte zurückgeben
    throw e;
  }

  try {
    await sendChat(conn, chatText(spin));
  } catch (e) {
    console.error("Chat-Nachricht fehlgeschlagen:", e);
  }
  await setStatus(conn, event, "FULFILLED").catch(console.error);
}

function setStatus(conn: Connection, event: Redemption, status: "FULFILLED" | "CANCELED") {
  return helix("channel_points/custom_rewards/redemptions", conn.access_token, {
    method: "PATCH",
    query: { broadcaster_id: conn.broadcaster_id, reward_id: event.reward.id, id: event.id },
    body: { status },
  });
}
