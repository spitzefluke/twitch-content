import { CONFIG } from './config.js';
import { createApi, germanError } from './api.js';
import { playIntro } from './intro.js';
import { Wheel } from './wheel.js';
import { BOARD, ITEMS, MAX_SOUND_SECONDS, Sfx, prankEmoji, prankText, setItemIcon, setPrankIcon, throwItem } from './prank-fx.js';
import { MAX_AMOUNT, RARITIES, amountFromFile, bingoState, drawCard, fullBetLines, nameFromFile, rarityFromFile, renderBingoGrid, shrinkImage } from './bingo.js';
import { DEFAULT_STAGE, OUTCOME_LABEL, STATUS_LABEL, paintQuestionCard } from './questions.js';
import { DEFAULT_PET, Dino, dinoSvg, hungerOf, isHungry, runDino } from './pet.js';
import { DEFAULT_TICKER } from './ticker.js';
import {
  DEFAULT_SHOP, GOLD, PLAYER_COLORS, catalogFromText, pointsText, catalogToText, chestSvg, coinsLeft, colorOf, itemIcon, priceOf, renderLoadout, renderTug,
  scoreOf, sortByRarity, versusIntro, versusOrder, versusWinner, winnersOf,
} from './shop.js';
import {
  KINDS, challengeBurst, challengeSummary, currentStage, doneCount, heartsHtml, pipsHtml, stageDone, stageLabel,
} from './challenge.js';

const $ = (sel, root = document) => root.querySelector(sel);
// index.html?obs: nur die OBS-Einstellungen, als eigenes Fenster
const OBS_PAGE = new URLSearchParams(location.search).has('obs');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

const state = {
  api: null,
  user: null,
  profile: null,
  tiles: [],
  variants: [],
  variantId: null,
  twitch: { connected: false },
  spins: [],
  ideas: [],
  ideasOn: false,
  spinning: false,
  queue: [],
  held: [],
  resetAuth: null,
  wheel: null,
  activeTile: null,
  spinSubscribed: false,
  // Ärgere den Dave
  prank: {
    on: false,          // Migration …_pranks.sql eingespielt?
    settings: { enabled: true, cooldown_seconds: 20, allow_uploads: true },
    sounds: [],
    log: [],
    seen: new Set(),    // eigene Aktionen kommen auch über Realtime – nicht doppelt zeigen
    until: 0,           // Ende der Pause bis zur nächsten Aktion
    timer: 0,
    subscribed: false,
    sfx: null,
  },
  // Fortnite-Bingo
  bingo: {
    on: false,          // Migration …_bingo.sql eingespielt?
    items: [],
    card: null,
    lines: 0,           // volle Linien – steigt die Zahl, gibt es "Bingo!"
    subscribed: false,
    tab: null,          // 'dave' oder 'mine'
    mine: null,         // eigene Karte
    mineLoaded: false,
  },
  // Unangenehme Fragen
  questions: {
    on: false,          // Migration …_questions_pet.sql eingespielt?
    error: '',
    list: [],           // eigene Fragen, für Admins alle
    stage: null,        // was gerade im Stream steht
    subscribed: false,
  },
  // Win-Challenge (nur Dave trägt ein)
  challenge: {
    on: false,
    error: '',
    data: null,
    access: { can_edit: false, is_owner: false, admins_can_edit: false },
    mods: [],
    editing: false,     // Editor geändert, noch nicht gespeichert
    subscribed: false,
  },
  // Kisten-Shop
  shop: {
    on: false,
    error: '',
    settings: null,
    mode: 'solo',       // 'solo' oder 'koop'
    run: null,          // aktuelle eigene Runde
    chests: null,       // aufgedeckte Kisten (nur direkt nach dem Öffnen)
    chestsFor: null,
    lobby: null,        // Koop-Runde (ohne Kisten-Werte)
    lobbyRuns: [],
    timer: 0,
    subscribed: false,
  },
  // Daves Dino
  pet: {
    on: false,
    data: null,
    events: [],
    subscribed: false,
    dino: null,         // läuft im Dialog, solange er offen ist
    stopBrain: null,
    sfx: null,
  },
};

boot();

// ============================================================
// Start
// ============================================================
async function boot() {
  const params = new URLSearchParams(location.search);

  // Rückweg vom Chat-Bot-Verbinden: Das Ergebnis gehört in den Admin-Bereich,
  // auch wenn die Weiterleitung hier auf der Startseite gelandet ist.
  let botFlow = false;
  let twitchFlow = false;
  try {
    botFlow = sessionStorage.getItem('zd_bot_flow') === '1';
    twitchFlow = sessionStorage.getItem('zd_twitch_flow') === '1';
    sessionStorage.removeItem('zd_bot_flow');
    sessionStorage.removeItem('zd_twitch_flow');
  } catch { /* ignorieren */ }
  // Schickt Twitch nach der Freigabe zur Supabase-Anmeldung statt zur
  // Stellwerk-Funktion, meldet Supabase "OAuth state parameter is invalid".
  // Ursache: In der Twitch-App fehlt die Redirect-URL der Funktion.
  const oauthError = params.get('error_description') ?? new URLSearchParams(location.hash.slice(1)).get('error_description') ?? '';
  const wrongRedirect = (botFlow || twitchFlow) && /state parameter is invalid/i.test(oauthError);
  if (botFlow && (wrongRedirect || params.has('twitch'))) {
    location.replace(wrongRedirect ? 'admin.html?twitch=error&reason=redirect_uri' : `admin.html${location.search}`);
    return;
  }
  if (!botFlow && (params.get('twitch') === 'bot_connected' || params.get('reason') === 'bot_is_broadcaster')) {
    location.replace(`admin.html${location.search}`);
    return;
  }
  if (wrongRedirect) {
    history.replaceState(null, '', location.pathname);
    params.set('twitch', 'error');
    params.set('reason', 'redirect_uri');
  }
  const apiPromise = Promise.resolve(createApi());

  // Einmal-Code vom Admin-Bereich ("Webseite als Admin öffnen")
  let adminHash = null;
  try { adminHash = sessionStorage.getItem('zd_admin_site'); sessionStorage.removeItem('zd_admin_site'); } catch { /* ignorieren */ }

  let seen = false;
  try { seen = sessionStorage.getItem('zd_intro') === '1'; sessionStorage.setItem('zd_intro', '1'); } catch { /* ignorieren */ }
  if (params.has('intro') || (!seen && !params.has('twitch') && !adminHash && !OBS_PAGE)) {
    await playIntro({ duration: (CONFIG.INTRO_SECONDS ?? 20) * 1000 });
  } else {
    $('#intro').remove();
  }

  try {
    state.api = await apiPromise;
  } catch (err) {
    console.error(err);
    showAuth();
    toast('Verbindung zu Supabase fehlgeschlagen. Prüfe js/config.js.', 'error');
    return;
  }
  if (state.api.demo) $('#demo-banner').hidden = false;

  const twitchReturn = params.get('twitch');
  if (twitchReturn) {
    history.replaceState(null, '', location.pathname);
    queueMicrotask(() => showTwitchReturn(twitchReturn, params.get('reason'), params.get('detail')));
  }

  if (adminHash) {
    try {
      await state.api.adminSiteLogin(adminHash);
    } catch (err) {
      queueMicrotask(() => toast(`Admin-Anmeldung fehlgeschlagen: ${germanError(err)}`, 'error', 7000));
    }
  }

  setupAuthForms();
  setupSocial();
  setupDialogs();

  state.api.onAuthChange((user) => {
    if (user && !state.user) enterApp(user);
    if (!user && state.user) leaveApp();
  });
  const user = await state.api.getUser();
  if (user) { if (!state.user) await enterApp(user); }
  else showAuth();
}

function showTwitchReturn(status, reason, detail) {
  if (status === 'connected') {
    toast('Twitch ist verbunden. Die Kanalpunkte-Belohnung „Glücksrad“ ist jetzt aktiv.', 'ok', 7000);
    return;
  }
  const reasons = {
    wrong_account: `Nur der Kanal ${CONFIG.CHANNEL} kann verbunden werden.`,
    no_broadcaster_login: 'In Supabase fehlt das Secret BROADCASTER_LOGIN (Daves Twitch-Name). Ohne es darf sich aus Sicherheitsgründen nur ein Admin verbinden. Secret unter Edge Functions → Secrets eintragen und erneut verbinden.',
    redirect_uri: `Twitch hat nach der Freigabe nicht zum Stellwerk zurückgeleitet. In der Twitch-App (dev.twitch.tv → Console → Anwendungen → Verwalten) unter „OAuth Redirect URLs“ zusätzlich ${CONFIG.SUPABASE_URL}/functions/v1/twitch-oauth eintragen, speichern und noch einmal verbinden.`,
    not_affiliate: 'Kanalpunkte gibt es nur für Twitch-Affiliates und Partner.',
    reward_exists: 'Es gibt schon eine manuell erstellte Belohnung „Glücksrad“. Bitte im Twitch-Dashboard löschen und erneut verbinden.',
    access_denied: 'Die Freigabe auf Twitch wurde abgebrochen.',
    state: 'Die Anfrage ist abgelaufen. Bitte noch einmal versuchen.',
  };
  // Bei unerwarteten Fehlern schickt die Edge Function die eigentliche Meldung mit.
  const text = reasons[reason] ?? detail ?? (reason && reason !== 'unknown' ? reason : null)
    ?? 'Unbekannter Fehler – Details in Supabase unter Edge Functions → twitch-oauth → Logs.';
  toast(`Twitch-Verbindung fehlgeschlagen: ${text}`, 'error', 20000);
}

// ============================================================
// Anmelden / Registrieren
// ============================================================
function showAuth() {
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('#form-login input[name="email"]')?.focus({ preventScroll: true });
}

function setupAuthForms() {
  const seg = $('.segmented');
  const tabs = { login: $('#tab-login'), register: $('#tab-register') };
  const forms = { login: $('#form-login'), register: $('#form-register') };

  const select = (name) => {
    seg.dataset.active = name;
    for (const key of Object.keys(tabs)) {
      tabs[key].setAttribute('aria-selected', String(key === name));
      forms[key].hidden = key !== name;
    }
  };
  tabs.login.addEventListener('click', () => select('login'));
  tabs.register.addEventListener('click', () => select('register'));

  // Nach dem Einsteigen alles leeren: Sonst steht das Passwort nach dem
  // Abmelden noch im Formular, und ein Klick meldet wieder an.
  state.resetAuth = () => {
    forms.login.reset();
    forms.register.reset();
    formMsg(forms.login, '');
    formMsg(forms.register, '');
    select('login');
  };

  forms.login.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const email = f.email.value.trim();
    const password = f.password.value;
    if (!email || !password) return formMsg(f, 'Bitte E-Mail und Passwort eingeben.');
    await withLoading(f, async () => {
      await state.api.signIn(email, password);
    });
  });

  forms.register.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const username = f.username.value.trim();
    const email = f.email.value.trim();
    const password = f.password.value;
    if (username.length < 3) return formMsg(f, 'Der Benutzername braucht mindestens 3 Zeichen.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return formMsg(f, 'Bitte eine gültige E-Mail eingeben.');
    if (password.length < 6) return formMsg(f, 'Das Passwort muss mindestens 6 Zeichen haben.');
    await withLoading(f, async () => {
      const { needsConfirmation } = await state.api.signUp(username, email, password);
      if (needsConfirmation) {
        select('login');
        forms.login.email.value = email;
        formMsg(forms.login, 'Fast geschafft! Bestätige den Link in deiner E-Mail und melde dich dann an.', true);
      }
    });
  });
}

// ---------- Social-Logins (Twitch, Discord, Google, Spotify, GitHub) ----------
async function setupSocial() {
  const box = $('#social');
  const msg = box.querySelector('.social-msg');

  // Fehler, mit denen Supabase nach dem Anbieter-Login zurückleitet (?error=… oder #error=…)
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const oauthError = query.get('error_description') ?? hash.get('error_description') ?? query.get('error') ?? hash.get('error');
  if (oauthError) {
    msg.textContent = `Anmeldung fehlgeschlagen: ${germanError(new Error(oauthError.replace(/\+/g, ' ')))}`;
    history.replaceState(null, '', location.pathname);
  }

  let enabled = {};
  try { enabled = await state.api.authProviders(); } catch { /* Buttons bleiben aus */ }
  let visible = 0;
  box.querySelectorAll('[data-provider]').forEach((btn) => {
    const on = !!enabled[btn.dataset.provider];
    btn.hidden = !on;
    if (on) visible++;
    btn.addEventListener('click', async () => {
      msg.textContent = '';
      box.querySelectorAll('[data-provider]').forEach((b) => { b.disabled = true; });
      try {
        await state.api.signInWithProvider(btn.dataset.provider); // leitet weiter
      } catch (err) {
        msg.textContent = germanError(err);
        box.querySelectorAll('[data-provider]').forEach((b) => { b.disabled = false; });
      }
    });
  });
  // Der erste sichtbare Button wird groß dargestellt (normalerweise Twitch)
  box.querySelector('[data-provider]:not([hidden])')?.classList.add('is-primary');
  box.hidden = visible === 0 && !oauthError;
}

async function withLoading(form, fn) {
  const btn = form.querySelector('button[type="submit"]');
  formMsg(form, '');
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    await fn();
  } catch (err) {
    formMsg(form, germanError(err));
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

function formMsg(form, text, ok = false) {
  const el = form.querySelector('.form-msg');
  el.textContent = text;
  el.classList.toggle('is-ok', ok);
}

// ============================================================
// Dashboard
// ============================================================
async function enterApp(user) {
  state.user = user;
  state.resetAuth?.();
  $('#auth').hidden = true;
  $('#app').hidden = false;

  const api = state.api;
  const [profile, tiles, variants, twitch, spins, ideas, prankSettings, prankLog, bingo] = await Promise.all([
    api.getProfile(user),
    api.getTiles().catch(fail('Kacheln', [])),
    api.getVariants().catch(fail('Glücksrad', [])),
    api.twitchStatus().catch(() => ({ connected: false })),
    api.getSpins().catch(() => []),
    // Die Vorschläge-Tabellen kamen später dazu: fehlen sie in der Datenbank,
    // bleibt der Bereich einfach aus, statt einen Fehler zu zeigen.
    api.getIdeas().catch((err) => { console.warn('Vorschläge nicht verfügbar:', err); return null; }),
    // Genauso „Ärgere den Dave“ (Migration …_pranks.sql)
    api.getPrankSettings().catch((err) => { console.warn('Ärgere den Dave nicht verfügbar:', err); return null; }),
    api.getPranks().catch(() => []),
    api.getBingo().catch((err) => { console.warn('Bingo nicht verfügbar:', err); return null; }),
  ]);
  if (!state.user) return; // zwischenzeitlich abgemeldet
  Object.assign(state, { profile, tiles, variants, twitch, spins });
  state.ideas = ideas ?? [];
  state.ideasOn = ideas !== null;
  state.variantId ??= variants[0]?.id;
  state.prank.on = prankSettings !== null;
  if (prankSettings) state.prank.settings = prankSettings;
  state.prank.log = prankLog;
  state.bingo.on = bingo !== null;
  if (bingo) Object.assign(state.bingo, bingo, { lines: bingoState(bingo.card).count });

  renderHeader();
  renderHero();
  renderGrid();
  renderArchive();
  renderIdeas();
  renderWheelPanel();

  if (!state.spinSubscribed) {
    state.spinSubscribed = true;
    api.onSpin(handleIncomingSpin);
  }
  if (state.prank.on && !state.prank.subscribed) {
    state.prank.subscribed = true;
    api.onPrank(handleIncomingPrank);
  }
  if (state.bingo.on && !state.bingo.subscribed) {
    state.bingo.subscribed = true;
    api.onBingo((card) => applyBingoCard(card));
  }
  // Fragen und Dino laden im Hintergrund – fehlen sie noch, bleiben die Kacheln einfach ruhig.
  loadQuestions();
  loadPet();
  loadShop();
  loadChallenge();
  if (OBS_PAGE) startObsPage();
}

function leaveApp() {
  state.user = null;
  state.profile = null;
  Object.assign(state.shop, { run: null, chests: null, lobby: null, lobbyRuns: [], mode: 'solo' });
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  showAuth();
}

function fail(what, fallback) {
  return (err) => {
    console.error(err);
    toast(`${what} konnten nicht geladen werden: ${germanError(err)}`, 'error');
    return fallback;
  };
}

function renderHeader() {
  const { profile, twitch } = state;
  $('#user-name').textContent = profile.username;
  $('#user-avatar').textContent = profile.username.slice(0, 1).toUpperCase();
  $('#user-role').hidden = !profile.is_admin;
  $('#admin-btn').hidden = !profile.is_admin;

  const hour = new Date().getHours();
  const hello = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
  $('#greeting').textContent = `${hello}, ${profile.username}`;
  $('#today').textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

  // Die Plakette zeigt, ob Zuschauer das Rad gerade per Kanalpunkten drehen können.
  const pill = $('#live-pill');
  pill.hidden = !(twitch.connected && twitch.reward_active);
  pill.textContent = 'Kanalpunkte aktiv';

  const btn = $('#twitch-btn');
  btn.classList.toggle('btn--twitch', !twitch.connected);
  btn.classList.toggle('btn--ghost', twitch.connected);
  btn.classList.toggle('btn--connected', twitch.connected);
  btn.textContent = twitch.connected ? `Twitch: ${twitch.display_name ?? twitch.login}` : 'Mit Twitch verbinden';
  btn.title = twitch.connected ? 'Kanalpunkte & Chat sind verbunden' : 'Für Dave: Kanalpunkte und Chat freigeben';
}

// ---------- Nächste Abfahrt & Glücksrad ----------
// Eine Kachel wandert erst ins Archiv, wenn der Termin ein paar Stunden
// zurückliegt – solange bleibt sie mit "jetzt live" im Fahrplan stehen.
const LIVE_WINDOW = 6 * 60 * 60 * 1000;
const isArchived = (t) => t.kind === 'countdown' && t.target_at && Date.now() - Date.parse(t.target_at) > LIVE_WINDOW;
const isPlanned = (t) => t.kind === 'countdown' && !isArchived(t);
// "Ärgere den Dave", Bingo, Fragen, Dino, Kisten-Shop und Win-Challenge haben ein Startdatum für Zuschauer (target_at).
// Admins können vorher schon alles benutzen und testen.
const isLocked = (t) => ['prank', 'bingo', 'questions', 'pet', 'shop', 'challenge'].includes(t.kind)
  && !state.profile?.is_admin && !!t.target_at && Date.parse(t.target_at) > Date.now();
const tileByKind = (kind) => state.tiles.find((t) => t.kind === kind);

function startLabel(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} · ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
}

// Für Admins auf der Kachel: ab wann Zuschauer mitmachen können
function startNote(tile) {
  if (!state.profile?.is_admin || !tile.target_at || Date.parse(tile.target_at) <= Date.now()) return null;
  const note = document.createElement('span');
  note.className = 'tile-note';
  const d = new Date(tile.target_at);
  note.textContent = `🔒 Zuschauer ab ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  note.title = `Zuschauer sehen bis ${startLabel(tile.target_at)} einen Countdown`;
  return note;
}

// Der nächste Termin, der noch bevorsteht – sonst der, der gerade läuft.
function nextDeparture() {
  const dated = state.tiles.filter((t) => isPlanned(t) && t.target_at)
    .sort((a, b) => Date.parse(a.target_at) - Date.parse(b.target_at));
  return dated.find((t) => Date.parse(t.target_at) >= Date.now()) ?? dated[0] ?? null;
}

function renderHero() {
  const next = nextDeparture();
  $('#next-title').textContent = next?.title ?? 'Kein Termin geplant';
  $('#next-desc').textContent = next?.description ?? 'Sobald eine Idee einen Termin bekommt, steht sie hier.';
  $('.nd-bg').style.backgroundImage = `url(${JSON.stringify(heroImage(next))})`;

  const cd = $('#next-countdown');
  cd.replaceChildren();
  cd.hidden = !next;
  if (next) {
    cd.dataset.target = next.target_at ?? '';
    renderCountdown(cd, next.target_at);
  } else {
    delete cd.dataset.target;
  }

  const wheelTile = state.tiles.find((t) => t.kind === 'wheel');
  const card = $('#wheel-card');
  const [c1, c2, c3] = state.variants.map((v) => v.color);
  card.style.setProperty('--c1', c1 ?? '#ffb81c');
  card.style.setProperty('--c2', c2 ?? '#3ddc84');
  card.style.setProperty('--c3', c3 ?? '#9146ff');
  $('#wheel-card-title').textContent = wheelTile?.title ?? 'Fortnite-Glücksrad';
  $('#wheel-card-desc').textContent = wheelTile?.description ?? '';
  $('#wheel-card-tag').textContent = state.twitch.reward_active
    ? `Jederzeit · ${Number(state.twitch.reward_cost ?? 10000).toLocaleString('de-DE')} Punkte`
    : `Jederzeit · ${state.variants.length} Varianten`;
  card.setAttribute('aria-label', `${wheelTile?.title ?? 'Glücksrad'} öffnen`);

  $('#plan-count').textContent = `${state.tiles.filter(isPlanned).length + 1} Abfahrten geplant`;
}

function heroImage(tile) {
  return safeUrl(tile?.background) ?? THEME_BG[tile?.theme] ?? THEME_BG.tracks;
}

// ---------- Archiv ----------
function renderArchive() {
  const list = $('#archive-list');
  const rows = state.tiles.filter(isArchived)
    .sort((a, b) => Date.parse(b.target_at) - Date.parse(a.target_at));

  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch nichts gefahren – der erste Countdown läuft oben.';
    list.replaceChildren(li);
    return;
  }

  list.replaceChildren(...rows.map((tile) => {
    const date = new Date(tile.target_at);
    const li = document.createElement('li');

    const when = document.createElement('span');
    when.className = 'ar-date';
    when.textContent = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

    const main = document.createElement('span');
    main.className = 'ar-main';
    const title = document.createElement('span');
    title.className = 'ar-title';
    title.textContent = tile.title;
    const meta = document.createElement('span');
    meta.className = 'ar-meta';
    meta.textContent = `${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr · ${tile.description}`;
    main.append(title, meta);

    const vod = document.createElement('a');
    vod.className = 'ar-vod';
    vod.href = `https://www.twitch.tv/${CONFIG.CHANNEL}/videos`;
    vod.target = '_blank';
    vod.rel = 'noopener';
    vod.textContent = 'VOD';
    vod.title = `Aufzeichnungen von ${CONFIG.CHANNEL} auf Twitch`;

    li.append(when, main, vod);
    return li;
  }));
}

