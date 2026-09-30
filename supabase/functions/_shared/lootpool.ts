// Fortnite-Lootpool von api-fortnite.com lesen.
//   GET https://prod.api-fortnite.com/api/v2/weapons?lang=de&gamemode=br&version=current
//   Header x-api-key: <Schlüssel> (kostenlos auf api-fortnite.com)
// Antwort (vereinfacht): {success: true, data: [{id, displayName, rarity, itemType, category,
//   ammoType, inCurrentLootPool, images}]} – jede Seltenheit einer Waffe ist ein eigener Eintrag.
// Das Format ist nicht offiziell festgeschrieben – deshalb wird hier vorsichtig gelesen.
// (Vorher fortniteapi.io – der Dienst wurde am 31.03.2026 eingestellt.)

export const LOOT_URL = "https://prod.api-fortnite.com/api/v2/weapons?lang=de&gamemode=br&version=current";
export const LOOT_SOURCE = "api-fortnite.com";

export type LootItem = { loot_id: string; name: string; path: string; rarity: string | null };

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic", "exotic"];

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isUrl = (u: string) => /^https:\/\/[^\s"'<>]+$/.test(u);

function rarityOf(v: unknown): string | null {
  const raw = typeof v === "object" && v ? (v as any).id ?? (v as any).name ?? (v as any).value : v;
  const r = text(raw).toLowerCase().replace(/^efortrarity::/, "");
  return RARITIES.includes(r) ? r : null;
}

// Bild: bevorzugt das Icon; images kann ein Text, eine Liste oder ein Objekt sein
function imageOf(item: any): string {
  const images = item?.images;
  const candidates: unknown[] = [];
  if (typeof images === "string") candidates.push(images);
  else if (Array.isArray(images)) candidates.push(...images.map((i) => (typeof i === "string" ? i : i?.url ?? i?.icon)));
  else if (images && typeof images === "object") {
    candidates.push(images.icon, images.smallIcon, images.small_icon, images.large, images.largeIcon, images.featured,
      images.background, images.full_background, ...Object.values(images));
  }
  candidates.push(item?.image, item?.icon, item?.iconUrl);
  for (const c of candidates) {
    const u = text(c);
    if (isUrl(u)) return u;
  }
  return "";
}

// Munition, Baumaterial und Ähnliches gehören nicht aufs Bingo
const SKIP = /ammo|munition|resource|material|trap(?!per)|building/i;

// Aktive Items mit Name und Bild. Der Pfad bekommt die ID als #…, damit er eindeutig ist
// (mehrere Seltenheiten teilen sich oft dasselbe Bild).
export function parseLootpool(data: any): LootItem[] {
  const list = [data?.data, data?.results, data?.weapons, data?.items, data?.loot, data?.data?.weapons, data?.data?.items, data]
    .find(Array.isArray) ?? [];
  // Gibt es das Feld inCurrentLootPool, zählt nur, was gerade im Lootpool ist
  const flagged = list.some((i: any) => typeof i?.inCurrentLootPool === "boolean");
  const seen = new Set<string>();
  const out: LootItem[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || item.enabled === false) continue;
    if (flagged && item.inCurrentLootPool !== true) continue;
    const id = text(item.id);
    const name = text(item.displayName ?? item.display_name ?? item.name).replace(/\s+/g, " ").slice(0, 40).trim();
    const image = imageOf(item);
    if (!id || id.length > 120 || !name || !image || seen.has(id)) continue;
    if (SKIP.test(`${text(item.type)} ${text(item.itemType)} ${text(item.category)}`)) continue;
    seen.add(id);
    out.push({ loot_id: id, name, path: `${image}#${encodeURIComponent(id)}`, rarity: rarityOf(item.rarity) });
  }
  return out;
}

// ------------------------------------------------------------
// Eingebaute Item-Liste: klassische Fortnite-Waffen und Heilung mit eigenen Icons
// (assets/bingo/*.svg). Springt ein, wenn es keinen Schlüssel gibt oder der Lootpool
// nicht zu holen ist – das Bingo hat so immer genug Bilder.
// Der Pfad zeigt auf BUILTIN_URL; Webseite und Overlay machen daraus assets/bingo/…
// (die Spalte path verlangt für Lootpool-Items eine https-Adresse).
// ------------------------------------------------------------
export const BUILTIN_URL = "https://builtin.streamhelp.invalid/bingo/";
export const BUILTIN_PREFIX = "builtin:";

const CATALOG: [icon: string, name: string, rarities: string[]][] = [
  ["ar", "Sturmgewehr", ["uncommon", "rare", "epic", "legendary"]],
  ["shotgun", "Pump-Schrotflinte", ["uncommon", "rare", "epic", "legendary"]],
  ["tactical", "Taktische Schrotflinte", ["common", "uncommon", "rare"]],
  ["smg", "Maschinenpistole", ["common", "uncommon", "rare", "epic"]],
  ["sniper", "Scharfschützengewehr", ["rare", "epic", "legendary"]],
  ["hunting", "Jagdgewehr", ["uncommon", "rare"]],
  ["pistol", "Pistole", ["common", "uncommon", "rare"]],
  ["revolver", "Revolver", ["rare", "epic"]],
  ["rocket", "Raketenwerfer", ["epic", "legendary"]],
  ["grenadelauncher", "Granatwerfer", ["rare", "epic"]],
  ["minigun", "Minigun", ["epic", "legendary"]],
  ["grenade", "Granate", ["common"]],
  ["bandage", "Verband", ["common"]],
  ["medkit", "Medikit", ["uncommon"]],
  ["smallshield", "Kleiner Schildtrank", ["uncommon"]],
  ["shield", "Schildtrank", ["rare"]],
  ["campfire", "Lagerfeuer", ["uncommon"]],
];

export const LOOT_CATALOG: LootItem[] = CATALOG.flatMap(([icon, name, rarities]) =>
  rarities.map((rarity) => ({
    loot_id: `${BUILTIN_PREFIX}${icon}:${rarity}`,
    name,
    path: `${BUILTIN_URL}${icon}.svg#${icon}-${rarity}`,
    rarity,
  })));
