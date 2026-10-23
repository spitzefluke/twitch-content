// Chat-Befehle aus dem Twitch-Chat des Streamers (EventSub channel.chat.message).
// Gelesen wird über den Chat-Bot: Er hat user:read:chat freigegeben, der Streamer channel:bot.
// Vorneweg der Chat-Bot (_shared/bot.ts: Moderation, Begrüßung, Auto-Nachrichten, Stream-Infos, Song-Wünsche).
// Befehle: den Dino füttern (Standard !füttern), sein Kostüm wechseln (!change [kostüm]) und die
// Verlosung (Standard !verlosung, mit Follower-Prüfung bei Twitch), die Sound-Liste (!sounds), bei einer
// laufenden Umfrage „!vote 2“, Zähler („!tode“, Mods: „!tode +“), „!puls“ und der Cup („!cup join“); alles andere (auch !watchtime und eigene Befehle) beantwortet chat_command
// in der Datenbank. Nebenbei zählt jede Nachricht für die Hot Words.
import { botsOff, channelKey, chatConnection, db, getAppToken, getBot, helix, sendChat } from "./twitch.ts";
import { normalize, prankState, soundList, soundListMessages, soundRewardTitle } from "./pranks.ts";
import { flushOutbox, handleExtraCommand } from "./extras.ts";
import { noteChatter, watchTick } from "./watchtime.ts";
import { noteHotwords } from "./hotwords.ts";
import { feedPet } from "./pet.ts";
import { handleBot } from "./bot.ts";

const CHAT_EVENT = "channel.chat.message";
const VOTE_COMMANDS = new Set(["vote", "abstimmen"]);

// Kostüme in fester Reihenfolge („!change“ allein nimmt das nächste) und was Zuschauer dafür tippen dürfen
const COSTUMES = ["schaffner", "lok", "bau"] as const;
const COSTUME_WORDS: Record<string, typeof COSTUMES[number]> = {
  // Angezeigt werden Kapitän, Mechaniker und Bauarbeiter; die alten Wörter gehen weiter
  kapitan: "schaffner", kapitaen: "schaffner", kapitanin: "schaffner", kapitaenin: "schaffner", kaptn: "schaffner",
  pfeife: "schaffner", schaffner: "schaffner", schaffnerin: "schaffner",
  mechaniker: "lok", mechanikerin: "lok", mecha: "lok", lok: "lok", lokfuhrer: "lok", lokfuehrer: "lok",
  bau: "bau", bauarbeiter: "bau", bauarbeiterin: "bau", helm: "bau", gleisbauer: "bau",
};

// Ein Abo für den Chat des Streamers, gelesen als der Bot des Kanals (zwei Plattform-Bots, …_bot_stats.sql).
// Abos mit einem anderen Bot (z. B. nach dem Wechsel) fliegen raus; ohne Bot gibt es keins.
export async function ensureChatSubscription(broadcasterId: string, callback: string, secret: string) {
  const bot = await getBot();
  const appToken = await getAppToken();
  const existing = await helix("eventsub/subscriptions", appToken, { query: { type: CHAT_EVENT } });
  type Sub = { id: string; status: string; condition?: { broadcaster_user_id?: string; user_id?: string }; transport?: { callback?: string } };
  const mine = (existing.data ?? []).filter((s: Sub) => s.condition?.broadcaster_user_id === broadcasterId);
  const good = bot && mine.find((s: Sub) =>
    s.status === "enabled" && s.condition?.user_id === bot.user_id && s.transport?.callback === callback);
  for (const sub of mine) {
    if (sub !== good) await helix("eventsub/subscriptions", appToken, { method: "DELETE", query: { id: sub.id } });
  }
  if (!bot) return null;
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
  message_id?: string;
  badges?: { set_id: string }[];
  message?: { text?: string; fragments?: { type: string; text: string }[] };
};

