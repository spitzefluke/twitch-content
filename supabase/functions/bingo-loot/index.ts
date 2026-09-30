// Fortnite-Bingo: Bilder an den aktuellen Lootpool anpassen.
//   POST {force?: boolean} → {synced, state, missing_key?}
// Jeder angemeldete Besuch des Bingo-Dialogs stößt den Abgleich an – er läuft aber höchstens
// alle 6 Stunden. Admins können ihn sofort auslösen (höchstens einmal pro Minute).
// Braucht das Secret FORTNITEAPI_IO_KEY (kostenloser Schlüssel von fortniteapi.io) und
// die Migration …_bingo_lootpool.sql.
import { db, corsHeaders, getUserFromRequest, isAdminUser, json } from "../_shared/twitch.ts";
import { LOOT_URLS, parseLootpool } from "../_shared/lootpool.ts";

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

// Erste Adresse, die antwortet; Netzwerkfehler (z. B. DNS) → nächste Adresse
async function requestLootpool(key: string) {
  let lastError: unknown = null;
  for (const url of LOOT_URLS) {
    try {
      return await fetch(url, { headers: { Authorization: key, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      lastError = e;
      console.warn(`bingo-loot: ${new URL(url).host} nicht erreichbar:`, (e as Error)?.message ?? e);
    }
  }
  throw new Error(`fortniteapi.io ist gerade nicht erreichbar (${String((lastError as Error)?.message ?? lastError).slice(0, 120)}).`);
}

async function fetchLootpool(key: string) {
  const res = await requestLootpool(key);
  if (res.status === 401 || res.status === 403) throw new Error("Schlüssel FORTNITEAPI_IO_KEY wird nicht angenommen.");
  if (!res.ok) throw new Error(`fortniteapi.io antwortet mit ${res.status}.`);
  const items = parseLootpool(await res.json());
  if (items.length < MIN_ITEMS) throw new Error("fortniteapi.io liefert gerade keinen brauchbaren Lootpool.");
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

  const key = Deno.env.get("FORTNITEAPI_IO_KEY")?.trim();
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