// ---------- Vorschläge ----------
function renderIdeas() {
  $('#ideas-panel').hidden = !state.ideasOn;
  if (!state.ideasOn) return;

  const list = $('#ideas-list');
  if (!state.ideas.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch keine Vorschläge – mach den Anfang.';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...state.ideas.map(buildIdea));
}

function buildIdea(idea) {
  const li = document.createElement('li');

  const main = document.createElement('span');
  main.className = 'idea-main';
  const text = document.createElement('span');
  text.className = 'idea-text';
  text.textContent = idea.text;
  const by = document.createElement('span');
  by.className = 'idea-by';
  by.textContent = `von ${idea.author || 'anonym'}`;
  main.append(text, by);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vote-btn';
  paintVote(btn, idea);
  btn.addEventListener('click', () => voteIdea(idea, btn));

  li.append(main, btn);
  return li;
}

function paintVote(btn, idea) {
  btn.textContent = String(idea.votes);
  btn.classList.toggle('is-voted', !!idea.voted);
  btn.setAttribute('aria-pressed', String(!!idea.voted));
  btn.setAttribute('aria-label', `${idea.votes} Stimmen für „${idea.text}“`);
}

async function voteIdea(idea, btn) {
  const on = !idea.voted;
  btn.disabled = true;
  // Erst umschalten, damit der Klick sofort ankommt – bei Fehler zurückdrehen.
  idea.voted = on;
  idea.votes += on ? 1 : -1;
  paintVote(btn, idea);
  try {
    await state.api.voteIdea(idea.id, on);
  } catch (err) {
    idea.voted = !on;
    idea.votes += on ? -1 : 1;
    paintVote(btn, idea);
    toast(`Stimme konnte nicht gespeichert werden: ${germanError(err)}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function submitIdea(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const text = form.text.value.trim();
  if (text.length < 3) return formMsg(form, 'Bitte mindestens 3 Zeichen eingeben.');
  await withLoading(form, async () => {
    const idea = await state.api.addIdea(text);
    state.ideas = [idea, ...state.ideas];
    form.reset();
    renderIdeas();
    toast('Danke! Dein Vorschlag steht jetzt im Stellwerk.', 'ok');
  });
}

// ---------- Kacheln ----------
function renderGrid() {
  const grid = $('#grid');
  // „Ärgere den Dave“ und das Bingo haben keinen Termin und stehen immer im Fahrplan.
  // Vor dem Start sehen Zuschauer statt der Aktion einen Countdown (isLocked).
  const build = { prank: buildPrankTile, bingo: buildBingoTile, questions: buildQuestionsTile, pet: buildPetTile, shop: buildShopTile, challenge: buildChallengeTile };
  const shown = state.tiles.filter((t) => isPlanned(t) || build[t.kind]);
  grid.replaceChildren(...shown.map((tile, i) => (build[tile.kind] && !isLocked(tile) ? build[tile.kind] : buildTile)(tile, i)));
  // Läuft ein Countdown ab, wird die Kachel von selbst zur Aktion.
  state.unlockAt = Math.min(...shown.filter(isLocked).map((t) => Date.parse(t.target_at)), Infinity);
  updateCountdowns();
}

// „Ärgere den Dave“: kein Termin, geht jederzeit – statt Countdown die Wurfgeschosse.
function buildPrankTile(tile, i) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'tile tile--prank theme-prank';
  el.style.setProperty('--i', i);
  el.dataset.id = tile.id;

  const bg = document.createElement('div');
  bg.className = 'tile-bg';
  const img = safeUrl(tile.background);
  if (img) bg.style.backgroundImage = `url(${JSON.stringify(img)})`;
  el.append(bg, div('tile-shade'), div('tile-shine'));

  const body = div('tile-body');
  const tag = document.createElement('span');
  tag.className = 'tile-tag';
  tag.textContent = 'Jederzeit · live';
  const title = document.createElement('h3');
  title.className = 'tile-title';
  title.textContent = tile.title;
  const desc = document.createElement('p');
  desc.className = 'tile-desc';
  desc.textContent = tile.description;
  const row = div('prank-tile-row');
  const ammo = document.createElement('span');
  ammo.className = 'prank-ammo';
  ammo.setAttribute('aria-hidden', 'true');
  ammo.textContent = '🍌🍅🥧🔊';
  const cta = document.createElement('span');
  cta.className = 'prank-cta';
  cta.textContent = 'Dave ärgern →';
  row.append(ammo, cta);
  body.append(tag, title, desc, ...[startNote(tile)].filter(Boolean), row);
  el.append(body);
  el.addEventListener('click', openPrank);
  if (finePointer && !reducedMotion) addTilt(el);
  return el;
}

function buildBingoTile(tile, i) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'tile tile--bingo theme-bingo';
  el.style.setProperty('--i', i);
  el.dataset.id = tile.id;

  const bg = document.createElement('div');
  bg.className = 'tile-bg';
  const img = safeUrl(tile.background);
  if (img) bg.style.backgroundImage = `url(${JSON.stringify(img)})`;
  el.append(bg, div('tile-shade'), div('tile-shine'));

  const body = div('tile-body');
  const tag = document.createElement('span');
  tag.className = 'tile-tag';
  tag.textContent = 'Jederzeit · live';
  const title = document.createElement('h3');
  title.className = 'tile-title';
  title.textContent = tile.title;
  const desc = document.createElement('p');
  desc.className = 'tile-desc';
  desc.textContent = tile.description;
  const row = div('prank-tile-row');
  const progress = document.createElement('span');
  progress.className = 'bingo-tile-progress';
  const cta = document.createElement('span');
  cta.className = 'prank-cta bingo-cta';
  cta.textContent = 'Karte ansehen →';
  row.append(progress, cta);
  body.append(tag, title, desc, ...[startNote(tile)].filter(Boolean), row);
  el.append(body);
  el.addEventListener('click', openBingo);
  if (finePointer && !reducedMotion) addTilt(el);
  paintBingoTile(el);
  return el;
}

// Fortschritt auf der Kachel, ohne das ganze Raster neu zu bauen
function paintBingoTile(el = $('.tile--bingo')) {
  const label = el?.querySelector('.bingo-tile-progress');
  if (!label) return;
  const { card } = state.bingo;
  const st = bingoState(card);
  label.textContent = !card
    ? 'Noch keine Karte'
    : `${st.done}/${st.total} gefunden${st.count ? ` · ${st.count}× Bingo` : ''}`;
}

function buildTile(tile, i) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `tile tile--${tile.kind} theme-${tile.theme}`;
  el.style.setProperty('--i', i);
  el.dataset.id = tile.id;

  const bg = document.createElement('div');
  bg.className = 'tile-bg';
  const img = safeUrl(tile.background);
  if (img) bg.style.backgroundImage = `url(${JSON.stringify(img)})`;
  el.append(bg, div('tile-shade'), div('tile-shine'));

  const body = div('tile-body');
  const tag = document.createElement('span');
  tag.className = 'tile-tag';
  tag.textContent = tile.kind === 'countdown' ? 'Abfahrt in' : 'Startet in';
  const title = document.createElement('h3');
  title.className = 'tile-title';
  title.textContent = tile.title;
  const desc = document.createElement('p');
  desc.className = 'tile-desc';
  desc.textContent = tile.description;
  const cd = div('countdown');
  cd.dataset.target = tile.target_at ?? '';

  body.append(tag, title, desc, cd);
  el.append(body);
  el.addEventListener('click', () => openTile(tile.id));
  if (finePointer && !reducedMotion) addTilt(el);
  return el;
}

function addTilt(el) {
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.classList.add('is-tilting');
    el.style.setProperty('--ry', `${(px - 0.5) * 6}deg`);
    el.style.setProperty('--rx', `${(0.5 - py) * 6}deg`);
    el.style.setProperty('--mx', `${px * 100}%`);
    el.style.setProperty('--my', `${py * 100}%`);
  });
  el.addEventListener('pointerleave', () => {
    el.classList.remove('is-tilting');
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  });
}

function div(cls) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// ---------- Countdowns ----------
const UNITS = [['Tage', 86400], ['Std', 3600], ['Min', 60], ['Sek', 1]];

function renderCountdown(el, targetIso) {
  const target = Date.parse(targetIso);
  if (!targetIso || Number.isNaN(target)) {
    el.className = el.className.replace(/\bcountdown--done\b/, '');
    el.textContent = 'Termin folgt';
    return;
  }
  let secs = Math.max(0, Math.floor((target - Date.now()) / 1000));
  const tag = el.closest('.tile')?.querySelector('.tile-tag');
  if (secs === 0) {
    el.classList.add('countdown--done');
    el.textContent = 'Abgefahren · jetzt live!';
    if (tag) { tag.textContent = 'Live'; tag.classList.add('is-live'); }
    return;
  }
  el.classList.remove('countdown--done');
  if (!el.children.length || el.children.length !== 4) {
    el.replaceChildren(...UNITS.map(([lbl]) => {
      const u = div('cd-unit');
      u.innerHTML = `<span class="cd-num"></span><span class="cd-lbl">${lbl}</span>`;
      return u;
    }));
  }
  UNITS.forEach(([, size], i) => {
    const value = Math.floor(secs / size);
    secs -= value * size;
    const num = el.children[i].firstElementChild;
    const text = String(value).padStart(2, '0');
    if (num.textContent !== text) {
      num.textContent = text;
      if (!reducedMotion) {
        num.classList.remove('bump');
        void num.offsetWidth;
        num.classList.add('bump');
      }
    }
  });
}

function updateCountdowns() {
  document.querySelectorAll('.countdown[data-target]').forEach((el) => renderCountdown(el, el.dataset.target));
}

// Die Kopfleiste der Anmeldekarte zeigt die aktuelle Uhrzeit wie eine Anzeigetafel.
function updateAuthClock() {
  const el = $('#auth-clock');
  if (!el) return;
  const d = new Date();
  el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const status = $('#status-updated');
  if (status) {
    status.dateTime = d.toISOString();
    status.textContent = `aktualisiert ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  }
}
updateAuthClock();
setInterval(() => {
  updateCountdowns();
  updateAuthClock();
  if (state.unlockAt && Date.now() >= state.unlockAt) renderGrid();
}, 1000);

// ============================================================
// Dialoge allgemein
// ============================================================
function setupDialogs() {
  document.querySelectorAll('dialog').forEach((dlg) => {
    dlg.addEventListener('click', (e) => {
      // Klick daneben schließt nur Pop-ups – das OBS-Fenster ist eine eigene Seite
      if (e.target.closest('[data-close]') || (e.target === dlg && dlg.matches(':modal'))) closeDialog(dlg);
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(dlg); });
  });

  $('#logout-btn').addEventListener('click', () => state.api.signOut());
  $('#wheel-card').addEventListener('click', openWheel);
  $('#idea-form').addEventListener('submit', submitIdea);
  $('#twitch-btn').addEventListener('click', openTwitchDialog);
  setupObs();
  $('#spin-btn').addEventListener('click', spinFromWeb);
  $('#simulate-btn').addEventListener('click', () => state.api.simulateRedemption?.());
  $('#tile-edit-btn').addEventListener('click', () => showTileForm(true));
  $('#tile-cancel-btn').addEventListener('click', () => showTileForm(false));
  $('#tile-form').addEventListener('submit', saveTile);
  setupPrank();
  setupBingo();
  setupQuestions();
  setupPet();
  setupShop();
  setupChallenge();
  document.querySelectorAll('[data-tile-start]').forEach((input) => {
    input.addEventListener('change', (e) => { e.stopPropagation(); saveTileStart(input); });
  });
}

function closeDialog(dlg) {
  if (!dlg.open || dlg.classList.contains('is-closing')) return;
  if (dlg.id === 'obs-dialog' && OBS_PAGE) { leaveObsPage(); return; }
  if (reducedMotion) { dlg.close(); return; }
  dlg.classList.add('is-closing');
  setTimeout(() => { dlg.classList.remove('is-closing'); dlg.close(); }, 200);
}

// ============================================================
// Glücksrad
// ============================================================
function openWheel() {
  const dlg = $('#wheel-dialog');
  dlg.showModal();
  if (!state.wheel) {
    state.wheel = new Wheel($('#wheel-canvas'), { onTick: tickPointer });
    const v = currentVariant();
    if (v) state.wheel.setVariant(v);
  }
  state.wheel.resize();
  drainQueue();
}

function currentVariant() {
  return state.variants.find((v) => v.id === state.variantId) ?? state.variants[0];
}

function selectVariant(id) {
  state.variantId = id;
  const input = document.getElementById(`variant-${id}`);
  if (input) input.checked = true;
  const v = currentVariant();
  if (v) {
    $('#wheel-dialog').style.setProperty('--variant', v.color);
    state.wheel?.setVariant(v);
  }
}

function renderWheelPanel() {
  const list = $('#variant-list');
  list.replaceChildren(...state.variants.map((v) => {
    const wrap = div('variant-opt');
    wrap.style.setProperty('--c', v.color);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'variant';
    input.id = `variant-${v.id}`;
    input.value = v.id;
    input.checked = v.id === state.variantId;
    input.addEventListener('change', () => { if (!state.spinning) selectVariant(v.id); });
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.innerHTML = '<span class="swatch"></span><strong></strong><small></small>';
    label.querySelector('strong').textContent = v.name;
    label.querySelector('small').textContent = v.description;
    wrap.append(input, label);
    return wrap;
  }));

  const { twitch, profile } = state;
  // Gepostet wird nur über den Chat-Bot – nie in Daves Namen.
  $('#announce-wrap').hidden = !(profile?.is_admin && twitch.connected && twitch.bot_connected);
  $('#announce-text').textContent = `Ergebnis als ${twitch.bot_name ?? 'Chat-Bot'} im Chat posten`;
  $('#simulate-btn').hidden = !state.api.demo;

  const info = $('#reward-info');
  if (twitch.connected && twitch.reward_active) {
    info.innerHTML = `<span class="ri-icon">✦</span><span>Zuschauer können die Kanalpunkte-Belohnung <b>„${escapeHtml(twitch.reward_title ?? 'Glücksrad')}“</b> für <b>${Number(twitch.reward_cost ?? 10000).toLocaleString('de-DE')} Punkte</b> einlösen. Das Rad dreht dann eine zufällige Variante${twitch.bot_connected ? `, und <b>${escapeHtml(twitch.bot_name ?? twitch.bot_login ?? 'der Chat-Bot')}</b> schreibt das Ergebnis in den Chat` : '. Damit das Ergebnis auch im Chat steht, fehlt noch der Chat-Bot (wird im Admin-Bereich verbunden)'}.</span>`;
  } else if (state.api.demo) {
    info.innerHTML = '<span class="ri-icon">✦</span><span>Demo: Mit dem Button unten kannst du testen, wie eine Kanalpunkte-Einlösung aus dem Twitch-Chat aussieht.</span>';
  } else {
    info.innerHTML = '<span class="ri-icon">✦</span><span>Sobald Dave Twitch verbindet, lässt sich das Rad auch per Kanalpunkte drehen.</span>';
  }

  renderHistory();
  selectVariant(state.variantId);
}

function tickPointer() {
  const p = $('#wheel-pointer');
  p.classList.remove('tick');
  void p.offsetWidth;
  p.classList.add('tick');
}

async function spinFromWeb() {
  if (state.spinning || !state.variants.length) return;
  const btn = $('#spin-btn');
  state.spinning = true;
  btn.disabled = true;
  btn.textContent = 'Das Rad dreht sich …';
  setVariantInputsDisabled(true);
  showResultPending();
  state.wheel.start();
  try {
    const announce = !$('#announce-wrap').hidden && $('#announce').checked;
    const { spin, announced } = await state.api.spin(state.variantId, announce);
    await state.wheel.spinTo(spin.segment_index);
    showResult(spin, announced ? 'Steht jetzt auch im Twitch-Chat.' : '');
    addSpin(spin);
  } catch (err) {
    console.error(err);
    await state.wheel.spinTo(0).catch(() => {});
    resetResult();
    toast(`Drehen fehlgeschlagen: ${germanError(err)}`, 'error');
  } finally {
    state.spinning = false;
    btn.disabled = false;
    btn.textContent = 'Rad drehen';
    setVariantInputsDisabled(false);
    state.held.splice(0).forEach(addSpin);
    drainQueue();
  }
}

function setVariantInputsDisabled(disabled) {
  document.querySelectorAll('#variant-list input').forEach((i) => { i.disabled = disabled; });
}

// Neue Drehung über Realtime (z. B. Kanalpunkte-Einlösung auf Twitch)
function handleIncomingSpin(spin) {
  if (state.spins.some((s) => s.id === spin.id)) return;
  if (spin.source !== 'twitch') {
    // Bei der eigenen Drehung liefert Realtime die neue Zeile, während das
    // Rad noch läuft. Erst nach dem Stopp eintragen, sonst steht das
    // Ergebnis vorab unter „Letzte Drehungen“.
    if (state.spinning) state.held.push(spin);
    else addSpin(spin);
    return;
  }
  if ($('#wheel-dialog').open) {
    state.queue.push(spin);
    drainQueue();
  } else {
    addSpin(spin);
    toast(`@${spin.requested_by} hat das Glücksrad gedreht: ${spin.variant_name} → ${spin.result}`, 'twitch', 7000);
  }
}

async function drainQueue() {
  if (state.spinning || !state.queue.length || !$('#wheel-dialog').open || !state.wheel) return;
  const spin = state.queue.shift();
  state.spinning = true;
  $('#spin-btn').disabled = true;
  setVariantInputsDisabled(true);
  selectVariant(spin.variant_id);
  showResultPending(`@${spin.requested_by} hat Kanalpunkte eingelöst …`);
  await state.wheel.spinTo(spin.segment_index);
  showResult(spin, `Eingelöst von @${spin.requested_by} über Kanalpunkte`);
  addSpin(spin);
  state.spinning = false;
  $('#spin-btn').disabled = false;
  setVariantInputsDisabled(false);
  state.held.splice(0).forEach(addSpin);
  drainQueue();
}

function showResultPending(text = 'Das Rad dreht sich …') {
  const el = $('#result');
  el.classList.remove('is-new');
  el.querySelector('.result-label').textContent = 'Ergebnis';
  el.querySelector('.result-title').textContent = '···';
  el.querySelector('.result-detail').textContent = text;
}

function resetResult() {
  const el = $('#result');
  el.classList.remove('is-new');
  el.querySelector('.result-title').textContent = 'Noch nicht gedreht';
  el.querySelector('.result-detail').textContent = 'Wähle eine Variante und dreh das Rad.';
}

function showResult(spin, note) {
  const el = $('#result');
  const v = state.variants.find((x) => x.id === spin.variant_id);
  el.style.setProperty('--c', v?.color ?? 'var(--amber)');
  el.querySelector('.result-label').textContent = `${spin.variant_name}${note ? ` · ${note}` : ''}`;
  el.querySelector('.result-title').textContent = spin.result;
  el.querySelector('.result-detail').textContent = `${spin.detail} Gilt für die nächste Runde.`;
  el.classList.remove('is-new');
  void el.offsetWidth;
  el.classList.add('is-new');
}

function addSpin(spin) {
  if (state.spins.some((s) => s.id === spin.id)) return;
  state.spins = [spin, ...state.spins].slice(0, 15);
  renderHistory(spin.id);
}

function renderHistory(newId) {
  const list = $('#history-list');
  if (!state.spins.length) {
    list.innerHTML = '<li class="empty">Noch keine Drehungen.</li>';
    return;
  }
  list.replaceChildren(...state.spins.map((s) => {
    const li = document.createElement('li');
    if (s.id === newId) li.className = 'is-new';
    const src = document.createElement('span');
    src.className = `src src--${s.source}`;
    src.textContent = s.source === 'twitch' ? 'Twitch' : 'Web';
    const main = document.createElement('span');
    main.className = 'h-main';
    main.innerHTML = '<strong></strong> <small></small>';
    main.querySelector('strong').textContent = s.result;
    main.querySelector('small').textContent = `· ${s.variant_name} · ${s.requested_by}`;
    const time = document.createElement('time');
    time.dateTime = s.created_at;
    time.textContent = new Date(s.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    li.append(src, main, time);
    return li;
  }));
}

// ============================================================
// Ärgere den Dave
// ============================================================
const LISTEN_KEY = 'zd_prank_listen';

function setupPrank() {
  // Wurfgeschosse
  $('#prank-items').replaceChildren(...ITEMS.map((it) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `prank-item${it.nice ? ' is-nice' : ''}`;
    b.dataset.prankAction = '';
    b.innerHTML = '<span class="prank-item-emoji" aria-hidden="true"></span><span class="prank-item-name"></span>';
    setItemIcon(b.querySelector('.prank-item-emoji'), it);
    b.querySelector('.prank-item-name').textContent = it.name;
    b.setAttribute('aria-label', `${it.name} werfen`);
    b.addEventListener('click', () => prankClick('throw', it));
    return b;
  }));

  // Eingebaute Sounds: großer Knopf = im Stream abspielen, 🎧 = nur hier probehören
  $('#prank-board').replaceChildren(...BOARD.map((sound) => {
    const wrap = div('prank-sfx');
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'prank-sfx-main';
    main.dataset.prankAction = '';
    main.innerHTML = '<span aria-hidden="true"></span><b></b>';
    main.firstElementChild.textContent = sound.emoji;
    main.lastElementChild.textContent = sound.name;
    main.setAttribute('aria-label', `„${sound.name}“ im Stream abspielen`);
    main.addEventListener('click', () => prankClick('sound', sound));
    const tryBtn = document.createElement('button');
    tryBtn.type = 'button';
    tryBtn.className = 'prank-try';
    tryBtn.textContent = '🎧';
    tryBtn.title = 'Nur hier probehören';
    tryBtn.setAttribute('aria-label', `„${sound.name}“ nur hier probehören`);
    tryBtn.addEventListener('click', () => prankSfx(true)?.play(sound.id));
    wrap.append(main, tryBtn);
    return wrap;
  }));

  // Reiter
  const tabs = $('.prank-tabs');
  tabs.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    const name = btn.dataset.tab;
    tabs.dataset.active = name;
    tabs.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    $('#prank-pane-throw').hidden = name !== 'throw';
    $('#prank-pane-sound').hidden = name !== 'sound';
  }));

  const listen = $('#prank-listen');
  try { listen.checked = localStorage.getItem(LISTEN_KEY) !== 'off'; } catch { /* Standard: an */ }
  listen.addEventListener('change', () => {
    try { localStorage.setItem(LISTEN_KEY, listen.checked ? 'on' : 'off'); } catch { /* nur Komfort */ }
  });

  const form = $('#sound-form');
  form.addEventListener('submit', uploadSound);
  form.file.addEventListener('change', () => {
    const file = form.file.files[0];
    $('.sound-file-text', form).textContent = file ? `🎵 ${file.name}` : '🎵 Sound-Datei wählen …';
    // Namen aus dem Dateinamen vorschlagen – aber nichts überschreiben, was jemand selbst getippt hat.
    if (file && (!form.name.value.trim() || form.name.dataset.auto === form.name.value)) {
      form.name.value = form.name.dataset.auto = file.name.replace(/\.[^.]+$/, '').slice(0, 30);
    }
  });

  $('#prank-admin').addEventListener('change', savePrankSettings);
  $('#prank-sync').addEventListener('click', () => syncPrankRewards({ loud: true }));
  $('#prank-dialog').addEventListener('close', () => {
    $('#prank-stage').querySelectorAll('.pf-item, .pf-splat, .prank-bubble').forEach((el) => el.remove());
  });
}

