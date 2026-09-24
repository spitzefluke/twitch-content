// Fortnite-Bingo: Tipprunde mit Kanalpunkten über eine Twitch-Vorhersage.
// Zuschauer tippen im Twitch-Chat, welche Reihe auf Daves Karte zuerst voll
// wird. Wer richtig liegt, bekommt die Kanalpunkte der anderen dazu – so
// verteilt Twitch die Punkte bei Vorhersagen.
//   POST {action:"start", seconds} → Vorhersage starten (Tippzeit 30 s bis 30 min)
//   POST {action:"check"}          → Ist eine getippte Reihe voll? Dann auflösen.
//                                    Die Webseite ruft das nach jedem Abhaken auf.
//   POST {action:"cancel"}         → Abbrechen, alle bekommen ihre Punkte zurück
// Nur für Admins. Die Runde steht in bingo_card.bet (Migration …_bingo_bet.sql).
import {
  CodedError, corsHeaders, db, getConnection, getUserFromRequest, helix, HelixError, json, sendChat, type Connection,
} from "../_shared/twitch.ts";
import { betLines, fullLines } from "../_shared/bingo.ts";

const TITLE = "Welche Reihe wird beim Bingo zuerst voll?"; // Twitch: höchstens 45 Zeichen
const SCOPE = "channel:manage:predictions";

type Outcome = { id: string; key: string; title: string };
type Bet = {
  id: string;
  status: "active" | "resolved" | "canceled";
  outcomes: Outcome[];
  started_at: string;
  lock_at: string;
  winner?: string;
  winner_title?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405);
  const user = await getUserFromRequest(req);
  if (!user) return json({ error: "Nicht angemeldet" }, 401);
  const { data: profile } = await db.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return json({ error: "Nur Admins dürfen Tipprunden starten." }, 403);

  const { action, seconds } = await req.json().catch(() => ({}));
  try {
    if (action === "start") return json(await start(Number(seconds)));
    if (action === "check") return json(await check());
    if (action === "cancel") return json(await cancel());
    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message, code: (e as CodedError).code }, e instanceof CodedError ? 400 : 500);
  }
});

async function loadCard() {
  const { data, error } = await db.from("bingo_card").select("size, cells, marked, bet").eq("id", 1).maybeSingle();
  if (error) {
    if (/column .*bet/i.test(error.message)) {
      throw new CodedError("migration", "In der Datenbank fehlt die Tipprunde: supabase/migrations/20260926120000_bingo_bet.sql im SQL Editor ausführen.");
    }
    throw error;
  }
  if (!data) throw new CodedError("no_card", "Es gibt noch keine Bingo-Karte.");
  return data as { size: number; cells: unknown[]; marked: number[]; bet: Bet | null };
}

async function connection(): Promise<Connection & { scopes?: string[] }> {
  const conn = await getConnection();
  if (!conn) throw new CodedError("not_connected", "Twitch ist nicht verbunden. Dave muss sich zuerst auf der Webseite mit Twitch verbinden.");
  const scopes = (conn as { scopes?: string[] }).scopes ?? [];
  if (!scopes.includes(SCOPE)) {
    throw new CodedError("need_reconnect", "Für Tipprunden braucht die Seite eine neue Twitch-Berechtigung (Vorhersagen). Dave muss Twitch einmal neu verbinden: Twitch-Knopf oben → „Neu verbinden“.");
  }
  return conn;
}

async function saveBet(bet: Bet) {
  const { error } = await db.from("bingo_card").update({ bet }).eq("id", 1);
  if (error) throw error;
  return bet;
}

// Chat-Nachricht vom Bot – ohne Bot bleibt es still, die Runde läuft trotzdem.
const say = (conn: Connection, text: string) => sendChat(conn, text).catch((e) => console.warn("Chat:", e.message));

