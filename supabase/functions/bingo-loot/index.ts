// Fortnite-Bingo: Bilder an den aktuellen Lootpool anpassen.
//   POST {force?: boolean} → {synced, state, missing_key?}
// Jeder angemeldete Besuch des Bingo-Dialogs stößt den Abgleich an – er läuft aber höchstens
// alle 6 Stunden. Admins können ihn sofort auslösen (höchstens einmal pro Minute).
// Braucht das Secret API_FORTNITE_KEY (kostenloser Schlüssel von api-fortnite.com) und
// die Migration …_bingo_lootpool.sql. (fortniteapi.io wurde am 31.03.2026 eingestellt.)
import { db, corsHeaders, getUserFromRequest, isAdminUser, json } from "../_shared/twitch.ts";
import { LOOT_SOURCE, LOOT_URL, parseLootpool } from "../_shared/lootpool.ts";

const AUTO_EVERY = 6 * 60 * 60 * 1000;
const MIN_GAP = 60 * 1000;
// Weniger Items heißt fast sicher: Antwort kaputt – dann nichts deaktivieren
const MIN_ITEMS = 10;

type State = { synced_at: string | null; items: number; error: string; updated_at: string };

const age = (at: string | null) => (at ? Date.now() - new Date(at).getTime() : Infinity);

async function setState(patch: Partial<State>) {
  const { data } = await db.from("bingo_loot_state")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1).select().single();
  return data as State | null;
}

function serverReason(body: any): string {
  const pick = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" ? (v as any).message ?? (v as any).code : "");
  return String(pick(body?.error) || body?.title || body?.detail || body?.message || "").replace(/\s+/g, " ").trim().slice(0, 110);
}

async function fetchLootpool(key: string) {
  let res: Response;
  try {
    res = await fetch(LOOT_URL, { headers: { "x-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new Error(`${LOOT_SOURCE} ist gerade nicht erreichbar (${String((e as Error)?.message ?? e).slice(0, 120)}).`);
  }
  const body = await res.json().catch(() => null);
  // Was der Server als Grund mitschickt (wie im SDK des Anbieters: error / title / detail / message)
  const reason = serverReason(body);
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Schlüssel API_FORTNITE_KEY wird nicht angenommen (${res.status}${reason ? `: ${reason}` : ""}).`);
  }
  if (res.status === 429) throw new Error(`${LOOT_SOURCE}: zu viele Anfragen – später noch einmal.${reason ? ` (${reason})` : ""}`);
  if (!res.ok) throw new Error(`${LOOT_SOURCE} antwortet mit ${res.status}${reason ? `: ${reason}` : ""}.`);
  if (body?.success === false) throw new Error(`${LOOT_SOURCE}: ${reason || "Fehler"}`);
  const items = parseLootpool(body);
  if (items.length < MIN_ITEMS) throw new Error(`${LOOT_SOURCE} liefert gerade keinen brauchbaren Lootpool (${items.length} Items).`);
  return items;
}

async function sync(key: string) {
  const items = await fetchLootpool(key);
  const { error } = await db.from("bingo_items").upsert(
    items.map((i) => ({ ...i, source: "lootpool", active: true })),
    { onConflict: "loot_id" },
  );
  if (error) throw new Error(`Speichern fehlgeschlagen: ${error.message}`);

  // Was nicht mehr im Lootpool ist, zieht keine neue Karte mehr (alte Karten behalten ihre Bilder)
  const ids = new Set(items.map((i) => i.loot_id));
  const { data: stored } = await db.from("bingo_items").select("id, loot_id").eq("source", "lootpool").eq("active", true);
  const gone = (stored ?? []).filter((s) => !ids.has(s.loot_id)).map((s) => s.id);
  for (let i = 0; i < gone.length; i += 100) {
    await db.from("bingo_items").update({ active: false }).in("id", gone.slice(i, i + 100));
  }
  return items.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);
  const user = await getUserFromRequest(req);
  if (!user) return json({ error: "Bitte anmelden." }, 401);
  const body = await req.json().catch(() => ({}));

  const { data: state, error: stateError } = await db.from("bingo_loot_state").select("*").eq("id", 1).maybeSingle();
  if (stateError || !state) {
    return json({ error: "In der Datenbank fehlt der Lootpool fürs Bingo: supabase/migrations/20261013000000_bingo_lootpool.sql im SQL Editor ausführen." }, 500);
  }

  // Beim Einfügen rutschen leicht Anführungszeichen, "Bearer " oder "x-api-key:" mit hinein
  const unquote = (v: string) => v.trim().replace(/^["']+|["']+$/g, "").trim();
  const key = unquote(unquote(Deno.env.get("API_FORTNITE_KEY") ?? "")
    .replace(/^x-api-key\s*:\s*/i, "").replace(/^bearer\s+/i, ""));
  if (!key) {
    const next = state.error === "missing_key" ? state : await setState({ error: "missing_key" });
    return json({ synced: false, missing_key: true, state: next ?? state });
  }

  const force = body.force === true && (await isAdminUser(user.id));
  if (body.force === true && !force) return json({ error: "Nur Admins können den Lootpool sofort abgleichen." }, 403);
  const due = age(state.updated_at) >= MIN_GAP && (force || age(state.synced_at) >= AUTO_EVERY || state.error === "missing_key");
  if (!due) {
    if (force) return json({ error: "Gerade erst abgeglichen – bitte eine Minute warten." }, 429);
    return json({ synced: false, state });
  }

  // Abgleich „reservieren“: laufen zwei Aufrufe gleichzeitig, gleicht nur einer ab
  const { data: claimed } = await db.from("bingo_loot_state")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", 1).eq("updated_at", state.updated_at).select("id");
  if (!claimed?.length) return json({ synced: false, state });

  try {
    const count = await sync(key);
    const next = await setState({ synced_at: new Date().toISOString(), items: count, error: "" });
    return json({ synced: true, state: next });
  } catch (e) {
    const message = String((e as Error)?.message ?? e).slice(0, 200);
    console.warn("Lootpool:", message);
    const next = await setState({ error: message });
    return json({ synced: false, error: message, state: next }, force ? 502 : 200);
  }
});
