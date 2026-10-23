// Twitch-Panel-Erweiterung (Ordner extension/): das Panel unter dem Stream fragt hier nach.
//   POST {action:"state"}           → Kanal, aktuelles Game, passende Content-Ideen, „Als Nächstes“,
//                                     Verlosung und Warteschlange (mit „bin ich schon dabei?“)
//   POST {action:"giveaway"}        → bei der Verlosung mitmachen
//   POST {action:"queue", epic?}    → in die Mitspieler-Warteschlange (Epic-Name, beim ersten Mal nötig)
//   POST {action:"vote", choice}    → bei der laufenden Umfrage abstimmen (1–5, ändern geht)
//   POST {action:"feed"}            → das Haustier füttern (gleiche Abklingzeiten wie !füttern im Chat)
//   POST {action:"sound", sound}    → einen Sound im Stream abspielen (nur wenn der Streamer „Sounds übers Panel“
//                                     eingeschaltet hat; Abklingzeiten prüft panel_sound_play, …_panel_sounds.sql).
//                                     Sounds „nur für Abonnenten“ und die kürzere Abo-Wartezeit: …_panel_bits_subs.sql
//   POST {action:"bits_sound", sound, receipt} → Sound gegen Bits: die Quittung von Twitch (transactionReceipt,
//                                     signiert mit demselben Secret) wird geprüft, jede Transaktion zählt einmal
// Abonnent oder nicht, fragt diese Function selbst bei Twitch nach (Helix /subscriptions mit dem Recht
// channel:read:subscriptions des Streamers) – was der Browser des Zuschauers meldet, zählt nicht.
// Ausweis: Header Authorization: Bearer <JWT der Twitch-Erweiterung>. Twitch signiert ihn mit dem
// Extension-Secret (Supabase-Secret EXTENSION_SECRET, base64). Er nennt den Kanal (channel_id) und –
// wenn der Zuschauer seine Twitch-ID freigegeben hat – den Zuschauer (user_id). Mitmachen geht nur damit.
import {
  channelForTwitch, currentChannel, db, env, getAppToken, getConnection, helix, rateLimit, sendChat, withChannel,
} from "../_shared/twitch.ts";
import { GAME_ONLY, gameById } from "../_shared/games.ts";
import { feedPet, feedWait, petStarted } from "../_shared/pet.ts";
import { soundList } from "../_shared/pranks.ts";
import { flushOutbox } from "../_shared/extras.ts";
import { watchTick } from "../_shared/watchtime.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
// Nebenbei, ohne die Antwort ans Panel aufzuhalten: Watchtime/Statistik zählen (höchstens jede Minute,
// …_bot_stats.sql) und Bot-Nachrichten aus der Warteschlange schicken (z. B. eine Umfrage ist zu Ende)
function background(withTick: boolean) {
  const task = Promise.all([
    withTick ? watchTick().catch((e) => console.warn("Watchtime:", (e as Error).message)) : null,
    flushOutbox().catch((e) => console.warn("Bot-Nachrichten:", (e as Error).message)),
  ]);
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Claims = { exp: number; channel_id: string; user_id?: string; opaque_user_id?: string; role?: string };
// Quittung einer Bits-Transaktion (Twitch.ext.bits.onTransactionComplete → transactionReceipt)
type Receipt = {
  exp: number; topic?: string;
  data?: { transactionId?: string; userId?: string; product?: { sku?: string; cost?: { amount?: number; type?: string } } };
};
// Bits-Produkte der Erweiterung (in der Twitch-Entwicklerkonsole angelegt, README → Twitch-Erweiterung)
const BITS_SKUS = new Set(["sound_50", "sound_100", "sound_250", "sound_500"]);

// ---------- Ausweis der Erweiterung prüfen (JWT, HS256) ----------
const enc = new TextEncoder();
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
let keyPromise: Promise<CryptoKey> | null = null;
const extKey = () =>
  keyPromise ??= crypto.subtle.importKey(
    "raw", Uint8Array.from(atob(env("EXTENSION_SECRET")), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );

// Ausweis und Bits-Quittung sind beide JWTs mit dem Extension-Secret
async function verifyJwt<T extends { exp: number }>(token: string): Promise<T | null> {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await extKey(), fromB64url(s), enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(p))) as T;
    if (header.alg !== "HS256" || typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function verify(req: Request): Promise<Claims | null> {
  const claims = await verifyJwt<Claims>((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!claims || !/^\d{1,20}$/.test(String(claims.channel_id ?? ""))) return null;
  if (claims.user_id && !/^\d{1,20}$/.test(String(claims.user_id))) delete claims.user_id;
  return claims;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);
  if (!Deno.env.get("EXTENSION_SECRET")) return json({ error: "setup", message: "In Supabase fehlt das Secret EXTENSION_SECRET." }, 503);
  const claims = await verify(req);
  if (!claims) return json({ error: "auth", message: "Ausweis von Twitch ungültig oder abgelaufen." }, 401);
  const body = await req.json().catch(() => ({}));

  // Rate-Limit je Zuschauer (opaque_user_id gibt Twitch auch ohne freigegebene ID): Stand abrufen
  // 30× pro Minute, Mitmachen 6× pro Minute – genug für echte Klicks, zu wenig für Skripte.
  const viewer = claims.opaque_user_id ?? claims.user_id ?? "anon";
  const join = ["giveaway", "queue", "vote", "feed", "sound", "bits_sound"].includes(body.action);
  if (!(await rateLimit(`ext:${join ? "join" : "state"}:${claims.channel_id}:${viewer}`, join ? 6 : 30))) {
    return json({ error: "rate", message: "Zu viele Klicks – kurz warten." }, 429);
  }

  const channel = await channelForTwitch(claims.channel_id).catch(() => null);
  if (!channel?.known) return json({ error: "unknown", message: "Dieser Kanal ist (noch) nicht bei StreamHelp." }, 404);

  return await withChannel(channel.id, async () => {
    try {
      const run = async () => {
        if (body.action === "state") return await state(channel.id, claims);
        if (body.action === "giveaway") return await joinGiveaway(claims);
        if (body.action === "queue") return await joinQueue(claims, body.epic);
        if (body.action === "vote") return await vote(claims, body.choice);
        if (body.action === "feed") return await feed(claims);
        if (body.action === "sound") return await playSound(claims, body.sound);
        if (body.action === "bits_sound") return await bitsSound(claims, body.sound, body.receipt);
        return null;
      };
      const result = await run();
      if (result === null) return json({ error: "Unbekannte Aktion" }, 400);
      background(body.action === "state");
      return json(result);
    } catch (e) {
      console.error("twitch-ext:", e);
      return json({ error: "server", message: "Gerade hakt es – bitte gleich noch einmal versuchen." }, 500);
    }
  });
});

// ---------- Stand fürs Panel ----------
// Der Teil für alle Zuschauer wird kurz zwischengespeichert (viele Zuschauer, gleiche Antwort).
const CACHE_MS = 10_000;
const cache = new Map<string, { at: number; data: Shared }>();
type Idea = { kind: string; title: string; description: string };
type Shared = {
  channel: { name: string; login: string | null; link: string | null };
  game: { id: string; name: string; icon: string; live: boolean; category: string } | null;
  ideas: Idea[];
  placeholder: boolean;
  next: { title: string; at: string } | null;
  giveaway: { open: boolean; prize: string; command: string; followers_only: boolean; entries: number; round: number } | null;
  queue: { open: boolean; waiting: number; note: string; sub_first: boolean } | null;
  poll: Poll | null;
  pet: Pet | null;
  counters: { emoji: string; label: string; value: number; command: string | null }[];
  // Sounds, die Zuschauer im Panel abspielen dürfen (leer, solange der Streamer es nicht eingeschaltet hat);
  // sub = nur für Abonnenten. sound_bits: Bits-Produkt für „sofort, ohne Wartezeit“ (null = aus)
  sounds: { id: string; name: string; sub: boolean }[];
  sound_bits: string | null;
};
type Poll = {
  status: "open" | "closed"; round: number; question: string; options: string[]; counts: number[]; total: number;
  ends_at: string | null; chat: boolean;
};
type Pet = {
  name: string; species: string; stage: string; command: string; fed_count: number;
  last_fed_by: string; last_fed_at: string | null; hungry_after: number;
};

// Name des Kanals so, wie er bei Twitch heißt (Groß-/Kleinschreibung, Umbenennungen) – 1 Stunde gemerkt
const NAME_MS = 60 * 60_000;
const names = new Map<string, { at: number; name: string | null }>();
async function twitchName(twitchId: string) {
  const hit = names.get(twitchId);
  if (hit && Date.now() - hit.at < NAME_MS) return hit.name;
  let name: string | null = null;
  try {
    const res = await helix("users", await getAppToken(), { query: { id: twitchId } });
    const u = res?.data?.[0];
    name = u ? String(u.display_name || u.login || "").slice(0, 40) || null : null;
  } catch (e) {
    console.warn("Kanalname:", (e as Error).message);
  }
  names.set(twitchId, { at: Date.now(), name });
  return name;
}

function siteLink(login: string | null, isDefault: boolean) {
  const site = Deno.env.get("SITE_URL");
  if (!site) return null;
  const base = site.endsWith("/") || /\.html?$/i.test(site) ? site : `${site}/`;
  return isDefault || !login ? base : `${base}#/c/${login}`;
}

async function shared(channelId: string | null, twitchId: string): Promise<Shared> {
  const key = channelId ?? "default";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const [ch, conn, games, tiles, giveaway, queue, waiting, poll, pet, petOpen, realName, counters, sounds] = await Promise.all([
    currentChannel().catch(() => null),
    db.from("twitch_connection").select("display_name, broadcaster_login").eq("id", 1).maybeSingle(),
    db.from("stream_games").select("active, current, live_game, live_category, live_at").eq("id", 1).maybeSingle(),
    db.from("tiles").select("kind, title, description, target_at").order("position"),
    db.from("giveaway").select("status, prize, command, followers_only, entries, round").eq("id", 1).maybeSingle(),
    db.from("queue_settings").select("open, note, sub_priority").eq("id", 1).maybeSingle(),
    db.from("queue_entries").select("id", { count: "exact", head: true }).eq("status", "waiting"),
    // Umfrage (…_polls.sql) und Haustier – fehlt die Tabelle, bleibt der Teil einfach weg
    db.from("polls").select("status, round, question, options, counts, total, ends_at, chat_vote").eq("id", 1).maybeSingle(),
    db.from("pet").select("name, species, stage, feed_command, fed_count, last_fed_by, last_fed_at, hungry_after").eq("id", 1).maybeSingle(),
    petStarted().catch(() => false),
    twitchName(twitchId),
    // Zähler (…_game_packs.sql), die im Stream zu sehen sind
    db.from("counters").select("emoji, label, value, command").eq("show", true).order("position").limit(8),
    panelSounds().catch(() => ({ list: [], bits: null })),
  ]);

  // Game: gerade live → Standard-Game → erstes aktives
  const g = games.error ? null : games.data;
  const liveRecent = !!g?.live_at && Date.now() - Date.parse(g.live_at) < 15 * 60_000;
  const active: string[] = g?.active ?? ["fortnite", "just-chatting"];
  const gameId = (liveRecent && g?.live_game) || (g?.current && active.includes(g.current) ? g.current : "") || active[0] || "";
  const game = gameById(gameId);

  const now = Date.now();
  const all = (tiles.data ?? []) as { kind: string; title: string; description: string; target_at: string | null }[];
  const started = all.filter((t) => t.kind !== "countdown" && (!t.target_at || Date.parse(t.target_at) <= now));
  const mine = game ? started.filter((t) => game.ideas.includes(t.kind)) : [];
  const general = started.filter((t) => !mine.includes(t) && !(game && GAME_ONLY.has(t.kind) && !game.ideas.includes(t.kind)));
  const next = all
    .filter((t) => t.kind === "countdown" && t.target_at && Date.parse(t.target_at) > now)
    .sort((a, b) => Date.parse(a.target_at!) - Date.parse(b.target_at!))[0];

  const name = realName || ch?.display_name || conn.data?.display_name || "Streamer";
  const pl = poll.error ? null : poll.data;
  // Zeit der Umfrage um: beenden (Ergebnis in den Verlauf, Bot verkündet es)
  if (pl?.status === "open" && pl.ends_at && Date.parse(pl.ends_at) <= Date.now()) {
    await db.rpc("poll_tick").then(() => { pl.status = "closed"; }, () => {});
  }
  const p = pet.error ? null : pet.data;
  const pollTile = started.some((t) => t.kind === "poll");
  const login = ch?.login ?? conn.data?.broadcaster_login ?? null;
  const data: Shared = {
    channel: { name, login, link: siteLink(login, ch ? ch.is_default : true) },
    game: game ? { id: game.id, name: game.name, icon: game.icon, live: liveRecent && g?.live_game === game.id, category: liveRecent ? g?.live_category ?? "" : "" } : null,
    ideas: [...mine, ...general].slice(0, 8).map((t) => ({ kind: t.kind, title: t.title, description: (t.description ?? "").slice(0, 140) })),
    placeholder: !!game && mine.length === 0,
    next: next ? { title: next.title, at: next.target_at! } : null,
    giveaway: giveaway.data && !giveaway.error
      ? { open: giveaway.data.status === "open", prize: giveaway.data.prize ?? "", command: giveaway.data.command ?? "", followers_only: !!giveaway.data.followers_only, entries: giveaway.data.entries ?? 0, round: giveaway.data.round ?? 0 }
      : null,
    queue: queue.data && !queue.error
      ? { open: !!queue.data.open, waiting: waiting.count ?? 0, note: queue.data.note ?? "", sub_first: !!queue.data.sub_priority }
      : null,
    poll: pl && pollTile && (pl.status === "open" || pl.status === "closed") && (pl.options ?? []).length
      ? {
        status: pl.status, round: pl.round ?? 0, question: pl.question ?? "", options: pl.options ?? [],
        counts: (pl.options ?? []).map((_: string, i: number) => Number(pl.counts?.[i] ?? 0)), total: pl.total ?? 0,
        ends_at: pl.ends_at ?? null, chat: !!pl.chat_vote,
      }
      : null,
    pet: p && petOpen
      ? {
        name: String(p.name ?? "Rexi"), species: String(p.species ?? "dino"), stage: String(p.stage ?? "adult"),
        command: String(p.feed_command ?? "!füttern"), fed_count: p.fed_count ?? 0, last_fed_by: String(p.last_fed_by ?? ""),
        last_fed_at: p.last_fed_at ?? null, hungry_after: p.hungry_after ?? 45,
      }
      : null,
    counters: counters.error || !all.some((t) => t.kind === "counter")
      ? []
      : (counters.data ?? []).map((c: { emoji: string; label: string; value: number; command: string | null }) =>
        ({ emoji: c.emoji, label: c.label, value: c.value, command: c.command })),
    sounds: sounds.list,
    sound_bits: sounds.bits,
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function state(channelId: string | null, claims: Claims) {
  const data = await shared(channelId, claims.channel_id);
  const me: {
    shared: boolean; giveaway?: boolean; queue?: number | null; epic?: string | null; vote?: number | null; feed_wait?: number;
    sub?: boolean;
  } = { shared: !!claims.user_id };
  if (claims.user_id) {
    const key = `tw:${claims.user_id}`;
    const [entry, waiting, player, choice, wait] = await Promise.all([
      data.giveaway ? db.from("giveaway_entries").select("id").eq("player_key", key).eq("round", data.giveaway.round).eq("kicked", false).maybeSingle() : null,
      data.queue ? db.rpc("queue_position", { p_key: key }) : null,
      data.queue ? db.from("queue_players").select("epic_name").eq("player_key", key).maybeSingle() : null,
      data.poll ? db.rpc("poll_choice", { p_key: key }) : null,
      data.pet ? feedWait(claims.user_id).catch(() => 0) : 0,
    ]);
    // Abo nur nachfragen, wenn es etwas ändert (Abo-Sounds oder Abo-Vorrang in der Warteschlange)
    if (data.sounds.some((x) => x.sub) || data.queue?.sub_first) me.sub = await isSubscriber(claims.user_id);
    me.giveaway = !!entry?.data;
    me.queue = typeof waiting?.data === "number" ? waiting.data : null;
    me.epic = player?.data?.epic_name ?? null;
    me.vote = typeof choice?.data === "number" ? choice.data : null;
    me.feed_wait = wait;
  }
  return { ...data, me };
}

// ---------- Mitmachen ----------
async function displayName(userId: string) {
  const res = await helix("users", await getAppToken(), { query: { id: userId } }).catch(() => null);
  const u = res?.data?.[0];
  return String(u?.display_name || u?.login || "Zuschauer").slice(0, 40);
}

async function joinGiveaway(claims: Claims) {
  if (!claims.user_id) return { ok: false, reason: "share" };
  const { data: g } = await db.from("giveaway").select("status, followers_only").eq("id", 1).maybeSingle();
  if (!g || g.status !== "open") return { ok: false, reason: "closed" };
  const conn = await getConnection().catch(() => null);
  if (!conn) return { ok: false, reason: "closed" };
  if (claims.user_id === conn.broadcaster_id) return { ok: false, reason: "streamer" };
  const name = await displayName(claims.user_id);
  let follower: boolean | null = null;
  if (g.followers_only) {
    try {
      const res = await helix("channels/followers", conn.access_token, {
        query: { broadcaster_id: conn.broadcaster_id, user_id: claims.user_id },
      });
      follower = (res?.data ?? []).length > 0;
    } catch (e) {
      console.warn("Follower-Prüfung:", (e as Error).message);
      return { ok: false, reason: "check" };
    }
  }
  const { data: res, error } = await db.rpc("giveaway_enter", { p_key: `tw:${claims.user_id}`, p_name: name, p_follower: follower });
  if (error) throw error;
  // Wie im Chat: Bestätigung vom Bot, wenn der Streamer das eingestellt hat
  if (res?.ok && res.reply) await sendChat(conn, String(res.reply)).catch(() => {});
  cache.clear();
  return { ok: !!res?.ok, reason: res?.reason ?? null, entries: res?.entries ?? null };
}

async function joinQueue(claims: Claims, epic: unknown) {
  if (!claims.user_id) return { ok: false, reason: "share" };
  const name = await displayName(claims.user_id);
  const { data: res, error } = await db.rpc("queue_join", {
    p_key: `tw:${claims.user_id}`, p_name: name, p_epic: typeof epic === "string" ? epic.slice(0, 32) : "",
    p_sub: await isSubscriber(claims.user_id), p_source: "chat",
  });
  if (error) throw error;
  cache.clear();
  return { ok: !!res?.ok, reason: res?.reason ?? null, position: res?.position ?? null, picked: !!res?.picked };
}

async function vote(claims: Claims, choice: unknown) {
  if (!claims.user_id) return { ok: false, reason: "share" };
  const n = Number(choice);
  if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false, reason: "choice" };
  const { data: res, error } = await db.rpc("poll_vote", { p_key: `tw:${claims.user_id}`, p_choice: n, p_source: "panel" });
  if (error) throw error;
  cache.clear();
  return { ok: !!res?.ok, reason: res?.reason ?? null, choice: res?.choice ?? null, counts: res?.counts ?? null, total: res?.total ?? null };
}

async function feed(claims: Claims) {
  if (!claims.user_id) return { ok: false, reason: "share" };
  const res = await feedPet(claims.user_id, await displayName(claims.user_id));
  cache.clear();
  return res;
}

// ---------- Abonnent? (Helix, 5 Minuten gemerkt) ----------
const SUB_MS = 5 * 60_000;
const subs = new Map<string, { at: number; sub: boolean }>();
async function isSubscriber(userId: string): Promise<boolean> {
  const conn = await getConnection().catch(() => null);
  if (!conn) return false;
  const key = `${conn.broadcaster_id}:${userId}`;
  const hit = subs.get(key);
  if (hit && Date.now() - hit.at < SUB_MS) return hit.sub;
  // Ohne Abo antwortet Twitch mit 404; ohne Affiliate oder ohne Recht mit einem Fehler – beides heißt „kein Abo“
  const res = await helix("subscriptions", conn.access_token, { query: { broadcaster_id: conn.broadcaster_id, user_id: userId } })
    .catch(() => null);
  const sub = !!res?.data?.length;
  if (subs.size > 5000) subs.clear();
  subs.set(key, { at: Date.now(), sub });
  return sub;
}

// ---------- Sounds übers Panel ----------
// ID im Panel: eingebauter Sound wie „gong“, hochgeladener Sound als „c:<uuid>“
const soundId = (s: Awaited<ReturnType<typeof soundList>>[number]) => s.board ? s.board.id : `c:${s.custom!.id}`;

type SoundCfg = { panel_sounds: boolean; panel_sub_sounds?: string[]; panel_bits?: boolean; panel_bits_sku?: string };
async function soundCfg(): Promise<SoundCfg | null> {
  // panel_sub_sounds/panel_bits kommen mit …_panel_bits_subs.sql – fehlen sie, wie bisher
  const full = await db.from("prank_settings").select("panel_sounds, panel_sub_sounds, panel_bits, panel_bits_sku").eq("id", 1).maybeSingle();
  if (!full.error) return full.data as SoundCfg | null;
  const { data } = await db.from("prank_settings").select("panel_sounds").eq("id", 1).maybeSingle();
  return data as SoundCfg | null;
}

async function panelSounds() {
  const cfg = await soundCfg();
  if (!cfg?.panel_sounds) return { list: [], bits: null };
  const subOnly = new Set(cfg.panel_sub_sounds ?? []);
  const list = (await soundList()).slice(0, 20).map((s) => ({ id: soundId(s), name: s.name.slice(0, 40), sub: subOnly.has(soundId(s)) }));
  return { list, bits: cfg.panel_bits && BITS_SKUS.has(cfg.panel_bits_sku ?? "") ? cfg.panel_bits_sku! : null };
}

// Nur Sounds aus der eigenen Liste – nie einen Pfad oder Namen vom Zuschauer übernehmen
async function findSound(id: unknown) {
  if (typeof id !== "string" || id.length > 60) return null;
  return (await soundList()).slice(0, 20).find((s) => soundId(s) === id) ?? null;
}
const soundArgs = (sound: NonNullable<Awaited<ReturnType<typeof findSound>>>) => ({
  p_item: sound.board ? sound.board.id : "custom",
  p_path: sound.custom?.path ?? null,
  p_label: sound.custom?.name ?? "",
});

async function playSound(claims: Claims, id: unknown) {
  if (!claims.user_id) return { ok: false, reason: "share" };
  const sound = await findSound(id);
  if (!sound) return { ok: false, reason: "sound" };
  const cfg = await soundCfg();
  const sub = await isSubscriber(claims.user_id);
  if ((cfg?.panel_sub_sounds ?? []).includes(soundId(sound)) && !sub) return { ok: false, reason: "sub" };
  const { data: res, error } = await db.rpc("panel_sound_play", {
    p_key: `tw:${claims.user_id}`, p_name: await displayName(claims.user_id), ...soundArgs(sound), p_sub: sub,
  });
  if (error) throw error;
  return { ok: !!res?.ok, reason: res?.reason ?? null, wait: res?.wait ?? null };
}

// Sound gegen Bits: Twitch hat schon abgebucht – also immer abspielen, sobald die Quittung echt ist.
async function bitsSound(claims: Claims, id: unknown, receipt: unknown) {
  if (typeof receipt !== "string" || receipt.length > 4000) return { ok: false, reason: "receipt" };
  const r = await verifyJwt<Receipt>(receipt);
  const tx = r?.data;
  const userId = String(tx?.userId ?? "");
  const sku = String(tx?.product?.sku ?? "");
  if (!r || r.topic !== "bits_transaction_receipt" || !tx?.transactionId || !/^\d{1,20}$/.test(userId) || !BITS_SKUS.has(sku)) {
    return { ok: false, reason: "receipt" };
  }
  // Die Quittung gehört zu diesem Zuschauer (falls er seine ID freigegeben hat, muss sie passen)
  if (claims.user_id && claims.user_id !== userId) return { ok: false, reason: "receipt" };
  const sound = await findSound(id);
  if (!sound) return { ok: false, reason: "sound" };
  const { data: res, error } = await db.rpc("panel_sound_play", {
    p_key: `tw:${userId}`, p_name: await displayName(userId), ...soundArgs(sound),
    p_paid: String(tx.transactionId).slice(0, 100), p_sku: sku, p_bits: Number(tx.product?.cost?.amount ?? 0) || 0,
  });
  if (error) throw error;
  return { ok: !!res?.ok, reason: res?.reason ?? null, duplicate: !!res?.duplicate };
}
