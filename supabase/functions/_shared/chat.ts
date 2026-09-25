// Chat-Befehle aus Daves Twitch-Chat (EventSub channel.chat.message).
// Gelesen wird über den Chat-Bot: Er hat user:read:chat freigegeben, Dave channel:bot.
// Bisher gibt es einen Befehl: Daves Dino füttern (Standard !füttern).
import { db, getAppToken, getBot, helix } from "./twitch.ts";
import { normalize } from "./pranks.ts";

const CHAT_EVENT = "channel.chat.message";
const FEED_COOLDOWN_MS = 10 * 60_000; // pro Zuschauer
const FEED_GAP_MS = 15_000; // zwischen zwei Fütterungen insgesamt – sonst frisst er nur noch

// Ein Abo für Daves Chat, gelesen als Bot. Ohne Bot gibt es keins.
export async function ensureChatSubscription(broadcasterId: string, callback: string, secret: string) {
  const bot = await getBot();
  if (!bot) return null;
  const appToken = await getAppToken();
  const existing = await helix("eventsub/subscriptions", appToken, { query: { type: CHAT_EVENT } });
  type Sub = { id: string; status: string; condition?: { broadcaster_user_id?: string; user_id?: string }; transport?: { callback?: string } };
  const mine = (existing.data ?? []).filter((s: Sub) => s.condition?.broadcaster_user_id === broadcasterId);
  const good = mine.find((s: Sub) =>
    s.status === "enabled" && s.condition?.user_id === bot.user_id && s.transport?.callback === callback);
  for (const sub of mine) {
    if (sub !== good) await helix("eventsub/subscriptions", appToken, { method: "DELETE", query: { id: sub.id } });
  }
  if (good) return good.id as string;
  const created = await helix("eventsub/subscriptions", appToken, {
    method: "POST",
    body: {
      type: CHAT_EVENT,
      version: "1",
      condition: { broadcaster_user_id: broadcasterId, user_id: bot.user_id },
      transport: { method: "webhook", callback, secret },
    },
  });
  return created.data[0].id as string;
}

type ChatMessage = {
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message?: { text?: string };
};

export async function handleChatMessage(event: ChatMessage) {
  const text = (event.message?.text ?? "").trim();
  if (!text.startsWith("!")) return;
  const command = text.split(/\s+/)[0];

  const { data: pet } = await db.from("pet").select("feed_command, last_fed_at, fed_count").eq("id", 1).maybeSingle();
  if (!pet) return;
  // "!füttern" und "!fuettern" zählen gleich
  if (normalize(command) !== normalize(pet.feed_command ?? "!füttern")) return;

  const bot = await getBot();
  if (bot && event.chatter_user_id === bot.user_id) return;

  // Vor dem Startdatum für Zuschauer passiert nichts
  const { data: tile } = await db.from("tiles").select("target_at").eq("kind", "pet").order("position").limit(1).maybeSingle();
  if (!tile || (tile.target_at && Date.parse(tile.target_at) > Date.now())) return;

  const now = Date.now();
  if (pet.last_fed_at && now - Date.parse(pet.last_fed_at) < FEED_GAP_MS) return;
  const { data: cd } = await db.from("pet_chat_cooldowns").select("last_at").eq("twitch_user_id", event.chatter_user_id).maybeSingle();
  if (cd && now - Date.parse(cd.last_at) < FEED_COOLDOWN_MS) return;

  const at = new Date(now).toISOString();
  const who = event.chatter_user_name || event.chatter_user_login;
  await db.from("pet_chat_cooldowns").upsert({ twitch_user_id: event.chatter_user_id, last_at: at });
  const { error } = await db.from("pet")
    .update({ last_fed_at: at, last_fed_by: who, fed_count: (pet.fed_count ?? 0) + 1 })
    .eq("id", 1);
  if (error) throw error;
  await db.from("pet_events").insert({ kind: "feed", who });
  await db.from("pet_events").delete().lt("created_at", new Date(now - 2 * 86400_000).toISOString());
}
