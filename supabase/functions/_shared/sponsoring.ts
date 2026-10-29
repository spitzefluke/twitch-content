// Sponsoring-Börse (Migration …_sponsoring.sql, Edge Function sponsoring): alles, was Firmen tun.
// Firmen haben kein Konto – sie verwalten ihr Angebot über einen privaten Link mit zufälligem Schlüssel.
// In der Datenbank liegt nur dessen SHA-256; wer den Link kennt, kann das Angebot verwalten.
import { db } from "./twitch.ts";

export const TOKEN_RE = /^[0-9a-f]{64}$/;
const LOGO_TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  "image/png": { ext: "png", magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": { ext: "webp", magic: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
};
export const LOGO_MAX = 1024 * 1024;

export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// data:image/png;base64,… → Bytes (nur PNG/JPG/WebP, höchstens 1 MB, Dateikopf passt zum Typ)
export function parseLogo(dataUrl: unknown): { bytes: Uint8Array; type: string; ext: string } | { error: string } | null {
  if (dataUrl === null || dataUrl === undefined || dataUrl === "") return null;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) return { error: "Logo: bitte PNG, JPG oder WebP." };
  if (m[2].length > Math.ceil(LOGO_MAX * 4 / 3) + 4) return { error: "Logo: höchstens 1 MB." };
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  } catch {
    return { error: "Logo: Datei lässt sich nicht lesen." };
  }
  const t = LOGO_TYPES[m[1]];
  if (bytes.length > LOGO_MAX) return { error: "Logo: höchstens 1 MB." };
  if (bytes.length < 12 || !t.magic(bytes)) return { error: "Logo: Datei passt nicht zum Bildtyp." };
  return { bytes, type: m[1], ext: t.ext };
}

const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const int = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? String(n) : "";
};

// Formular → Daten für sponsoring_submit (prüft die Datenbank noch einmal genau)
export function offerFields(o: Record<string, unknown>) {
  return {
    company: str(o.company, 80), contact_email: str(o.contact_email, 120), website: str(o.website, 300),
    title: str(o.title, 100), description: str(o.description, 1500), reward: str(o.reward, 200),
    pay_mode: o.pay_mode === "streamhelp" ? "streamhelp" : "direct",
    amount_cents: o.amount_cents === "" || o.amount_cents === null || o.amount_cents === undefined ? "" : int(o.amount_cents),
    min_viewers: int(o.min_viewers ?? 0) || "0",
    max_viewers: o.max_viewers === "" || o.max_viewers === null || o.max_viewers === undefined ? "" : int(o.max_viewers),
    slots: int(o.slots ?? 10) || "10", ends_on: /^\d{4}-\d{2}-\d{2}$/.test(String(o.ends_on ?? "")) ? String(o.ends_on) : "",
    overlay_text: str(o.overlay_text, 100), code: str(o.code, 40), link: str(o.link, 300),
    every_min: int(o.every_min ?? 15) || "15", show_sec: int(o.show_sec ?? 12) || "12",
  };
}

export async function submitOffer(offer: Record<string, unknown>, logo: unknown) {
  const parsed = parseLogo(logo);
  if (parsed && "error" in parsed) return { status: 400, body: { error: parsed.error } };
  const id = crypto.randomUUID();
  const token = newToken();
  let path: string | null = null;
  if (parsed) {
    path = `${id}.${parsed.ext}`;
    const { error } = await db.storage.from("sponsor-assets").upload(path, parsed.bytes, { contentType: parsed.type, upsert: false });
    if (error) return { status: 500, body: { error: "Logo konnte nicht gespeichert werden." } };
  }
  const { error } = await db.rpc("sponsoring_submit", { p_id: id, p_token_hash: await hashToken(token), p: offerFields(offer), p_logo: path });
  if (error) {
    if (path) await db.storage.from("sponsor-assets").remove([path]);
    if (/sponsoring_submit/.test(error.message)) return { status: 503, body: { error: "Die Sponsoring-Börse ist noch nicht eingerichtet." } };
    return { status: 400, body: { error: friendly(error.message) } };
  }
  return { status: 200, body: { id, token } };
}

// Datenbank-Fehler (Check-Constraints) in verständliche Sätze
export function friendly(msg: string) {
  if (/contact_email/.test(msg)) return "Bitte eine gültige E-Mail-Adresse angeben.";
  if (/company/.test(msg)) return "Bitte den Firmennamen angeben (2–80 Zeichen).";
  if (/title/.test(msg)) return "Bitte einen Titel angeben (3–100 Zeichen).";
  if (/description/.test(msg)) return "Bitte das Angebot beschreiben (mindestens 10 Zeichen).";
  if (/website|link/.test(msg)) return "Links müssen mit https:// beginnen.";
  if (/max_viewers/.test(msg)) return "Die Höchst-Zuschauerzahl muss mindestens so groß sein wie die Mindestzahl.";
  if (/invalid input syntax|out of range/.test(msg)) return "Bitte die Zahlen und das Datum prüfen.";
  return msg.slice(0, 200);
}
