// Discord-Anbindung (Migration …_discord.sql): Nachrichten über den Webhook des Streamers.
//   · Live-Benachrichtigung beim Stream-Start (twitch-eventsub stream.online)
//   · Rückblick nach dem Stream (twitch-eventsub stream.offline, nach stream_offline_event)
//   · Ankündigungen: Wochenplan und Content-Ideen mit Termin (stream-tools discord_post)
// Die Webhook-Adresse kommt nur aus der Datenbank und wird vor jedem Senden nochmals geprüft:
// gepostet wird ausschließlich an discord.com/api/webhooks/… (kein Weg zu anderen Servern).
import { db, getConnection } from "./twitch.ts";
import { fmtDuration, liveData } from "./bot.ts";

export const WEBHOOK_RE = /^https:\/\/(ptb\.|canary\.)?discord(app)?\.com\/api\/webhooks\/[0-9]{5,25}\/[A-Za-z0-9_-]{20,100}$/;
const PURPLE = 0x9146ff;
const RED = 0xeb0400;

type Target = { url: string; live_text: string; mention: string; login: string; display_name: string };
type Embed = {
  title?: string; url?: string; description?: string; color?: number; image?: { url: string }; thumbnail?: { url: string };
  fields?: { name: string; value: string; inline?: boolean }[]; footer?: { text: string }; timestamp?: string;
};
export type Payload = { content?: string; embeds?: Embed[]; allowed_mentions: { parse: string[]; roles?: string[] }; username?: string };

const cut = (s: unknown, n: number) => String(s ?? "").slice(0, n);
const twitchUrl = (login: string) => `https://twitch.tv/${encodeURIComponent(login)}`;
// Discord zeigt <t:…> in der Zeitzone der Lesenden an
const when = (iso: string) => {
  const t = Math.floor(Date.parse(iso) / 1000);
  return Number.isFinite(t) ? `<t:${t}:F> (<t:${t}:R>)` : "";
};

// Erwähnung: '' / here / everyone / Rollen-ID → Text und erlaubte Erwähnungen (nichts anderes pingt)
export function mentionOf(mention: string): { text: string; allowed: Payload["allowed_mentions"] } {
  if (mention === "here" || mention === "everyone") return { text: `@${mention} `, allowed: { parse: ["everyone"] } };
  if (/^[0-9]{5,25}$/.test(mention)) return { text: `<@&${mention}> `, allowed: { parse: [], roles: [mention] } };
  return { text: "", allowed: { parse: [] } };
}

// Senden: Status merken (discord_mark), damit das Dashboard Fehler anzeigen kann
export async function postDiscord(url: string, payload: Payload): Promise<{ ok: boolean; error?: string }> {
  if (!WEBHOOK_RE.test(url)) return { ok: false, error: "Ungültige Webhook-Adresse" };
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    const error = `Discord nicht erreichbar: ${cut((e as Error)?.message ?? e, 120)}`;
    await db.rpc("discord_mark", { p_ok: false, p_error: error });
    return { ok: false, error };
  }
  await res.body?.cancel();
  if (res.ok) {
    await db.rpc("discord_mark", { p_ok: true, p_error: "" });
    return { ok: true };
  }
  const error = res.status === 404 || res.status === 401
    ? "Den Webhook gibt es nicht mehr – bitte im Dashboard neu verbinden."
    : res.status === 429 ? "Discord bremst gerade (zu viele Nachrichten)." : `Discord antwortet mit Fehler ${res.status}.`;
  await db.rpc("discord_mark", { p_ok: false, p_error: error });
  return { ok: false, error };
}

async function target(kind: "live" | "recap" | "ideas" | "manual"): Promise<Target | null> {
  const { data, error } = await db.rpc("discord_target", { p_kind: kind });
  if (error) {
    if (!/discord_target/.test(error.message)) console.warn("discord_target:", error.message); // Migration fehlt: nichts tun
    return null;
  }
  return data?.url ? (data as Target) : null;
}

