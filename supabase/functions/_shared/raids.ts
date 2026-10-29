// Raid-Netzwerk (Migration …_raid_network.sql):
//   · startRaid: Raid zu einem Mitglied, das gerade live ist (stream-tools raid_start). Die Datenbank prüft
//     Mitgliedschaft, live und Pause (raid_target); der Bot sagt den Raid vorher an, wenn eingeschaltet.
//   · cancelRaid: laufenden Raid abbrechen (stream-tools raid_cancel)
//   · networkWelcome: kommt ein Raid aus dem Netzwerk, begrüßt der Bot ihn mit dem Kurztext des Kanals
//     (twitch-eventsub channel.raid, nach dem normalen Danke)
// Twitch-Recht: channel:manage:raids (Streamer verbinden Twitch dafür einmal neu).
import { db, getConnection, helix, HelixError, sendChat, type Connection } from "./twitch.ts";

export const RAID_SCOPE = "channel:manage:raids";
type Target = { id: string; twitch_id: string; login: string; display_name: string; announce: boolean; raid_text: string };
type Result = { ok: true; target: string } | { ok: false; error: string; reconnect?: boolean };

export function raidText(template: string, target: { display_name: string; login: string }) {
  return template.replaceAll("{target}", target.display_name).replaceAll("{link}", `twitch.tv/${target.login}`).trim().slice(0, 480);
}

const hasScope = (conn: Connection) => (conn.scopes ?? []).includes(RAID_SCOPE);

export async function startRaid(login: string): Promise<Result> {
  const conn = await getConnection();
  if (!conn) return { ok: false, error: "Twitch ist noch nicht verbunden." };
  if (!hasScope(conn)) return { ok: false, reconnect: true, error: "Für Raids braucht StreamHelp ein neues Twitch-Recht: Twitch einmal neu verbinden." };
  const { data, error } = await db.rpc("raid_target", { p_login: login });
  if (error) return { ok: false, error: /raid_target/.test(error.message) ? "Das Raid-Netzwerk ist noch nicht eingerichtet." : error.message.slice(0, 200) };
  const t = data as Target;
  try {
    await helix("raids", conn.access_token, { method: "POST", query: { from_broadcaster_id: conn.broadcaster_id, to_broadcaster_id: t.twitch_id } });
  } catch (e) {
    if (e instanceof HelixError) {
      if (e.status === 401) return { ok: false, reconnect: true, error: "Twitch hat den Raid nicht erlaubt: Twitch einmal neu verbinden." };
      if (e.status === 409) return { ok: false, error: "Es läuft schon ein Raid." };
      if (e.status === 429) return { ok: false, error: "Twitch: zu viele Raids hintereinander – bitte kurz warten." };
      if (e.status === 400) return { ok: false, error: "Twitch lässt diesen Raid nicht zu (Kanal nimmt keine Raids an oder ist offline)." };
    }
    throw e;
  }
  await db.rpc("raid_logged", { p_to: t.id });
  // Ansage erst, wenn Twitch den Raid angenommen hat – sonst stünde im Chat ein Raid, den es nicht gibt
  if (t.announce) await sendChat(conn, raidText(t.raid_text, t), undefined, "system").catch((e) => console.warn("Raid-Ansage:", (e as Error)?.message ?? e));
  return { ok: true, target: t.display_name };
}

export async function cancelRaid(): Promise<Result> {
  const conn = await getConnection();
  if (!conn) return { ok: false, error: "Twitch ist noch nicht verbunden." };
  if (!hasScope(conn)) return { ok: false, reconnect: true, error: "Twitch einmal neu verbinden." };
  try {
    await helix("raids", conn.access_token, { method: "DELETE", query: { broadcaster_id: conn.broadcaster_id } });
  } catch (e) {
    if (e instanceof HelixError && e.status === 404) return { ok: false, error: "Gerade läuft kein Raid." };
    throw e;
  }
  return { ok: true, target: "" };
}

export async function networkWelcome(fromTwitchId: string | undefined) {
  if (!fromTwitchId) return;
  const { data, error } = await db.rpc("raid_welcome", { p_from_twitch_id: fromTwitchId });
  if (error || !data) return; // Migration fehlt oder Raid nicht aus dem Netzwerk
  const conn = await getConnection().catch(() => null);
  if (!conn) return;
  const note = String(data.note ?? "").trim();
  const text = `🤝 ${data.display_name} kommt aus dem StreamHelp-Raid-Netzwerk${note ? ` – ${note}` : ""}. Schaut auch mal bei twitch.tv/${data.login} vorbei!`;
  await sendChat(conn, text.slice(0, 480), undefined, "system").catch((e) => console.warn("Raid-Begrüßung:", (e as Error)?.message ?? e));
}
