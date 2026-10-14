// YouTube verbinden und mit Twitch live schalten (Migration …_live_sync.sql, _shared/ytlive.ts).
//   GET  ?code&state                   → Rückweg vom Google-Login, zurück auf die Webseite (?youtube=connected)
//   POST {action:"start"}               → {url} zum Google-Login (nur der Streamer)
//   POST {action:"disconnect"}          → Zugang bei Google widerrufen und löschen
//   POST {action:"stream_key"}          → {server, key, status} für OBS (wird nicht gespeichert)
//   POST {action:"go_live"|"end_live"}  → YouTube-Sendung jetzt starten bzw. beenden (zum Testen)
// Alles gilt für den Kanal aus dem Header x-channel. Nötige Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
import {
  audit, backToSite, channelKey, channelServe, corsHeaders, currentChannelId, db, env, getUserFromRequest, isChannelOwner, json,
  rateLimit, tooMany, withChannel,
} from "../_shared/twitch.ts";
import {
  ensureStream, googleToken, getYoutube, setLive, streamKey, youtubeConfigured, youtubeOffline, youtubeOnline, youtubeRedirectUri,
  YT_SCOPE, yt, ytReason,
} from "../_shared/ytlive.ts";
import { errorText } from "../_shared/errors.ts";

Deno.serve(channelServe(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  if (req.method === "GET") return await handleCallback(url);
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);

  const body = await req.json().catch(() => ({}));
  const user = await getUserFromRequest(req);
  if (!user) return json({ error: "Nicht angemeldet" }, 401);
  if (!(await rateLimit(`youtube:${user.id}`, 20))) return tooMany();
  if (!youtubeConfigured()) {
    return json({ error: "YouTube ist auf StreamHelp noch nicht eingerichtet (in Supabase fehlen die Secrets GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET)." }, 400);
  }
  if (!(await isChannelOwner(user.id))) return json({ error: "YouTube verbindet und steuert nur der Streamer selbst." }, 403);
  try {
    switch (body.action) {
      case "start": return json({ url: await startLogin(user.id) });
      case "disconnect": return await disconnect(user.id);
      case "stream_key": {
        const conn = await getYoutube();
        if (!conn) return json({ error: "YouTube ist noch nicht verbunden." }, 400);
        return json(await streamKey(conn));
      }
      case "go_live": await audit(user.id, "youtube_go_live"); return json(await youtubeOnline({ force: true }));
      case "end_live": await audit(user.id, "youtube_end_live"); return json(await youtubeOffline({ force: true }));
      default: return json({ error: "Unbekannte Aktion" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: ytReason(e) }, 500);
  }
}));

async function startLogin(userId: string) {
  const state = crypto.randomUUID() + crypto.randomUUID();
  const channelId = await currentChannelId();
  const row: Record<string, string> = { state, user_id: userId, kind: "youtube" };
  if (channelId) row.channel_id = channelId;
  const { error } = await db.from("oauth_states").insert(row);
  if (error) throw error;
  await audit(userId, "youtube_connect");
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: youtubeRedirectUri(),
    response_type: "code",
    scope: YT_SCOPE,
    // Refresh-Token für später (Live schalten, wenn niemand die Seite offen hat)
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return auth.toString();
}

async function handleCallback(url: URL) {
  const state = url.searchParams.get("state");
  const { data: st } = state
    ? await db.from("oauth_states").delete().eq("state", state).eq("kind", "youtube").select().maybeSingle()
    : { data: null };
  return await withChannel(st?.channel_id ?? null, () => finishCallback(url, st));
}

// deno-lint-ignore no-explicit-any
async function finishCallback(url: URL, st: any) {
  const back = (params: Record<string, string>) => backToSite(params);
  const googleError = url.searchParams.get("error");
  if (googleError) return back({ youtube: "error", reason: googleError });
  const code = url.searchParams.get("code");
  if (!code || !st || Date.now() - Date.parse(st.created_at) > 10 * 60_000) return back({ youtube: "error", reason: "state" });
  try {
    const tok = await googleToken({ grant_type: "authorization_code", code, redirect_uri: youtubeRedirectUri() });
    if (!String(tok.scope ?? "").split(" ").includes(YT_SCOPE)) return back({ youtube: "error", reason: "scope" });
    const me = (await yt("channels", tok.access_token, { query: { part: "snippet", mine: "true" } })).items?.[0];
    if (!me?.id) return back({ youtube: "error", reason: "no_channel" });
    const { data: previous } = await db.from("youtube_connection").select("refresh_token, yt_channel_id").eq("id", 1).maybeSingle();
    const refresh = tok.refresh_token ?? (previous && previous.yt_channel_id === me.id ? previous.refresh_token : null);
    if (!refresh) return back({ youtube: "error", reason: "no_refresh" });
    const row = {
      id: 1,
      yt_channel_id: me.id,
      yt_title: String(me.snippet?.title ?? "").slice(0, 100),
      yt_handle: String(me.snippet?.customUrl ?? "").slice(0, 60),
      access_token: tok.access_token,
      refresh_token: refresh,
      expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      // Anderer YouTube-Kanal: anderer Stream-Schlüssel
      ...(previous && previous.yt_channel_id !== me.id ? { stream_id: null } : {}),
      connected_by: st.user_id,
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from("youtube_connection").upsert(row, { onConflict: await channelKey("id") });
    if (error) throw error;
    const conn = await getYoutube();
    await setLive({ chat_merge: conn?.chat_merge ?? true });
    // Schlüssel gleich anlegen – klappt das nicht (Livestreams noch nicht freigeschaltet), steht der Grund im Dashboard
    if (conn) {
      await ensureStream(conn).then(() => setLive({ message: "" }))
        .catch((e) => setLive({ status: "error", message: ytReason(e).slice(0, 300) }));
    }
    return back({ youtube: "connected" });
  } catch (e) {
    console.error(e);
    return back({ youtube: "error", reason: "unknown", detail: ytReason(e).slice(0, 200) });
  }
}

async function disconnect(userId: string) {
  const { data } = await db.from("youtube_connection").select("refresh_token").eq("id", 1).maybeSingle();
  if (data?.refresh_token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(data.refresh_token)}`, { method: "POST" })
      .catch((e) => console.warn("Google-Widerruf:", errorText(e)));
  }
  await db.from("youtube_connection").delete().eq("id", 1);
  await setLive({ video_id: null, status: "idle", message: "", chat_merge: false });
  await audit(userId, "youtube_disconnect");
  return json({ ok: true });
}
