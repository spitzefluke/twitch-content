// Die neueren Content-Ideen auf der Webseite: Kacheln, Dialoge, Laden.
// app.js ruft setupExtras() einmal beim Start und loadExtras() nach dem Anmelden.
import { X, buildTile, paintTile } from './extras-core.js';
import { createExtrasApi } from './extras-api.js';
import { forbidden, pause, subathon } from './extras-live.js';
import { queue, quiz } from './extras-play.js';
import { cards, tts } from './extras-fun.js';

export const EXTRAS = [forbidden, subathon, pause, quiz, queue, tts, cards];
export const EXTRA_KINDS = EXTRAS.map((f) => f.kind);
const byKind = Object.fromEntries(EXTRAS.map((f) => [f.kind, f]));

// ctx: Helfer aus app.js (state, toast, germanError, buildActionTile, tileByKind, isLocked, openTile)
export function setupExtras(ctx) {
  X.ctx = ctx;
  for (const f of EXTRAS) f.setup();
}

// Nach dem Anmelden: Daten laden (im Hintergrund, fehlende Migration → Kachel bleibt ruhig)
export async function loadExtras() {
  X.api ??= createExtrasApi(X.ctx.state.api);
  await Promise.all(EXTRAS.map((f) => f.load().catch((err) => console.warn(`${f.kind}:`, err))));
}

export const buildExtraTile = (tile, i) => buildTile(byKind[tile.kind], tile, i);
export const openExtra = (kind) => byKind[kind]?.open();
export const extraIcon = (kind) => byKind[kind]?.icon;
export const paintExtraTiles = () => EXTRAS.forEach((f) => paintTile(f));
