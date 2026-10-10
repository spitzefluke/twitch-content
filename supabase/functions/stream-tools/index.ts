// Werkzeuge für die Content-Ideen aus …_stream_extras.sql.
//   POST {action:"flush"}               → offene Bot-Nachrichten in den Chat (jeder Angemeldete –
//                                          verschickt werden nur Texte, die die Datenbank selbst geschrieben hat)
//   POST {action:"settle"}              → Vorlese-Einlösungen bei Twitch abschließen (Admins, freigegebene Mods)
//   POST {action:"sync_reward", key}    → Kanalpunkte-Belohnung tts oder cards anlegen/abgleichen (Admins, freigegebene Mods)
//   POST {action:"watch_tick"}          → Watchtime gutschreiben (ohne Anmeldung, vom OBS-Overlay; höchstens alle 4,5 Min)
//   POST {action:"watch_dates"}         → „Follower seit“/„Konto seit“ für die Watchtime-Rangliste nachholen (Admins, Mods mit Bereich Chat)
//   POST {action:"cc_sync"}           → Kanalpunkte-Belohnungen der Chat-Kommandos anlegen/abgleichen (Admins, freigegebene Mods)
//   POST {action:"anniversary", start?} → Kanal-Jubiläum im Overlay starten (Streamer, Admins, freigegebene Mods);
//                                          start = optionales Datum JJJJ-MM-TT statt „auf Twitch seit“
import {
  audit, channelServe, corsHeaders, db, env, getConnection, getUserFromRequest, isAdminUser, json, rateLimit, tooMany,
} from "../_shared/twitch.ts";
import { flushOutbox, settleTts, syncExtraReward, type RewardKey } from "../_shared/extras.ts";
import { errorText } from "../_shared/errors.ts";
import { ensureRedemptionSubscription } from "../_shared/pranks.ts";
import { refreshWatchDates, watchTick } from "../_shared/watchtime.ts";
import { startAnniversary } from "../_shared/anniversary.ts";
import { syncChatControlRewards } from "../_shared/chatcontrol.ts";

Deno.serve(channelServe(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);
  const { action, key, start } = await req.json().catch(() => ({}));
  // Watchtime: ruft das OBS-Overlay ohne Anmeldung auf. Die Datenbank lässt nur alle
  // 4,5 Minuten einen Durchgang zu, gezählt wird nur, wenn Twitch den Stream als live meldet.
  if (action === "watch_tick") {
    try {
      return json(await watchTick());
    } catch (e) {
      console.error("watch_tick:", e);
      return json({ error: "Watchtime gerade nicht möglich" }, 500);
    }
  }
  const user = await getUserFromRequest(req);
  if (!user) return json({ error: "Bitte anmelden." }, 401);
  if (!(await rateLimit(`stream-tools:${user.id}`, 60))) return tooMany();
  try {
    if (action === "flush") return json({ sent: await flushOutbox() });

    if (action === "watch_dates") {
      // Watchtime-Rangliste im Dashboard: „Follower seit“/„Konto seit“ der Top 20 nachholen
      if (!(await isAdminUser(user.id, "chat"))) return json({ error: "Nur der Streamer und freigegebene Mods." }, 403);
      const { data } = await db.from("watchtime").select("twitch_id").order("seconds", { ascending: false }).limit(20);
      return json({ updated: await refreshWatchDates((data ?? []).map((w) => w.twitch_id as string)) });
    }

    if (action === "settle") {
      if (!(await isAdminUser(user.id, "pranks"))) return json({ error: "Nur der Streamer und die Mods." }, 403);
      const conn = await getConnection();
      return json({ settled: conn ? await settleTts(conn) : 0 });
    }

    if (action === "sync_reward") {
      // Kanalpunkte: Streamer, Admins und freigegebene Mods
      if (!(await isAdminUser(user.id, "points"))) return json({ error: "Nur der Streamer, Admins und freigegebene Mods dürfen die Belohnungen ändern." }, 403);
      if (key !== "tts" && key !== "cards") return json({ error: "Unbekannte Belohnung" }, 400);
      await audit(user.id, "sync_reward", { key });
      const conn = await getConnection();
      if (!conn) return json({ error: "Twitch ist noch nicht verbunden. Der Streamer muss sich zuerst mit Twitch verbinden." }, 400);
      const result = await syncExtraReward(conn, key as RewardKey);
      // Ohne Abo kämen die Einlösungen nie an (legt es an, falls es fehlt)
      const subscriptionId = await ensureRedemptionSubscription(
        conn.broadcaster_id, `${env("SUPABASE_URL")}/functions/v1/twitch-eventsub`, env("EVENTSUB_SECRET"),
      );
      await db.from("twitch_connection").update({ subscription_id: subscriptionId }).eq("id", 1);
      return json(result);
    }
    if (action === "cc_sync") {
      if (!(await isAdminUser(user.id, "points"))) return json({ error: "Nur der Streamer, Admins und freigegebene Mods dürfen die Belohnungen ändern." }, 403);
      await audit(user.id, "cc_sync", {});
      const conn = await getConnection();
      if (!conn) return json({ error: "Twitch ist noch nicht verbunden. Der Streamer muss sich zuerst mit Twitch verbinden." }, 400);
      try {
        const result = await syncChatControlRewards(conn);
        const subscriptionId = await ensureRedemptionSubscription(
          conn.broadcaster_id, `${env("SUPABASE_URL")}/functions/v1/twitch-eventsub`, env("EVENTSUB_SECRET"),
        );
        await db.from("twitch_connection").update({ subscription_id: subscriptionId }).eq("id", 1);
        return json(result);
      } catch (e) {
        return json({ error: errorText(e, 300) }, 409);
      }
    }
    if (action === "anniversary") {
      if (!(await isAdminUser(user.id, "overlay"))) return json({ error: "Das Kanal-Jubiläum starten nur der Streamer, Admins und freigegebene Mods." }, 403);
      await audit(user.id, "anniversary", { start: typeof start === "string" ? start : null });
      const conn = await getConnection();
      if (!conn) return json({ error: "Twitch ist noch nicht verbunden. Der Streamer muss sich zuerst mit Twitch verbinden." }, 400);
      const { data: profile } = await db.from("profiles").select("username").eq("id", user.id).maybeSingle();
      try {
        return json(await startAnniversary(conn, profile?.username ?? "Mod", typeof start === "string" ? start : undefined));
      } catch (e) {
        return json({ error: errorText(e, 300) }, 409);
      }
    }
    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (e) {
    console.error("stream-tools:", e);
    return json({ error: errorText(e, 300) }, 500);
  }
}));
