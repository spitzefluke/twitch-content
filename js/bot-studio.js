// Dashboard → Bot & Chat als Editor: links die Liste, in der Mitte Bearbeiten, rechts die Chat-Vorschau.
//   · Eigene Befehle und Auto-Nachrichten werden hier direkt bearbeitet (Speichern / Verwerfen / Löschen).
//   · Alles andere (Bot-Konto, Protokoll, Begrüßung, Moderation, Songs …) sind die bekannten Karten –
//     sie stehen als Bereiche in der Mitte, immer nur einer sichtbar.
//   · Die Chat-Vorschau ist nur eine Simulation in diesem Browser: nichts geht in den echten Twitch-Chat.
// Eingebunden von js/app.js (renderBotPanel).
import { h } from './extras-core.js';
import { botSettings, timerGapForm } from './bot-plus.js';

let ctx = null;          // { state, api, toast, cmdError, cleanCommand, streamerName }
let cmds = [];
let timers = [];
let loadError = '';
let sel = null;          // { kind: 'cmd' | 'timer' | 'pane', id }
let dirty = false;
let testLog = [];
let ready = false;

const $ = (s) => document.querySelector(s);
const clamp = (v, min, max, def) => Math.max(min, Math.min(max, Math.round(Number(v) || def)));
const PERMS = { everyone: 'Alle', sub: 'Abonnenten', vip: 'VIPs', mod: 'Nur Mods', streamer: 'Streamer' };

// Bereiche aus den bestehenden Karten (data-pane in index.html)
const PANES = {
  account: { icon: 'ph-plug', name: 'Bot-Konto', sub: () => (ctx.state.twitch?.bot_connected ? `${ctx.state.twitch.bot_name ?? ctx.state.twitch.bot_login ?? 'Bot'} · verbunden` : 'nicht verbunden'), on: () => !!ctx.state.twitch?.bot_connected },
  log: { icon: 'ph-list-checks', name: 'Bot-Protokoll', sub: () => 'Kommen die Nachrichten an?' },
  greet: { icon: 'ph-hand-waving', name: 'Begrüßung & Danke', sub: (s) => ({ off: 'Begrüßung aus', new: 'Nur neue Zuschauer', stream: 'Jeden einmal pro Stream' }[s?.greet_mode] ?? 'Begrüßen und bedanken'), on: (s) => s && (s.greet_mode !== 'off' || s.thank_follow || s.thank_sub || s.thank_bits || s.thank_raid || s.live_on) },
  mod: { icon: 'ph-shield-check', name: 'Moderation', sub: (s) => (s?.mod_on ? [s.mod_links && 'Links', s.mod_caps && 'Caps', s.mod_spam && 'Spam', s.mod_words?.length && 'Wörter'].filter(Boolean).join(' · ') || 'an' : 'aus'), on: (s) => s?.mod_on },
  songs: { icon: 'ph-music-notes', name: 'Song-Requests', sub: () => '!sr mit Player', on: (s) => s?.song_on },
  faq: { icon: 'ph-chat-teardrop-text', name: 'Stichwort-Antworten', sub: () => 'Antwort auf Fragen im Chat', on: (s) => s?.faq_on },
  notices: { icon: 'ph-megaphone', name: 'Ansagen', sub: () => 'Werbung, Hype-Train, Ziele', on: (s) => s && (s.ads_on || s.hype_on || s.goal_on) },
  clips: { icon: 'ph-film-strip', name: 'Clips & Statistik', sub: () => '!clip, !stats, !topchatter', on: (s) => s && (s.clip_on || s.stats_on) },
  info: { icon: 'ph-info', name: 'Stream-Infos', sub: () => '!uptime, !game, !so …', on: (s) => s?.info_on },
  watch: { icon: 'ph-hourglass', name: 'Watchtime', sub: () => '!watchtime und Rangliste' },
  builtin: { icon: 'ph-list-bullets', name: 'Eingebaute Befehle', sub: () => '!befehle, !join, !sr …' },
};
const GROUPS = [
  { id: 'konto', label: 'Konto', panes: ['account', 'log'] },
  { id: 'cmd', label: 'Eigene Befehle', add: 'Neuer Befehl' },
  { id: 'timer', label: 'Auto-Nachrichten', add: 'Neue Auto-Nachricht' },
  { id: 'auto', label: 'Automatik', panes: ['greet', 'mod', 'songs', 'faq', 'notices', 'clips', 'info'] },
  { id: 'more', label: 'Mehr', panes: ['watch', 'builtin'] },
];