export async function handleChatMessage(event: ChatMessage) {
  // Notfall-Schalter im Admin-Bereich: Chat-Bot plattformweit aus – keine Befehle, keine Moderation
  if (await botsOff().catch(() => false)) return;
  const self = await getBot();
  // Was nebenbei läuft (Watchtime, Hot Words), wartet nicht vor der Antwort des Bots – erst am Ende
  const side: Promise<unknown>[] = [];
  try {
    await handleChat(event, self, side);
  } finally {
    await Promise.all(side);
    // Bot-Nachrichten aus der Warteschlange (Umfrage zu Ende, Quiz, Verlosung …) gleich mit rausschicken
    await flushOutbox().catch((e) => console.warn("Bot-Nachrichten:", (e as Error).message));
  }
}

async function handleChat(event: ChatMessage, self: Awaited<ReturnType<typeof getBot>>, side: Promise<unknown>[]) {
  const text = (event.message?.text ?? "").trim();
  // Chat-Bot zuerst (…_chat_bot_plus.sql): Moderation, Begrüßung (fragt, ob jemand neu ist – darum vor der
  // Watchtime), Auto-Nachrichten, Stream-Infos, Song-Wünsche
  let bot: "mod" | "done" | false = false;
  if (!self || event.chatter_user_id !== self.user_id) {
    bot = await handleBot(event).catch((e) => { console.warn("Bot:", e); return false as const; });
    if (bot === "mod") return; // gelöscht oder Timeout: zählt für nichts
  }
  if (!self || event.chatter_user_id !== self.user_id) {
    side.push(
      // Watchtime: wer schreibt, ist da (zählt, falls Twitch die Chatters-Liste nicht herausgibt)
      noteChatter(event.chatter_user_id, event.chatter_user_login, event.chatter_user_name).catch(() => {}),
      // Hot Words: Wörter zählen (Befehle nicht)
      noteHotwords(event.chatter_user_id, text).catch((e) => console.warn("Hot Words:", e)),
      // Watchtime und Statistik zählen, solange gechattet wird (höchstens jede Minute, …_bot_stats.sql)
      watchTick().catch((e) => console.warn("Watchtime:", (e as Error).message)),
    );
  }
  if (!text.startsWith("!") || bot === "done") return;
  const [command, arg = ""] = text.split(/\s+/);

  // Verlosung: eigener Befehl, braucht die Follower-Prüfung bei Twitch (kann SQL nicht)
  if (!self || event.chatter_user_id !== self.user_id) {
    if (await handleGiveaway(event, command).catch((e) => { console.warn("Verlosung:", e); return false; })) return;
  }

  // !sounds: nummerierte Liste für die Belohnung „🔊 Sound für …“
  if ((!self || event.chatter_user_id !== self.user_id) && normalize(command) === "sounds") {
    if (await handleSoundList().catch((e) => { console.warn("!sounds:", e); return false; })) return;
  }

  // Umfrage: „!vote 2“ – nur solange eine läuft (sonst darf ein eigener Befehl !vote antworten)
  if ((!self || event.chatter_user_id !== self.user_id) && VOTE_COMMANDS.has(normalize(command))) {
    if (await handleVote(event, arg).catch((e) => { console.warn("Umfrage:", e); return false; })) return;
  }

  // Cup: „!cup“, „!cup join“, „!cup regeln“, „!cup top“, „!cup platz“ (Migration …_cup.sql)
  if ((!self || event.chatter_user_id !== self.user_id) && normalize(command) === "cup") {
    if (await handleRpcChat("cup_chat", event, text).catch((e) => { console.warn("Cup:", e); return false; })) return;
  }

  // Zähler („!tode“, Mods: „!tode +“) und „!puls“ (Migration …_game_packs.sql)
  if (!self || event.chatter_user_id !== self.user_id) {
    if (await handleRpcChat("game_chat", event, text).catch((e) => { console.warn("Zähler/Puls:", e); return false; })) return;
  }

  // Befehle der neueren Content-Ideen und des Bots (Quiz, Mitspielen, Verbotenes Wort,
  // Zahlenraten, !watchtime, !befehle, eigene Befehle)
  if (!self || event.chatter_user_id !== self.user_id) {
    await handleExtraCommand(event).catch((e) => console.warn("Chat-Befehl:", e));
  }
  // Raid-Schutz: Dino füttern und umziehen ruhen auch
  const { data: paused } = await db.rpc("viewer_paused");
  if (paused === true) return;

  if (normalize(command) === "change") return await changeCostume(event, arg);

  const { data: pet } = await db.from("pet").select("feed_command").eq("id", 1).maybeSingle();
  if (!pet) return;
  // "!füttern" und "!fuettern" zählen gleich
  if (normalize(command) !== normalize(pet.feed_command ?? "!füttern")) return;
  if (self && event.chatter_user_id === self.user_id) return;
  // Abklingzeiten, Starttermin und Stadium: _shared/pet.ts (gilt genauso fürs Twitch-Panel)
  await feedPet(event.chatter_user_id, event.chatter_user_name || event.chatter_user_login);
}

