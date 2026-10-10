// Gemeinsame Helfer für alle Edge Functions.
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-channel",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function env(name: string, fallback?: string): string {
  const value = Deno.env.get(name) ?? fallback;
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return value;
}

// ---------- Kanal (Migration …_platform.sql) ----------
// Jede Anfrage gehört zu einem Kanal: Die Webseite und das Overlay schicken ihn im Header
// x-channel (Kanal-ID oder Twitch-Login), EventSub über die Twitch-ID des Streamers.
// Alles, was währenddessen über db läuft, schickt den Kanal mit – die Datenbank zeigt dann nur
// dessen Zeilen. Ohne Kanal: der Standard-Kanal (wie vor der Plattform).
type ChannelCtx = { channel: string | null; id?: Promise<string | null> };
const channelStore = new AsyncLocalStorage<ChannelCtx>();
const makeClient = (channel: string | null) =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: channel ? { headers: { "x-channel": channel } } : undefined,
  });
type Db = ReturnType<typeof makeClient>;
const clients = new Map<string, Db>();

function clientFor(channel: string | null): Db {
  const key = channel ?? "";
  let client = clients.get(key);
  if (!client) {
    client = makeClient(channel);
    clients.set(key, client);
  }
  return client;
}

// Service-Client für den Kanal der laufenden Anfrage
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const client = clientFor(channelStore.getStore()?.channel ?? null);
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

const CHANNEL_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9_]{1,25})$/;
export function cleanChannel(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return CHANNEL_RE.test(v) ? v : null;
}

export function withChannel<T>(channel: string | null, fn: () => Promise<T>): Promise<T> {
  return channelStore.run({ channel: cleanChannel(channel) }, fn);
}

// Deno.serve(channelServe(handler)): Kanal aus dem Header x-channel
export function channelServe(handler: (req: Request) => Response | Promise<Response>) {
  return (req: Request) => withChannel(req.headers.get("x-channel"), async () => await handler(req));
}

// ID des Kanals dieser Anfrage (null: Plattform-Migration fehlt noch oder Kanal unbekannt)
export function currentChannelId(): Promise<string | null> {
  const store = channelStore.getStore();
  const load = async () => {
    const { data, error } = await db.rpc("current_channel");
    return error ? null : (data as string | null);
  };
  if (!store) return load();
  return store.id ??= load();
}

export type Channel = {
  id: string; login: string | null; twitch_id: string | null; display_name: string;
  owner_id: string | null; status: string; is_default: boolean;
};

export async function currentChannel(): Promise<Channel | null> {
  const id = await currentChannelId();
  if (!id) return null;
  const { data } = await db.from("channels").select("id, login, twitch_id, display_name, owner_id, status, is_default")
    .eq("id", id).maybeSingle();
  return data as Channel | null;
}

// Gibt es die Plattform (Migration …_platform.sql) schon?
let platformReady: Promise<boolean> | null = null;
export function hasPlatform(): Promise<boolean> {
  return platformReady ??= (async () => {
    const { error } = await clientFor(null).from("channels").select("id").limit(1);
    if (error) platformReady = null; // später noch einmal fragen
    return !error;
  })();
}

// Schlüssel für upsert: Mit der Plattform gelten sie je Kanal (channel_id kommt automatisch dazu)
export async function channelKey(cols: string): Promise<string> {
  return (await hasPlatform()) ? `channel_id,${cols}` : cols;
}

// Alle freigeschalteten Kanäle (für Zeitpläne und den gemeinsamen Bot)
export async function activeChannels(): Promise<Channel[]> {
  if (!(await hasPlatform())) return [];
  const { data, error } = await clientFor(null).from("channels")
    .select("id, login, twitch_id, display_name, owner_id, status, is_default").eq("status", "active");
  if (error) throw error;
  return (data ?? []) as Channel[];
}

