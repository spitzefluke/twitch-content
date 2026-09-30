// Twitch-Gesundheitscheck: Kann die Verbindung alles, was StreamHelp inzwischen nutzt?
//   · Rechte (Scopes) des Streamer-Kontos – neue Funktionen brauchen oft neue Rechte,
//     dann muss der Streamer Twitch einmal neu verbinden
//   · EventSub-Abos bei Twitch (Follows, Abos, Bits, Kanalpunkte, Chat) – fehlende oder von
//     Twitch abgeschaltete werden neu angelegt
//   · Chat-Bot verbunden? Secrets gesetzt?
// Das Ergebnis steht in twitch_health (Migration …_streamhelp.sql); Streamer, Mods und
// Admins sehen Probleme sofort im Dashboard.
import { BROADCASTER_SCOPES, db, env, getAppToken, getBot, getConnection, helix } from "./twitch.ts";
import { ALERT_TYPES, ensureAlertSubscriptions } from "./alerts.ts";
import { ensureRedemptionSubscription } from "./pranks.ts";
import { ensureChatSubscription } from "./chat.ts";

type Problem = { code: string; level: "error" | "warn"; text: string; fix: string };

const SCOPE_FEATURE: Record<string, string> = {
  "channel:read:redemptions": "Kanalpunkte-Einlösungen",
  "channel:manage:redemptions": "Kanalpunkte-Belohnungen",
  "channel:bot": "Chat-Bot im Kanal",
  "channel:manage:predictions": "Bingo-Tipprunde",
  "moderator:read:followers": "Follower-Alerts",
  "channel:read:subscriptions": "Abo-Alerts",
  "bits:read": "Bits-Alerts",
  "moderation:read": "Mods erkennen",
};

const eventsubCallback = () => `${env("SUPABASE_URL")}/functions/v1/twitch-eventsub`;

