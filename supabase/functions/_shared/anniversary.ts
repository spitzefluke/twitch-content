// Kanal-Jubiläum (Migration …_channel_anniversary.sql): sammelt beim Auslösen alle Daten,
// die der Film im Overlay zeigt – immer vom verbundenen Kanal, nichts ist fest eingebaut.
//   Twitch: Name, Login, Profilbild, „auf Twitch seit“, Follower, Titel/Kategorie,
//           nächster Termin im Zeitplan, Mods
//   Datenbank: Watchtime der Community, Content-Ideen (Kacheln), Bits/Abos seit StreamHelp
// Der Film läuft im OBS-Overlay über pranks (kind 'show', data = diese Daten).
import { type Connection, db, getAppToken, helix } from "./twitch.ts";

const COOLDOWN_MS = 150_000; // der Film dauert zwei Minuten
const cut = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const soft = <T>(p: Promise<T>) => p.catch((e) => { console.warn("anniversary:", e?.message ?? e); return null; });

export async function startAnniversary(conn: Connection, who: string, start?: string) {
  const { data: last } = await db.from("pranks").select("created_at")
    .eq("kind", "show").eq("item", "anniversary").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - Date.parse(last.created_at) < COOLDOWN_MS) {
    throw new Error("Der Jubiläums-Film läuft noch. Warte, bis er fertig ist.");
  }
  const data = await collect(conn, start);
  const { data: row, error } = await db.from("pranks")
    .insert({ kind: "show", item: "anniversary", requested_by: cut(who, 25) || "Mod", data })
    .select("*").single();
  if (error) throw error;
  return row;
}

async function collect(conn: Connection, start?: string) {
  const id = conn.broadcaster_id;
  const app = await getAppToken();
  const [users, channel, followers, schedule, mods, watch, tiles, alerts] = await Promise.all([
    soft(helix("users", app, { query: { id } })),
    soft(helix("channels", app, { query: { broadcaster_id: id } })),
    soft(helix("channels/followers", conn.access_token, { query: { broadcaster_id: id, first: "1" } })),
    soft(helix("schedule", app, { query: { broadcaster_id: id, first: "3" } })),
    soft(helix("moderation/moderators", conn.access_token, { query: { broadcaster_id: id, first: "100" } })),
    soft(db.from("watchtime").select("display_name, login, seconds").gt("seconds", 0).order("seconds", { ascending: false }).limit(5000)),
    soft(db.from("tiles").select("kind, title, description, target_at").order("position")),
    soft(db.from("stream_alerts").select("kind, amount").eq("test", false).limit(20000)),
  ]);
  const user = users?.data?.[0] ?? {};
  const info = channel?.data?.[0] ?? {};

  // „Seit“: frei gewähltes Datum (z. B. erster Stream), sonst seit wann es den Kanal auf Twitch gibt
  const startAt = /^\d{4}-\d{2}-\d{2}$/.test(start ?? "") && !Number.isNaN(Date.parse(start!))
    ? new Date(`${start}T12:00:00Z`).toISOString()
    : user.created_at ?? null;

  // Mods: von Twitch, sonst die zuletzt abgeglichene Liste
  let modNames: string[] = (mods?.data ?? []).map((m: { user_name: string }) => m.user_name);
  if (!modNames.length) {
    const { data } = await db.from("channel_mods").select("display_name, login");
    modNames = (data ?? []).map((m) => m.display_name || m.login);
  }

  const rows = watch?.data ?? [];
  const watchSeconds = rows.reduce((n: number, r: { seconds: number }) => n + Number(r.seconds || 0), 0);
  const top = rows.slice(0, 10).map((r: { display_name: string; login: string; seconds: number }) => ({
    name: cut(r.display_name || r.login, 40), hours: Math.round(Number(r.seconds) / 360) / 10,
  }));
  const al = alerts?.data ?? [];
  const bits = al.filter((a: { kind: string }) => a.kind === "bits").reduce((n: number, a: { amount: number }) => n + (a.amount | 0), 0);
  const subs = al.filter((a: { kind: string }) => ["sub", "resub", "gift"].includes(a.kind))
    .reduce((n: number, a: { kind: string; amount: number }) => n + (a.kind === "gift" ? Math.max(1, a.amount | 0) : 1), 0);

  // Content: die Kacheln der Seite, die schon freigeschaltet sind (ohne reine Countdowns)
  const now = Date.now();
  const tileRows = tiles?.data ?? [];
  const content = tileRows
    .filter((t: { kind: string; target_at: string | null }) => t.kind !== "countdown" && (!t.target_at || Date.parse(t.target_at) <= now))
    .slice(0, 8)
    .map((t: { title: string; description: string }) => ({ title: cut(t.title, 40), text: cut(t.description, 110) }));

  // Als Nächstes: Termin aus dem Twitch-Zeitplan, sonst die nächste Content-Idee mit Datum
  const seg = (schedule?.data?.segments ?? []).find((s: { start_time: string; canceled_until?: string | null }) =>
    Date.parse(s.start_time) > now && !s.canceled_until);
  const countdown = tileRows
    .filter((t: { target_at: string | null }) => t.target_at && Date.parse(t.target_at) > now)
    .sort((a: { target_at: string }, b: { target_at: string }) => Date.parse(a.target_at) - Date.parse(b.target_at))[0];
  const next = seg
    ? { title: cut(seg.title || seg.category?.name || "Nächster Stream", 60), at: seg.start_time }
    : countdown ? { title: cut(countdown.title, 60), at: countdown.target_at } : null;

  return {
    v: 1,
    name: cut(user.display_name || conn.display_name, 40),
    login: cut(user.login || conn.broadcaster_login, 40),
    avatar: typeof user.profile_image_url === "string" && user.profile_image_url.startsWith("https://") ? user.profile_image_url : "",
    since: startAt,
    since_kind: start ? "custom" : "twitch",
    title: cut(info.title, 120),
    game: cut(info.game_name, 60),
    followers: Number(followers?.total ?? 0) || 0,
    watch_hours: Math.round(watchSeconds / 3600),
    chatters: rows.length,
    bits,
    subs,
    content_count: content.length,
    content,
    mods: modNames.map((m) => cut(m, 30)).filter(Boolean).slice(0, 12),
    top,
    next,
  };
}
