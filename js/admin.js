// StreamHelp-Admin: Login mit Admin-Passwort, danach Live-Daten (alle 5 s aktualisiert).
import { CONFIG } from './config.js';
import { isDemo } from './api.js';
import { DEFAULT_VARIANTS } from './defaults.js';
import { guardFrame } from './frame-guard.js';
import { botHint } from './bot-reasons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const TOKEN_KEY = 'zd_admin_token';
const POLL_MS = 5000;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PROVIDERS = [
  ['email', 'E-Mail'], ['twitch', 'Twitch'], ['discord', 'Discord'],
  ['google', 'Google'], ['spotify', 'Spotify'], ['github', 'GitHub'],
];
// Pfad direkt in mask-image: in einer CSS-Variablen wuerde er relativ zur CSS-Datei aufgeloest
const providerIcon = (id) => id === 'email'
  ? '<span class="p-email" aria-hidden="true">@</span>'
  : `<span class="p-icon" style="-webkit-mask-image:url('assets/icons/${id}.svg');mask-image:url('assets/icons/${id}.svg')" aria-hidden="true"></span>`;

const state = {
  token: null,
  data: null,
  lastOk: 0,
  error: null,
  timer: null,
  seenSpins: null,
  usersSig: '',
  chartSig: '',
  search: '',
};

// Das Admin-Token liegt nur im Arbeitsspeicher (state.token), nie im Browser-Speicher: Neu laden
// heißt neu einloggen. Früher gespeicherte Tokens werden beim Start gelöscht.
const session = {
  clear() { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* privat */ } },
};

// ============================================================
// Backend
// ============================================================
async function call(action, extra = {}) {
  if (isDemo) return demoCall(action, extra);
  const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_ANON_KEY },
    body: JSON.stringify({ action, token: state.token, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? data.message ?? `Fehler ${res.status}`);
    err.status = res.status;
    // Altes Token ohne Zwei-Faktor-Code: erst einrichten
    if (res.status === 403 && data.mfa_setup && action !== 'mfa_setup') { clearTimeout(state.timer); showMfaSetup(); }
    throw err;
  }
  return data;
}

// Demo: liest die Daten, die die Webseite im selben Browser gespeichert hat
function demoCall(action, extra) {
  const read = (k, f) => { try { return JSON.parse(localStorage.getItem(`zd_${k}`)) ?? f; } catch { return f; } };
  // Demo: Passwort „demo“, Zwei-Faktor-Code 123456
  const mfaOn = read('admin_mfa_on', false);
  if (action === 'login') {
    if (extra.password !== 'demo' || (mfaOn && String(extra.code ?? '').replace(/\s+/g, '') !== '123456')) {
      const e = new Error(mfaOn ? 'Passwort oder Code falsch. (Demo: „demo“ und 123456)' : 'Falsches Passwort. (Demo: „demo“)');
      e.status = 401;
      throw e;
    }
    return { token: demoToken(mfaOn), expires_at: new Date(Date.now() + 12 * 3600e3).toISOString(), mfa: mfaOn };
  }
  if (action === 'messages') return { messages: read('contact_messages', []) };
  if (action === 'message_set') {
    const list = read('contact_messages', []);
    const next = extra.delete ? list.filter((m) => m.id !== extra.id) : list.map((m) => (m.id === extra.id ? { ...m, status: extra.status } : m));
    localStorage.setItem('zd_contact_messages', JSON.stringify(next));
    return { ok: true };
  }
  if (action === 'mfa_setup') return { secret: 'DEMODEMODEMODEMODEMODEMODEMODEMO', qr: '', uri: '' };
  if (action === 'mfa_enable') {
    if (String(extra.code ?? '').replace(/\s+/g, '') !== '123456') throw new Error('Der Code passt nicht. (Demo: 123456)');
    localStorage.setItem('zd_admin_mfa_on', 'true');
    return { token: demoToken(true), mfa: true };
  }
  if (action === 'security_report') {
    return { checks: [
      { id: 'rls', title: 'Tabellen ohne Row Level Security', level: 'ok', items: [] },
      { id: 'secrets', title: 'Geheime Tabellen für Besucher lesbar (nur RLS schützt)', level: 'ok', items: [] },
      { id: 'rate_limit', title: 'Rate-Limit für die API (db-pre-request)', level: 'ok', items: ['pgrst.db_pre_request=public.api_guard'] },
      { id: 'mfa', title: 'Streamer ohne Zwei-Faktor-Anmeldung', level: 'info', items: ['1 von 2'] },
    ] };
  }
  if (action === 'set_admin') {
    const users = read('users', {});
    if (users[extra.user_id]) users[extra.user_id].is_admin = extra.is_admin;
    localStorage.setItem('zd_users', JSON.stringify(users));
    return { ok: true };
  }
  if (action === 'twitch_check') return { found: false, status: 'im Demo-Modus nicht verfügbar' };
  if (action === 'channels' || action === 'channel_status') {
    const list = read('channels', null) ?? [
      { id: 'demo-default', login: 'streamhelp', display_name: 'StreamHelp', status: 'active', is_default: true },
      { id: 'demo-retro', login: 'retrolena', display_name: 'RetroLena', status: 'active', is_default: false },
    ];
    if (action === 'channel_status') {
      const c = list.find((x) => x.id === extra.channel_id);
      if (c?.is_default && extra.status !== 'active') throw new Error('Der Standard-Kanal bleibt immer aktiv.');
      if (c) Object.assign(c, { status: extra.status, admin_note: extra.note ?? c.admin_note ?? '' });
      localStorage.setItem('zd_channels', JSON.stringify(list));
    }
    return { channels: list.map((c) => ({ note: '', admin_note: '', owner: c.owner ?? '', connected: false, created_at: c.created_at ?? new Date().toISOString(), ...c })) };
  }
  if (action === 'channel_moderate') {
    const list = read('channels', null) ?? demoCall('channels', {}).channels;
    const now = Date.now();
    const at = (min) => (min ? new Date(now + min * 60000).toISOString() : '9999-12-31T00:00:00+00:00');
    for (const c of list.filter((x) => extra.channel_ids.includes(x.id))) {
      if (extra.mod_action === 'timeout') { if (!c.is_default) Object.assign(c, { blocked_until: at(extra.minutes), admin_note: extra.reason || c.admin_note || '' }); }
      if (extra.mod_action === 'untimeout') c.blocked_until = null;
      if (extra.mod_action === 'overlay_off') Object.assign(c, { overlay_off_until: at(extra.minutes), overlay_off_reason: extra.reason ?? '' });
      if (extra.mod_action === 'overlay_on') Object.assign(c, { overlay_off_until: null, overlay_off_reason: '' });
      if (extra.mod_action === 'warn') Object.assign(c, { warning: extra.reason, warning_at: new Date().toISOString(), warning_seen_at: null });
      if (extra.mod_action === 'unwarn') Object.assign(c, { warning: null, warning_at: null, warning_seen_at: null });
    }
    localStorage.setItem('zd_channels', JSON.stringify(list));
    return demoCall('channels', {});
  }
  if (['platform_state', 'platform_switch', 'platform_maintenance', 'platform_reload', 'update_post', 'update_delete'].includes(action)) {
    const p = read('platform_state', { overlays_off: false, bots_off: false, maint_on: false });
    const until = (min) => (min ? new Date(Date.now() + min * 60000).toISOString() : null);
    if (action === 'platform_switch') Object.assign(p, { [`${extra.what}_off`]: extra.minutes !== 0, [`${extra.what}_until`]: until(extra.minutes), [`${extra.what}_reason`]: extra.reason ?? '' });
    if (action === 'platform_maintenance') Object.assign(p, { maint_on: extra.minutes !== 0, maint_until: until(extra.minutes), maint_message: extra.message ?? '', maint_overlays_off: !!extra.overlays_off });
    if (action === 'platform_reload') p.reload_at = new Date().toISOString();
    let updates = read('platform_updates', []);
    if (action === 'update_post') updates = [...updates, { id: Date.now(), title: extra.title, body: extra.body, created_at: new Date().toISOString() }];
    if (action === 'update_delete') updates = updates.filter((u) => u.id !== extra.id);
    localStorage.setItem('zd_platform_state', JSON.stringify(p));
    localStorage.setItem('zd_platform_updates', JSON.stringify(updates));
    return { platform: { ...p, updates: updates.slice().reverse().map((u) => ({ ...u, reads: 0 })) } };
  }
  if (action === 'bot_start') throw new Error('Im Demo-Modus nicht verfügbar. Der Chat-Bot braucht Supabase und Twitch.');
  if (action === 'bot_disconnect') return { ok: true };
  // Demo: Bot-Protokoll mit einem blockierten Eintrag
  if (action === 'bot_log') {
    const at = (min) => new Date(Date.now() - min * 60000).toISOString();
    const all = [
      { id: 4, created_at: at(2), bot: 'streamhelpbot', text: '🏆 Fortnite Cup: Anmeldung offen!', status: 'sent', reason: '', source: 'outbox', ms: 210, channel: 'RetroLena' },
      { id: 3, created_at: at(6), bot: 'streamhelpbot2', text: 'Schau mal: https://beispiel.de', status: 'dropped', reason: 'Die Nachricht enthält einen blockierten Link.', source: 'chat', ms: 140, channel: 'NightOwl_Mia' },
      { id: 2, created_at: at(9), bot: 'streamhelpbot', text: '@Ben Du hast 5 Std 2 Min zugeschaut.', status: 'sent', reason: '', source: 'chat', ms: 180, channel: 'RetroLena' },
    ];
    return {
      items: extra.problems ? all.filter((i) => i.status !== 'sent') : all,
      channels: [
        { channel: 'NightOwl_Mia', bot_slot: 2, sent: 31, failed: 1, avg_ms: 175, last_at: at(6) },
        { channel: 'RetroLena', bot_slot: 1, sent: 58, failed: 0, avg_ms: 190, last_at: at(2) },
      ],
    };
  }
  if (action === 'site_session') {
    const users = read('users', {});
    users['stellwerk-admin@example.com'] = { username: 'StreamHelp-Admin', pass: null, is_admin: true };
    localStorage.setItem('zd_users', JSON.stringify(users));
    return { token_hash: 'stellwerk-admin@example.com' };
  }
  const spins = read('spins', []);
  const users = Object.entries(read('users', {})).map(([email, u]) => ({
    id: email, email, username: u.username, is_admin: !!u.is_admin,
    created_at: null, last_sign_in_at: null, confirmed: true,
  }));
  const twitch = spins.filter((s) => s.source === 'twitch').length;
  return {
    now: new Date().toISOString(),
    stats: { users: users.length, spins_total: spins.length, spins_twitch: twitch, points_spent: twitch * 10000 },
    spins_recent: spins.slice(0, 40),
    spins_14d: spins,
    variants: DEFAULT_VARIANTS.map(({ id, name, color }) => ({ id, name, color })),
    users,
    twitch: null,
    twitch_bots: [{ id: 1, login: 'streamhelpbot', display_name: 'StreamHelpBot' }],
    bot_channels: { 1: 2, 2: 0 },
  };
}