// Welche Rechte hat der Token wirklich? (Twitch sagt es beim Prüfen des Tokens)
async function tokenScopes(token: string): Promise<string[] | null> {
  const res = await fetch("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data.scopes) ? data.scopes : [];
}

export async function runHealthCheck({ repair = true } = {}) {
  const problems: Problem[] = [];
  const details: Record<string, unknown> = {};
  const add = (p: Problem) => problems.push(p);

  for (const name of ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "EVENTSUB_SECRET", "SITE_URL"]) {
    if (!Deno.env.get(name)) {
      add({ code: `secret_${name.toLowerCase()}`, level: "error", text: `In Supabase fehlt das Secret ${name}.`, fix: "Supabase → Edge Functions → Secrets" });
    }
  }
  const secret = Deno.env.get("EVENTSUB_SECRET") ?? "";
  if (secret && (secret.length < 10 || secret.length > 100)) {
    add({ code: "secret_length", level: "error", text: "EVENTSUB_SECRET muss 10 bis 100 Zeichen lang sein – sonst lehnt Twitch die Abos ab.", fix: "Secret neu setzen, dann hier prüfen" });
  }

  let conn = null;
  try {
    conn = await getConnection();
  } catch (e) {
    add({ code: "token_refresh", level: "error", text: `Die Twitch-Verbindung ist abgelaufen oder wurde widerrufen (${(e as Error).message.slice(0, 80)}).`, fix: "Streamer: Twitch neu verbinden" });
  }
  if (!conn) {
    if (!problems.some((p) => p.code === "token_refresh")) {
      add({ code: "not_connected", level: "error", text: "Twitch ist noch nicht verbunden – ohne Verbindung keine Alerts, Kanalpunkte und Chat-Befehle.", fix: "Streamer: Twitch verbinden" });
    }
    return save(problems, details);
  }
  details.channel = conn.display_name;

  // 1) Rechte: fehlt etwas für neue Funktionen?
  const scopes = await tokenScopes(conn.access_token).catch(() => null);
  if (scopes === null) {
    add({ code: "token_invalid", level: "error", text: "Twitch nimmt den gespeicherten Zugang nicht mehr an.", fix: "Streamer: Twitch neu verbinden" });
  } else {
    const missing = BROADCASTER_SCOPES.filter((s) => !scopes.includes(s));
    details.scopes = { granted: scopes, missing };
    if (missing.length) {
      add({
        code: "missing_scopes", level: "error",
        text: `Neue Funktionen brauchen neue Twitch-Rechte: ${missing.map((s) => SCOPE_FEATURE[s] ?? s).join(", ")}.`,
        fix: "Streamer: Twitch einmal neu verbinden und alles erlauben",
      });
    }
    // Gespeicherte Rechte auf den echten Stand bringen
    if (JSON.stringify([...(conn.scopes ?? [])].sort()) !== JSON.stringify([...scopes].sort())) {
      await db.from("twitch_connection").update({ scopes }).eq("id", 1);
      conn.scopes = scopes;
    }
  }

  // 2) Abos bei Twitch: reparieren, dann Stand lesen
  const subs: Record<string, { state: string; status?: string; message?: string }> = {};
  if (repair && secret) {
    const alertState = await ensureAlertSubscriptions(conn.broadcaster_id, eventsubCallback(), secret, conn.scopes ?? []).catch((e) => {
      add({ code: "alerts_repair", level: "error", text: `Alert-Abos konnten nicht angelegt werden: ${(e as Error).message.slice(0, 120)}`, fix: "Später erneut prüfen" });
      return {} as Record<string, { state: string; message?: string }>;
    });
    Object.assign(subs, alertState);
    await ensureRedemptionSubscription(conn.broadcaster_id, eventsubCallback(), secret)
      .then((id) => db.from("twitch_connection").update({ subscription_id: id }).eq("id", 1))
      .catch((e) => add({ code: "redemptions_repair", level: "error", text: `Kanalpunkte-Abo fehlt: ${(e as Error).message.slice(0, 120)}`, fix: "Später erneut prüfen" }));
    await ensureChatSubscription(conn.broadcaster_id, eventsubCallback(), secret).catch(() => null);
  }
  try {
    const appToken = await getAppToken();
    const all = await helix("eventsub/subscriptions", appToken, { query: { user_id: conn.broadcaster_id } });
    const mine = (all.data ?? []) as { type: string; status: string; transport?: { callback?: string } }[];
    const needed = [...ALERT_TYPES.map((a) => a.type), "channel.channel_points_custom_reward_redemption.add", "channel.chat.message"];
    for (const type of needed) {
      const found = mine.filter((s) => s.type === type && s.transport?.callback === eventsubCallback());
      const good = found.find((s) => s.status === "enabled") ?? found.find((s) => s.status === "webhook_callback_verification_pending");
      const bad = found.find((s) => s !== good);
      subs[type] = good ? { state: good.status === "enabled" ? "ok" : "pending", status: good.status }
        : bad ? { state: "error", status: bad.status } : { ...(subs[type] ?? {}), state: subs[type]?.state === "missing_scope" ? "missing_scope" : "missing" };
    }
    const broken = Object.entries(subs).filter(([type, s]) => ["error", "missing"].includes(s.state) && !(type === "channel.chat.message"));
    if (broken.length) {
      add({
        code: "subscriptions", level: "error",
        text: `Twitch schickt gerade nichts für: ${broken.map(([t, s]) => `${label(t)} (${s.status ?? s.message ?? s.state})`).join(", ")}.`,
        fix: "„Jetzt prüfen & reparieren“ – hilft das nicht: Twitch neu verbinden",
      });
    }
  } catch (e) {
    add({ code: "subscriptions_read", level: "warn", text: `Abos bei Twitch nicht lesbar: ${(e as Error).message.slice(0, 120)}`, fix: "Später erneut prüfen" });
  }
  details.subscriptions = subs;

  // 3) Chat-Bot
  const bot = await getBot().catch(() => null);
  details.bot = bot ? bot.display_name || bot.login : null;
  if (!bot) {
    add({ code: "no_bot", level: "warn", text: "Kein Chat-Bot verbunden – Chat-Befehle (!join, !a …) und Bot-Nachrichten gehen nicht.", fix: "Dashboard → Bot → Bot verbinden" });
  } else if (subs["channel.chat.message"] && subs["channel.chat.message"].state !== "ok" && subs["channel.chat.message"].state !== "pending") {
    add({ code: "bot_chat", level: "warn", text: "Der Bot liest den Chat nicht mit – Chat-Befehle kommen nicht an.", fix: "Dashboard → Bot → Bot neu verbinden" });
  }
  return save(problems, details);
}

function label(type: string) {
  return ({
    "channel.follow": "Follows", "channel.subscribe": "Abos", "channel.subscription.message": "Resubs",
    "channel.subscription.gift": "Abo-Geschenke", "channel.cheer": "Bits",
    "channel.channel_points_custom_reward_redemption.add": "Kanalpunkte", "channel.chat.message": "Chat",
  } as Record<string, string>)[type] ?? type;
}

async function save(problems: Problem[], details: Record<string, unknown>) {
  const row = {
    checked_at: new Date().toISOString(),
    ok: !problems.some((p) => p.level === "error"),
    problems,
    details,
    updated_at: new Date().toISOString(),
  };
  const { data } = await db.from("twitch_health").update(row).eq("id", 1).select().maybeSingle();
  return data ?? row;
}

// Jede Nachricht von Twitch (außer Tests): Zeitpunkt merken – so sieht man, ob überhaupt etwas ankommt
export async function noteEvent(type: string) {
  await db.from("twitch_health").update({ last_event_at: new Date().toISOString(), last_event_type: type }).eq("id", 1);
}
