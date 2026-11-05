// Kanalbilder von Twitch über den eigenen Server (siehe _shared/avatar.ts). Ohne Login aufrufbar (Bilder).
//   GET /functions/v1/avatar?u=https://static-cdn.jtvnw.net/jtv_user_pictures/…png
import { serveAvatar } from "../_shared/avatar.ts";

Deno.serve((req) => serveAvatar(req));
