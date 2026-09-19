// Stellwerk-Admin: Login mit Admin-Passwort, danach Live-Daten (alle 5 s aktualisiert).
import { CONFIG } from './config.js';
import { isDemo } from './api.js';
import { DEFAULT_VARIANTS } from './defaults.js';

const $ = (sel, root = document) => root.querySelector(sel);
const TOKEN_KEY = 'zd_admin_token';
const POLL_MS = 5000;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PROVIDERS = [
  ['email', 'E-Mail'], ['twitch', 'Twitch'], ['discord', 'Discord'],
  ['google', 'Google'], ['spotify', 'Spotify'], ['github', 'GitHub'],
];
const providerIcon = (id) => id === 'email'
  ? '<span class="p-email" aria-hidden="true">@</span>'
  : `<span class="p-icon" style="--icon:url('assets/icons/${id}.svg')" aria-hidden="true"></span>`;

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

const session = {
  get() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(v) { try { sessionStorage.setItem(TOKEN_KEY, v); } catch { /* privat */ } },
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
    throw err;
  }
  return data;
}

// Demo: liest die Daten, die die Webseite im selben Browser gespeichert hat
function demoCall(action, extra) {
  const read = (k, f) => { try { return JSON.parse(localStorage.getItem(`zd_${k}`)) ?? f; } catch { return f; } };
  if (action === 'login') {
    if (extra.password !== 'demo') { const e = new Error('Falsches Passwort. (Demo: „demo“)'); e.status = 401; throw e; }
    return { token: 'demo', expires_at: new Date(Date.now() + 12 * 3600e3).toISOString() };
  }
  if (action === 'set_admin') {
    const users = read('users', {});
    if (users[extra.user_id]) users[extra.user_id].is_admin = extra.is_admin;
    localStorage.setItem('zd_users', JSON.stringify(users));
    return { ok: true };
  }
  if (action === 'twitch_check') return { found: false, status: 'im Demo-Modus nicht verfügbar' };
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

// ============================================================
// Start / Login
// ============================================================
init();

function init() {
  if (isDemo) $('#demo-banner').hidden = false;
  $('#admin-form').addEventListener('submit', onLogin);
  $('#logout-btn').addEventListener('click', () => logout());
  $('#twitch-check').addEventListener('click', checkTwitch);
  $('#users-search').addEventListener('input', (e) => { state.search = e.target.value.trim().toLowerCase(); state.usersSig = ''; renderUsers(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.token) refresh();
  });
  setInterval(updateLiveLabel, 1000);

  state.token = session.get();
  loadProviders();
  if (state.token) showApp();
  else showLogin();
}

function showLogin(message) {
  $('#admin-app').hidden = true;
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
  if (!password) { msg.textContent = 'Bitte das Admin-Passwort eingeben.'; return; }
  msg.textContent = '';
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    const { token } = await call('login', { password });
    state.token = token;
    session.set(token);
    form.reset();
    showApp();
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

function showApp() {
  $('#admin-login').hidden = true;
  $('#admin-app').hidden = false;
  refresh();
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
  renderTwitch(data.twitch);
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
      <span class="f-main"><strong>${escapeHtml(s.result)}</strong><small>${escapeHtml(s.variant_name)} · ${escapeHtml(s.requested_by)}</small></span>
      <time datetime="${escapeAttr(s.created_at)}" title="${escapeAttr(new Date(s.created_at).toLocaleString('de-DE'))}">${relTime(s.created_at)}</time>
    </li>`;
  }).join('');
  state.seenSpins = new Set(spins.map((s) => s.id));
}

// ---------- Twitch ----------
function renderTwitch(t) {
  const chip = (kind, label) => `<span class="chip chip--${kind}">${kind === 'ok' ? '✓' : kind === 'bad' ? '✕' : '!'} ${label}</span>`;
  const rows = [];
  if (!t) {
    rows.push(['Kanal', `${chip('bad', 'Nicht verbunden')}<br><small class="muted">Dave muss sich auf der Webseite mit Twitch verbinden.</small>`]);
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
  $('#twitch-panel').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('#twitch-check').disabled = !t;
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
        : `! Twitch meldet Status „${r.status}“. Dave sollte Twitch neu verbinden.`)
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