// Ohne die Felder aus …_chat_bot_plus.sql – die schickt readCmd nur, wenn sie gesetzt sind
const blankCmd = () => ({ id: null, command: '', response: '', enabled: true, cooldown_seconds: 10, uses: 0 });
const blankTimer = () => ({ id: null, text: '', enabled: true, interval_min: 15, min_lines: 5, sent: 0 });
const current = () => (sel?.kind === 'cmd' ? (cmds.find((c) => c.id === sel.id) ?? blankCmd())
  : sel?.kind === 'timer' ? (timers.find((t) => t.id === sel.id) ?? blankTimer()) : null);

// ---------- Laden ----------
export async function renderBotStudio(deps) {
  ctx = deps;
  if (!$('#bot-studio')) return;
  if (!ready) setup();
  const [c, t] = await Promise.allSettled([ctx.api.botCommands.list(), ctx.api.botPlus.timers.list()]);
  loadError = c.status === 'rejected' ? ctx.cmdError(c.reason) : '';
  if (c.status === 'fulfilled') cmds = c.value ?? [];
  if (t.status === 'fulfilled') timers = t.value ?? [];
  if (!sel || (sel.kind === 'cmd' && sel.id && !cmds.some((x) => x.id === sel.id)) || (sel.kind === 'timer' && sel.id && !timers.some((x) => x.id === sel.id))) {
    sel = cmds.length ? { kind: 'cmd', id: cmds[0].id } : { kind: 'pane', id: 'account' };
    dirty = false;
  }
  renderList();
  if (!dirty) showSelection();
  else renderChat();
}

// ---------- Liste ----------
function renderList() {
  const q = ($('#bs-q').value ?? '').trim().toLowerCase();
  const hit = (...txt) => !q || txt.join(' ').toLowerCase().includes(q);
  const s = botSettings();
  const groups = GROUPS.map((g) => {
    let items = [];
    if (g.id === 'cmd') {
      items = cmds.filter((c) => hit(c.command, c.response, ...(c.aliases ?? []))).map((c) => item({
        kind: 'cmd', id: c.id, icon: 'ph-terminal', name: c.command, sub: c.response, on: c.enabled, mono: true,
      }));
      if (sel?.kind === 'cmd' && !sel.id) items.push(item({ kind: 'cmd', id: null, icon: 'ph-terminal', name: 'Neuer Befehl', sub: 'noch nicht gespeichert', on: true }));
      if (loadError) items.push(h('p', { class: 'bs-empty' }, loadError));
      else if (!cmds.length && !q && !(sel?.kind === 'cmd' && !sel.id)) items.push(h('p', { class: 'bs-empty' }, 'Noch keine eigenen Befehle – mit ＋ den ersten anlegen.'));
    } else if (g.id === 'timer') {
      items = timers.filter((t) => hit(t.text)).map((t) => item({
        kind: 'timer', id: t.id, icon: 'ph-clock-clockwise', name: t.text, sub: `alle ${t.interval_min} Min · ${t.sent ?? 0}× gesendet`, on: t.enabled,
      }));
      if (sel?.kind === 'timer' && !sel.id) items.push(item({ kind: 'timer', id: null, icon: 'ph-clock-clockwise', name: 'Neue Auto-Nachricht', sub: 'noch nicht gespeichert', on: true }));
    } else {
      items = g.panes.map((k) => [k, PANES[k]]).filter(([, p]) => hit(p.name, p.sub(s))).map(([k, p]) => item({
        kind: 'pane', id: k, icon: p.icon, name: p.name, sub: p.sub(s), on: p.on ? !!p.on(s) : null,
      }));
    }
    if (q && !items.length) return null;
    return h('div', { class: 'bs-group' },
      h('div', { class: 'bs-group-head' }, h('span', {}, g.label),
        g.add && h('button', { type: 'button', class: 'bs-add', title: g.add, 'aria-label': g.add, onclick: () => pick({ kind: g.id, id: null }) }, h('i', { class: 'ph ph-plus', 'aria-hidden': 'true' }))),
      ...items);
  }).filter(Boolean);
  $('#bs-groups').replaceChildren(...(groups.length ? groups : [h('p', { class: 'bs-empty' }, `Nichts gefunden für „${q}“.`)]));
}

