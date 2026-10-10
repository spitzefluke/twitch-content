// Admin-Zugang ohne Registrierung.
// Das Passwort liegt als Secret ADMIN_PASSWORD in Supabase – nie im Repo.
//   POST {action:"login", password, code}   → {token, expires_at, mfa}
//                                              Zwei-Faktor-Code (TOTP, Authenticator-App) ist Pflicht: Ohne
//                                              eingerichteten Code gilt das Token nur zum Einrichten (mfa:false).
//   POST {action:"mfa_setup", token}        → neues Geheimnis + QR-Code (nur solange noch kein Code aktiv ist)
//   POST {action:"mfa_enable", token, code} → Code bestätigen, danach volles Token
//   POST {action:"security_report", token}  → Sicherheits-Check der Datenbank (Migration …_security.sql)
//   POST {action:"messages", token}         → Postfach: Nachrichten aus dem Kontaktformular (…_contact_showcase.sql)
//   POST {action:"message_set", token, id, status|delete} → als erledigt/neu markieren oder löschen
//   POST {action:"overview", token}         → Live-Daten für das Dashboard
//   POST {action:"twitch_check", token}     → Status des EventSub-Webhooks direkt bei Twitch
//   POST {action:"set_admin", token, user_id, is_admin}
//   POST {action:"site_session", token}     → Einmal-Code, mit dem admin.html auf der Webseite anmeldet
//   POST {action:"bot_start", token}        → Twitch-Login-URL für den Chat-Bot (zurück nach admin.html)
//   POST {action:"bot_disconnect", token}   → Chat-Bot trennen
//   POST {action:"channels", token}         → alle Streamer-Kanäle mit Bewerbungen (Migration …_platform.sql)
//   POST {action:"channel_status", token, channel_id, status, note?} → freischalten (active), sperren (blocked)
//                                              oder zurück auf „wartet“ (pending)
import QRCode from "npm:qrcode@1.5.4";
import { corsHeaders, db, env, getAppToken, helix, json, startTwitchLogin } from "../_shared/twitch.ts";

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

// mfa: true = mit Zwei-Faktor-Code angemeldet (volles Token); false = nur zum Einrichten des Codes
export async function createToken(now = Date.now(), mfa = true) {
  const exp = now + (mfa ? SESSION_HOURS * 3600_000 : 15 * 60_000);
  const payload = b64url(enc.encode(JSON.stringify({ exp, mfa })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await sessionKey(), enc.encode(payload)));
  return { token: `${payload}.${b64url(sig)}`, expires_at: new Date(exp).toISOString(), mfa };
}

// Gültiges Token → Inhalt (Tokens von vor der 2FA haben kein mfa und zählen nur zum Einrichten)
export async function verifyToken(token: unknown): Promise<{ exp: number; mfa: boolean } | null> {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await sessionKey(), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const { exp, mfa } = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return typeof exp === "number" && exp > Date.now() ? { exp, mfa: mfa === true } : null;
  } catch {
    return null;
  }
}

// ---------- Zwei-Faktor-Code (TOTP nach RFC 6238: 6 Ziffern, 30 Sekunden, SHA-1) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export async function totp(secret: Uint8Array, step: number, digits = 6): Promise<string> {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const key = await crypto.subtle.importKey("raw", new Uint8Array(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

// Passendes 30-Sekunden-Fenster (±1 wegen Uhrzeit-Abweichung) oder null.
// Fenster bis einschließlich lastStep zählen nicht: Ein Code gilt nur einmal.
export async function matchTotp(secretB32: string, code: unknown, lastStep = 0, now = Date.now()): Promise<number | null> {
  const c = typeof code === "string" ? code.replace(/\s+/g, "") : "";
  if (!/^\d{6}$/.test(c)) return null;
  const secret = base32Decode(secretB32);
  const step = Math.floor(now / 30_000);
  for (const s of [step, step - 1, step + 1]) {
    if (s <= lastStep) continue;
    if ((await totp(secret, s)) === c) return s;
  }
  return null;
}

