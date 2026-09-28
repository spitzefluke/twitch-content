// Die Content-Ideen aus …_stream_extras.sql, soweit sie Twitch brauchen:
//   · Chat-Befehle (!erwischt, !a–!d, !rate, !join, !leave) → SQL chat_command
//   · Bot-Nachrichten aus bot_outbox verschicken (Quiz-Frage, Mitspieler gezogen, Zahl erraten …)
//   · Kanalpunkte: Text-to-Speech und Karten-Packs (Belohnungen anlegen, Einlösungen)
import { db, getConnection, helix, HelixError, CodedError, sendChat, type Connection } from "./twitch.ts";

const OUTBOX_MAX_AGE_MS = 3 * 60_000;

// Offene Bot-Nachrichten verschicken. Jede Nachricht geht nur einmal raus: erst als
// verschickt markieren (parallele Aufrufe bekommen sie dann nicht mehr), dann senden.
// Ältere als 3 Minuten verfallen – sonst käme z. B. eine alte Quizfrage verspätet.
export async function flushOutbox(conn?: Connection | null) {
  const now = new Date();
  const since = new Date(now.getTime() - OUTBOX_MAX_AGE_MS).toISOString();
  await db.from("bot_outbox").update({ sent_at: now.toISOString() }).is("sent_at", null).lt("created_at", since);
  const { data, error } = await db.from("bot_outbox")
    .update({ sent_at: now.toISOString() }).is("sent_at", null).gte("created_at", since).select("id, text");
  if (error || !data?.length) return 0;
  conn ??= await getConnection();
  if (!conn) return 0;
  let sent = 0;
  for (const row of [...data].sort((a, b) => a.id - b.id)) {
    try {
      await sendChat(conn, row.text);
      sent++;
    } catch (e) {
      console.warn("Bot-Nachricht nicht gesendet:", (e as Error).message);
      if (e instanceof CodedError && e.code === "no_bot") break;
    }
  }
  return sent;
}

type ChatEvent = {
  chatter_user_id: string;
  chatter_user_name: string;
  chatter_user_login: string;
  badges?: { set_id: string }[];
  message?: { text?: string };
};

// Neue Chat-Befehle. Antwortet der Bot (z. B. „Du stehst auf Platz 3“), geht das gleich raus.
export async function handleExtraCommand(event: ChatEvent) {
  const text = (event.message?.text ?? "").trim();
  if (!text.startsWith("!")) return;
  const { data, error } = await db.rpc("chat_command", {
    p_user_id: event.chatter_user_id,
    p_name: event.chatter_user_name || event.chatter_user_login,
    p_badges: (event.badges ?? []).map((b) => b.set_id),
    p_text: text.slice(0, 200),
  });
  if (error) {
    // Migration …_stream_extras.sql fehlt noch: einfach nichts tun
    if (!/chat_command/.test(error.message)) console.warn("chat_command:", error.message);
    return;
  }
  const conn = await getConnection();
  if (!conn) return;
  if (data?.reply) await sendChat(conn, String(data.reply)).catch((e) => console.warn("Chat:", e.message));
  await flushOutbox(conn).catch((e) => console.warn("Bot-Nachrichten:", e.message));
}

// ---------- Kanalpunkte ----------
export type RewardKey = "tts" | "cards";
const TILE_OF: Record<RewardKey, string> = { tts: "tts", cards: "cards" };

function rewardBody(key: RewardKey, row: { title: string; cost: number; cooldown: number }, enabled: boolean) {
  const base = {
    title: row.title,
    cost: row.cost,
    is_enabled: enabled,
    should_redemptions_skip_request_queue: false,
    is_global_cooldown_enabled: row.cooldown > 0,
    global_cooldown_seconds: Math.min(604800, Math.max(1, row.cooldown)),
  };
  if (key === "tts") {
    return {
      ...base,
      prompt: "Deine Nachricht zum Vorlesen. Andere Stimme? Schreib roboter:, oma:, monster:, schnell: oder flüster: an den Anfang.",
      is_user_input_required: true,
      background_color: "#35C7FF",
    };
  }
  return {
    ...base,
    prompt: "Ein Pack Sammelkarten – öffnen auf der Webseite (mit Twitch anmelden).",
    is_user_input_required: false,
    background_color: "#FFB81C",
  };
}