// Ton nur, wenn gewollt – oder immer beim Probehören (force)
function prankSfx(force = false) {
  if (!force && !$('#prank-listen').checked) return null;
  state.prank.sfx ??= new Sfx({ volume: 0.8 });
  return state.prank.sfx;
}

function openPrank() {
  const tile = tileByKind('prank');
  if (tile && isLocked(tile)) { openTile(tile.id); return; }
  renderPrankDialog();
  $('#prank-dialog').showModal();
  if (state.prank.on) loadSounds();
  // Startdatum erreicht oder an/aus geändert? Dann die Belohnungen auf Twitch nachziehen.
  const { twitch, prank } = state;
  if (state.profile?.is_admin && twitch.connected && twitch.prank_rewards) {
    const shouldBeActive = prank.settings.enabled && !(tile?.target_at && Date.parse(tile.target_at) > Date.now());
    if (shouldBeActive !== !!twitch.prank_rewards_active) syncPrankRewards();
  }
}

function renderPrankDialog() {
  const { on, settings } = state.prank;
  const admin = !!state.profile?.is_admin;
  const note = $('#prank-note');
  let text = '';
  if (!on) {
    text = admin
      ? 'Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20260924000000_pranks.sql ausführen. Bis dahin geht hier nichts raus.'
      : '„Ärgere den Dave“ ist noch nicht eingerichtet. Schau später noch mal vorbei.';
  } else if (!settings.enabled && !admin) {
    text = 'Dave hat das Ärgern gerade pausiert. Schau später noch mal vorbei.';
  }
  note.textContent = text;
  note.hidden = !text;
  $('#prank-dialog').classList.toggle('is-off', !on);
  $('#prank-dialog').classList.toggle('is-viewer', !admin);
  renderPrankHowTo();

  const form = $('#prank-admin');
  form.hidden = !(admin && on);
  paintTileStart('prank');
  if (admin && on) paintPrankSync();
  form.enabled.checked = settings.enabled;
  form.allow_uploads.checked = settings.allow_uploads;
  form.throw_cost.value = settings.throw_cost ?? 500;
  form.sound_cost.value = settings.sound_cost ?? 300;
  form.cooldown_seconds.value = String(settings.cooldown_seconds);
  if (form.cooldown_seconds.value !== String(settings.cooldown_seconds)) {
    // Wert außerhalb der Liste (z. B. direkt in der Datenbank gesetzt)
    const opt = new Option(`${settings.cooldown_seconds} Sekunden`, String(settings.cooldown_seconds));
    form.cooldown_seconds.add(opt);
    form.cooldown_seconds.value = opt.value;
  }

  const uploads = settings.allow_uploads || admin;
  $('#sound-form').hidden = !uploads;
  $('#prank-uploads-off').hidden = uploads;

  renderPrankLog();
  renderSounds();
  paintPrankButtons();
}

async function loadSounds() {
  try {
    state.prank.sounds = await state.api.getSounds();
  } catch (err) {
    console.warn('Sounds nicht geladen:', err);
  }
  renderSounds();
}

function renderSounds() {
  const list = $('#prank-sounds');
  const { sounds } = state.prank;
  if (!sounds.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch keine eigenen Sounds – lad den ersten hoch.';
    list.replaceChildren(li);
    return;
  }
  const admin = !!state.profile?.is_admin;
  list.replaceChildren(...sounds.map((sound) => {
    const li = document.createElement('li');
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'prank-sound-main';
    main.dataset.prankAction = '';
    main.innerHTML = '<b></b><small></small>';
    main.querySelector('b').textContent = `🔊 ${sound.name}`;
    main.querySelector('small').textContent = `von ${sound.author || 'anonym'} · ${Number(sound.duration).toLocaleString('de-DE', { maximumFractionDigits: 1 })} s`;
    main.setAttribute('aria-label', `„${sound.name}“ im Stream abspielen`);
    main.addEventListener('click', () => prankClick('custom', sound));

    const tryBtn = document.createElement('button');
    tryBtn.type = 'button';
    tryBtn.className = 'prank-try';
    tryBtn.textContent = '🎧';
    tryBtn.title = 'Nur hier probehören';
    tryBtn.setAttribute('aria-label', `„${sound.name}“ nur hier probehören`);
    tryBtn.addEventListener('click', () => prankSfx(true).playUrl(sound.url));
    li.append(main, tryBtn);

    if (sound.mine || admin) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'prank-try prank-del';
      del.textContent = '🗑';
      del.title = 'Löschen';
      del.setAttribute('aria-label', `„${sound.name}“ löschen`);
      del.addEventListener('click', () => deleteSound(sound, del));
      li.append(del);
    }
    return li;
  }));
  paintPrankButtons();
}

// Admins lösen direkt im Stream aus. Zuschauer bezahlen mit Kanalpunkten auf
// Twitch – hier kopiert ein Klick den Namen zum Eintippen und zeigt eine Vorschau.
function prankClick(kind, entry) {
  if (state.profile?.is_admin) {
    if (kind === 'custom') sendPrank('sound', 'custom', entry);
    else sendPrank(kind, entry.id);
    return;
  }
  const reward = kind === 'throw' ? '🍅 Wirf was auf Dave' : '🔊 Sound für Dave';
  navigator.clipboard?.writeText(entry.name).catch(() => {});
  toast(`„${entry.name}“ kopiert – auf Twitch bei „${reward}“ einfügen.`, 'ok', 4500);
  const preview = { id: `preview-${Date.now()}`, created_at: new Date().toISOString(), requested_by: 'Du' };
  if (kind === 'throw') showPrank({ ...preview, kind: 'throw', item: entry.id }, true);
  else if (kind === 'custom') showPrank({ ...preview, kind: 'sound', item: 'custom', sound_path: entry.path, label: entry.name }, true);
  else showPrank({ ...preview, kind: 'sound', item: entry.id }, true);
}

async function sendPrank(kind, item, sound = null) {
  if (!state.prank.on) return;
  const dlg = $('#prank-dialog');
  dlg.classList.add('is-sending');
  try {
    const row = await state.api.sendPrank(kind, item, sound?.id ?? null);
    state.prank.seen.add(row.id);
    addPrankLog(row);
    showPrank(row, true);
  } catch (err) {
    console.error(err);
    toast(germanError(err), 'error', 6000);
  } finally {
    dlg.classList.remove('is-sending');
  }
}

// Anleitung: Zuschauer über Kanalpunkte, Admins direkt
function renderPrankHowTo() {
  const box = $('#prank-howto');
  const { settings } = state.prank;
  const { twitch } = state;
  const cost = (n) => `${Number(n ?? 0).toLocaleString('de-DE')} Punkte`;
  const status = !twitch.connected
    ? 'Die Belohnungen gibt es, sobald Dave Twitch verbunden hat.'
    : twitch.prank_rewards === false || twitch.prank_rewards === undefined
      ? 'Die Belohnungen sind auf Twitch noch nicht angelegt.'
      : twitch.prank_rewards_active ? '' : 'Die Belohnungen sind auf Twitch gerade ausgeschaltet.';
  box.innerHTML = state.profile?.is_admin
    ? `<b>Du bist Admin:</b> Ein Klick löst direkt im Stream aus – ohne Kanalpunkte, z. B. zum Testen.
       Zuschauer bezahlen mit Kanalpunkten über „🍅 Wirf was auf Dave“ (${cost(settings.throw_cost)}) und „🔊 Sound für Dave“ (${cost(settings.sound_cost)}).`
    : `<b>So ärgerst du Dave:</b> Im Twitch-Chat von Dave auf das Kanalpunkte-Symbol klicken und
       <b>„🍅 Wirf was auf Dave“</b> (${cost(settings.throw_cost)}) oder <b>„🔊 Sound für Dave“</b> (${cost(settings.sound_cost)}) einlösen –
       dann eintippen, was fliegen bzw. welcher Sound laufen soll. Ein Klick hier kopiert den Namen und zeigt eine Vorschau.
       <a class="prank-twitch-link" target="_blank" rel="noopener" href="https://www.twitch.tv/${encodeURIComponent(CONFIG.CHANNEL)}">Zu Daves Twitch-Kanal ↗</a>`;
  if (status) {
    const p = document.createElement('small');
    p.textContent = status;
    box.append(p);
  }
}

// Andere Zuschauer ärgern Dave: steht im Verlauf und fliegt über die Bühne (ohne Ton).
function handleIncomingPrank(row) {
  if (state.prank.seen.has(row.id)) return;
  state.prank.seen.add(row.id);
  addPrankLog(row);
  if ($('#prank-dialog').open) showPrank(row, false);
}

function showPrank(row, own) {
  if (!$('#prank-dialog').open) return;
  const stage = $('#prank-stage');
  const dave = $('#prank-dave');
  const sfx = own ? prankSfx() : null;
  if (row.kind === 'throw') {
    // Ziel: Daves Gesicht in der Zeichnung
    const s = stage.getBoundingClientRect();
    const d = dave.getBoundingClientRect();
    throwItem(stage, {
      item: row.item,
      x: d.left - s.left + d.width * 0.5,
      y: d.top - s.top + d.height * 0.5,
      size: Math.max(44, Math.min(80, s.width * 0.14)),
      sfx,
      reducedMotion,
      onHit: () => {
        dave.classList.remove('is-hit');
        void dave.getBoundingClientRect();
        dave.classList.add('is-hit');
        clearTimeout(dave.hitTimer);
        dave.hitTimer = setTimeout(() => dave.classList.remove('is-hit'), 1100);
      },
    });
  } else {
    if (sfx) {
      if (row.item === 'custom') sfx.playUrl(state.api.soundUrl(row.sound_path));
      else sfx.play(row.item);
    }
    const bubble = document.createElement('span');
    bubble.className = 'prank-bubble';
    bubble.textContent = `${prankEmoji(row)} ${row.item === 'custom' ? row.label : prankText(row).replace(/^.* spielt /, '')}`;
    stage.append(bubble);
    setTimeout(() => bubble.remove(), 2600);
  }
}

function addPrankLog(row) {
  const log = state.prank.log;
  if (log.some((p) => p.id === row.id)) return;
  log.unshift(row);
  log.length = Math.min(log.length, 12);
  renderPrankLog(row.id);
}

function renderPrankLog(newId = null) {
  const list = $('#prank-log');
  if (!state.prank.log.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch ist Dave unbehelligt …';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...state.prank.log.map((p) => {
    const li = document.createElement('li');
    if (p.id === newId) li.className = 'is-new';
    const icon = document.createElement('span');
    icon.className = 'prank-log-icon';
    setPrankIcon(icon, p);
    const main = document.createElement('span');
    main.className = 'h-main';
    main.textContent = prankText(p);
    const time = document.createElement('time');
    time.dateTime = p.created_at;
    time.textContent = new Date(p.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    li.append(icon, main, time);
    return li;
  }));
}

function paintPrankButtons() {
  const off = !state.prank.on;
  document.querySelectorAll('#prank-dialog [data-prank-action]').forEach((btn) => { btn.disabled = off; });
  const admin = !!state.profile?.is_admin;
  $('#prank-lead-throw').textContent = admin
    ? 'Klick wirft sofort – es fliegt Dave im Stream vor die Kamera.'
    : 'Das kannst du auf Dave werfen. Klick = Name kopieren und Vorschau.';
  $('#prank-lead-sound').textContent = admin
    ? 'Klick spielt den Sound im Stream. 🎧 hört nur hier probe.'
    : 'Diese Sounds gibt es. Klick = Name kopieren, 🎧 = probehören.';
}

// ---------- Eigene Sounds ----------
async function uploadSound(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const file = form.file.files[0];
  if (!file) return formMsg(form, 'Bitte zuerst eine Sound-Datei wählen.');
  if (!/^audio\//.test(file.type) && !/\.(mp3|ogg|oga|wav|m4a|aac|webm|flac)$/i.test(file.name)) {
    return formMsg(form, 'Das ist keine Audio-Datei. Bitte MP3, OGG, WAV oder M4A nehmen.');
  }
  if (file.size > 1024 * 1024) return formMsg(form, 'Die Datei ist zu groß (höchstens 1 MB).');
  const name = (form.name.value.trim() || file.name.replace(/\.[^.]+$/, '')).slice(0, 30);
  await withLoading(form, async () => {
    const duration = await audioDuration(file);
    if (duration > MAX_SOUND_SECONDS + 0.4) {
      throw new Error(`Der Sound ist ${duration.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Sekunden lang – erlaubt sind höchstens ${MAX_SOUND_SECONDS}.`);
    }
    const sound = await state.api.uploadSound(file, name, Math.round(Math.min(duration, MAX_SOUND_SECONDS) * 10) / 10);
    state.prank.sounds = [sound, ...state.prank.sounds];
    renderSounds();
    form.reset();
    $('.sound-file-text', form).textContent = '🎵 Sound-Datei wählen …';
    toast(`„${sound.name}“ ist hochgeladen und kann jetzt abgespielt werden.`, 'ok');
  });
}

// Länge ermitteln – gleichzeitig der Test, ob der Browser die Datei abspielen kann.
async function audioDuration(file) {
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    return buf.duration;
  } catch {
    throw new Error('Die Datei lässt sich nicht abspielen. Bitte MP3, OGG, WAV oder M4A nehmen.');
  }
}

async function deleteSound(sound, btn) {
  if (!confirm(`„${sound.name}“ wirklich löschen?`)) return;
  btn.disabled = true;
  try {
    await state.api.deleteSound(sound);
    state.prank.sounds = state.prank.sounds.filter((x) => x.id !== sound.id);
    renderSounds();
  } catch (err) {
    btn.disabled = false;
    toast(`Löschen fehlgeschlagen: ${germanError(err)}`, 'error');
  }
}

// ---------- Einstellungen (Admins) ----------
// Belohnungen auf Twitch an die Einstellungen angleichen (Kosten, Abklingzeit,
// an/aus, Startdatum). Läuft nach jedem Speichern und auf Knopfdruck.
async function syncPrankRewards({ loud = false } = {}) {
  const status = $('#prank-sync-status');
  const btn = $('#prank-sync');
  btn.disabled = true;
  status.textContent = 'Übertrage zu Twitch …';
  try {
    const r = await state.api.syncPrankRewards();
    state.twitch = { ...state.twitch, prank_rewards: true, prank_rewards_active: r.active };
    status.textContent = r.active
      ? '✓ Auf Twitch aktiv – Zuschauer können einlösen.'
      : r.started === false && r.starts_at
        ? `✓ Auf Twitch angelegt, aber aus bis ${startLabel(r.starts_at)}. Danach hier einmal „Auf Twitch übernehmen“.`
        : '✓ Auf Twitch angelegt, aber ausgeschaltet.';
    if (loud) toast('Belohnungen auf Twitch aktualisiert.', 'ok');
    renderPrankHowTo();
  } catch (err) {
    status.textContent = `✕ ${germanError(err)}`;
    if (loud) toast(`Twitch: ${germanError(err)}`, 'error', 7000);
  } finally {
    btn.disabled = false;
  }
}

function paintPrankSync() {
  const { twitch } = state;
  $('#prank-sync-status').textContent = !twitch.connected
    ? 'Twitch ist nicht verbunden – erst wenn Dave verbunden hat, gibt es die Belohnungen.'
    : twitch.prank_rewards === undefined
      ? 'Für die Belohnungen fehlt noch die Migration …_channel_points.sql.'
      : !twitch.prank_rewards
        ? 'Noch nicht auf Twitch angelegt.'
        : twitch.prank_rewards_active ? '✓ Auf Twitch aktiv.' : 'Auf Twitch angelegt, aber ausgeschaltet.';
  $('#prank-sync').disabled = !twitch.connected;
}

async function savePrankSettings() {
  const form = $('#prank-admin');
  const clampCost = (v, d) => Math.min(1000000, Math.max(1, Math.round(Number(v)) || d));
  const patch = {
    enabled: form.enabled.checked,
    allow_uploads: form.allow_uploads.checked,
    cooldown_seconds: Number(form.cooldown_seconds.value),
    throw_cost: clampCost(form.throw_cost.value, 500),
    sound_cost: clampCost(form.sound_cost.value, 300),
  };
  form.querySelectorAll('input, select').forEach((el) => { el.disabled = true; });
  try {
    state.prank.settings = await state.api.updatePrankSettings(patch);
    toast('Gespeichert.', 'ok', 2500);
    if (state.twitch.connected) syncPrankRewards();
  } catch (err) {
    toast(`Speichern fehlgeschlagen: ${germanError(err)}`, 'error');
  } finally {
    form.querySelectorAll('input, select').forEach((el) => { el.disabled = false; });
    renderPrankDialog();
  }
}

// ============================================================
// Fortnite-Bingo
// ============================================================
function setupBingo() {
  $('#bingo-new-btn').addEventListener('click', newBingoCard);
  $('#bingo-clear-btn').addEventListener('click', clearBingo);
  $('#bingo-visible').addEventListener('change', (e) => updateBingoCard({ visible: e.target.checked }));
  $('#bingo-size').addEventListener('change', () => renderBingoDialog());
  $('#my-bingo-new').addEventListener('click', newMyBingo);
  document.querySelectorAll('.bingo-tabs [data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    state.bingo.tab = btn.dataset.tab;
    renderBingoDialog();
  }));
  $('#bingo-free').addEventListener('change', () => renderBingoDialog());
  $('#bingo-bet-btn').addEventListener('click', startBingoBet);
  $('#bingo-bet-cancel').addEventListener('click', () => cancelBingoBet());
  const form = $('#bingo-upload');
  form.addEventListener('submit', uploadBingoImages);
  form.files.addEventListener('change', () => {
    const n = form.files.files.length;
    $('.sound-file-text', form).textContent = n ? `🖼️ ${n === 1 ? form.files.files[0].name : `${n} Bilder gewählt`}` : '🖼️ Bilder wählen … (mehrere gehen)';
  });
}

async function openBingo() {
  const tile = tileByKind('bingo');
  if (tile && isLocked(tile)) { openTile(tile.id); return; }
  renderBingoDialog();
  $('#bingo-dialog').showModal();
  if (!state.bingo.on) return;
  // Frisch laden: Bilder und Haken können sich geändert haben.
  try {
    const [{ items, card }, mine] = await Promise.all([
      state.api.getBingo(),
      state.api.getMyBingo().catch((err) => { console.warn('Eigene Karte:', err); return undefined; }),
    ]);
    state.bingo.items = items;
    state.bingo.card = card;
    state.bingo.lines = bingoState(card).count;
    state.bingo.mine = mine ?? null;
    state.bingo.mineOn = mine !== undefined;
    // Admins landen bei Daves Karte (dort richten sie alles ein), Zuschauer ohne
    // laufende Stream-Karte gleich bei ihrer eigenen.
    state.bingo.tab ??= card || state.profile?.is_admin ? 'dave' : 'mine';
    renderBingoDialog();
  } catch (err) {
    console.warn(err);
  }
}

function renderBingoDialog({ stamped = null, myStamped = null } = {}) {
  const { on, card, items } = state.bingo;
  const admin = !!state.profile?.is_admin;
  const dlg = $('#bingo-dialog');
  const tab = state.bingo.tab ?? 'dave';
  const tabs = $('.bingo-tabs');
  tabs.dataset.active = tab;
  tabs.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('#bingo-pane-dave').hidden = tab !== 'dave';
  $('#bingo-pane-mine').hidden = tab !== 'mine';
  // Die Admin-Spalte gehört zu Daves Karte
  dlg.classList.toggle('is-admin', admin && on && tab === 'dave');
  renderMyBingo(myStamped);

  const note = $('#bingo-note');
  note.textContent = on ? '' : admin
    ? 'Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20260924120000_bingo.sql ausführen.'
    : 'Das Bingo ist noch nicht eingerichtet. Schau später noch mal vorbei.';
  note.hidden = on;

  const grid = $('#bingo-grid');
  const st = bingoState(card);
  $('#bingo-empty').hidden = !!card || !on;
  $('#bingo-empty').textContent = admin
    ? 'Noch keine Karte. Rechts Bilder hochladen und „Neue Karte ziehen“.'
    : 'Noch keine Karte gezogen – gleich geht’s los.';
  grid.hidden = !card;
  const bet = card?.bet ?? null;
  if (card) {
    renderBingoGrid(grid, card, {
      urlFor: (path) => state.api.bingoUrl(path),
      onCell: admin ? toggleBingoCell : null,
      stamped,
      itemOf: bingoItemOf,
      labels: bet?.status === 'active' || bet?.status === 'resolved',
    });
  }
  paintBingoBet(bet, admin && on);
  $('#bingo-status').textContent = card
    ? `${st.done} von ${st.total} gefunden${st.count ? ` · ${st.count}× Bingo!` : ''}${card.visible ? '' : ' · im Stream ausgeblendet'}`
    : '';
  $('#bingo-help').hidden = !card;

  $('#bingo-admin').hidden = !(admin && on && tab === 'dave');
  paintTileStart('bingo');
  if (admin && on) {
    $('#bingo-visible').checked = card?.visible ?? true;
    $('#bingo-visible').disabled = !card;
    $('#bingo-clear-btn').disabled = !card || !st.done;
    const size = Number($('#bingo-size').value);
    const need = size * size - ($('#bingo-free').checked && size % 2 ? 1 : 0);
    $('#bingo-count').textContent = `· ${items.length} hochgeladen${items.length < need ? `, für ${size}×${size} braucht es ${need}` : ''}`;
    renderBingoItems();
  }
  paintBingoTile();
}