async function start(seconds: number) {
  const window = Math.round(Math.min(1800, Math.max(30, Number.isFinite(seconds) ? seconds : 120)));
  const card = await loadCard();
  if (card.bet?.status === "active") throw new CodedError("running", "Es läuft schon eine Tipprunde.");
  if (fullLines(card.size, card.marked ?? []).length) {
    throw new CodedError("already_full", "Auf der Karte ist schon eine Reihe voll. Erst „Haken entfernen“ oder eine neue Karte ziehen.");
  }
  const conn = await connection();
  const lines = betLines(card.size);
  let prediction;
  try {
    prediction = (await helix("predictions", conn.access_token, {
      method: "POST",
      body: {
        broadcaster_id: conn.broadcaster_id,
        title: TITLE,
        outcomes: lines.map((l) => ({ title: l.title })),
        prediction_window: window,
      },
    })).data[0];
  } catch (e) {
    if (e instanceof HelixError) {
      if (e.status === 403) throw new CodedError("not_affiliate", "Vorhersagen gibt es nur für Twitch-Affiliates und Partner.");
      if (e.status === 401) throw new CodedError("need_reconnect", "Twitch lässt die Vorhersage nicht zu. Dave muss Twitch einmal neu verbinden.");
      if (e.status === 400 && /active|already/i.test(e.data?.message ?? "")) {
        throw new CodedError("other_prediction", "In Daves Kanal läuft schon eine andere Vorhersage. Die erst auf Twitch beenden.");
      }
    }
    throw e;
  }
  // Twitch gibt die Antworten in derselben Reihenfolge zurück
  const outcomes = prediction.outcomes.map((o: { id: string; title: string }, i: number) => ({
    id: o.id, key: lines[i].key, title: o.title,
  }));
  const now = Date.now();
  const bet = await saveBet({
    id: prediction.id,
    status: "active",
    outcomes,
    started_at: new Date(now).toISOString(),
    lock_at: new Date(now + window * 1000).toISOString(),
  });
  const mins = window >= 120 ? `${Math.round(window / 60)} Minuten` : `${window} Sekunden`;
  await say(conn, `🎯 Bingo-Tipprunde! Welche Reihe wird zuerst voll? Tippt jetzt mit euren Kanalpunkten – die Vorhersage steht oben im Chat, ihr habt ${mins}. Wer richtig liegt, bekommt Punkte dazu!`);
  return { bet };
}

// Nach jedem Abhaken: Ist eine getippte Reihe voll, gewinnt sie.
async function check() {
  const card = await loadCard();
  const bet = card.bet;
  if (bet?.status !== "active") return { bet };
  const done = new Set(fullLines(card.size, card.marked ?? []).map((l) => l.key));
  // Werden mit einem Haken zwei Reihen voll, zählt die erste in der Liste.
  const winner = bet.outcomes.find((o) => done.has(o.key));
  if (!winner) return { bet };
  const conn = await connection();
  try {
    await helix("predictions", conn.access_token, {
      method: "PATCH",
      body: { broadcaster_id: conn.broadcaster_id, id: bet.id, status: "RESOLVED", winning_outcome_id: winner.id },
    });
  } catch (e) {
    // Vielleicht schon auf Twitch beendet oder abgebrochen – dann deren Stand übernehmen.
    const synced = await syncFromTwitch(conn, bet);
    if (synced) return { bet: synced };
    throw e;
  }
  const resolved = await saveBet({ ...bet, status: "resolved", winner: winner.key, winner_title: winner.title });
  await say(conn, `🎯 BINGO! ${winner.title} ist zuerst voll – wer darauf getippt hat, bekommt die Kanalpunkte. GG!`);
  return { bet: resolved };
}

async function cancel() {
  const card = await loadCard();
  const bet = card.bet;
  if (bet?.status !== "active") return { bet };
  const conn = await connection();
  try {
    await helix("predictions", conn.access_token, {
      method: "PATCH",
      body: { broadcaster_id: conn.broadcaster_id, id: bet.id, status: "CANCELED" },
    });
  } catch (e) {
    const synced = await syncFromTwitch(conn, bet);
    if (synced) return { bet: synced };
    throw e;
  }
  const canceled = await saveBet({ ...bet, status: "canceled" });
  await say(conn, "🎯 Die Bingo-Tipprunde ist abgebrochen – alle bekommen ihre Kanalpunkte zurück.");
  return { bet: canceled };
}

// Stand der Vorhersage auf Twitch übernehmen, falls sie dort schon beendet wurde.
async function syncFromTwitch(conn: Connection, bet: Bet): Promise<Bet | null> {
  const res = await helix("predictions", conn.access_token, {
    query: { broadcaster_id: conn.broadcaster_id, id: bet.id },
  }).catch(() => null);
  const p = res?.data?.[0];
  if (!p || p.status === "ACTIVE" || p.status === "LOCKED") return null;
  if (p.status === "RESOLVED") {
    const w = bet.outcomes.find((o) => o.id === p.winning_outcome_id);
    return saveBet({ ...bet, status: "resolved", winner: w?.key, winner_title: w?.title });
  }
  return saveBet({ ...bet, status: "canceled" });
}
