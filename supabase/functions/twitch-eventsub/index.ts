// Webhook für Twitch EventSub.
// Wird von Twitch aufgerufen, wenn ein Zuschauer im Kanal des Streamers Kanalpunkte einlöst
// (bei Chat-Nachrichten, siehe _shared/chat.ts – z. B. !füttern für den Dino –
// und bei Follows und Abos für das Alert-Feld, siehe _shared/alerts.ts):
//   „Glücksrad“            → Rad drehen, Ergebnis in den Chat
//   „🍅 Wirf was auf ‹Kanal›“ → Wurf im OBS-Overlay (eingetippt: was fliegt)
//   „🔊 Sound für ‹Kanal›“ → Sound im OBS-Overlay (eingetippt: Nummer, Name oder „zufall“)
//   „🔊 ‹Sound›“             → genau dieser Sound, ohne Tippen (eine Belohnung pro Sound)
// Funktioniert also auch, wenn niemand die Website offen hat.
import {
  channelForTwitch, chatText, CodedError, db, env, getConnection, helix, performSpin, sendChat, type Connection, withChannel,
} from "../_shared/twitch.ts";
import { matchThrow, pickSound, prankState, type SoundEntry, soundForReward, soundList, THROW_ITEMS } from "../_shared/pranks.ts";
import { handleChatMessage } from "../_shared/chat.ts";
import { handleAlert, isAlertType } from "../_shared/alerts.ts";
import { handleExtraRedemption } from "../_shared/extras.ts";
import { noteEvent } from "../_shared/health.ts";

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

  // Zu welchem StreamHelp-Kanal gehört das? (alle Kanäle teilen sich diesen Webhook)
  const broadcaster = payload.subscription?.condition?.broadcaster_user_id ?? payload.event?.broadcaster_user_id;
  let channel: { known: boolean; id: string | null };
  try {
    channel = await channelForTwitch(broadcaster);
  } catch (e) {
    console.error("Kanal nicht ermittelt:", e);
    return new Response("Kanal nicht ermittelt", { status: 500 }); // Twitch stellt erneut zu
  }
  if (!channel.known) {
    console.warn("EventSub für unbekannten oder gesperrten Kanal:", broadcaster, payload.subscription?.type);
    return new Response(null, { status: 204 });
  }
  return await withChannel(channel.id, () => handle(req, type, payload));
});

// deno-lint-ignore no-explicit-any
async function handle(req: Request, type: string | null, payload: any): Promise<Response> {
  if (type === "revocation") {
    console.warn("EventSub widerrufen:", payload.subscription?.status);
    await db.from("twitch_connection").update({ subscription_id: null }).eq("subscription_id", payload.subscription.id);
    return new Response(null, { status: 204 });
  }

  // Gesundheitscheck: Wann kam zuletzt etwas von Twitch an? (twitch_health, …_streamhelp.sql)
  if (type === "notification") {
    const note = noteEvent(payload.subscription?.type ?? "").catch(() => {});
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(note);
  }

  if (type === "notification" && isAlertType(payload.subscription?.type ?? "")) {
    const task = handleAlert(payload.subscription.type, payload.event, req.headers.get("Twitch-Eventsub-Message-Id"))
      .catch((e) => console.error("Alert fehlgeschlagen:", e));
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);
    else await task;
    return new Response(null, { status: 204 });
  }

  if (type === "notification" && payload.subscription?.type === "channel.chat.message") {
    const task = handleChatMessage(payload.event).catch((e) => console.error("Chat-Befehl fehlgeschlagen:", e));
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);
    else await task;
    return new Response(null, { status: 204 });
  }

  if (type === "notification" && payload.subscription?.type === "channel.channel_points_custom_reward_redemption.add") {
    const messageId = req.headers.get("Twitch-Eventsub-Message-Id");
    const task = Promise.all([
      redemptionAlert(payload.event, messageId).catch((e) => console.error("Kanalpunkte-Alert fehlgeschlagen:", e)),
      handleRedemption(payload.event).catch((e) => console.error("Einlösung fehlgeschlagen:", e)),
    ]);
    // Twitch sofort antworten, die Arbeit läuft im Hintergrund weiter
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);
    else await task;
  }
  return new Response(null, { status: 204 });
}

// Jede Kanalpunkte-Einlösung (egal welche Belohnung) als Alert im Overlay – ohne den eingetippten Text
async function redemptionAlert(event: Redemption, messageId: string | null) {
  const { error } = await db.from("stream_alerts").upsert({
    kind: "redeem",
    user_name: (event.user_name || event.user_login || "Jemand").slice(0, 60),
    amount: Math.max(0, Number(event.reward.cost) || 0),
    message: String(event.reward.title ?? "").slice(0, 300),
    event_id: messageId,
  }, { onConflict: "event_id", ignoreDuplicates: true });
  // Migration …_streamhelp.sql fehlt noch (kind 'redeem' unbekannt): kein Alert, sonst alles wie gehabt
  if (error && !/stream_alerts_kind_check/.test(error.message)) throw error;
}