// ---------- Zähler und Puls (…_game_packs.sql), Cup (…_cup.sql) ----------
// Die Datenbank-Funktion entscheidet und antwortet: {handled, reply?}. Liefert true, wenn der Befehl
// erledigt ist (Antwort geht gleich raus).
async function handleRpcChat(fn: "game_chat" | "cup_chat", event: ChatMessage, text: string) {
  const { data, error } = await db.rpc(fn, {
    p_user_id: event.chatter_user_id,
    p_name: event.chatter_user_name || event.chatter_user_login,
    p_badges: (event.badges ?? []).map((b) => b.set_id),
    p_text: text.slice(0, 200),
  });
  if (error) {
    if (!error.message.includes(fn)) console.warn(`${fn}:`, error.message); // Migration fehlt: nichts tun
    return false;
  }
  if (!data?.handled) return false;
  if (data.reply) {
    const conn = await chatConnection().catch(() => null);
    if (conn) await sendChat(conn, String(data.reply)).catch((e) => console.warn("Chat:", (e as Error).message));
  }
  return true;
}

// ---------- Umfrage (Migration …_polls.sql) ----------
// Liefert true, wenn eine Umfrage läuft und die Stimme damit erledigt ist. Der Bot antwortet nicht
// (sonst flutet er den Chat) – den Stand zeigen Overlay und Panel.
async function handleVote(event: ChatMessage, arg: string) {
  const n = Number.parseInt(arg.replace(/[^0-9]/g, ""), 10);
  const { data, error } = await db.rpc("poll_vote", {
    p_key: `tw:${event.chatter_user_id}`, p_choice: Number.isFinite(n) ? n : 0, p_source: "chat",
  });
  if (error) {
    if (!/poll_vote/.test(error.message)) console.warn("poll_vote:", error.message); // Migration fehlt: nichts tun
    return false;
  }
  return data?.ok === true || data?.reason === "choice" || data?.reason === "paused";
}

// !change [kostüm]: Rexi zieht sich um. Eine Pause für alle (Abklingzeit im OBS-Fenster).
async function changeCostume(event: ChatMessage, arg: string) {
  const bot = await getBot();
  if (bot && event.chatter_user_id === bot.user_id) return;
  // Spalten kommen mit …_pet_costume.sql – fehlt sie noch, passiert einfach nichts
  const { data: pet, error } = await db.from("pet")
    .select("costume, costume_command, costume_cooldown, costume_changed_at").eq("id", 1).maybeSingle();
  if (error || !pet || !pet.costume_command) return;
  const { data: tile } = await db.from("tiles").select("target_at").eq("kind", "pet").order("position").limit(1).maybeSingle();
  if (!tile || (tile.target_at && Date.parse(tile.target_at) > Date.now())) return;

  const now = Date.now();
  const pause = (pet.costume_cooldown ?? 60) * 1000;
  if (pet.costume_changed_at && now - Date.parse(pet.costume_changed_at) < pause) return;

  const word = normalize(arg).replace(/[^a-z]/g, "");
  let next = word ? COSTUME_WORDS[word] : undefined;
  if (word && !next) return; // unbekanntes Kostüm: ignorieren
  if (!next) next = COSTUMES[(COSTUMES.indexOf(pet.costume) + 1) % COSTUMES.length];
  if (next === pet.costume) return;

  const at = new Date(now).toISOString();
  const who = event.chatter_user_name || event.chatter_user_login;
  const { error: upErr } = await db.from("pet").update({ costume: next, costume_changed_at: at }).eq("id", 1);
  if (upErr) throw upErr;
  await db.from("pet_events").insert({ kind: "costume", who, text: next });
}