// Kanal zu einer Twitch-ID (EventSub). Ohne Plattform: der Standard-Kanal (null).
export async function channelForTwitch(twitchId: string | undefined): Promise<{ known: boolean; id: string | null }> {
  if (!(await hasPlatform())) return { known: true, id: null };
  if (!twitchId) return { known: false, id: null };
  const { data, error } = await clientFor(null).rpc("channel_by_twitch", { p_twitch_id: twitchId });
  if (error) throw error;
  return data ? { known: true, id: data as string } : { known: false, id: null };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export class CodedError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

// Bereiche, die der Streamer einzelnen Mods sperren kann (Migration …_security.sql, mod_areas())
export type ModArea = "ideas" | "wheel" | "bingo" | "games" | "giveaway" | "pranks" | "pet" | "overlay" | "chat" | "points" | "guard";

// Admin für die Inhalte des Kanals: Inhaber, Plattform-Admin, Admin-Häkchen (nur Standard-Kanal)
// oder vom Streamer freigegebener Mod (is_admin_user). Mit area zählen Mods nur, wenn der Streamer
// ihnen diesen Bereich nicht gesperrt hat. Fehlt die Funktion noch, zählt nur das Häkchen.
export async function isAdminUser(userId: string, area?: ModArea): Promise<boolean> {
  if (area) {
    const { data, error } = await db.rpc("is_admin_user_in", { p_user: userId, p_area: area });
    if (!error) return data === true;
    if (error.code !== "PGRST202") throw error; // nur „Funktion fehlt“ (Migration fehlt) fällt zurück
  }
  const { data, error } = await db.rpc("is_admin_user", { p_user: userId });
  if (!error) return data === true;
  const { data: profile } = await db.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  return !!profile?.is_admin;
}

// Rate-Limit (Migration …_security.sql): true = noch erlaubt. Fehlt die Funktion oder hakt die
// Datenbank, lässt es die Anfrage durch – die Grenze soll schützen, nicht die Seite lahmlegen.
export async function rateLimit(key: string, max: number, windowSec = 60): Promise<boolean> {
  try {
    const { data, error } = await clientFor(null).rpc("rate_hit", { p_key: key, p_max: max, p_window: windowSec });
    return error ? true : data !== false;
  } catch {
    return true;
  }
}

export const tooMany = () => json({ error: "Zu viele Anfragen – bitte kurz warten." }, 429);

// Mod-Protokoll: Aktion eines Kontos im Kanal der Anfrage (nur Streamer, Mods, Admins landen dort)
export async function audit(userId: string, action: string, detail: Record<string, unknown> = {}) {
  try {
    const { error } = await db.rpc("audit_add", { p_user: userId, p_action: action, p_detail: detail });
    if (error && error.code !== "PGRST202") console.warn("Protokoll:", error.message);
  } catch (e) {
    console.warn("Protokoll:", e);
  }
}

// Plattform-Admin (das StreamHelp-Admin-Konto aus dem Admin-Bereich). Vor der Plattform-Migration
// gab es nur einen Kanal – dann reicht Admin wie bisher.
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  if (!(await hasPlatform())) return isAdminUser(userId);
  const { data, error } = await db.rpc("is_site_admin_user", { p_user: userId });
  if (error) throw error;
  return data === true;
}

// Inhaber des Kanals: wer ihn angemeldet oder Twitch verbunden hat, der Plattform-Admin
// und – nur im Standard-Kanal – das Admin-Häkchen von früher.
export async function isChannelOwner(userId: string): Promise<boolean> {
  const channel = await currentChannel();
  if (channel?.owner_id === userId) return true;
  const { data: conn } = await db.from("twitch_connection").select("connected_by").eq("id", 1).maybeSingle();
  if (conn?.connected_by === userId) return true;
  if (channel && (await isPlatformAdmin(userId))) return true;
  if (channel && !channel.is_default) return false;
  const { data: profile } = await db.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  return !!profile?.is_admin;
}

// Angemeldeten Supabase-User aus dem Authorization-Header lesen.
// Zwei-Faktor-Anmeldung: Hat das Konto 2FA eingerichtet, zählt die Sitzung erst nach
// bestätigtem Code (aal2) – vorher gilt die Anfrage als nicht angemeldet.
export async function getUserFromRequest(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const hasMfa = (data.user.factors ?? []).some((f) => f.status === "verified");
  if (hasMfa && tokenClaims(token).aal !== "aal2") return null;
  return data.user;
}

// Inhalt eines JWT lesen (ohne Prüfung – nur nach getUser(), das ihn bei Supabase geprüft hat)
function tokenClaims(token: string): { aal?: string } {
  try {
    const part = token.split(".")[1] ?? "";
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4)));
  } catch {
    return {};
  }
}

