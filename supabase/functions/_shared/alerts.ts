// Alerts im OBS-Overlay: neue Follower, Abos, Resubs und verschenkte Abos.
// Twitch meldet sie über EventSub an twitch-eventsub, hier landen sie in
// stream_alerts – das Overlay liest die Tabelle per Realtime (auch ohne Login).
// Dave braucht dafür die Scopes moderator:read:followers und channel:read:subscriptions
// (einmal Twitch neu verbinden).
import { db, getAppToken, helix } from "./twitch.ts";

type AlertType = {
  type: string;
  version: string;
  scope: string;
  condition: (broadcasterId: string) => Record<string, string>;
};

export const ALERT_TYPES: AlertType[] = [
  // Follow braucht zusätzlich einen Moderator – Dave ist Moderator seines eigenen Kanals
  { type: "channel.follow", version: "2", scope: "moderator:read:followers", condition: (id) => ({ broadcaster_user_id: id, moderator_user_id: id }) },
  { type: "channel.subscribe", version: "1", scope: "channel:read:subscriptions", condition: (id) => ({ broadcaster_user_id: id }) },
  { type: "channel.subscription.message", version: "1", scope: "channel:read:subscriptions", condition: (id) => ({ broadcaster_user_id: id }) },
  { type: "channel.subscription.gift", version: "1", scope: "channel:read:subscriptions", condition: (id) => ({ broadcaster_user_id: id }) },
];
export const isAlertType = (type: string) => ALERT_TYPES.some((a) => a.type === type);

// Für jede Alert-Art genau ein Abo auf diesen Webhook. Fehlt Dave ein Scope,
// wird die Art übersprungen (Twitch würde das Abo sonst ablehnen).
export async function ensureAlertSubscriptions(broadcasterId: string, callback: string, secret: string, scopes: string[] = []) {
  const appToken = await getAppToken();
  const result: Record<string, string> = {};
  for (const a of ALERT_TYPES) {
    if (!scopes.includes(a.scope)) { result[a.type] = "missing_scope"; continue; }
    try {
      const existing = await helix("eventsub/subscriptions", appToken, { query: { type: a.type } });
      type Sub = { id: string; status: string; condition?: { broadcaster_user_id?: string }; transport?: { callback?: string } };
      const mine = (existing.data ?? []).filter((s: Sub) => s.condition?.broadcaster_user_id === broadcasterId);
      const good = mine.find((s: Sub) => s.status === "enabled" && s.transport?.callback === callback);
      for (const sub of mine) {
        if (sub !== good) await helix("eventsub/subscriptions", appToken, { method: "DELETE", query: { id: sub.id } });
      }
      if (!good) {
        await helix("eventsub/subscriptions", appToken, {
          method: "POST",
          body: { type: a.type, version: a.version, condition: a.condition(broadcasterId), transport: { method: "webhook", callback, secret } },
        });
      }
      result[a.type] = "ok";
    } catch (e) {
      console.warn(`Alert-Abo ${a.type} nicht angelegt:`, e);
      result[a.type] = "error";
    }
  }
  return result;
}

type AlertEvent = {
  user_name?: string;
  user_login?: string;
  is_anonymous?: boolean;
  is_gift?: boolean;
  tier?: string;
  total?: number;
  cumulative_months?: number;
  message?: { text?: string };
};

// Ein Ereignis von Twitch → eine Zeile in stream_alerts.
// messageId (Twitch-Eventsub-Message-Id) verhindert Doppelte, wenn Twitch erneut zustellt.
export async function handleAlert(type: string, event: AlertEvent, messageId: string | null) {
  const name = (event.user_name || event.user_login || "Jemand").slice(0, 60);
  let row: Record<string, unknown> | null = null;
  if (type === "channel.follow") row = { kind: "follow", user_name: name };
  // Verschenkte Abos kommen zusätzlich einzeln als subscribe mit is_gift – die zeigt schon „gift“
  if (type === "channel.subscribe" && !event.is_gift) row = { kind: "sub", user_name: name, tier: event.tier ?? "" };
  if (type === "channel.subscription.message") {
    row = {
      kind: "resub", user_name: name, tier: event.tier ?? "",
      months: event.cumulative_months ?? 0, message: (event.message?.text ?? "").slice(0, 300),
    };
  }
  if (type === "channel.subscription.gift") {
    row = { kind: "gift", user_name: event.is_anonymous ? "Anonym" : name, tier: event.tier ?? "", amount: event.total ?? 1 };
  }
  if (!row) return;
  const { error } = await db.from("stream_alerts").upsert({ ...row, event_id: messageId }, { onConflict: "event_id", ignoreDuplicates: true });
  if (error) throw error;
  await db.from("stream_alerts").delete().lt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString());
}
