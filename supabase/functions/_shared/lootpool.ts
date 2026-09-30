// Fortnite-Lootpool von fortniteapi.io lesen (GET /v1/loot/list, Header Authorization: <Schlüssel>).
// Antwort (vereinfacht): {result: true, weapons: [{id, enabled, name, rarity, type, images: {icon, background}}]}
// enabled = gerade im Lootpool. Jede Seltenheit einer Waffe ist ein eigener Eintrag mit eigener ID.
// Das Format ist nicht offiziell festgeschrieben – deshalb wird hier vorsichtig gelesen.

// Die API läuft inzwischen unter api.fortniteapi.io – die alte Adresse ohne „api.“ hat keinen
// DNS-Eintrag mehr. Sie bleibt als Ersatz in der Liste, falls sie zurückkommt.
export const LOOT_URLS = [
  "https://api.fortniteapi.io/v1/loot/list?lang=de",
  "https://fortniteapi.io/v1/loot/list?lang=de",
];

export type LootItem = { loot_id: string; name: string; path: string; rarity: string | null };

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic", "exotic"];

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function rarityOf(v: unknown): string | null {
  const raw = typeof v === "object" && v ? (v as any).id ?? (v as any).name : v;
  const r = text(raw).toLowerCase();
  return RARITIES.includes(r) ? r : null;
}

function imageOf(item: any): string {
  const images = item?.images ?? {};
  for (const url of [images.icon, images.background, images.full_background, item?.image, item?.icon]) {
    const u = text(url);
    if (/^https:\/\/[^\s"'<>]+$/.test(u)) return u;
  }
  return "";
}

// Aktive Items mit Name und Bild. Der Pfad bekommt die ID als #…, damit er eindeutig ist
// (mehrere Seltenheiten teilen sich oft dasselbe Bild).
export function parseLootpool(data: any): LootItem[] {
  const list = [data?.weapons, data?.items, data?.loot, data?.data].find(Array.isArray) ?? [];
  const seen = new Set<string>();
  const out: LootItem[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || item.enabled === false) continue;
    const id = text(item.id);
    const name = text(item.name).replace(/\s+/g, " ").slice(0, 40).trim();
    const image = imageOf(item);
    if (!id || id.length > 120 || !name || !image || seen.has(id)) continue;
    if (/ammo|munition/i.test(text(item.type))) continue;
    seen.add(id);
    out.push({ loot_id: id, name, path: `${image}#${encodeURIComponent(id)}`, rarity: rarityOf(item.rarity) });
  }
  return out;
}