type Redemption = {
  id: string;
  broadcaster_user_id: string;
  user_id?: string;
  user_login: string;
  user_name: string;
  user_input?: string;
  reward: { id: string; title: string; cost: number };
};

async function handleRedemption(event: Redemption) {
  const conn = await getConnection();
  if (!conn) return;
  // Eine Belohnung pro Sound (Migration …_sound_rewards.sql)
  const fixed = [conn.reward_id, conn.prank_throw_reward_id, conn.prank_sound_reward_id].includes(event.reward.id)
    ? null
    : await soundForReward(conn, event.reward.id).catch((e) => { console.warn("Sound-Belohnung:", e); return null; });
  // Raid-Schutz: Glücksrad und Ärgern pausiert → Punkte zurück (Vorlesen/Karten prüft die Datenbank selbst)
  if (fixed || [conn.reward_id, conn.prank_throw_reward_id, conn.prank_sound_reward_id].includes(event.reward.id)) {
    const { data: paused } = await db.rpc("viewer_paused");
    if (paused === true) {
      await setStatus(conn, event, "CANCELED").catch(console.error);
      await sendChat(conn, `@${event.user_login} Gerade ist alles kurz pausiert (Raid-Schutz). Deine Kanalpunkte sind zurück.`).catch((e) => console.warn(e));
      return;
    }
  }
  if (event.reward.id === conn.prank_throw_reward_id) return handlePrank(conn, event, "throw");
  if (event.reward.id === conn.prank_sound_reward_id) return handlePrank(conn, event, "sound");
  if (fixed) return handlePrank(conn, event, "sound", fixed);
  // Vorlesen (Text-to-Speech) und Karten-Packs (Migration …_stream_extras.sql)
  if (await handleExtraRedemption(conn, event)) return;
  if (event.reward.id !== conn.reward_id) return; // andere Belohnungen gehen uns nichts an

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

// ---------- Ärgern (Würfe und Sounds im Stream) ----------
async function handlePrank(
  conn: Connection, event: Redemption, kind: "throw" | "sound",
  fixed?: { gone: true } | { gone: false; entry: SoundEntry },
) {
  const input = (event.user_input ?? "").slice(0, 100);
  const refund = async (message: string) => {
    await setStatus(conn, event, "CANCELED").catch(console.error); // Punkte zurück
    await sendChat(conn, `@${event.user_login} ${message} Deine Kanalpunkte sind zurück.`).catch((e) => console.warn(e));
  };

  const { active, started, startsAt, paused } = await prankState();
  if (!active) {
    if (paused) return refund("Gerade ist alles kurz pausiert (Raid-Schutz).");
    const when = startsAt && !started
      ? `startet erst am ${new Date(startsAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} Uhr.`
      : "ist gerade pausiert.";
    return refund(`Das Ärgern ${when}`);
  }

  let row: Record<string, unknown> | null = null;
  let text = "";
  if (kind === "throw") {
    const item = matchThrow(input);
    // Den eingetippten Text nie wiederholen: Sonst ließe sich der Bot (mit
    // zurückerstatteten Punkten, also kostenlos) beliebigen Text schreiben lassen.
    if (!item) return refund(`Das kenne ich nicht. Werfen kannst du: ${THROW_ITEMS.map((i) => i.name).join(", ")}.`);
    row = { kind: "throw", item: item.id };
    text = item.id === "flowers" ? `💐 ${event.user_name} schenkt ${conn.display_name} Blumen!` : `🎯 ${event.user_name} wirft: ${item.name}!`;
  } else {
    if (fixed?.gone) return refund("Diesen Sound gibt es nicht mehr.");
    const sound = fixed ? fixed.entry : pickSound(input, await soundList());
    if (!sound) {
      return refund("Diesen Sound kenne ich nicht. Tipp eine Nummer oder einen Namen ein – die Liste zeigt !sounds im Chat, „zufall“ nimmt irgendeinen.");
    }
    row = sound.board
      ? { kind: "sound", item: sound.board.id }
      : { kind: "sound", item: "custom", sound_path: sound.custom!.path, label: sound.custom!.name };
    text = `🔊 ${event.user_name} spielt Nr. ${sound.no} „${sound.name}“`;
  }

  const { error } = await db.from("pranks").insert({ ...row, requested_by: event.user_name, redemption_id: event.id });
  if (error) {
    if (error.code === "23505") return; // Twitch hat erneut zugestellt
    await setStatus(conn, event, "CANCELED").catch(console.error);
    throw error;
  }
  await db.from("pranks").delete().lt("created_at", new Date(Date.now() - 2 * 86400_000).toISOString());
  await sendChat(conn, text).catch((e) => console.warn("Chat:", e));
  await setStatus(conn, event, "FULFILLED").catch(console.error);
}