// Belohnung anlegen oder auf den Stand bringen (Kosten, Abklingzeit, an/aus, Startdatum der Kachel)
export async function syncExtraReward(conn: Connection, key: RewardKey) {
  const { data: row, error } = await db.from("stream_rewards").select("*").eq("key", key).maybeSingle();
  if (error || !row) throw new Error("In der Datenbank fehlen die Belohnungen (Migration …_stream_extras.sql).");
  const { data: tile } = await db.from("tiles").select("target_at").eq("kind", TILE_OF[key]).order("position").limit(1).maybeSingle();
  const started = !!tile && (!tile.target_at || Date.parse(tile.target_at) <= Date.now());
  const body = rewardBody(key, row, !!row.enabled && started);
  try {
    const list = await helix("channel_points/custom_rewards", conn.access_token, {
      query: { broadcaster_id: conn.broadcaster_id, only_manageable_rewards: "true" },
    });
    const existing = list.data.find((r: { id: string }) => r.id === row.reward_id)
      ?? list.data.find((r: { title: string }) => r.title === row.title);
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
    await db.from("stream_rewards").update({ reward_id: id, synced_at: new Date().toISOString(), error: "" }).eq("key", key);
    return { key, reward_id: id, enabled: body.is_enabled, started };
  } catch (e) {
    let message = (e as Error).message;
    if (e instanceof HelixError) {
      if (e.status === 403) message = "Kanalpunkte gibt es nur für Twitch-Affiliates und Partner.";
      else if (e.status === 400 && /duplicate/i.test(e.data?.message ?? "")) {
        message = `Es gibt schon eine von Hand angelegte Belohnung „${row.title}“. Bitte im Twitch-Dashboard löschen und noch einmal übernehmen.`;
      } else message = e.data?.message ?? message;
    }
    await db.from("stream_rewards").update({ error: message.slice(0, 200) }).eq("key", key);
    throw new CodedError("reward", message);
  }
}

type Redemption = {
  id: string;
  user_id?: string;
  user_login: string;
  user_name: string;
  user_input?: string;
  reward: { id: string };
};

export function redemptionStatus(conn: Connection, rewardId: string, id: string, status: "FULFILLED" | "CANCELED") {
  return helix("channel_points/custom_rewards/redemptions", conn.access_token, {
    method: "PATCH",
    query: { broadcaster_id: conn.broadcaster_id, reward_id: rewardId, id },
    body: { status },
  });
}

// Einlösung für Text-to-Speech oder Karten-Pack? Dann erledigen und true zurückgeben.
export async function handleExtraRedemption(conn: Connection, event: Redemption) {
  const { data: row, error } = await db.from("stream_rewards").select("key").eq("reward_id", event.reward.id).maybeSingle();
  if (error || !row) return false;
  let res: { action?: string; reply?: string } | null = null;
  if (row.key === "tts") {
    const r = await db.rpc("tts_redeem", {
      p_redemption: event.id, p_reward: event.reward.id, p_name: event.user_name, p_input: (event.user_input ?? "").slice(0, 600),
    });
    if (r.error) throw r.error;
    res = r.data;
  } else if (row.key === "cards") {
    if (!event.user_id) return true;
    const r = await db.rpc("cards_redeem", { p_redemption: event.id, p_twitch_id: event.user_id, p_name: event.user_name });
    if (r.error) throw r.error;
    res = r.data;
  }
  if (res?.action === "fulfill") await redemptionStatus(conn, event.reward.id, event.id, "FULFILLED").catch(console.error);
  if (res?.action === "cancel") await redemptionStatus(conn, event.reward.id, event.id, "CANCELED").catch(console.error);
  if (res?.reply) await sendChat(conn, res.reply).catch((e) => console.warn("Chat:", e.message));
  return true;
}

// Freigegebene/abgelehnte Vorlese-Nachrichten bei Twitch als eingelöst/zurückgegeben markieren
export async function settleTts(conn: Connection) {
  const { data } = await db.from("tts_messages").select("id, status, redemption_id, reward_id")
    .eq("settled", false).in("status", ["approved", "rejected"]).not("redemption_id", "is", null).limit(50);
  let done = 0;
  for (const m of data ?? []) {
    try {
      await redemptionStatus(conn, m.reward_id, m.redemption_id, m.status === "approved" ? "FULFILLED" : "CANCELED");
    } catch (e) {
      // Schon erledigt oder zu alt: trotzdem abhaken, sonst hängt sie ewig
      console.warn("Einlösung nicht geändert:", (e as Error).message);
    }
    await db.from("tts_messages").update({ settled: true }).eq("id", m.id);
    done++;
  }
  return done;
}