// Demo-Token im selben Aufbau wie das echte (Inhalt.Signatur), damit tokenMfa() es lesen kann
function demoToken(mfa) {
  return `${btoa(JSON.stringify({ exp: Date.now() + 12 * 3600e3, mfa })).replace(/=+$/, '')}.demo`;
}

// Mit Zwei-Faktor-Code angemeldet? (Inhalt des Tokens; die Edge Function prüft es selbst noch einmal)
function tokenMfa(token) {
  try {
    const part = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4))).mfa === true;
  } catch {
    return false;
  }
}

// ============================================================
// Start / Login
// ============================================================
if (guardFrame()) init();

function init() {
  if (isDemo) $('#demo-banner').hidden = false;
  $('#admin-form').addEventListener('submit', onLogin);
  $('#mfa-form').addEventListener('submit', onMfaEnable);
  $('#mfa-cancel').addEventListener('click', () => logout());
  $('#security-check').addEventListener('click', checkSecurity);
  $('#inbox-done').addEventListener('change', renderInbox);
  $('#inbox').addEventListener('click', inboxClick);
  $('#logout-btn').addEventListener('click', () => logout());
  $('#twitch-check').addEventListener('click', checkTwitch);
  $('#site-btn').addEventListener('click', openSiteAsAdmin);
  $('#bot-slots').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-bot]');
    if (!btn) return;
    const slot = Number(btn.dataset.slot) === 2 ? 2 : 1;
    if (btn.dataset.bot === 'connect') connectBot(slot, btn);
    else disconnectBot(slot, btn);
  });
  $('#botlog-load').addEventListener('click', loadBotLog);
  $('#botlog-problems').addEventListener('change', loadBotLog);
  showBotReturn();
  $('#users-search').addEventListener('input', (e) => { state.search = e.target.value.trim().toLowerCase(); state.usersSig = ''; renderUsers(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.token) refresh();
  });
  setInterval(updateLiveLabel, 1000);

  session.clear();
  loadProviders();
  showLogin();
}

function showLogin(message) {
  $('#admin-app').hidden = true;
  $('#admin-mfa').hidden = true;
  $('#admin-login').hidden = false;
  const msg = $('#admin-form .form-msg');
  msg.textContent = message ?? '';
  $('#admin-form input[name="password"]').focus();
}

