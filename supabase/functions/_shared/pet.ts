// Das Haustier füttern – aus dem Twitch-Chat (Befehl, Standard !füttern) und aus dem Twitch-Panel.
// Dieselben Regeln an beiden Stellen: erst ab dem Starttermin der Kachel, nicht im Raid-Schutz,
// höchstens alle 15 Sekunden insgesamt und je Zuschauer alle 10 Minuten (pet_chat_cooldowns).
import { channelKey, db, getConnection, sendChat } from "./twitch.ts";

export const FEED_COOLDOWN_MS = 10 * 60_000; // pro Zuschauer
export const FEED_GAP_MS = 15_000; // zwischen zwei Fütterungen insgesamt – sonst frisst er nur noch

export type FeedResult =
  | { ok: true; fed_count: number }
  | { ok: false; reason: "closed" | "paused" | "busy" | "cooldown"; wait?: number };

// Ist das Haustier für Zuschauer schon da? (Starttermin der Kachel)
export async function petStarted() {
  const { data: tile } = await db.from("tiles").select("target_at").eq("kind", "pet").order("position").limit(1).maybeSingle();
  return !!tile && (!tile.target_at || Date.parse(tile.target_at) <= Date.now());
}

// Wie lange muss dieser Zuschauer noch warten? (Sekunden, 0 = darf)
export async function feedWait(twitchUserId: string) {
  const { data: cd } = await db.from("pet_chat_cooldowns").select("last_at").eq("twitch_user_id", twitchUserId).maybeSingle();
  if (!cd) return 0;
  return Math.max(0, Math.ceil((Date.parse(cd.last_at) + FEED_COOLDOWN_MS - Date.now()) / 1000));
}

export async function feedPet(twitchUserId: string, who: string): Promise<FeedResult> {
  const { data: paused } = await db.rpc("viewer_paused");
  if (paused === true) return { ok: false, reason: "paused" };
  // stage gibt es erst mit …_pet_species.sql – ohne die Spalte ist es einfach undefined
  const { data: pet } = await db.from("pet").select("*").eq("id", 1).maybeSingle();
  if (!pet || !(await petStarted())) return { ok: false, reason: "closed" };

  const now = Date.now();
  if (pet.last_fed_at && now - Date.parse(pet.last_fed_at) < FEED_GAP_MS) {
    return { ok: false, reason: "busy", wait: Math.ceil((Date.parse(pet.last_fed_at) + FEED_GAP_MS - now) / 1000) };
  }
  const wait = await feedWait(twitchUserId);
  if (wait > 0) return { ok: false, reason: "cooldown", wait };

  const at = new Date(now).toISOString();
  await db.from("pet_chat_cooldowns").upsert({ twitch_user_id: twitchUserId, last_at: at }, { onConflict: await channelKey("twitch_user_id") });
  const { data: fed, error } = await db.from("pet")
    .update({ last_fed_at: at, last_fed_by: who, fed_count: (pet.fed_count ?? 0) + 1 })
    .eq("id", 1).select("*").single();
  if (error) throw error;
  await db.from("pet_events").insert({ kind: "feed", who });
  // Ei geschlüpft oder Baby erwachsen (Trigger …_pet_species.sql): der Bot dankt den Helfern
  if (fed?.stage && pet.stage && fed.stage !== pet.stage) await announceStage(fed).catch((e) => console.warn("Haustier-Stadium:", e));
  await db.from("pet_events").delete().lt("created_at", new Date(now - 2 * 86400_000).toISOString());
  return { ok: true, fed_count: fed?.fed_count ?? (pet.fed_count ?? 0) + 1 };
}

// Neues Stadium im Chat verkünden (nur mit verbundenem Chat-Bot)
async function announceStage(pet: { name?: string; stage?: string }) {
  const { data: ev } = await db.from("pet_events").select("who").eq("kind", "stage").eq("text", pet.stage ?? "")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const helpers = ev?.who ? ` Danke an ${ev.who}!` : "";
  const name = pet.name || "Das Haustier";
  const text = pet.stage === "baby"
    ? `🐣 ${name} ist geschlüpft!${helpers} Ab jetzt füttern – nach ein paar Streams mit guter Laune wird es groß.`
    : `🎉 ${name} ist erwachsen!${helpers}`;
  const conn = await getConnection().catch(() => null);
  if (conn) await sendChat(conn, text);
}
