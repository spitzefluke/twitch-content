import { CONFIG } from './config.js';
import { createApi, germanError } from './api.js';
import { playIntro } from './intro.js';
import { Wheel } from './wheel.js';

const $ = (sel, root = document) => root.querySelector(sel);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  api: null,
  user: null,
  profile: null,
  tiles: [],
  variants: [],
  variantId: null,
  twitch: { connected: false },
  spins: [],
  archive: [],
  ideas: [],
  spinning: false,
  queue: [],
  wheel: null,
  activeTile: null,
  activeArchive: null,
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
    await playIntro({ duration: (CONFIG.INTRO_SECONDS ?? 18) * 1000 });
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
    queueMicrotask(() => showTwitchReturn(twitchReturn, params.get('reason')));
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
  tickClock();
  setInterval(tickClock, 30000);

  state.api.onAuthChange((user) => {
    if (user && !state.user) enterApp(user);
    if (!user && state.user) leaveApp();
  });
  const user = await state.api.getUser();
  if (user) { if (!state.user) await enterApp(user); }
  else showAuth();
}

function tickClock() {
  const d = new Date();
  const el = $('#auth-clock');
  if (el) el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function showTwitchReturn(status, reason) {
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
  toast(`Twitch-Verbindung fehlgeschlagen: ${reasons[reason] ?? reason ?? 'Unbekannter Fehler.'}`, 'error', 9000);
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

  forms.login.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const email = f.email.value.trim();
    const password = f.password.value;
    if (!email || !password) return formMsg(f, 'Bitte E-Mail und Passwort eingeben.');
    await withLoading(f, async () => { await state.api.signIn(email, password); });
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

// ---------- Social-Logins ----------
async function setupSocial() {
  const box = $('#social');
  const msg = box.querySelector('.social-msg');

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
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-ok', ok);
}

// ============================================================
// Dashboard
// ============================================================
async function enterApp(user) {
  state.user = user;
  $('#auth').hidden = true;
  $('#app').hidden = false;

  const api = state.api;
  const [profile, tiles, variants, twitch, spins, archive, ideas] = await Promise.all([
    api.getProfile(user),
    api.getTiles().catch(fail('Kacheln', [])),
    api.getVariants().catch(fail('Glücksrad', [])),
    api.twitchStatus().catch(() => ({ connected: false })),
    api.getSpins().catch(() => []),
    api.getArchive().catch(fail('Archiv', [])),
    api.getIdeas(user).catch(fail('Vorschläge', [])),
  ]);
  if (!state.user) return; // zwischenzeitlich abgemeldet
  Object.assign(state, { profile, tiles, variants, twitch, spins, archive, ideas });
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
  $('#today').textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

  const btn = $('#twitch-btn');
  btn.classList.toggle('btn--twitch', !twitch.connected);
  btn.classList.toggle('btn--ghost', twitch.connected);
  btn.classList.toggle('btn--connected', twitch.connected);
  btn.textContent = twitch.connected ? `Twitch: ${twitch.display_name ?? twitch.login}` : 'Mit Twitch verbinden';
  btn.title = twitch.connected ? 'Kanalpunkte & Chat sind verbunden' : 'Für Dave: Kanalpunkte und Chat freigeben';

  const chip = $('#wheel-chip');
  chip.textContent = twitch.connected && twitch.reward_active
    ? `Jederzeit · ${Number(twitch.reward_cost ?? 10000).toLocaleString('de-DE')} Punkte`
    : 'Drei Varianten · jederzeit drehbar';

  const [c1, c2, c3] = state.variants.map((v) => v.color);
  $('#wheel-disc').style.cssText = `--c1:${c1 ?? '#ffb81c'};--c2:${c2 ?? '#3ddc84'};--c3:${c3 ?? '#9146ff'}`;
}

// ---------- Nächste Abfahrt ----------
const THEME_BG = { tracks: 'assets/bg-tracks.svg', storm: 'assets/bg-storm.svg', ghost: 'assets/bg-ghost.svg', city: 'assets/bg-city.svg' };

function countdownTiles() {
  return state.tiles.filter((t) => t.kind === 'countdown');
}

function renderHero() {
  const upcoming = countdownTiles()
    .filter((t) => t.target_at && Date.parse(t.target_at) > Date.now())
    .sort((a, b) => Date.parse(a.target_at) - Date.parse(b.target_at));
  const next = upcoming[0] ?? countdownTiles()[0];
  $('#tile-count').textContent = `${countdownTiles().length + 1} Abfahrten geplant`;

  if (!next) {
    $('#next-title').textContent = 'Noch kein Termin geplant';
    $('#next-desc').textContent = 'Sobald eine Idee ein Datum bekommt, steht sie hier.';
    $('#next-countdown').replaceChildren();
    return;
  }
  const img = safeUrl(next.background) ?? THEME_BG[next.theme] ?? THEME_BG.tracks;
  $('#next-bg').style.backgroundImage = `url(${JSON.stringify(img)})`;
  $('#next-title').textContent = next.title;
  $('#next-desc').textContent = next.description;
  const cd = $('#next-countdown');
  cd.dataset.target = next.target_at ?? '';
  cd.replaceChildren();
  renderCountdown(cd, next.target_at);
}

// ---------- Fahrplan ----------
function renderGrid() {
  const grid = $('#grid');
  grid.replaceChildren(...countdownTiles().map((tile, i) => buildTile(tile, i)));
  updateCountdowns();
}

function buildTile(tile, i) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `tile theme-${tile.theme}`;
  el.style.setProperty('--i', i);
  el.dataset.id = tile.id;

  const bg = document.createElement('span');
  bg.className = 'tile-bg';
  bg.setAttribute('aria-hidden', 'true');
  const img = safeUrl(tile.background);
  if (img) bg.style.backgroundImage = `url(${JSON.stringify(img)})`;
  const shade = document.createElement('span');
  shade.className = 'tile-shade';
  shade.setAttribute('aria-hidden', 'true');

  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = tile.target_at
    ? new Date(tile.target_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Termin folgt';

  const title = document.createElement('span');
  title.className = 'card-title';
  title.textContent = tile.title;

  const desc = document.createElement('span');
  desc.className = 'card-desc';
  desc.textContent = tile.description;

  const cd = document.createElement('span');
  cd.className = 'countdown countdown--sm';
  cd.dataset.target = tile.target_at ?? '';

  el.append(bg, shade, chip, title, desc, cd);
  el.addEventListener('click', () => openTile(tile.id));
  return el;
}

// ---------- Countdowns ----------
const UNITS = [['Tage', 86400], ['Std', 3600], ['Min', 60], ['Sek', 1]];

function renderCountdown(el, targetIso) {
  const target = Date.parse(targetIso);
  if (!targetIso || Number.isNaN(target)) {
    el.classList.remove('countdown--done');
    el.textContent = 'Termin folgt';
    return;
  }
  let secs = Math.max(0, Math.floor((target - Date.now()) / 1000));
  const chip = el.parentElement?.querySelector('.chip') ?? el.closest('.tile')?.querySelector('.chip');
  if (secs === 0) {
    el.classList.add('countdown--done');
    el.textContent = 'Abgefahren · jetzt live!';
    chip?.classList.add('is-live');
    return;
  }
  el.classList.remove('countdown--done');
  if (el.children.length !== 4) {
    el.replaceChildren(...UNITS.map(([lbl]) => {
      const u = document.createElement('span');
      u.className = 'cd-unit';
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
      if (!reducedMotion) { num.classList.remove('bump'); void num.offsetWidth; num.classList.add('bump'); }
    }
  });
}

function updateCountdowns() {
  document.querySelectorAll('.countdown[data-target]').forEach((el) => renderCountdown(el, el.dataset.target));
}
setInterval(updateCountdowns, 1000);

// ============================================================
// Archiv
// ============================================================
function renderArchive() {
  const list = $('#archive-list');
  const isAdmin = !!state.profile?.is_admin;
  $('#archive-add').hidden = !isAdmin;

  if (!state.archive.length) {
    list.innerHTML = '<li class="empty-note" style="background:none;border:0">Noch keine gefahrenen Strecken eingetragen.</li>';
    return;
  }
  list.replaceChildren(...state.archive.map((row) => {
    const li = document.createElement('li');
    const date = document.createElement('span');
    date.className = 'archive-date';
    date.textContent = new Date(row.happened_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

    const main = document.createElement('span');
    main.className = 'archive-main';
    main.innerHTML = '<strong></strong><small></small>';
    main.querySelector('strong').textContent = row.title;
    main.querySelector('small').textContent = row.meta ?? '';

    const actions = document.createElement('span');
    actions.className = 'archive-actions';
    const vod = safeUrl(row.vod_url);
    if (vod) {
      const a = document.createElement('a');
      a.className = 'vod';
      a.href = vod;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'VOD';
      actions.append(a);
    }
    if (isAdmin) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'mini-btn';
      edit.textContent = 'Bearbeiten';
      edit.addEventListener('click', () => openArchiveDialog(row));
      actions.append(edit);
    }
    li.append(date, main, actions);
    return li;
  }));
}

function openArchiveDialog(row) {
  state.activeArchive = row;
  const form = $('#archive-form');
  form.title.value = row?.title ?? '';
  form.happened_at.value = row?.happened_at ? String(row.happened_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
  form.meta.value = row?.meta ?? '';
  form.vod_url.value = row?.vod_url ?? '';
  formMsg(form, '');
  $('#archive-delete').hidden = !row;
  $('#archive-dialog-title').textContent = row ? 'Eintrag bearbeiten' : 'Neuer Eintrag';
  $('#archive-dialog').showModal();
}

async function saveArchive(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const vod = form.vod_url.value.trim();
  if (vod && !safeUrl(vod)) return formMsg(form, 'Der VOD-Link muss eine https-Adresse sein.');
  const entry = {
    ...(state.activeArchive?.id ? { id: state.activeArchive.id } : {}),
    title: form.title.value.trim(),
    happened_at: form.happened_at.value,
    meta: form.meta.value.trim(),
    vod_url: vod || null,
  };
  if (!entry.title) return formMsg(form, 'Bitte einen Titel eingeben.');
  await withLoading(form, async () => {
    const saved = await state.api.saveArchive(entry);
    state.archive = state.activeArchive?.id
      ? state.archive.map((r) => (r.id === saved.id ? saved : r))
      : [saved, ...state.archive];
    state.archive.sort((a, b) => String(b.happened_at).localeCompare(String(a.happened_at)));
    renderArchive();
    closeDialog($('#archive-dialog'));
    toast('Archiv aktualisiert.', 'ok');
  });
}

async function deleteArchive() {
  const row = state.activeArchive;
  if (!row) return;
  try {
    await state.api.deleteArchive(row.id);
    state.archive = state.archive.filter((r) => r.id !== row.id);
    renderArchive();
    closeDialog($('#archive-dialog'));
    toast('Eintrag gelöscht.', 'ok');
  } catch (err) {
    toast(`Löschen fehlgeschlagen: ${germanError(err)}`, 'error');
  }
}

// ============================================================
// Vorschläge
// ============================================================
function renderIdeas() {
  const list = $('#idea-list');
  const isAdmin = !!state.profile?.is_admin;
  if (!state.ideas.length) {
    list.innerHTML = '<li class="empty-note" style="background:none;border:0">Noch keine Vorschläge. Mach den Anfang!</li>';
    return;
  }
  list.replaceChildren(...state.ideas.map((idea) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'idea-text';
    text.innerHTML = '<strong></strong><small></small>';
    text.querySelector('strong').textContent = idea.text;
    text.querySelector('small').textContent = `von ${idea.author}`;

    const actions = document.createElement('span');
    actions.className = 'idea-actions';
    const vote = document.createElement('button');
    vote.type = 'button';
    vote.className = 'vote-btn';
    vote.setAttribute('aria-pressed', String(!!idea.voted));
    vote.setAttribute('aria-label', `${idea.voted ? 'Stimme zurücknehmen' : 'Dafür stimmen'}: ${idea.text}`);
    vote.textContent = `▲ ${idea.votes}`;
    vote.addEventListener('click', () => toggleVote(idea, vote));
    actions.append(vote);

    if (isAdmin || idea.user_id === state.user?.id) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'mini-btn';
      del.textContent = '×';
      del.title = 'Vorschlag löschen';
      del.addEventListener('click', () => removeIdea(idea));
      actions.append(del);
    }
    li.append(text, actions);
    return li;
  }));
}

async function toggleVote(idea, btn) {
  const on = !idea.voted;
  btn.disabled = true;
  try {
    await state.api.voteIdea(idea.id, on, state.user);
    idea.voted = on;
    idea.votes += on ? 1 : -1;
    state.ideas.sort((a, b) => b.votes - a.votes);
    renderIdeas();
  } catch (err) {
    toast(`Abstimmen fehlgeschlagen: ${germanError(err)}`, 'error');
    btn.disabled = false;
  }
}

async function removeIdea(idea) {
  try {
    await state.api.deleteIdea(idea.id);
    state.ideas = state.ideas.filter((i) => i.id !== idea.id);
    renderIdeas();
  } catch (err) {
    toast(`Löschen fehlgeschlagen: ${germanError(err)}`, 'error');
  }
}

async function submitIdea(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const text = form.text.value.trim();
  if (text.length < 3) return formMsg(form, 'Bitte schreib etwas mehr zu deiner Idee.');
  await withLoading(form, async () => {
    const idea = await state.api.addIdea(text, state.user, state.profile.username);
    state.ideas = [{ ...idea, voted: true }, ...state.ideas];
    form.reset();
    renderIdeas();
    toast('Danke! Dein Vorschlag steht in der Liste.', 'ok');
  });
}

// ============================================================
// Dialoge
// ============================================================
function setupDialogs() {
  document.querySelectorAll('dialog').forEach((dlg) => {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) closeDialog(dlg);
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(dlg); });
  });

  $('#logout-btn').addEventListener('click', () => state.api.signOut());
  $('#twitch-btn').addEventListener('click', openTwitchDialog);
  $('#wheel-card').addEventListener('click', openWheel);
  $('#spin-btn').addEventListener('click', spinFromWeb);
  $('#simulate-btn').addEventListener('click', () => state.api.simulateRedemption?.());
  $('#tile-edit-btn').addEventListener('click', () => showTileForm(true));
  $('#tile-cancel-btn').addEventListener('click', () => showTileForm(false));
  $('#tile-form').addEventListener('submit', saveTile);
  $('#archive-add').addEventListener('click', () => openArchiveDialog(null));
  $('#archive-form').addEventListener('submit', saveArchive);
  $('#archive-delete').addEventListener('click', deleteArchive);
  $('#idea-form').addEventListener('submit', submitIdea);
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
  if (v) state.wheel?.setVariant(v);
}

