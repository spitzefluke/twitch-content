// deno test --allow-env --allow-net supabase/functions/_shared/avatar_test.ts
// Kanalbilder-Proxy: nur Twitch-Profilbilder, nur Bilder, nichts Großes – ohne echte Server.
import { assertEquals } from "jsr:@std/assert@1";
import { allowedAvatar, MAX_BYTES, serveAvatar } from "./avatar.ts";

const OK = "https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png";
const get = (u: string) => new Request(`http://x/functions/v1/avatar?u=${encodeURIComponent(u)}`);
const img = (type = "image/png", size = 10) => (() => Promise.resolve(new Response(new Uint8Array(size), { headers: { "content-type": type } }))) as typeof fetch;

Deno.test("nur Profilbilder von Twitch", () => {
  assertEquals(allowedAvatar(OK), true);
  assertEquals(allowedAvatar("https://static-cdn.jtvnw.net/user-default-pictures-uv/xyz-profile_image-70x70.jpeg"), true);
  assertEquals(allowedAvatar("https://evil.example/jtv_user_pictures/a.png"), false);
  assertEquals(allowedAvatar("https://static-cdn.jtvnw.net.evil.example/jtv_user_pictures/a.png"), false);
  assertEquals(allowedAvatar("http://static-cdn.jtvnw.net/jtv_user_pictures/a.png"), false);
  assertEquals(allowedAvatar("https://static-cdn.jtvnw.net/emoticons/v2/1/default/dark/2.0"), false);
  assertEquals(allowedAvatar("https://static-cdn.jtvnw.net/jtv_user_pictures/../../secret.png"), false);
  assertEquals(allowedAvatar("https://static-cdn.jtvnw.net/jtv_user_pictures/a.svg"), false);
});

Deno.test("liefert das Bild mit Cache und ohne fremde Ausführung", async () => {
  const res = await serveAvatar(get(OK), img());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "image/png");
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  assertEquals((await res.arrayBuffer()).byteLength, 10);
});

Deno.test("lehnt fremde Adressen, Nicht-Bilder und zu Großes ab", async () => {
  let called = false;
  const spy = (() => { called = true; return Promise.resolve(new Response("x")); }) as typeof fetch;
  assertEquals((await serveAvatar(get("https://evil.example/a.png"), spy)).status, 400);
  assertEquals(called, false);
  assertEquals((await serveAvatar(get(OK), img("text/html"))).status, 415);
  assertEquals((await serveAvatar(get(OK), img("image/png", MAX_BYTES + 1))).status, 413);
  assertEquals((await serveAvatar(new Request("http://x/functions/v1/avatar", { method: "POST" }), img())).status, 405);
  const missing = (() => Promise.resolve(new Response(null, { status: 404 }))) as typeof fetch;
  assertEquals((await serveAvatar(get(OK), missing)).status, 404);
  const broken = (() => Promise.reject(new Error("weg"))) as typeof fetch;
  assertEquals((await serveAvatar(get(OK), broken)).status, 502);
});