function renderBingoItems() {
  const list = $('#bingo-items');
  const { items } = state.bingo;
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch keine Bilder.';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...items.map((item) => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = '';
    img.loading = 'lazy';
    const name = document.createElement('input');
    name.value = item.name;
    name.maxLength = 40;
    name.setAttribute('aria-label', 'Name des Items');
    name.addEventListener('change', async () => {
      const value = name.value.trim();
      if (!value) { name.value = item.name; return; }
      try {
        await state.api.updateBingoItem(item.id, { name: value });
        item.name = value;
      } catch (err) {
        name.value = item.name;
        toast(`Umbenennen fehlgeschlagen: ${germanError(err)}`, 'error');
      }
    });
    const rarity = document.createElement('select');
    rarity.className = `bingo-rarity-pick${item.rarity ? ` r-${item.rarity}` : ''}`;
    rarity.setAttribute('aria-label', `Seltenheit von „${item.name}“`);
    rarity.append(new Option('– keine –', ''), ...RARITIES.map((r) => new Option(r.name, r.id)));
    rarity.value = item.rarity ?? '';
    rarity.addEventListener('change', async () => {
      const value = rarity.value || null;
      try {
        await state.api.updateBingoItem(item.id, { rarity: value });
        item.rarity = value;
        renderBingoDialog();
      } catch (err) {
        rarity.value = item.rarity ?? '';
        toast(`Seltenheit nicht gespeichert: ${germanError(err)}`, 'error');
      }
    });
    // Zahl im Icon, z. B. 5 auf dem Kill-Symbol = 5 Kills
    const amount = document.createElement('input');
    amount.type = 'number';
    amount.className = 'bingo-amount-pick';
    amount.min = '1';
    amount.max = String(MAX_AMOUNT);
    amount.step = '1';
    amount.inputMode = 'numeric';
    amount.placeholder = 'Zahl';
    amount.value = item.amount ?? '';
    amount.title = 'Zahl im Icon, z. B. 5 für 5 Kills – leer lassen für keine';
    amount.setAttribute('aria-label', `Zahl im Icon von „${item.name}“`);
    amount.addEventListener('change', async () => {
      const raw = amount.value.trim();
      const value = raw === '' ? null : Math.round(Number(raw));
      if (value !== null && !(value >= 1 && value <= MAX_AMOUNT)) {
        amount.value = item.amount ?? '';
        toast(`Die Zahl muss zwischen 1 und ${MAX_AMOUNT} liegen.`, 'error');
        return;
      }
      try {
        await state.api.updateBingoItem(item.id, { amount: value });
        item.amount = value;
        renderBingoDialog();
      } catch (err) {
        amount.value = item.amount ?? '';
        toast(`Zahl nicht gespeichert: ${germanError(err)}`, 'error');
      }
    });
    // Kopie mit anderer Zahl: ein Kill-Symbol für 3, 5 und 10 Kills
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'prank-try';
    copy.textContent = '⧉';
    copy.title = 'Kopie mit anderer Zahl';
    copy.setAttribute('aria-label', `„${item.name}“ mit anderer Zahl kopieren`);
    copy.addEventListener('click', async () => {
      const answer = prompt(`Kopie von „${item.name}“ – welche Zahl soll im Icon stehen?`, String(Math.min(MAX_AMOUNT, (item.amount ?? 0) + 1)));
      if (answer === null) return;
      const value = answer.trim() === '' ? null : Math.round(Number(answer));
      if (value !== null && !(value >= 1 && value <= MAX_AMOUNT)) {
        toast(`Die Zahl muss zwischen 1 und ${MAX_AMOUNT} liegen.`, 'error');
        return;
      }
      copy.disabled = true;
      try {
        const created = await state.api.copyBingoItem(item, { amount: value });
        state.bingo.items = [...state.bingo.items, created];
        renderBingoDialog();
      } catch (err) {
        copy.disabled = false;
        toast(`Kopieren fehlgeschlagen: ${germanError(err)}`, 'error');
      }
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'prank-try prank-del';
    del.textContent = '🗑';
    del.setAttribute('aria-label', `„${item.name}“ löschen`);
    del.addEventListener('click', async () => {
      if (!confirm(`„${item.name}“ löschen? Auf der aktuellen Karte bleibt es stehen.`)) return;
      del.disabled = true;
      try {
        await state.api.deleteBingoItem(item);
        state.bingo.items = state.bingo.items.filter((x) => x.id !== item.id);
        renderBingoDialog();
      } catch (err) {
        del.disabled = false;
        toast(`Löschen fehlgeschlagen: ${germanError(err)}`, 'error');
      }
    });
    li.append(img, name, copy, del, rarity, amount);
    return li;
  }));
}

// ---------- Tipprunde: Zuschauer tippen mit Kanalpunkten, welche Reihe zuerst voll wird ----------
const clock = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

function paintBingoBet(bet, admin) {
  const open = bet?.status === 'active' && Date.parse(bet.lock_at) > Date.now();
  // Ende der Tippzeit: einmal neu zeichnen, damit der Text wechselt
  clearTimeout(state.bingo.betTimer);
  if (open) state.bingo.betTimer = setTimeout(() => $('#bingo-dialog').open && renderBingoDialog(), Date.parse(bet.lock_at) - Date.now() + 500);

  const note = $('#bingo-bet-note');
  let text = '';
  if (bet?.status === 'active') {
    text = open
      ? `🎯 Tipprunde läuft! Tippe bis ${clock(bet.lock_at)} Uhr in Daves Twitch-Chat mit deinen Kanalpunkten, welche Reihe zuerst voll wird – die Vorhersage steht oben im Chat. Wer richtig liegt, bekommt Punkte dazu.`
      : '🎯 Die Tipps sind abgegeben. Jetzt zählt, welche Reihe zuerst voll wird!';
  } else if (bet?.status === 'resolved') {
    text = `🎯 ${bet.winner_title ?? 'Eine Reihe'} war zuerst voll – wer darauf getippt hat, hat Kanalpunkte gewonnen.`;
  }
  note.textContent = text;
  note.hidden = !text;
  note.classList.toggle('is-won', bet?.status === 'resolved');

  if (!admin) return;
  const twitch = state.twitch ?? {};
  const running = bet?.status === 'active';
  let hint = '';
  if (!state.api.demo && !twitch.connected) hint = 'Dave muss zuerst Twitch verbinden (Twitch-Knopf oben).';
  else if (!state.api.demo && twitch.predictions_scope === false) hint = 'Für Tipprunden braucht die Seite eine neue Twitch-Berechtigung: Twitch-Knopf oben → „Neu verbinden“.';
  else if (!state.bingo.card) hint = 'Erst eine Karte ziehen.';
  $('#bingo-bet-start').hidden = running;
  $('#bingo-bet-btn').disabled = !!hint;
  $('#bingo-bet-cancel').hidden = !running;
  const stateEl = $('#bingo-bet-state');
  stateEl.textContent = running
    ? open
      ? `Läuft – getippt wird bis ${clock(bet.lock_at)} Uhr. Erst danach Items abhaken.`
      : 'Tipps sind zu. Die erste volle Reihe gewinnt – beim Abhaken wird automatisch aufgelöst.'
    : hint || (bet?.status === 'resolved' ? `Letzte Runde: ${bet.winner_title} hat gewonnen.` : bet?.status === 'canceled' ? 'Letzte Runde wurde abgebrochen.' : '');
  stateEl.hidden = !stateEl.textContent;
}

async function startBingoBet() {
  const btn = $('#bingo-bet-btn');
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    const { bet } = await state.api.bingoBet('start', Number($('#bingo-bet-seconds').value));
    if (state.bingo.card) state.bingo.card = { ...state.bingo.card, bet };
    toast('Tipprunde gestartet – die Vorhersage steht jetzt in Daves Twitch-Chat.', 'ok');
  } catch (err) {
    toast(germanError(err), 'error', 8000);
  } finally {
    btn.classList.remove('is-loading');
    renderBingoDialog();
  }
}

async function cancelBingoBet({ ask = true } = {}) {
  if (ask && !confirm('Tipprunde abbrechen? Alle bekommen ihre Kanalpunkte zurück.')) return false;
  try {
    const { bet } = await state.api.bingoBet('cancel');
    if (state.bingo.card) state.bingo.card = { ...state.bingo.card, bet };
    renderBingoDialog();
    return true;
  } catch (err) {
    toast(germanError(err), 'error', 8000);
    return false;
  }
}

// Nach dem Abhaken: Ist eine getippte Reihe voll, löst der Server die Vorhersage auf.
async function checkBingoBet(card) {
  const bet = card?.bet;
  if (bet?.status !== 'active') return;
  const keys = new Set(bet.outcomes.map((o) => o.key));
  if (!fullBetLines(card).some((l) => keys.has(l.key))) return;
  try {
    const { bet: next } = await state.api.bingoBet('check');
    if (state.bingo.card) state.bingo.card = { ...state.bingo.card, bet: next };
    if (next?.status === 'resolved') toast(`🎯 ${next.winner_title} gewinnt – die Kanalpunkte sind verteilt.`, 'ok', 6000);
    renderBingoDialog();
  } catch (err) {
    toast(`Tipprunde nicht aufgelöst: ${germanError(err)}`, 'error', 8000);
  }
}

// Neue Karte vom Server (live per Realtime) oder aus der eigenen Aktion
function applyBingoCard(card, stamped = null) {
  const before = state.bingo.lines;
  state.bingo.card = card;
  state.bingo.lines = bingoState(card).count;
  paintBingoTile();
  if ($('#bingo-dialog').open) renderBingoDialog({ stamped });
  if (state.bingo.lines > before && card?.marked?.length) celebrateBingo();
}

function celebrateBingo() {
  const win = $('#bingo-win');
  win.classList.remove('is-on');
  void win.offsetWidth;
  win.classList.add('is-on');
  if (!$('#bingo-dialog').open) toast('BINGO! Eine Reihe ist voll.', 'ok', 5000);
}

// Das Bild aus der aktuellen Liste – ein Admin kann Seltenheit und Zahl nachträglich ändern
function bingoItemOf(cell) {
  return state.bingo.items.find((i) => i.id === cell.id);
}

// ---------- Eigene Karte: selbst ziehen, selbst abkreuzen ----------
function renderMyBingo(stamped = null) {
  const { mine, items, on } = state.bingo;
  const grid = $('#my-bingo-grid');
  const empty = $('#my-bingo-empty');
  const st = bingoState(mine);
  grid.hidden = !mine;
  $('#my-bingo-status').textContent = mine
    ? `${st.done} von ${st.total} abgekreuzt${st.count ? ` · ${st.count}× Bingo!` : ''}`
    : '';
  $('#my-bingo-new').textContent = mine ? 'Neue Karte ziehen' : 'Karte ziehen';
  let text = '';
  if (!on) text = 'Das Bingo ist noch nicht eingerichtet.';
  else if (state.bingo.mineOn === false) text = 'Eigene Karten sind noch nicht eingerichtet (Migration …_channel_points.sql).';
  else if (!mine) text = items.length ? 'Zieh dir deine eigene Karte aus Daves Item-Bildern.' : 'Dave hat noch keine Item-Bilder hochgeladen.';
  empty.textContent = text;
  empty.hidden = !text;
  $('#my-bingo-new').disabled = !on || state.bingo.mineOn === false || !items.length;
  if (mine) {
    renderBingoGrid(grid, mine, { urlFor: (path) => state.api.bingoUrl(path), onCell: toggleMyBingo, stamped, itemOf: bingoItemOf });
  }
}

async function newMyBingo() {
  const { mine } = state.bingo;
  if (mine && bingoState(mine).done && !confirm('Neue Karte ziehen? Deine Kreuze gehen verloren.')) return;
  try {
    const card = drawCard(state.bingo.items, Number($('#my-bingo-size').value), $('#my-bingo-free').checked);
    state.bingo.mine = await state.api.saveMyBingo(card);
    renderBingoDialog();
  } catch (err) {
    toast(germanError(err), 'error', 6000);
  }
}

async function toggleMyBingo(index) {
  const before = state.bingo.mine;
  if (!before || before.cells[index]?.free) return;
  const marked = before.marked.includes(index) ? before.marked.filter((i) => i !== index) : [...before.marked, index];
  const next = { ...before, marked };
  // Sofort zeigen, im Hintergrund speichern – bei Fehler zurück
  state.bingo.mine = next;
  renderMyBingo(marked.includes(index) ? index : null);
  if (bingoState(next).count > bingoState(before).count) {
    const win = $('#my-bingo-win');
    win.classList.remove('is-on');
    void win.offsetWidth;
    win.classList.add('is-on');
    prankSfx()?.play('applause');
  }
  try {
    await state.api.saveMyBingo(next);
  } catch (err) {
    state.bingo.mine = before;
    renderMyBingo();
    toast(`Nicht gespeichert: ${germanError(err)}`, 'error');
  }
}

async function toggleBingoCell(index, node) {
  node.disabled = true;
  try {
    const card = await state.api.toggleBingo(index);
    applyBingoCard(card, card.marked.includes(index) ? index : null);
    checkBingoBet(card);
  } catch (err) {
    node.disabled = false;
    toast(germanError(err), 'error');
  }
}

async function newBingoCard() {
  const { card } = state.bingo;
  if (card?.bet?.status === 'active') {
    if (!confirm('Es läuft eine Tipprunde. Abbrechen (alle bekommen ihre Kanalpunkte zurück) und neue Karte ziehen?')) return;
    if (!(await cancelBingoBet({ ask: false }))) return;
  } else if (card && bingoState(card).done && !confirm('Neue Karte ziehen? Die Haken der aktuellen Karte gehen verloren.')) return;
  const btn = $('#bingo-new-btn');
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    const next = await state.api.newBingoCard(Number($('#bingo-size').value), $('#bingo-free').checked);
    state.bingo.lines = 0;
    applyBingoCard(next);
    toast('Neue Karte gezogen – sie ist jetzt auch im Stream zu sehen.', 'ok');
  } catch (err) {
    toast(germanError(err), 'error', 7000);
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

async function clearBingo() {
  const { card } = state.bingo;
  if (!card || !confirm('Alle Haken entfernen?')) return;
  const free = card.cells.flatMap((c, i) => (c.free ? [i] : []));
  await updateBingoCard({ marked: free });
}

async function updateBingoCard(patch) {
  try {
    const card = await state.api.updateBingoCard(patch);
    state.bingo.lines = bingoState(card).count;
    applyBingoCard(card);
  } catch (err) {
    toast(`Speichern fehlgeschlagen: ${germanError(err)}`, 'error');
    renderBingoDialog();
  }
}

async function uploadBingoImages(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const files = [...form.files.files];
  if (!files.length) return formMsg(form, 'Bitte zuerst Bilder wählen.');
  await withLoading(form, async () => {
    let done = 0;
    const failed = [];
    for (const file of files) {
      formMsg(form, `Lade ${done + 1} von ${files.length} hoch …`, true);
      try {
        const blob = await shrinkImage(file);
        const item = await state.api.addBingoItem(blob, nameFromFile(file.name), { rarity: rarityFromFile(file.name), amount: amountFromFile(file.name) });
        state.bingo.items = [...state.bingo.items, item];
        done++;
      } catch (err) {
        console.error(err);
        failed.push(`${file.name}: ${germanError(err)}`);
      }
    }
    form.reset();
    $('.sound-file-text', form).textContent = '🖼️ Bilder wählen … (mehrere gehen)';
    renderBingoDialog();
    if (failed.length) throw new Error(`${done} hochgeladen, ${failed.length} nicht: ${failed.join(' · ')}`);
    formMsg(form, `${done} ${done === 1 ? 'Bild' : 'Bilder'} hochgeladen.`, true);
  });
}

// ============================================================
// Kacheln für Fragen und Dino
// ============================================================
function buildActionTile(tile, i, { cls, cta, onClick }) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `tile tile--${tile.kind} theme-${tile.theme} ${cls ?? ''}`;
  el.style.setProperty('--i', i);
  el.dataset.id = tile.id;
  const bg = document.createElement('div');
  bg.className = 'tile-bg';
  const img = safeUrl(tile.background);
  if (img) bg.style.backgroundImage = `url(${JSON.stringify(img)})`;
  el.append(bg, div('tile-shade'), div('tile-shine'));
  const body = div('tile-body');
  const tag = document.createElement('span');
  tag.className = 'tile-tag';
  tag.textContent = 'Jederzeit · live';
  const title = document.createElement('h3');
  title.className = 'tile-title';
  title.textContent = tile.title;
  const desc = document.createElement('p');
  desc.className = 'tile-desc';
  desc.textContent = tile.description;
  const row = div('prank-tile-row');
  const status = document.createElement('span');
  status.className = 'tile-live-status';
  const go = document.createElement('span');
  go.className = 'prank-cta';
  go.textContent = cta;
  row.append(status, go);
  body.append(tag, title, desc, ...[startNote(tile)].filter(Boolean), row);
  el.append(body);
  el.addEventListener('click', onClick);
  if (finePointer && !reducedMotion) addTilt(el);
  return el;
}

function buildQuestionsTile(tile, i) {
  const el = buildActionTile(tile, i, { cls: 'tile--q', cta: 'Frage stellen →', onClick: openQuestions });
  paintQuestionsTile(el);
  return el;
}

function paintQuestionsTile(el = $('.tile--questions')) {
  const label = el?.querySelector('.tile-live-status');
  if (!label) return;
  const { stage, list, on } = state.questions;
  const pending = state.profile?.is_admin ? list.filter((q) => q.status === 'pending').length : 0;
  label.textContent = !on ? '❓ Frag Dave was'
    : stage?.state === 'ask' ? '🔴 Gerade im Stream'
      : pending ? `📝 ${pending} zu prüfen`
        : '❓ Frag Dave was';
}

function buildPetTile(tile, i) {
  const el = buildActionTile(tile, i, { cls: 'tile--dino', cta: 'Zum Dino →', onClick: openPet });
  const mini = document.createElement('span');
  mini.className = 'pet-tile-dino';
  mini.innerHTML = dinoSvg();
  el.querySelector('.tile-body').prepend(mini);
  paintPetTile(el);
  return el;
}

function paintPetTile(el = $('.tile--pet')) {
  const label = el?.querySelector('.tile-live-status');
  if (!label) return;
  const pet = state.pet.data;
  const hungry = state.pet.on && isHungry(pet);
  label.textContent = !state.pet.on ? '🦖 Wohnt im Stream' : hungry ? `🍖 ${pet.name} hat Hunger!` : `😊 ${pet.name} ist satt`;
  el.classList.toggle('is-hungry', hungry);
}

// ============================================================
// Win-Challenge
// ============================================================
function buildChallengeTile(tile, i) {
  const el = buildActionTile(tile, i, { cls: 'tile--challenge', cta: 'Zur Challenge →', onClick: openChallenge });
  paintChallengeTile(el);
  return el;
}

function paintChallengeTile(el = $('.tile--challenge')) {
  const label = el?.querySelector('.tile-live-status');
  if (label) label.textContent = challengeSummary(state.challenge.on ? state.challenge.data : null);
}

function setupChallenge() {
  $('#ch-win').addEventListener('click', () => challengeAction('result', true));
  $('#ch-loss').addEventListener('click', () => challengeAction('result', false));
  $('#ch-undo').addEventListener('click', () => challengeAction('undo'));
  $('#ch-skip').addEventListener('click', () => {
    const ch = state.challenge.data;
    if (ch.current >= ch.stages.length - 1) return toast('Das ist schon die letzte Stufe.', 'info');
    if (confirm(`Stufe ${ch.current + 1} überspringen? Sie zählt dann nicht als geschafft.`)) challengeAction('goto', ch.current + 1);
  });
  $('#ch-reset').addEventListener('click', () => {
    if (confirm('Challenge neu starten? Alle Siege, Niederlagen und Leben gehen auf Anfang.')) challengeAction('reset');
  });
  $('#ch-form').addEventListener('submit', saveChallengeForm);
  $('#ch-form').addEventListener('input', () => { state.challenge.editing = true; });
  document.querySelectorAll('[data-ch-add]').forEach((b) => b.addEventListener('click', () => {
    const kind = b.dataset.chAdd;
    const list = readChallengeEdit();
    if (list.length >= 30) return toast('Höchstens 30 Stufen.', 'info');
    list.push({ id: '', kind, title: '', opponent: '', target: kind === 'round' ? 3 : kind === 'fight' ? 2 : 1 });
    state.challenge.editing = true;
    renderChallengeEdit(list);
    $('#ch-edit').lastElementChild?.querySelector('input[name="title"]')?.focus();
  }));
  $('#ch-allow').addEventListener('change', async (e) => {
    try {
      state.challenge.data = await state.api.challengeAllowAdmins(e.target.checked);
      state.challenge.access.admins_can_edit = e.target.checked;
      toast(e.target.checked ? 'Die Admins dürfen jetzt Ergebnisse eintragen.' : 'Nur du trägst ein.', 'ok');
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(germanError(err), 'error');
    }
  });
  $('#ch-dialog').addEventListener('close', () => $('#ch-fx').replaceChildren());
}

async function loadChallenge() {
  const c = state.challenge;
  try {
    const [data, access] = await Promise.all([
      state.api.getChallenge(),
      state.user ? state.api.challengeAccess().catch(() => null) : null,
    ]);
    Object.assign(c, { data, on: !!data, error: '' });
    if (access) c.access = access;
    if (c.access.can_edit && !c.mods.length) c.mods = await state.api.getModNames().catch(() => []);
  } catch (err) {
    console.warn('Win-Challenge nicht verfügbar:', err);
    Object.assign(c, { on: false, error: germanError(err) });
  }
  if (c.on && !c.subscribed) {
    c.subscribed = true;
    state.api.onChallenge(applyChallenge);
  }
  paintChallengeTile();
}

// Neuer Stand (eigener Klick oder Realtime): bei neuem Ereignis den Effekt zeigen
function applyChallenge(next) {
  if (!next) return;
  const before = state.challenge.data;
  state.challenge.data = next;
  const ev = next.last_event;
  if (before && ev?.n && ev.n !== before.last_event?.n && $('#ch-dialog').open) {
    challengeBurst($('#ch-fx'), ev, next, { sfx: prankSfx(true) });
  }
  paintChallengeTile();
  if ($('#ch-dialog').open) renderChallenge({ changed: before });
}

async function openChallenge() {
  const tile = tileByKind('challenge');
  if (tile && isLocked(tile)) { openTile(tile.id); return; }
  state.challenge.editing = false;
  renderChallenge();
  $('#ch-dialog').showModal();
  await loadChallenge();
  renderChallenge();
}

