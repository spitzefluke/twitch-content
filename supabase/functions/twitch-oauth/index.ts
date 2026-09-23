// Twitch mit dem Stellwerk verbinden.
//   POST {action:"start"}          → Twitch-Login-URL für Daves Kanal (angemeldeter User nötig)
//   POST {action:"start_bot"}      → Twitch-Login-URL für den Chat-Bot (nur Admin)
//   GET  ?code=…&state=…           → OAuth-Callback von Twitch (für beide)
//   POST {action:"disconnect"}     → Kanal trennen (nur Admin)
//   POST {action:"disconnect_bot"} → Chat-Bot trennen (nur Admin)
import {
  CodedError, corsHeaders, db, env, getAppToken, getConnection, getUserFromRequest,
  helix, HelixError, json, twitchToken,
} from "../_shared/twitch.ts";

// Dave: Kanalpunkte verwalten und dem Bot erlauben, in seinem Chat zu schreiben.
// Selbst schreibt die Seite nie in Daves Namen – dafür gibt es den Bot.
const SCOPES = ["channel:read:redemptions", "channel:manage:redemptions", "channel:bot"];
// Bot-Account: darf als Bot in Chats schreiben (gesendet wird mit dem App-Token)
const BOT_SCOPES = ["user:write:chat", "user:bot"];
const EVENT_TYPE = "channel.channel_points_custom_reward_redemption.add";
const redirectUri = () => `${env("SUPABASE_URL")}/functions/v1/twitch-oauth`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);

  if (req.method === "GET") return handleCallback(url);

  if (req.method === "POST") {
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: "Nicht angemeldet" }, 401);
    const { action } = await req.json().catch(() => ({}));
    try {
      if (action === "start") return await start(user.id, "broadcaster");
      if (action === "start_bot") {
        if (!(await isAdmin(user.id))) return json({ error: "Nur Admins dürfen den Chat-Bot verbinden." }, 403);
        return await start(user.id, "bot");
      }
      if (action === "disconnect") return await disconnect(user.id);
      if (action === "disconnect_bot") {
        if (!(await isAdmin(user.id))) return json({ error: "Nur Admins dürfen den Chat-Bot trennen." }, 403);
        await db.from("twitch_bot").delete().eq("id", 1);
        return json({ ok: true });
      }
      return json({ error: "Unbekannte Aktion" }, 400);
    } catch (e) {
      console.error(e);
      return json({ error: (e as Error).message }, 500);
    }
  }
  return json({ error: "Methode nicht erlaubt" }, 405);
});

async function isAdmin(userId: string) {
  const { data } = await db.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  return !!data?.is_admin;
}

async function start(userId: string, kind: "broadcaster" | "bot") {
  const state = crypto.randomUUID() + crypto.randomUUID();
  // "kind" nur beim Bot mitschicken: So klappt Daves Verbinden auch, solange
  // die Migration …_chat_bot.sql (Spalte kind) noch nicht eingespielt ist.
  const row = kind === "bot" ? { state, user_id: userId, kind } : { state, user_id: userId };
  const { error } = await db.from("oauth_states").insert(row);
  if (error) throw error;
  // alte, nicht abgeschlossene Anfragen aufräumen
  await db.from("oauth_states").delete().lt("created_at", new Date(Date.now() - 3600_000).toISOString());

  const auth = new URL("https://id.twitch.tv/oauth2/authorize");
  auth.search = new URLSearchParams({
    response_type: "code",
    client_id: env("TWITCH_CLIENT_ID"),
    redirect_uri: redirectUri(),
    scope: (kind === "bot" ? BOT_SCOPES : SCOPES).join(" "),
    state,
    force_verify: "true",
  }).toString();
  return json({ url: auth.toString() });
}

