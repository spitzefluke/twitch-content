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

// Angemeldeten Supabase-User aus dem Authorization-Header lesen
export async function getUserFromRequest(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error ? null : data.user;
}

// ---------- Twitch API ----------
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

export async function getAppToken(): Promise<string> {
  return (await twitchToken({ grant_type: "client_credentials" })).access_token;
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
  subscription_id: string | null;
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

export async function sendChat(conn: Connection, message: string) {
  const res = await helix("chat/messages", conn.access_token, {
    method: "POST",
    body: { broadcaster_id: conn.broadcaster_id, sender_id: conn.broadcaster_id, message: message.slice(0, 500) },
  });
  const r = res?.data?.[0];
  if (r && !r.is_sent) throw new Error(`Chat-Nachricht blockiert: ${r.drop_reason?.message ?? "unbekannt"}`);
}

// ---------- Glücksrad ----------
type Segment = { label: string; detail: string };
type Variant = { id: string; name: string; color: string; segments: Segment[] };

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
  const { data: spin, error: insertError } = await db.from("spins").insert({
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

export function chatText(spin: { source: string; requested_by: string; variant_name: string; result: string; detail: string }) {
  const who = spin.source === "twitch" ? `für @${spin.requested_by}` : "(Website)";
  return `🎡 Glücksrad ${who}: [${spin.variant_name}] ${spin.result} – ${spin.detail} Gilt für die nächste Runde!`;
}
