// OBS-Overlay: als Browserquelle in OBS einbinden (Breite 1920, Höhe 1080).
// Wird das Glücksrad gedreht – per Kanalpunkte oder auf der Webseite –,
// erscheint es klein im Bild, dreht sich und zeigt das Ergebnis.
// Daneben läuft "Als Nächstes" mit den kommenden Content-Ideen.
//
// Die Adresse baut der OBS-Dialog im Dashboard. Empfohlen: overlay.html?live=1 – dann kommen alle
// Einstellungen aus der Datenbank (OBS-Dialog), und jede Änderung erscheint sofort in OBS.
// Ohne live=1 gelten die Optionen in der Adresse, z. B. overlay.html?wheel=br&wsize=120
// Alles ist erst einmal aus – nur was in der Adresse steht, ist zu sehen (das Laufband ist immer da).
//   wheel=br|bl|bc|tr|tl|tc    Glücksrad an dieser Stelle (br = unten rechts, bc/tc = Mitte); fehlt es, ist es aus;
//                              oder frei: wheel=62.5,70 (linke obere Ecke in Prozent des Bildes) –
//                              so speichert es der OBS-Dialog, wenn man die Karte in der Vorschau verschiebt
//   next=bl|…                  "Als Nächstes" an dieser Stelle; fehlt es, ist es aus
//   wsize=100 / nsize=100      Größe der Karten in Prozent (50 – 200); scale=1.2 gilt für beide
//   hold=9                     Sekunden, die das Ergebnis stehen bleibt (3 – 60)
//   from=all|twitch|web        welche Drehungen: alle, nur Kanalpunkte, nur Webseite
//   always=1                   Glücksrad dauerhaft zeigen, nicht nur beim Drehen
//   vcolor=0                   Glücksrad-Karte in der Akzentfarbe statt in der Farbe der Variante
//   wlabel=… / nlabel=…        Überschriften der Karten
//   rotate=12                  Sekunden bis zur nächsten Content-Idee (5 – 120)
//   margin=40                  Abstand zum Bildrand in Pixeln (0 – 300)
//   bg=94                      Deckkraft des Kartenhintergrunds in Prozent (0 – 100)
//   accent=ffb81c              Akzentfarbe (Hex)
//   vol=100                    Lautstärke in Prozent, 0 = ohne Ton (sound=0 geht auch)
//   alook=classic|neon|…      Grund-Design der Alerts (Bibliothek: ALERT_LOOKS in js/alerts.js); alles Weitere
//                              (Bild/Video, Texte, Animationen, Varianten) kommt aus dem Alert-Designer (alert_config)
//   apreview=1                 nur die Vorschau im Alert-Designer: zeigt allein den Alert, gesteuert per postMessage
//   vwheel=100, vprank=100 …   Lautstärke je Ebene in Prozent (0–200, mal vol), siehe MIX
//   bingo=tr|…                 Bingo-Karte an dieser Stelle; fehlt es, ist sie aus
//   bsize=100                  Größe der Bingo-Karte in Prozent (50 – 200)
//   bstyle=classic|neon|paper  Design der Bingo-Karte: bunt (Standard), Neon oder Papier
//   prank=1                    „Ärgere den Streamer“ an (Würfe und Sounds)
//   cam=35,25,30,40            Kamera des Streamers im Bild: links,oben,Breite,Höhe in Prozent – dort landen die Würfe
//   psize=100                  Größe der Wurfgeschosse in Prozent (50 – 200)
//   quest=tc|…                 Karte „Unangenehme Frage“ an dieser Stelle; fehlt es, ist sie aus
//   qsize=100                  Größe der Fragen-Karte in Prozent (50 – 200)
//   pet=1                      der Stream-Dino an (läuft unten durchs Bild)
//   dsize=100                  Größe des Dinos in Prozent (50 – 200)
//   pground=edge               Dino läuft am Bildrand statt oben auf dem Laufband
//   pclimb=0                   Dino klettert bei Heißhunger nicht an Karten hoch
//   pscreen=0                  Dino frisst bei Heißhunger keine Löcher in den Bildschirm
//   shop=tl|…                  Kisten-Shop-Karte an dieser Stelle; fehlt es, ist sie aus
//   ssize=100                  Größe der Kisten-Shop-Karte in Prozent (50 – 200)
//   challenge=tl|…             Win-Challenge-Karte an dieser Stelle; fehlt es, ist sie aus
//   csize=100                  Größe der Win-Challenge-Karte in Prozent (50 – 200)
//   alerts=tr|…                Alerts (neue Follower, Abos …) an dieser Stelle – nur sichtbar, wenn einer kommt; fehlt es, sind sie aus
//   asize=100                  Größe der Alerts in Prozent (50 – 200)
//   recent=tl|…                Karte „Letzter Follower / Letztes Abo“ an dieser Stelle; fehlt es, ist sie aus
//   rsize=100                  Größe dieser Karte in Prozent (50 – 200)
//   sfollow=… / ssub=… / sresub=… / sgift=… / sbits=…
//                              Sound je Alert-Art: none, ein Soundboard-Sound (gong, whistle …),
//                              a:<pfad> (eigener Alert-Sound) oder c:<pfad> (Sound aus „Ärgere den Streamer“)
//   chat=tl|… oder 76,22       Twitch-Chat an dieser Stelle; fehlt es, ist er aus
//   chsize=100                 Größe des Chats in Prozent (50 – 200)
//   chmax=8                    so viele Nachrichten stehen höchstens da (3 – 50)
//   chh=60                     feste Höhe des Chats in Prozent der Bildhöhe (20 – 95), dann gilt chmax nicht;
//                              fehlt es, wächst er mit den Nachrichten
//   chfade=0                   Sekunden, bis eine Nachricht verschwindet (0 = bleibt, bis neue sie verdrängen)
//   chcmd=1                    Befehle (!füttern, !change …) auch zeigen – sonst ausgeblendet
//   chbots=1                   Bots (StreamElements, Nightbot …) auch zeigen – sonst ausgeblendet
//   chstyle=card|bubble|clean  Stil des Chats: Karte (Standard), Sprechblasen, Schlicht (nur Text mit Schatten)
//   yt=@kanal                  YouTube-Livechat dazu (über die Edge Function youtube-chat), Nachrichten mit Logo
//   chtw=0                     Twitch-Chat weglassen (z. B. nur YouTube)
//   chplat=0                   kein Twitch-/YouTube-Logo vor den Namen
//   chstat=0                   keine Verbindungsanzeige (Twitch verbunden, YouTube live / wartet auf Stream)
//   ticker=bc|…                Position des Laufbands (Standard bc = unten Mitte) – immer an, lässt sich nicht ausschalten
//   tstyle=bar|neon|board      Design des Laufbands: Laufband (Standard), Neon, LED-Anzeige
//   tsize=100                  Größe des Laufbands in Prozent (50 – 200)
//   tspeed=70                  Tempo in Pixeln pro Sekunde (20 – 300)
//   forbid, subathon, pause, quiz, queue, tts, cards (+ fwsize, sasize, qzsize, qusize, ttsize, cdsize)
//                              die neueren Content-Ideen – siehe js/overlay-extras.js
//   otheme, scene, camframe, labels, goal (+ sctitle, scsub, sctime, cfstyle, cflabel, lbitems, lbsize,
//   gtype, gtarget, gtitle, gsince, gsize)
//                              Overlay-Design, Szenen-Bildschirme, Kamera-Rahmen, Info-Leiste, Ziel-Balken – siehe js/overlay-stage.js
//   test=1                     Probe-Drehungen und -Würfe, zum Einrichten in OBS
//   edit=1                     nur für die Vorschau im OBS-Dialog: alle Karten stehen still und
//                              lassen sich mit der Maus verschieben, dazu der Kamera-Rahmen
import { CONFIG } from './config.js';
import { DEFAULT_TILES, DEFAULT_VARIANTS, bonusWheel } from './defaults.js';
import { Wheel } from './wheel.js';
import { Sfx, prankText, setPrankIcon, throwItem } from './prank-fx.js';
import { bingoState, lootImageUrl, renderBingoGrid } from './bingo.js';
import { paintQuestionCard } from './questions.js';
import { DEFAULT_PET, Dino, runDino } from './pet.js';
import { ScreenHoles } from './screen-holes.js';
import { DEFAULT_CHALLENGE, KINDS, challengeBurst, currentStage, heartsHtml, pipsHtml, stageDone } from './challenge.js';
import { TICKER_STYLES, fillTicker, setTickerChannel } from './ticker.js';
import { CHAT_BOTS, PLATFORMS, connectTwitchChat, renderMessage, sampleMessage } from './twitch-chat.js';
import { socialBadge } from './social-icons.js';
import { connectYouTubeChat, youtubeChannel } from './youtube-chat.js';
import {
  ALERT_KINDS, alertLines, alertLook, alertVars, builtinMediaUrl, fillTemplate, normalizeAlertConfig, playAlertSound,
  resolveDesign, sampleAlert, splitLetters,
} from './alerts.js';
import { GOLD, pointsText, renderLoadout, renderTug, scoreOf, versusLive, winnersOf } from './shop.js';
import { setupOverlayExtras } from './overlay-extras.js';
import { setupOverlayStage } from './overlay-stage.js';
import { startHack } from './overlay-hack.js';
import { startAnniversary } from './overlay-anniversary.js';

const POSITIONS = ['br', 'bl', 'bc', 'tr', 'tl', 'tc'];
const TEST_EVERY_MS = 20000;
const TILES_REFRESH_MS = 15000;
const CONFIG_POLL_MS = 3000; // Live-Einstellungen aus dem OBS-Fenster
const STALE_MS = 2 * 60 * 1000; // ältere Drehungen (z. B. nach Pause) nicht mehr zeigen

// live=1: Einstellungen aus der Datenbank (overlay_config). test/edit aus der Adresse gelten weiter.
const urlParams = new URLSearchParams(location.search);
const LIVE = urlParams.get('live') === '1';
let liveConfig = '';
if (LIVE) liveConfig = await readOverlayConfig().catch((err) => { console.warn('Overlay: Live-Einstellungen nicht lesbar', err); return ''; });
const params = LIVE ? new URLSearchParams(liveConfig) : urlParams;
// scene: eigene OBS-Quelle je Szene (overlay.html?live=1&scene=start), sonst gilt die Szene aus den Einstellungen
if (LIVE) for (const key of ['test', 'edit', 'scene']) if (urlParams.has(key)) params.set(key, urlParams.get(key));
// Chatting-Szene (scene=chat): große Kamera links, Chat rechts – Spiel-Ebenen bleiben weg
if (params.get('scene') === 'chat') {
  for (const key of ['wheel', 'next', 'bingo', 'quest', 'shop', 'challenge', 'recent', 'forbid', 'subathon', 'quiz', 'queue', 'cards', 'goal']) params.delete(key);
  params.set('camframe', '1');
  params.set('cam', '3,7,62,76');
  params.set('chat', 'tr');
  if (!params.has('chsize')) params.set('chsize', '115');
}