function item({ kind, id, icon, name, sub, on, mono }) {
  const active = sel?.kind === kind && sel.id === id;
  return h('button', {
    type: 'button', class: `bs-item${mono ? ' is-mono' : ''}${on === false ? ' is-off' : ''}`, 'aria-current': active ? 'true' : null,
    onclick: () => pick({ kind, id }),
  },
  h('i', { class: `ph ${icon}`, 'aria-hidden': 'true' }),
  h('span', { class: 'bs-item-text' }, h('b', {}, name), h('small', {}, sub ?? '')),
  h('span', { class: 'bs-item-dots' },
    active && dirty && h('span', { class: 'bs-dot bs-dot--dirty', title: 'Ungespeichert' }),
    on !== null && on !== undefined && h('span', { class: `bs-dot${on ? ' is-on' : ''}`, title: on ? 'An' : 'Aus' })));
}

function pick(next) {
  if (sel && sel.kind === next.kind && sel.id === next.id && next.id !== null) return;
  if (dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
  sel = next;
  dirty = false;
  testLog = [];
  renderList();
  showSelection();
  // Schmal: Editor in Sicht holen
  if (matchMedia('(max-width: 860px)').matches) $('.bs-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Editor ----------
function showSelection() {
  const form = $('#bs-form');
  const isEdit = sel.kind === 'cmd' || sel.kind === 'timer';
  form.hidden = !isEdit;
  $('#bs-head').hidden = !isEdit;
  $('#bs-foot').hidden = !isEdit;
  document.querySelectorAll('#bs-panes > [data-pane]').forEach((el) => { el.hidden = el.dataset.pane !== sel.id || isEdit; });
  if (isEdit) fillForm(current());
  else $('#bs-panes').scrollTop = 0;
  renderChat();
}

function fillForm(x) {
  const form = $('#bs-form');
  const cmd = sel.kind === 'cmd';
  form.dataset.kind = sel.kind;
  form.querySelectorAll('[data-for-kind]').forEach((el) => { el.hidden = el.dataset.forKind !== sel.kind; });
  $('#bs-ico').className = `ph ${cmd ? 'ph-terminal' : 'ph-clock-clockwise'}`;
  $('#bs-on').checked = !!x.enabled;
  $('#bs-text-label').textContent = cmd ? 'Antwort vom Bot' : 'Nachricht vom Bot';
  $('#bs-text').placeholder = cmd ? 'Unser Discord: discord.gg/… – {user}, komm vorbei!' : 'Gefällt dir der Stream? Ein Follow hilft enorm 💜';
  if (cmd) {
    form.command.value = x.command;
    form.cooldown.value = x.cooldown_seconds ?? 10;
    form.text.value = x.response;
    form.aliases.value = (x.aliases ?? []).join(', ');
    form.user_cooldown.value = x.user_cooldown ?? 0;
    form.reply_type.value = x.reply_type ?? 'say';
    form.live_only.checked = !!x.live_only;
    setPerm(x.permission ?? (x.mod_only ? 'mod' : 'everyone'));
    $('#bs-uses').textContent = `${Number(x.uses ?? 0).toLocaleString('de-DE')}×`;
  } else {
    form.text.value = x.text;
    form.interval_min.value = x.interval_min;
    form.min_lines.value = x.min_lines;
    $('#bs-sent').textContent = `${Number(x.sent ?? 0).toLocaleString('de-DE')}×`;
    const gap = $('#bs-gap');
    if (!gap.firstChild) { const f = timerGapForm(); if (f) gap.append(f); }
  }
  $('#bs-del').hidden = !x.id;
  setDirty(false);
}

function setPerm(v) {
  $('#bs-form').dataset.perm = v;
  document.querySelectorAll('#bs-perm [data-perm]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.perm === v)));
}

function setDirty(on) {
  dirty = on;
  const isNew = !current()?.id;
  $('#bs-state').textContent = isNew ? 'Noch nicht gespeichert' : on ? 'Ungespeicherte Änderungen' : 'Alles gespeichert';
  $('#bs-state').classList.toggle('is-dirty', on || isNew);
  $('#bs-save').textContent = isNew ? 'Anlegen' : 'Speichern';
  $('#bs-save').disabled = !on && !isNew;
  $('#bs-discard').disabled = !on;
  paintHead();
  const cur = $('#bs-groups .bs-item[aria-current] .bs-item-dots');
  if (cur && !!cur.querySelector('.bs-dot--dirty') !== on) renderList();
}

function paintHead() {
  const form = $('#bs-form');
  const cmd = sel.kind === 'cmd';
  const len = form.text.value.length;
  $('#bs-count').textContent = `${len}/400`;
  if (cmd) {
    $('#bs-title').textContent = form.command.value.trim() ? ctx.cleanCommand(form.command.value) : 'Neuer Befehl';
    $('#bs-title').classList.add('is-mono');
    $('#bs-sub').textContent = 'Befehl im Chat → feste Antwort vom Bot';
  } else {
    $('#bs-title').textContent = current()?.id ? 'Auto-Nachricht' : 'Neue Auto-Nachricht';
    $('#bs-title').classList.remove('is-mono');
    $('#bs-sub').textContent = `alle ${form.interval_min.value || 15} Min – nur wenn im Chat etwas los ist`;
  }
}

function readCmd() {
  const form = $('#bs-form');
  const orig = current();
  const perm = form.dataset.perm || 'everyone';
  const c = {
    id: orig.id ?? undefined,
    command: ctx.cleanCommand(form.command.value),
    response: form.text.value.trim(),
    enabled: $('#bs-on').checked,
    mod_only: ['mod', 'streamer'].includes(perm),
    cooldown_seconds: clamp(form.cooldown.value, 0, 3600, 0),
  };
  // Mehr Einstellungen (…_chat_bot_plus.sql): nur mitschicken, wenn gesetzt oder schon vorhanden – so geht Anlegen auch ohne die Migration
  const extra = {
    permission: perm,
    aliases: [...new Set(form.aliases.value.split(/[\s,]+/).filter(Boolean).map(ctx.cleanCommand))].slice(0, 5),
    user_cooldown: clamp(form.user_cooldown.value, 0, 3600, 0),
    reply_type: form.reply_type.value,
    live_only: form.live_only.checked,
  };
  const def = { permission: 'everyone', user_cooldown: 0, reply_type: 'say', live_only: false };
  for (const [k, v] of Object.entries(extra)) {
    const isDefault = k === 'aliases' ? !v.length : v === def[k];
    if (!isDefault || k in orig) c[k] = v;
  }
  return c;
}

function readTimer() {
  const form = $('#bs-form');
  return {
    id: current().id ?? undefined,
    text: form.text.value.trim(),
    enabled: $('#bs-on').checked,
    interval_min: clamp(form.interval_min.value, 5, 240, 15),
    min_lines: clamp(form.min_lines.value, 0, 200, 0),
  };
}

async function save(e) {
  e.preventDefault();
  const btn = $('#bs-save');
  const state = $('#bs-state');
  btn.disabled = true;
  try {
    if (sel.kind === 'cmd') {
      const c = readCmd();
      if (c.command.length < 3 || !c.response) throw new Error('Bitte Befehl und Antwort eintragen.');
      const row = await ctx.api.botCommands.save(c);
      cmds = (c.id ? cmds.map((x) => (x.id === row.id ? row : x)) : [...cmds, row]).sort((a, b) => a.command.localeCompare(b.command));
      sel = { kind: 'cmd', id: row.id };
      ctx.toast(c.id ? `✓ ${row.command} gespeichert.` : `✓ ${row.command} ist angelegt – gleich im Chat ausprobieren.`, 'ok', 3000);
    } else {
      const t = readTimer();
      if (!t.text) throw new Error('Bitte einen Text eintragen.');
      const row = await ctx.api.botPlus.timers.save(t);
      timers = t.id ? timers.map((x) => (x.id === row.id ? row : x)) : [...timers, row];
      sel = { kind: 'timer', id: row.id };
      ctx.toast('✓ Auto-Nachricht gespeichert.', 'ok', 2500);
    }
    dirty = false;
    renderList();
    fillForm(current());
    renderChat();
  } catch (err) {
    const m = err?.message ?? '';
    state.textContent = /^Bitte /.test(m) ? m
      : sel.kind === 'timer' && /check constraint|violates/i.test(m) ? 'Text 1–400 Zeichen, alle 5–240 Min, 0–200 Nachrichten.'
        : ctx.cmdError(err);
    state.classList.add('is-error');
    btn.disabled = false;
  }
}

async function remove() {
  const x = current();
  if (!x?.id) return;
  const label = sel.kind === 'cmd' ? x.command : 'Auto-Nachricht';
  if (!confirm(`${label} wirklich löschen?`)) return;
  try {
    if (sel.kind === 'cmd') {
      await ctx.api.botCommands.remove(x.id);
      cmds = cmds.filter((c) => c.id !== x.id);
      sel = cmds.length ? { kind: 'cmd', id: cmds[0].id } : { kind: 'pane', id: 'account' };
    } else {
      await ctx.api.botPlus.timers.remove(x.id);
      timers = timers.filter((t) => t.id !== x.id);
      sel = timers.length ? { kind: 'timer', id: timers[0].id } : { kind: 'pane', id: 'account' };
    }
    dirty = false;
    ctx.toast(`${label} gelöscht.`, 'ok', 2500);
    renderList();
    showSelection();
  } catch (err) {
    ctx.toast(ctx.cmdError(err), 'error');
  }
}

// ---------- Chat-Vorschau ----------
const VIEWER = 'zuschauer_42';
const botName = () => ctx.state.twitch?.bot_name || ctx.state.twitch?.bot_login || 'StreamHelpBot';

function fillText(text, { user = VIEWER, args = [], count = 1 } = {}) {
  const st = ctx.state;
  return String(text ?? '')
    .replaceAll('{user}', user)
    .replaceAll('{touser}', (args[0] ?? '').replace(/^@/, '') || user)
    .replaceAll('{count}', String(count))
    .replaceAll('{watchtime}', '12 Std 30 Min')
    .replaceAll('{followage}', '1 Jahr, 2 Monate')
    .replaceAll('{uptime}', '2 Std 14 Min')
    .replaceAll('{game}', st.games?.data?.live_category || 'Fortnite')
    .replaceAll('{title}', 'Late-Night-Marathon')
    .replaceAll('{streamer}', ctx.streamerName())
    .replace(/\{random(?::(\d+)-(\d+))?\}/g, (_, a, b) => {
      const lo = a ? Number(a) : 1;
      const hi = b ? Number(b) : 100;
      return String(lo + Math.floor(Math.random() * (Math.max(hi, lo) - lo + 1)));
    });
}

// Was gerade im Editor steht, zählt in der Vorschau schon mit (auch ungespeichert)
function liveCmds() {
  if (sel?.kind !== 'cmd' || $('#bs-form').hidden) return cmds;
  const c = { ...current(), ...readCmd() };
  c.permission = $('#bs-form').dataset.perm || 'everyone';
  return c.id ? cmds.map((x) => (x.id === c.id ? { ...x, ...c } : x)) : [...cmds, c];
}

function renderChat() {
  const lines = [{ who: 'mia_plays', text: 'gg das war knapp 😂', cls: 'u2' }];
  const form = $('#bs-form');
  let mode = 'Test';
  if (sel?.kind === 'cmd') {
    mode = 'Befehl';
    const c = liveCmds().find((x) => x.id === (current().id ?? undefined)) ?? readCmd();
    const name = c.command && c.command.length > 1 ? c.command : '!befehl';
    lines.push({ who: VIEWER, text: name, cls: 'u1' });
    if (form.text.value.trim()) lines.push({ bot: true, text: fillText(form.text.value, { count: Number(current().uses ?? 0) + 1 }) });
    lines.push({ info: `Wer: ${PERMS[form.dataset.perm] ?? 'Alle'} · Pause ${clamp(form.cooldown.value, 0, 3600, 0)} Sek.${$('#bs-on').checked ? '' : ' · gerade aus'}` });
  } else if (sel?.kind === 'timer') {
    mode = 'Auto-Nachricht';
    lines.push({ info: `Frühestens alle ${clamp(form.interval_min.value, 5, 240, 15)} Min und erst nach ${clamp(form.min_lines.value, 0, 200, 0)} neuen Nachrichten:` });
    if (form.text.value.trim()) lines.push({ bot: true, text: fillText(form.text.value) });
  } else {
    lines.push({ info: 'Schreib unten wie ein Zuschauer – zum Beispiel einen deiner Befehle.' });
  }
  $('#bs-chat-mode').textContent = mode;
  $('#bs-log').replaceChildren(...[...lines, ...testLog].map(line));
  $('#bs-log').scrollTop = $('#bs-log').scrollHeight;
}

function line(l) {
  if (l.info) return h('li', { class: 'bs-msg bs-msg--info' }, h('i', { class: 'ph ph-info', 'aria-hidden': 'true' }), l.info);
  if (l.bot) return h('li', { class: 'bs-msg bs-msg--bot' }, h('b', {}, h('i', { class: 'ph ph-robot', 'aria-hidden': 'true' }), ` ${botName()}: `), l.text);
  return h('li', { class: `bs-msg bs-msg--${l.cls ?? 'u1'}` }, h('b', {}, `${l.who}: `), l.text);
}

function test(e) {
  e.preventDefault();
  const input = e.currentTarget.msg;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  testLog.push({ who: VIEWER, text, cls: 'u1' });
  const [word, ...args] = text.split(/\s+/);
  const w = word.toLowerCase();
  if (w.startsWith('!')) {
    const list = liveCmds().filter((c) => c.enabled && c.command);
    const hit = list.find((c) => c.command === w || (c.aliases ?? []).includes(w));
    if (w === '!befehle' || w === '!commands') {
      testLog.push({ bot: true, text: `Befehle: ${list.map((c) => c.command).join(' ') || '–'}` });
    } else if (hit) {
      testLog.push({ bot: true, text: fillText(hit.response, { args, count: Number(hit.uses ?? 0) + 1 }) });
      if ((hit.permission ?? 'everyone') !== 'everyone') testLog.push({ info: `Darf im echten Chat nur: ${PERMS[hit.permission]}.` });
    } else {
      testLog.push({ info: 'Kein eigener Befehl. Eingebaute wie !watchtime oder !sr antworten nur im echten Chat.' });
    }
  }
  testLog = testLog.slice(-30);
  renderChat();
}

// ---------- Einmal verdrahten ----------
function setup() {
  ready = true;
  const form = $('#bs-form');
  $('#bs-q').addEventListener('input', renderList);
  form.addEventListener('submit', save);
  const changed = () => { if (!dirty) setDirty(true); else paintHead(); renderChat(); };
  form.addEventListener('input', changed);
  $('#bs-on').addEventListener('change', changed);
  $('#bs-perm').addEventListener('click', (e) => {
    const b = e.target.closest('[data-perm]');
    if (!b) return;
    setPerm(b.dataset.perm);
    changed();
  });
  // Platzhalter an der Schreibmarke einfügen
  form.querySelector('.bs-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ph]');
    if (!b) return;
    const ta = $('#bs-text');
    const at = ta.selectionStart ?? ta.value.length;
    ta.setRangeText(b.dataset.ph, at, ta.selectionEnd ?? at, 'end');
    ta.focus();
    changed();
  });
  $('#bs-discard').addEventListener('click', () => { fillForm(current()); renderChat(); });
  $('#bs-del').addEventListener('click', remove);
  $('#bs-test').addEventListener('submit', test);
  addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
}