type AdminMfa = { secret: string; enabled: boolean; last_step: number };
async function loadMfa(): Promise<AdminMfa | null | "missing"> {
  const { data, error } = await db.from("admin_mfa").select("secret, enabled, last_step").eq("id", 1).maybeSingle();
  if (error) return /admin_mfa/.test(error.message) ? "missing" : Promise.reject(error);
  return data as AdminMfa | null;
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
    if (body.action === "login") return await login(body.password, body.code);
    const session = await verifyToken(body.token);
    if (!session) return json({ error: "Sitzung abgelaufen. Bitte neu einloggen." }, 401);
    if (body.action === "mfa_setup") return await mfaSetup();
    if (body.action === "mfa_enable") return await mfaEnable(body.code);
    // Alles andere erst mit Zwei-Faktor-Code
    if (!session.mfa) return json({ error: "Bitte zuerst den Zwei-Faktor-Code einrichten.", mfa_setup: true }, 403);
    if (body.action === "security_report") return await securityReport();
    if (body.action === "messages") return await messages();
    if (body.action === "message_set") return await messageSet(body.id, body.status, body.delete === true);
    if (body.action === "overview") return json(await overview());
    if (body.action === "twitch_check") return json(await twitchCheck());
    if (body.action === "set_admin") return await setAdmin(body.user_id, body.is_admin);
    if (body.action === "site_session") return json(await siteSession());
    if (body.action === "bot_start") return json({ url: await startTwitchLogin(await ensureSiteAdmin(), "bot") });
    if (body.action === "channels") return await channels();
    if (body.action === "channel_status") return await channelStatus(body.channel_id, body.status, body.note);
    if (body.action === "bot_disconnect") {
      const { error } = await db.from("twitch_bot").delete().eq("id", 1);
      if (error) throw error;
      return json({ ok: true });
    }
    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

async function login(password: unknown, code: unknown) {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await db.from("admin_login_failures").select("id", { count: "exact", head: true }).gte("at", since);
  if ((count ?? 0) >= MAX_FAILURES) {
    return json({ error: "Zu viele Fehlversuche. Bitte 15 Minuten warten." }, 429);
  }
  const fail = async (message: string) => {
    await db.from("admin_login_failures").insert({ at: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: message }, 401);
  };
  const mfa = await loadMfa();
  const mfaOn = mfa !== "missing" && !!mfa?.enabled;
  // Gleiche Meldung für Passwort und Code – verrät nicht, welcher Teil falsch war
  if (!(await passwordMatches(password))) return fail(mfaOn ? "Passwort oder Code falsch." : "Falsches Passwort.");
  if (mfaOn && mfa && typeof mfa === "object") {
    const step = await matchTotp(mfa.secret, code, Number(mfa.last_step) || 0);
    if (step === null) return fail("Passwort oder Code falsch.");
    // Nur speichern, wenn niemand dasselbe Fenster schon benutzt hat (gleichzeitige Anmeldungen)
    const { data: used } = await db.from("admin_mfa").update({ last_step: step }).eq("id", 1).lt("last_step", step).select("id");
    if (!used?.length) return fail("Passwort oder Code falsch.");
  }
  await db.from("admin_login_failures").delete().lt("at", new Date(Date.now() - 86400_000).toISOString());
  // Ohne Migration …_security.sql gibt es keinen Ort für das Geheimnis – dann wie bisher
  if (mfa === "missing") return json({ ...(await createToken()), mfa_missing: true });
  return json(await createToken(Date.now(), mfaOn));
}

// Neues Geheimnis für die Authenticator-App. Ist schon ein Code aktiv, geht das nicht
// (zurücksetzen nur in Supabase: delete from public.admin_mfa; – siehe NOTFALLPLAN.md).
async function mfaSetup() {
  const mfa = await loadMfa();
  if (mfa === "missing") return json({ error: "In der Datenbank fehlt die Migration supabase/migrations/20261031000000_security.sql." }, 400);
  if (mfa?.enabled) return json({ error: "Der Zwei-Faktor-Code ist schon eingerichtet." }, 409);
  const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
  const { error } = await db.from("admin_mfa").upsert({ id: 1, secret, enabled: false, last_step: 0, created_at: new Date().toISOString() });
  if (error) throw error;
  const uri = `otpauth://totp/StreamHelp:Admin?secret=${secret}&issuer=StreamHelp&algorithm=SHA1&digits=6&period=30`;
  const qr = await QRCode.toString(uri, { type: "svg", margin: 1, color: { dark: "#000000", light: "#ffffff" } });
  return json({ secret, uri, qr });
}

async function mfaEnable(code: unknown) {
  const mfa = await loadMfa();
  if (mfa === "missing" || !mfa) return json({ error: "Erst den QR-Code erzeugen." }, 400);
  if (mfa.enabled) return json({ error: "Der Zwei-Faktor-Code ist schon eingerichtet." }, 409);
  const step = await matchTotp(mfa.secret, code, 0);
  if (step === null) return json({ error: "Der Code passt nicht. Uhrzeit am Handy prüfen und den aktuellen Code eingeben." }, 400);
  const { error } = await db.from("admin_mfa").update({ enabled: true, enabled_at: new Date().toISOString(), last_step: step }).eq("id", 1);
  if (error) throw error;
  return json(await createToken());
}

// ---------- Postfach (Kontaktformular) ----------
const CONTACT_MISSING = "In der Datenbank fehlt das Kontaktformular: supabase/migrations/20261101000000_contact_showcase.sql ausführen.";

async function messages() {
  const { data, error } = await db.from("contact_messages")
    .select("id, created_at, name, email, topic, message, lang, channel, status, done_at")
    .order("created_at", { ascending: false }).limit(200);
  if (error) return /contact_messages/.test(error.message) ? json({ error: CONTACT_MISSING, missing: true }, 400) : Promise.reject(error);
  return json({ messages: data });
}

async function messageSet(id: unknown, status: unknown, remove: boolean) {
  if (typeof id !== "number" || !Number.isInteger(id)) return json({ error: "Ungültige Nachricht" }, 400);
  if (remove) {
    const { error } = await db.from("contact_messages").delete().eq("id", id);
    if (error) throw error;
    return json({ ok: true });
  }
  if (status !== "new" && status !== "done") return json({ error: "Ungültiger Status" }, 400);
  const { error } = await db.from("contact_messages")
    .update({ status, done_at: status === "done" ? new Date().toISOString() : null }).eq("id", id);
  if (error) throw error;
  return json({ ok: true });
}

async function securityReport() {
  const { data, error } = await db.rpc("security_report");
  if (error) {
    if (error.code === "PGRST202") return json({ error: "In der Datenbank fehlt die Migration supabase/migrations/20261031000000_security.sql.", missing: true }, 400);
    throw error;
  }
  return json({ checks: data });
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
  // Getrennt abgefragt: Fehlt die Tabelle noch (Migration …_chat_bot.sql), bleibt der Rest heil.
  const bot = await db.from("twitch_bot").select("login, display_name, updated_at").eq("id", 1).maybeSingle();
  // Gesundheitscheck (Migration …_streamhelp.sql) – fehlt die Tabelle, bleibt er einfach weg
  const health = await db.from("twitch_health").select("checked_at, ok, problems, last_event_at, last_event_type").eq("id", 1).maybeSingle();

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
    twitch_bot: bot.error ? null : bot.data,
    twitch_bot_ready: !bot.error,
    twitch_health: health.error ? null : health.data,
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
// Merkmal in app_metadata – das kann nur der Server setzen, nie ein Nutzer beim Registrieren.
const SITE_ADMIN_MARK = "stellwerk_site_admin";

async function findUserByEmail(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) break;
  }
  return null;
}

