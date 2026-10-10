// Song-Wünsche (Migration …_chat_bot_plus.sql): YouTube-Link erkennen und bei YouTube nachschlagen.
// Titel kommt aus oEmbed (geht nur für einbettbare Videos – genau die kann der Player im Dashboard abspielen),
// die Länge aus den Player-Daten von YouTube. Klappt das nicht, bleibt sie 0 (dann ohne Längen-Grenze).

const ID = /^[A-Za-z0-9_-]{11}$/;

export function parseVideoId(text: string): string | null {
  const m = text.match(
    /(?:youtu\.be\/|(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com\/(?:watch\?(?:\S*?&)?v=|shorts\/|embed\/|live\/|v\/))([A-Za-z0-9_-]{11})/i,
  );
  if (m) return m[1];
  // Nur die Kennung (11 Zeichen) geht auch
  return text.trim().split(/\s+/).find((w) => ID.test(w)) ?? null;
}

export type VideoInfo = { ok: true; title: string; seconds: number } | { ok: false; reason: "missing" | "live" };

export async function lookupVideo(id: string): Promise<VideoInfo> {
  if (!ID.test(id)) return { ok: false, reason: "missing" };
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const o = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`);
  if (!o.ok) return { ok: false, reason: "missing" }; // gibt es nicht, privat oder nicht einbettbar
  const meta = await o.json().catch(() => ({}));
  const title = String(meta?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "YouTube-Video";
  let seconds = 0;
  try {
    const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId: id, context: { client: { clientName: "WEB", clientVersion: "2.20250101.00.00", hl: "de" } } }),
    });
    const j = await r.json();
    seconds = Math.max(0, Math.min(86400, Number(j?.videoDetails?.lengthSeconds) || 0));
    if (j?.videoDetails?.isLive || (j?.videoDetails?.isLiveContent && !seconds)) return { ok: false, reason: "live" };
  } catch {
    // Länge unbekannt – trotzdem eintragen
  }
  return { ok: true, title, seconds };
}
