// YouTube-Livechat fürs OBS-Overlay (Chat-Ebene, overlay.html?chat=…&yt=@kanal).
// Das Overlay kann youtube.com nicht selbst abfragen (der Browser verbietet das),
// deshalb holt diese Funktion die Nachrichten und gibt sie weiter. Sie speichert nichts.
//   POST {channel: "@kanal" | "UC…"}                     → {live:false} oder {live:true, videoId, continuation, clientVersion, apiKey}
//   POST {continuation, clientVersion, apiKey}          → {ended:true} oder {messages, removed, removedAuthors, continuation, timeoutMs}
// Ohne Anmeldung aufrufbar (OBS hat keine) – sie fragt nur fest vorgegebene YouTube-Adressen ab.
import { CHANNEL_RE, CONTINUATION_RE, pollChat, startChat } from "../_shared/youtube.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);
  const body = await req.json().catch(() => ({}));
  try {
    if (typeof body.continuation === "string") {
      if (!CONTINUATION_RE.test(body.continuation)) return json({ error: "Ungültiger Startpunkt" }, 400);
      return json(await pollChat(body.continuation, String(body.clientVersion ?? ""), body.apiKey ? String(body.apiKey) : null));
    }
    const channel = String(body.channel ?? "").trim();
    if (!CHANNEL_RE.test(channel)) return json({ error: "Kanal als @name oder Kanal-ID (UC…) angeben." }, 400);
    return json(await startChat(channel));
  } catch (e) {
    console.warn("YouTube-Chat:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 200) }, 502);
  }
});
