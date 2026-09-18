// Drehung von der Website aus. Das Ergebnis wird serverseitig ausgelost,
// damit es für alle gleich ist und optional im Twitch-Chat landet.
import {
  chatText, CodedError, corsHeaders, db, getConnection, getUserFromRequest, json, sendChat,
  performSpin,
} from "../_shared/twitch.ts";

const COOLDOWN_MS = 8000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);

  const user = await getUserFromRequest(req);
  if (!user) return json({ error: "Nicht angemeldet" }, 401);

  const { variant_id, announce } = await req.json().catch(() => ({}));
  const { data: profile } = await db.from("profiles").select("username, is_admin").eq("id", user.id).maybeSingle();

  const { data: last } = await db.from("spins").select("created_at").eq("user_id", user.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - Date.parse(last.created_at) < COOLDOWN_MS) {
    return json({ error: "Kurz warten – das Rad dreht sich noch." }, 429);
  }

  try {
    const spin = await performSpin({
      variantId: variant_id,
      source: "web",
      requestedBy: profile?.username ?? "Zuschauer",
      userId: user.id,
    });

    let announced = false;
    if (announce && profile?.is_admin) {
      const conn = await getConnection();
      if (conn) {
        try {
          await sendChat(conn, chatText(spin));
          announced = true;
        } catch (e) {
          console.error("Chat-Nachricht fehlgeschlagen:", e);
        }
      }
    }
    return json({ spin, announced });
  } catch (e) {
    console.error(e);
    if (e instanceof CodedError && e.code === "unknown_variant") return json({ error: e.message }, 400);
    return json({ error: "Drehen fehlgeschlagen" }, 500);
  }
});