// ---------- Verlosung (Migration …_giveaway.sql) ----------
// Liefert true, wenn der Befehl der Verlosungs-Befehl war (dann nichts weiter tun).
async function handleGiveaway(event: ChatMessage, command: string) {
  const { data: g, error } = await db.from("giveaway").select("status, command, followers_only").eq("id", 1).maybeSingle();
  if (error || !g) return false; // Migration fehlt noch
  if (command.toLowerCase() !== g.command) return false;
  if (g.status !== "open") return true;
  const conn = await chatConnection().catch(() => null);
  if (!conn) return true;
  // Der Streamer selbst kann seinem Kanal nicht folgen und lost nicht mit
  if (event.chatter_user_id === conn.broadcaster_id) return true;
  const who = event.chatter_user_name || event.chatter_user_login;
  let follower: boolean | null = null;
  if (g.followers_only) {
    try {
      // Recht moderator:read:followers (haben Verbindungen seit den Follower-Alerts)
      const res = await helix("channels/followers", conn.access_token, {
        query: { broadcaster_id: conn.broadcaster_id, user_id: event.chatter_user_id },
      });
      follower = (res?.data ?? []).length > 0;
    } catch (e) {
      // Ohne Prüfung niemanden eintragen – lieber Bescheid geben
      console.warn("Follower-Prüfung:", (e as Error).message);
      await sendChat(conn, "⚠️ Die Follower-Prüfung für die Verlosung klappt gerade nicht – Streamer: Twitch einmal neu verbinden.").catch(() => {});
      return true;
    }
  }
  const { data: res, error: rpcError } = await db.rpc("giveaway_enter", {
    p_key: `tw:${event.chatter_user_id}`, p_name: who, p_follower: follower,
  });
  if (rpcError) throw rpcError;
  if (res?.reply) await sendChat(conn, String(res.reply)).catch((e) => console.warn("Chat:", (e as Error).message));
  return true;
}

// ---------- !sounds (Ärgern, Migration …_pranks.sql) ----------
// Schreibt die Sounds mit Nummer in den Chat – höchstens alle 30 Sekunden (für alle zusammen).
// Liefert false, wenn das Ärgern gerade aus ist: Dann darf ein eigener Befehl !sounds antworten.
const SOUNDS_COOLDOWN_MS = 30_000;
async function handleSoundList() {
  const { active, soundsPaused } = await prankState();
  if (!active) return false;
  const conn = await chatConnection();
  if (!conn) return false;
  const { data: cd } = await db.from("chat_cooldowns").select("at").eq("slot", "sounds").maybeSingle();
  if (cd && Date.now() - Date.parse(cd.at) < SOUNDS_COOLDOWN_MS) return true;
  await db.from("chat_cooldowns").upsert({ slot: "sounds", at: new Date().toISOString() }, { onConflict: await channelKey("slot") });
  // Soundkäufe pausiert (OBS nicht verbunden, …_obs_sound_pause.sql)
  if (soundsPaused) {
    await sendChat(conn, "⏸️ Sounds sind gerade pausiert – OBS ist nicht verbunden. Gleich geht's weiter.");
    return true;
  }

  const list = await soundList();
  const who = (conn.display_name || "den Streamer").slice(0, 25);
  const lines = soundListMessages(list, `🔊 Bei „🔊 Sound für ${who}“ Nummer oder Name eintippen („zufall“ geht auch):`);
  // Sounds mit eigener Belohnung (Migration …_sound_rewards.sql): einfach anklicken
  const { data: own } = await db.from("prank_sound_rewards").select("board, sound_id").eq("enabled", true).not("reward_id", "is", null);
  const direct = (own ?? [])
    .map((r: { board: string | null; sound_id: string | null }) => list.find((s) => (r.board ? s.board?.id === r.board : s.custom?.id === r.sound_id)))
    .filter(Boolean)
    .map((s) => soundRewardTitle(s!.name));
  if (direct.length) lines.push(`Ohne Tippen, direkt bei den Kanalpunkten: ${direct.join(" · ")}`.slice(0, 480));
  for (const line of lines) await sendChat(conn, line);
  return true;
}
