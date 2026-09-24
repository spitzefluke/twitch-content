// „Ärgere den Dave“ über Kanalpunkte: Belohnungen in Daves Kanal anlegen bzw.
// abgleichen und eingetippte Wünsche („Tomate“, „Zugpfeife“) erkennen.
// Die Gegenstände und Sounds stehen auch in js/prank-fx.js – beide gleich halten.
import { CodedError, db, getAppToken, helix, HelixError, type Connection } from "./twitch.ts";

export const THROW_ITEMS: { id: string; name: string; alias: string[] }[] = [
  { id: "banana", name: "Banane", alias: ["bananen", "🍌"] },
  { id: "tomato", name: "Tomate", alias: ["tomaten", "🍅"] },
  { id: "pie", name: "Torte", alias: ["kuchen", "sahnetorte", "🥧"] },
  { id: "egg", name: "Ei", alias: ["eier", "🥚"] },
  { id: "fish", name: "Fisch", alias: ["🐟", "🐠"] },
  { id: "duck", name: "Quietscheente", alias: ["ente", "gummiente", "🦆"] },
  { id: "sock", name: "Stinkesocke", alias: ["socke", "socken", "🧦"] },
  { id: "snowball", name: "Schneeball", alias: ["schnee", "❄️", "❄"] },
  { id: "undies", name: "Rote Unterhose", alias: ["unterhose", "unterhosen", "rote unterhosen", "buxe", "schluepfer", "slip", "🩲"] },
  { id: "nuke", name: "Nuke", alias: ["atombombe", "bombe", "atom", "rakete", "☢️", "☢", "💣", "🚀"] },
  { id: "flowers", name: "Blumen", alias: ["blume", "strauss", "blumenstrauss", "💐", "🌹"] },
];

export const BOARD_SOUNDS: { id: string; name: string; alias: string[] }[] = [
  { id: "whistle", name: "Zugpfeife", alias: ["pfeife", "zug", "🚂"] },
  { id: "horn", name: "Tröte", alias: ["troete", "hupe", "horn", "📯"] },
  { id: "rimshot", name: "Ba-dum-tss", alias: ["badumtss", "ba dum tss", "trommel", "🥁"] },
  { id: "buzzer", name: "Falsch!", alias: ["falsch", "buzzer", "❌"] },
  { id: "fart", name: "Pupskissen", alias: ["pups", "furz", "💨"] },
  { id: "boing", name: "Boing", alias: ["🌀"] },
  { id: "quack", name: "Quak", alias: ["quack", "🦆"] },
  { id: "applause", name: "Applaus", alias: ["klatschen", "👏"] },
  { id: "gong", name: "Bahnhofsgong", alias: ["gong", "🔔"] },
];

const REWARDS = {
  throw: {
    title: "🍅 Wirf was auf Dave",
    prompt: `Was soll fliegen? ${THROW_ITEMS.map((i) => i.name).join(", ")}`,
    background_color: "#E0301E",
  },
  sound: {
    title: "🔊 Sound für Dave",
    prompt: `Welcher Sound? ${BOARD_SOUNDS.map((s) => s.name).join(", ")} – oder der Name eines eigenen Sounds von der Webseite`,
    background_color: "#9146FF",
  },
} as const;

// "Schnee-Ball!!" → "schneeball"; Umlaute auch als ae/oe/ue/ss
export function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[\s\-_.!?,:;"'„“()]+/g, "")
    .trim();
}

function match<T extends { name: string; alias: string[] }>(input: string, list: T[]): T | null {
  const raw = input.trim();
  const n = normalize(raw);
  if (!n && !raw) return null;
  // 1. genau, 2. Emoji irgendwo, 3. Anfang (ab 3 Zeichen), 4. irgendwo enthalten
  const keys = (x: T) => [x.name, ...x.alias].map((k) => ({ k, n: normalize(k) }));
  return list.find((x) => keys(x).some((k) => k.n && k.n === n))
    ?? list.find((x) => keys(x).some((k) => /\p{Extended_Pictographic}/u.test(k.k) && raw.includes(k.k)))
    ?? (n.length >= 3 ? list.find((x) => keys(x).some((k) => k.n.startsWith(n))) : undefined)
    ?? list.find((x) => keys(x).some((k) => k.n.length >= 3 && n.includes(k.n)))
    ?? null;
}

export const matchThrow = (input: string) => match(input, THROW_ITEMS);
export const matchBoardSound = (input: string) => match(input, BOARD_SOUNDS);

export async function matchCustomSound(input: string) {
  const n = normalize(input);
  if (!n) return null;
  const { data } = await db.from("sounds").select("name, path").limit(500);
  const sounds = data ?? [];
  return sounds.find((s) => normalize(s.name) === n)
    ?? (n.length >= 3 ? sounds.find((s) => normalize(s.name).startsWith(n)) : undefined)
    ?? null;
}

