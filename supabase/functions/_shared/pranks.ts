// „Ärgere den Streamer“ über Kanalpunkte: Belohnungen im Kanal des Streamers anlegen bzw.
// abgleichen und eingetippte Wünsche („Tomate“, „Pfeife“, „3“, „zufall“) erkennen.
// Die Gegenstände und Sounds stehen auch in js/prank-fx.js – beide gleich halten
// (auch die Reihenfolge: Sie ergibt die Nummern der Sounds, siehe soundList).
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
  { id: "flashbang", name: "Flashbang", alias: ["flash", "blendgranate", "blend", "flashbang granate", "💥", "⚡"] },
  { id: "nuke", name: "Nuke", alias: ["atombombe", "bombe", "atom", "rakete", "☢️", "☢", "💣", "🚀"] },
  { id: "flowers", name: "Blumen", alias: ["blume", "strauss", "blumenstrauss", "💐", "🌹"] },
];

export const BOARD_SOUNDS: { id: string; name: string; alias: string[] }[] = [
  { id: "whistle", name: "Trillerpfeife", alias: ["pfeife", "triller", "zugpfeife", "📯", "🚂"] },
  { id: "horn", name: "Tröte", alias: ["troete", "hupe", "horn", "📯"] },
  { id: "rimshot", name: "Ba-dum-tss", alias: ["badumtss", "ba dum tss", "trommel", "🥁"] },
  { id: "buzzer", name: "Falsch!", alias: ["falsch", "buzzer", "❌"] },
  { id: "fart", name: "Pupskissen", alias: ["pups", "furz", "💨"] },
  { id: "boing", name: "Boing", alias: ["🌀"] },
  { id: "quack", name: "Quak", alias: ["quack", "🦆"] },
  { id: "applause", name: "Applaus", alias: ["klatschen", "👏"] },
  { id: "gong", name: "Gong", alias: ["gong", "bahnhofsgong", "🔔"] },
];

// Die Belohnungen tragen den Namen des Kanals („Wirf was auf <Kanal>“).
// Früher hießen sie fest „… auf Dave“ – unter dem alten Titel werden sie auch noch gefunden.
const OLD_TITLES = { throw: "🍅 Wirf was auf Dave", sound: "🔊 Sound für Dave" } as const;
function rewards(name: string) {
  const who = (name || "den Streamer").slice(0, 25);
  return {
    throw: {
      title: `🍅 Wirf was auf ${who}`,
      prompt: `Was soll fliegen? ${THROW_ITEMS.map((i) => i.name).join(", ")}`,
      background_color: "#E0301E",
    },
    sound: {
      title: `🔊 Sound für ${who}`,
      prompt: soundPrompt(),
      background_color: "#9146FF",
    },
  } as const;
}

// Twitch erlaubt höchstens 200 Zeichen: die eingebauten Sounds mit Nummer, der Rest über !sounds
export function soundPrompt() {
  return `Nummer oder Name: ${BOARD_SOUNDS.map((s, i) => `${i + 1} ${s.name}`).join(", ")} · ab ${BOARD_SOUNDS.length + 1} eigene Sounds (!sounds im Chat) · „zufall“`.slice(0, 200);
}

// "Schnee-Ball!!" → "schneeball"; Umlaute auch als ae/oe/ue/ss
export function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[\s\-_.!?,:;"'„“()]+/g, "")
    .trim();
}

// Abstand zweier Wörter in Tippfehlern (Buchstabe falsch, fehlt, zu viel oder vertauscht)
export function typoDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
// Kurze Wörter: ein Tippfehler, ab 7 Buchstaben zwei; unter 4 Buchstaben keiner
const typoLimit = (n: string) => (n.length >= 7 ? 2 : n.length >= 4 ? 1 : 0);

