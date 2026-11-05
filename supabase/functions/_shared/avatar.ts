// Kanalbilder von Twitch über den eigenen Server ausliefern (Edge Function avatar): Besucher der Startseite,
// der Profile und des Dashboards laden das Bild bei uns, nicht bei Twitch – ihre IP-Adresse geht nicht an Twitch.
// Erlaubt sind nur Profilbilder von Twitchs Bild-Server, damit niemand die Funktion als offenen Proxy nutzt.
const ALLOWED = /^https:\/\/static-cdn\.jtvnw\.net\/(?:jtv_user_pictures|user-default-pictures-uv)\/[\w.\-/]{1,200}\.(?:png|jpe?g|webp|gif)$/i;
const TYPES = /^image\/(?:png|jpeg|webp|gif)$/i;
export const MAX_BYTES = 1_500_000;

export const allowedAvatar = (url: string) => ALLOWED.test(url) && !url.includes("..");

const headers = (type: string) => ({
  "Content-Type": type,
  "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
});

// GET ?u=<Bild-Adresse bei Twitch> → das Bild (oder 400/404/415/413 ohne Inhalt)
export async function serveAvatar(req: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  if (req.method !== "GET") return new Response(null, { status: 405 });
  const url = new URL(req.url).searchParams.get("u") ?? "";
  if (!allowedAvatar(url)) return new Response(null, { status: 400 });
  let res: Response;
  try {
    res = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(8_000) });
  } catch (e) {
    console.warn("avatar:", (e as Error).message);
    return new Response(null, { status: 502 });
  }
  if (!res.ok) return new Response(null, { status: res.status === 404 ? 404 : 502 });
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!TYPES.test(type)) return new Response(null, { status: 415 });
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response(null, { status: 413 });
  return new Response(body, { headers: headers(type) });
}