// Der Streamer: Name und Login des verbundenen Twitch-Kanals (streamer_info, ohne Anmeldung).
// Fehlt die Migration …_streamer_mods.sql oder läuft die Demo: CHANNEL aus js/config.js.
const STREAMER = await readStreamer().catch(() => null) ?? { name: CONFIG.CHANNEL || 'Streamer', login: CONFIG.CHANNEL };
setTickerChannel(STREAMER.login);
async function readStreamer() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return null;
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/streamer_info`, {
    method: 'POST',
    headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const info = await res.json();
  return info?.connected ? { name: info.name || info.login, login: info.login } : null;
}

async function readOverlayConfig() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    try { return JSON.parse(localStorage.getItem('zd_overlay_config'))?.params ?? ''; } catch { return ''; }
  }
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/overlay_config?id=eq.1&select=params`, {
    headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`overlay_config: ${res.status}`);
  const [row] = await res.json();
  return row?.params ?? '';
}
const FREE = /^\d{1,3}(\.\d+)?,\d{1,3}(\.\d+)?$/;
const position = (value, fallback) => (value === '0' || value === 'off' ? null
  : POSITIONS.includes(value) || FREE.test(value ?? '') ? value : fallback);
const flag = (name, fallback) => (params.has(name) ? !['0', 'false', 'off'].includes(params.get(name)) : fallback);
const number = (name, fallback, min, max) => {
  const raw = params.get(name);
  const n = raw === null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (name, fallback, max = 40) => (params.get(name) ?? '').trim().slice(0, max) || fallback;
const legacyScale = number('scale', 1, 0.5, 2) * 100;
const accent = (params.get('accent') ?? '').replace(/^#/, '');
const opt = {
  wheel: position(params.get('wheel'), null),
  next: position(params.get('next'), null),
  wsize: number('wsize', legacyScale, 50, 200) / 100,
  nsize: number('nsize', legacyScale, 50, 200) / 100,
  holdMs: number('hold', 9, 3, 60) * 1000,
  from: ['twitch', 'web'].includes(params.get('from')) ? params.get('from') : 'all',
  always: flag('always', false),
  variantColor: flag('vcolor', true),
  wlabel: text('wlabel', 'Glücksrad'),
  nlabel: text('nlabel', 'Als Nächstes'),
  rotateMs: number('rotate', 12, 5, 120) * 1000,
  margin: number('margin', 40, 0, 300),
  bg: number('bg', 94, 0, 100) / 100,
  accent: /^[0-9a-f]{6}$/i.test(accent) ? `#${accent}` : null,
  volume: params.get('sound') === '0' ? 0 : number('vol', 100, 0, 100) / 100,
  // Eigener Regler je Ebene mit Ton (Parameter aus MIX), mal Gesamtlautstärke
  vols: {},
  bingo: position(params.get('bingo'), null),
  bsize: number('bsize', 100, 50, 200) / 100,
  bstyle: ['neon', 'paper'].includes(params.get('bstyle')) ? params.get('bstyle') : 'classic',
  prank: flag('prank', false),
  cam: camera(params.get('cam')),
  camframe: flag('camframe', false),
  psize: number('psize', 100, 50, 200) / 100,
  quest: position(params.get('quest'), null),
  qsize: number('qsize', 100, 50, 200) / 100,
  pet: flag('pet', false),
  dsize: number('dsize', 100, 50, 200) / 100,
  pground: params.get('pground') === 'edge' ? 'edge' : 'ticker',
  pclimb: flag('pclimb', true),
  pscreen: flag('pscreen', true),
  shop: position(params.get('shop'), null),
  ssize: number('ssize', 100, 50, 200) / 100,
  challenge: position(params.get('challenge'), null),
  csize: number('csize', 100, 50, 200) / 100,
  alerts: params.get('apreview') === '1' ? 'tc' : position(params.get('alerts'), null),
  asize: number('asize', 100, 50, 200) / 100,
  recent: position(params.get('recent'), null),
  rsize: number('rsize', 100, 50, 200) / 100,
  asound: Object.fromEntries(ALERT_KINDS.map((k) => [k.kind, (params.get(k.param) ?? '').slice(0, 300) || 'default'])),
  chat: position(params.get('chat'), null),
  chsize: number('chsize', 100, 50, 200) / 100,
  chmax: number('chmax', 8, 3, 50),
  chh: number('chh', 0, 0, 95),
  chfadeMs: number('chfade', 0, 0, 600) * 1000,
  chcmd: flag('chcmd', false),
  chbots: flag('chbots', false),
  chstyle: ['bubble', 'clean'].includes(params.get('chstyle')) ? params.get('chstyle') : 'card',
  yt: youtubeChannel(params.get('yt')),
  chtw: flag('chtw', true),
  chplat: flag('chplat', true),
  chstat: flag('chstat', true),
  // Das Laufband ist immer da: "0" oder Unsinn heißt Standardplatz
  ticker: position(params.get('ticker'), 'bc') ?? 'bc',
  tstyle: TICKER_STYLES.includes(params.get('tstyle')) ? params.get('tstyle') : 'bar',
  tsize: number('tsize', 100, 50, 200) / 100,
  tspeed: number('tspeed', 70, 20, 300),
  test: flag('test', false),
  edit: flag('edit', false),
  apreview: params.get('apreview') === '1',
};
// Lautstärke je Ebene: Parameter → Schlüssel in opt.vols
const MIX = {
  vwheel: 'wheel', vprank: 'prank', valert: 'alerts', vbingo: 'bingo', vquest: 'quest', vpet: 'pet', vshop: 'shop',
  vchal: 'challenge', vforbid: 'forbid', vsub: 'subathon', vpause: 'pause', vquiz: 'quiz', vtts: 'tts', vcards: 'cards',
};
for (const [param, key] of Object.entries(MIX)) opt.vols[key] = opt.volume * number(param, 100, 0, 200) / 100;

// Kamera-Bereich "links,oben,Breite,Höhe" in Prozent des Bildes
function camera(value) {
  const parts = (value ?? '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return { x: 35, y: 25, w: 30, h: 40 };
  const [x, y, w, h] = parts.map((n) => Math.min(100, Math.max(0, n)));
  return { x, y, w: Math.max(2, Math.min(w, 100 - x)), h: Math.max(2, Math.min(h, 100 - y)) };
}

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

const root = document.documentElement.style;
root.setProperty('--ws', opt.wsize);
root.setProperty('--ns', opt.nsize);
root.setProperty('--m', `${opt.margin}px`);
root.setProperty('--bga', opt.bg);
root.setProperty('--ps', opt.psize);
root.setProperty('--bs', opt.bsize);
root.setProperty('--qs', opt.qsize);
root.setProperty('--ts', opt.tsize);
root.setProperty('--ss', opt.ssize);
root.setProperty('--cs', opt.csize);
root.setProperty('--as', opt.asize);
root.setProperty('--rs', opt.rsize);
root.setProperty('--chs', opt.chsize);
root.setProperty('--dsz', `${Math.round(170 * opt.dsize)}px`);
if (opt.accent) root.setProperty('--accent', opt.accent);
$('ov-wlabel').textContent = opt.wlabel;
$('ov-nlabel').textContent = opt.nlabel;
if (opt.wheel) place($('ov-spin'), opt.wheel);
else $('ov-spin').remove();
if (opt.next) place($('ov-next'), opt.next);
else $('ov-next').remove();
if (opt.bingo) {
  place($('ov-bingo'), opt.bingo);
  $('ov-bingo').classList.add(`bingo-style-${opt.bstyle}`);
}
else $('ov-bingo').remove();
if (opt.quest) place($('ov-quest'), opt.quest);
else $('ov-quest').remove();
if (!opt.pet) $('ov-pet').remove();
if (opt.shop) place($('ov-shop'), opt.shop);
else $('ov-shop').remove();
if (opt.challenge) place($('ov-challenge'), opt.challenge);
else $('ov-challenge').remove();
if (opt.alerts) { place($('ov-alert'), opt.alerts); $('ov-alert').dataset.look = alertLook(params.get('alook')); }
else $('ov-alert').remove();
if (opt.recent) place($('ov-recent'), opt.recent);
else $('ov-recent').remove();
if (opt.chat) place($('ov-chat'), opt.chat);
else $('ov-chat').remove();
place($('ov-ticker'), opt.ticker);
$('ov-ticker-label').textContent = `Mehr von ${STREAMER.name}`;
$('ov-ticker').classList.add(`ticker-style-${opt.tstyle}`);
if (opt.edit) setupEdit();

// Ecke (br, tl, …) per CSS-Klasse, freie Position als linke obere Ecke in Prozent.
// Frei platzierte Karten bleiben immer ganz im Bild, auch wenn sie wachsen.
function place(el, pos) {
  if (!FREE.test(pos)) { el.classList.add(`pos-${pos}`); return; }
  const [x, y] = pos.split(',').map(Number);
  el.classList.add('pos-free');
  el.dataset.x = x;
  el.dataset.y = y;
  keepInside(el);
  new ResizeObserver(() => keepInside(el)).observe(el);
  addEventListener('resize', () => keepInside(el));
}

function keepInside(el) {
  if (!el.classList.contains('pos-free')) return;
  const W = innerWidth;
  const H = innerHeight;
  const left = Math.min((Number(el.dataset.x) / 100) * W, Math.max(0, W - el.offsetWidth));
  const top = Math.min((Number(el.dataset.y) / 100) * H, Math.max(0, H - el.offsetHeight));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

let variants = DEFAULT_VARIANTS;
let tiles = [];

start();

async function start() {
  const source = await connect().catch((err) => {
    console.error('Overlay: keine Verbindung zu Supabase', err);
    return demoSource();
  });
  if (opt.apreview) { document.body.classList.add('is-apreview'); setupAlerts(source); return; }
  const loaded = await source.variants().catch(() => null);
  if (loaded?.length) variants = loaded;
  tiles = await source.tiles().catch(() => []);

  if (opt.wheel) setupSpins(source);
  if (opt.next) setupNext(source);
  if (opt.prank) setupPranks(source);
  else $('ov-pranks').remove();
  if (opt.bingo) setupBingo(source);
  if (opt.quest) setupQuestions(source);
  if (opt.pet) setupPet(source);
  if (opt.shop) setupShop(source);
  if (opt.challenge) setupChallenge(source);
  if (opt.alerts || opt.recent) setupAlerts(source);
  setupTicker(source);
  if (opt.chat) setupChat();
  setupOverlayExtras({ params, position, flag, number, place, opt, client: source.client ?? null });
  setupOverlayStage({ params, position, flag, number, text, place, opt, source, streamer: STREAMER, onAlerts: (cb) => onAlerts(source, cb) });
  if (LIVE) watchOverlayConfig(source);
  startWatchtime();
  if (!opt.edit) watchForUpdate();
}

// Neue Version der Seite? OBS behält Dateien sehr lange im Cache – deshalb schaut das
// Overlay alle paar Minuten in overlay.html nach der Versionsnummer von overlay.js
// (tools/stamp-versions.mjs) und lädt sich neu, sobald sie sich geändert hat.
const UPDATE_CHECK_MS = 3 * 60 * 1000;
function watchForUpdate() {
  const mine = new URL(import.meta.url).searchParams.get('v');
  if (!mine) return; // ohne Versionsnummer (lokal) nichts zu vergleichen
  setInterval(async () => {
    try {
      const res = await fetch(`overlay.html?check=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const latest = /\.\/js\/overlay\.js\?v=([0-9a-f]+)/.exec(await res.text())?.[1];
      if (latest && latest !== mine) location.reload();
    } catch { /* offline: später noch mal */ }
  }, UPDATE_CHECK_MS);
}

// Live: Ändert jemand im OBS-Dialog etwas, lädt sich das Overlay sofort neu.
// Realtime meldet es direkt; zur Sicherheit wird zusätzlich alle 30 Sekunden nachgesehen.
// Watchtime für den Chat-Bot (!watchtime): Das Overlay läuft genau während des Streams und
// stößt deshalb alle 5 Minuten die Zählung an. Die Edge Function prüft selbst, ob der Stream
// live ist, und zählt höchstens alle 4,5 Minuten – mehrere OBS-Quellen stören also nicht.
const WATCH_TICK_MS = 5 * 60_000;
function startWatchtime() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY || opt.edit || opt.test) return;
  const tick = () => fetch(`${CONFIG.SUPABASE_URL}/functions/v1/stream-tools`, {
    method: 'POST',
    headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'watch_tick' }),
  }).catch(() => {});
  setTimeout(tick, 60_000);
  setInterval(tick, WATCH_TICK_MS);
}

function watchOverlayConfig(source) {
  const changed = (next) => {
    if (typeof next === 'string' && next !== liveConfig) location.reload();
  };
  source.onOverlayConfig?.(changed);
  // Realtime kommt sofort; fällt es in OBS mal aus, fängt die kurze Abfrage alles nach Sekunden auf
  const poll = () => readOverlayConfig().then(changed).catch(() => {});
  setInterval(poll, CONFIG_POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}

// ============================================================
// Datenquelle
// ============================================================
// Live liest das Overlay ohne Anmeldung (anon) – freigegeben sind nur
// Kacheln, Varianten und der Feed overlay_spins (Migration …_overlay.sql).
const SHOP_RUN_COLS = 'id, player, lobby_id, stream, chest, coins, spent, items, status, shop_until, score, created_at, updated_at';
async function connect() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return demoSource();
  const { createClient } = await import('./supabase-js.js');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows = async (query) => { const { data, error } = await query; if (error) throw error; return data; };
  return {
    client: sb,
    variants: () => rows(sb.from('wheel_variants').select('*').order('position')),
    tiles: () => rows(sb.from('tiles').select('*').order('position')),
    onSpin(cb) {
      sb.channel('overlay-feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'overlay_spins' }, (p) => cb(p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal fehlgeschlagen'); });
    },
    onPrank(cb) {
      sb.channel('overlay-pranks')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pranks' }, (p) => cb(p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal für Würfe fehlgeschlagen'); });
    },
    soundUrl: (path) => `${CONFIG.SUPABASE_URL}/storage/v1/object/public/sounds/${path.split('/').map(encodeURIComponent).join('/')}`,
    alertSoundUrl: (path) => `${CONFIG.SUPABASE_URL}/storage/v1/object/public/alert-sounds/${encodeURIComponent(path)}`,
    bingoCard: async () => (await rows(sb.from('bingo_card').select('*').eq('id', 1).maybeSingle())) ?? null,
    bingoItems: () => rows(sb.from('bingo_items').select('*')),
    onBingo(cb) {
      sb.channel('overlay-bingo')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bingo_card' }, (p) => cb(p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal fürs Bingo fehlgeschlagen'); });
    },
    // Lootpool-Bilder sind schon eine volle Adresse, eigene liegen im Storage
    bingoUrl: (path) => (path.startsWith('https://') ? lootImageUrl(path)
      : `${CONFIG.SUPABASE_URL}/storage/v1/object/public/bingo/${path.split('/').map(encodeURIComponent).join('/')}`),
    questionStage: async () => (await rows(sb.from('question_stage').select('*').eq('id', 1).maybeSingle())) ?? null,
    onQuestionStage(cb) {
      sb.channel('overlay-question')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'question_stage' }, (p) => cb(p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal für Fragen fehlgeschlagen'); });
    },
    pet: async () => {
      const row = await rows(sb.from('pet').select('*').eq('id', 1).maybeSingle());
      if (!row) throw new Error('Kein Dino in der Datenbank');
      return row;
    },
    onPet(cb) {
      sb.channel('overlay-pet')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pet' }, (p) => cb(p.new))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pet_events' }, (p) => cb(null, p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal für den Dino fehlgeschlagen'); });
    },
    // Ohne user_id: die Konto-ID bekommt OBS nicht zu sehen (…_security_hardening.sql)
    shopStreamRun: async () => (await rows(sb.from('shop_runs').select(SHOP_RUN_COLS).eq('stream', true).order('created_at', { ascending: false }).limit(1).maybeSingle())) ?? null,
    shopLobbyRuns: (lobbyId) => rows(sb.from('shop_runs').select(SHOP_RUN_COLS).eq('lobby_id', lobbyId)),
    onShopRuns(cb) {
      sb.channel('overlay-shop')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_runs' }, (p) => cb(p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal für den Kisten-Shop fehlgeschlagen'); });
    },
    async shopImages() {
      return rows(sb.from('bingo_items').select('name, path')).then((list) => list.map((i) => ({ name: i.name, url: this.bingoUrl(i.path) })));
    },
    challenge: () => rows(sb.from('win_challenge').select('*').eq('id', 1).maybeSingle()),
    alerts: () => rows(sb.from('stream_alerts').select('*').order('created_at', { ascending: false }).limit(20)),
    // Alert-Designer (…_overlay_designs.sql): fehlt die Tabelle, gelten die Standards
    alertConfig: async () => (await rows(sb.from('alert_config').select('config').eq('id', 1).maybeSingle()))?.config ?? null,
    onAlertConfig(cb) {
      sb.channel('overlay-alert-config')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'alert_config' }, (p) => cb(p.new.config))
        .subscribe();
    },
    alertMediaUrl: (path) => `${CONFIG.SUPABASE_URL}/storage/v1/object/public/alert-media/${encodeURIComponent(path)}`,
    onAlert(cb) {
      sb.channel('overlay-alerts')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stream_alerts' }, (p) => cb(p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal für Alerts fehlgeschlagen'); });
    },
    onChallenge(cb) {
      sb.channel('overlay-challenge')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'win_challenge' }, (p) => cb(p.new))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal für die Win-Challenge fehlgeschlagen'); });
    },
    onOverlayConfig(cb) {
      sb.channel('overlay-config')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'overlay_config' }, (p) => cb(p.new.params))
        .subscribe();
    },
    ticker: async () => (await rows(sb.from('ticker').select('items').eq('id', 1).maybeSingle()))?.items ?? null,
    onTicker(cb) {
      sb.channel('overlay-ticker')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ticker' }, (p) => cb(p.new.items))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error('Overlay: Realtime-Kanal fürs Laufband fehlgeschlagen'); });
    },
    // An wem darf der Dino knabbern? Wer zuletzt gefüttert, geworfen oder gedreht hat.
    async recentNames() {
      const since = new Date(Date.now() - 86400000).toISOString();
      const names = (q, key) => rows(q).then((r) => r.map((x) => x[key])).catch(() => []);
      const lists = await Promise.all([
        names(sb.from('pet_events').select('who').gte('created_at', since).limit(60), 'who'),
        names(sb.from('pranks').select('requested_by').gte('created_at', since).limit(60), 'requested_by'),
        names(sb.from('overlay_spins').select('requested_by').gte('created_at', since).limit(60), 'requested_by'),
      ]);
      return [...new Set(lists.flat().filter(Boolean))];
    },
  };
}

// Demo-Modus: dieselben Daten wie die Demo-Seite. Läuft die Seite im selben
// Browser, kommen neue Drehungen über das storage-Ereignis von localStorage.
function demoSource() {
  const read = (key, fallback) => {
    try { const v = localStorage.getItem(`zd_${key}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  };
  return {
    variants: async () => read('wheel_variants', null) ?? DEFAULT_VARIANTS,
    tiles: async () => read('tiles', DEFAULT_TILES),
    onSpin(cb) {
      const known = new Set(read('spins', []).map((s) => s.id));
      addEventListener('storage', (e) => {
        if (e.key !== 'zd_spins') return;
        for (const spin of read('spins', []).reverse()) {
          if (known.has(spin.id)) continue;
          known.add(spin.id);
          cb(spin);
        }
      });
    },
    onPrank(cb) {
      const known = new Set(read('pranks', []).map((p) => p.id));
      addEventListener('storage', (e) => {
        if (e.key !== 'zd_pranks') return;
        for (const prank of read('pranks', []).reverse()) {
          if (known.has(prank.id)) continue;
          known.add(prank.id);
          cb(prank);
        }
      });
    },
    soundUrl: (path) => read('sounds', []).find((x) => x.path === path)?.url ?? '',
    alertSoundUrl: (path) => read('alert_sounds', []).find((x) => x.path === path)?.url ?? '',
    bingoCard: async () => read('bingo_card', null),
    bingoItems: async () => read('bingo_items', []),
    onBingo(cb) {
      addEventListener('storage', (e) => { if (e.key === 'zd_bingo_card') cb(read('bingo_card', null)); });
    },
    bingoUrl: (path) => (path.startsWith('https://') ? lootImageUrl(path) : read('bingo_items', []).find((i) => i.path === path)?.url ?? ''),
    questionStage: async () => read('question_stage', null),
    onQuestionStage(cb) {
      addEventListener('storage', (e) => { if (e.key === 'zd_question_stage') cb(read('question_stage', null)); });
    },
    shopStreamRun: async () => read('shop_runs', []).find((r) => r.stream) ?? null,
    shopLobbyRuns: async (lobbyId) => read('shop_runs', []).filter((r) => r.lobby_id === lobbyId),
    onShopRuns(cb) {
      addEventListener('storage', (e) => { if (e.key === 'zd_shop_runs') cb(null); });
    },
    shopImages: async () => read('bingo_items', []).map((i) => ({ name: i.name, url: i.url })),
    challenge: async () => ({ ...DEFAULT_CHALLENGE, ...read('win_challenge', {}) }),
    alerts: async () => read('stream_alerts', []),
    alertConfig: async () => read('alert_config', null),
    onAlertConfig(cb) {
      addEventListener('storage', (e) => { if (e.key === 'zd_alert_config') cb(read('alert_config', null)); });
    },
    alertMediaUrl: (path) => read('alert_media', []).find((x) => x.path === path)?.url ?? '',
    onAlert(cb) {
      const known = new Set(read('stream_alerts', []).map((a) => a.id));
      addEventListener('storage', (e) => {
        if (e.key !== 'zd_stream_alerts') return;
        for (const a of read('stream_alerts', []).reverse()) {
          if (known.has(a.id)) continue;
          known.add(a.id);
          cb(a);
        }
      });
    },
    onChallenge(cb) {
      addEventListener('storage', (e) => { if (e.key === 'zd_win_challenge') cb({ ...DEFAULT_CHALLENGE, ...read('win_challenge', {}) }); });
    },
    onOverlayConfig(cb) {
      addEventListener('storage', (e) => { if (e.key === 'zd_overlay_config') cb(read('overlay_config', null)?.params ?? ''); });
    },
    ticker: async () => read('ticker', null)?.items ?? null,
    onTicker(cb) {
      addEventListener('storage', (e) => { if (e.key === 'zd_ticker') cb(read('ticker', null)?.items ?? null); });
    },
    pet: async () => ({ ...DEFAULT_PET, last_fed_at: new Date().toISOString(), ...read('pet', {}) }),
    onPet(cb) {
      const known = new Set(read('pet_events', []).map((x) => x.id));
      addEventListener('storage', (e) => {
        if (e.key === 'zd_pet') cb(read('pet', null));
        if (e.key !== 'zd_pet_events') return;
        for (const ev of read('pet_events', []).reverse()) {
          if (known.has(ev.id)) continue;
          known.add(ev.id);
          cb(null, ev);
        }
      });
    },
    async recentNames() {
      const names = [...read('pet_events', []).map((x) => x.who), ...read('pranks', []).map((x) => x.requested_by), ...read('spins', []).map((x) => x.requested_by)];
      return [...new Set(names.filter(Boolean))];
    },
  };
}

// ============================================================
// Glücksrad
// ============================================================
function setupSpins(source) {
  const card = $('ov-spin');
  const pointer = $('ov-pointer');
  const wheel = new Wheel($('ov-canvas'), {
    onTick() {
      pointer.classList.remove('tick');
      void pointer.offsetWidth;
      pointer.classList.add('tick');
      sound.tick();
    },
  });
  wheel.setVariant(variants[0]);

  const queue = [];
  let playing = false;

  const enqueue = (spin) => {
    if (opt.from !== 'all' && spin.source !== opt.from) return;
    queue.push(spin);
    if (!playing) play();
  };

  // Dauerhaft sichtbar: zwischen den Drehungen wartet das Rad mit einem Hinweis.
  function idle() {
    $('ov-who').textContent = opt.from === 'web' ? 'wartet auf die nächste Drehung' : 'Kanalpunkte einlösen zum Drehen';
    $('ov-status').textContent = 'Bereit';
    card.classList.remove('is-done');
    card.classList.add('is-idle');
  }
  if (opt.always) {
    const first = variants[0];
    card.style.setProperty('--c', opt.variantColor ? first.color : 'var(--accent)');
    $('ov-variant').textContent = first.name;
    idle();
    card.classList.add('is-in');
  }

  async function play() {
    playing = true;
    while (queue.length) {
      const spin = queue.shift();
      if (Date.now() - Date.parse(spin.created_at) > STALE_MS) continue;
      await show(spin).catch((err) => console.error('Overlay: Anzeige fehlgeschlagen', err));
    }
    playing = false;
  }

  async function show(spin) {
    // Admins können das Rad auf der Webseite ändern – dann die neuen Varianten holen
    const known = variants.find((v) => v.id === spin.variant_id);
    const bonusOk = spin.bonus_index == null || known?.bonus?.segments?.[spin.bonus_index]?.label === spin.bonus_result;
    if (known?.segments[spin.segment_index]?.label !== spin.result || !bonusOk) {
      const fresh = await source.variants().catch(() => null);
      if (fresh?.length) variants = fresh;
    }
    const variant = variants.find((v) => v.id === spin.variant_id) ?? variants[0];
    const index = Math.min(Math.max(0, spin.segment_index | 0), variant.segments.length - 1);

    card.style.setProperty('--c', opt.variantColor ? variant.color : 'var(--accent)');
    $('ov-who').textContent = spin.source === 'twitch'
      ? `@${spin.requested_by} löst Kanalpunkte ein`
      : `${spin.requested_by} dreht`;
    $('ov-variant').textContent = variant.name;
    $('ov-status').textContent = 'Das Rad dreht sich …';
    $('ov-result').textContent = spin.result;
    // Lange Wörter (z. B. „Scharfschützengewehr“) kleiner statt mitten im Wort umbrechen
    $('ov-result').classList.toggle('is-long', Math.max(...spin.result.split(/\s+/).map((w) => w.length)) > 11);
    $('ov-detail').textContent = [spin.detail, spin.bonus_detail].filter(Boolean).join(' ');
    const bonus = spin.bonus_index != null ? bonusWheel(variant) : null;
    const bonusEl = $('ov-bonus');
    bonusEl.hidden = !spin.bonus_result;
    bonusEl.textContent = spin.bonus_result ? `${spin.bonus_name ?? bonus?.name ?? 'Bonus'}: ${spin.bonus_result}` : '';
    bonusEl.style.setProperty('--b', bonus?.segments[spin.bonus_index]?.color ?? 'var(--c)');
    card.classList.remove('is-done', 'is-idle');
    wheel.setVariant(variant);

    const entering = !card.classList.contains('is-in');
    card.classList.add('is-in');
    sound.whoosh();
    if (entering) await wait(600);
    wheel.resize();
    wheel.start();
    await wait(900);
    await wheel.spinTo(index);

    // Zweites Rad (z. B. Seltenheit beim Waffen-Lotto) direkt hinterher
    if (bonus) {
      sound.ding();
      $('ov-status').textContent = `${spin.result} ✓ – jetzt: ${bonus.name}`;
      await wait(1300);
      const canvas = $('ov-canvas');
      canvas.classList.add('is-swap');
      sound.whoosh();
      await wait(260);
      wheel.setVariant(bonus);
      canvas.classList.remove('is-swap');
      wheel.start();
      await wait(700);
      await wheel.spinTo(spin.bonus_index);
    }

    card.classList.add('is-done');
    sound.ding();
    await wait(opt.holdMs);
    if (opt.always) { idle(); return; }
    card.classList.remove('is-in');
    await wait(700);
  }

  // Beim Einrichten steht das Rad still mit einem Beispiel-Ergebnis da.
  if (opt.edit) {
    const v = variants[0];
    card.style.setProperty('--c', opt.variantColor ? v.color : 'var(--accent)');
    $('ov-who').textContent = '@Beispiel löst Kanalpunkte ein';
    $('ov-variant').textContent = v.name;
    $('ov-result').textContent = v.segments[0].label;
    $('ov-result').classList.toggle('is-long', Math.max(...v.segments[0].label.split(/\s+/).map((w) => w.length)) > 11);
    $('ov-detail').textContent = v.segments[0].detail;
    card.classList.add('is-in', 'is-done');
    requestAnimationFrame(() => wheel.resize());
    return;
  }

  source.onSpin(enqueue);

  if (opt.test) {
    const fake = () => {
      if (playing) return;
      const v = variants[Math.floor(Math.random() * variants.length)];
      const i = Math.floor(Math.random() * v.segments.length);
      const names = ['NightOwl_Mia', 'PixelPaul', 'GG_Gina', 'LootLukas', 'CrispyCarl'];
      enqueue({
        id: `test-${Date.now()}`, created_at: new Date().toISOString(), source: opt.from === 'web' ? 'web' : 'twitch',
        variant_id: v.id, variant_name: v.name, segment_index: i,
        result: v.segments[i].label, detail: v.segments[i].detail,
        ...(v.bonus?.segments?.length ? (() => {
          const b = Math.floor(Math.random() * v.bonus.segments.length);
          return { bonus_name: v.bonus.name, bonus_index: b, bonus_result: v.bonus.segments[b].label, bonus_detail: v.bonus.segments[b].detail };
        })() : {}),
        requested_by: names[Math.floor(Math.random() * names.length)],
      });
    };
    setTimeout(fake, 1500);
    setInterval(fake, TEST_EVERY_MS);
  }
}

// ============================================================
// Als Nächstes
// ============================================================
function setupNext(source) {
  const card = $('ov-next');
  const body = $('ov-next-body');
  const units = [...$('ov-countdown').querySelectorAll('b')];
  let index = 0;
  let current = null;

  const upcoming = () => tiles
    .filter((t) => t.kind === 'countdown' && t.target_at && Date.parse(t.target_at) > Date.now())
    .sort((a, b) => Date.parse(a.target_at) - Date.parse(b.target_at));

  function pick() {
    const list = upcoming();
    if (!list.length && opt.edit) {
      // Zum Einrichten auch ohne geplanten Termin zeigen, wo die Karte sitzt
      current = { title: 'Hier steht die nächste Idee', target_at: new Date(Date.now() + 3 * 86400e3 + 4 * 3600e3).toISOString() };
    } else if (!list.length) { current = null; card.hidden = true; return; } else current = null;
    current ??= list[index % list.length];
    card.hidden = false;
    $('ov-next-title').textContent = current.title;
    const d = new Date(current.target_at);
    $('ov-next-date').textContent = `${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} · ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    tick();
  }

  function tick() {
    if (!current) return;
    let s = Math.max(0, Math.floor((Date.parse(current.target_at) - Date.now()) / 1000));
    if (s === 0) { pick(); return; }
    const values = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
    units.forEach((u, i) => { const t = pad(values[i]); if (u.textContent !== t) u.textContent = t; });
  }

  async function rotate() {
    if (upcoming().length < 2) return;
    body.classList.add('is-switching');
    await wait(350);
    index++;
    pick();
    body.classList.remove('is-switching');
  }

  pick();
  setInterval(tick, 1000);
  setInterval(rotate, opt.rotateMs);
  setInterval(async () => {
    tiles = await source.tiles().catch(() => tiles);
    pick();
  }, TILES_REFRESH_MS);
  addEventListener('storage', (e) => { if (e.key === 'zd_tiles') source.tiles().then((t) => { tiles = t; pick(); }); });
}

// ============================================================
// Ärgere den Streamer
// ============================================================
// Würfe fliegen sofort (auch mehrere gleichzeitig), Sounds laufen nacheinander.
function setupPranks(source) {
  const layer = $('ov-pranks');
  const feed = $('ov-prank-feed');
  const sfx = new Sfx({ volume: opt.vols.prank });
  const box = () => ({
    x: (opt.cam.x / 100) * layer.clientWidth,
    y: (opt.cam.y / 100) * layer.clientHeight,
    w: (opt.cam.w / 100) * layer.clientWidth,
    h: (opt.cam.h / 100) * layer.clientHeight,
  });

  // Die Meldungen stehen über der Kamera – oder darunter, wenn oben kein Platz ist.
  const place = () => {
    const b = box();
    const above = b.y > 90;
    feed.style.left = `${b.x + b.w / 2}px`;
    feed.style.top = above ? '' : `${b.y + b.h + 12}px`;
    feed.style.bottom = above ? `${layer.clientHeight - b.y + 12}px` : '';
    feed.classList.toggle('is-below', !above);
  };
  place();
  addEventListener('resize', place);

  const say = (p) => {
    const el = document.createElement('p');
    el.className = 'ov-prank-msg';
    el.innerHTML = '<span aria-hidden="true"></span><b></b>';
    setPrankIcon(el.firstChild, p);
    el.lastChild.textContent = prankText(p);
    feed.append(el);
    while (feed.children.length > 4) feed.firstChild.remove();
    setTimeout(() => el.remove(), 4200);
  };

  const sounds = [];
  let playing = false;
  async function playSounds() {
    playing = true;
    while (sounds.length) {
      const p = sounds.shift();
      say(p);
      if (p.item === 'custom') await sfx.playUrl(source.soundUrl(p.sound_path));
      else { sfx.play(p.item); await wait(1800); }
      await wait(250);
    }
    playing = false;
  }

  // Overlay-Hack (nur Mods): ganzes Bild, !firewall im Chat oder „Firewall“ im Dialog beendet ihn
  let hack = null;
  const runHack = (p) => {
    if (p.item === 'firewall') { hack?.firewall(p.requested_by); return; }
    if (hack || Date.now() - Date.parse(p.created_at) > 60_000) return;
    say(p);
    hack = startHack({ cam: opt.cam, sfx, channel: STREAMER.login, who: p.requested_by, onEnd: () => { hack = null; } });
  };

  // Kanal-Jubiläum (nur Mods): zweiminütiger Film über das ganze Bild mit den Daten des Kanals
  let show = null;
  const runShow = (p) => {
    if (p.item === 'stop') { show?.stop(); return; }
    if (show || !p.data || Date.now() - Date.parse(p.created_at) > 60_000) return;
    show = startAnniversary({ data: p.data, accent: opt.accent, sfx, onEnd: () => { show = null; } });
  };

  function handle(p) {
    if (p.kind === 'hack') { runHack(p); return; }
    if (p.kind === 'show') { runShow(p); return; }
    if (Date.now() - Date.parse(p.created_at) > STALE_MS) return;
    place(); // der Kamera-Rahmen kann sich beim Einrichten verschoben haben
    if (p.kind === 'throw') {
      const b = box();
      // Ziel: Gesichtshöhe, also eher die obere Mitte des Kamerabilds
      say(p);
      throwItem(layer, {
        item: p.item,
        x: b.x + b.w * (0.5 + (Math.random() - 0.5) * 0.35),
        y: b.y + b.h * (0.42 + (Math.random() - 0.5) * 0.3),
        size: Math.max(60, Math.min(b.w, b.h) * 0.42) * opt.psize,
        sfx,
      });
    } else if (sounds.length < 6) {
      sounds.push(p);
      if (!playing) playSounds();
    }
  }

  source.onPrank(handle);

  if (opt.test) {
    const items = ['tomato', 'banana', 'pie', 'egg', 'duck', 'flowers', 'snowball', 'sock', 'fish', 'undies', 'nuke', 'flashbang'];
    const names = ['NightOwl_Mia', 'PixelPaul', 'GG_Gina', 'LootLukas', 'CrispyCarl'];
    let n = 0;
    const fake = () => {
      const who = names[Math.floor(Math.random() * names.length)];
      const now = new Date().toISOString();
      handle(n++ % 4 === 3
        ? { id: `test-${n}`, created_at: now, kind: 'sound', item: 'rimshot', requested_by: who }
        : { id: `test-${n}`, created_at: now, kind: 'throw', item: items[Math.floor(Math.random() * items.length)], requested_by: who });
    };
    setTimeout(fake, 4000);
    setInterval(fake, 7000);
  }
}

// ============================================================
// Fortnite-Bingo
// ============================================================
// Zeigt die aktuelle Karte; neue Haken bekommen einen Stempel, eine volle
// Linie ein großes "Bingo!". Ausgeblendete oder fehlende Karte = nichts zu sehen.
async function setupBingo(source) {
  const card$ = $('ov-bingo');
  const grid = $('ov-bingo-grid');
  const win = $('ov-bingo-win');
  const sfx = new Sfx({ volume: opt.vols.bingo });
  const urlFor = (path) => (path.startsWith('data:') ? path : source.bingoUrl(path));
  let card = await source.bingoCard().catch((err) => { console.warn('Overlay: Bingo nicht verfügbar', err); return null; });
  if (!card && opt.test) card = testCard();
  // Aktuelle Bilder – ein Admin kann Seltenheit und Zahl nachträglich ändern
  let items = new Map();
  const loadItems = async () => {
    const list = await source.bingoItems().catch(() => []);
    items = new Map(list.map((i) => [i.id, i]));
  };
  await loadItems();
  const itemOf = (cell) => items.get(cell.id);

  function show(next, stamped = null) {
    card = next;
    const visible = !!card?.cells?.length && (card.visible !== false || opt.edit);
    card$.hidden = !visible;
    if (!visible) return;
    card$.style.setProperty('--n', card.size);
    const bet = card.bet;
    const labels = bet?.status === 'active' || bet?.status === 'resolved';
    card$.classList.toggle('has-bet', labels);
    renderBingoGrid(grid, card, { urlFor, stamped, itemOf, labels });
    paintBet(bet);
    const st = bingoState(card);
    $('ov-bingo-progress').textContent = `${st.done}/${st.total}${st.count ? ` · ${st.count}× Bingo` : ''}`;
  }

  // Tipprunde: Aufruf mit Countdown, danach wer gewonnen hat
  const betEl = $('ov-bingo-bet');
  let betTimer = null;
  function paintBet(bet) {
    clearInterval(betTimer);
    const tick = () => {
      const left = bet?.status === 'active' ? Date.parse(bet.lock_at) - Date.now() : 0;
      if (bet?.status === 'active' && left > 0) {
        const s = Math.ceil(left / 1000);
        betEl.innerHTML = `🎯 Tippt mit Kanalpunkten: Welche Reihe wird zuerst voll? <b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b>`;
      } else if (bet?.status === 'active') {
        betEl.textContent = '🎯 Tipps sind zu – welche Reihe wird zuerst voll?';
        clearInterval(betTimer);
      } else if (bet?.status === 'resolved') {
        betEl.textContent = `🎯 ${bet.winner_title ?? 'Eine Reihe'} gewinnt – Kanalpunkte verteilt!`;
      }
    };
    const shown = bet?.status === 'active' || bet?.status === 'resolved';
    betEl.hidden = !shown;
    betEl.classList.toggle('is-won', bet?.status === 'resolved');
    if (!shown) return;
    tick();
    if (bet.status === 'active') betTimer = setInterval(tick, 1000);
  }

  async function update(next) {
    const same = card && next && card.created_at === next.created_at;
    if (!same) await loadItems(); // neue Karte: vielleicht neue Bilder
    const before = same ? bingoState(card).count : 0;
    const known = new Set(same ? card.marked : []);
    const stamped = same ? (next.marked ?? []).find((i) => !known.has(i)) ?? null : null;
    show(next, stamped);
    if (stamped !== null) sfx.hit('thud');
    if (same && bingoState(next).count > before) {
      win.classList.remove('is-on');
      void win.offsetWidth;
      win.classList.add('is-on');
      sfx.play('applause');
      sfx.play('gong');
    }
  }

  show(card);
  source.onBingo(update);

  // Probe: alle 9 Sekunden ein zufälliges Feld abhaken (nur hier, nicht gespeichert)
  if (opt.test) {
    setInterval(() => {
      if (!card) return;
      const open = card.cells.map((c, i) => i).filter((i) => !card.cells[i].free && !card.marked.includes(i));
      const marked = open.length ? [...card.marked, open[Math.floor(Math.random() * open.length)]] : card.cells.flatMap((c, i) => (c.free ? [i] : []));
      update({ ...card, marked });
    }, 9000);
  }
}

// ============================================================
// Unangenehme Fragen
// ============================================================
// Die Karte erscheint, sobald ein Admin eine Frage zeigt: erst die Frage (Gong),
// dann das Ergebnis – beantwortet (Applaus) oder Bestrafung (Buzzer).
async function setupQuestions(source) {
  const card = $('ov-quest');
  const sfx = new Sfx({ volume: opt.vols.quest });
  let last = null;
  const show = (stage, { sound = true } = {}) => {
    const state = stage?.state ?? 'hidden';
    const visible = state !== 'hidden' && !!stage?.text;
    card.hidden = !visible;
    if (!visible) { last = stage; return; }
    const isNew = !last || last.question_id !== stage.question_id || last.state === 'hidden';
    const changed = !last || last.state !== state || isNew;
    paintQuestionCard(card, stage);
    if (isNew) {
      card.classList.remove('is-new');
      void card.offsetWidth;
      card.classList.add('is-new');
    }
    if (sound && changed) {
      if (state === 'ask') sfx.play('gong');
      else if (state === 'punished') { sfx.play('buzzer'); sfx.hit('thud'); }
      else if (state === 'answered') sfx.play('applause');
    }
    last = stage;
  };

  let stage = await source.questionStage().catch((err) => { console.warn('Overlay: Fragen nicht verfügbar', err); return null; });
  if (opt.test || opt.edit) {
    const samples = [
      { question_id: 't1', text: 'Was war dein peinlichster Moment im Stream?', author: 'NightOwl_Mia' },
      { question_id: 't2', text: 'Wie oft hast du schon einen Stream verschlafen?', author: 'Anonym' },
    ];
    let n = 0;
    const next = () => {
      const q = samples[n % samples.length];
      const step = Math.floor(n / samples.length) % 2 ? 'answered' : 'punished';
      show({ ...q, state: 'ask' });
      if (!opt.edit) setTimeout(() => show({ ...q, state: step, punishment: '10 Liegestütze – jetzt sofort' }), 6000);
      n++;
    };
    if (!stage || stage.state === 'hidden' || opt.edit) next();
    else show(stage, { sound: false });
    if (opt.test) setInterval(next, 14000);
  } else {
    show(stage, { sound: false });
  }
  source.onQuestionStage((next) => { if (next) show(next); });
}

// ============================================================
// Stream-Dino
// ============================================================
async function setupPet(source) {
  const layer = $('ov-pet');
  let pet;
  try {
    pet = await source.pet();
  } catch (err) {
    console.warn('Overlay: kein Dino (Migration …_questions_pet.sql fehlt?)', err);
    layer.remove();
    return;
  }
  const sfx = new Sfx({ volume: opt.vols.pet * 0.8 });
  // Steht das Laufband unten, läuft der Dino oben darauf statt davor (außer pground=edge)
  const ground = () => {
    const band = $('ov-ticker')?.getBoundingClientRect();
    const onBottom = opt.pground !== 'edge' && band && band.top > innerHeight * 0.6;
    layer.style.bottom = onBottom ? `${Math.round(innerHeight - band.top + 4)}px` : '';
  };
  ground();
  addEventListener('resize', ground);
  new ResizeObserver(ground).observe($('ov-ticker'));
  const dino = new Dino(layer, { size: Math.round(170 * opt.dsize), sfx, name: pet.name, costume: pet.costume });
  if (opt.test) {
    // Probe: Sprüche und Knabbern im Schnelldurchlauf
    pet = { ...pet, last_fed_at: new Date(Date.now() - 86400000).toISOString() };
  }
  // Heißhunger: an diesen Karten darf er hochklettern – nur, was gerade zu sehen ist.
  // „Als Nächstes“ zuerst: die frisst er am liebsten (von rechts).
  const cards = () => [...document.querySelectorAll('.ov-card')].sort((a, b) => (b.id === 'ov-next') - (a.id === 'ov-next')).filter((el) => {
    if (el.id === 'ov-ticker' || el.hidden) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.visibility !== 'hidden' && Number(cs.opacity) > 0.5 && r.width > 80 && r.height > 60;
  });
  runDino(dino, {
    streamer: () => STREAMER.name,
    getPet: () => pet,
    cards: opt.pclimb && !opt.edit ? cards : null,
    // In der Vorschau des OBS-Fensters (edit) frisst er den Bildschirm nur, wenn dort
    // „Heißhunger auslösen“ gedrückt wird – sonst wäre die Vorschau (test=1) ständig angefressen
    screen: opt.pscreen ? new ScreenHoles(document.body) : null,
    screenOnFrenzy: opt.edit,
    names: async () => {
      const list = await source.recentNames().catch(() => []);
      return list.length ? list : opt.test ? ['NightOwl_Mia', 'PixelPaul', 'LootLukas'] : [];
    },
    idleEvery: opt.test ? [8, 14] : [45, 90],
    nibbleEvery: opt.test ? [16, 24] : [40, 75],
    trickEvery: opt.test ? [5, 9] : [18, 40],
    climbEvery: opt.test ? [20, 30] : [50, 90],
  });
  source.onPet((row, ev) => {
    if (row) {
      pet = row;
      dino.setName(row.name);
      if (row.costume) dino.setCostume(row.costume);
    }
    if (!ev || Date.now() - Date.parse(ev.created_at) > STALE_MS) return;
    if (ev.kind === 'costume') {
      // !change im Chat (oder ein Admin auf der Webseite): Chat-Zeile, dann das neue Kostüm
      dino.chatLine(ev.who, ev.text);
      dino.setCostume(ev.text);
      return;
    }
    if (ev.kind === 'feed') {
      pet = { ...pet, last_fed_at: ev.created_at, last_fed_by: ev.who };
      dino.eat(ev.who);
    } else if (ev.kind === 'pet') {
      dino.cuddle(ev.who);
    } else if (ev.kind === 'say') {
      dino.say(ev.text, 5500);
    }
  });
}

// ============================================================
// Kisten-Shop: die Runde des Streamers im Stream
// ============================================================
// Zu sehen, solange der Streamer mit „Im Stream zeigen“ spielt; nach dem Ende noch 10 Minuten.
const SHOP_SHOW_AFTER_MS = 10 * 60 * 1000;

async function setupShop(source) {
  const card = $('ov-shop');
  const sfx = new Sfx({ volume: opt.vols.shop });
  const images = new Map((await source.shopImages?.().catch(() => []) ?? []).map((i) => [i.name.toLowerCase(), i.url]));
  let run = null;
  let board = [];
  let timer = 0;

  const show = (next, { sound = true } = {}) => {
    const prev = run;
    run = next;
    const visible = !!run && (run.status !== 'done' || Date.now() - Date.parse(run.updated_at ?? run.created_at) < SHOP_SHOW_AFTER_MS || opt.edit);
    card.hidden = !visible;
    clearInterval(timer);
    if (!visible) return;
    const found = run.items.filter((i) => i.found).length;
    const all = run.items.length > 0 && found === run.items.length;
    card.classList.toggle('is-allfound', all);
    const buying = ['opened', 'shopping'].includes(run.status);
    // Koop: der Streamer wartet, bis alle eingekauft haben – dann läuft das Duell
    const duel = !!run.lobby_id && versusLive(board);
    const waitDuel = !!run.lobby_id && run.status === 'playing' && !duel;
    $('ov-shop-coins').innerHTML = buying
      ? `${run.coins - run.spent} ${GOLD}`
      : `${run.items.length} Item${run.items.length === 1 ? '' : 's'}`;
    $('ov-shop-score').textContent = buying || waitDuel ? '' : pointsText(scoreOf(run.items));
    const status = $('ov-shop-status');
    const paintStatus = () => {
      if (run.status === 'shopping') {
        const s = Math.max(0, Math.ceil((Date.parse(run.shop_until) - Date.now()) / 1000));
        status.textContent = `${run.player} kauft ein · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      } else if (run.status === 'opened') {
        status.textContent = `${run.player} · Kiste offen, die anderen wählen noch`;
      } else if (waitDuel) {
        status.textContent = `${run.player} · wartet aufs Duell`;
      } else if (duel && board.every((r) => r.status === 'done')) {
        const wins = winnersOf(board);
        status.textContent = wins.length === 1 ? `🏆 ${wins[0].player} gewinnt!` : `Unentschieden: ${wins.map((w) => w.player).join(' & ')}`;
      } else {
        status.textContent = run.status === 'done' ? `${run.player} · Runde vorbei` : `${run.player} · ${found}/${run.items.length} gefunden`;
      }
    };
    paintStatus();
    if (run.status === 'shopping') timer = setInterval(paintStatus, 500);
    const list = $('ov-shop-list');
    renderLoadout(list, run, { imageFor: (name) => images.get(name.toLowerCase()) ?? null });
    // Neu gekaufte Items springen hinein
    const before = prev?.id === run.id ? prev.items.length : 0;
    [...list.children].forEach((li, i) => { if (i >= before && prev?.id === run.id) li.classList.add('is-new'); });
    if (!sound || !prev) return;
    if (prev.id !== run.id) sfx.hit('bling');
    else if (run.items.length > prev.items.length) sfx.hit('bling');
    else if (found > prev.items.filter((i) => i.found).length) {
      if (all) { sfx.play('applause'); sfx.play('gong'); } else sfx.hit('bling');
    }
  };

  const paintBoard = (sound = true) => {
    const el = $('ov-shop-board');
    const tug = $('ov-shop-tug');
    const duel = !!run?.lobby_id && versusLive(board);
    const over = duel && board.every((r) => r.status === 'done');
    tug.hidden = !duel;
    card.classList.toggle('is-end', over);
    if (duel) {
      renderTug(tug, board, { winners: over ? winnersOf(board) : null });
      if (over && card.dataset.won !== String(run.lobby_id)) { card.dataset.won = run.lobby_id; if (sound) sfx.play('applause'); }
    }
    el.hidden = duel || !run?.lobby_id || board.length < 2;
    if (el.hidden) return;
    const sorted = [...board].sort((a, b) => b.score - a.score).slice(0, 5);
    el.replaceChildren(...sorted.map((r) => {
      const li = document.createElement('li');
      if (r.id === run.id) li.className = 'is-me';
      const who = document.createElement('span');
      who.textContent = r.player;
      const pts = document.createElement('b');
      pts.textContent = r.score;
      li.append(who, pts);
      return li;
    }));
  };

  const refresh = async (sound = true) => {
    const next = await source.shopStreamRun().catch(() => null);
    const wasDuel = !!run?.lobby_id && versusLive(board);
    if (next?.lobby_id) board = await source.shopLobbyRuns(next.lobby_id).catch(() => []);
    else board = [];
    show(next, { sound });
    paintBoard(sound);
    if (sound && !wasDuel && next?.lobby_id && versusLive(board)) sfx.hit('boom');
  };

  if (opt.test || opt.edit) {
    // Probe zum Einrichten
    const demo = {
      id: 'test', player: STREAMER.name, status: 'playing', coins: 165, spent: 110, lobby_id: null, updated_at: new Date().toISOString(),
      shop_until: new Date().toISOString(),
      items: [
        { name: 'SCAR', rarity: 'epic', price: 55, found: true },
        { name: 'Pump', rarity: 'uncommon', price: 20, found: false },
        { name: 'Schildtrank', rarity: 'rare', price: 35, found: true },
      ],
    };
    show(demo, { sound: false });
    if (opt.test) {
      let n = 0;
      setInterval(() => {
        const items = demo.items.map((it, i) => ({ ...it, found: i <= n % 3 }));
        show({ ...demo, items, updated_at: new Date().toISOString() });
        n++;
      }, 7000);
    }
    return;
  }
  await refresh(false);
  source.onShopRuns((row) => {
    if (row && !row.stream && row.id !== run?.id && row.lobby_id !== run?.lobby_id) return;
    refresh();
  });
}

// ============================================================
// Win-Challenge: Stufen, Siege und Leben
// ============================================================
// Zu sehen, sobald die Challenge läuft; nach dem Ende noch 10 Minuten.
const CHALLENGE_SHOW_AFTER_MS = 10 * 60 * 1000;

async function setupChallenge(source) {
  const card = $('ov-challenge');
  const fx = $('ov-ch-fx');
  const sfx = new Sfx({ volume: opt.vols.challenge });
  let ch = null;
  let hideTimer = 0;

  const paint = (next, { effects = true } = {}) => {
    const before = ch;
    ch = next;
    if (!ch) { card.hidden = true; return; }
    const over = ch.status === 'won' || ch.status === 'failed';
    const recent = !over || Date.now() - Date.parse(ch.finished_at ?? ch.updated_at ?? 0) < CHALLENGE_SHOW_AFTER_MS;
    card.hidden = !(opt.edit || opt.test || (ch.status !== 'ready' && recent));
    clearTimeout(hideTimer);
    if (over && !opt.edit && !opt.test) hideTimer = setTimeout(() => { card.hidden = true; }, CHALLENGE_SHOW_AFTER_MS);
    card.classList.toggle('is-won', ch.status === 'won');
    card.classList.toggle('is-failed', ch.status === 'failed');
    const stage = currentStage(ch);
    $('ov-ch-title').textContent = ch.title;
    $('ov-ch-step').textContent = ch.status === 'won' ? '🏆 geschafft!' : ch.status === 'failed' ? '💀 gescheitert'
      : `Stufe ${Math.min(ch.current + 1, ch.stages.length)}/${ch.stages.length}`;
    $('ov-ch-icon').textContent = ch.status === 'won' ? '🏆' : KINDS[stage.kind].icon;
    $('ov-ch-name').textContent = ch.status === 'won' ? 'Alle Stufen geschafft!' : stage.title;
    $('ov-ch-vs').textContent = ch.status === 'won' ? '' : stage.kind === 'fight' && stage.opponent ? `vs ${stage.opponent}` : KINDS[stage.kind].name;
    $('ov-ch-pips').innerHTML = ch.status === 'won' ? '' : pipsHtml(stage);
    $('ov-ch-hearts').innerHTML = heartsHtml(ch);
    $('ov-ch-track').replaceChildren(...ch.stages.map((s, i) => {
      const seg = document.createElement('span');
      if (stageDone(s)) seg.className = 'is-done';
      else if (i === ch.current && !over) seg.className = 'is-active';
      return seg;
    }));
    // Neues Ereignis: Effekt zeigen
    const ev = ch.last_event;
    if (!effects || !before || !ev?.n || ev.n === before.last_event?.n || card.hidden) return;
    if (before.lives && ch.lives_left < before.lives_left) $('ov-ch-hearts').children[ch.lives_left]?.classList.add('is-breaking');
    if (ev.type === 'win' || ev.type === 'loss') {
      const pip = $('ov-ch-pips').querySelectorAll('.ch-pip.is-on')[stage.wins - 1];
      if (ev.type === 'win') pip?.classList.add('is-pop');
      card.classList.remove('is-flash-win', 'is-flash-loss');
      void card.offsetWidth;
      card.classList.add(ev.type === 'win' ? 'is-flash-win' : 'is-flash-loss');
      challengeBurst(card, ev, ch, { sfx });
    } else if (['stage', 'won', 'failed'].includes(ev.type)) {
      challengeBurst(fx, ev, ch, { sfx });
    }
  };

  if (opt.test || opt.edit) {
    // Probe zum Einrichten: Sieg, Niederlage, Stufe geschafft im Wechsel
    let demo = { ...DEFAULT_CHALLENGE, status: 'running', current: 1, lives_left: 2, stages: DEFAULT_CHALLENGE.stages.map((s, i) => ({ ...s, wins: i === 0 ? s.target : i === 1 ? 1 : 0 })) };
    paint(demo, { effects: false });
    if (opt.test) {
      let n = 0;
      setInterval(() => {
        const stages = demo.stages.map((s) => ({ ...s }));
        const type = ['win', 'loss', 'win'][n % 3];
        if (type === 'win') stages[1].wins = Math.min(stages[1].target, stages[1].wins + 1);
        demo = { ...demo, stages, lives_left: type === 'loss' ? Math.max(1, demo.lives_left - 1) : demo.lives_left, last_event: { n: ++n, type, stage: 1 } };
        if (stages[1].wins >= stages[1].target) demo = { ...demo, stages: stages.map((s, i) => (i === 1 ? { ...s, wins: 1 } : s)) };
        paint(demo);
      }, 6000);
    }
    return;
  }
  paint(await source.challenge().catch((err) => { console.warn('Overlay: Win-Challenge nicht verfügbar', err); return null; }), { effects: false });
  source.onChallenge((next) => paint(next));
}

// ============================================================
// Alerts: neue Follower, Abos, Resubs, verschenkte Abos
// ============================================================
// Zwei Karten: Alerts (nur wenn einer kommt) und „Zuletzt“ mit dem letzten
// Follower und dem letzten Abo (ohne Probe-Alerts). Beide sind einzeln an/aus.
const VIDEO_MAX_MS = 30000;
const LETTER_ANIMS = ['wave', 'type'];

async function setupAlerts(source) {
  const card = $('ov-alert');
  const fx = $('ov-al-fx');
  const sfx = new Sfx({ volume: opt.vols.alerts });
  const baseLook = alertLook(params.get('alook'));
  const queue = [];
  const seen = new Set();
  let playing = false;
  // Designs aus dem Alert-Designer; ändern sie sich, gilt das ab dem nächsten Alert
  let designs = normalizeAlertConfig(await source.alertConfig?.().catch(() => null));
  source.onAlertConfig?.((cfg) => { designs = normalizeAlertConfig(cfg); if (card?.classList.contains('is-still')) showSample(); });

  const setLast = (a) => {
    if (a.test || !$('ov-recent')) return;
    const el = a.kind === 'follow' ? $('ov-al-follow') : a.kind === 'bits' ? $('ov-al-bits') : $('ov-al-sub');
    el.textContent = a.kind === 'gift' && a.amount > 1 ? `${a.user_name} (${a.amount}×)`
      : a.kind === 'bits' ? `${a.user_name} (${Number(a.amount).toLocaleString('de-DE')})` : a.user_name;
    const row = el.parentElement;
    row.classList.remove('is-new');
    void row.offsetWidth;
    row.classList.add('is-new');
  };
  const mediaUrl = (m) => (m.startsWith('b:') ? builtinMediaUrl(m.slice(2)) : m.startsWith('u:') ? source.alertMediaUrl?.(m.slice(2)) ?? '' : '');
  // Karte füllen; liefert das Design und ggf. das Video (für die Dauer)
  const fill = (a) => {
    const d = resolveDesign(designs, a);
    const lines = alertLines(a, d);
    const vars = alertVars(a);
    Object.assign(card.dataset, { kind: a.kind, look: d.look || baseLook, layout: d.layout, anim: d.anim, enter: d.enter });
    if (d.color) card.style.setProperty('--c', d.color);
    else card.style.removeProperty('--c');
    card.style.setProperty('--ams', d.msize / 100);
    const box = $('ov-al-media');
    const src = d.media && d.media !== 'none' ? mediaUrl(d.media) : '';
    let video = null;
    if (src && /\.(webm|mp4)$/i.test(d.media)) {
      video = document.createElement('video');
      Object.assign(video, { src, playsInline: true, loop: false, preload: 'auto' });
      video.muted = !d.vsound || !opt.vols.alerts;
      video.volume = Math.min(1, opt.vols.alerts || 0);
      box.replaceChildren(video);
    } else if (src) {
      const img = new Image();
      img.alt = '';
      img.src = src;
      box.replaceChildren(img);
    } else box.replaceChildren();
    card.classList.toggle('has-media', !!src);
    card.classList.toggle('no-icon', !!src || d.media === 'none');
    $('ov-al-icon').textContent = lines.icon;
    fillTemplate($('ov-al-title'), lines.label, vars);
    fillTemplate($('ov-al-name'), lines.title, vars);
    fillTemplate($('ov-al-sub-text'), lines.text, vars);
    $('ov-al-sub-text').hidden = !$('ov-al-sub-text').textContent.trim();
    const letters = LETTER_ANIMS.includes(d.anim) ? splitLetters($('ov-al-name')) : 0;
    card.style.setProperty('--letters', letters);
    return { d, video };
  };
  // Video bis zum Ende (höchstens 30 Sekunden); ohne Ton-Erlaubnis stumm
  const playVideo = (video) => new Promise((resolve) => {
    const done = () => resolve();
    video.addEventListener('ended', done, { once: true });
    video.addEventListener('error', done, { once: true });
    setTimeout(done, VIDEO_MAX_MS);
    video.play().catch(() => { video.muted = true; video.play().catch(done); });
  });

  async function play() {
    playing = true;
    while (queue.length) {
      const a = queue.shift();
      if (!card || Date.now() - Date.parse(a.created_at) > STALE_MS) { setLast(a); continue; }
      card.classList.remove('is-still');
      const { d, video } = fill(a);
      card.classList.remove('is-alert');
      void card.offsetWidth;
      card.classList.add('is-alert');
      if (d.confetti) burst(fx, a.kind);
      const choice = d.sound || opt.asound[a.kind];
      const sound = playAlertSound(sfx, a.kind, choice,
        (c) => (c.startsWith('a:') ? source.alertSoundUrl : source.soundUrl)(c.slice(2)));
      // Stehen bleiben, bis Zeit, Sound (bis 20 Sekunden) und Video durch sind
      await Promise.all([wait(d.duration * 1000), sound, video ? playVideo(video) : null]);
      card.classList.remove('is-alert');
      setLast(a);
      await wait(700);
    }
    playing = false;
    if (opt.edit || opt.apreview) showSample();
  }
  // Vorschau: ein stehender Alert zeigt Platz, Größe und Design
  let sample = sampleAlert('sub');
  function showSample() {
    if (!card || playing) return;
    fill(sample);
    card.classList.add('is-alert', 'is-still');
  }
  const enqueue = (a) => {
    if (!a || seen.has(a.id)) return;
    seen.add(a.id);
    queue.push(a);
    if (!playing) play();
  };

  // Alert-Designer: die Seite schickt das Design, das gerade bearbeitet wird. Hier gibt es
  // keine Warteschlange – jede Änderung zeigt sofort den neuen Stand, „Abspielen“ startet neu.
  if (opt.apreview) {
    let timer = 0;
    let running = false;
    addEventListener('message', (e) => {
      if (e.origin !== location.origin) return;
      const m = e.data;
      if (m?.type !== 'sh-alert-preview') return;
      if (m.config) designs = normalizeAlertConfig(m.config);
      if (m.kind) {
        sample = { ...sampleAlert(m.kind), ...(m.amount ? { amount: m.amount | 0, months: m.amount | 0 } : {}) };
      }
      if (!m.play) {
        if (running) fill(sample); // läuft gerade: Inhalt tauschen, Animation weiterlaufen lassen
        else showSample();
        return;
      }
      clearTimeout(timer);
      running = true;
      const { d, video } = fill(sample);
      card.classList.remove('is-alert', 'is-still');
      void card.offsetWidth;
      card.classList.add('is-alert');
      if (d.confetti) burst(fx, sample.kind);
      video?.play().catch(() => {});
      timer = setTimeout(() => {
        card.classList.remove('is-alert');
        timer = setTimeout(() => { running = false; showSample(); }, 700);
      }, d.duration * 1000);
    });
    showSample();
    parent.postMessage({ type: 'sh-alert-preview-ready' }, location.origin);
    return;
  }

  // Letzte echte Namen für die Karte „Zuletzt“
  const recent = await source.alerts().catch((err) => { console.warn('Overlay: Alerts nicht verfügbar', err); return []; });
  for (const a of [...(recent ?? [])].reverse()) { seen.add(a.id); setLast(a); }
  $('ov-recent')?.querySelectorAll('.is-new').forEach((r) => r.classList.remove('is-new'));

  if (opt.edit) showSample();
  onAlerts(source, enqueue);

  if (opt.test && !opt.edit && card) {
    let n = 0;
    const kinds = ALERT_KINDS.map((k) => k.kind);
    const fake = () => { if (!playing) enqueue(sampleAlert(kinds[n % kinds.length], n++)); };
    setTimeout(fake, 2000);
    setInterval(fake, 15000);
  }
}

// Ein Realtime-Kanal für neue Alerts, den sich Alerts, Info-Leiste, Ziel-Balken und Szenen teilen
let alertListeners = null;
function onAlerts(source, cb) {
  if (!alertListeners) {
    alertListeners = [];
    source.onAlert?.((a) => alertListeners.forEach((f) => f(a)));
  }
  alertListeners.push(cb);
}

// Konfetti und Sterne aus der Karte heraus
function burst(host, kind) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = kind === 'follow' ? ['#b186ff', '#9146ff', '#ffffff'] : ['#ffd36b', '#ffb81c', '#ff7ac8', '#3ddc84', '#35c7ff'];
  const count = kind === 'follow' ? 18 : 34;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const angle = Math.random() * Math.PI * 2;
    const dist = 4 + Math.random() * 9;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}em`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist * 0.6 - 2}em`);
    p.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.15}s`;
    if (i % 3 === 0) p.classList.add('is-round');
    host.append(p);
    setTimeout(() => p.remove(), 1800);
  }
}

// ============================================================
// Laufband: andere Seiten und Socials, immer an
// ============================================================
// ============================================================
// Twitch-Chat
// ============================================================
function setupChat() {
  const card = $('ov-chat');
  const list = $('ov-chat-list');
  card.classList.add(`chat-style-${opt.chstyle}`);
  // Feste Höhe: neue Nachrichten unten, alte rutschen oben aus dem Bild – dann
  // entscheidet die Höhe, wie viele Nachrichten zu sehen sind (chmax gilt nicht)
  const max = opt.chh >= 20 ? 50 : opt.chmax;
  if (opt.chh >= 20) {
    card.classList.add('has-height');
    card.style.height = `calc(${opt.chh}vh - 2 * var(--m))`;
  }
  // Mit Verbindungsanzeige bleibt die Karte auch ohne Nachrichten sichtbar
  const empty = () => card.classList.toggle('is-empty', !list.childElementCount && !opt.edit && !opt.chstat);
  // Vor jedem Namen das Logo der Plattform: Twitch oder YouTube
  const showPlatform = opt.chplat;
  // Verbindungsanzeige: je Plattform ein Schild mit Logo und Zustand
  const STATUS_TEXT = {
    twitch: { connecting: 'verbindet …', verbunden: 'verbunden', getrennt: 'getrennt – neuer Versuch' },
    youtube: { connecting: 'verbindet …', live: 'live', offline: 'wartet auf Stream', error: 'keine Verbindung' },
  };
  const STATUS_STATE = { connecting: 'wait', verbunden: 'ok', live: 'ok', offline: 'idle', getrennt: 'bad', error: 'bad' };
  const statusBox = $('ov-chat-status');
  const pills = {};
  const setStatus = (platform, state) => {
    if (!opt.chstat) return;
    let pill = pills[platform];
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'chat-pill';
      const logo = socialBadge(PLATFORMS[platform], document);
      logo.classList.add('chat-platform');
      const dot = document.createElement('i');
      const label = document.createElement('span');
      pill.append(logo, dot, label);
      statusBox.append(pill);
      statusBox.hidden = false;
      pills[platform] = pill;
    }
    pill.dataset.state = STATUS_STATE[state] ?? 'wait';
    pill.lastChild.textContent = STATUS_TEXT[platform][state] ?? state;
  };
  const add = (msg) => {
    const text = msg.text.trim();
    if (!opt.chcmd && text.startsWith('!')) return;
    if (!opt.chbots && CHAT_BOTS.includes(msg.login)) return;
    const row = renderMessage(msg, { showPlatform });
    list.append(row);
    while (list.childElementCount > max) list.firstElementChild.remove();
    // Bei fester Höhe: was oben nicht mehr ganz hineinpasst, fällt weg
    if (card.classList.contains('has-height')) {
      while (list.childElementCount > 1 && list.scrollHeight > list.clientHeight + 1) list.firstElementChild.remove();
    }
    if (opt.chfadeMs && !opt.edit) {
      setTimeout(() => {
        row.classList.add('is-out');
        setTimeout(() => { row.remove(); empty(); }, 600);
      }, opt.chfadeMs);
    }
    empty();
  };
  empty();
  const handlers = {
    message: add,
    status: (s) => setStatus('twitch', s),
    remove: (id) => { list.querySelector(`[data-id="${CSS.escape(id ?? '')}"]`)?.remove(); empty(); },
    // login = null: ganzer Chat geleert – aber nur die Nachrichten dieser Plattform
    clear: (login, platform = 'twitch') => {
      for (const row of [...list.children]) {
        if (login ? row.dataset.user === login : row.dataset.platform === platform) row.remove();
      }
      empty();
    },
  };
  const twitchLogin = STREAMER.login || CONFIG.CHANNEL;
  if (opt.chtw && twitchLogin) { setStatus('twitch', 'connecting'); connectTwitchChat(twitchLogin, handlers); }
  if (opt.yt) connectYouTubeChat(opt.yt, { ...handlers, status: (s) => setStatus('youtube', s) });
  // Vorschau: so sieht die Anzeige aus, wenn alles läuft
  if (opt.edit || opt.test) {
    if (opt.chtw) setStatus('twitch', 'verbunden');
    if (opt.yt) setStatus('youtube', 'live');
  }
  // Vorschau und Probe: ein paar Beispiel-Nachrichten, damit man Platz und Größe sieht
  if (opt.test || opt.edit) {
    const sample = (n) => sampleMessage(n, { youtube: !!opt.yt });
    let n = 0;
    // Mit fester Höhe mehr Probe-Nachrichten, damit man sieht, wie voll es wird
    for (; n < Math.min(opt.chh >= 20 ? 30 : 4, max); n++) add(sample(n));
    if (!opt.edit) setInterval(() => add(sample(n++)), 4000);
  }
}

async function setupTicker(source) {
  const track = $('ov-ticker-track');
  // Fehlt die Tabelle noch, läuft das Band mit den Standardtexten
  let items = await source.ticker().catch((err) => { console.warn('Overlay: Laufband-Texte nicht verfügbar', err); return null; });
  let timer = 0;
  const draw = () => fillTicker(track, items, { speed: opt.tspeed * opt.tsize });
  draw();
  document.fonts?.ready.then(draw);
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(draw, 200); });
  // Wird es in der Vorschau breiter/schmaler geschoben, neu messen
  new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(draw, 200); }).observe($('ov-ticker'));
  source.onTicker((next) => { items = next; draw(); });
}

// Probekarte für die Vorschau, solange noch keine echte gezogen ist
function testCard() {
  const items = [['🔫', 'Sturmgewehr'], ['💊', 'Medkit'], ['🧪', 'Schildtrank'], ['🎣', 'Angel'], ['🏹', 'Bogen'],
    ['💣', 'Granate'], ['🍌', 'Banane'], ['🛡️', 'Schild'], ['🚗', 'Auto'], ['🔑', 'Tresorschlüssel'], ['🍄', 'Pilz'], ['📦', 'Truhe']];
  const svg = (emoji) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="72" font-size="70" text-anchor="middle">${emoji}</text></svg>`)}`;
  const rarities = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common', 'exotic', null];
  const cells = [['💀', 'Kill', 5], ...items.sort(() => Math.random() - 0.5).slice(0, 7)].sort(() => Math.random() - 0.5)
    .map(([e, name, amount], i) => ({ id: `t${i}`, name, path: svg(e), ...(rarities[i] ? { rarity: rarities[i] } : {}), ...(amount ? { amount } : {}) }));
  cells.splice(4, 0, { free: true });
  return { size: 3, cells, marked: [4], visible: true, created_at: 'test' };
}

// ============================================================
// Einrichten (edit=1): Karten und Kamera-Rahmen mit der Maus verschieben
// ============================================================
// Läuft nur in der Vorschau des OBS-Dialogs. Jede fertige Bewegung geht per
// postMessage an die Seite, die daraus die Adresse für OBS baut.
function setupEdit() {
  document.body.classList.add('is-edit');
  if (opt.prank || opt.camframe) {
    const cam = document.createElement('div');
    cam.id = 'ov-cam';
    cam.className = 'ov-cam-frame';
    cam.dataset.drag = 'cam';
    cam.innerHTML = '<span>Kamera des Streamers</span><i class="ov-cam-handle" data-resize title="Größe ändern"></i>';
    document.body.append(cam);
    setCam(opt.cam);
  }
  for (const [id, key] of [['ov-spin', 'wheel'], ['ov-next', 'next'], ['ov-bingo', 'bingo'], ['ov-quest', 'quest'], ['ov-shop', 'shop'], ['ov-challenge', 'challenge'], ['ov-alert', 'alerts'], ['ov-recent', 'recent'], ['ov-chat', 'chat'], ['ov-ticker', 'ticker']]) {
    if ($(id)) $(id).dataset.drag = key;
  }
  addEventListener('pointerdown', startDrag);
  // Die Seite schickt den Kamera-Bereich, wenn sie ihn aus OBS ausgelesen hat,
  // und welche Ebene gerade in der Liste aufgeklappt ist (wird hier markiert).
  addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    if (e.data?.type === 'stellwerk-select') {
      document.querySelectorAll('.is-selected').forEach((el) => el.classList.remove('is-selected'));
      const key = ['prank', 'camframe'].includes(e.data.key) ? 'cam' : e.data.key;
      if (key) document.querySelector(`[data-drag="${key}"]`)?.classList.add('is-selected');
      return;
    }
    if (e.data?.type !== 'stellwerk-cam') return;
    opt.cam = camera(e.data.value);
    setCam(opt.cam);
  });
}

function setCam({ x, y, w, h }) {
  const cam = $('ov-cam');
  if (cam) Object.assign(cam.style, { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` });
}