type Named = { name: string; alias?: string[] };
function match<T extends Named>(input: string, list: T[]): T | null {
  const raw = input.trim();
  const n = normalize(raw);
  if (!n && !raw) return null;
  // 1. genau, 2. Emoji irgendwo, 3. Anfang (ab 3 Zeichen), 4. Name steckt in der Eingabe,
  // 5. Eingabe steckt im Namen (ab 4 Zeichen: „violin“ → „Sad Violin“), 6. mit Tippfehler
  const keys = (x: T) => [x.name, ...(x.alias ?? [])].map((k) => ({ k, n: normalize(k) }));
  return list.find((x) => keys(x).some((k) => k.n && k.n === n))
    ?? list.find((x) => keys(x).some((k) => /\p{Extended_Pictographic}/u.test(k.k) && raw.includes(k.k)))
    ?? (n.length >= 3 ? list.find((x) => keys(x).some((k) => k.n.startsWith(n))) : undefined)
    ?? list.find((x) => keys(x).some((k) => k.n.length >= 3 && n.includes(k.n)))
    ?? (n.length >= 4 ? list.find((x) => keys(x).some((k) => k.n.includes(n))) : undefined)
    ?? closest(n, list, keys)
    ?? null;
}

function closest<T>(n: string, list: T[], keys: (x: T) => { n: string }[]) {
  const limit = typoLimit(n);
  if (!limit) return null;
  let best: T | null = null;
  let bestDist = limit + 1;
  for (const x of list) {
    for (const k of keys(x)) {
      if (k.n.length < 4) continue;
      const dist = typoDistance(n, k.n);
      if (dist < bestDist) { best = x; bestDist = dist; }
    }
  }
  return best;
}

export const matchThrow = (input: string) => match(input, THROW_ITEMS);

// ---------- Sounds mit Nummern ----------
// 1–9: die eingebauten Sounds (Reihenfolge wie BOARD_SOUNDS), ab 10: eigene Sounds,
// der älteste zuerst. Die Webseite zählt genauso (js/api.js, getSounds).
export type SoundEntry = {
  no: number;
  name: string;
  board?: typeof BOARD_SOUNDS[number];
  custom?: { id: string; name: string; path: string };
};

export async function soundList(): Promise<SoundEntry[]> {
  const { data } = await db.from("sounds").select("id, name, path")
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(500);
  return [
    ...BOARD_SOUNDS.map((b, i) => ({ no: i + 1, name: b.name, board: b })),
    ...(data ?? []).map((c, i) => ({ no: BOARD_SOUNDS.length + 1 + i, name: c.name, custom: c })),
  ];
}

const RANDOM_WORDS = new Set(["zufall", "zufaellig", "random", "rnd", "egal", "irgendwas", "irgendeiner", "ueberraschmich", "ueberraschung", "surprise"]);

