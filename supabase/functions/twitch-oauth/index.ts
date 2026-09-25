// Twitch mit dem Stellwerk verbinden.
//   POST {action:"start"}          → Twitch-Login-URL für Daves Kanal (angemeldeter User nötig)
//   POST {action:"disconnect"}     → Kanal trennen (nur Admin)
//   POST {action:"sync_pranks"}    → Kanalpunkte-Belohnungen fürs Ärgern anlegen/abgleichen (nur Admin)
//   GET  ?code=…&state=…           → OAuth-Callback von Twitch – für Daves Kanal und
//                                    für den Chat-Bot (den startet nur der Admin-Bereich,
//                                    siehe admin/index.ts, Aktion "bot_start")
import {
  CodedError, corsHeaders, db, env, getAppToken, getConnection, getUserFromRequest,
  helix, HelixError, json, oauthRedirectUri, startTwitchLogin, twitchToken,
} from "../_shared/twitch.ts";
import { ensureRedemptionSubscription, syncPrankRewards } from "../_shared/pranks.ts";
import { ensureChatSubscription } from "../_shared/chat.ts";

const eventsubCallback = () => `${env("SUPABASE_URL")}/functions/v1/twitch-eventsub`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);

  if (req.method === "GET") return handleCallback(url);

  if (req.method === "POST") {
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: "Nicht angemeldet" }, 401);
    const { action } = await req.json().catch(() => ({}));
    try {
      if (action === "start") return json({ url: await startTwitchLogin(user.id, "broadcaster") });
      if (action === "disconnect") return await disconnect(user.id);
      if (action === "sync_pranks") return await syncPranks(user.id);
      return json({ error: "Unbekannte Aktion" }, 400);
    } catch (e) {
      console.error(e);
      return json({ error: (e as Error).message }, 500);
    }
  }
  return json({ error: "Methode nicht erlaubt" }, 405);
});

// Daves Kanal kommt zurück auf die Webseite, der Chat-Bot in den Admin-Bereich.
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
  // Twitch abgebrochen wurde (dann kommt ?error=… mit dem state zurück).
  const state = url.searchParams.get("state");
  const { data: st } = state
    ? await db.from("oauth_states").delete().eq("state", state).select().maybeSingle()
    : { data: null };
  const page = st?.kind === "bot" ? "admin.html" : "";
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

    // Wer Daves Kanal verbindet, wird Admin – also streng prüfen, wer das darf:
    //   · Mit BROADCASTER_LOGIN nur genau dieser Twitch-Kanal.
    //   · Ohne das Secret nur, wer schon Admin ist (sonst könnte sich jeder
    //     Zuschauer mit seinem eigenen Kanal verbinden und Admin werden).
    //   · Einen anderen Kanal an Stelle des bisherigen setzen darf nur ein Admin.
    const expected = Deno.env.get("BROADCASTER_LOGIN")?.trim().toLowerCase();
    if (expected && me.login.toLowerCase() !== expected) throw new CodedError("wrong_account");
    const { data: starter } = await db.from("profiles").select("is_admin").eq("id", st.user_id).maybeSingle();
    const starterIsAdmin = !!starter?.is_admin;
    if (!expected && !starterIsAdmin) throw new CodedError("no_broadcaster_login");

    const { data: previous } = await db.from("twitch_connection").select("*").eq("id", 1).maybeSingle();
    if (previous && previous.broadcaster_id !== me.id && !starterIsAdmin) throw new CodedError("wrong_account");
    const reward = await ensureReward(me.id, tok.access_token, previous?.reward_id);

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
    const { error: upsertError } = await db.from("twitch_connection").upsert({ ...base, subscription_id: null });
    if (upsertError) throw upsertError;
    // Wer hier ankommt, hat sich als der richtige Twitch-Kanal ausgewiesen:
    // gleich zum Admin machen (Kacheln bearbeiten, OBS-Link) – auch wenn
    // danach das Einrichten des Webhooks noch scheitern sollte.
    await db.from("profiles").update({ is_admin: true }).eq("id", st.user_id);

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
  const conn = await getConnection().catch(() => null);
  if (conn) await chatSubscription(conn.broadcaster_id);
  return backToSite({ twitch: "bot_connected", bot: me.display_name }, "admin.html");
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

async function ensureReward(broadcasterId: string, token: string, knownId?: string | null) {
  const title = Deno.env.get("REWARD_TITLE") ?? "Glücksrad";
  const cost = Number(Deno.env.get("REWARD_COST") ?? 10000);
  const settings = {
    title,
    cost,
    prompt: "Dreht Daves Fortnite-Glücksrad mit einer zufälligen Variante – das Ergebnis erscheint im Chat!",
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
  const { data: profile } = await db.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  if (!profile?.is_admin) return json({ error: "Nur Admins dürfen die Belohnungen ändern." }, 403);
  const conn = await getConnection();
  if (!conn) return json({ error: "Twitch ist noch nicht verbunden. Dave muss sich zuerst auf der Webseite mit Twitch verbinden." }, 400);
  try {
    const result = await syncPrankRewards(conn);
    const subscriptionId = await ensureRedemptionSubscription(conn.broadcaster_id, eventsubCallback(), env("EVENTSUB_SECRET"));
    await db.from("twitch_connection").update({ subscription_id: subscriptionId }).eq("id", 1);
    await chatSubscription(conn.broadcaster_id);
    return json(result);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, e instanceof CodedError ? 400 : 500);
  }
}

async function disconnect(userId: string) {
  const { data: profile } = await db.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  if (!profile?.is_admin) return json({ error: "Nur Dave darf Twitch trennen." }, 403);

  const conn = await getConnection();
  if (conn) {
    const appToken = await getAppToken();
    if (conn.subscription_id) {
      await helix("eventsub/subscriptions", appToken, { method: "DELETE", query: { id: conn.subscription_id } })
        .catch((e) => console.warn(e));
    }
    // Belohnungen deaktivieren statt löschen – beim erneuten Verbinden werden sie wieder aktiviert
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