function startDrag(e) {
  const el = e.target.closest('[data-drag]');
  if (!el || e.button !== 0) return;
  e.preventDefault();
  // Klick auf eine Karte: rechts im OBS-Fenster ihre Einstellungen öffnen
  parent.postMessage({ type: 'stellwerk-obs-select', key: el.dataset.drag }, location.origin);
  const resize = !!e.target.closest('[data-resize]');
  const W = innerWidth;
  const H = innerHeight;
  const r = el.getBoundingClientRect();
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let moved = false;
  el.setPointerCapture(e.pointerId);
  el.classList.add('is-dragging');

  const move = (ev) => {
    const dx = ev.clientX - e.clientX;
    const dy = ev.clientY - e.clientY;
    moved ||= Math.abs(dx) + Math.abs(dy) > 2;
    if (resize) {
      el.style.width = `${clamp(r.width + dx, 60, W - r.left)}px`;
      el.style.height = `${clamp(r.height + dy, 60, H - r.top)}px`;
      return;
    }
    let left = clamp(r.left + dx, 0, W - r.width);
    let top = clamp(r.top + dy, 0, H - r.height);
    // Einrasten am Rand (im eingestellten Abstand) und in der Mitte
    const snap = (v, size, total) => {
      for (const t of [opt.margin, (total - size) / 2, total - size - opt.margin, 0, total - size]) {
        if (Math.abs(v - t) < 18) return t;
      }
      return v;
    };
    left = snap(left, r.width, W);
    top = snap(top, r.height, H);
    el.classList.remove(...POSITIONS.map((p) => `pos-${p}`));
    el.classList.add('pos-free');
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };

  const up = () => {
    el.removeEventListener('pointermove', move);
    el.classList.remove('is-dragging');
    if (!moved) return;
    const pct = (v, total) => Math.round((v / total) * 1000) / 10;
    const b = el.getBoundingClientRect();
    const key = el.dataset.drag;
    const value = key === 'cam'
      ? [pct(b.left, W), pct(b.top, H), pct(b.width, W), pct(b.height, H)].join(',')
      : `${pct(b.left, W)},${pct(b.top, H)}`;
    if (key !== 'cam') {
      el.dataset.x = pct(b.left, W);
      el.dataset.y = pct(b.top, H);
    } else {
      opt.cam = camera(value);
    }
    parent.postMessage({ type: 'stellwerk-obs', key, value }, location.origin);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up, { once: true });
  el.addEventListener('pointercancel', up, { once: true });
}

// ============================================================
// Ton – in OBS darf die Browserquelle ohne Klick abspielen.
// "Audio über OBS steuern" in der Quelle macht ihn im Mixer regelbar.
// ============================================================
const sound = {
  ctx: null,
  get() {
    if (!opt.vols.wheel) return null;
    try {
      this.ctx ??= new (window.AudioContext ?? window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { return null; }
    return this.ctx.state === 'running' ? this.ctx : null;
  },
  tone(freq, { type = 'sine', at = 0, peak = 0.2, decay = 0.4 } = {}) {
    const ctx = this.get();
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * opt.vols.wheel), t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + decay + 0.05);
  },
  tick() { this.tone(1900, { type: 'triangle', peak: 0.05, decay: 0.03 }); },
  whoosh() { this.tone(220, { type: 'sine', peak: 0.06, decay: 0.35 }); },
  // Zweiklang wie ein kurzer Gong
  ding() {
    this.tone(659.25, { peak: 0.22, decay: 1.2 });
    this.tone(880, { at: 0.22, peak: 0.2, decay: 1.6 });
  },
};