function renderChallenge({ changed = null } = {}) {
  const c = state.challenge;
  const ch = c.data;
  const canEdit = !!c.access.can_edit && c.on;
  const note = $('#ch-note');
  note.hidden = c.on;
  note.textContent = c.on ? '' : state.profile?.is_admin
    ? (c.error || 'Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20261003000000_win_challenge.sql ausführen.')
    : 'Die Win-Challenge ist noch nicht eingerichtet.';
  $('#ch-dialog').classList.toggle('has-side', canEdit);
  $('#ch-side').hidden = !canEdit;
  $('#ch-controls').hidden = !canEdit;
  $('#ch-viewer').hidden = canEdit || !c.on;
  if (!ch) return;
  $('#ch-title').textContent = ch.title;

  // Kopf: Stand, Leben, Fortschritt
  const done = doneCount(ch);
  const hero = $('#ch-hero');
  hero.classList.toggle('is-won', ch.status === 'won');
  hero.classList.toggle('is-failed', ch.status === 'failed');
  $('#ch-status').textContent = {
    ready: '🎯 Bereit – der erste Sieg startet die Challenge',
    running: `🔥 Stufe ${Math.min(ch.current + 1, ch.stages.length)} von ${ch.stages.length}`,
    won: '🏆 Challenge geschafft!',
    failed: '💀 Gescheitert – keine Leben mehr',
  }[ch.status];
  const hearts = $('#ch-hearts');
  hearts.innerHTML = heartsHtml(ch);
  if (changed && ch.lives && changed.lives_left > ch.lives_left) hearts.children[ch.lives_left]?.classList.add('is-breaking');
  $('#ch-progress').style.width = `${Math.round((done / ch.stages.length) * 100)}%`;
  const losses = ch.stages.reduce((n, s) => n + s.losses, 0);
  const wins = ch.stages.reduce((n, s) => n + s.wins, 0);
  $('#ch-progress-text').textContent = `${done} von ${ch.stages.length} Stufen geschafft · ${wins} Siege · ${losses} Niederlagen${ch.lives ? '' : ' · ohne Leben'}`;

  // Knöpfe
  const over = ch.status === 'won' || ch.status === 'failed';
  const stage = currentStage(ch);
  $('#ch-now').innerHTML = '';
  if (over) {
    $('#ch-now').textContent = ch.status === 'won' ? 'Geschafft! Mit „Neu starten“ geht es von vorn los.' : 'Vorbei. „Rückgängig“ holt die letzte Niederlage zurück, „Neu starten“ fängt von vorn an.';
  } else {
    const b = document.createElement('span');
    b.textContent = `${KINDS[stage.kind].icon} Jetzt: ${stageLabel(stage)}`;
    const small = document.createElement('small');
    small.textContent = `${stage.wins} von ${stage.target} Siegen${stage.losses ? ` · ${stage.losses} Niederlage${stage.losses === 1 ? '' : 'n'}` : ''}`;
    $('#ch-now').append(b, small);
  }
  $('#ch-win').disabled = over;
  $('#ch-loss').disabled = over;
  $('#ch-undo').disabled = !ch.history?.length;
  $('#ch-skip').disabled = over || ch.current >= ch.stages.length - 1;
  $('#ch-reset').disabled = false;

  // Die Leiter
  $('#ch-ladder').replaceChildren(...ch.stages.map((s, i) => {
    const li = document.createElement('li');
    const active = i === ch.current && !over;
    li.className = `ch-stage${stageDone(s) ? ' is-done' : active ? ' is-active' : i > ch.current ? ' is-next' : ' is-skipped'}`;
    li.innerHTML = `<span class="ch-stage-no">${i + 1}</span><span class="ch-stage-icon" aria-hidden="true">${KINDS[s.kind].icon}</span>
      <span class="ch-stage-name"><b></b><small></small></span>
      <span class="ch-stage-score"><span class="ch-pips">${pipsHtml(s)}</span><small></small></span>`;
    li.querySelector('b').textContent = s.title;
    const small = li.querySelector('.ch-stage-name small');
    small.textContent = KINDS[s.kind].name;
    if (s.kind === 'fight' && s.opponent) {
      const vs = document.createElement('span');
      vs.className = 'ch-vs';
      vs.textContent = ` · vs ${s.opponent}`;
      small.append(vs);
    }
    li.querySelector('.ch-stage-score small').textContent = s.losses ? `${s.losses}× verloren` : '';
    // Neuer Sieg: Punkt springt auf
    const prev = changed?.stages?.find((x) => x.id === s.id);
    if (prev && s.wins > prev.wins) li.querySelectorAll('.ch-pip.is-on')[s.wins - 1]?.classList.add('is-pop');
    if (canEdit && i !== ch.current) {
      li.classList.add('can-jump');
      li.title = 'Zu dieser Stufe springen';
      li.addEventListener('click', () => {
        if (confirm(`Zu Stufe ${i + 1} „${s.title}“ springen?`)) challengeAction('goto', i);
      });
    }
    return li;
  }));

  // Einrichten (nur wenn nicht gerade bearbeitet)
  if (canEdit) {
    const f = $('#ch-form');
    if (!c.editing) {
      f.ch_title.value = ch.title;
      f.lives.value = ch.lives;
      renderChallengeEdit(ch.stages);
    }
    $('#ch-mods').replaceChildren(...c.mods.map((name) => Object.assign(document.createElement('option'), { value: name })));
    $('#ch-allow-wrap').hidden = !c.access.is_owner;
    if (state.profile?.is_admin) paintTileStart('challenge');
    $('#ch-start').hidden = !state.profile?.is_admin;
    $('#ch-allow').checked = !!ch.admins_can_edit;
  }
}