// Sollen die Belohnungen gerade einlösbar sein? Aus (Admin) oder vor dem Startdatum: nein.
export async function prankState() {
  const [{ data: cfg }, { data: tile }] = await Promise.all([
    db.from("prank_settings").select("*").eq("id", 1).maybeSingle(),
    db.from("tiles").select("target_at").eq("kind", "prank").order("position").limit(1).maybeSingle(),
  ]);
  const startsAt = tile?.target_at ? Date.parse(tile.target_at) : null;
  const started = startsAt === null || startsAt <= Date.now();
  return { cfg, tile, startsAt, started, active: !!cfg?.enabled && !!tile && started };
}

// Legt die beiden Belohnungen an oder bringt sie auf den Stand der Einstellungen
// (Kosten, Abklingzeit, an/aus). Merkt sich die IDs in twitch_connection.
export async function syncPrankRewards(conn: Connection) {
  const { cfg, active, started, startsAt } = await prankState();
  if (!cfg) throw new Error("In der Datenbank fehlt „Ärgere den Dave“ (Migration …_pranks.sql).");
  const cooldown = Math.max(0, Number(cfg.cooldown_seconds) || 0);
  const settingsFor = (kind: "throw" | "sound") => ({
    ...REWARDS[kind],
    cost: kind === "throw" ? cfg.throw_cost ?? 500 : cfg.sound_cost ?? 300,
    is_enabled: active,
    is_user_input_required: true,
    should_redemptions_skip_request_queue: false,
    is_global_cooldown_enabled: cooldown > 0,
    global_cooldown_seconds: Math.min(604800, Math.max(1, cooldown)),
  });

  try {
    const list = await helix("channel_points/custom_rewards", conn.access_token, {
      query: { broadcaster_id: conn.broadcaster_id, only_manageable_rewards: "true" },
    });
    const ids: Record<"throw" | "sound", string> = { throw: "", sound: "" };
    for (const kind of ["throw", "sound"] as const) {
      const knownId = kind === "throw" ? conn.prank_throw_reward_id : conn.prank_sound_reward_id;
      const existing = list.data.find((r: { id: string }) => r.id === knownId)
        ?? list.data.find((r: { title: string }) => r.title === REWARDS[kind].title);
      if (existing) {
        await helix("channel_points/custom_rewards", conn.access_token, {
          method: "PATCH",
          query: { broadcaster_id: conn.broadcaster_id, id: existing.id },
          body: settingsFor(kind),
        });
        ids[kind] = existing.id;
      } else {
        const created = await helix("channel_points/custom_rewards", conn.access_token, {
          method: "POST",
          query: { broadcaster_id: conn.broadcaster_id },
          body: settingsFor(kind),
        });
        ids[kind] = created.data[0].id;
      }
    }
    await db.from("twitch_connection").update({
      prank_throw_reward_id: ids.throw,
      prank_sound_reward_id: ids.sound,
      prank_rewards_active: active,
    }).eq("id", 1);
    return { active, started, starts_at: startsAt ? new Date(startsAt).toISOString() : null, ...ids };
  } catch (e) {
    if (e instanceof HelixError) {
      if (e.status === 403) throw new CodedError("not_affiliate", "Kanalpunkte gibt es nur für Twitch-Affiliates und Partner.");
      if (e.status === 400 && /duplicate/i.test(e.data?.message ?? "")) {
        throw new CodedError("reward_exists", `Es gibt schon eine von Hand angelegte Belohnung „${REWARDS.throw.title}“ oder „${REWARDS.sound.title}“. Bitte im Twitch-Dashboard löschen und noch einmal übernehmen.`);
      }
    }
    throw e;
  }
}

// Eine EventSub-Abo für alle Einlösungen in Daves Kanal (Glücksrad und Ärgern);
// welche Belohnung es war, entscheidet twitch-eventsub. Ein älteres Abo, das nur
// aufs Glücksrad gefiltert war, wird ersetzt.
const EVENT_TYPE = "channel.channel_points_custom_reward_redemption.add";
export async function ensureRedemptionSubscription(broadcasterId: string, callback: string, secret: string) {
  const appToken = await getAppToken();
  const existing = await helix("eventsub/subscriptions", appToken, { query: { type: EVENT_TYPE } });
  const mine = (existing.data ?? []).filter((s: { condition?: { broadcaster_user_id?: string } }) =>
    s.condition?.broadcaster_user_id === broadcasterId);
  const good = mine.find((s: { status: string; condition: { reward_id?: string }; transport?: { callback?: string } }) =>
    s.status === "enabled" && !s.condition.reward_id && s.transport?.callback === callback);
  for (const sub of mine) {
    if (sub !== good) await helix("eventsub/subscriptions", appToken, { method: "DELETE", query: { id: sub.id } });
  }
  if (good) return good.id as string;
  // Twitch ruft dabei sofort twitch-eventsub zur Verifizierung auf
  const created = await helix("eventsub/subscriptions", appToken, {
    method: "POST",
    body: {
      type: EVENT_TYPE,
      version: "1",
      condition: { broadcaster_user_id: broadcasterId },
      transport: { method: "webhook", callback, secret },
    },
  });
  return created.data[0].id as string;
}
