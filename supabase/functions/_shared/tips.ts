// Trinkgeld über Ko-fi (Migration …_tips_sponsors_pro.sql, Edge Function tips):
// Ko-fi schickt bei jedem Trinkgeld einen Webhook (Formularfeld „data“ mit JSON). Wir prüfen den
// Bestätigungs-Token des Kanals (tip_kofi_check), zeigen den Alert „tip“ im Overlay (Betrag in Cent,
// Währung in tier) und der Bot bedankt sich. Das Geld fließt nur zwischen Zuschauer und Ko-fi des Streamers;
// E-Mail-Adressen aus dem Webhook werden nicht gespeichert.
import { db, getConnection, sendChat } from "./twitch.ts";
import { saveAlert } from "./alerts.ts";

export type KofiEvent = {
  verification_token?: string; message_id?: string; kofi_transaction_id?: string; type?: string; is_public?: boolean;
  from_name?: string; message?: string | null; amount?: string; currency?: string;
};
type Check = { alert: boolean; thank: boolean; thank_text: string; min_cents: number };

const TIP_TYPES = new Set(["Donation", "Subscription"]);

// Formular-Body → Ko-fi-Daten (null, wenn es kein Ko-fi-Webhook ist)
export function parseKofi(body: string): KofiEvent | null {
  try {
    const data = new URLSearchParams(body).get("data");
    const parsed = data ? JSON.parse(data) : null;
    return parsed && typeof parsed === "object" ? parsed as KofiEvent : null;
  } catch {
    return null;
  }
}

export function cents(amount: unknown): number {
  const n = Number.parseFloat(String(amount ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.min(100_000_000, Math.round(n * 100)) : 0;
}

export function formatMoney(c: number, currency: string) {
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(c / 100);
  } catch {
    return `${(c / 100).toFixed(2).replace(".", ",")} ${currency}`;
  }
}

const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function thankText(template: string, v: { name: string; amount: string; message: string }) {
  return template.replaceAll("{name}", v.name).replaceAll("{amount}", v.amount).replaceAll("{message}", v.message)
    .replace(/\s+/g, " ").trim().slice(0, 480);
}

// Ergebnis: Status für die Antwort an Ko-fi (200 auch bei „ignoriert“, sonst schickt Ko-fi es immer wieder)
export async function handleKofi(ev: KofiEvent): Promise<{ status: number; result: string }> {
  const { data, error } = await db.rpc("tip_kofi_check", { p_token: String(ev.verification_token ?? "").slice(0, 100) });
  if (error) return { status: /tip_kofi_check/.test(error.message) ? 503 : 500, result: "error" };
  if (!data) return { status: 401, result: "token" };
  const s = data as Check;
  if (!TIP_TYPES.has(String(ev.type))) return { status: 200, result: "ignored" };
  const id = clean(ev.kofi_transaction_id || ev.message_id, 70);
  if (!id) return { status: 400, result: "no_id" };
  // Ko-fi stellt manchmal doppelt zu: jedes Trinkgeld nur einmal
  const { error: dup } = await db.from("chat_cooldowns").insert({ slot: `kofi:${id}`.slice(0, 80) });
  if (dup) return { status: 200, result: "duplicate" };
  const amount = cents(ev.amount);
  const currency = /^[A-Z]{3}$/.test(ev.currency ?? "") ? ev.currency! : "EUR";
  if (!amount || amount < (s.min_cents ?? 0)) return { status: 200, result: "below_min" };
  const pub = ev.is_public !== false;
  const name = pub ? clean(ev.from_name, 60) || "Jemand" : "Anonym";
  const message = pub ? clean(ev.message, 300) : "";
  if (s.alert) await saveAlert({ kind: "tip", user_name: name, tier: currency, amount, message }, `kofi:${id}`);
  if (s.thank) {
    const conn = await getConnection().catch(() => null);
    if (conn) {
      await sendChat(conn, thankText(s.thank_text, { name, amount: formatMoney(amount, currency), message }), undefined, "system")
        .catch((e) => console.warn("Trinkgeld-Dank:", (e as Error)?.message ?? e));
    }
  }
  return { status: 200, result: "ok" };
}
