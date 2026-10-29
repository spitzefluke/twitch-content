// Webhook für Trinkgeld über Ko-fi (Migration …_tips_sponsors_pro.sql).
// Adresse je Kanal: …/functions/v1/tips?c=<Kanal-ID> – steht im Dashboard unter „Trinkgeld & Sponsoren“.
// Ko-fi schickt keinen Login mit; geprüft wird der Bestätigungs-Token, den der Streamer bei uns hinterlegt.
import { cleanChannel, json, rateLimit, tooMany, withChannel } from "../_shared/twitch.ts";
import { handleKofi, parseKofi } from "../_shared/tips.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);
  const channel = cleanChannel(new URL(req.url).searchParams.get("c"));
  if (!channel || !UUID.test(channel)) return json({ error: "Kanal fehlt" }, 400);
  const body = (await req.text().catch(() => "")).slice(0, 20_000);
  const ev = parseKofi(body);
  if (!ev) return json({ error: "Kein Ko-fi-Webhook" }, 400);
  return await withChannel(channel, async () => {
    if (!(await rateLimit(`tips:${channel}`, 60))) return tooMany();
    try {
      const { status, result } = await handleKofi(ev);
      return json({ result }, status);
    } catch (e) {
      console.error("Trinkgeld:", e);
      return json({ error: "Gerade nicht möglich" }, 500);
    }
  });
});