function renderChallengeEdit(stages) {
  $('#ch-edit').replaceChildren(...stages.map((s, i, all) => {
    const li = document.createElement('li');
    li.dataset.id = s.id ?? '';
    li.innerHTML = `<select name="kind" aria-label="Art">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v.icon} ${v.name}</option>`).join('')}</select>
      <input type="text" name="title" maxlength="60" placeholder="z. B. Gewinne ein Solo-Game" aria-label="Aufgabe">
      <input type="number" name="target" min="1" max="99" step="1" aria-label="Siege nötig" title="Siege nötig">
      <span class="ch-edit-tools">
        <button type="button" data-move="-1" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-move="1" aria-label="Nach unten" ${i === all.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" data-remove aria-label="Entfernen">✕</button>
      </span>
      <input type="text" name="opponent" class="ch-edit-opp" maxlength="30" list="ch-mods" placeholder="Gegner (Mod)" aria-label="Gegner">`;
    li.querySelector('[name="kind"]').value = s.kind;
    li.querySelector('[name="title"]').value = s.title ?? '';
    li.querySelector('[name="target"]').value = s.target ?? 1;
    const opp = li.querySelector('[name="opponent"]');
    opp.value = s.opponent ?? '';
    opp.hidden = s.kind !== 'fight';
    li.querySelector('[name="kind"]').addEventListener('change', (e) => { opp.hidden = e.target.value !== 'fight'; });
    li.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
      const list = readChallengeEdit();
      const j = i + Number(b.dataset.move);
      [list[i], list[j]] = [list[j], list[i]];
      state.challenge.editing = true;
      renderChallengeEdit(list);
    }));
    li.querySelector('[data-remove]').addEventListener('click', () => {
      const list = readChallengeEdit();
      if (list.length <= 1) return toast('Mindestens eine Stufe braucht die Challenge.', 'info');
      list.splice(i, 1);
      state.challenge.editing = true;
      renderChallengeEdit(list);
    });
    return li;
  }));
}

function readChallengeEdit() {
  return [...$('#ch-edit').children].map((li) => ({
    id: li.dataset.id,
    kind: li.querySelector('[name="kind"]').value,
    title: li.querySelector('[name="title"]').value.trim(),
    opponent: li.querySelector('[name="opponent"]').value.trim(),
    target: Math.round(Number(li.querySelector('[name="target"]').value)) || 1,
  }));
}

async function saveChallengeForm(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const stages = readChallengeEdit();
  const lives = Math.round(Number(form.lives.value));
  if (!stages.length) return formMsg(form, 'Mindestens eine Stufe braucht die Challenge.');
  if (!(lives >= 0 && lives <= 10)) return formMsg(form, 'Leben: 0 bis 10.');
  if (stages.some((s) => !s.title)) return formMsg(form, 'Jede Stufe braucht eine Aufgabe.');
  if (stages.some((s) => s.target < 1 || s.target > 99)) return formMsg(form, 'Siege nötig: 1 bis 99.');
  await withLoading(form, async () => {
    const next = await state.api.saveChallenge({ title: form.ch_title.value.trim(), lives, stages });
    state.challenge.editing = false;
    applyChallenge(next);
    formMsg(form, 'Gespeichert – läuft so auch im Stream.', true);
  });
}

async function challengeAction(kind, arg) {
  const buttons = ['#ch-win', '#ch-loss', '#ch-undo', '#ch-skip', '#ch-reset'].map((sel) => $(sel));
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const api = state.api;
    const next = kind === 'result' ? await api.challengeResult(arg)
      : kind === 'undo' ? await api.challengeUndo()
        : kind === 'goto' ? await api.challengeGoto(arg)
          : await api.challengeReset();
    applyChallenge(next);
  } catch (err) {
    toast(germanError(err), 'error');
    renderChallenge();
  }
}

// ============================================================
// Kisten-Shop
// ============================================================
function buildShopTile(tile, i) {
  const el = buildActionTile(tile, i, { cls: 'tile--loot', cta: 'Kiste wählen →', onClick: openShop });
  paintShopTile(el);
  return el;
}

function paintShopTile(el = $('.tile--shop')) {
  const label = el?.querySelector('.tile-live-status');
  if (!label) return;
  const run = state.shop.run;
  label.textContent = !run || run.status === 'done'
    ? '🧰 4 Kisten warten'
    : {
      waiting: '👥 Im Koop-Warteraum',
      choosing: '🧰 Koop: Kiste schnappen!',
      opened: '🧰 Koop: Kisten werden verteilt',
      shopping: '🛒 Einkauf läuft',
    }[run.status] ?? `🎯 ${run.items.filter((x) => x.found).length} von ${run.items.length} gefunden`;
}

function setupShop() {
  document.querySelectorAll('[data-shop-mode]').forEach((b) => b.addEventListener('click', () => {
    state.shop.mode = b.dataset.shopMode;
    loadShopRun().then(renderShop);
  }));
  $('#shop-lobby-create').addEventListener('click', createShopLobby);
  $('#shop-join-form').addEventListener('submit', joinShopLobby);
  $('#shop-lobby-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.shop.lobby.code); toast('Code kopiert – schick ihn deinen Mitspielern.', 'ok'); } catch { /* egal */ }
  });
  $('#shop-lobby-close').addEventListener('click', closeShopLobby);
  $('#shop-lobby-leave').addEventListener('click', leaveShopLobby);
  $('#shop-lobby-start').addEventListener('click', startShopLobby);
  $('#shop-done').addEventListener('click', () => shopDoneShopping());
  $('#shop-finish').addEventListener('click', shopFinish);
  $('#shop-new').addEventListener('click', () => {
    Object.assign(state.shop, { run: null, chests: null });
    renderShop();
  });
  $('#shop-settings').addEventListener('submit', saveShopSettings);
  $('#shop-dialog').addEventListener('close', () => {
    clearInterval(state.shop.timer);
    clearInterval(state.shop.poll);
    $('#shop-fx').replaceChildren();
  });
}

async function loadShop() {
  try {
    state.shop.settings = (await state.api.getShopSettings()) ?? DEFAULT_SHOP;
    state.shop.on = true;
    await loadShopRun();
  } catch (err) {
    console.warn('Kisten-Shop nicht verfügbar:', err);
    Object.assign(state.shop, { on: false, error: germanError(err) });
  }
  if (state.shop.on && !state.shop.subscribed) {
    state.shop.subscribed = true;
    state.api.onShopRuns((row) => {
      // Koop: Jede Änderung einer Runde kann die Phase wechseln – alles neu laden
      if (state.shop.lobby && (!row || row.lobby_id === state.shop.lobby.id)) { refreshLobby(); return; }
      if (!row) return;
      if (row.user_id === state.user?.id && row.id === state.shop.run?.id) state.shop.run = row;
      paintShopTile();
      if ($('#shop-dialog').open) renderShop({ keepItems: true });
    });
  }
  paintShopTile();
}

// Die passende Runde: allein die letzte eigene, im Koop die in dieser Runde
async function loadShopRun() {
  const { mode } = state.shop;
  if (mode === 'koop') {
    if (!state.shop.lobby) {
      let saved = null;
      try { saved = localStorage.getItem(lobbyKey()); } catch { /* egal */ }
      if (saved) state.shop.lobby = await state.api.getShopLobbyById(saved).catch(() => null);
    }
    if (!state.shop.lobby) { state.shop.run = null; state.shop.lobbyRuns = []; return; }
    state.shop.lobbyRuns = await state.api.getLobbyRuns(state.shop.lobby.id);
    state.shop.run = state.shop.lobbyRuns.find((r) => r.user_id === state.user?.id) ?? null;
    // Nicht (mehr) dabei, z. B. vor dem Start rausgegangen: wieder Code eingeben
    if (!state.shop.run) rememberLobby(null);
  } else {
    const run = await state.api.getMyShopRun();
    state.shop.run = run && !run.lobby_id ? run : null;
    state.shop.lobbyRuns = [];
  }
  if (state.shop.run?.id !== state.shop.chestsFor) state.shop.chests = null;
}

// Koop: Runde und Mitspieler neu laden (Änderungen kommen oft kurz hintereinander)
async function refreshLobby() {
  const s = state.shop;
  if (!s.lobby) return;
  if (s.refreshing) { s.refreshAgain = true; return; }
  s.refreshing = true;
  try {
    const id = s.lobby.id;
    const [lobby, runs] = await Promise.all([state.api.getShopLobbyById(id), state.api.getLobbyRuns(id)]);
    if (s.lobby?.id === id) {
      s.lobby = lobby ?? s.lobby;
      s.lobbyRuns = runs;
      s.run = runs.find((r) => r.user_id === state.user?.id) ?? null;
      paintShopTile();
      if ($('#shop-dialog').open && s.mode === 'koop') renderShop({ keepItems: true });
    }
  } catch (err) {
    console.warn('Koop-Runde nicht geladen:', err);
  } finally {
    s.refreshing = false;
    if (s.refreshAgain) { s.refreshAgain = false; refreshLobby(); }
  }
}

// Läuft im Koop eine Zeit ab, stößt jeder Mitspieler die nächste Phase an
async function tickLobby() {
  const s = state.shop;
  if (!s.lobby || Date.now() - (s.lastTick ?? 0) < 2500) return;
  s.lastTick = Date.now();
  try {
    s.lobby = await state.api.tickShopLobby(s.lobby.code);
  } catch (err) {
    console.warn('Koop-Runde: nächste Phase', err);
  }
  refreshLobby();
}

function koopPhase(lobby) {
  if (!lobby) return null;
  if (!lobby.started_at) return lobby.ended_at || !lobby.open ? 'cancelled' : 'lobby';
  if (!lobby.shop_until) return 'chests';
  if (!lobby.vs_at) return 'shop';
  return lobby.ended_at ? 'end' : 'vs';
}

async function openShop() {
  const tile = tileByKind('shop');
  if (tile && isLocked(tile)) { openTile(tile.id); return; }
  renderShop();
  $('#shop-dialog').showModal();
  await loadShop();
  renderShop();
}

function shopImage(name) {
  const hit = state.bingo.items.find((i) => i.name.toLowerCase() === name.toLowerCase());
  return hit ? state.api.bingoUrl(hit.path) : null;
}

const secsLeft = (until) => Math.max(0, Math.ceil((Date.parse(until) - Date.now()) / 1000));
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const namesOf = (runs) => runs.map((r) => r.player).join(', ');
const seenOnce = (key, id) => {
  key = `${key}_${state.user?.id ?? ''}`;
  try {
    if (localStorage.getItem(key) === String(id)) return true;
    localStorage.setItem(key, String(id));
  } catch { /* ohne Speicher: jedes Mal */ }
  return false;
};

function renderShop({ keepItems = false } = {}) {
  const s = state.shop;
  const { on, run, mode, lobby, settings } = s;
  const admin = !!state.profile?.is_admin;
  const note = $('#shop-note');
  note.textContent = on ? '' : admin
    ? (s.error || 'Einmal nötig: In Supabase im SQL Editor die Dateien supabase/migrations/20261001000000_loot_shop.sql und 20261002000000_shop_versus.sql ausführen.')
    : 'Der Kisten-Shop ist noch nicht eingerichtet. Schau später noch mal vorbei.';
  note.hidden = on;
  const tabs = $('.shop-tabs');
  tabs.dataset.active = mode;
  tabs.querySelectorAll('[data-shop-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.shopMode === mode)));

  // Koop-Bereich
  const koop = mode === 'koop';
  const phase = koop ? koopPhase(lobby) : null;
  const host = !!lobby && lobby.host_id === state.user?.id;
  $('#shop-koop').hidden = !koop;
  $('#shop-koop-rules').hidden = !koop;
  $('#shop-koop-start').hidden = !!lobby;
  $('#shop-koop-info').hidden = !lobby;
  if (lobby) {
    $('#shop-lobby-code').textContent = lobby.code;
    $('#shop-lobby-host').textContent = `· eröffnet von ${lobby.host_name || 'jemandem'}${phase === 'cancelled' ? ' · abgebrochen' : phase === 'end' ? ' · vorbei' : ''}`;
    const close = $('#shop-lobby-close');
    close.hidden = !['lobby', 'chests', 'shop', 'vs'].includes(phase) || !(admin || host);
    close.textContent = phase === 'lobby' ? 'Abbrechen' : 'Duell beenden';
    $('#shop-lobby-leave').textContent = phase === 'lobby' && run ? 'Verlassen' : 'Andere Runde';
    // Der Ersteller bricht im Warteraum ab – „Verlassen“ wäre dasselbe
    $('#shop-lobby-leave').hidden = phase === 'lobby' && host;
    $('#shop-lobby-copy').hidden = phase !== 'lobby';
  }

  // Phasenwechsel im Koop: Kisten kurz aufgedeckt lassen, VS-Bildschirm, Sieger
  if (koop && lobby) {
    const before = s.koopPhase?.id === lobby.id ? s.koopPhase.phase : null;
    if (before === 'chests' && phase !== 'chests') {
      s.revealUntil = Date.now() + 2600;
      setTimeout(() => { if ($('#shop-dialog').open) renderShop(); }, 2700);
      prankSfx(true)?.hit('bling');
    }
    s.koopPhase = { id: lobby.id, phase };
    const open = $('#shop-dialog').open;
    if (open && run && phase === 'vs' && !seenOnce('zd_shop_vs_seen', lobby.id)) {
      versusIntro($('#shop-fx'), s.lobbyRuns, { sfx: prankSfx(true) });
    }
    if (open && run && phase === 'end' && !seenOnce('zd_shop_win_seen', lobby.id)) {
      $('#shop-fx').replaceChildren();
      versusWinner($('#shop-fx'), s.lobbyRuns, { sfx: prankSfx(true), me: state.user?.id });
    }
  }

  const needsLobby = koop && !lobby;
  let step = null;
  if (on && !needsLobby) {
    if (!koop) step = !run ? 'chests' : run.status === 'shopping' ? 'shop' : 'play';
    else if (!run || phase === 'lobby' || phase === 'cancelled') step = 'lobby';
    else if (phase === 'chests' || Date.now() < (s.revealUntil ?? 0)) step = 'chests';
    else step = run.status === 'shopping' ? 'shop' : 'play';
  }
  $('#shop-step-lobby').hidden = step !== 'lobby';
  $('#shop-step-chests').hidden = step !== 'chests';
  $('#shop-step-shop').hidden = step !== 'shop';
  $('#shop-step-play').hidden = step !== 'play';
  $('#shop-stream-wrap').hidden = !admin || (koop && run?.status !== 'choosing');

  clearInterval(s.timer);
  if (step === 'lobby') renderShopLobby(phase, host);
  if (step === 'chests') renderChests();
  if (step === 'shop') {
    if (!keepItems || !$('#shop-items').children.length) renderShopItems();
    else paintShopItems();
    startShopTimer();
  }
  if (step === 'play') renderShopPlay(koop, phase);

  // Mitspieler im Koop
  $('#shop-board-box').hidden = !lobby || !koop;
  if (lobby && koop) renderShopBoard(phase);

  // Sicherheitsnetz, falls Realtime mal hängt
  clearInterval(s.poll);
  if (koop && lobby && $('#shop-dialog').open && !['cancelled', 'end'].includes(phase)) s.poll = setInterval(refreshLobby, 5000);

  // Admin-Einstellungen
  $('#shop-admin').hidden = !(admin && on);
  $('#shop-dialog').classList.toggle('has-side', (admin && on) || (koop && !!lobby));
  paintTileStart('shop');
  if (admin && on) fillShopSettings(settings ?? DEFAULT_SHOP);
  paintShopTile();
}

// Warteraum: Wer ist drin, der Ersteller startet
function renderShopLobby(phase, host) {
  const { lobby, lobbyRuns, run } = state.shop;
  const list = versusOrder(lobbyRuns);
  $('#shop-players').replaceChildren(...list.map((r, i) => {
    const li = document.createElement('li');
    li.style.setProperty('--pc', PLAYER_COLORS[i % PLAYER_COLORS.length]);
    li.className = r.user_id === state.user?.id ? 'is-me' : '';
    const name = document.createElement('span');
    name.textContent = r.player;
    const tag = document.createElement('small');
    tag.textContent = [r.user_id === lobby.host_id ? '👑 eröffnet' : '', r.user_id === state.user?.id ? 'du' : ''].filter(Boolean).join(' · ');
    li.append(name, tag);
    return li;
  }), ...Array.from({ length: Math.max(0, 4 - list.length) }, () => {
    const li = document.createElement('li');
    li.className = 'is-free';
    li.textContent = phase === 'lobby' ? 'frei' : '–';
    return li;
  }));
  const status = $('#shop-lobby-status');
  const btn = $('#shop-lobby-start');
  btn.hidden = !(host && phase === 'lobby');
  btn.disabled = list.length < 2;
  btn.textContent = list.length < 2 ? 'Runde starten (ab 2 Spielern)' : `Runde starten (${list.length} Spieler)`;
  if (phase === 'cancelled') status.textContent = 'Diese Koop-Runde wurde abgebrochen.';
  else if (!run) status.textContent = 'Die Runde läuft schon – du bist nicht dabei.';
  else if (host) status.textContent = `${list.length} von 4 Spielern. Gib den Code weiter und starte, sobald alle da sind.`;
  else status.textContent = `Du bist drin! Warte, bis ${lobby.host_name || 'der Ersteller'} die Runde startet …`;
}

function renderShopPlay(koop, phase) {
  const { run, lobbyRuns, lobby } = state.shop;
  const vs = koop && ['vs', 'end'].includes(phase);
  const waiting = koop && phase === 'shop';
  renderLoadout($('#shop-loadout'), run, {
    onMark: run.status === 'playing' && (!koop || vs) ? shopMark : null,
    imageFor: shopImage,
  });
  const found = run.items.filter((x) => x.found).length;
  $('#shop-score').textContent = pointsText(scoreOf(run.items));
  $('#shop-play-title').textContent = run.status === 'done' && !vs
    ? `Runde vorbei: ${found} von ${run.items.length} gefunden${run.items.length && found === run.items.length ? ' – alle! +10' : ''}`
    : vs ? '3. Duell: Finde deine Items' : waiting ? 'Eingekauft!' : '3. Finde sie im Spiel';
  $('#shop-finish').hidden = run.status === 'done' || waiting;
  $('#shop-finish').textContent = koop ? 'Ich bin fertig' : 'Runde beenden';
  $('#shop-new').hidden = run.status !== 'done' || koop;

  const wait = $('#shop-play-wait');
  wait.hidden = !waiting;
  if (waiting) {
    const shopping = lobbyRuns.filter((r) => r.status === 'shopping');
    const paint = () => {
      const left = secsLeft(lobby.shop_until);
      wait.textContent = `⏳ Warte auf ${namesOf(shopping) || 'die anderen'} – ${shopping.length === 1 ? 'kauft' : 'kaufen'} noch ein (${mmss(left)}). Dann geht das Duell los!`;
      if (left <= 0) tickLobby();
    };
    paint();
    state.shop.timer = setInterval(paint, 500);
  }

  const box = $('#shop-vs');
  box.hidden = !vs;
  if (vs) {
    const winners = phase === 'end' ? winnersOf(lobbyRuns) : null;
    renderTug($('#shop-tug'), lobbyRuns, { me: state.user?.id, winners });
    const open = lobbyRuns.filter((r) => r.status !== 'done');
    $('#shop-vs-status').textContent = phase === 'end'
      ? (winners.length === 1 ? `🏆 ${winners[0].player} gewinnt!` : `🤝 Unentschieden: ${namesOf(winners)}`)
      : run.status === 'done'
        ? `Du bist fertig – warte auf ${namesOf(open)}.`
        : 'Jedes gefundene Item schiebt deine Seite rüber. Alle gefunden = +10!';
    box.classList.toggle('is-end', phase === 'end');
  }
}

function koopStatus(r, phase) {
  const found = `${r.items.filter((x) => x.found).length}/${r.items.length} gefunden`;
  return {
    waiting: 'wartet',
    choosing: 'wählt eine Kiste …',
    opened: `Kiste ${r.chest + 1}: ${r.coins} Barren`,
    shopping: 'kauft ein …',
    playing: phase === 'shop' ? 'fertig mit Einkaufen' : found,
    done: `${found} · fertig`,
  }[r.status] ?? '';
}

function renderShopBoard(phase) {
  const { lobbyRuns } = state.shop;
  const scored = ['vs', 'end'].includes(phase);
  $('#shop-board-title').textContent = scored ? 'Rangliste' : 'Spieler';
  const order = versusOrder(lobbyRuns);
  const runs = scored ? [...order].sort((a, b) => scoreOf(b.items) - scoreOf(a.items)) : order;
  const board = $('#shop-board');
  board.classList.toggle('is-ranked', scored);
  if (!runs.length) {
    const li = document.createElement('li');
    li.textContent = 'Noch niemand dabei.';
    board.replaceChildren(li);
    return;
  }
  board.replaceChildren(...runs.map((r) => {
    const li = document.createElement('li');
    li.style.setProperty('--pc', colorOf(lobbyRuns, r));
    if (r.user_id === state.user?.id) li.className = 'is-me';
    const who = document.createElement('span');
    who.textContent = r.player;
    const small = document.createElement('small');
    small.textContent = ` · ${koopStatus(r, phase)}`;
    who.append(small);
    const pts = document.createElement('b');
    pts.textContent = scored ? scoreOf(r.items) : '';
    li.append(who, pts);
    return li;
  }));
}

function renderChests() {
  const s = state.shop;
  const koop = s.mode === 'koop';
  const wrap = $('#shop-chests');
  const key = koop ? `koop-${s.lobby?.id}` : `solo-${s.run?.id ?? 'neu'}-${s.chests ? 1 : 0}`;
  if (wrap.dataset.key !== key || wrap.children.length !== 4) {
    wrap.dataset.key = key;
    wrap.replaceChildren(...[0, 1, 2, 3].map((i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chest';
      b.innerHTML = `${chestSvg()}<span class="chest-label">Kiste ${i + 1}</span><span class="chest-value"></span>`;
      b.addEventListener('click', () => openChest(i, b));
      return b;
    }));
  }
  const buttons = [...wrap.children];
  const timer = $('#shop-chest-timer');
  const status = $('#shop-chest-status');
  if (!koop) {
    timer.hidden = true;
    status.hidden = true;
    buttons.forEach((b, i) => {
      b.disabled = !!s.chests;
      if (s.chests) {
        b.classList.add('is-open', i === s.run?.chest ? 'is-picked' : 'is-other');
        b.querySelector('.chest-value').innerHTML = `${s.chests[i]} ${GOLD}`;
      }
    });
    return;
  }
  // Koop: Jede Kiste gehört dem, der sie zuerst öffnet – alle sehen wer und wie viel
  const { lobby, lobbyRuns, run } = s;
  const mine = run?.chest != null;
  buttons.forEach((b, i) => {
    const owner = lobbyRuns.find((r) => r.chest === i);
    const revealed = !owner && lobby.chests;
    b.disabled = !!owner || mine || !!revealed || run?.status !== 'choosing';
    b.classList.toggle('is-open', !!owner || !!revealed);
    b.classList.toggle('is-picked', !!owner && owner.id === run?.id);
    b.classList.toggle('is-taken', !!owner && owner.id !== run?.id);
    b.classList.toggle('is-other', !!revealed);
    b.style.setProperty('--pc', owner ? colorOf(lobbyRuns, owner) : '');
    b.querySelector('.chest-label').textContent = owner ? `${owner.id === run?.id ? 'Deine' : owner.player}` : `Kiste ${i + 1}`;
    const value = owner ? owner.coins : revealed ? lobby.chests[i] : null;
    b.querySelector('.chest-value').innerHTML = value != null ? `${value} ${GOLD}` : '';
    if (owner && b.dataset.owner !== String(owner.id)) {
      b.dataset.owner = owner.id;
      if (owner.id !== run?.id) prankSfx(true)?.hit('tink');
    }
  });
  const choosing = lobbyRuns.filter((r) => r.status === 'choosing');
  status.hidden = false;
  status.textContent = lobby.chests
    ? 'Alle haben ihre Kiste – ab in den Shop!'
    : mine
      ? `Du hast ${run.coins} Goldbarren! Warte auf ${namesOf(choosing) || 'die anderen'} …`
      : 'Schnapp dir eine Kiste, bevor es ein anderer tut! Wer nicht wählt, bekommt am Ende eine übrige.';
  timer.hidden = !!lobby.chests;
  const paint = () => {
    const left = secsLeft(lobby.chests_until);
    timer.textContent = `⏱ ${mmss(left)}`;
    timer.classList.toggle('is-low', left <= 10);
    if (left <= 0 && !lobby.chests) tickLobby();
  };
  if (!lobby.chests) {
    paint();
    s.timer = setInterval(paint, 500);
  }
}

async function openChest(i, btn) {
  const koop = state.shop.mode === 'koop';
  const buttons = [...$('#shop-chests').children];
  buttons.forEach((b) => { b.disabled = true; });
  btn.classList.add('is-shaking');
  try {
    const stream = !!state.profile?.is_admin && $('#shop-stream').checked;
    const code = koop ? state.shop.lobby?.code : null;
    const [res] = await Promise.all([state.api.openChest(i, code, stream), new Promise((r) => setTimeout(r, 500))]);
    btn.classList.remove('is-shaking');
    prankSfx(true)?.hit('bling');
    if (koop) {
      state.shop.run = res.run;
      state.shop.lobbyRuns = [...state.shop.lobbyRuns.filter((r) => r.id !== res.run.id), res.run];
      toast(`${res.run.coins} Goldbarren gehören dir!`, 'ok');
      renderShop();
      refreshLobby();
      return;
    }
    Object.assign(state.shop, { run: res.run, chests: res.chests, chestsFor: res.run.id });
    // Aufdecken: gewählte Kiste zuerst, dann die anderen
    buttons.forEach((b, n) => {
      setTimeout(() => {
        b.classList.add('is-open', n === i ? 'is-picked' : 'is-other');
        b.querySelector('.chest-value').innerHTML = `${res.chests[n]} ${GOLD}`;
      }, n === i ? 0 : 500 + n * 120);
    });
    toast(`${res.run.coins} Goldbarren! Ab in den Shop – die Zeit läuft.`, 'ok');
    setTimeout(() => { if ($('#shop-dialog').open) renderShop(); }, 1900);
    paintShopTile();
  } catch (err) {
    btn.classList.remove('is-shaking');
    toast(germanError(err), 'error', 6000);
    if (koop) refreshLobby();
    else buttons.forEach((b) => { b.disabled = false; });
  }
}

function renderShopItems() {
  const list = $('#shop-items');
  const settings = state.shop.settings ?? DEFAULT_SHOP;
  list.replaceChildren(...sortByRarity(settings.items).map((item) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `shop-item rar-${item.rarity}`;
    b.dataset.name = item.name;
    b.dataset.price = priceOf(item, settings.prices);
    const icon = document.createElement('span');
    icon.className = 'shop-item-icon';
    const img = shopImage(item.name);
    if (img) {
      const pic = document.createElement('img');
      pic.src = img;
      pic.alt = '';
      icon.append(pic);
    } else {
      icon.textContent = itemIcon(item.name);
    }
    const name = document.createElement('span');
    name.className = 'shop-item-name';
    name.textContent = item.name;
    const price = document.createElement('span');
    price.className = 'shop-item-price';
    price.innerHTML = `${b.dataset.price} ${GOLD}`;
    b.append(icon, name, price);
    b.addEventListener('click', () => shopBuy(item.name, b));
    li.append(b);
    return li;
  }));
  paintShopItems();
}

function paintShopItems() {
  const { run } = state.shop;
  if (!run) return;
  const left = coinsLeft(run);
  $('#shop-coins').innerHTML = `${left} ${GOLD} <small>von ${run.coins}</small>`;
  const bought = new Set(run.items.map((i) => i.name.toLowerCase()));
  $('#shop-items').querySelectorAll('.shop-item').forEach((b) => {
    const has = bought.has(b.dataset.name.toLowerCase());
    b.classList.toggle('is-bought', has);
    b.disabled = has || Number(b.dataset.price) > left;
  });
}

function startShopTimer() {
  clearInterval(state.shop.timer);
  const tick = () => {
    const run = state.shop.run;
    if (!run || run.status !== 'shopping') { clearInterval(state.shop.timer); return; }
    const ms = Date.parse(run.shop_until) - Date.now();
    const s = Math.max(0, Math.ceil(ms / 1000));
    const el = $('#shop-timer');
    el.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.classList.toggle('is-low', s <= 10);
    if (ms <= 0) {
      clearInterval(state.shop.timer);
      shopDoneShopping(true);
      if (state.shop.mode === 'koop') tickLobby();
    }
  };
  tick();
  state.shop.timer = setInterval(tick, 250);
}

async function shopBuy(name, btn) {
  btn.disabled = true;
  try {
    state.shop.run = await state.api.shopBuy(state.shop.run.id, name);
    prankSfx(true)?.hit('bling');
    paintShopItems();
  } catch (err) {
    toast(germanError(err), 'error');
    paintShopItems();
  }
}

async function shopDoneShopping(timeUp = false) {
  if (!state.shop.run || state.shop.run.status !== 'shopping') return;
  const koop = !!state.shop.run.lobby_id;
  try {
    state.shop.run = await state.api.shopDoneShopping(state.shop.run.id);
    if (timeUp) toast(koop ? 'Die Zeit im Shop ist um!' : 'Die Zeit im Shop ist um! Jetzt die Items im Spiel finden.', 'ok');
  } catch (err) {
    toast(germanError(err), 'error');
  }
  if (koop) syncMyLobbyRun();
  renderShop();
  if (koop) refreshLobby();
}

// Eigene Koop-Runde sofort in der Liste der Mitspieler aktualisieren (Tauziehen)
function syncMyLobbyRun() {
  const { run } = state.shop;
  if (run?.lobby_id) state.shop.lobbyRuns = state.shop.lobbyRuns.map((r) => (r.id === run.id ? run : r));
}

async function shopMark(index, found, btn) {
  btn.disabled = true;
  try {
    state.shop.run = await state.api.shopMark(state.shop.run.id, index, found);
    const r = state.shop.run;
    if (found && r.items.length && r.items.every((x) => x.found)) toast('Alle Items gefunden – 10 Punkte extra!', 'ok', 6000);
    if (found && r.lobby_id) prankSfx(true)?.hit('slap');
    syncMyLobbyRun();
  } catch (err) {
    toast(germanError(err), 'error');
  }
  renderShop();
}

async function shopFinish() {
  const koop = !!state.shop.run.lobby_id;
  if (!confirm(koop
    ? 'Bist du fertig? Danach lässt sich nichts mehr abhaken. Sind alle fertig, steht der Sieger fest.'
    : 'Runde beenden? Danach lässt sich nichts mehr abhaken.')) return;
  try {
    state.shop.run = await state.api.shopFinish(state.shop.run.id);
    if (!koop) toast(`Runde vorbei: ${pointsText(state.shop.run.score)}.`, 'ok', 6000);
  } catch (err) {
    toast(germanError(err), 'error');
  }
  syncMyLobbyRun();
  renderShop();
  if (koop) refreshLobby();
}

// Die Koop-Runde merkt sich der Browser je Nutzer
const lobbyKey = () => `zd_shop_lobby_${state.user?.id ?? ''}`;
function rememberLobby(lobby) {
  Object.assign(state.shop, { lobby, run: null, chests: null, lobbyRuns: [], revealUntil: 0 });
  try {
    if (lobby) localStorage.setItem(lobbyKey(), lobby.id);
    else localStorage.removeItem(lobbyKey());
  } catch { /* egal */ }
}

async function createShopLobby() {
  const btn = $('#shop-lobby-create');
  btn.disabled = true;
  try {
    rememberLobby(await state.api.createShopLobby());
    await loadShopRun();
    toast(`Koop-Runde ${state.shop.lobby.code} eröffnet – gib den Code deinen Mitspielern.`, 'ok', 6000);
  } catch (err) {
    toast(germanError(err), 'error');
  } finally {
    btn.disabled = false;
  }
  renderShop();
}

async function joinShopLobby(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const code = form.code.value.trim().toUpperCase();
  if (!/^[A-Z2-9]{5}$/.test(code)) return formMsg(form, 'Der Code hat 5 Zeichen.');
  await withLoading(form, async () => {
    await state.api.joinShopLobby(code);
    const lobby = await state.api.getShopLobby(code);
    if (!lobby) throw new Error('Diese Koop-Runde gibt es nicht. Code prüfen.');
    rememberLobby(lobby);
    form.reset();
    await loadShopRun();
    renderShop();
  });
}

async function startShopLobby() {
  const btn = $('#shop-lobby-start');
  btn.disabled = true;
  try {
    state.shop.lobby = await state.api.startShopLobby(state.shop.lobby.code);
    toast('Los geht’s – schnappt euch die Kisten!', 'ok');
  } catch (err) {
    toast(germanError(err), 'error');
  }
  await refreshLobby();
  renderShop();
}

async function closeShopLobby() {
  const phase = koopPhase(state.shop.lobby);
  if (!confirm(phase === 'lobby'
    ? 'Koop-Runde abbrechen? Alle im Warteraum fliegen raus.'
    : 'Duell jetzt beenden? Dann zählt der aktuelle Stand und der Sieger steht fest.')) return;
  try {
    state.shop.lobby = await state.api.closeShopLobby(state.shop.lobby.code);
  } catch (err) {
    toast(germanError(err), 'error');
  }
  await refreshLobby();
  renderShop();
}

async function leaveShopLobby() {
  const { lobby, run } = state.shop;
  const phase = koopPhase(lobby);
  if (phase === 'lobby' && run) {
    const host = lobby.host_id === state.user?.id;
    if (host && !confirm('Du hast die Runde eröffnet – gehst du, ist sie für alle vorbei. Trotzdem gehen?')) return;
    try {
      await state.api.leaveShopLobby(lobby.code);
    } catch (err) {
      toast(germanError(err), 'error');
      return;
    }
  }
  rememberLobby(null);
  clearInterval(state.shop.poll);
  renderShop();
}

const SHOP_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'exotic'];

function fillShopSettings(settings) {
  const f = $('#shop-settings');
  if (f.contains(document.activeElement)) return;
  f.shop_seconds.value = settings.shop_seconds;
  f.items.value = catalogToText(settings.items);
  const grid = $('#shop-price-grid');
  if (!grid.children.length) {
    grid.replaceChildren(...SHOP_RARITIES.map((r) => {
      const label = document.createElement('label');
      label.className = `shop-price rar-${r}`;
      label.innerHTML = '<span></span><input type="number" min="1" max="999" step="1" required>';
      label.firstChild.textContent = RARITIES.find((x) => x.id === r)?.name ?? r;
      label.lastChild.name = `price_${r}`;
      return label;
    }));
  }
  for (const r of SHOP_RARITIES) f.elements[`price_${r}`].value = settings.prices?.[r] ?? DEFAULT_SHOP.prices[r];
}

async function saveShopSettings(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const items = catalogFromText(form.items.value);
  const secs = Math.round(Number(form.shop_seconds.value));
  if (!items.length) return formMsg(form, 'Der Shop braucht mindestens ein Item.');
  if (!(secs >= 20 && secs <= 600)) return formMsg(form, 'Zeit im Shop: 20 bis 600 Sekunden.');
  const prices = {};
  for (const r of SHOP_RARITIES) {
    const v = Math.round(Number(form.elements[`price_${r}`].value));
    if (!(v >= 1 && v <= 999)) return formMsg(form, 'Preise zwischen 1 und 999 Goldbarren.');
    prices[r] = v;
  }
  await withLoading(form, async () => {
    state.shop.settings = await state.api.saveShopSettings({ items, prices, shop_seconds: secs });
    formMsg(form, 'Gespeichert.', true);
    form.items.value = catalogToText(state.shop.settings.items);
  });
}

// ============================================================
// Unangenehme Fragen
// ============================================================
function setupQuestions() {
  const form = $('#q-form');
  form.addEventListener('submit', submitQuestion);
  form.text.addEventListener('input', () => { $('#q-count').textContent = `${form.text.value.length} / 200`; });
  document.querySelectorAll('[data-q-resolve]').forEach((b) => b.addEventListener('click', () => resolveQuestion(b.dataset.qResolve, b)));
  $('#q-hide').addEventListener('click', hideQuestion);
  $('#q-punish-form').addEventListener('submit', savePunishments);
}

async function loadQuestions() {
  try {
    const [list, stage] = await Promise.all([state.api.getQuestions(), state.api.getQuestionStage()]);
    Object.assign(state.questions, { list, stage: stage ?? DEFAULT_STAGE, on: true, error: '' });
  } catch (err) {
    console.warn('Unangenehme Fragen nicht verfügbar:', err);
    Object.assign(state.questions, { on: false, error: germanError(err) });
  }
  if (state.questions.on && !state.questions.subscribed) {
    state.questions.subscribed = true;
    state.api.onQuestions(applyQuestionChange);
    state.api.onQuestionStage((stage) => {
      if (!stage) return;
      state.questions.stage = stage;
      paintQuestionsTile();
      if ($('#questions-dialog').open) renderQuestionsDialog();
    });
  }
  paintQuestionsTile();
  if ($('#questions-dialog').open) renderQuestionsDialog();
}

function applyQuestionChange(p) {
  const { list } = state.questions;
  if (p.eventType === 'DELETE') {
    state.questions.list = list.filter((q) => q.id !== p.old?.id);
  } else if (p.new) {
    const known = list.some((q) => q.id === p.new.id);
    state.questions.list = known ? list.map((q) => (q.id === p.new.id ? p.new : q)) : [p.new, ...list];
    if (!known && p.new.status === 'pending' && state.profile?.is_admin && p.new.user_id !== state.user?.id) {
      toast(`Neue Frage von ${p.new.author || 'jemandem'} – bitte prüfen.`, 'ok');
    }
  }
  paintQuestionsTile();
  if ($('#questions-dialog').open) renderQuestionsDialog();
}

async function openQuestions() {
  const tile = tileByKind('questions');
  if (tile && isLocked(tile)) { openTile(tile.id); return; }
  renderQuestionsDialog();
  $('#questions-dialog').showModal();
  await loadQuestions();
}

function renderQuestionsDialog() {
  const admin = !!state.profile?.is_admin;
  const { list, stage, on } = state.questions;
  const dlg = $('#questions-dialog');
  dlg.classList.toggle('is-admin', admin && on);
  const note = $('#questions-note');
  note.textContent = on ? '' : admin
    ? (state.questions.error || 'Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20260928000000_questions_pet.sql ausführen.')
    : 'Die Fragen sind noch nicht eingerichtet. Schau später noch mal vorbei.';
  note.hidden = on;
  paintQuestionCard($('#q-stage-card'), stage);
  $('#q-form').querySelectorAll('textarea, input, button').forEach((el) => { el.disabled = !on; });

  const mine = list.filter((q) => q.user_id === state.user?.id);
  fillQuestionList($('#q-mine'), mine, 'Du hast noch keine Frage gestellt.', (q) => {
    const actions = [];
    if (q.status === 'pending') actions.push(qButton('Zurückziehen', 'btn--ghost', () => withdrawQuestion(q)));
    return actions;
  }, { showStatus: true });

  $('#q-admin').hidden = !(admin && on);
  paintTileStart('questions');
  if (!(admin && on)) return;

  const pending = list.filter((q) => q.status === 'pending').reverse();
  const approved = list.filter((q) => q.status === 'approved').reverse();
  const done = list.filter((q) => q.status === 'done').slice(0, 20);
  $('#q-pending-count').textContent = pending.length ? `· ${pending.length}` : '';
  $('#q-approved-count').textContent = approved.length ? `· ${approved.length}` : '';
  fillQuestionList($('#q-pending'), pending, 'Nichts zu prüfen.', (q) => [
    qButton('✓ Freigeben', 'btn--primary', () => reviewQuestion(q, 'approved')),
    qButton('✕ Ablehnen', 'btn--ghost', () => reviewQuestion(q, 'rejected')),
  ], { showAuthor: true });
  fillQuestionList($('#q-approved'), approved, 'Keine freigegebene Frage übrig.', (q) => [
    qButton('▶ Im Stream zeigen', 'btn--primary', () => showQuestion(q)),
  ], { showAuthor: true });
  fillQuestionList($('#q-done'), done, 'Noch keine Frage beantwortet.', (q) => [
    qButton('Nochmal zeigen', 'btn--ghost', () => showQuestion(q)),
  ], { showAuthor: true, showStatus: true });

  const live = stage?.state === 'ask';
  document.querySelectorAll('[data-q-resolve]').forEach((b) => { b.disabled = !live; });
  $('#q-hide').disabled = !stage || stage.state === 'hidden';
  $('#q-controls-hint').textContent = live
    ? 'Die Frage steht im Stream. Antwortet Dave nicht, zieht „Bestrafung“ eine zufällige Strafe aus der Liste.'
    : stage?.state && stage.state !== 'hidden' ? 'Das Ergebnis steht im Stream. „Ausblenden“ nimmt die Karte raus.' : 'Eine freigegebene Frage mit „Im Stream zeigen“ starten.';
  const punish = $('#q-punish-form');
  if (document.activeElement !== punish.list) punish.list.value = (stage?.punishments ?? DEFAULT_STAGE.punishments).join('\n');
}

function qButton(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls} btn--sm`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function fillQuestionList(list, items, empty, actions, { showAuthor = false, showStatus = false } = {}) {
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = empty;
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...items.map((q) => {
    const li = document.createElement('li');
    li.className = `q-item q-item--${q.status}`;
    const text = document.createElement('p');
    text.className = 'q-text';
    text.textContent = q.text;
    const meta = document.createElement('p');
    meta.className = 'q-meta';
    const parts = [];
    if (showAuthor) parts.push(`${q.author || 'Zuschauer'}${q.anonymous ? ' (anonym im Stream)' : ''}`);
    if (showStatus) parts.push(q.status === 'done' ? (OUTCOME_LABEL[q.outcome] ?? STATUS_LABEL.done) : STATUS_LABEL[q.status] ?? q.status);
    if (q.status === 'done' && q.outcome === 'punished' && q.punishment) parts.push(q.punishment);
    parts.push(new Date(q.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    meta.textContent = parts.join(' · ');
    const row = div('q-actions');
    row.append(...actions(q));
    li.append(text, meta, row);
    return li;
  }));
}

async function submitQuestion(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const text = form.text.value.trim();
  if (text.length < 5) return formMsg(form, 'Bitte mindestens 5 Zeichen.');
  await withLoading(form, async () => {
    const q = await state.api.askQuestion(text, form.anonymous.checked);
    if (!state.questions.list.some((x) => x.id === q.id)) state.questions.list = [q, ...state.questions.list];
    form.reset();
    $('#q-count').textContent = '0 / 200';
    renderQuestionsDialog();
    formMsg(form, 'Danke! Deine Frage wird jetzt geprüft.', true);
  });
}

async function withdrawQuestion(q) {
  if (!confirm('Frage zurückziehen?')) return;
  try {
    await state.api.deleteQuestion(q.id);
    state.questions.list = state.questions.list.filter((x) => x.id !== q.id);
    renderQuestionsDialog();
  } catch (err) {
    toast(germanError(err), 'error');
  }
}

async function reviewQuestion(q, status) {
  try {
    const row = await state.api.reviewQuestion(q.id, status);
    state.questions.list = state.questions.list.map((x) => (x.id === q.id ? row : x));
    paintQuestionsTile();
    renderQuestionsDialog();
  } catch (err) {
    toast(germanError(err), 'error');
  }
}

async function showQuestion(q) {
  const { stage } = state.questions;
  if (stage?.state === 'ask' && stage.question_id !== q.id && !confirm('Im Stream steht noch eine offene Frage. Trotzdem die neue zeigen?')) return;
  try {
    state.questions.stage = await state.api.showQuestion(q.id);
    toast('Die Frage steht jetzt im Stream.', 'ok');
  } catch (err) {
    toast(germanError(err), 'error');
  }
  paintQuestionsTile();
  renderQuestionsDialog();
}

async function resolveQuestion(outcome, btn) {
  btn.disabled = true;
  try {
    state.questions.stage = await state.api.resolveQuestion(outcome);
    await loadQuestions();
    if (outcome === 'punished') toast(`😈 Bestrafung: ${state.questions.stage.punishment}`, 'ok', 8000);
  } catch (err) {
    toast(germanError(err), 'error');
  }
  renderQuestionsDialog();
}

async function hideQuestion() {
  try {
    state.questions.stage = await state.api.hideQuestion();
  } catch (err) {
    toast(germanError(err), 'error');
  }
  paintQuestionsTile();
  renderQuestionsDialog();
}

async function savePunishments(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const list = form.list.value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!list.length) return formMsg(form, 'Es braucht mindestens eine Bestrafung.');
  await withLoading(form, async () => {
    state.questions.stage = await state.api.savePunishments(list);
    formMsg(form, `${state.questions.stage.punishments.length} Bestrafungen gespeichert.`, true);
  });
}

// ============================================================
// Daves Dino
// ============================================================
function setupPet() {
  $('#pet-feed').addEventListener('click', (e) => petAction('feed', e.currentTarget));
  $('#pet-pet').addEventListener('click', (e) => petAction('pet', e.currentTarget));
  $('#pet-say-form').addEventListener('submit', petSay);
  $('#pet-settings').addEventListener('submit', savePetSettings);
  // Der Dino läuft nur, solange der Dialog offen ist
  $('#pet-dialog').addEventListener('close', () => {
    state.pet.stopBrain?.();
    state.pet.dino?.destroy();
    state.pet.dino = null;
    state.pet.stopBrain = null;
  });
  // Hunger ändert sich mit der Zeit – Kachel ab und zu nachziehen
  setInterval(() => { paintPetTile(); if ($('#pet-dialog').open) paintPetMeter(); }, 30000);
}

async function loadPet() {
  try {
    const [data, events] = await Promise.all([state.api.getPet(), state.api.getPetEvents(20)]);
    if (!data) throw new Error('Daves Dino fehlt in der Datenbank.');
    Object.assign(state.pet, { data, events, on: true });
  } catch (err) {
    console.warn('Daves Dino nicht verfügbar:', err);
    state.pet.on = false;
    state.pet.error = germanError(err);
  }
  if (state.pet.on && !state.pet.subscribed) {
    state.pet.subscribed = true;
    state.api.onPet((data) => {
      state.pet.data = data;
      paintPetTile();
      if ($('#pet-dialog').open) renderPetDialog();
    });
    state.api.onPetEvents((ev) => {
      if (state.pet.events.some((x) => x.id === ev.id)) return;
      state.pet.events = [ev, ...state.pet.events].slice(0, 20);
      if ($('#pet-dialog').open) {
        renderPetLog();
        petReact(ev);
      }
    });
  }
  paintPetTile();
  if ($('#pet-dialog').open) renderPetDialog();
}

async function openPet() {
  const tile = tileByKind('pet');
  if (tile && isLocked(tile)) { openTile(tile.id); return; }
  renderPetDialog();
  $('#pet-dialog').showModal();
  startPetStage();
  await loadPet();
}

function startPetStage() {
  if (state.pet.dino || !state.pet.on) return;
  state.pet.sfx ??= new Sfx({ volume: 0.6 });
  const stage = $('#pet-stage');
  const size = Math.max(100, Math.min(160, stage.clientWidth * 0.26));
  state.pet.dino = new Dino(stage, { size, sfx: state.pet.sfx, name: state.pet.data?.name ?? DEFAULT_PET.name, reducedMotion });
  // In der Vorschau knabbert er an den Namen, die zuletzt da waren
  state.pet.stopBrain = runDino(state.pet.dino, {
    getPet: () => state.pet.data,
    names: () => [...new Set(state.pet.events.map((e) => e.who).filter(Boolean))],
    idleEvery: [14, 28],
    nibbleEvery: [18, 30],
    trickEvery: [8, 16],
  });
}

function petReact(ev) {
  const dino = state.pet.dino;
  if (!dino) return;
  if (ev.kind === 'feed') dino.eat(ev.who);
  else if (ev.kind === 'pet') dino.cuddle(ev.who);
  else if (ev.kind === 'say') dino.say(ev.text, 5000);
}

function renderPetDialog() {
  const admin = !!state.profile?.is_admin;
  const { on, data } = state.pet;
  const note = $('#pet-note');
  note.textContent = on ? '' : admin
    ? (state.pet.error || 'Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20260928000000_questions_pet.sql ausführen.')
    : 'Der Dino ist noch nicht eingezogen. Schau später noch mal vorbei.';
  note.hidden = on;
  $('#pet-title').textContent = on ? `Daves Dino: ${data.name}` : 'Daves Dino';
  $('#pet-feed').disabled = !on;
  $('#pet-pet').disabled = !on;
  // Zuschauer füttern hier nur für sich – im Stream über den Twitch-Chat. Admins können beides.
  $('#pet-live-wrap').hidden = !(admin && on);
  const command = data?.feed_command || DEFAULT_PET.feed_command;
  const twitch = state.twitch ?? {};
  $('#pet-hint').textContent = !on ? ''
    : admin
      ? `„Auch im Stream“ an: Füttern und Streicheln sieht man in OBS. Zuschauer füttern im Stream mit ${command} im Twitch-Chat (alle 10 Minuten pro Person).${twitch.connected && twitch.bot_connected && twitch.bot_chat === false ? ' Dafür den Chat-Bot im Admin-Bereich einmal neu verbinden (Chat lesen).' : ''}${twitch.connected && !twitch.bot_connected ? ' Dafür braucht es den Chat-Bot (Admin-Bereich).' : ''}`
      : `Hier fütterst und streichelst du ${data.name} nur auf der Seite. Im Stream fütterst du ${data.name} mit ${command} in Daves Twitch-Chat – alle 10 Minuten.`;
  if (on) {
    startPetStage();
    state.pet.dino?.setName(data.name);
    paintPetMeter();
  }
  renderPetLog();
  $('#pet-admin').hidden = !(admin && on);
  $('#pet-dialog').classList.toggle('is-admin', admin && on);
  paintTileStart('pet');
  if (!(admin && on)) return;
  const f = $('#pet-settings');
  if (!f.contains(document.activeElement)) {
    f.name.value = data.name;
    f.hungry_after.value = data.hungry_after;
    f.feed_command.value = data.feed_command || DEFAULT_PET.feed_command;
    f.phrases.value = (data.phrases ?? []).join('\n');
  }
}

function paintPetMeter() {
  const pet = state.pet.data;
  if (!pet) return;
  const h = hungerOf(pet);
  const fill = $('#pet-meter-fill');
  fill.style.width = `${Math.round(Math.min(1, h) * 100)}%`;
  fill.classList.toggle('is-hungry', h >= 1);
  const since = pet.last_fed_at ? Math.round((Date.now() - Date.parse(pet.last_fed_at)) / 60000) : null;
  $('#pet-status').textContent = h >= 1
    ? `${pet.name} hat Hunger und knabbert im Stream an den Zuschauern! Schnell füttern.`
    : `${pet.name} ist satt${pet.last_fed_by ? ` – zuletzt gefüttert von ${pet.last_fed_by}` : ''}${since !== null ? (since < 1 ? ' gerade eben' : ` vor ${since} Min`) : ''}. Hunger in etwa ${Math.max(1, Math.round((1 - h) * pet.hungry_after))} Min.`;
  state.pet.dino?.setHungry(h >= 1);
}

function renderPetLog() {
  const list = $('#pet-log');
  const events = state.pet.events;
  if (!events.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch nichts passiert.';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...events.slice(0, 10).map((ev) => {
    const li = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = 'prank-log-icon';
    icon.textContent = ev.kind === 'feed' ? '🍖' : ev.kind === 'pet' ? '🤚' : '💬';
    const main = document.createElement('span');
    main.className = 'h-main';
    main.textContent = (ev.kind === 'feed' ? `${ev.who} hat gefüttert`
      : ev.kind === 'pet' ? `${ev.who} hat gestreichelt`
        : `„${ev.text}“`) + (ev.local ? ' (nur hier)' : '');
    const time = document.createElement('time');
    time.dateTime = ev.created_at;
    time.textContent = new Date(ev.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    li.append(icon, main, time);
    return li;
  }));
}

async function petAction(kind, btn) {
  btn.disabled = true;
  // Zuschauer (und Admins ohne „Auch im Stream“): nur hier auf der Seite
  if (!state.profile?.is_admin || !$('#pet-live').checked) {
    const who = state.profile?.username ?? 'Du';
    const ev = { id: `local-${Date.now()}`, kind, who, text: '', created_at: new Date().toISOString(), local: true };
    state.pet.events = [ev, ...state.pet.events].slice(0, 20);
    if (kind === 'feed') state.pet.data = { ...state.pet.data, last_fed_at: ev.created_at, last_fed_by: who };
    petReact(ev);
    renderPetDialog();
    setTimeout(() => { btn.disabled = false; }, 2500);
    return;
  }
  try {
    const ev = await state.api.petAction(kind);
    if (!state.pet.events.some((x) => x.id === ev.id)) {
      state.pet.events = [ev, ...state.pet.events].slice(0, 20);
      petReact(ev);
    }
    if (kind === 'feed') state.pet.data = await state.api.getPet();
    renderPetDialog();
    paintPetTile();
  } catch (err) {
    toast(germanError(err), 'error');
  } finally {
    btn.disabled = false;
  }
}

async function petSay(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const text = form.text.value.trim();
  if (!text) return;
  try {
    const ev = await state.api.petSay(text);
    if (!state.pet.events.some((x) => x.id === ev.id)) {
      state.pet.events = [ev, ...state.pet.events].slice(0, 20);
      petReact(ev);
    }
    form.reset();
    renderPetLog();
    toast('Der Dino sagt es jetzt im Stream.', 'ok');
  } catch (err) {
    toast(germanError(err), 'error');
  }
}

async function savePetSettings(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const name = form.name.value.trim();
  const hungry = Math.round(Number(form.hungry_after.value));
  const command = form.feed_command.value.trim();
  if (!name) return formMsg(form, 'Bitte einen Namen eingeben.');
  if (!/^![^\s!]{1,29}$/.test(command)) return formMsg(form, 'Der Chat-Befehl beginnt mit ! und hat keine Leerzeichen, z. B. !füttern.');
  if (!(hungry >= 5 && hungry <= 720)) return formMsg(form, 'Hunger nach 5 bis 720 Minuten.');
  await withLoading(form, async () => {
    const phrases = form.phrases.value.split('\n').map((l) => l.trim()).filter(Boolean);
    state.pet.data = await state.api.updatePet({ name, hungry_after: hungry, phrases, feed_command: command });
    formMsg(form, 'Gespeichert.', true);
    renderPetDialog();
    paintPetTile();
  });
}

// ---------- Startdatum für Zuschauer (Ärgere den Dave, Bingo, Fragen, Dino) ----------
function paintTileStart(kind) {
  const input = document.querySelector(`[data-tile-start="${kind}"]`);
  const tile = tileByKind(kind);
  input.closest('.tile-start').hidden = !tile;
  if (tile && document.activeElement !== input) input.value = tile.target_at ? toLocalInput(new Date(tile.target_at)) : '';
}

async function saveTileStart(input) {
  const tile = tileByKind(input.dataset.tileStart);
  if (!tile) return;
  const target = input.value ? new Date(input.value) : null;
  input.disabled = true;
  try {
    const updated = await state.api.updateTile(tile.id, { target_at: target ? target.toISOString() : null });
    state.tiles = state.tiles.map((t) => (t.id === updated.id ? updated : t));
    renderGrid();
    if (input.dataset.tileStart === 'prank' && state.twitch.connected) syncPrankRewards();
    toast(target && target > new Date()
      ? `Zuschauer sehen bis ${startLabel(target.toISOString())} einen Countdown.`
      : 'Für alle freigeschaltet.', 'ok');
  } catch (err) {
    toast(`Speichern fehlgeschlagen: ${germanError(err)}`, 'error');
  } finally {
    input.disabled = false;
    paintTileStart(input.dataset.tileStart);
  }
}

// ============================================================
// Countdown-Kachel: Details & Bearbeiten
// ============================================================
const THEME_BG = {
  tracks: 'assets/bg-tracks.svg', storm: 'assets/bg-storm.svg', ghost: 'assets/bg-ghost.svg', city: 'assets/bg-city.svg',
  prank: 'assets/bg-prank.svg', bingo: 'assets/bg-bingo.svg', questions: 'assets/bg-questions.svg', pet: 'assets/bg-pet.svg', shop: 'assets/bg-shop.svg',
  challenge: 'assets/bg-challenge.svg',
};

function openTile(id) {
  const tile = state.tiles.find((t) => t.id === id);
  if (!tile) return;
  state.activeTile = tile;
  fillTileDialog(tile);
  showTileForm(false);
  $('#tile-dialog').showModal();
}

function fillTileDialog(tile) {
  const img = safeUrl(tile.background) ?? THEME_BG[tile.theme] ?? THEME_BG.tracks;
  $('#tile-dialog-hero').style.backgroundImage = `url(${JSON.stringify(img)})`;
  $('#tile-dialog-title').textContent = tile.title;
  $('#tile-dialog-desc').textContent = tile.description;
  const date = tile.target_at ? new Date(tile.target_at) : null;
  $('#tile-dialog-date').textContent = date
    ? `${tile.kind === 'countdown' ? 'Abfahrt' : 'Start'} · ${date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} · ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
    : 'Termin folgt';
  const cd = $('#tile-dialog-countdown');
  cd.dataset.target = tile.target_at ?? '';
  cd.replaceChildren();
  renderCountdown(cd, tile.target_at);
  $('#tile-edit-btn').hidden = !state.profile?.is_admin || tile.kind !== 'countdown';
}

function showTileForm(show) {
  const form = $('#tile-form');
  $('#tile-view').hidden = show;
  form.hidden = !show;
  if (!show) return;
  const t = state.activeTile;
  form.title.value = t.title;
  form.description.value = t.description;
  form.target_at.value = t.target_at ? toLocalInput(new Date(t.target_at)) : '';
  form.theme.value = t.theme;
  form.background.value = t.background ?? '';
  formMsg(form, '');
  form.title.focus();
}

async function saveTile(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const bg = form.background.value.trim();
  if (bg && !safeUrl(bg)) return formMsg(form, 'Das Hintergrundbild muss eine https-URL sein.');
  const patch = {
    title: form.title.value.trim(),
    description: form.description.value.trim(),
    target_at: new Date(form.target_at.value).toISOString(),
    theme: form.theme.value,
    background: bg || null,
  };
  if (!patch.title) return formMsg(form, 'Bitte einen Titel eingeben.');
  await withLoading(form, async () => {
    const updated = await state.api.updateTile(state.activeTile.id, patch);
    state.tiles = state.tiles.map((t) => (t.id === updated.id ? updated : t));
    state.activeTile = updated;
    renderHero();
    renderGrid();
    renderArchive();
    fillTileDialog(updated);
    showTileForm(false);
    toast('Gespeichert.', 'ok');
  });
}

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================
// OBS-Overlay
// ============================================================
// Jede Einstellung landet nur in der Adresse, wenn sie vom Standard abweicht.
// Die Standards stehen als value/checked im Formular (index.html) und in
// js/overlay.js – beide gleich halten. Positionen setzt die Vorschau: Karten
// und Kamera-Rahmen lassen sich dort verschieben (overlay.html?edit=1).
const OBS_KEY = 'obs_options';
const OBS_WS_KEY = 'zd_obs_ws';
const OBS_UNITS = { wsize: '%', nsize: '%', bsize: '%', psize: '%', qsize: '%', ssize: '%', csize: '%', dsize: '%', tsize: '%', tspeed: ' px/s', vol: '%', hold: ' s', rotate: ' s', margin: ' px', bg: '%' };
const OBS_PARTS = ['wheel', 'next', 'bingo', 'quest', 'shop', 'challenge'];
const OBS_SIZE = { wheel: 'wsize', next: 'nsize', bingo: 'bsize', quest: 'qsize', shop: 'ssize', challenge: 'csize' };
const obs = { ws: null, scene: null, shotTimer: 0, busy: false, stream: null, sources: [] };
// Live-Overlay: Einstellungen liegen in overlay_config, OBS lädt overlay.html?live=1
const obsLive = { ready: false, params: '', access: { can_edit: false, is_owner: false, admins_can_edit: false }, timer: 0, filling: false };
const obsLiveUrl = () => new URL('overlay.html?live=1', location.href).href;
const obsLocked = () => obsLive.ready && !obsLive.access.can_edit;

function setupObs() {
  const form = $('#obs-options');
  $('#obs-btn').addEventListener('click', openObsWindow);
  form.addEventListener('input', () => updateObs());
  form.addEventListener('change', () => updateObs());
  form.addEventListener('reset', () => setTimeout(() => { saveObs(null); updateObs(); }));
  $('#obs-copy').addEventListener('click', copyObsUrl);
  $('#obs-ticker-form').addEventListener('submit', saveTickerTexts);
  $('#obs-allow-admins').addEventListener('change', allowAdminsObs);
  $('#obs-ws-form').addEventListener('submit', (e) => { e.preventDefault(); connectObs(); });
  $('#obs-ws-disconnect').addEventListener('click', () => disconnectObs(true));
  $('#obs-apply').addEventListener('click', applyObs);
  $('#obs-cam-source').addEventListener('change', useObsCamera);
  $('#obs-share').addEventListener('click', shareObsWindow);
  // Vorschau und Bildabruf beim Schließen beenden – sie liefen sonst im Hintergrund weiter.
  $('#obs-dialog').addEventListener('close', () => {
    clearTimeout(obsPreviewTimer);
    clearTimeout(obs.shotTimer);
    $('#obs-preview iframe')?.remove();
    stopObsShare();
  });
  new ResizeObserver(fitObsPreview).observe($('#obs-preview'));

  // Verschieben in der Vorschau meldet das Overlay per postMessage.
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'stellwerk-obs') return;
    if (obsLocked()) { renderObsPreview(); return; } // nicht erlaubt: zurück auf den gespeicherten Stand
    const field = form.elements[e.data.key];
    if (!field || typeof e.data.value !== 'string') return;
    field.value = e.data.value;
    if (e.data.key === 'cam') $('#obs-cam-source').value = '';
    updateObs({ fromPreview: true });
  });
}

function obsFields() {
  return [...$('#obs-options').elements].filter((el) => el.name && !el.name.endsWith('-out'));
}

function obsDefault(el) {
  if (el.type === 'checkbox') return el.defaultChecked;
  if (el.tagName === 'SELECT') return [...el.options].find((o) => o.defaultSelected)?.value ?? el.options[0].value;
  return el.defaultValue;
}

function obsUrl({ preview = false } = {}) {
  const f = $('#obs-options');
  const url = new URL('overlay.html', location.href);
  const p = url.searchParams;
  // Alles ist erst einmal aus: in der Adresse steht nur, was eingeschaltet ist (mit Position).
  for (const key of OBS_PARTS) {
    if (f.elements[`${key}_on`].checked) p.set(key, f.elements[key].value);
  }
  for (const el of obsFields()) {
    if (OBS_PARTS.includes(el.name) || el.name.endsWith('_on')) continue;
    const value = el.type === 'checkbox' ? el.checked : el.value.trim();
    if (value === obsDefault(el) || value === '') continue;
    if (el.type === 'checkbox') p.set(el.name, value ? '1' : '0');
    else if (el.type === 'color') p.set(el.name, value.slice(1));
    else p.set(el.name, value);
  }
  if (preview) { p.set('vol', '0'); p.set('test', '1'); p.set('edit', '1'); }
  return url.href;
}

function loadObs() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(OBS_KEY)); } catch { /* ohne Speicher: Standards */ }
  if (!saved || typeof saved !== 'object') return;
  // Ältere gespeicherte Einstellungen: "0" als Position hieß "nicht zeigen".
  for (const key of OBS_PARTS) {
    if (saved[key] === '0') { saved[`${key}_on`] = false; delete saved[key]; }
  }
  for (const el of obsFields()) {
    if (!(el.name in saved)) continue;
    if (el.type === 'checkbox') el.checked = Boolean(saved[el.name]);
    else el.value = String(saved[el.name]);
  }
}

function saveObs(values) {
  try {
    if (values) localStorage.setItem(OBS_KEY, JSON.stringify(values));
    else localStorage.removeItem(OBS_KEY);
  } catch { /* nur Komfort */ }
}

// Die OBS-Einstellungen laufen in einem eigenen Fenster (index.html?obs), nicht als Pop-up
function openObsWindow() {
  const url = new URL(location.pathname, location.href);
  url.searchParams.set('obs', '1');
  const win = window.open(url.href, 'stellwerk-obs');
  if (win) win.focus();
  else location.href = url.href; // Fenster blockiert: dann eben hier
}

function startObsPage() {
  document.body.classList.add('obs-page');
  document.title = 'OBS-Overlay · Content-Stellwerk';
  const back = $('#obs-dialog .dialog-head [data-close]');
  back.textContent = '← Zur Webseite';
  back.setAttribute('aria-label', 'Zur Webseite');
  if (!$('#obs-dialog').open) openObsDialog({ page: true });
}

function leaveObsPage() {
  if (window.opener && !window.opener.closed) { window.close(); return; }
  location.href = location.pathname;
}

async function openObsDialog({ page = false } = {}) {
  obsLive.ready = false; // erst frisch laden, sonst würde der alte Stand gespeichert
  loadObs();
  if (page) $('#obs-dialog').show();
  else $('#obs-dialog').showModal();
  updateObs({ now: true });
  loadTickerTexts();
  loadObsLive();
  paintObsConnection();
  // Schon einmal verbunden? Dann gleich wieder – das Passwort liegt nur in diesem Browser.
  const saved = readObsLogin();
  if (saved && !obs.ws?.connected) {
    $('#obs-ws-form').password.value = saved.password ?? '';
    connectObs({ quiet: true });
  } else if (obs.ws?.connected) {
    pollObsShot();
  }

  const note = $('#obs-note');
  if (state.api.demo) {
    note.textContent = 'Demo-Modus: OBS läuft in einem eigenen Browser und bekommt die Drehungen von dieser Seite nicht mit. Die Vorschau hier funktioniert, weil sie im selben Browser läuft.';
    note.hidden = false;
  } else {
    const ready = await state.api.overlayReady().catch(() => false);
    note.textContent = state.profile.is_admin
      ? 'Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20260923000000_overlay.sql ausführen. Vorher bleibt das Overlay in OBS leer.'
      : 'Das Overlay ist noch nicht freigeschaltet und bleibt in OBS vorerst leer. Ein Admin muss dafür einmal die Datenbank einrichten – sag Dave Bescheid.';
    note.hidden = ready;
  }
}

// ---------- Live: zentrale Einstellungen ----------
async function loadObsLive() {
  try {
    const [config, access] = await Promise.all([state.api.getOverlayConfig(), state.api.overlayAccess()]);
    Object.assign(obsLive, { ready: true, params: config?.params ?? '', access, error: '' });
    // Gibt es schon gespeicherte Einstellungen, zeigt der Dialog genau die
    if (obsLive.params) applyObsParams(obsLive.params);
  } catch (err) {
    console.warn('Live-Overlay nicht verfügbar:', err);
    obsLive.ready = false;
    obsLive.error = germanError(err);
  }
  paintObsLive();
  updateObs({ now: true });
}

// Umkehrung von obsUrl(): Parameter → Formular
function applyObsParams(query) {
  const f = $('#obs-options');
  const p = new URLSearchParams(query);
  obsLive.filling = true;
  for (const el of obsFields()) {
    if (el.name.endsWith('_on')) continue;
    const def = obsDefault(el);
    const v = p.get(el.name);
    if (el.type === 'checkbox') el.checked = v === null ? def : v !== '0';
    else if (el.type === 'color') el.value = v === null ? def : `#${v}`;
    else if (OBS_PARTS.includes(el.name)) el.value = v === null || v === '0' ? def : v;
    else el.value = v === null ? def : v;
  }
  for (const key of OBS_PARTS) f.elements[`${key}_on`].checked = !!p.get(key) && p.get(key) !== '0';
  obsLive.filling = false;
}

function paintObsLive() {
  const status = $('#obs-live-status');
  const { ready, access } = obsLive;
  $('#obs-allow-wrap').hidden = !(ready && access.is_owner);
  $('#obs-allow-admins').checked = !!access.admins_can_edit;
  status.classList.toggle('is-locked', obsLocked());
  status.textContent = !ready
    ? (state.profile?.is_admin && obsLive.error ? `Live-Modus fehlt: ${obsLive.error}` : 'Diese Adresse enthält die Einstellungen – nach Änderungen in OBS neu einfügen.')
    : access.can_edit
      ? `✓ Live: Jede Änderung hier erscheint sofort in OBS.${obsLive.savedAt ? ` Zuletzt gespeichert um ${obsLive.savedAt} Uhr.` : ''}`
      : access.admins_can_edit || !state.profile?.is_admin
        ? '🔒 Das Overlay passen Dave und von ihm freigeschaltete Admins an. Du siehst hier die aktuellen Einstellungen.'
        : '🔒 Dave hat Admins das Anpassen noch nicht erlaubt. Du siehst hier die aktuellen Einstellungen.';
}

function scheduleObsSave() {
  if (!obsLive.ready || !obsLive.access.can_edit || obsLive.filling) return;
  clearTimeout(obsLive.timer);
  obsLive.timer = setTimeout(saveObsLive, 700);
}

async function saveObsLive() {
  clearTimeout(obsLive.timer);
  const query = new URL(obsUrl()).search.slice(1);
  if (query === obsLive.params) return;
  try {
    await state.api.saveOverlayConfig(query);
    obsLive.params = query;
    obsLive.savedAt = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (err) {
    toast(`Nicht gespeichert: ${germanError(err)}`, 'error');
  }
  paintObsLive();
}

async function allowAdminsObs(e) {
  const box = e.currentTarget;
  const on = box.checked;
  try {
    await state.api.allowAdminsOverlay(on);
    obsLive.access.admins_can_edit = on;
    toast(on ? 'Admins dürfen das OBS-Overlay jetzt anpassen.' : 'Nur noch du passt das OBS-Overlay an.', 'ok');
  } catch (err) {
    box.checked = !on;
    toast(germanError(err), 'error');
  }
  paintObsLive();
}

// Laufband-Texte: nur Admins sehen und ändern sie hier
async function loadTickerTexts() {
  const form = $('#obs-ticker-form');
  form.hidden = !state.profile?.is_admin;
  if (form.hidden) return;
  formMsg(form, '');
  try {
    const items = await state.api.getTicker();
    form.items.value = (items ?? DEFAULT_TICKER).join('\n');
  } catch (err) {
    form.items.value = DEFAULT_TICKER.join('\n');
    formMsg(form, germanError(err));
  }
}

async function saveTickerTexts(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const items = form.items.value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!items.length) return formMsg(form, 'Das Laufband braucht mindestens einen Text.');
  await withLoading(form, async () => {
    const saved = await state.api.saveTicker(items);
    form.items.value = saved.join('\n');
    formMsg(form, 'Gespeichert – läuft jetzt in OBS.', true);
    renderObsPreview();
  });
}

let obsPreviewTimer = 0;

function updateObs({ now = false, fromPreview = false } = {}) {
  const f = $('#obs-options');
  const values = {};
  for (const el of obsFields()) values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  for (const [name, unit] of Object.entries(OBS_UNITS)) f.elements[`${name}-out`].value = `${f.elements[name].value}${unit}`;
  obsFields().forEach((el) => { el.disabled = false; });
  for (const key of OBS_PARTS) f.elements[OBS_SIZE[key]].disabled = !f.elements[`${key}_on`].checked;
  f.psize.disabled = !f.prank.checked;
  f.dsize.disabled = !f.pet.checked;
  f.bstyle.disabled = !f.bingo_on.checked;
  // Ohne Recht zum Ändern: alles nur ansehen
  if (obsLocked()) obsFields().forEach((el) => { el.disabled = true; });
  saveObs(values);
  // Live: immer dieselbe Adresse, die Einstellungen liegen in der Datenbank
  $('#obs-url').value = obsLive.ready ? obsLiveUrl() : obsUrl();
  scheduleObsSave();

  // Hat die Vorschau selbst die Änderung gemeldet (verschoben), zeigt sie sie
  // schon – nicht neu laden, sonst springt alles zurück.
  const frame = $('#obs-preview iframe');
  if (fromPreview && frame) { frame.dataset.src = obsUrl({ preview: true }); return; }
  clearTimeout(obsPreviewTimer);
  obsPreviewTimer = setTimeout(renderObsPreview, now ? 0 : 350);
}

function renderObsPreview() {
  const box = $('#obs-preview');
  const src = obsUrl({ preview: true });
  const old = box.querySelector('iframe');
  if (old?.dataset.src === src) return;
  old?.remove();
  const frame = document.createElement('iframe');
  frame.title = 'Vorschau des OBS-Overlays – Karten lassen sich verschieben';
  frame.src = frame.dataset.src = src;
  box.append(frame);
  fitObsPreview();
}

function fitObsPreview() {
  const box = $('#obs-preview');
  const frame = box.querySelector('iframe');
  if (frame && box.clientWidth) frame.style.transform = `scale(${box.clientWidth / 1920})`;
}

async function copyObsUrl() {
  const input = $('#obs-url');
  try {
    await navigator.clipboard.writeText(input.value);
    toast('Adresse kopiert – jetzt in OBS einfügen.', 'ok');
  } catch {
    input.select();
    toast('Adresse ist markiert – mit Strg+C kopieren.');
  }
}

// ---------- Verbindung zu OBS (WebSocket) ----------
function readObsLogin() {
  try { return JSON.parse(localStorage.getItem(OBS_WS_KEY)); } catch { return null; }
}

async function connectObs({ quiet = false } = {}) {
  const form = $('#obs-ws-form');
  const btn = form.querySelector('button[type="submit"]');
  const msg = $('#obs-ws-msg');
  msg.textContent = '';
  btn.disabled = true;
  btn.classList.add('is-loading');
  $('#obs-connect').dataset.state = 'busy';
  try {
    const { ObsSocket } = await import('./obs-ws.js');
    obs.ws ??= new ObsSocket();
    obs.ws.onClose = () => { disconnectObs(false); msg.textContent = 'Verbindung zu OBS getrennt.'; };
    const password = form.password.value;
    await obs.ws.connect({ password });
    try { localStorage.setItem(OBS_WS_KEY, JSON.stringify({ password })); } catch { /* nur Komfort */ }
    stopObsShare();
    obs.scene = await obs.ws.programScene();
    await loadObsSources({ pick: true });
    paintObsConnection();
    pollObsShot();
  } catch (err) {
    console.warn(err);
    obs.ws?.close();
    $('#obs-connect').dataset.state = 'off';
    if (!quiet) msg.textContent = err.message;
    paintObsConnection();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

function disconnectObs(forget) {
  clearTimeout(obs.shotTimer);
  obs.ws?.close();
  obs.scene = null;
  if (forget) {
    try { localStorage.removeItem(OBS_WS_KEY); } catch { /* egal */ }
    $('#obs-ws-form').password.value = '';
  }
  $('#obs-shot').hidden = true;
  paintObsConnection();
}

function paintObsConnection() {
  const on = !!obs.ws?.connected;
  const box = $('#obs-connect');
  box.dataset.state = on ? 'on' : box.dataset.state === 'busy' ? 'busy' : 'off';
  $('#obs-ws-form').hidden = on;
  $('#obs-connected').hidden = !on;
  $('#obs-share').hidden = on;
  $('#obs-ws-title').textContent = on ? 'Mit OBS verbunden' : 'Mit OBS verbinden';
  $('#obs-ws-status').textContent = on
    ? `Vorschau zeigt die Szene „${obs.scene ?? '…'}“. „In OBS übernehmen“ legt die Browserquelle „Stellwerk-Overlay“ an bzw. aktualisiert sie.`
    : 'Dann siehst du unten dein echtes OBS-Bild, die Seite findet Daves Kamera und richtet das Overlay in OBS ein.';
  $('#obs-preview-label').textContent = on ? `Live aus OBS · ${obs.scene ?? ''}` : obs.stream ? 'Geteiltes Fenster' : 'Beispielbild';
  $('#obs-preview').classList.toggle('has-shot', on || !!obs.stream);
}

// Bildquellen der aktuellen Szene; die wahrscheinliche Kamera wird vorgeschlagen.
async function loadObsSources({ pick = false } = {}) {
  obs.sources = await obs.ws.sources(obs.scene);
  const select = $('#obs-cam-source');
  const current = select.value;
  select.replaceChildren(
    new Option('– selbst in der Vorschau festlegen –', ''),
    ...obs.sources.map((src, i) => new Option(`${src.camera ? '📷 ' : ''}${src.name}${src.enabled ? '' : ' (ausgeblendet)'}`, String(i))),
  );
  const guess = obs.sources.findIndex((src) => src.camera && src.enabled);
  if (pick && guess >= 0) {
    select.value = String(guess);
    useObsCamera();
  } else if (!pick) {
    select.value = current;
  }
}

function useObsCamera() {
  const src = obs.sources[Number($('#obs-cam-source').value)];
  if (!$('#obs-cam-source').value || !src) return;
  const { x, y, w, h } = src.rect;
  const f = $('#obs-options');
  f.cam.value = [x, y, w, h].join(',');
  f.prank.checked = true;
  $('#obs-preview iframe')?.contentWindow?.postMessage({ type: 'stellwerk-cam', value: f.cam.value }, location.origin);
  updateObs({ fromPreview: true });
}

// Programmbild etwa jede Sekunde holen, solange der Dialog offen ist.
function pollObsShot() {
  clearTimeout(obs.shotTimer);
  const tick = async () => {
    if (!obs.ws?.connected || !$('#obs-dialog').open) return;
    try {
      const scene = await obs.ws.programScene();
      if (scene !== obs.scene) {
        obs.scene = scene;
        await loadObsSources({ pick: false });
        paintObsConnection();
      }
      const img = $('#obs-shot');
      img.src = await obs.ws.screenshot(scene);
      img.hidden = false;
    } catch (err) {
      console.warn('OBS-Bild:', err);
    }
    obs.shotTimer = setTimeout(tick, 1000);
  };
  tick();
}

async function applyObs() {
  const btn = $('#obs-apply');
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    if (obsLive.ready && obsLive.access.can_edit) await saveObsLive();
    const { scene, created } = await obs.ws.applyOverlay(obsLive.ready ? obsLiveUrl() : obsUrl());
    toast(created
      ? `Fertig: „Stellwerk-Overlay“ liegt jetzt in der Szene „${scene}“ ganz oben.`
      : `Fertig: „Stellwerk-Overlay“ ist aktualisiert und liegt in „${scene}“ ganz oben.`, 'ok', 6000);
  } catch (err) {
    toast(`OBS: ${err.message}`, 'error', 7000);
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

// ---------- Ohne Verbindung: ein Fenster teilen ----------
// Z. B. in OBS Rechtsklick auf die Vorschau → „Fenster-Projektor (Programm)“ und dieses Fenster teilen.
async function shareObsWindow() {
  try {
    obs.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
  } catch {
    return; // abgebrochen
  }
  const video = $('#obs-video');
  video.srcObject = obs.stream;
  video.hidden = false;
  video.play().catch(() => {});
  obs.stream.getVideoTracks()[0]?.addEventListener('ended', stopObsShare);
  paintObsConnection();
}

function stopObsShare() {
  obs.stream?.getTracks().forEach((t) => t.stop());
  obs.stream = null;
  const video = $('#obs-video');
  video.srcObject = null;
  video.hidden = true;
  if ($('#obs-dialog').open) paintObsConnection();
}

// ============================================================
// Twitch verbinden
// ============================================================
function openTwitchDialog() {
  renderTwitchDialog();
  $('#twitch-dialog').showModal();
}

function renderTwitchDialog() {
  const { twitch, profile } = state;
  const admin = !!profile?.is_admin;
  const body = $('#twitch-dialog-body');
  if (twitch.connected) {
    body.innerHTML = `
      <p>Verbunden mit <b data-fill="channel"></b>. Die Kanalpunkte-Belohnung ist ${twitch.subscription_active ? 'aktiv' : '<b>nicht aktiv</b> (bitte neu verbinden)'}.</p>
      ${admin ? '<p class="bot-note" data-fill="bot"></p>' : ''}
      <p class="form-msg" role="alert"></p>
      <div class="dialog-actions">
        ${admin ? '<button class="btn btn--ghost" type="button" data-action="reconnect">Neu verbinden</button><button class="btn btn--ghost" type="button" data-action="disconnect">Kanal trennen</button>' : ''}
        <button class="btn btn--primary" type="button" data-close>OK</button>
      </div>`;
    body.querySelector('[data-fill="channel"]').textContent = twitch.display_name ?? twitch.login;
  } else {
    body.innerHTML = `
      <p>Dave meldet sich mit dem Twitch-Account <b data-fill="channel"></b> an und erlaubt dieser Seite:</p>
      <ul class="perm-list">
        <li><span>Kanalpunkte-Belohnungen verwalten<small>Legt die Belohnung „Glücksrad“ an und markiert Einlösungen als erledigt.</small></span></li>
        <li><span>Kanalpunkte-Einlösungen lesen<small>Damit das Rad sich dreht, auch wenn diese Seite geschlossen ist.</small></span></li>
        <li><span>Chat-Bot zulassen<small>Der Stellwerk-Bot darf das Ergebnis jeder Drehung in den Chat schreiben. In Daves Namen schreibt die Seite nie.</small></span></li>
      </ul>
      <p class="form-msg" role="alert"></p>
      <div class="dialog-actions">
        <button class="btn btn--ghost" type="button" data-close>Abbrechen</button>
        <button class="btn btn--twitch" type="button" data-action="connect">Weiter zu Twitch</button>
      </div>`;
    body.querySelector('[data-fill="channel"]').textContent = CONFIG.CHANNEL;
  }

  // Den Chat-Bot verbindet nur der Admin-Bereich (admin.html) – hier nur der Stand.
  const botNote = body.querySelector('[data-fill="bot"]');
  if (botNote) {
    botNote.textContent = twitch.bot_connected
      ? `🤖 Chat-Bot ${twitch.bot_name ?? twitch.bot_login} schreibt die Ergebnisse in den Chat.${twitch.bot_scope ? '' : ' Damit er in Daves Chat schreiben darf, einmal „Neu verbinden“.'}`
      : '🤖 Noch kein Chat-Bot verbunden – ohne ihn bleibt der Chat still. Verbunden wird er im Admin-Bereich.';
  }
  body.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => twitchAction(b)));
}

async function refreshTwitch() {
  state.twitch = await state.api.twitchStatus().catch(() => ({ connected: false }));
  renderHeader();
  renderHero();
  renderWheelPanel();
}

async function twitchAction(btn) {
  const action = btn.dataset.action;
  const msg = $('#twitch-dialog-body .form-msg');
  if (msg) msg.textContent = '';
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    if (action === 'disconnect') {
      await state.api.twitchDisconnect();
      await refreshTwitch();
      closeDialog($('#twitch-dialog'));
      toast('Twitch wurde getrennt. Die Belohnung ist deaktiviert.', 'ok');
    } else {
      // Merken, dass Dave gerade verbindet – für eine verständliche Meldung,
      // falls Twitch falsch zurückleitet (siehe boot).
      try { sessionStorage.setItem('zd_twitch_flow', '1'); } catch { /* egal */ }
      await state.api.twitchConnect(); // leitet zu Twitch weiter
    }
  } catch (err) {
    // Der Fehler gehört in den Dialog: dort schaut man hin, nachdem man
    // geklickt hat.
    console.error(err);
    const text = germanError(err);
    if (msg) msg.textContent = text;
    else toast(text, 'error', 7000);
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

// ============================================================
// Hilfsfunktionen
// ============================================================
function toast(text, type = 'info', ms = 4500) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = text;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  host.append(el);
  raiseToasts();
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => {
      el.remove();
      if (!host.children.length) hideToasts();
    }, 260);
  }, ms);
}

// Ein Dialog mit showModal() liegt in der "top layer" und deckt alles
// Normale zu – auch die Meldungen. Als Popover landen sie selbst in der
// top layer und bleiben lesbar. Jedes erneute Zeigen hebt sie über einen
// Dialog, der zwischenzeitlich geöffnet wurde.
function raiseToasts() {
  const host = $('#toasts');
  if (typeof host.showPopover !== 'function') return; // ältere Browser: wie bisher
  try {
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  } catch { /* Popover nicht möglich – Meldungen bleiben in der normalen Ebene */ }
}

function hideToasts() {
  const host = $('#toasts');
  try { if (host.matches(':popover-open')) host.hidePopover(); } catch { /* egal */ }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
