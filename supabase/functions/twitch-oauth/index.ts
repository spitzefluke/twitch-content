// Twitch mit StreamHelp verbinden.
//   POST {action:"start"}          → Twitch-Login-URL für den Kanal des Streamers (angemeldeter User nötig)
//   POST {action:"disconnect"}     → Kanal trennen (nur Admin)
//   POST {action:"sync_pranks"}    → Kanalpunkte-Belohnungen fürs Ärgern anlegen/abgleichen (nur Admin)
//   POST {action:"wheel_cost", cost} → Kosten der Glücksrad-Belohnung ändern (nur Admin)
//   POST {action:"alerts_check"}   → Twitch-Abos für die Alerts prüfen und reparieren (Admins, freigegebene Mods)
//   POST {action:"sync_mods"}      → die Mods des Kanals von Twitch holen (Streamer und Admins)
//   POST {action:"health", force}  → Twitch-Gesundheitscheck (Rechte, Abos, Bot) inkl. Reparatur (Admins, freigegebene Mods);
//                                    ohne Anmeldung mit Header x-health-key = Secret HEALTH_CHECK_KEY (für den Zeitplan)
//   POST {action:"bot_start"}      → Twitch-Login für den Chat-Bot (nur Plattform-Admin: alle Kanäle teilen sich den Bot)
//   POST {action:"bot_disconnect"} → Chat-Bot trennen (nur Plattform-Admin)
//   GET  ?code=…&state=…           → OAuth-Callback von Twitch – für den Streamer-Kanal und
//                                    für den Chat-Bot (den startet nur der Admin-Bereich,
//                                    siehe admin/index.ts, Aktion "bot_start")
// Alles gilt für den Kanal aus dem Header x-channel (Migration …_platform.sql); der
// Twitch-Rückweg merkt sich den Kanal im state.
import {
  activeChannels, channelKey, channelServe, CodedError, corsHeaders, currentChannel, db, env, getAppToken, getConnection,
  getUserFromRequest, helix, HelixError, isAdminUser, isChannelOwner, isPlatformAdmin, json, oauthRedirectUri,
  startTwitchLogin, twitchToken, withChannel,
} from "../_shared/twitch.ts";
import { disableSoundRewards, ensureRedemptionSubscription, syncPrankRewards } from "../_shared/pranks.ts";
import { ensureChatSubscription } from "../_shared/chat.ts";
import { ensureAlertSubscriptions } from "../_shared/alerts.ts";
import { runHealthCheck } from "../_shared/health.ts";

const eventsubCallback = () => `${env("SUPABASE_URL")}/functions/v1/twitch-eventsub`;

Deno.serve(channelServe(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);

  if (req.method === "GET") return handleCallback(url);

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { action, cost } = body;
    // Zeitplan (GitHub Action): Gesundheitscheck ohne Anmeldung, nur mit dem geheimen Schlüssel –
    // für jeden freigeschalteten Kanal mit Twitch-Verbindung
    const key = Deno.env.get("HEALTH_CHECK_KEY");
    if (action === "health" && key && key.length >= 20 && req.headers.get("x-health-key") === key) {
      return json(await healthAllChannels());
    }
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: "Nicht angemeldet" }, 401);
    try {
      if (action === "health") return await health(user.id, body.force === true);
      if (action === "bot_start") {
        if (!(await isPlatformAdmin(user.id))) return json({ error: "Den Chat-Bot teilen sich alle Kanäle – verbinden kann ihn nur der Plattform-Admin." }, 403);
        return json({ url: await startTwitchLogin(user.id, "bot") });
      }
      if (action === "bot_disconnect") return await botDisconnect(user.id);
      if (action === "start") return json({ url: await startTwitchLogin(user.id, "broadcaster") });
      if (action === "disconnect") return await disconnect(user.id);
      if (action === "sync_pranks") return await syncPranks(user.id);
      if (action === "wheel_cost") return await setWheelCost(user.id, cost);
      if (action === "alerts_check") return await checkAlerts(user.id);
      if (action === "sync_mods") return await syncModsAction(user.id);
      return json({ error: "Unbekannte Aktion" }, 400);
    } catch (e) {
      console.error(e);
      return json({ error: (e as Error).message }, 500);
    }
  }
  return json({ error: "Methode nicht erlaubt" }, 405);
}));

