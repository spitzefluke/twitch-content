// StreamHelp-Admin: Login mit Admin-Passwort, danach Live-Daten (alle 5 s aktualisiert).
import { CONFIG } from './config.js';
import { isDemo } from './api.js';
import { DEFAULT_VARIANTS } from './defaults.js';
import { guardFrame } from './frame-guard.js';

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
  if (action === 'bot_start') throw new Error('Im Demo-Modus nicht verfügbar. Der Chat-Bot braucht Supabase und Twitch.');
  if (action === 'bot_disconnect') return { ok: true };
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
  $('#bot-connect').addEventListener('click', connectBot);
  $('#bot-disconnect').addEventListener('click', disconnectBot);
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
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Noch keine Kanäle.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((c) => {
    const [cls, label] = CHANNEL_STATUS[c.status] ?? ['', c.status];
    const actions = [];
    if (c.status !== 'active') actions.push(`<button class="btn btn--primary btn--sm" type="button" data-channel="${escapeAttr(c.id)}" data-status="active">Freischalten</button>`);
    if (c.status !== 'blocked' && !c.is_default) actions.push(`<button class="btn btn--ghost btn--sm" type="button" data-channel="${escapeAttr(c.id)}" data-status="blocked">Sperren</button>`);
    if (c.status === 'active' && !c.is_default) actions.push(`<button class="btn btn--ghost btn--sm" type="button" data-channel="${escapeAttr(c.id)}" data-status="pending">Zurückstellen</button>`);
    return `
    <tr>
      <td><span class="u-name"><span class="avatar" aria-hidden="true">${escapeHtml((c.display_name || c.login || '?').slice(0, 1).toUpperCase())}</span>
        <span>${escapeHtml(c.display_name || c.login || '–')}${c.is_default ? ' <span class="chip">Standard</span>' : ''}<br>
        <small class="muted">${c.login ? `twitch.tv/${escapeHtml(c.login)}` : ''}${c.owner ? ` · Konto: ${escapeHtml(c.owner)}` : ''}</small></span></span></td>
      <td><span class="chip ${cls}">${label}</span>${c.admin_note ? `<br><small class="muted">${escapeHtml(c.admin_note)}</small>` : ''}</td>
      <td class="muted">${escapeHtml(c.note || '–')}</td>
      <td class="mono">${fmtDate(c.created_at)}</td>
      <td>${c.connected ? '<span class="chip chip--ok">verbunden</span>' : '<span class="muted">–</span>'}</td>
      <td><span class="channel-actions">${actions.join('') || '–'}</span></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('button[data-status]').forEach((btn) => btn.addEventListener('click', () => setChannelStatus(btn)));
}

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

// ---------- Chat-Bot ----------
// Chat-Nachrichten schreibt ein eigener Twitch-Account, nie der Streamer selbst.
// Verbunden wird er nur hier im Admin-Bereich.
function renderBot(t, data) {
  const text = $('#bot-text');
  const connect = $('#bot-connect');
  const disconnect = $('#bot-disconnect');
  const bot = data.twitch_bot;
  if (data.twitch_bot_ready === false) {
    text.innerHTML = '<b>Chat-Bot:</b> In der Datenbank fehlt noch die Erweiterung. Im SQL Editor <code>supabase/migrations/20260923120000_chat_bot.sql</code> ausführen.';
    connect.hidden = true;
    disconnect.hidden = true;
    return;
  }
  connect.hidden = false;
  if (bot) {
    const scopeOk = !t || (t.scopes ?? []).includes('channel:bot');
    text.innerHTML = `<b>Chat-Bot:</b> ${escapeHtml(bot.display_name ?? bot.login)} schreibt die Ergebnisse in den Chat.` +
      (scopeOk ? '' : ' <br>Damit er im Chat des Streamers schreiben darf, muss der Streamer Twitch auf der Webseite einmal neu verbinden.');
    connect.textContent = 'Anderen Bot verbinden';
    disconnect.hidden = false;
  } else {
    text.innerHTML = '<b>Chat-Bot:</b> nicht verbunden – ohne ihn bleibt der Chat still. ' +
      'Vorher auf twitch.tv mit dem <b>Bot-Account</b> anmelden (nicht mit dem des Streamers), dann hier verbinden.';
    connect.textContent = 'Bot verbinden';
    disconnect.hidden = true;
  }
}

function botMsg(textValue, kind = '') {
  const el = $('#bot-msg');
  el.textContent = textValue;
  el.classList.toggle('is-error', kind === 'error');
  el.classList.toggle('is-ok', kind === 'ok');
}

async function connectBot() {
  const btn = $('#bot-connect');
  btn.disabled = true;
  btn.classList.add('is-loading');
  botMsg('');
  try {
    const { url } = await call('bot_start');
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

async function disconnectBot() {
  if (!confirm('Chat-Bot wirklich trennen? Danach erscheinen keine Ergebnisse mehr im Chat.')) return;
  const btn = $('#bot-disconnect');
  btn.disabled = true;
  try {
    await call('bot_disconnect');
    botMsg('Chat-Bot getrennt.', 'ok');
    await refresh();
  } catch (err) {
    if (err.status === 401) { logout(err.message); return; }
    botMsg(`Trennen fehlgeschlagen: ${botError(err)}`, 'error');
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
    botMsg(`✓ Chat-Bot ${params.get('bot') ?? ''} ist verbunden. Ab jetzt schreibt er die Ergebnisse in den Chat.`, 'ok');
    return;
  }
  const reasons = {
    bot_is_broadcaster: 'Das war der Account des Streamers. Der Bot braucht einen eigenen: Auf twitch.tv abmelden, mit dem Bot-Account anmelden und noch einmal verbinden.',
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
