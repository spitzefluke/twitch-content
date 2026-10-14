// Integration der Plattform-Notfall-Schalter mit Chat-Bot und OBS-Overlay:
//   deno test --allow-env --allow-net supabase/functions/platform_gate_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { thankEvent } from "./_shared/bot.ts";
import { handleChatMessage } from "./_shared/chat.ts";
import { holdOverlayIfPaused } from "../../js/platform-gate.js";

Deno.test("Notfall-Schalter stoppt Bot-Aktionen und pausiert das OBS-Overlay", async () => {
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

  const oldFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const oldSetInterval = Object.getOwnPropertyDescriptor(globalThis, "setInterval");
  let botGateCalls = 0;
  let overlayGateCalls = 0;
  let pollOverlay: (() => Promise<void>) | undefined;
  let replacedWith = "";
  const classes = new Set<string>();
  const notes: { className?: string; textContent?: string }[] = [];

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname.endsWith("/rpc/bot_gate")) {
        botGateCalls++;
        return Response.json({ off: true });
      }
      if (url.pathname.endsWith("/rpc/overlay_gate")) {
        overlayGateCalls++;
        return Response.json({ off: overlayGateCalls === 1, by: "platform", reload_at: null });
      }
      throw new Error(`Unerwartete Anfrage im Regressionstest: ${url.pathname}`);
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: { classList: { add: (name: string) => classes.add(name) } },
      body: { append: (node: { className?: string; textContent?: string }) => notes.push(node) },
      createElement: () => ({ className: "", textContent: "" }),
    },
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {
      href: "https://streamhelp.example/overlay.html?live=1",
      search: "?live=1",
      replace: (url: string) => { replacedWith = url; },
    },
  });
  Object.defineProperty(globalThis, "setInterval", {
    configurable: true,
    writable: true,
    value: (callback: () => Promise<void>) => { pollOverlay = callback; return 1; },
  });

  try {
    await handleChatMessage({
      chatter_user_id: "viewer-1",
      chatter_user_login: "viewer",
      chatter_user_name: "Viewer",
      message: { text: "!füttern" },
    });
    await thankEvent("channel.follow", { user_name: "NeuePerson" }, "event-1");

    assertEquals(botGateCalls, 1, "Der Bot-Schalter wird geprüft und für kurze Zeit zwischengespeichert.");
    assertEquals(overlayGateCalls, 0);

    let overlayContinued = false;
    void holdOverlayIfPaused().then(() => { overlayContinued = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert(classes.has("ov-paused"), "Das Overlay muss beim Plattform-Stopp in den Pausenzustand wechseln.");
    assertEquals(notes.length, 0, "Die Live-Browserquelle bleibt leer; der Pausenhinweis gehört nur in die Vorschau.");
    assertEquals(overlayContinued, false, "Der Overlay-Start darf während der Pause nicht weiterlaufen.");
    assertEquals(overlayGateCalls, 1);
    assert(pollOverlay, "Das pausierte Overlay muss regelmäßig auf Freigabe prüfen.");

    await pollOverlay();
    assertEquals(overlayGateCalls, 2);
    assert(replacedWith.includes("_r="), "Nach Freigabe lädt das Overlay mit frischer Adresse neu.");
  } finally {
    for (const [key, descriptor] of [["fetch", oldFetch], ["document", oldDocument], ["location", oldLocation], ["setInterval", oldSetInterval]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