// Zeitplan: jeden Kanal prüfen. Ohne Plattform-Migration nur den einen Kanal wie bisher.
async function healthAllChannels() {
  const channels = await activeChannels();
  if (!channels.length) return await runHealthCheck({ repair: true });
  const results: Record<string, unknown>[] = [];
  for (const ch of channels) {
    const r = await withChannel(ch.id, async () => {
      const { data: conn } = await db.from("twitch_connection").select("id").eq("id", 1).maybeSingle();
      if (!conn) return null; // nicht mit Twitch verbunden – nichts zu prüfen
      return await runHealthCheck({ repair: true }).catch((e) => ({ ok: false, error: String((e as Error)?.message ?? e) }));
    });
    if (r) results.push({ channel: ch.login ?? ch.id, ...(r as Record<string, unknown>) });
  }
  return { ok: results.every((r) => r.ok !== false), channels: results };
}

// Der Streamer-Kanal kommt zurück auf die Webseite, der Chat-Bot in den Admin-Bereich.
function backToSite(params: Record<string, string>, page = "") {
  const site = Deno.env.get("SITE_URL");
  if (!site) {
    // Ohne SITE_URL gibt es kein Ziel für die Rückleitung. Dann wenigstens
    // lesbar sagen, was passiert ist, statt mit einem nackten 500 zu enden.
    const outcome = params.twitch === "connected" || params.twitch === "bot_connected"
      ? "Twitch ist verbunden."
      : `Twitch-Verbindung fehlgeschlagen: ${params.detail ?? params.reason}`;
    return new Response(`${outcome}\n\nIn Supabase fehlt das Secret SITE_URL – deshalb geht es nicht automatisch zurück zur Webseite.`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  // SITE_URL darf mit oder ohne "/" enden oder direkt auf index.html zeigen.
  const base = site.endsWith("/") || /\.html?$/i.test(site) ? site : `${site}/`;
  const target = page ? new URL(page, base) : new URL(site);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return Response.redirect(target.toString(), 302);
}

async function handleCallback(url: URL) {
  // Erst den state einlösen: Er sagt, wohin es zurückgeht – auch wenn auf
  // Twitch abgebrochen wurde (dann kommt ?error=… mit dem state zurück) – und für welchen Kanal.
  const state = url.searchParams.get("state");
  const { data: st } = state
    ? await db.from("oauth_states").delete().eq("state", state).select().maybeSingle()
    : { data: null };
  return await withChannel(st?.channel_id ?? null, () => finishCallback(url, st));
}

// deno-lint-ignore no-explicit-any
async function finishCallback(url: URL, st: any) {
  // Beides kommt aufs Dashboard zurück (vom Admin-Bereich aus leitet die Seite dorthin weiter)
  const page = "";
  const back = (params: Record<string, string>) => backToSite(params, page);

  const twitchError = url.searchParams.get("error");
  if (twitchError) return back({ twitch: "error", reason: twitchError });

  const code = url.searchParams.get("code");
  if (!code || !st || Date.now() - Date.parse(st.created_at) > 10 * 60_000) {
    return back({ twitch: "error", reason: "state" });
  }

  try {
    const tok = await twitchToken({ grant_type: "authorization_code", code, redirect_uri: oauthRedirectUri() });
    const me = (await helix("users", tok.access_token)).data[0];
    if (st.kind === "bot") return await saveBot(me, st.user_id, tok.scope ?? []);

    // Wer den Streamer-Kanal verbindet, steuert ihn – also streng prüfen, wer das darf:
    //   · Kanal mit Twitch-ID (jeder angemeldete Streamer): nur genau dieses Twitch-Konto.
    //   · Standard-Kanal ohne Twitch-ID (wie vor der Plattform): mit BROADCASTER_LOGIN nur
    //     genau dieser Twitch-Kanal, ohne das Secret nur, wer schon Admin ist.
    //   · Einen anderen Kanal an Stelle des bisherigen setzen darf nur ein Admin.
    const channel = await currentChannel();
    const { data: starter } = await db.from("profiles").select("is_admin").eq("id", st.user_id).maybeSingle();
    const starterIsAdmin = !!starter?.is_admin && (!channel || channel.is_default);
    if (channel?.twitch_id) {
      if (channel.twitch_id !== me.id) throw new CodedError("wrong_account");
    } else {
      if (channel && !channel.is_default) throw new CodedError("wrong_account");
      const expected = Deno.env.get("BROADCASTER_LOGIN")?.trim().toLowerCase();
      if (expected && me.login.toLowerCase() !== expected) throw new CodedError("wrong_account");
      if (!expected && !starterIsAdmin) throw new CodedError("no_broadcaster_login");
    }

    const { data: previous } = await db.from("twitch_connection").select("*").eq("id", 1).maybeSingle();
    if (previous && previous.broadcaster_id !== me.id && !starterIsAdmin) throw new CodedError("wrong_account");
    // Beim erneuten Verbinden bleiben die auf der Webseite eingestellten Kosten
    const reward = await ensureReward(me.id, tok.access_token, previous?.reward_id, previous?.reward_cost);

    const base = {
      id: 1,
      broadcaster_id: me.id,
      broadcaster_login: me.login,
      display_name: me.display_name,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      scopes: tok.scope ?? [],
      reward_id: reward.id,
      reward_title: reward.title,
      reward_cost: reward.cost,
      connected_by: st.user_id,
      updated_at: new Date().toISOString(),
    };
    // Verbindung zuerst speichern, damit eingehende Events sie schon finden
    const { error: upsertError } = await db.from("twitch_connection")
      .upsert({ ...base, subscription_id: null }, { onConflict: await channelKey("id") });
    if (upsertError) throw upsertError;
    // Wer hier ankommt, hat sich als der richtige Twitch-Kanal ausgewiesen:
    // gleich zum Admin machen (Kacheln bearbeiten, OBS-Link) – auch wenn
    // danach das Einrichten des Webhooks noch scheitern sollte. Im Standard-Kanal über das
    // Admin-Häkchen (gilt nur dort), sonst ist der Inhaber des Kanals ohnehin Admin.
    if (!channel || channel.is_default) {
      await db.from("profiles").update({ is_admin: true }).eq("id", st.user_id);
    }
    if (channel) {
      await db.from("channels").update({
        twitch_id: me.id,
        login: channel.login ?? me.login.toLowerCase(),
        display_name: me.display_name.slice(0, 40),
        ...(channel.owner_id ? {} : { owner_id: st.user_id }),
      }).eq("id", channel.id);
    }

    // Belohnungen fürs Ärgern: Scheitert das, bleibt das Glücksrad trotzdem verbunden.
    try {
      await syncPrankRewards({
        ...base,
        subscription_id: null,
        prank_throw_reward_id: previous?.prank_throw_reward_id ?? null,
        prank_sound_reward_id: previous?.prank_sound_reward_id ?? null,
      });
    } catch (e) {
      console.error("Belohnungen fürs Ärgern nicht angelegt:", e);
    }

    // Ein Abo für alle Einlösungen – Glücksrad und Ärgern
    const subscriptionId = await ensureRedemptionSubscription(me.id, eventsubCallback(), env("EVENTSUB_SECRET"));
    await db.from("twitch_connection").update({ subscription_id: subscriptionId }).eq("id", 1);
    await chatSubscription(me.id);
    await alertSubscriptions(me.id, tok.scope ?? []);
    // Mods des Kanals holen – scheitert es, geht der Rest trotzdem
    await syncMods(me.id, tok.access_token, tok.scope ?? []).catch((e) => console.warn("Mods nicht geholt:", e));
    // Gesundheitscheck gleich mit dem neuen Stand (Rechte, Abos)
    await runHealthCheck({ repair: false }).catch((e) => console.warn("Gesundheitscheck:", e));

    return backToSite({ twitch: "connected" });
  } catch (e) {
    console.error(e);
    if (e instanceof CodedError) return back({ twitch: "error", reason: e.code });
    // Unerwartete Fehler nicht als "unknown" verschlucken: Die Meldung
    // (eigene Texte wie "Umgebungsvariable … fehlt" oder die Antwort von
    // Twitch – keine Tokens) geht mit zurück und steht dann auf der Webseite.
    const detail = String((e as { message?: string })?.message ?? e).slice(0, 200);
    return back({ twitch: "error", reason: "unknown", detail });
  }
}

// Der Bot braucht keine eigenen Tokens: Twitch merkt sich die Freigabe
// (user:bot), gesendet wird später mit dem App-Token und seiner User-ID.
async function saveBot(me: { id: string; login: string; display_name: string }, userId: string, scopes: string[]) {
  const broadcaster = Deno.env.get("BROADCASTER_LOGIN")?.toLowerCase();
  if (broadcaster && me.login.toLowerCase() === broadcaster) throw new CodedError("bot_is_broadcaster");
  const row = {
    id: 1,
    user_id: me.id,
    login: me.login,
    display_name: me.display_name,
    connected_by: userId,
    updated_at: new Date().toISOString(),
  };
  let { error } = await db.from("twitch_bot").upsert({ ...row, scopes });
  // Spalte scopes fehlt noch (Migration …_live_overlay.sql)? Dann ohne.
  if (error && /scopes/i.test(error.message)) ({ error } = await db.from("twitch_bot").upsert(row));
  if (error) throw error;
  // Den Chat aller verbundenen Kanäle mitlesen (ein Bot für alle)
  const channels = await activeChannels().catch(() => []);
  for (const ch of channels.length ? channels.map((c) => c.id) : [null]) {
    await withChannel(ch, async () => {
      const conn = await getConnection().catch(() => null);
      if (conn) await chatSubscription(conn.broadcaster_id);
    });
  }
  return backToSite({ twitch: "bot_connected", bot: me.display_name });
}

// Alerts (Follower, Abos): scheitert es, läuft der Rest trotzdem
async function alertSubscriptions(broadcasterId: string, scopes: string[]) {
  try {
    return await ensureAlertSubscriptions(broadcasterId, eventsubCallback(), env("EVENTSUB_SECRET"), scopes);
  } catch (e) {
    console.warn("Alert-Abos nicht angelegt:", e);
    return null;
  }
}

// Admin: Stehen die Alert-Abos bei Twitch? Fehlende oder von Twitch abgeschaltete
// werden neu angelegt. Antwort je Art (channel.follow …): ok, pending, missing_scope, error.
async function checkAlerts(userId: string) {
  if (!(await isAdminUser(userId))) return json({ error: "Nur Admins und freigegebene Mods dürfen die Alerts prüfen." }, 403);
  const conn = await getConnection();
  if (!conn) return json({ connected: false, types: {} });
  const types = await ensureAlertSubscriptions(conn.broadcaster_id, eventsubCallback(), env("EVENTSUB_SECRET"), conn.scopes ?? []);
  return json({ connected: true, types });
}

// Die Mods des Kanals von Twitch holen (Recht moderation:read) und in channel_mods ablegen.
// Wer sich mit einem dieser Twitch-Konten auf der Seite anmeldet, darf mitsteuern –
// sobald der Streamer „Für Mods freigeben“ einschaltet (Migration …_streamer_mods.sql).
async function syncMods(broadcasterId: string, token: string, scopes: string[]) {
  if (!scopes.includes("moderation:read")) return { missing_scope: true, count: 0 };
  const mods: { twitch_user_id: string; login: string; display_name: string; synced_at: string }[] = [];
  let after = "";
  for (let page = 0; page < 20; page++) {
    const res = await helix("moderation/moderators", token, {
      query: { broadcaster_id: broadcasterId, first: "100", ...(after ? { after } : {}) },
    });
    for (const m of res.data ?? []) {
      mods.push({ twitch_user_id: String(m.user_id), login: String(m.user_login ?? ""), display_name: String(m.user_name ?? ""), synced_at: new Date().toISOString() });
    }
    after = res.pagination?.cursor ?? "";
    if (!after) break;
  }
  const ids = mods.map((m) => m.twitch_user_id);
  if (mods.length) {
    const { error } = await db.from("channel_mods").upsert(mods, { onConflict: await channelKey("twitch_user_id") });
    if (error) throw error;
  }
  // Wer bei Twitch kein Mod mehr ist, fällt raus
  const del = db.from("channel_mods").delete();
  const { error: delErr } = ids.length ? await del.not("twitch_user_id", "in", `(${ids.join(",")})`) : await del.neq("twitch_user_id", "");
  if (delErr) throw delErr;
  return { missing_scope: false, count: mods.length, mods: mods.map((m) => m.display_name || m.login) };
}

async function syncModsAction(userId: string) {
  if (!(await isChannelOwner(userId))) {
    return json({ error: "Die Mods holen dürfen nur der Streamer und Admins." }, 403);
  }
  const conn = await getConnection();
  if (!conn) return json({ error: "Twitch ist noch nicht verbunden." }, 400);
  try {
    return json(await syncMods(conn.broadcaster_id, conn.access_token, conn.scopes ?? []));
  } catch (e) {
    console.error(e);
    if (e instanceof HelixError && (e.status === 401 || e.status === 403)) {
      return json({ missing_scope: true, count: 0 });
    }
    return json({ error: (e as Error).message }, 500);
  }
}

// Chat lesen (für !füttern): klappt nur mit Bot, der user:read:chat freigegeben hat.
// Scheitert es, laufen Glücksrad und Kanalpunkte trotzdem.
async function chatSubscription(broadcasterId: string) {
  try {
    await ensureChatSubscription(broadcasterId, eventsubCallback(), env("EVENTSUB_SECRET"));
  } catch (e) {
    console.warn("Chat-Abo nicht angelegt (Bot neu verbinden?):", e);
  }
}

async function ensureReward(broadcasterId: string, token: string, knownId?: string | null, knownCost?: number | null) {
  const title = Deno.env.get("REWARD_TITLE") ?? "Glücksrad";
  const cost = knownCost ?? Number(Deno.env.get("REWARD_COST") ?? 10000);
  const settings = {
    title,
    cost,
    prompt: "Dreht das Fortnite-Glücksrad mit einer zufälligen Variante – das Ergebnis erscheint im Chat!",
    is_enabled: true,
    background_color: "#9146FF",
    is_user_input_required: false,
    should_redemptions_skip_request_queue: false,
  };

  try {
    // Nur Belohnungen, die diese App angelegt hat, dürfen von ihr verwaltet werden
    const list = await helix("channel_points/custom_rewards", token, {
      query: { broadcaster_id: broadcasterId, only_manageable_rewards: "true" },
    });
    const existing = list.data.find((r: { id: string }) => r.id === knownId)
      ?? list.data.find((r: { title: string }) => r.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      await helix("channel_points/custom_rewards", token, {
        method: "PATCH",
        query: { broadcaster_id: broadcasterId, id: existing.id },
        body: settings,
      });
      return { id: existing.id as string, title, cost };
    }
    const created = await helix("channel_points/custom_rewards", token, {
      method: "POST",
      query: { broadcaster_id: broadcasterId },
      body: settings,
    });
    return { id: created.data[0].id as string, title, cost };
  } catch (e) {
    if (e instanceof HelixError) {
      if (e.status === 403) throw new CodedError("not_affiliate");
      if (e.status === 400 && /duplicate/i.test(e.data?.message ?? "")) throw new CodedError("reward_exists");
    }
    throw e;
  }
}

// Admin: Belohnungen fürs Ärgern jetzt auf den Stand der Einstellungen bringen
// (Kosten, Abklingzeit, an/aus, Startdatum) – und das Einlösungs-Abo prüfen.
async function syncPranks(userId: string) {
  if (!(await isAdminUser(userId))) return json({ error: "Nur der Streamer, Admins und freigegebene Mods dürfen die Belohnungen ändern." }, 403);
  const conn = await getConnection();
  if (!conn) return json({ error: "Twitch ist noch nicht verbunden. Der Streamer muss sich zuerst auf der Webseite mit Twitch verbinden." }, 400);
  try {
    const result = await syncPrankRewards(conn);
    const subscriptionId = await ensureRedemptionSubscription(conn.broadcaster_id, eventsubCallback(), env("EVENTSUB_SECRET"));
    await db.from("twitch_connection").update({ subscription_id: subscriptionId }).eq("id", 1);
    await chatSubscription(conn.broadcaster_id);
    await alertSubscriptions(conn.broadcaster_id, conn.scopes ?? []);
    return json(result);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, e instanceof CodedError ? 400 : 500);
  }
}

// Admin: Kosten fürs Drehen auf Twitch ändern (1 bis 1.000.000 Kanalpunkte)
async function setWheelCost(userId: string, raw: unknown) {
  // Kanalpunkte-Kosten: Streamer, Admins und freigegebene Mods
  if (!(await isAdminUser(userId))) return json({ error: "Nur der Streamer, Admins und freigegebene Mods dürfen die Kosten ändern." }, 403);
  const cost = Math.round(Number(raw));
  if (!Number.isFinite(cost) || cost < 1 || cost > 1_000_000) {
    return json({ error: "Die Kosten müssen zwischen 1 und 1.000.000 Kanalpunkten liegen." }, 400);
  }
  const conn = await getConnection();
  if (!conn) return json({ error: "Twitch ist noch nicht verbunden. Der Streamer muss sich zuerst auf der Webseite mit Twitch verbinden." }, 400);
  try {
    const reward = await ensureReward(conn.broadcaster_id, conn.access_token, conn.reward_id, cost);
    const { error } = await db.from("twitch_connection")
      .update({ reward_id: reward.id, reward_title: reward.title, reward_cost: reward.cost, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw error;
    return json({ cost: reward.cost, title: reward.title });
  } catch (e) {
    console.error(e);
    if (e instanceof CodedError) return json({ error: e.code }, 400);
    return json({ error: (e as Error).message }, 500);
  }
}

async function disconnect(userId: string) {
  if (!(await isChannelOwner(userId))) return json({ error: "Nur der Streamer darf Twitch trennen." }, 403);

  const conn = await getConnection();
  if (conn) {
    const appToken = await getAppToken();
    if (conn.subscription_id) {
      await helix("eventsub/subscriptions", appToken, { method: "DELETE", query: { id: conn.subscription_id } })
        .catch((e) => console.warn(e));
    }
    // Belohnungen deaktivieren statt löschen – beim erneuten Verbinden werden sie wieder aktiviert
    await disableSoundRewards(conn).catch((e) => console.warn(e));
    for (const rewardId of [conn.reward_id, conn.prank_throw_reward_id, conn.prank_sound_reward_id]) {
      if (!rewardId) continue;
      await helix("channel_points/custom_rewards", conn.access_token, {
        method: "PATCH",
        query: { broadcaster_id: conn.broadcaster_id, id: rewardId },
        body: { is_enabled: false },
      }).catch((e) => console.warn(e));
    }
    await fetch("https://id.twitch.tv/oauth2/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env("TWITCH_CLIENT_ID"), token: conn.access_token }),
    }).catch((e) => console.warn(e));
  }
  await db.from("twitch_connection").delete().eq("id", 1);
  return json({ ok: true });
}

// Gesundheitscheck: höchstens alle 60 Sekunden neu (force: sofort), sonst der letzte Stand
async function health(userId: string, force: boolean) {
  if (!(await isAdminUser(userId)) && !(await isOwnerUser(userId))) return json({ error: "Nur der Streamer, Admins und Mods." }, 403);
  const { data: last } = await db.from("twitch_health").select("*").eq("id", 1).maybeSingle();
  if (!force && last?.checked_at && Date.now() - Date.parse(last.checked_at) < 60_000) return json(last);
  return json(await runHealthCheck({ repair: true }));
}

const isOwnerUser = isChannelOwner;

// Chat-Bot trennen – nur der Plattform-Admin, denn alle Kanäle teilen sich den Bot
async function botDisconnect(userId: string) {
  if (!(await isPlatformAdmin(userId))) return json({ error: "Den Chat-Bot teilen sich alle Kanäle – trennen kann ihn nur der Plattform-Admin." }, 403);
  const appToken = await getAppToken().catch(() => null);
  if (appToken) {
    const existing = await helix("eventsub/subscriptions", appToken, { query: { type: "channel.chat.message" } }).catch(() => ({ data: [] }));
    for (const sub of existing.data ?? []) {
      await helix("eventsub/subscriptions", appToken, { method: "DELETE", query: { id: sub.id } }).catch(() => {});
    }
  }
  await db.from("twitch_bot").delete().eq("id", 1);
  return json({ ok: true });
}