export function fillLiveText(text: string, v: { streamer: string; title: string; game: string; link: string }) {
  return text
    .replaceAll("{streamer}", v.streamer)
    .replaceAll("{title}", v.title)
    .replaceAll("{game}", v.game || "einem neuen Stream")
    .replaceAll("{link}", v.link)
    .replace(/\s+([!?.,])/g, "$1").replace(/\s*[:–-]\s*$/, "").trim();
}

export function livePayload(t: Target, d: { title: string; game: string }, now = Date.now()): Payload {
  const streamer = t.display_name || t.login;
  const link = twitchUrl(t.login);
  const m = mentionOf(t.mention);
  const text = fillLiveText(t.live_text, { streamer, title: d.title, game: d.game, link });
  return {
    content: cut(`${m.text}${text}`, 1900),
    allowed_mentions: m.allowed,
    embeds: [{
      title: cut(d.title || `${streamer} ist live`, 250),
      url: link,
      color: RED,
      description: d.game ? `🎮 ${cut(d.game, 200)}` : undefined,
      // Vorschaubild von Twitch – die Zahl am Ende umgeht Discords Bild-Zwischenspeicher
      image: { url: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${encodeURIComponent(t.login)}-1280x720.jpg?t=${Math.floor(now / 60000)}` },
      footer: { text: "StreamHelp" },
      timestamp: new Date(now).toISOString(),
    }],
  };
}

// twitch-eventsub stream.online
export async function discordLive(event: { type?: string }) {
  if (event.type && event.type !== "live") return; // keine Wiederholungen oder Premieren
  const t = await target("live");
  if (!t) return;
  const conn = await getConnection().catch(() => null);
  // Kurz nach dem Start kennt Twitch die Kategorie manchmal noch nicht: einmal nachfragen
  let d = conn ? await liveData(conn).catch(() => null) : null;
  if (conn && !d?.game) {
    await new Promise((r) => setTimeout(r, 4000));
    d = await liveData(conn).catch(() => d);
  }
  const res = await postDiscord(t.url, livePayload(t, { title: d?.title ?? "", game: d?.game ?? "" }));
  if (!res.ok) console.warn("Discord live:", res.error);
}

type Recap = { started_at: string; ended_at: string; game: string; peak: number; avg: number; follows: number; subs: number; bits: number; chatters: number };

export function recapPayload(t: Target, r: Recap): Payload {
  const streamer = t.display_name || t.login;
  const dur = fmtDuration(Date.parse(r.ended_at) - Date.parse(r.started_at));
  const fields = [
    { name: "⏱️ Dauer", value: dur || "–", inline: true },
    { name: "👀 Zuschauer", value: `Ø ${r.avg} · Spitze ${r.peak}`, inline: true },
    { name: "💬 Im Chat", value: String(r.chatters), inline: true },
    r.follows ? { name: "💜 Neue Follower", value: String(r.follows), inline: true } : null,
    r.subs ? { name: "⭐ Abos", value: String(r.subs), inline: true } : null,
    r.bits ? { name: "💎 Bits", value: String(r.bits), inline: true } : null,
  ].filter((f): f is { name: string; value: string; inline: boolean } => !!f);
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `Rückblick: ${cut(streamer, 80)} war live`,
      url: twitchUrl(t.login),
      description: r.game ? `🎮 ${cut(r.game, 200)}\nDanke an alle, die dabei waren! 💜` : "Danke an alle, die dabei waren! 💜",
      color: PURPLE,
      fields,
      footer: { text: "StreamHelp" },
      timestamp: r.ended_at,
    }],
  };
}

// twitch-eventsub stream.offline – nachdem stream_offline_event den Stream abgeschlossen hat
export async function discordRecap() {
  const t = await target("recap");
  if (!t) return;
  const { data, error } = await db.rpc("discord_recap");
  if (error || !data) return;
  const res = await postDiscord(t.url, recapPayload(t, data as Recap));
  if (!res.ok) console.warn("Discord Rückblick:", res.error);
}

type Slot = { at: string; minutes: number; title: string; game: string };
type Idea = { id: string; title: string; description: string; target_at: string };

export function schedulePayload(t: Target, upcoming: Slot[], site?: string): Payload {
  const streamer = t.display_name || t.login;
  const lines = upcoming.slice(0, 7).map((s) => {
    const what = [s.title, s.game && `🎮 ${s.game}`].filter(Boolean).map((x) => cut(x, 80)).join(" · ");
    return `**${when(s.at)}**${what ? `\n${what}` : ""}`;
  });
  const profile = site ? `${site.replace(/\/+$/, "")}/profil.html?c=${encodeURIComponent(t.login)}` : "";
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `📅 Nächste Streams von ${cut(streamer, 80)}`,
      url: twitchUrl(t.login),
      description: cut(lines.length ? lines.join("\n\n") : "Gerade sind keine Streams geplant.", 3800) +
        (profile ? `\n\n[Ganzer Zeitplan](${profile})` : ""),
      color: PURPLE,
      footer: { text: "StreamHelp" },
    }],
  };
}

export function ideaPayload(t: Target, idea: Idea): Payload {
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `✨ Neu im Stream: ${cut(idea.title, 200)}`,
      url: twitchUrl(t.login),
      description: [cut(idea.description, 1500), `🗓️ Start: ${when(idea.target_at)}`].filter(Boolean).join("\n\n"),
      color: PURPLE,
      footer: { text: `${cut(t.display_name || t.login, 80)} · StreamHelp` },
    }],
  };
}

// stream-tools: Ankündigungen (Wochenplan, Content-Idee) und Testnachricht.
// auto = automatisch nach dem Speichern eines Termins: nur wenn eingeschaltet und je Termin einmal.
export async function discordAnnounce(kind: "schedule" | "idea" | "test", tile?: string, auto = false): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const t = await target(auto ? "ideas" : "manual");
  if (!t) return auto ? { ok: true, skipped: true } : { ok: false, error: "Discord ist noch nicht verbunden." };
  if (kind === "test") {
    return await postDiscord(t.url, {
      allowed_mentions: { parse: [] },
      embeds: [{ title: "👋 StreamHelp ist verbunden", description: `Hier erscheinen ab jetzt die Nachrichten von **${cut(t.display_name || t.login, 80)}**.`, color: PURPLE, url: twitchUrl(t.login) }],
    });
  }
  const { data, error } = await db.rpc("discord_announce_data", { p_tile: kind === "idea" && tile ? tile : null });
  if (error || !data) return { ok: false, error: "Daten gerade nicht verfügbar." };
  if (kind === "schedule") return await postDiscord(t.url, schedulePayload(t, (data.upcoming ?? []) as Slot[], Deno.env.get("SITE_URL")));
  const idea = ((data.ideas ?? []) as Idea[])[0];
  if (!idea) return auto ? { ok: true, skipped: true } : { ok: false, error: "Keine Content-Idee mit kommendem Termin." };
  if (auto) {
    const { data: fresh } = await db.rpc("discord_idea_claim", { p_tile: idea.id, p_at: idea.target_at });
    if (fresh !== true) return { ok: true, skipped: true };
  }
  return await postDiscord(t.url, ideaPayload(t, idea));
}

// Webhook prüfen, bevor er gespeichert wird: Gibt es ihn, und wie heißt er?
export async function inspectWebhook(url: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  if (!WEBHOOK_RE.test(url)) return { ok: false, error: "Das ist keine Discord-Webhook-Adresse (https://discord.com/api/webhooks/…)." };
  try {
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      await res.body?.cancel();
      return { ok: false, error: res.status === 404 || res.status === 401 ? "Diesen Webhook gibt es bei Discord nicht (mehr)." : `Discord antwortet mit Fehler ${res.status}.` };
    }
    const w = await res.json().catch(() => ({}));
    return { ok: true, name: cut(w?.name, 80) };
  } catch {
    return { ok: false, error: "Discord ist gerade nicht erreichbar." };
  }
}
