// Admin-Zugang ohne Registrierung.
// Das Passwort liegt als Secret ADMIN_PASSWORD in Supabase – nie im Repo.
//   POST {action:"login", password}         → {token, expires_at}
//   POST {action:"overview", token}         → Live-Daten für das Dashboard
//   POST {action:"twitch_check", token}     → Status des EventSub-Webhooks direkt bei Twitch
//   POST {action:"set_admin", token, user_id, is_admin}
//   POST {action:"site_session", token}     → Einmal-Code, mit dem admin.html auf der Webseite anmeldet
import { corsHeaders, db, env, getAppToken, helix, json } from "../_shared/twitch.ts";

const SESSION_HOURS = 12;
const MAX_FAILURES = 10; // pro 15 Minuten, danach Sperre
const enc = new TextEncoder();

// Schlüssel hängt am Passwort: Passwort ändern = alle Sitzungen ungültig
let keyPromise: Promise<CryptoKey> | null = null;
const sessionKey = () =>
  keyPromise ??= crypto.subtle.importKey(
    "raw",
    enc.encode(`${env("SUPABASE_SERVICE_ROLE_KEY")}:${env("ADMIN_PASSWORD")}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

export async function createToken(now = Date.now()) {
  const exp = now + SESSION_HOURS * 3600_000;
  const payload = b64url(enc.encode(JSON.stringify({ exp })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await sessionKey(), enc.encode(payload)));
  return { token: `${payload}.${b64url(sig)}`, expires_at: new Date(exp).toISOString() };
}

export async function verifyToken(token: unknown): Promise<boolean> {
  if (typeof token !== "string") return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  try {
    const ok = await crypto.subtle.verify("HMAC", await sessionKey(), fromB64url(sig), enc.encode(payload));
    if (!ok) return false;
    const { exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

// Vergleich über Hashes, damit die Laufzeit nichts über das Passwort verrät
export async function passwordMatches(input: unknown): Promise<boolean> {
  if (typeof input !== "string" || !input) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(input)),
    crypto.subtle.digest("SHA-256", enc.encode(env("ADMIN_PASSWORD"))),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);
  if (!Deno.env.get("ADMIN_PASSWORD")) {
    return json({ error: "Kein Admin-Passwort gesetzt (Secret ADMIN_PASSWORD fehlt)." }, 503);
  }

  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "login") return await login(body.password);
    if (!(await verifyToken(body.token))) return json({ error: "Sitzung abgelaufen. Bitte neu einloggen." }, 401);
    if (body.action === "overview") return json(await overview());
    if (body.action === "twitch_check") return json(await twitchCheck());
    if (body.action === "set_admin") return await setAdmin(body.user_id, body.is_admin);
    if (body.action === "site_session") return json(await siteSession());
    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

async function login(password: unknown) {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await db.from("admin_login_failures").select("id", { count: "exact", head: true }).gte("at", since);
  if ((count ?? 0) >= MAX_FAILURES) {
    return json({ error: "Zu viele Fehlversuche. Bitte 15 Minuten warten." }, 429);
  }
  if (!(await passwordMatches(password))) {
    await db.from("admin_login_failures").insert({ at: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "Falsches Passwort." }, 401);
  }
  await db.from("admin_login_failures").delete().lt("at", new Date(Date.now() - 86400_000).toISOString());
  return json(await createToken());
}

async function overview() {
  const since14d = new Date(Date.now() - 15 * 86400_000).toISOString();
  const [users, profiles, recent, total, twitchCount, last14d, conn, variants] = await Promise.all([
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    db.from("profiles").select("id, username, is_admin"),
    db.from("spins").select("*").order("created_at", { ascending: false }).limit(40),
    db.from("spins").select("id", { count: "exact", head: true }),
    db.from("spins").select("id", { count: "exact", head: true }).eq("source", "twitch"),
    db.from("spins").select("created_at, source, variant_id").gte("created_at", since14d).limit(10000),
    db.from("twitch_connection")
      .select("broadcaster_login, display_name, expires_at, scopes, reward_id, reward_title, reward_cost, subscription_id, updated_at")
      .eq("id", 1).maybeSingle(),
    db.from("wheel_variants").select("id, name, color").order("position"),
  ]);
  for (const r of [users, profiles, recent, total, twitchCount, last14d, conn, variants]) {
    if (r.error) throw r.error;
  }

  const byId = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const userList = users.data.users.map((u) => ({
    id: u.id,
    email: u.email,
    username: byId.get(u.id)?.username ?? u.email,
    is_admin: byId.get(u.id)?.is_admin ?? false,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
    confirmed: !!u.email_confirmed_at,
    provider: (u.app_metadata?.provider as string | undefined) ?? "email",
  })).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  const twitchSpins = twitchCount.count ?? 0;
  return {
    now: new Date().toISOString(),
    stats: {
      users: userList.length,
      spins_total: total.count ?? 0,
      spins_twitch: twitchSpins,
      points_spent: twitchSpins * (conn.data?.reward_cost ?? 0),
    },
    spins_recent: recent.data,
    spins_14d: last14d.data,
    variants: variants.data,
    users: userList,
    twitch: conn.data,
  };
}

async function twitchCheck() {
  const { data: conn } = await db.from("twitch_connection").select("subscription_id").eq("id", 1).maybeSingle();
  if (!conn?.subscription_id) return { found: false, status: "keine Subscription gespeichert" };
  const res = await helix("eventsub/subscriptions", await getAppToken(), {
    query: { type: "channel.channel_points_custom_reward_redemption.add" },
  });
  const sub = (res.data ?? []).find((s: { id: string }) => s.id === conn.subscription_id);
  return sub
    ? { found: true, status: sub.status, created_at: sub.created_at, callback: sub.transport?.callback }
    : { found: false, status: "bei Twitch nicht gefunden" };
}

// Interner Account für den Admin-Zugang auf der Webseite. Er hat kein Passwort
// und ist nur über diese Funktion (also mit dem Admin-Passwort) erreichbar.
// example.com ist eine reservierte Domain – es wird nie eine Mail verschickt.
const SITE_ADMIN_EMAIL = "stellwerk-admin@example.com";

async function siteSession() {
  const created = await db.auth.admin.createUser({
    email: SITE_ADMIN_EMAIL,
    email_confirm: true,
    user_metadata: { username: "Stellwerk-Admin" },
  });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) throw created.error;

  // Erzeugt nur den Einmal-Code, verschickt keine E-Mail
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email: SITE_ADMIN_EMAIL });
  if (error) throw error;

  const { error: profileError } = await db.from("profiles")
    .upsert({ id: data.user.id, username: "Stellwerk-Admin", is_admin: true });
  if (profileError) throw profileError;

  return { token_hash: data.properties.hashed_token };
}

async function setAdmin(userId: unknown, isAdmin: unknown) {
  if (typeof userId !== "string" || typeof isAdmin !== "boolean") return json({ error: "Ungültige Anfrage" }, 400);
  const { error } = await db.from("profiles").update({ is_admin: isAdmin }).eq("id", userId);
  if (error) throw error;
  return json({ ok: true });
}