function renderWheelPanel() {
  const list = $('#variant-list');
  list.replaceChildren(...state.variants.map((v) => {
    const wrap = document.createElement('div');
    wrap.className = 'variant-opt';
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
    drainQueue();
  }
}

function setVariantInputsDisabled(disabled) {
  document.querySelectorAll('#variant-list input').forEach((i) => { i.disabled = disabled; });
}

function handleIncomingSpin(spin) {
  if (state.spins.some((s) => s.id === spin.id)) return;
  if (spin.source !== 'twitch') { addSpin(spin); return; }
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
// Twitch verbinden
// ============================================================
function openTwitchDialog() {
  const { twitch, profile } = state;
  const body = $('#twitch-dialog-body');
  if (twitch.connected) {
    body.innerHTML = `
      <p>Verbunden mit <b></b>. Die Kanalpunkte-Belohnung ist ${twitch.subscription_active ? 'aktiv' : '<b>nicht aktiv</b> (bitte neu verbinden)'}.</p>
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
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    if (action === 'disconnect') {
      await state.api.twitchDisconnect();
      state.twitch = { connected: false };
      renderHeader();
      renderWheelPanel();
      closeDialog($('#twitch-dialog'));
      toast('Twitch wurde getrennt. Die Belohnung ist deaktiviert.', 'ok');
    } else {
      await state.api.twitchConnect(); // leitet zu Twitch weiter
    }
  } catch (err) {
    toast(germanError(err), 'error', 7000);
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

// ============================================================
// Hilfsfunktionen
// ============================================================
function safeUrl(value) {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function toast(text, type = 'info', ms = 4500) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = text;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  }, ms);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