// ---------- Twitch API ----------
// Streamer: Kanalpunkte verwalten, Vorhersagen fürs Bingo starten und dem Bot erlauben,
// in seinem Chat zu schreiben. Selbst schreibt die Seite nie in Namen des Streamers – dafür gibt es den Bot.
// Dazu Follower, Abos und Bits lesen – für die Alerts im OBS-Overlay –, und die Mods
// des Kanals, damit sie auf der Seite mitsteuern dürfen (wenn der Streamer es freigibt).
export const BROADCASTER_SCOPES = [
  "channel:read:redemptions", "channel:manage:redemptions", "channel:bot", "channel:manage:predictions",
  "moderator:read:followers", "channel:read:subscriptions", "bits:read", "moderation:read",
  "moderator:read:chatters",
];
// Bot-Account: darf als Bot in Chats schreiben (gesendet wird mit dem App-Token)
// und den Chat des Streamers lesen – für Befehle wie !füttern.
export const BOT_SCOPES = ["user:write:chat", "user:bot", "user:read:chat"];
export const oauthRedirectUri = () => `${env("SUPABASE_URL")}/functions/v1/twitch-oauth`;

// Twitch-Login starten. Den Rückweg (twitch-oauth, GET) findet der state:
// Der Kanal des Streamers geht zurück auf die Webseite, der Bot in den Admin-Bereich.
export async function startTwitchLogin(userId: string, kind: "broadcaster" | "bot") {
  const state = crypto.randomUUID() + crypto.randomUUID();
  // "kind" nur beim Bot mitschicken: So klappt das Verbinden des Streamers auch, solange
  // die Migration …_chat_bot.sql (Spalte kind) noch nicht eingespielt ist.
  const row: Record<string, string> = kind === "bot" ? { state, user_id: userId, kind } : { state, user_id: userId };
  // Für welchen Kanal verbunden wird (der Rückweg von Twitch kennt keinen Header)
  const channelId = kind === "broadcaster" ? await currentChannelId() : null;
  if (channelId) row.channel_id = channelId;
  const { error } = await db.from("oauth_states").insert(row);
  if (error) throw error;
  // alte, nicht abgeschlossene Anfragen aufräumen
  await db.from("oauth_states").delete().lt("created_at", new Date(Date.now() - 3600_000).toISOString());

  const auth = new URL("https://id.twitch.tv/oauth2/authorize");
  auth.search = new URLSearchParams({
    response_type: "code",
    client_id: env("TWITCH_CLIENT_ID"),
    redirect_uri: oauthRedirectUri(),
    scope: (kind === "bot" ? BOT_SCOPES : BROADCASTER_SCOPES).join(" "),
    state,
    force_verify: "true",
  }).toString();
  return auth.toString();
}

export async function twitchToken(params: Record<string, string>) {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("TWITCH_CLIENT_ID"),
      client_secret: env("TWITCH_CLIENT_SECRET"),
      ...params,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Twitch-Token: ${data.message ?? res.status}`);
  return data as { access_token: string; refresh_token?: string; expires_in: number; scope?: string[] };
}

// App-Token wird wiederverwendet, solange er gilt (Twitch: ca. 60 Tage) –
// nicht für jede Chat-Nachricht einen neuen holen.
let appToken: { token: string; expires: number } | null = null;
export async function getAppToken(): Promise<string> {
  if (appToken && appToken.expires - Date.now() > 60_000) return appToken.token;
  const t = await twitchToken({ grant_type: "client_credentials" });
  appToken = { token: t.access_token, expires: Date.now() + t.expires_in * 1000 };
  return appToken.token;
}

export class HelixError extends Error {
  constructor(public status: number, public data: { message?: string } | null, path: string) {
    super(`Helix ${path}: ${status} ${data?.message ?? ""}`);
  }
}

export async function helix(
  path: string,
  token: string,
  init: { method?: string; query?: Record<string, string | string[]>; body?: unknown } = {},
) {
  const url = new URL(`https://api.twitch.tv/helix/${path}`);
  // Listen werden als wiederholter Parameter geschickt (z. B. users?id=1&id=2)
  for (const [k, v] of Object.entries(init.query ?? {})) {
    for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
  }
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      "Client-Id": env("TWITCH_CLIENT_ID"),
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new HelixError(res.status, data, path);
  return data;
}

export type Connection = {
  broadcaster_id: string;
  broadcaster_login: string;
  display_name: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  reward_id: string | null;
  reward_cost?: number | null;
  scopes?: string[] | null;
  subscription_id: string | null;
  prank_throw_reward_id?: string | null;
  prank_sound_reward_id?: string | null;
};

