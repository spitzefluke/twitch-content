// Chat-Kommandos (Migration …_chat_control.sql): Kommandos mit Kanalpunkte-Kosten bekommen eine eigene
// Belohnung bei Twitch („🎮 Spring!“). Abgleichen legt sie an, passt Kosten/Abklingzeit/an-aus an und
// räumt Belohnungen gelöschter Kommandos weg. Eingelöst wird über twitch-eventsub → cc_redeem.
import { CodedError, type Connection, db, helix, HelixError } from "./twitch.ts";

export const CC_PREFIX = "🎮 ";
export const ccRewardTitle = (label: string) => `${CC_PREFIX}${label}`.slice(0, 45);

type Command = { id: number; word: string; label: string; cooldown: number; cost: number; enabled: boolean; reward_id: string | null };
type TwitchReward = { id: string; title: string };

export async function syncChatControlRewards(conn: Connection) {
  const [{ data: cmds, error }, { data: cfg }, { data: tile }, { data: paused }] = await Promise.all([
    db.from("cc_commands").select("id, word, label, cooldown, cost, enabled, reward_id").order("position"),
    db.from("chat_control").select("enabled").eq("id", 1).maybeSingle(),
    db.from("tiles").select("target_at").eq("kind", "chatcontrol").order("position").limit(1).maybeSingle(),
    db.rpc("viewer_paused"),
  ]);
  if (error) throw new Error("In der Datenbank fehlen die Chat-Kommandos (Migration …_chat_control.sql).");
  const started = !!tile && (!tile.target_at || Date.parse(tile.target_at) <= Date.now());
  const on = (cfg?.enabled ?? true) && started && paused !== true;

  let manageable: TwitchReward[];
  try {
    const list = await helix("channel_points/custom_rewards", conn.access_token, {
      query: { broadcaster_id: conn.broadcaster_id, only_manageable_rewards: "true" },
    });
    manageable = list.data ?? [];
  } catch (e) {
    if (e instanceof HelixError && e.status === 403) throw new CodedError("not_affiliate", "Kanalpunkte gibt es nur für Twitch-Affiliates und Partner.");
    throw e;
  }

  const keep = new Set<string>();
  const result: { id: number; word: string; reward_id: string | null; error: string }[] = [];
  for (const c of (cmds ?? []) as Command[]) {
    if (!(c.cost > 0)) {
      // Keine Kosten mehr: Belohnung entfernen
      if (c.reward_id) {
        await helix("channel_points/custom_rewards", conn.access_token, {
          method: "DELETE", query: { broadcaster_id: conn.broadcaster_id, id: c.reward_id },
        }).catch(() => {});
        await db.rpc("cc_reward_set", { p_id: c.id, p_reward_id: null, p_error: "" });
      }
      continue;
    }
    const body = {
      title: ccRewardTitle(c.label),
      prompt: `Der Streamer muss: ${c.label} (oder im Chat: !${c.word})`.slice(0, 200),
      cost: c.cost,
      is_enabled: on && c.enabled,
      is_user_input_required: false,
      should_redemptions_skip_request_queue: false,
      is_global_cooldown_enabled: c.cooldown > 0,
      global_cooldown_seconds: Math.min(604800, Math.max(1, c.cooldown)),
      background_color: "#FF4FD8",
    };
    try {
      const existing = manageable.find((r) => r.id === c.reward_id) ?? manageable.find((r) => r.title === body.title && !keep.has(r.id));
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
      keep.add(id);
      await db.rpc("cc_reward_set", { p_id: c.id, p_reward_id: id, p_error: "" });
      result.push({ id: c.id, word: c.word, reward_id: id, error: "" });
    } catch (e) {
      let message = (e as Error).message;
      if (e instanceof HelixError) {
        if (e.status === 400 && /duplicate/i.test(e.data?.message ?? "")) {
          message = `Es gibt schon eine von Hand angelegte Belohnung „${body.title}“ – bitte im Twitch-Dashboard löschen.`;
        } else message = e.data?.message ?? message;
      }
      await db.rpc("cc_reward_set", { p_id: c.id, p_reward_id: c.reward_id, p_error: message.slice(0, 200) });
      result.push({ id: c.id, word: c.word, reward_id: c.reward_id, error: message.slice(0, 200) });
    }
  }
  // Belohnungen gelöschter Kommandos (gleiches Präfix, von uns angelegt) wegräumen
  const others = new Set([conn.reward_id, conn.prank_throw_reward_id, conn.prank_sound_reward_id].filter(Boolean));
  for (const r of manageable) {
    if (r.title.startsWith(CC_PREFIX) && !keep.has(r.id) && !others.has(r.id)) {
      await helix("channel_points/custom_rewards", conn.access_token, {
        method: "DELETE", query: { broadcaster_id: conn.broadcaster_id, id: r.id },
      }).catch((e) => console.warn("Belohnung löschen:", (e as Error).message));
    }
  }
  return { active: on, commands: result };
}
