// Werkzeuge für die Content-Ideen aus …_stream_extras.sql.
//   POST {action:"flush"}               → offene Bot-Nachrichten in den Chat (auch ohne Anmeldung, z. B. vom
//                                          OBS-Overlay nach dem Ende einer Umfrage; je Kanal begrenzt – verschickt
//                                          werden nur Texte, die die Datenbank selbst geschrieben hat)
//   POST {action:"settle"}              → Vorlese-Einlösungen bei Twitch abschließen (Admins, freigegebene Mods)
//   POST {action:"sync_reward", key}    → Kanalpunkte-Belohnung tts oder cards anlegen/abgleichen (Admins, freigegebene Mods)
//   POST {action:"watch_tick"}          → Watchtime und Statistik zählen (ohne Anmeldung, vom OBS-Overlay; höchstens jede Minute)
//   POST {action:"watch_dates"}         → „Follower seit“/„Konto seit“ für die Watchtime-Rangliste nachholen (Admins, Mods mit Bereich Chat)
//   POST {action:"cc_sync"}           → Kanalpunkte-Belohnungen der Chat-Kommandos anlegen/abgleichen (Admins, freigegebene Mods)
//   POST {action:"song_add", url}       → Song-Wunsch per YouTube-Link eintragen (Streamer, freigegebene Mods mit Bereich Chat)
//   POST {action:"anniversary", start?} → Kanal-Jubiläum im Overlay starten (Streamer, Admins, freigegebene Mods);
//                                          start = optionales Datum JJJJ-MM-TT statt „auf Twitch seit“
//   POST {action:"discord_connect", url} → Discord-Webhook prüfen und speichern (Streamer, Admins, Mods mit Bereich Chat)
//   POST {action:"discord_post", kind, tile?, auto?} → Discord: test | schedule | idea (auto: nach dem Speichern eines
//                                          Termins, nur wenn eingeschaltet und je Termin einmal)
//   POST {action:"raid_start", login}   → Raid zu einem Mitglied des Raid-Netzwerks, das gerade live ist (Streamer,
//                                          Admins, Mods mit Bereich Chat); der Bot sagt ihn an, wenn eingeschaltet
//   POST {action:"raid_cancel"}         → laufenden Raid abbrechen
import {
  audit, channelServe, corsHeaders, db, env, getConnection, getUserFromRequest, isAdminUser, json, rateLimit, requestChannel, tooMany,
} from "../_shared/twitch.ts";
import { flushOutbox, settleTts, syncExtraReward, type RewardKey } from "../_shared/extras.ts";
import { errorText } from "../_shared/errors.ts";
import { ensureRedemptionSubscription } from "../_shared/pranks.ts";
import { refreshWatchDates, watchTick } from "../_shared/watchtime.ts";
import { startAnniversary } from "../_shared/anniversary.ts";
import { syncChatControlRewards } from "../_shared/chatcontrol.ts";
import { addSongFromWeb } from "../_shared/bot.ts";
import { discordAnnounce, inspectWebhook } from "../_shared/discord.ts";
import { cancelRaid, startRaid } from "../_shared/raids.ts";

Deno.serve(channelServe(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);
  const { action, key, start, url, kind, tile, auto, login } = await req.json().catch(() => ({}));
  // Watchtime: ruft das OBS-Overlay ohne Anmeldung auf. Die Datenbank lässt höchstens jede
  // Minute einen Durchgang zu, gezählt wird nur, wenn Twitch den Stream als live meldet.
  if (action === "watch_tick") {
    try {
      const res = await watchTick();
      await flushOutbox().catch(() => 0);
      return json(res);
    } catch (e) {
      console.error("watch_tick:", e);
      return json({ error: "Watchtime gerade nicht möglich" }, 500);
    }
  }
  // Bot-Warteschlange: auch ohne Anmeldung (Overlay), höchstens 30-mal pro Minute je Kanal
  if (action === "flush") {
    if (!(await rateLimit(`flush:${requestChannel() ?? "default"}`, 30))) return tooMany();
    return json({ sent: await flushOutbox() });
  }
  const user = await getUserFromRequest(req);
  if (!user) return json({ error: "Bitte anmelden." }, 401);
  if (!(await rateLimit(`stream-tools:${user.id}`, 60))) return tooMany();
  try {

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
    if (action === "song_add") {
      if (!(await isAdminUser(user.id, "chat"))) return json({ error: "Nur der Streamer und freigegebene Mods." }, 403);
      const { data: profile } = await db.from("profiles").select("username").eq("id", user.id).maybeSingle();
      const res = await addSongFromWeb(String(url ?? "").slice(0, 300), profile?.username ?? "Dashboard");
      return json(res, res.ok ? 200 : 409);
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
    if (action === "discord_connect") {
      if (!(await isAdminUser(user.id, "chat"))) return json({ error: "Nur der Streamer und freigegebene Mods." }, 403);
      if (!(await rateLimit(`discord:${requestChannel() ?? "default"}`, 10))) return tooMany();
      const hook = String(url ?? "").trim().slice(0, 300);
      const check = await inspectWebhook(hook);
      if (!check.ok) return json({ error: check.error }, 400);
      const { error } = await db.rpc("discord_connect", { p_url: hook, p_name: check.name });
      if (error) return json({ error: String(error.message ?? "").slice(0, 200) || "Speichern fehlgeschlagen" }, 400);
      await audit(user.id, "discord_connect", { name: check.name });
      return json({ connected: true, webhook_name: check.name });
    }
    if (action === "discord_post") {
      if (!(await isAdminUser(user.id, "chat"))) return json({ error: "Nur der Streamer und freigegebene Mods." }, 403);
      if (kind !== "test" && kind !== "schedule" && kind !== "idea") return json({ error: "Unbekannte Nachricht" }, 400);
      if (!(await rateLimit(`discord:${requestChannel() ?? "default"}`, 10))) return tooMany();
      const res = await discordAnnounce(kind, typeof tile === "string" ? tile.slice(0, 80) : undefined, auto === true);
      return json(res, res.ok ? 200 : 409);
    }
    if (action === "raid_start" || action === "raid_cancel") {
      if (!(await isAdminUser(user.id, "chat"))) return json({ error: "Raiden dürfen der Streamer und freigegebene Mods." }, 403);
      if (!(await rateLimit(`raid:${requestChannel() ?? "default"}`, 6))) return tooMany();
      const target = String(login ?? "").trim().toLowerCase().slice(0, 25);
      if (action === "raid_start" && !/^[a-z0-9_]{1,25}$/.test(target)) return json({ error: "Unbekannter Kanal" }, 400);
      await audit(user.id, action, action === "raid_start" ? { to: target } : {});
      const res = action === "raid_start" ? await startRaid(target) : await cancelRaid();
      return json(res, res.ok ? 200 : 409);
    }
    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (e) {
    console.error("stream-tools:", e);
    return json({ error: errorText(e, 300) }, 500);
  }
}));
