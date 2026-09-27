// Gemeinsame Helfer für alle Edge Functions.
import { createClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function env(name: string, fallback?: string): string {
  const value = Deno.env.get(name) ?? fallback;
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return value;
}

export const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

// Admin für die Inhalte: Admin-Häkchen oder vom Streamer freigegebener Mod
// (is_admin_user, Migration …_streamer_mods.sql). Fehlt die Funktion noch, zählt nur das Häkchen.
export async function isAdminUser(userId: string): Promise<boolean> {
  const { data, error } = await db.rpc("is_admin_user", { p_user: userId });
  if (!error) return data === true;
  const { data: profile } = await db.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  return !!profile?.is_admin;
}

// Angemeldeten Supabase-User aus dem Authorization-Header lesen
export async function getUserFromRequest(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error ? null : data.user;
}

// ---------- Twitch API ----------
// Streamer: Kanalpunkte verwalten, Vorhersagen fürs Bingo starten und dem Bot erlauben,
// in seinem Chat zu schreiben. Selbst schreibt die Seite nie in Daves Namen – dafür gibt es den Bot.
// Dazu Follower, Abos und Bits lesen – für die Alerts im OBS-Overlay –, und die Mods
// des Kanals, damit sie auf der Seite mitsteuern dürfen (wenn der Streamer es freigibt).
export const BROADCASTER_SCOPES = [
  "channel:read:redemptions", "channel:manage:redemptions", "channel:bot", "channel:manage:predictions",
  "moderator:read:followers", "channel:read:subscriptions", "bits:read", "moderation:read",
];
// Bot-Account: darf als Bot in Chats schreiben (gesendet wird mit dem App-Token)
// und Daves Chat lesen – für Befehle wie !füttern.
export const BOT_SCOPES = ["user:write:chat", "user:bot", "user:read:chat"];
export const oauthRedirectUri = () => `${env("SUPABASE_URL")}/functions/v1/twitch-oauth`;

// Twitch-Login starten. Den Rückweg (twitch-oauth, GET) findet der state:
// Daves Kanal geht zurück auf die Webseite, der Bot in den Admin-Bereich.
export async function startTwitchLogin(userId: string, kind: "broadcaster" | "bot") {
  const state = crypto.randomUUID() + crypto.randomUUID();
  // "kind" nur beim Bot mitschicken: So klappt Daves Verbinden auch, solange
  // die Migration …_chat_bot.sql (Spalte kind) noch nicht eingespielt ist.
  const row = kind === "bot" ? { state, user_id: userId, kind } : { state, user_id: userId };
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
  init: { method?: string; query?: Record<string, string>; body?: unknown } = {},
) {
  const url = new URL(`https://api.twitch.tv/helix/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
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

// Chat-Nachrichten schreibt der Stellwerk-Bot, nie Dave selbst. Gesendet
// wird mit dem App-Token: Dafür hat der Bot user:bot freigegeben und Dave
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