// Was hat der Zuschauer gemeint? Nummer („3“, „#3“, „Nr. 12“), „zufall“, Name oder
// Stichwort – auch mit Tippfehlern. Eingebaute Sounds gehen bei gleichem Namen vor.
export function pickSound(input: string, list: SoundEntry[]): SoundEntry | null {
  const raw = input.trim().slice(0, 100);
  // Heißt ein eigener Sound genau so („3 Tage wach“), geht der Name vor der Nummer
  const exact = normalize(raw) && list.find((s) => normalize(s.name) === normalize(raw));
  if (exact) return exact;
  const num = /^(?:#|nr\.?|nummer|no\.?|sound)?\s*(\d{1,4})(?![\p{L}\p{N}])/iu.exec(raw);
  if (num) return list.find((s) => s.no === Number(num[1])) ?? null;
  const n = normalize(raw);
  if (RANDOM_WORDS.has(n) || /^[?❓🎲]+$/u.test(raw.replace(/\s+/g, ""))) {
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }
  const board = list.filter((s) => s.board);
  const custom = list.filter((s) => s.custom);
  const asNamed = (s: SoundEntry) => ({ s, name: s.name, alias: s.board?.alias ?? [] });
  const hit = match(raw, board.map(asNamed)) ?? match(raw, custom.map(asNamed));
  return hit?.s ?? null;
}

// Die Liste für !sounds: Nummer und Name, in Stücken, die in eine Chat-Nachricht passen
export function soundListMessages(list: SoundEntry[], head: string, max = 3, size = 450) {
  const parts = list.map((s) => `${s.no} ${s.name}`);
  const out: string[] = [];
  let line = head;
  for (const p of parts) {
    const next = line === head ? `${line} ${p}` : `${line} · ${p}`;
    if (next.length > size) {
      out.push(line);
      if (out.length === max) break;
      line = `… ${p}`;
    } else line = next;
  }
  if (out.length < max) out.push(line);
  else out[max - 1] = `${out[max - 1]} … (alle auf der Webseite)`.slice(0, 500);
  return out;
}

// Sollen die Belohnungen gerade einlösbar sein? Aus (Admin) oder vor dem Startdatum: nein.
export async function prankState() {
  const [{ data: cfg }, { data: tile }, { data: paused }] = await Promise.all([
    db.from("prank_settings").select("*").eq("id", 1).maybeSingle(),
    db.from("tiles").select("target_at").eq("kind", "prank").order("position").limit(1).maybeSingle(),
    // Raid-Schutz (…_security_hardening.sql); fehlt die Funktion noch, gilt: nicht pausiert
    db.rpc("viewer_paused"),
  ]);
  const startsAt = tile?.target_at ? Date.parse(tile.target_at) : null;
  const started = startsAt === null || startsAt <= Date.now();
  return { cfg, tile, startsAt, started, paused: paused === true, active: !!cfg?.enabled && !!tile && started && paused !== true };
}

// Legt die beiden Belohnungen an oder bringt sie auf den Stand der Einstellungen
// (Kosten, Abklingzeit, an/aus). Merkt sich die IDs in twitch_connection.
export async function syncPrankRewards(conn: Connection) {
  const { cfg, active, started, startsAt } = await prankState();
  if (!cfg) throw new Error("In der Datenbank fehlt das Ärgern (Migration …_pranks.sql).");
  const REWARDS = rewards(conn.display_name);
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
        ?? list.data.find((r: { title: string }) => r.title === REWARDS[kind].title || r.title === OLD_TITLES[kind]);
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
    const soundRewards = await syncSoundRewards(conn, list.data, active, cooldown, Object.values(ids));
    return { active, started, starts_at: startsAt ? new Date(startsAt).toISOString() : null, ...ids, sound_rewards: soundRewards };
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

// ---------- Eine Belohnung pro Sound (Migration …_sound_rewards.sql) ----------
// Zuschauer klicken auf „🔊 Tröte“ und fertig – nichts eintippen. Welche Sounds eine eigene
// Belohnung bekommen, wählt der Streamer auf der Webseite (prank_sound_rewards, höchstens 20,
// Twitch erlaubt insgesamt 50 pro Kanal). Ausgeschaltete und gelöschte Sounds verlieren ihre Belohnung.
export const SOUND_REWARD_MAX = 20;
type SoundRewardRow = { id: number; board: string | null; sound_id: string | null; enabled: boolean; cost: number; reward_id: string | null };
type TwitchReward = { id: string; title: string };

export function soundRewardTitle(name: string) {
  return `🔊 ${name}`.slice(0, 45);
}

export async function syncSoundRewards(conn: Connection, manageable: TwitchReward[], active: boolean, cooldown: number, keep: string[]) {
  const { data: rows, error } = await db.from("prank_sound_rewards").select("id, board, sound_id, enabled, cost, reward_id").order("id");
  if (error) return null; // Migration fehlt noch: nur die beiden Sammel-Belohnungen
  const ids = (rows ?? []).map((r: SoundRewardRow) => r.sound_id).filter(Boolean);
  const { data: customs } = ids.length ? await db.from("sounds").select("id, name").in("id", ids) : { data: [] };
  const nameOf = (r: SoundRewardRow) => r.board
    ? BOARD_SOUNDS.find((b) => b.id === r.board)?.name
    : customs?.find((c: { id: string }) => c.id === r.sound_id)?.name;

  const titles = new Set(manageable.filter((r) => keep.includes(r.id)).map((r) => r.title.toLowerCase()));
  const errors: string[] = [];
  let live = 0;
  for (const row of (rows ?? []) as SoundRewardRow[]) {
    const name = nameOf(row);
    if (!name || !row.enabled) {
      // Sound gelöscht oder ausgeschaltet: Belohnung auf Twitch weg
      if (row.reward_id) await deleteReward(conn, row.reward_id);
      if (!name) await db.from("prank_sound_rewards").delete().eq("id", row.id);
      else if (row.reward_id) await db.from("prank_sound_rewards").update({ reward_id: null, error: "" }).eq("id", row.id);
      continue;
    }
    // Zwei eigene Sounds mit gleichem Namen: Twitch will eindeutige Titel
    let title = soundRewardTitle(name);
    for (let k = 2; titles.has(title.toLowerCase()); k++) title = `${soundRewardTitle(name).slice(0, 41)} ${k}`;
    titles.add(title.toLowerCase());
    const body = {
      title,
      prompt: `Spielt „${name}“ im Stream ab – einfach einlösen, nichts eintippen.`.slice(0, 200),
      cost: Math.min(1_000_000, Math.max(1, Number(row.cost) || 300)),
      is_enabled: active,
      is_user_input_required: false,
      should_redemptions_skip_request_queue: false,
      background_color: "#9146FF",
      is_global_cooldown_enabled: cooldown > 0,
      global_cooldown_seconds: Math.min(604800, Math.max(1, cooldown)),
    };
    try {
      const existing = manageable.find((r) => r.id === row.reward_id)
        ?? manageable.find((r) => r.title.toLowerCase() === title.toLowerCase() && !keep.includes(r.id));
      let id: string;
      if (existing) {
        await helix("channel_points/custom_rewards", conn.access_token, {
          method: "PATCH", query: { broadcaster_id: conn.broadcaster_id, id: existing.id }, body,
        });
        id = existing.id;
      } else {
        const created = await helix("channel_points/custom_rewards", conn.access_token, {
          method: "POST", query: { broadcaster_id: conn.broadcaster_id }, body,
        });
        id = created.data[0].id;
      }
      await db.from("prank_sound_rewards").update({ reward_id: id, error: "" }).eq("id", row.id);
      live++;
    } catch (e) {
      let message = (e as Error).message;
      if (e instanceof HelixError) {
        const m = e.data?.message ?? "";
        if (/too.?many|maximum|limit/i.test(m)) message = "Twitch erlaubt höchstens 50 Belohnungen pro Kanal – schalte ein paar Sounds (oder andere Belohnungen) aus.";
        else if (/duplicate/i.test(m)) message = `Es gibt schon eine von Hand angelegte Belohnung „${title}“. Bitte im Twitch-Dashboard löschen oder umbenennen.`;
        else message = m || message;
      }
      await db.from("prank_sound_rewards").update({ error: message.slice(0, 200) }).eq("id", row.id);
      errors.push(`${name}: ${message}`);
    }
  }
  return { live, errors };
}

async function deleteReward(conn: Connection, id: string) {
  await helix("channel_points/custom_rewards", conn.access_token, {
    method: "DELETE", query: { broadcaster_id: conn.broadcaster_id, id },
  }).catch((e) => { if (!(e instanceof HelixError && e.status === 404)) console.warn("Belohnung nicht gelöscht:", e); });
}

// Twitch trennen: Sound-Belohnungen nur ausschalten (beim erneuten Verbinden wieder an)
export async function disableSoundRewards(conn: Connection) {
  const { data } = await db.from("prank_sound_rewards").select("reward_id").not("reward_id", "is", null);
  for (const r of data ?? []) {
    await helix("channel_points/custom_rewards", conn.access_token, {
      method: "PATCH", query: { broadcaster_id: conn.broadcaster_id, id: r.reward_id }, body: { is_enabled: false },
    }).catch((e) => console.warn(e));
  }
}

// Einlösung einer Sound-Belohnung: welcher Sound? null = keine Sound-Belohnung.
// gone = der Sound wurde inzwischen gelöscht (Belohnung gleich mit weg).
export async function soundForReward(conn: Connection, rewardId: string) {
  const { data: row, error } = await db.from("prank_sound_rewards").select("id, board, sound_id, enabled").eq("reward_id", rewardId).maybeSingle();
  if (error || !row) return null;
  const list = await soundList();
  const entry = row.board ? list.find((s) => s.board?.id === row.board) : list.find((s) => s.custom?.id === row.sound_id);
  if (!entry || !row.enabled) {
    await deleteReward(conn, rewardId);
    if (!entry) await db.from("prank_sound_rewards").delete().eq("id", row.id);
    else await db.from("prank_sound_rewards").update({ reward_id: null }).eq("id", row.id);
    return { gone: true as const };
  }
  return { gone: false as const, entry };
}

// Eine EventSub-Abo für alle Einlösungen im Kanal (Glücksrad und Ärgern);
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
