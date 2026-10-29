// Sponsoring-Börse für Firmen (Migration …_sponsoring.sql), aufgerufen von sponsoring.html ohne Login:
//   POST {action:"submit", offer, logo?, website2}  → Angebot einreichen (wartet auf Freigabe); Antwort: {id, token}
//                                                    → Verwaltungs-Link sponsoring.html?k=<token> (nur einmal angezeigt)
//   POST {action:"manage", token}                   → Angebot und Bewerbungen
//   POST {action:"decide", token, application_id, decision: accept|decline|end, note?}
//   POST {action:"close", token}                    → Angebot beenden (laufende Einblendungen enden)
// Spam-Schutz: verstecktes Feld website2, höchstens 3 Angebote pro Stunde je IP und 50 am Tag insgesamt.
// Noch geschlossen (Gewerbe in Anmeldung): Angebote nimmt die Funktion erst an, wenn das Secret SPONSORING_OPEN=1 gesetzt ist.
import { corsHeaders, db, json, rateLimit, tooMany } from "../_shared/twitch.ts";
import { friendly, hashToken, submitOffer, TOKEN_RE } from "../_shared/sponsoring.ts";

const clientIp = (req: Request) =>
  req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);
  if (Number(req.headers.get("content-length") ?? 0) > 2_000_000) return json({ error: "Zu groß" }, 413);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    if (body.action === "submit") {
      if (Deno.env.get("SPONSORING_OPEN") !== "1") {
        return json({ error: "Die Sponsoring-Börse ist noch nicht geöffnet – wir melden dafür gerade ein Gewerbe an." }, 403);
      }
      if (body.website2) return json({ id: crypto.randomUUID(), token: "0".repeat(64) }); // Honigtopf: still „ok“
      const ip = clientIp(req) || "unbekannt";
      if (!(await rateLimit(`sponsoring:ip:${ip}`, 3, 3600)) || !(await rateLimit("sponsoring:all", 50, 86400))) return tooMany();
      const offer = body.offer && typeof body.offer === "object" ? body.offer as Record<string, unknown> : {};
      const res = await submitOffer(offer, body.logo);
      return json(res.body, res.status);
    }
    const token = String(body.token ?? "");
    if (!TOKEN_RE.test(token)) return json({ error: "Unbekannter Verwaltungs-Link." }, 404);
    const hash = await hashToken(token);
    if (!(await rateLimit(`sponsoring:manage:${hash.slice(0, 16)}`, 60))) return tooMany();
    let rpc;
    if (body.action === "manage") rpc = await db.rpc("sponsoring_manage", { p_token_hash: hash });
    else if (body.action === "decide") {
      const decision = String(body.decision ?? "");
      if (!["accept", "decline", "end"].includes(decision)) return json({ error: "Unbekannte Entscheidung" }, 400);
      rpc = await db.rpc("sponsoring_decide", {
        p_token_hash: hash, p_app: Number(body.application_id) || 0, p_action: decision, p_note: String(body.note ?? "").slice(0, 300),
      });
    } else if (body.action === "close") rpc = await db.rpc("sponsoring_close", { p_token_hash: hash });
    else return json({ error: "Unbekannte Aktion" }, 400);
    if (rpc.error) return json({ error: friendly(rpc.error.message) }, 400);
    if (!rpc.data) return json({ error: "Unbekannter Verwaltungs-Link." }, 404);
    return json(rpc.data);
  } catch (e) {
    console.error("sponsoring:", e);
    return json({ error: "Gerade nicht möglich – bitte später noch einmal." }, 500);
  }
});
