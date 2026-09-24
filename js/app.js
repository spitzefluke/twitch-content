import { CONFIG } from './config.js';
import { createApi, germanError } from './api.js';
import { playIntro } from './intro.js';
import { Wheel } from './wheel.js';
import { BOARD, ITEMS, MAX_SOUND_SECONDS, Sfx, prankEmoji, prankText, setItemIcon, setPrankIcon, throwItem } from './prank-fx.js';
import { MAX_AMOUNT, RARITIES, amountFromFile, bingoState, drawCard, nameFromFile, rarityFromFile, renderBingoGrid, shrinkImage } from './bingo.js';

const $ = (sel, root = document) => root.querySelector(sel);
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
  if (params.has('intro') || (!seen && !params.has('twitch') && !adminHash)) {
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
}

function leaveApp() {
  state.user = null;
  state.profile = null;
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
// "Ärgere den Dave" und das Bingo haben ein Startdatum für Zuschauer (target_at).
// Admins können vorher schon alles benutzen und testen.
const isLocked = (t) => (t.kind === 'prank' || t.kind === 'bingo')
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
  const build = { prank: buildPrankTile, bingo: buildBingoTile };
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
      if (e.target === dlg || e.target.closest('[data-close]')) closeDialog(dlg);
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
  document.querySelectorAll('[data-tile-start]').forEach((input) => {
    input.addEventListener('change', (e) => { e.stopPropagation(); saveTileStart(input); });
  });
}

function closeDialog(dlg) {
  if (!dlg.open || dlg.classList.contains('is-closing')) return;
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
  if (card) {
    renderBingoGrid(grid, card, {
      urlFor: (path) => state.api.bingoUrl(path),
      onCell: admin ? toggleBingoCell : null,
      stamped,
      itemOf: bingoItemOf,
    });
  }
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
  } catch (err) {
    node.disabled = false;
    toast(germanError(err), 'error');
  }
}

async function newBingoCard() {
  const { card } = state.bingo;
  if (card && bingoState(card).done && !confirm('Neue Karte ziehen? Die Haken der aktuellen Karte gehen verloren.')) return;
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

// ---------- Startdatum für Zuschauer (Ärgere den Dave, Bingo) ----------
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
  prank: 'assets/bg-prank.svg', bingo: 'assets/bg-bingo.svg',
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
const OBS_UNITS = { wsize: '%', nsize: '%', bsize: '%', psize: '%', vol: '%', hold: ' s', rotate: ' s', margin: ' px', bg: '%' };
const OBS_PARTS = ['wheel', 'next', 'bingo'];
const obs = { ws: null, scene: null, shotTimer: 0, busy: false, stream: null, sources: [] };

function setupObs() {
  const form = $('#obs-options');
  $('#obs-btn').addEventListener('click', openObsDialog);
  form.addEventListener('input', () => updateObs());
  form.addEventListener('change', () => updateObs());
  form.addEventListener('reset', () => setTimeout(() => { saveObs(null); updateObs(); }));
  $('#obs-copy').addEventListener('click', copyObsUrl);
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
  // Glücksrad und nächste Abfahrt stehen immer in der Adresse, Bingo nur wenn geändert.
  for (const key of OBS_PARTS) {
    const value = f.elements[`${key}_on`].checked ? f.elements[key].value : '0';
    if (key !== 'bingo' || value !== f.elements.bingo.defaultValue) p.set(key, value);
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

async function openObsDialog() {
  loadObs();
  $('#obs-dialog').showModal();
  updateObs({ now: true });
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

let obsPreviewTimer = 0;

function updateObs({ now = false, fromPreview = false } = {}) {
  const f = $('#obs-options');
  const values = {};
  for (const el of obsFields()) values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  for (const [name, unit] of Object.entries(OBS_UNITS)) f.elements[`${name}-out`].value = `${f.elements[name].value}${unit}`;
  for (const key of OBS_PARTS) f.elements[key === 'wheel' ? 'wsize' : key === 'next' ? 'nsize' : 'bsize'].disabled = !f.elements[`${key}_on`].checked;
  f.psize.disabled = !f.prank.checked;
  f.bstyle.disabled = !f.bingo_on.checked;
  saveObs(values);
  $('#obs-url').value = obsUrl();

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
    const { scene, created } = await obs.ws.applyOverlay(obsUrl());
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
