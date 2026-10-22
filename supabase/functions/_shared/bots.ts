// Die zwei Plattform-Chat-Bots (Migration …_bot_stats.sql): gemeinsam für twitch-oauth und admin.
// Jeder Kanal liest seinen Chat mit seinem Bot mit (gewählt oder Ersatz) – nach jedem Verbinden,
// Trennen oder Wechsel werden die Chat-Abos aller Kanäle neu ausgerichtet.
import { activeChannels, db, env, forgetBots, getAppToken, getConnection, helix, withChannel } from "./twitch.ts";
import { ensureChatSubscription } from "./chat.ts";

const eventsubCallback = () => `${env("SUPABASE_URL")}/functions/v1/twitch-eventsub`;

// Chat-Abo eines Kanals (für !befehle, Verlosung, Cup …). Scheitert es, läuft der Rest trotzdem.
export async function chatSubscription(broadcasterId: string) {
  try {
    await ensureChatSubscription(broadcasterId, eventsubCallback(), env("EVENTSUB_SECRET"));
  } catch (e) {
    console.warn("Chat-Abo nicht angelegt (Bot neu verbinden?):", e);
  }
}

export async function resubscribeAllChats() {
  forgetBots();
  const channels = await activeChannels().catch(() => []);
  for (const ch of channels.length ? channels.map((c) => c.id) : [null]) {
    await withChannel(ch, async () => {
      const conn = await getConnection().catch(() => null);
      if (conn) await chatSubscription(conn.broadcaster_id);
    });
  }
}

// Bot von Platz 1 oder 2 trennen. Ist danach keiner mehr da, fallen alle Chat-Abos weg.
export async function removeBot(slot: 1 | 2) {
  await db.from("twitch_bot").delete().eq("id", slot);
  const { count } = await db.from("twitch_bot").select("id", { count: "exact", head: true });
  if (count) return await resubscribeAllChats();
  forgetBots();
  const appToken = await getAppToken().catch(() => null);
  if (!appToken) return;
  const existing = await helix("eventsub/subscriptions", appToken, { query: { type: "channel.chat.message" } }).catch(() => ({ data: [] }));
  for (const sub of existing.data ?? []) {
    await helix("eventsub/subscriptions", appToken, { method: "DELETE", query: { id: sub.id } }).catch(() => {});
  }
}
