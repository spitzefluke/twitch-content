// Twitch verbinden: Nur wer den Kanal besitzt, darf ihn verbinden (twitch-oauth, starterMayConnect).
// Ohne diese Prüfung konnte ein Fremder den Login starten, dem Streamer den Freigabe-Link unterschieben
// und stand danach als Inhaber des Kanals da (connected_by).
//   deno test --allow-env --allow-net supabase/functions/_shared/oauth_owner_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { starterMayConnect } from "./twitch.ts";

const OWNER = "owner-uuid";
const STRANGER = "stranger-uuid";
const TWITCH_ID = "123456";
const deps = (owners: string[], identities: Record<string, string[]>) => ({
  isChannelOwner: (id: string) => Promise.resolve(owners.includes(id)),
  twitchIdsOf: (id: string) => Promise.resolve(identities[id] ?? []),
});

Deno.test("Kanal mit Inhaber: nur der Inhaber verbindet", async () => {
  const channel = { owner_id: OWNER };
  const d = deps([OWNER], { [STRANGER]: [TWITCH_ID] });
  assertEquals(await starterMayConnect(OWNER, channel, TWITCH_ID, false, d), true);
  // Fremder – auch wenn der Streamer den Link auf Twitch bestätigt hat
  assertEquals(await starterMayConnect(STRANGER, channel, TWITCH_ID, false, d), false);
  // Admin-Häkchen ersetzt beim Kanal mit Inhaber nicht die Inhaber-Prüfung
  assertEquals(await starterMayConnect(STRANGER, channel, TWITCH_ID, true, d), false);
});

Deno.test("Kanal ohne Inhaber: Admin oder genau dieses Twitch-Konto", async () => {
  const d = deps([], { [OWNER]: [TWITCH_ID], [STRANGER]: ["999"] });
  assertEquals(await starterMayConnect(OWNER, { owner_id: null }, TWITCH_ID, false, d), true);
  assertEquals(await starterMayConnect(STRANGER, { owner_id: null }, TWITCH_ID, false, d), false);
  assertEquals(await starterMayConnect(STRANGER, { owner_id: null }, TWITCH_ID, true, d), true);
  assertEquals(await starterMayConnect(STRANGER, null, TWITCH_ID, false, d), false);
});
