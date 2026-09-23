import { CONFIG } from './config.js';
import { createApi, germanError } from './api.js';
import { playIntro } from './intro.js';
import { Wheel } from './wheel.js';

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
};

boot();

// ============================================================
// Start
// ============================================================
async function boot() {
  const params = new URLSearchParams(location.search);
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
  const [profile, tiles, variants, twitch, spins, ideas] = await Promise.all([
    api.getProfile(user),
    api.getTiles().catch(fail('Kacheln', [])),
    api.getVariants().catch(fail('Glücksrad', [])),
    api.twitchStatus().catch(() => ({ connected: false })),
    api.getSpins().catch(() => []),
    // Die Vorschläge-Tabellen kamen später dazu: fehlen sie in der Datenbank,
    // bleibt der Bereich einfach aus, statt einen Fehler zu zeigen.
    api.getIdeas().catch((err) => { console.warn('Vorschläge nicht verfügbar:', err); return null; }),
  ]);
  if (!state.user) return; // zwischenzeitlich abgemeldet
  Object.assign(state, { profile, tiles, variants, twitch, spins });
  state.ideas = ideas ?? [];
  state.ideasOn = ideas !== null;
  state.variantId ??= variants[0]?.id;

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
  $('#obs-btn').hidden = !profile.is_admin;

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
  grid.replaceChildren(...state.tiles.filter(isPlanned).map((tile, i) => buildTile(tile, i)));
  updateCountdowns();
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
  tag.textContent = 'Abfahrt in';
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
setInterval(() => { updateCountdowns(); updateAuthClock(); }, 1000);

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
  $('#obs-btn').addEventListener('click', openObsDialog);
  $('#obs-options').addEventListener('change', updateObs);
  $('#obs-copy').addEventListener('click', copyObsUrl);
  // Vorschau beim Schließen entfernen: Sie dreht sonst im Hintergrund weiter.
  $('#obs-dialog').addEventListener('close', () => $('#obs-preview iframe')?.remove());
  new ResizeObserver(fitObsPreview).observe($('#obs-preview'));
  $('#spin-btn').addEventListener('click', spinFromWeb);
  $('#simulate-btn').addEventListener('click', () => state.api.simulateRedemption?.());
  $('#tile-edit-btn').addEventListener('click', () => showTileForm(true));
  $('#tile-cancel-btn').addEventListener('click', () => showTileForm(false));
  $('#tile-form').addEventListener('submit', saveTile);
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
  $('#announce-wrap').hidden = !(profile?.is_admin && twitch.connected);
  $('#simulate-btn').hidden = !state.api.demo;

  const info = $('#reward-info');
  if (twitch.connected && twitch.reward_active) {
    info.innerHTML = `<span class="ri-icon">✦</span><span>Zuschauer können die Kanalpunkte-Belohnung <b>„${escapeHtml(twitch.reward_title ?? 'Glücksrad')}“</b> für <b>${Number(twitch.reward_cost ?? 10000).toLocaleString('de-DE')} Punkte</b> einlösen. Das Rad dreht dann eine zufällige Variante, und das Ergebnis erscheint im Chat.</span>`;
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
// Countdown-Kachel: Details & Bearbeiten
// ============================================================
const THEME_BG = { tracks: 'assets/bg-tracks.svg', storm: 'assets/bg-storm.svg', ghost: 'assets/bg-ghost.svg', city: 'assets/bg-city.svg' };

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
    ? `Abfahrt · ${date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} · ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
    : 'Termin folgt';
  const cd = $('#tile-dialog-countdown');
  cd.dataset.target = tile.target_at ?? '';
  cd.replaceChildren();
  renderCountdown(cd, tile.target_at);
  $('#tile-edit-btn').hidden = !state.profile?.is_admin;
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
function obsUrl({ preview = false } = {}) {
  const f = $('#obs-options');
  const url = new URL('overlay.html', location.href);
  const p = url.searchParams;
  p.set('wheel', f.wheel.value);
  p.set('next', f.next.value);
  if (f.scale.value !== '1') p.set('scale', f.scale.value);
  if (preview || !f.sound.checked) p.set('sound', '0');
  if (preview) p.set('test', '1');
  return url.href;
}

async function openObsDialog() {
  $('#obs-dialog').showModal();
  updateObs();
  const note = $('#obs-note');
  if (state.api.demo) {
    note.textContent = 'Demo-Modus: OBS läuft in einem eigenen Browser und bekommt die Drehungen von dieser Seite nicht mit. Die Vorschau hier funktioniert, weil sie im selben Browser läuft.';
    note.hidden = false;
  } else {
    const ready = await state.api.overlayReady().catch(() => false);
    note.textContent = 'Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20260923000000_overlay.sql ausführen. Vorher bleibt das Overlay in OBS leer.';
    note.hidden = ready;
  }
}

function updateObs() {
  $('#obs-url').value = obsUrl();
  const box = $('#obs-preview');
  box.querySelector('iframe')?.remove();
  const frame = document.createElement('iframe');
  frame.title = 'Vorschau des OBS-Overlays';
  frame.tabIndex = -1;
  frame.src = obsUrl({ preview: true });
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

// ============================================================
// Twitch verbinden
// ============================================================
function openTwitchDialog() {
  const { twitch, profile } = state;
  const body = $('#twitch-dialog-body');
  if (twitch.connected) {
    body.innerHTML = `
      <p>Verbunden mit <b></b>. Die Kanalpunkte-Belohnung ist ${twitch.subscription_active ? 'aktiv' : '<b>nicht aktiv</b> (bitte neu verbinden)'}.</p>
      <p class="form-msg" role="alert"></p>
      <div class="dialog-actions">
        ${profile.is_admin ? '<button class="btn btn--ghost" type="button" data-action="reconnect">Neu verbinden</button><button class="btn btn--ghost" type="button" data-action="disconnect">Trennen</button>' : ''}
        <button class="btn btn--primary" type="button" data-close>OK</button>
      </div>`;
    body.querySelector('b').textContent = twitch.display_name ?? twitch.login;
  } else {
    body.innerHTML = `
      <p>Dave meldet sich mit dem Twitch-Account <b></b> an und erlaubt dieser Seite:</p>
      <ul class="perm-list">
        <li><span>Kanalpunkte-Belohnungen verwalten<small>Legt die Belohnung „Glücksrad“ an und markiert Einlösungen als erledigt.</small></span></li>
        <li><span>Kanalpunkte-Einlösungen lesen<small>Damit das Rad sich dreht, auch wenn diese Seite geschlossen ist.</small></span></li>
        <li><span>Nachrichten im Chat senden<small>Das Ergebnis jeder Drehung wird im Twitch-Chat gepostet.</small></span></li>
      </ul>
      <p class="form-msg" role="alert"></p>
      <div class="dialog-actions">
        <button class="btn btn--ghost" type="button" data-close>Abbrechen</button>
        <button class="btn btn--twitch" type="button" data-action="connect">Weiter zu Twitch</button>
      </div>`;
    body.querySelector('b').textContent = CONFIG.CHANNEL;
  }
  body.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => twitchAction(b)));
  $('#twitch-dialog').showModal();
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
      state.twitch = { connected: false };
      renderHeader();
      renderHero();
      renderWheelPanel();
      closeDialog($('#twitch-dialog'));
      toast('Twitch wurde getrennt. Die Belohnung ist deaktiviert.', 'ok');
    } else {
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