async function onLogin(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const msg = form.querySelector('.form-msg');
  const password = form.password.value;
  const code = form.code.value.replace(/\s+/g, '');
  if (!password) { msg.textContent = 'Bitte das Admin-Passwort eingeben.'; return; }
  msg.textContent = '';
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    const { token, mfa, mfa_missing: mfaMissing } = await call('login', { password, code });
    state.token = token;
    form.reset();
    if (mfa === false) { showMfaSetup(); return; }
    showApp();
    if (mfaMissing) toast('Zwei-Faktor-Code noch nicht möglich: In Supabase fehlt die Migration supabase/migrations/20261031000000_security.sql.', 'error', 9000);
  } catch (err) {
    msg.textContent = err.status === 404
      ? 'Die Admin-Funktion ist noch nicht in Supabase hochgeladen (setup-supabase.ps1 ausführen).'
      : err.message;
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

function logout(message) {
  clearTimeout(state.timer);
  state.token = null;
  state.data = null;
  state.seenSpins = null;
  state.usersSig = '';
  state.chartSig = '';
  session.clear();
  showLogin(message);
}

// Meldet auf der Webseite mit dem internen Admin-Account an (ohne Registrierung).
// Der Einmal-Code geht über sessionStorage, nicht über die URL. Die Webseite öffnet in einem neuen
// Tab (er bekommt eine Kopie des sessionStorage) – so bleibt dieser Tab angemeldet.
async function openSiteAsAdmin() {
  const btn = $('#site-btn');
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    const { token_hash } = await call('site_session');
    sessionStorage.setItem('zd_admin_site', token_hash);
    const win = window.open('./', '_blank');
    if (!win) { location.href = './'; return; } // Pop-up blockiert: im selben Tab
    sessionStorage.removeItem('zd_admin_site');
    btn.disabled = false;
    btn.classList.remove('is-loading');
  } catch (err) {
    if (err.status === 401) { logout(err.message); return; }
    toast(`Webseite konnte nicht geöffnet werden: ${err.message}`, 'error', 6000);
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

// Pflicht: Ohne eingerichteten Zwei-Faktor-Code gilt das Token nur hierfür
async function showMfaSetup() {
  $('#admin-app').hidden = true;
  $('#admin-login').hidden = true;
  $('#admin-mfa').hidden = false;
  const form = $('#mfa-form');
  const msg = form.querySelector('.form-msg');
  msg.textContent = '';
  try {
    const { secret, qr } = await call('mfa_setup');
    $('#mfa-secret').textContent = secret.replace(/(.{4})/g, '$1 ').trim();
    const img = $('#mfa-qr');
    img.hidden = !qr;
    // SVG als Bild (nicht als HTML einsetzen)
    if (qr) img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`;
    form.code.focus();
  } catch (err) {
    if (err.status === 401) { logout(err.message); return; }
    if (err.status === 409) { logout('Der Zwei-Faktor-Code ist schon eingerichtet. Bitte mit Passwort und Code einloggen.'); return; }
    msg.textContent = err.message;
  }
}

async function onMfaEnable(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const msg = form.querySelector('.form-msg');
  const code = form.code.value.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) { msg.textContent = 'Bitte die 6 Ziffern aus der App eingeben.'; return; }
  btn.disabled = true;
  try {
    const { token } = await call('mfa_enable', { code });
    state.token = token;
    form.reset();
    toast('Zwei-Faktor-Code ist eingerichtet. Ab jetzt beim Einloggen immer mit angeben.', 'ok', 7000);
    showApp();
  } catch (err) {
    if (err.status === 401) { logout(err.message); return; }
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// Sicherheits-Check der Datenbank (security_report, Migration …_security.sql)
const CHECK_LEVEL = { ok: ['chip--ok', '✓ OK'], warn: ['chip--warn', '⚠️ Prüfen'], error: ['chip--bad', '✗ Problem'], info: ['', 'ℹ️ Info'] };
async function checkSecurity() {
  const btn = $('#security-check');
  const list = $('#security');
  btn.disabled = true;
  try {
    const { checks } = await call('security_report');
    list.replaceChildren(...checks.map((c) => {
      const [cls, label] = CHECK_LEVEL[c.level] ?? ['', c.level];
      const li = document.createElement('li');
      const chip = document.createElement('span');
      chip.className = `chip ${cls}`;
      chip.textContent = label;
      const title = document.createElement('b');
      title.textContent = c.title;
      li.append(chip, title);
      if (c.items?.length) {
        const small = document.createElement('small');
        small.textContent = c.items.join(', ');
        li.append(small);
      }
      return li;
    }));
  } catch (err) {
    if (err.status === 401) { logout(err.message); return; }
    list.replaceChildren(Object.assign(document.createElement('li'), { className: 'muted', textContent: err.message }));
  } finally {
    btn.disabled = false;
  }
}

// ---------- Postfach: Kontaktformular der Startseite ----------
const TOPICS = { question: 'Frage', bug: 'Fehler', idea: 'Idee', channel: 'Kanal', privacy: 'Datenschutz', other: 'Sonstiges' };
async function loadInbox() {
  try {
    const { messages } = await call('messages');
    state.inbox = messages ?? [];
    state.inboxNote = '';
  } catch (err) {
    if (err.status === 401) return;
    state.inbox = [];
    state.inboxNote = err.message;
  }
  renderInbox();
}

function renderInbox() {
  const list = $('#inbox');
  const all = state.inbox ?? [];
  const open = all.filter((m) => m.status !== 'done');
  $('#inbox-count').textContent = all.length ? `(${open.length} neu)` : '';
  const shown = $('#inbox-done').checked ? all : open;
  if (!shown.length) {
    list.replaceChildren(Object.assign(document.createElement('li'), { className: 'muted', textContent: state.inboxNote || 'Keine neuen Nachrichten.' }));
    return;
  }
  list.replaceChildren(...shown.map((m) => {
    const li = document.createElement('li');
    li.className = `inbox-item${m.status === 'done' ? ' is-done' : ''}`;
    const head = document.createElement('div');
    head.className = 'inbox-head';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = TOPICS[m.topic] ?? m.topic;
    const who = document.createElement('b');
    who.textContent = m.name || 'Ohne Namen';
    const meta = document.createElement('small');
    meta.className = 'muted';
    meta.textContent = [new Date(m.created_at).toLocaleString('de-DE'), m.lang?.toUpperCase(), m.channel ? `Kanal ${m.channel}` : ''].filter(Boolean).join(' · ');
    head.append(chip, who, meta);
    const text = document.createElement('p');
    text.className = 'inbox-text';
    text.textContent = m.message;
    const actions = document.createElement('div');
    actions.className = 'inbox-actions';
    if (m.email) {
      const mail = document.createElement('a');
      mail.className = 'btn btn--primary btn--sm';
      mail.href = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent('Re: deine Nachricht an StreamHelp')}`;
      mail.textContent = `Antworten an ${m.email}`;
      actions.append(mail);
    }
    const mk = (label, data) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn--ghost btn--sm', textContent: label });
      Object.assign(b.dataset, data);
      return b;
    };
    const toggle = mk(m.status === 'done' ? 'Wieder offen' : 'Erledigt', { inbox: String(m.id), status: m.status === 'done' ? 'new' : 'done' });
    const del = mk('Löschen', { inbox: String(m.id), del: '1' });
    actions.append(toggle, del);
    li.append(head, text, actions);
    return li;
  }));
}

async function inboxClick(e) {
  const btn = e.target.closest('button[data-inbox]');
  if (!btn) return;
  const id = Number(btn.dataset.inbox);
  if (btn.dataset.del && !confirm('Diese Nachricht endgültig löschen?')) return;
  btn.disabled = true;
  try {
    await call('message_set', btn.dataset.del ? { id, delete: true } : { id, status: btn.dataset.status });
    await loadInbox();
  } catch (err) {
    if (err.status === 401) { logout(err.message); return; }
    toast(err.message, 'error');
    btn.disabled = false;
  }
}

function showApp() {
  $('#admin-login').hidden = true;
  $('#admin-mfa').hidden = true;
  $('#admin-app').hidden = false;
  loadInbox();
  refresh();
  loadChannels();
  loadPlatform();
}

// ============================================================
// Streamer-Kanäle: Bewerbungen freischalten (Migration …_platform.sql)
// ============================================================
const CHANNEL_STATUS = {
  pending: ['chip--warn', '⏳ Wartet'],
  active: ['chip--ok', '✓ Freigeschaltet'],
  blocked: ['chip--bad', '🚫 Gesperrt'],
};

async function loadChannels() {
  try {
    const data = await call('channels');
    state.channels = data.channels ?? [];
    $('#channels-note').textContent = '';
  } catch (err) {
    if (err.status === 401) return;
    state.channels = [];
    $('#channels-note').textContent = err.message;
  }
  renderChannels();
}