// Verbindung laden und Token bei Bedarf erneuern
export async function getConnection(): Promise<Connection | null> {
  const { data, error } = await db.from("twitch_connection").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (Date.parse(data.expires_at) - Date.now() > 5 * 60_000) return data;

  const t = await twitchToken({ grant_type: "refresh_token", refresh_token: data.refresh_token });
  const patch = {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? data.refresh_token,
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await db.from("twitch_connection").update(patch).eq("id", 1);
  return { ...data, ...patch };
}

export async function getBot(): Promise<{ user_id: string; login: string; display_name: string } | null> {
  const { data, error } = await db.from("twitch_bot").select("user_id, login, display_name").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data;
}

// Chat-Nachrichten schreibt der StreamHelp-Bot, nie der Streamer selbst. Gesendet
// wird mit dem App-Token: Dafür hat der Bot user:bot freigegeben und der Streamer
// channel:bot (oder der Bot ist Moderator im Kanal). Twitch zeigt dann das
// Bot-Abzeichen. Ohne verbundenen Bot bleibt der Chat still.
export async function sendChat(conn: Connection, message: string) {
  const bot = await getBot();
  if (!bot) throw new CodedError("no_bot", "Kein Chat-Bot verbunden – Nachricht nicht gesendet");
  const res = await helix("chat/messages", await getAppToken(), {
    method: "POST",
    body: { broadcaster_id: conn.broadcaster_id, sender_id: bot.user_id, message: message.slice(0, 500) },
  });
  const r = res?.data?.[0];
  if (r && !r.is_sent) throw new Error(`Chat-Nachricht blockiert: ${r.drop_reason?.message ?? "unbekannt"}`);
}

// ---------- Glücksrad ----------
type Segment = { label: string; detail: string; color?: string };
// bonus: zweites Rad, das direkt danach dreht (z. B. Seltenheit nach der Waffe)
type Variant = { id: string; name: string; color: string; segments: Segment[]; bonus?: { name: string; segments: Segment[] } | null };

// Unverzerrte Zufallszahl 0..max-1
export function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

export async function performSpin(opts: {
  variantId?: string | null;
  source: "web" | "twitch";
  requestedBy: string;
  userId?: string | null;
  redemptionId?: string | null;
}) {
  const { data: variants, error } = await db.from("wheel_variants").select("*").order("position");
  if (error) throw error;
  if (!variants?.length) throw new Error("Keine Glücksrad-Varianten angelegt");

  const variant: Variant | undefined = opts.variantId
    ? variants.find((v: Variant) => v.id === opts.variantId)
    : variants[randomInt(variants.length)];
  if (!variant) throw new CodedError("unknown_variant", "Unbekannte Variante");

  const index = randomInt(variant.segments.length);
  const segment = variant.segments[index];
  // Die Spalten fürs zweite Rad gibt es erst mit …_wheel_bonus.sql – nur mitschicken, wenn es eins gibt
  const bonus = variant.bonus?.segments?.length ? variant.bonus : null;
  const bonusIndex = bonus ? randomInt(bonus.segments.length) : null;
  const bonusFields = bonus && bonusIndex !== null
    ? {
      bonus_name: bonus.name,
      bonus_index: bonusIndex,
      bonus_result: bonus.segments[bonusIndex].label,
      bonus_detail: bonus.segments[bonusIndex].detail ?? "",
    }
    : {};
  const { data: spin, error: insertError } = await db.from("spins").insert({
    ...bonusFields,
    source: opts.source,
    variant_id: variant.id,
    variant_name: variant.name,
    segment_index: index,
    result: segment.label,
    detail: segment.detail,
    requested_by: opts.requestedBy,
    user_id: opts.userId ?? null,
    redemption_id: opts.redemptionId ?? null,
  }).select().single();
  if (insertError) {
    if (insertError.code === "23505") throw new CodedError("duplicate");
    throw insertError;
  }
  return spin;
}

export function chatText(spin: {
  source: string; requested_by: string; variant_name: string; result: string; detail: string;
  bonus_name?: string | null; bonus_result?: string | null; bonus_detail?: string | null;
}) {
  const who = spin.source === "twitch" ? `für @${spin.requested_by}` : "(Website)";
  if (spin.bonus_result) {
    const extra = [spin.detail, spin.bonus_detail].filter(Boolean).join(" ");
    return `🎡 Glücksrad ${who}: [${spin.variant_name}] ${spin.result} + ${spin.bonus_name ?? "Bonus"}: ${spin.bonus_result}! ${extra} Gilt für die nächste Runde!`
      .replace(/\s+/g, " ");
  }
  return `🎡 Glücksrad ${who}: [${spin.variant_name}] ${spin.result} – ${spin.detail} Gilt für die nächste Runde!`;
}