function backToSite(params: Record<string, string>) {
  const site = Deno.env.get("SITE_URL");
  if (!site) {
    // Ohne SITE_URL gibt es kein Ziel für die Rückleitung. Dann wenigstens
    // lesbar sagen, was passiert ist, statt mit einem nackten 500 zu enden.
    const outcome = params.twitch === "connected"
      ? "Twitch ist verbunden."
      : `Twitch-Verbindung fehlgeschlagen: ${params.detail ?? params.reason}`;
    return new Response(`${outcome}\n\nIn Supabase fehlt das Secret SITE_URL – deshalb geht es nicht automatisch zurück zur Webseite.`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const target = new URL(site);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return Response.redirect(target.toString(), 302);
}

async function handleCallback(url: URL) {
  const twitchError = url.searchParams.get("error");
  if (twitchError) return backToSite({ twitch: "error", reason: twitchError });

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return backToSite({ twitch: "error", reason: "state" });

  const { data: st } = await db.from("oauth_states").delete().eq("state", state).select().maybeSingle();
  if (!st || Date.now() - Date.parse(st.created_at) > 10 * 60_000) {
    return backToSite({ twitch: "error", reason: "state" });
  }

  try {
    const tok = await twitchToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
    const me = (await helix("users", tok.access_token)).data[0];
    if (st.kind === "bot") return await saveBot(me, st.user_id);

    const expected = Deno.env.get("BROADCASTER_LOGIN")?.toLowerCase();
    if (expected && me.login.toLowerCase() !== expected) throw new CodedError("wrong_account");

    const { data: previous } = await db.from("twitch_connection").select("reward_id").eq("id", 1).maybeSingle();
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

    const subscriptionId = await ensureSubscription(me.id, reward.id);
    await db.from("twitch_connection").update({ subscription_id: subscriptionId }).eq("id", 1);

    return backToSite({ twitch: "connected" });
  } catch (e) {
    console.error(e);
    if (e instanceof CodedError) return backToSite({ twitch: "error", reason: e.code });
    // Unerwartete Fehler nicht als "unknown" verschlucken: Die Meldung
    // (eigene Texte wie "Umgebungsvariable … fehlt" oder die Antwort von
    // Twitch – keine Tokens) geht mit zurück und steht dann auf der Webseite.
    const detail = String((e as { message?: string })?.message ?? e).slice(0, 200);
    return backToSite({ twitch: "error", reason: "unknown", detail });
  }
}

// Der Bot braucht keine eigenen Tokens: Twitch merkt sich die Freigabe
// (user:bot), gesendet wird später mit dem App-Token und seiner User-ID.
async function saveBot(me: { id: string; login: string; display_name: string }, userId: string) {
  const broadcaster = Deno.env.get("BROADCASTER_LOGIN")?.toLowerCase();
  if (broadcaster && me.login.toLowerCase() === broadcaster) throw new CodedError("bot_is_broadcaster");
  const { error } = await db.from("twitch_bot").upsert({
    id: 1,
    user_id: me.id,
    login: me.login,
    display_name: me.display_name,
    connected_by: userId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return backToSite({ twitch: "bot_connected", bot: me.display_name });
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

async function ensureSubscription(broadcasterId: string, rewardId: string) {
  const appToken = await getAppToken();
  const existing = await helix("eventsub/subscriptions", appToken, { query: { type: EVENT_TYPE } });
  for (const sub of existing.data ?? []) {
    if (sub.condition?.broadcaster_user_id === broadcasterId) {
      await helix("eventsub/subscriptions", appToken, { method: "DELETE", query: { id: sub.id } });
    }
  }
  // Twitch ruft dabei sofort twitch-eventsub zur Verifizierung auf
  const created = await helix("eventsub/subscriptions", appToken, {
    method: "POST",
    body: {
      type: EVENT_TYPE,
      version: "1",
      condition: { broadcaster_user_id: broadcasterId, reward_id: rewardId },
      transport: {
        method: "webhook",
        callback: `${env("SUPABASE_URL")}/functions/v1/twitch-eventsub`,
        secret: env("EVENTSUB_SECRET"),
      },
    },
  });
  return created.data[0].id as string;
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
    if (conn.reward_id) {
      // Belohnung deaktivieren statt löschen – beim erneuten Verbinden wird sie wieder aktiviert
      await helix("channel_points/custom_rewards", conn.access_token, {
        method: "PATCH",
        query: { broadcaster_id: conn.broadcaster_id, id: conn.reward_id },
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