function renderChannels() {
  const list = state.channels ?? [];
  const pending = list.filter((c) => c.status === 'pending').length;
  $('#channels-count').textContent = list.length ? `(${nf.format(list.length)}${pending ? ` · ${pending} warten` : ''})` : '';
  const tbody = $('#channels');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Noch keine Kanäle.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((c) => {
    const [cls, label] = CHANNEL_STATUS[c.status] ?? ['', c.status];
    const actions = [];
    if (c.status !== 'active') actions.push(`<button class="btn btn--primary btn--sm" type="button" data-channel="${escapeAttr(c.id)}" data-status="active">Freischalten</button>`);
    if (c.status !== 'blocked' && !c.is_default) actions.push(`<button class="btn btn--ghost btn--sm" type="button" data-channel="${escapeAttr(c.id)}" data-status="blocked">Sperren</button>`);
    if (c.status === 'active' && !c.is_default) actions.push(`<button class="btn btn--ghost btn--sm" type="button" data-channel="${escapeAttr(c.id)}" data-status="pending">Zurückstellen</button>`);
    const mods = [];
    if (c.blocked_until) mods.push(`<span class="chip chip--bad ch-mod">⏱️ Timeout bis ${escapeHtml(fmtUntil(c.blocked_until))}</span>`);
    if (c.overlay_off_until) mods.push(`<span class="chip chip--warn ch-mod">📺 Overlay aus ${c.overlay_off_until.startsWith('9999') ? 'bis zum Aufheben' : `bis ${escapeHtml(fmtUntil(c.overlay_off_until))}`}</span>`);
    if (c.warning) mods.push(`<span class="chip chip--warn ch-mod" title="${escapeAttr(c.warning)}">⚠️ Verwarnt${c.warning_seen_at && c.warning_seen_at >= c.warning_at ? ' · gelesen' : ' · ungelesen'}</span>`);
    return `
    <tr>
      <td><input type="checkbox" data-pick="${escapeAttr(c.id)}" aria-label="${escapeAttr(c.display_name || c.login || 'Kanal')} auswählen"${state.picked?.has(c.id) ? ' checked' : ''}></td>
      <td><span class="u-name"><span class="avatar" aria-hidden="true">${escapeHtml((c.display_name || c.login || '?').slice(0, 1).toUpperCase())}</span>
        <span>${escapeHtml(c.display_name || c.login || '–')}${c.is_default ? ' <span class="chip">Standard</span>' : ''}<br>
        <small class="muted">${c.login ? `twitch.tv/${escapeHtml(c.login)}` : ''}${c.owner ? ` · Konto: ${escapeHtml(c.owner)}` : ''}</small></span></span></td>
      <td><span class="chip ${cls}">${label}</span>${mods.join('')}${c.admin_note ? `<br><small class="muted">${escapeHtml(c.admin_note)}</small>` : ''}</td>
      <td class="muted">${escapeHtml(c.note || '–')}</td>
      <td class="mono">${fmtDate(c.created_at)}</td>
      <td>${c.connected ? '<span class="chip chip--ok">verbunden</span>' : '<span class="muted">–</span>'}</td>
      <td><span class="channel-actions">${actions.join('') || '–'}</span></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('button[data-status]').forEach((btn) => btn.addEventListener('click', () => setChannelStatus(btn)));
  tbody.querySelectorAll('input[data-pick]').forEach((box) => box.addEventListener('change', () => {
    state.picked ??= new Set();
    if (box.checked) state.picked.add(box.dataset.pick); else state.picked.delete(box.dataset.pick);
    paintBulk();
  }));
  paintBulk();
}

// ---------- Mehrere Kanäle moderieren (Migration …_channel_moderation.sql) ----------
const fmtUntil = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function paintBulk() {
  const ids = [...(state.picked ?? [])].filter((id) => (state.channels ?? []).some((c) => c.id === id));
  state.picked = new Set(ids);
  $('#ch-bulk-count').textContent = ids.length ? `${ids.length} Kanal${ids.length === 1 ? '' : 'e'} ausgewählt` : 'Keine Kanäle ausgewählt';
  $('#ch-bulk').classList.toggle('has-selection', ids.length > 0);
  const all = $('#ch-all');
  all.checked = ids.length > 0 && ids.length === (state.channels ?? []).length;
  all.indeterminate = ids.length > 0 && !all.checked;
}

const BULK_TEXT = {
  timeout: ['⏱️ Timeout', 'gesperrt'], overlay_off: ['📺 Overlay aus', 'Overlay pausiert'], warn: ['⚠️ Verwarnung', 'verwarnt'],
  untimeout: ['Timeout aufheben', 'Timeout aufgehoben'], overlay_on: ['Overlay an', 'Overlay läuft wieder'], unwarn: ['Verwarnung weg', 'Verwarnung entfernt'],
};

async function bulkModerate(btn) {
  const action = btn.dataset.bulk;
  const ids = [...(state.picked ?? [])];
  if (!ids.length) { toast('Erst Kanäle auswählen (Häkchen links).', 'error'); return; }
  const minutes = $('#ch-bulk-minutes').value;
  const reason = $('#ch-bulk-reason').value.trim();
  if (action === 'timeout' && !minutes) { toast('Für einen Timeout bitte eine Dauer wählen.', 'error'); return; }
  if (action === 'warn' && !reason) { toast('Bitte den Text der Verwarnung eintragen.', 'error'); return; }
  const names = ids.map((id) => state.channels.find((c) => c.id === id)).map((c) => c?.display_name || c?.login).join(', ');
  const dur = minutes ? $('#ch-bulk-minutes').selectedOptions[0].textContent : 'bis zum Aufheben';
  const what = { timeout: `${dur} sperren`, overlay_off: `Overlay ${dur} pausieren`, warn: 'verwarnen' }[action];
  if (what && !confirm(`${names}: ${what}?${reason ? `\n\nText: ${reason}` : ''}`)) return;
  btn.disabled = true;
  try {
    const data = await call('channel_moderate', {
      channel_ids: ids, mod_action: action, minutes: ['timeout', 'overlay_off'].includes(action) && minutes ? Number(minutes) : null, reason,
    });
    state.channels = data.channels ?? state.channels;
    renderChannels();
    toast(`${ids.length} Kanal${ids.length === 1 ? '' : 'e'}: ${BULK_TEXT[action][1]}.`, 'ok');
  } catch (err) {
    toast(err.message, 'error', 7000);
  } finally {
    btn.disabled = false;
  }
}

document.querySelectorAll('#ch-bulk [data-bulk]').forEach((btn) => btn.addEventListener('click', () => bulkModerate(btn)));
$('#ch-all')?.addEventListener('change', (e) => {
  state.picked = new Set(e.target.checked ? (state.channels ?? []).filter((c) => !c.is_default).map((c) => c.id) : []);
  renderChannels();
});

// ---------- Plattform steuern: Notfall-Schalter, Wartung, Neu laden, Neuigkeiten ----------
async function loadPlatform() {
  try {
    const data = await call('platform_state');
    state.platformState = data.platform;
    $('#platform-note').textContent = '';
  } catch (err) {
    if (err.status === 401) return;
    $('#platform-note').textContent = err.message;
  }
  renderPlatform();
}

function renderPlatform() {
  const p = state.platformState;
  if (!p) return;
  const until = (iso) => (iso ? `bis ${fmtUntil(iso)}` : 'bis zum Aufheben');
  for (const [key, label] of [['overlays', 'pausiert'], ['bots', 'stumm']]) {
    const box = document.querySelector(`[data-switch="${key}"]`);
    const on = p[`${key}_off`];
    box.classList.toggle('is-on', !!on);
    box.querySelector('[data-state]').textContent = on ? `🔴 ${label} ${until(p[`${key}_until`])}${p[`${key}_reason`] ? ` – ${p[`${key}_reason`]}` : ''}` : '🟢 läuft normal';
  }
  const m = $('#pf-maint');
  m.classList.toggle('is-on', !!p.maint_on);
  m.querySelector('[data-state]').textContent = p.maint_on
    ? `🔴 Wartung ${until(p.maint_until)}${p.maint_overlays_off ? ' · Overlays leer' : ''}${p.maint_message ? ` – ${p.maint_message}` : ''}` : '🟢 keine Wartung';
  $('#pf-reload [data-state]').textContent = p.reload_at ? `Zuletzt ausgerollt: ${fmtUntil(p.reload_at)}` : 'Noch nie ausgerollt';
  const list = $('#pf-updates');
  list.innerHTML = (p.updates ?? []).map((u) => `
    <li><b>${escapeHtml(u.title)}</b><span><small>${escapeHtml(fmtUntil(u.created_at))} · ${nf.format(u.reads ?? 0)}× gelesen</small>
      <button class="btn btn--ghost btn--sm" type="button" data-update-del="${escapeAttr(u.id)}">Löschen</button></span>
      <p>${escapeHtml(u.body)}</p></li>`).join('') || '<li class="muted">Noch keine Neuigkeiten.</li>';
  list.querySelectorAll('[data-update-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Diese Neuigkeit löschen?')) return;
    await platformCall(btn, 'update_delete', { id: Number(btn.dataset.updateDel) }, 'Gelöscht.');
  }));
}

async function platformCall(btn, action, extra, okText) {
  btn.disabled = true;
  try {
    const data = await call(action, extra);
    state.platformState = data.platform ?? state.platformState;
    renderPlatform();
    if (okText) toast(okText, 'ok');
    return true;
  } catch (err) {
    toast(err.message, 'error', 7000);
    return false;
  } finally {
    btn.disabled = false;
  }
}

document.querySelectorAll('[data-switch]').forEach((box) => {
  const what = box.dataset.switch;
  const label = what === 'overlays' ? 'Alle Overlays pausieren' : 'Den Chat-Bot in allen Kanälen stummschalten';
  box.querySelector('[data-on]').addEventListener('click', (e) => {
    const minutes = box.querySelector('[data-minutes]').value;
    if (!confirm(`${label} – ${minutes ? box.querySelector('[data-minutes]').selectedOptions[0].textContent : 'bis zum Aufheben'}?`)) return;
    platformCall(e.currentTarget, 'platform_switch', { what, minutes: minutes ? Number(minutes) : null, reason: box.querySelector('[data-reason]').value.trim() },
      what === 'overlays' ? 'Alle Overlays pausiert.' : 'Chat-Bot überall stumm.');
  });
  box.querySelector('[data-off]').addEventListener('click', (e) => platformCall(e.currentTarget, 'platform_switch', { what, minutes: 0 }, 'Aufgehoben.'));
});
$('#pf-maint [data-on]')?.addEventListener('click', (e) => {
  const box = $('#pf-maint');
  const minutes = box.querySelector('[data-minutes]').value;
  platformCall(e.currentTarget, 'platform_maintenance', {
    minutes: minutes ? Number(minutes) : null, message: box.querySelector('[data-message]').value.trim(), overlays_off: box.querySelector('[data-overlays]').checked,
  }, 'Wartung läuft.');
});
$('#pf-maint [data-off]')?.addEventListener('click', (e) => platformCall(e.currentTarget, 'platform_maintenance', { minutes: 0 }, 'Wartung beendet – alle laden die neue Version.'));
$('#pf-reload [data-reload]')?.addEventListener('click', (e) => {
  if (!confirm('Alle offenen Overlays und Dashboards neu laden? (Overlays flackern einmal kurz.)')) return;
  platformCall(e.currentTarget, 'platform_reload', {}, 'Ausgerollt – alle laden innerhalb einer Minute neu.');
});
$('#pf-update-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const title = form.title.value.trim();
  const body = form.body.value.trim();
  if (!title || !body) { toast('Bitte Titel und Text eintragen.', 'error'); return; }
  if (await platformCall(form.querySelector('button[type="submit"]'), 'update_post', { title, body }, 'Veröffentlicht.')) form.reset();
});

async function setChannelStatus(btn) {
  const c = (state.channels ?? []).find((x) => x.id === btn.dataset.channel);
  const status = btn.dataset.status;
  let note = null;
  if (status === 'blocked') {
    note = prompt(`Kanal „${c?.display_name || c?.login}“ sperren. Grund (sieht der Streamer, optional):`, c?.admin_note ?? '');
    if (note === null) return;
  }
  btn.disabled = true;
  try {
    const data = await call('channel_status', { channel_id: btn.dataset.channel, status, note });
    state.channels = data.channels ?? state.channels;
    renderChannels();
    toast({ active: 'Kanal freigeschaltet – der Streamer kann jetzt loslegen.', blocked: 'Kanal gesperrt.', pending: 'Kanal zurückgestellt.' }[status], 'ok');
  } catch (err) {
    toast(`Ändern fehlgeschlagen: ${err.message}`, 'error');
    btn.disabled = false;
  }
}

// ============================================================
// Live-Aktualisierung
// ============================================================
async function refresh() {
  clearTimeout(state.timer);
  try {
    const data = await call('overview');
    state.data = data;
    state.lastOk = Date.now();
    state.error = null;
    render(data);
  } catch (err) {
    if (err.status === 401) { logout(err.message); return; }
    state.error = err.message;
    console.error(err);
  }
  updateLiveLabel();
  if (state.token && document.visibilityState === 'visible') {
    state.timer = setTimeout(refresh, POLL_MS);
  }
}

function updateLiveLabel() {
  const pill = $('#live');
  if (!pill || $('#admin-app').hidden) return;
  const text = pill.querySelector('.live-text');
  pill.classList.toggle('is-error', !!state.error);
  pill.classList.toggle('is-live', !state.error && !!state.lastOk);
  if (state.error) {
    text.textContent = 'Offline · neuer Versuch …';
  } else if (state.lastOk) {
    const s = Math.max(0, Math.round((Date.now() - state.lastOk) / 1000));
    text.textContent = s < 2 ? 'Live · gerade aktualisiert' : `Live · vor ${s} s`;
  }
}

// ============================================================
// Darstellung
// ============================================================
function render(data) {
  renderKpis(data);
  renderChart(data.spins_14d ?? []);
  renderVariants(data.spins_14d ?? [], data.variants ?? []);
  renderFeed(data.spins_recent ?? []);
  renderTwitch(data.twitch, data);
  renderUsers();
}

const nf = new Intl.NumberFormat('de-DE');

function renderKpis(data) {
  const today = startOfDay(new Date()).getTime();
  const spinsToday = (data.spins_14d ?? []).filter((s) => Date.parse(s.created_at) >= today).length;
  const cost = data.twitch?.reward_cost;
  const items = [
    ['users', 'Registrierte Nutzer', data.stats.users, ''],
    ['today', 'Drehungen heute', spinsToday, ''],
    ['total', 'Drehungen gesamt', data.stats.spins_total, ''],
    ['twitch', 'Per Kanalpunkte', data.stats.spins_twitch, 'eingelöst auf Twitch'],
    ['points', 'Kanalpunkte ausgegeben', data.stats.points_spent, cost ? `à ${nf.format(cost)} Punkte (aktueller Preis)` : 'Twitch nicht verbunden'],
  ];
  const wrap = $('#kpis');
  if (!wrap.children.length) {
    wrap.innerHTML = items.map(([key, label]) =>
      `<div class="kpi" data-key="${key}"><span class="kpi-label">${label}</span><span class="kpi-value">–</span><span class="kpi-note"></span></div>`).join('');
  }
  for (const [key, , value, note] of items) {
    const el = wrap.querySelector(`[data-key="${key}"]`);
    const v = el.querySelector('.kpi-value');
    const text = nf.format(value ?? 0);
    if (v.textContent !== text) {
      const changed = v.textContent !== '–';
      v.textContent = text;
      if (changed && !reducedMotion) { v.classList.remove('bump'); void v.offsetWidth; v.classList.add('bump'); }
    }
    el.querySelector('.kpi-note').textContent = note;
  }
}

// ---------- Säulen: Drehungen pro Tag ----------
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  // nur Maxima, deren Hälfte eine ganze Zahl ist (Mittellinie)
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p === 5 ? 6 : m * p;
  return 10 * p;
}

function renderChart(spins) {
  const today = startOfDay(new Date());
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (13 - i));
    return { date: d, twitch: 0, web: 0 };
  });
  for (const s of spins) {
    const idx = Math.round((startOfDay(new Date(s.created_at)) - days[0].date) / 86400000);
    if (idx >= 0 && idx < 14 && (s.source === 'twitch' || s.source === 'web')) days[idx][s.source]++;
  }
  // nur neu zeichnen, wenn sich etwas geändert hat (sonst springt der Tooltip)
  const sig = today.getTime() + JSON.stringify(days.map((d) => [d.twitch, d.web]));
  if (sig === state.chartSig) return;
  state.chartSig = sig;
  hideTip();

  const max = niceMax(Math.max(...days.map((d) => d.twitch + d.web)));
  const chart = $('#chart');
  const fmtDay = (d) => d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' });
  const fmtLong = (d) => d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });

  chart.innerHTML = `
    <div class="chart-grid">${[max, max / 2, 0].map((v, i) => `<div class="gl" style="top:${i * 50}%"><span>${nf.format(v)}</span></div>`).join('')}</div>
    <div class="chart-cols"></div>`;
  const cols = chart.querySelector('.chart-cols');
  days.forEach((d, i) => {
    const col = document.createElement('button');
    col.type = 'button';
    col.className = 'chart-col' + (i === 13 ? ' is-today' : '');
    col.setAttribute('aria-label', `${fmtLong(d.date)}: ${d.twitch} per Kanalpunkte, ${d.web} über die Webseite`);
    const stack = document.createElement('div');
    stack.className = 'chart-stack';
    for (const src of ['web', 'twitch']) {
      if (!d[src]) continue;
      const seg = document.createElement('div');
      seg.className = `seg seg--${src}`;
      seg.style.height = `calc(${(d[src] / max) * 100}% - ${d.web && d.twitch ? 1 : 0}px)`;
      stack.append(seg);
    }
    col.append(stack);
    if (i % 2 === 1 || i === 13) {
      const x = document.createElement('span');
      x.className = 'chart-x';
      x.textContent = i === 13 ? 'heute' : fmtDay(d.date);
      col.append(x);
    }
    const show = () => showTip(col, `
      <strong>${fmtLong(d.date)}</strong>
      <div class="row"><span class="key key--twitch"></span>Kanalpunkte<b>${d.twitch}</b></div>
      <div class="row"><span class="key key--web"></span>Webseite<b>${d.web}</b></div>
      <div class="row">Gesamt<b>${d.twitch + d.web}</b></div>`);
    col.addEventListener('mouseenter', show);
    col.addEventListener('focus', show);
    col.addEventListener('mouseleave', hideTip);
    col.addEventListener('blur', hideTip);
    cols.append(col);
  });

  $('#chart-table').innerHTML = `
    <thead><tr><th>Tag</th><th>Kanalpunkte</th><th>Webseite</th><th>Gesamt</th></tr></thead>
    <tbody>${days.slice().reverse().map((d) => `<tr><td>${fmtLong(d.date)}</td><td>${d.twitch}</td><td>${d.web}</td><td>${d.twitch + d.web}</td></tr>`).join('')}</tbody>`;
}

function showTip(anchor, html) {
  const tip = $('#chart-tip');
  tip.innerHTML = html;
  tip.hidden = false;
  const r = anchor.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), innerWidth - tw - 8);
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
}
function hideTip() { $('#chart-tip').hidden = true; }

// ---------- Balken: Varianten ----------
function renderVariants(spins, variants) {
  const wrap = $('#variants');
  const counts = new Map(variants.map((v) => [v.id, 0]));
  for (const s of spins) counts.set(s.variant_id, (counts.get(s.variant_id) ?? 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) {
    wrap.innerHTML = '<p class="empty-note">Noch keine Drehungen in den letzten 14 Tagen.</p>';
    return;
  }
  const max = Math.max(...counts.values());
  wrap.innerHTML = variants.map((v) => {
    const n = counts.get(v.id) ?? 0;
    const pct = Math.round((n / total) * 100);
    return `<div class="hbar" style="--c:${escapeAttr(v.color)}">
      <span class="hbar-name">${escapeHtml(v.name)}</span>
      <span class="hbar-val">${nf.format(n)} · ${pct} %</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${max ? (n / max) * 100 : 0}%"></div></div>
    </div>`;
  }).join('');
}

// ---------- Live-Feed ----------
function renderFeed(spins) {
  const list = $('#feed');
  if (!spins.length) {
    list.innerHTML = '<li class="empty-note" style="background:none">Noch keine Drehungen.</li>';
    state.seenSpins = new Set();
    return;
  }
  const firstRender = state.seenSpins === null;
  const seen = state.seenSpins ?? new Set();
  list.innerHTML = spins.map((s) => {
    const isNew = !firstRender && !seen.has(s.id);
    return `<li class="${isNew ? 'is-new' : ''}">
      <span class="src src--${s.source === 'twitch' ? 'twitch' : 'web'}">${s.source === 'twitch' ? 'Twitch' : 'Web'}</span>
      <span class="f-main"><strong>${escapeHtml(s.bonus_result ? `${s.result} · ${s.bonus_result}` : s.result)}</strong><small>${escapeHtml(s.variant_name)} · ${escapeHtml(s.requested_by)}</small></span>
      <time datetime="${escapeAttr(s.created_at)}" title="${escapeAttr(new Date(s.created_at).toLocaleString('de-DE'))}">${relTime(s.created_at)}</time>
    </li>`;
  }).join('');
  state.seenSpins = new Set(spins.map((s) => s.id));
}

// ---------- Twitch ----------
function renderTwitch(t, data = {}) {
  const chip = (kind, label) => `<span class="chip chip--${kind}">${kind === 'ok' ? '✓' : kind === 'bad' ? '✕' : '!'} ${label}</span>`;
  const rows = [];
  if (!t) {
    rows.push(['Kanal', `${chip('bad', 'Nicht verbunden')}<br><small class="muted">Der Streamer muss sich auf der Webseite mit Twitch verbinden.</small>`]);
  } else {
    const exp = Date.parse(t.expires_at);
    rows.push(['Kanal', `${chip('ok', 'Verbunden')} ${escapeHtml(t.display_name ?? t.broadcaster_login)}`]);
    rows.push(['Belohnung', t.reward_id
      ? `${chip('ok', 'Aktiv')} „${escapeHtml(t.reward_title ?? 'Glücksrad')}“ · ${nf.format(t.reward_cost ?? 0)} Punkte`
      : chip('bad', 'Fehlt')]);
    rows.push(['Webhook', t.subscription_id ? chip('ok', 'Registriert') : `${chip('bad', 'Fehlt')} neu verbinden`]);
    rows.push(['Zugriffstoken', exp > Date.now()
      ? `${chip('ok', 'Gültig')} bis ${new Date(exp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
      : `${chip('warn', 'Abgelaufen')} wird beim nächsten Einsatz erneuert`]);
    rows.push(['Rechte', (t.scopes ?? []).map((s) => `<code>${escapeHtml(s)}</code>`).join(' ') || '–']);
  }
  // Automatischer Gesundheitscheck (Dashboard, alle 30 Minuten per GitHub Action)
  const h = data.twitch_health;
  if (h?.checked_at) {
    const when = new Date(h.checked_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const problems = (h.problems ?? []).filter((p) => p.level === 'error');
    rows.push(['Gesundheit', problems.length
      ? `${chip('bad', `${problems.length} ${problems.length === 1 ? 'Problem' : 'Probleme'}`)} <small class="muted">geprüft ${when}</small>${problems.map((p) => `<br><small>✕ ${escapeHtml(p.text)} → <b>${escapeHtml(p.fix ?? '')}</b></small>`).join('')}`
      : `${chip('ok', 'Alles läuft')} <small class="muted">geprüft ${when}</small>`]);
    rows.push(['Letztes Ereignis', h.last_event_at
      ? `${new Date(h.last_event_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} <small class="muted">${escapeHtml(h.last_event_type ?? '')}</small>`
      : '<small class="muted">Von Twitch kam noch nichts an.</small>']);
  }
  $('#twitch-panel').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('#twitch-check').disabled = !t;
  renderBot(t, data);
}

// ---------- Chat-Bots ----------
// Chat-Nachrichten schreibt ein eigener Twitch-Account, nie der Streamer selbst. Es gibt zwei Plätze
// (Migration …_bot_stats.sql); jeder Kanal wählt im Dashboard, welcher bei ihm schreibt, und ist einer
// nicht verbunden, springt der andere ein. Verbunden werden sie nur hier im Admin-Bereich.
function renderBot(t, data) {
  const text = $('#bot-text');
  const box = $('#bot-slots');
  if (data.twitch_bot_ready === false) {
    text.innerHTML = '<b>Chat-Bot:</b> In der Datenbank fehlt noch die Erweiterung. Im SQL Editor <code>supabase/migrations/20260923120000_chat_bot.sql</code> ausführen.';
    box.replaceChildren();
    return;
  }
  const bots = data.twitch_bots ?? (data.twitch_bot ? [{ id: 1, ...data.twitch_bot }] : []);
  const uses = data.bot_channels ?? null;
  const scopeOk = !t || (t.scopes ?? []).includes('channel:bot');
  text.innerHTML = bots.length
    ? `<b>Chat-Bots:</b> ${bots.length === 2 ? 'beide verbunden' : 'einer verbunden – der zweite ist Ersatz und zweite Wahl für Streamer'}.` +
      (scopeOk ? '' : ' <br>Damit ein Bot im Chat des Streamers schreiben darf, muss der Streamer Twitch auf der Webseite einmal neu verbinden.')
    : '<b>Chat-Bot:</b> keiner verbunden – ohne Bot bleibt der Chat still. Vorher auf twitch.tv mit dem <b>Bot-Account</b> anmelden (nicht mit dem des Streamers), dann hier verbinden.';
  box.innerHTML = [1, 2].map((slot) => {
    const bot = bots.find((b) => b.id === slot);
    const n = uses ? uses[slot] ?? 0 : null;
    return `<div class="bot-slot${bot ? ' is-on' : ''}">
      <div><b>Bot ${slot}</b> · ${bot ? `${escapeHtml(bot.display_name ?? bot.login)} <small class="muted">@${escapeHtml(bot.login)}</small>` : '<span class="muted">nicht verbunden</span>'}
        ${n !== null ? `<br><small class="muted">${n} ${n === 1 ? 'Kanal hat' : 'Kanäle haben'} ihn gewählt</small>` : ''}</div>
      <div class="bot-panel-actions">
        ${bot ? `<button class="btn btn--ghost btn--sm" type="button" data-bot="disconnect" data-slot="${slot}">Trennen</button>` : ''}
        <button class="btn btn--twitch btn--sm" type="button" data-bot="connect" data-slot="${slot}">${bot ? 'Anderen verbinden' : 'Verbinden'}</button>
      </div>
    </div>`;
  }).join('');
}

function botMsg(textValue, kind = '') {
  const el = $('#bot-msg');
  el.textContent = textValue;
  el.classList.toggle('is-error', kind === 'error');
  el.classList.toggle('is-ok', kind === 'ok');
}

async function connectBot(slot, btn) {
  btn.disabled = true;
  btn.classList.add('is-loading');
  botMsg('');
  try {
    const { url } = await call('bot_start', { slot });
    // Merken, dass gerade der Bot verbunden wird: Landet der Rückweg auf der
    // Startseite, schickt sie ihn hierher weiter (js/app.js, boot).
    try { sessionStorage.setItem('zd_bot_flow', '1'); } catch { /* egal */ }
    location.href = url; // weiter zu Twitch, zurück kommt es auf admin.html
  } catch (err) {
    if (err.status === 401) { logout(err.message); return; }
    botMsg(`Verbinden fehlgeschlagen: ${botError(err)}`, 'error');
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

async function disconnectBot(slot, btn) {
  if (!confirm(`Bot ${slot} wirklich trennen? Kanäle mit diesem Bot schreiben dann mit dem anderen (falls verbunden).`)) return;
  btn.disabled = true;
  try {
    await call('bot_disconnect', { slot });
    botMsg(`Bot ${slot} getrennt.`, 'ok');
    await refresh();
  } catch (err) {
    if (err.status === 401) { logout(err.message); return; }
    botMsg(`Trennen fehlgeschlagen: ${botError(err)}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Bot-Protokoll aller Kanäle: je Kanal die letzten 24 Stunden, darunter die einzelnen Nachrichten
const BOT_STATUS = { sent: '✓ gesendet', dropped: '✕ blockiert', error: '⚠️ Fehler', no_bot: '⚠️ kein Bot', off: '⏸ Notfall-Schalter', retry: '↻ kommt gleich noch einmal' };
async function loadBotLog() {
  const btn = $('#botlog-load');
  btn.disabled = true;
  try {
    const data = await call('bot_log', { problems: $('#botlog-problems').checked });
    const channels = data.channels ?? [];
    const sent = channels.reduce((a, c) => a + Number(c.sent || 0), 0);
    const failed = channels.reduce((a, c) => a + Number(c.failed || 0), 0);
    $('#botlog-sum').textContent = `Letzte 24 Stunden: ${sent} gesendet, ${failed} nicht angekommen – in ${channels.length} ${channels.length === 1 ? 'Kanal' : 'Kanälen'}.`;
    const table = $('#botlog-channels');
    table.hidden = !channels.length;
    table.innerHTML = channels.length ? `<thead><tr><th>Kanal</th><th>Bot</th><th>gesendet</th><th>Probleme</th><th>Ø ms</th><th>zuletzt</th></tr></thead><tbody>${channels.map((c) => `<tr class="${c.failed ? 'is-bad' : ''}">
      <td>${escapeHtml(c.channel)}</td><td>${c.bot_slot === 2 ? 2 : 1}</td><td>${c.sent}</td><td>${c.failed}</td><td>${c.avg_ms ?? '–'}</td>
      <td>${new Date(c.last_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td></tr>`).join('')}</tbody>` : '';
    const items = data.items ?? [];
    const botFix = (it) => {
      const hint = it.status === 'sent' ? null : botHint(it.reason, it.bot);
      return hint ? `<span class="botlog-fix">${escapeHtml(`${hint.why} → ${hint.fix}`)}</span>` : '';
    };
    $('#botlog-feed').innerHTML = items.length ? items.map((it) => `<li class="${it.status === 'sent' ? '' : 'is-bad'}">
      <span class="botlog-when">${new Date(it.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      <b>${escapeHtml(it.channel)}</b> <small class="muted">@${escapeHtml(it.bot || '–')}${it.ms != null ? ` · ${it.ms} ms` : ''}</small>
      <span class="botlog-status">${BOT_STATUS[it.status] ?? escapeHtml(it.status)}${it.reason ? `: ${escapeHtml(it.reason)}` : ''}</span>
      <span class="botlog-text">${escapeHtml(it.text)}</span>${botFix(it)}</li>`).join('') : '<li class="muted">Keine Einträge.</li>';
  } catch (err) {
    if (err.status === 401) { logout(err.message); return; }
    $('#botlog-sum').textContent = `Nicht geladen: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function botError(err) {
  if (err.status === 404) return 'Die Edge Function „admin“ ist nicht erreichbar. Wurde sie schon zu Supabase hochgeladen?';
  if (/unbekannte aktion/i.test(err.message)) return 'Die Edge Function „admin“ ist veraltet. Bitte die Edge Functions neu deployen (README, Schritt 4).';
  if (/column .*kind|oauth_states/i.test(err.message)) return 'In der Datenbank fehlt die Erweiterung: supabase/migrations/20260923120000_chat_bot.sql im SQL Editor ausführen.';
  return err.message;
}

// Twitch leitet nach der Freigabe hierher zurück (?twitch=bot_connected bzw. ?twitch=error).
function showBotReturn() {
  try { sessionStorage.removeItem('zd_bot_flow'); } catch { /* egal */ }
  const params = new URLSearchParams(location.search);
  const status = params.get('twitch');
  if (!status) return;
  history.replaceState(null, '', location.pathname);
  if (status === 'bot_connected') {
    botMsg(`✓ Chat-Bot ${params.get('bot') ?? ''} ist als Bot ${params.get('slot') === '2' ? 2 : 1} verbunden.`, 'ok');
    return;
  }
  const reasons = {
    bot_is_broadcaster: 'Das war der Account des Streamers. Der Bot braucht einen eigenen: Auf twitch.tv abmelden, mit dem Bot-Account anmelden und noch einmal verbinden.',
    bot_same: 'Dieses Twitch-Konto ist schon der andere Bot. Für den zweiten Platz auf twitch.tv mit einem anderen Bot-Account anmelden und noch einmal verbinden.',
    access_denied: 'Die Freigabe auf Twitch wurde abgebrochen.',
    state: 'Die Anfrage ist abgelaufen. Bitte noch einmal verbinden.',
    redirect_uri: `Twitch hat nach der Freigabe nicht zu StreamHelp zurückgeleitet, sondern zur Supabase-Anmeldung. In der Twitch-App (dev.twitch.tv → Console → Anwendungen → „Verwalten“) unter „OAuth Redirect URLs“ zusätzlich ${CONFIG.SUPABASE_URL}/functions/v1/twitch-oauth eintragen (genau so, ohne / am Ende), speichern, ein paar Minuten warten und noch einmal verbinden.`,
  };
  const reason = params.get('reason');
  botMsg(`Verbinden fehlgeschlagen: ${reasons[reason] ?? params.get('detail') ?? reason ?? 'unbekannter Fehler'}`, 'error');
}

async function checkTwitch() {
  const btn = $('#twitch-check');
  const out = $('#twitch-check-result');
  btn.disabled = true;
  out.textContent = 'Frage Twitch …';
  try {
    const r = await call('twitch_check');
    out.textContent = r.found
      ? (r.status === 'enabled'
        ? '✓ Twitch meldet: Webhook aktiv. Einlösungen kommen an.'
        : `! Twitch meldet Status „${r.status}“. Der Streamer sollte Twitch neu verbinden.`)
      : `✕ ${r.status}.`;
  } catch (err) {
    out.textContent = `Prüfung fehlgeschlagen: ${err.message}`;
  } finally {
    btn.disabled = !state.data?.twitch;
  }
}

// ---------- Anmelde-Möglichkeiten (öffentliche Supabase-Einstellungen) ----------
async function loadProviders() {
  let settings = { external: {} };
  if (isDemo) settings = { external: { email: true } };
  else {
    try {
      const res = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY } });
      if (res.ok) settings = await res.json();
    } catch { /* offline */ }
  }
  const ext = settings.external ?? {};
  $('#providers').innerHTML = PROVIDERS.map(([id, name]) => {
    const on = !!ext[id];
    return `<li><span class="p-name">${providerIcon(id)}${name}</span>${on ? '<span class="chip chip--ok">✓ Aktiv</span>' : '<span class="chip chip--warn">! Nicht eingerichtet</span>'}</li>`;
  }).join('');
}

// ---------- Nutzer ----------
function renderUsers() {
  const users = state.data?.users ?? [];
  const q = state.search;
  const list = q ? users.filter((u) => `${u.username} ${u.email}`.toLowerCase().includes(q)) : users;
  $('#users-count').textContent = `(${nf.format(users.length)})`;
  const sig = JSON.stringify(list.map((u) => [u.id, u.is_admin, u.last_sign_in_at, u.confirmed, u.provider]));
  if (sig === state.usersSig) return; // nicht neu zeichnen, solange sich nichts ändert
  state.usersSig = sig;

  const tbody = $('#users');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">${q ? 'Keine Treffer.' : 'Noch niemand registriert.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((u) => `
    <tr>
      <td><span class="u-name"><span class="avatar" aria-hidden="true">${escapeHtml((u.username ?? '?').slice(0, 1).toUpperCase())}</span>${escapeHtml(u.username ?? '')}</span></td>
      <td><span class="via">${providerIcon(PROVIDERS.some(([id]) => id === u.provider) ? u.provider : 'email')}${escapeHtml((PROVIDERS.find(([id]) => id === u.provider) ?? [u.provider, u.provider ?? 'E-Mail'])[1])}</span></td>
      <td class="muted">${escapeHtml(u.email ?? '–')}</td>
      <td class="mono">${fmtDate(u.created_at)}</td>
      <td class="mono">${u.last_sign_in_at ? relTime(u.last_sign_in_at) : '–'}</td>
      <td>${u.confirmed ? '<span class="chip chip--ok">✓ Ja</span>' : '<span class="chip chip--warn">! Offen</span>'}</td>
      <td>
        <label class="toggle">
          <input type="checkbox" data-user="${escapeAttr(u.id)}" ${u.is_admin ? 'checked' : ''} aria-label="${escapeAttr(u.username ?? '')} ist Admin">
          <span class="toggle-ui" aria-hidden="true"></span>
        </label>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('input[data-user]').forEach((input) => input.addEventListener('change', () => setAdmin(input)));
}

async function setAdmin(input) {
  const isAdmin = input.checked;
  input.disabled = true;
  try {
    await call('set_admin', { user_id: input.dataset.user, is_admin: isAdmin });
    const u = state.data.users.find((x) => x.id === input.dataset.user);
    if (u) u.is_admin = isAdmin;
    toast(isAdmin ? 'Admin-Rechte vergeben: darf Kacheln bearbeiten.' : 'Admin-Rechte entfernt.', 'ok');
  } catch (err) {
    input.checked = !isAdmin;
    toast(`Ändern fehlgeschlagen: ${err.message}`, 'error');
  } finally {
    input.disabled = false;
  }
}

// ============================================================
// Hilfen
// ============================================================
function relTime(iso) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} min`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} h`;
  return fmtDate(iso);
}
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escapeAttr = escapeHtml;

function toast(text, type = 'info', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 260); }, ms);
}