// Liefert die ID des internen Accounts (auch Absender beim Twitch-Login des Bots).
// Hat sich jemand mit dieser E-Mail selbst registriert (dann fehlt das Merkmal),
// wird dieser Account gelöscht und ein neuer angelegt – sonst bekäme er beim
// nächsten Admin-Login die Admin-Rechte und könnte sich mit seinem eigenen
// Passwort anmelden.
async function ensureSiteAdmin(): Promise<string> {
  const existing = await findUserByEmail(SITE_ADMIN_EMAIL);
  if (existing?.app_metadata?.[SITE_ADMIN_MARK] === true) return existing.id;
  if (existing) {
    console.warn("Account mit der Admin-E-Mail ohne Merkmal gefunden – wird ersetzt:", existing.id);
    const { error } = await db.auth.admin.deleteUser(existing.id);
    if (error) throw error;
  }
  const created = await db.auth.admin.createUser({
    email: SITE_ADMIN_EMAIL,
    email_confirm: true,
    user_metadata: { username: "StreamHelp-Admin" },
    app_metadata: { [SITE_ADMIN_MARK]: true },
  });
  if (created.error || !created.data.user) throw created.error ?? new Error("Interner Admin-Account nicht angelegt");
  return created.data.user.id;
}

async function siteSession() {
  const id = await ensureSiteAdmin();

  // Erzeugt nur den Einmal-Code, verschickt keine E-Mail
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email: SITE_ADMIN_EMAIL });
  if (error) throw error;
  if (data.user.id !== id) throw new Error("Interner Admin-Account passt nicht – bitte erneut versuchen.");

  const { error: profileError } = await db.from("profiles")
    .upsert({ id, username: "StreamHelp-Admin", is_admin: true });
  if (profileError) throw profileError;

  return { token_hash: data.properties.hashed_token };
}

async function setAdmin(userId: unknown, isAdmin: unknown) {
  if (typeof userId !== "string" || typeof isAdmin !== "boolean") return json({ error: "Ungültige Anfrage" }, 400);
  const { error } = await db.from("profiles").update({ is_admin: isAdmin }).eq("id", userId);
  if (error) throw error;
  return json({ ok: true });
}

// ---------- Streamer-Kanäle (Plattform) ----------
const PLATFORM_MISSING = "Die Plattform ist noch nicht eingerichtet: In Supabase im SQL Editor die Datei supabase/migrations/20261028000000_platform.sql ausführen.";

async function channels() {
  const { data, error } = await db.rpc("channels_admin");
  if (error) {
    if (/channels_admin/.test(error.message)) return json({ error: PLATFORM_MISSING, missing: true }, 400);
    throw error;
  }
  return json({ channels: data });
}

async function channelStatus(channelId: unknown, status: unknown, note: unknown) {
  if (typeof channelId !== "string" || !/^[0-9a-f-]{36}$/i.test(channelId)) return json({ error: "Ungültiger Kanal" }, 400);
  if (status !== "active" && status !== "blocked" && status !== "pending") return json({ error: "Ungültiger Status" }, 400);
  const { data, error } = await db.rpc("channel_set_status", {
    p_channel: channelId,
    p_status: status,
    p_admin_note: typeof note === "string" ? note.slice(0, 300) : null,
  });
  if (error) {
    if (/channel_set_status/.test(error.message)) return json({ error: PLATFORM_MISSING, missing: true }, 400);
    return json({ error: error.message }, 400);
  }
  return json({ channels: data });
}
