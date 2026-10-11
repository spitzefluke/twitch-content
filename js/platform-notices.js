// Dashboard: Hinweise vom StreamHelp-Team (Migration …_channel_moderation.sql, js/platform-gate.js)
//   · Mein Kanal: Timeout („gesperrt bis …“), OBS-Overlay pausiert, Verwarnung (bis „Verstanden“)
//   · Wartung: Hinweis oben, solange sie läuft
//   · „Alle neu laden“ aus dem Admin-Bereich: Seite lädt nach kurzem Hinweis neu
//   · Neue Version auf der Seite: Hinweis mit „Jetzt aktualisieren“ (alle 10 Minuten geprüft)
//   · „Was ist neu“: Neuigkeiten für Streamer und ihre Mods – ungelesene öffnen sich einmal von selbst
// Eingebunden von js/app.js.
import { h } from './extras-core.js';
import { newVersionAvailable, platformPing, reloadFresh, reloadWanted } from './platform-gate.js';

let ctx = null;            // { api, toast, page, entry, isTeam }
let mine = null;           // channel_mine
let maintenance = null;    // { until, message } oder null
let newVersion = false;
let updates = [];
let updatesAsked = false;

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const untilText = (iso) => (!iso || iso.startsWith('9999') ? 'bis auf Weiteres' : `bis ${fmt(iso)}`);

function notice(kind, ico, title, detail, ...actions) {
  return h('div', { class: `pn pn--${kind}`, role: kind === 'bad' ? 'alert' : 'status' },
    h('span', { class: 'pn-ico', 'aria-hidden': 'true' }, ico),
    h('span', { class: 'pn-text' }, h('b', {}, title), detail ? h('small', {}, detail) : null),
    ...actions);
}

function paint() {
  const box = document.querySelector('#platform-notices');
  if (!box) return;
  const items = [];
  if (maintenance) {
    items.push(notice('warn', '🛠️', `Wartung ${untilText(maintenance.until)}`,
      maintenance.message || 'StreamHelp wird gerade aktualisiert – einzelne Funktionen können kurz hängen.'));
  }
  if (newVersion) {
    items.push(notice('info', '✨', 'Neue Version von StreamHelp', 'Lade die Seite neu, um sie zu nutzen.',
      h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: reloadFresh }, 'Jetzt aktualisieren')));
  }
  if (mine?.blocked_until) {
    items.push(notice('bad', '⏱️', `Dein Kanal „${mine.display_name || mine.login}“ ist ${untilText(mine.blocked_until)} gesperrt`,
      mine.admin_note || 'Solange sind Dashboard, Overlay, Panel und Chat-Bot für deinen Kanal pausiert. Bei Fragen melde dich beim StreamHelp-Team.'));
  }
  if (mine?.overlay_off_until) {
    items.push(notice('warn', '📺', `Dein OBS-Overlay ist ${untilText(mine.overlay_off_until)} pausiert`,
      mine.overlay_off_reason || 'Das StreamHelp-Team hat es angehalten – es zeigt solange nichts. Danach läuft es von selbst weiter.'));
  } else if (mine?.platform_overlays_off) {
    items.push(notice('warn', '📺', 'Alle Overlays sind gerade pausiert', 'Das StreamHelp-Team hat die Overlays kurz angehalten – sie laufen von selbst weiter.'));
  }
  if (mine?.warning_open) {
    const ok = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Verstanden');
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try { await ctx.api.channelWarningSeen(); mine = { ...mine, warning_open: false }; paint(); } catch { ok.disabled = false; }
    });
    items.push(notice('bad', '⚠️', 'Verwarnung vom StreamHelp-Team', `${mine.warning}${mine.warning_at ? ` (${fmt(mine.warning_at)})` : ''}`, ok));
  }
  box.replaceChildren(...items);
  box.hidden = !items.length;
}

// Mein Kanal hat sich geändert (app.js → renderChannelBar)
export function setMyChannel(channel) {
  mine = channel ?? null;
  paint();
}

// ---------- „Was ist neu“ ----------
function paintUpdates() {
  const unread = updates.filter((u) => !u.read).length;
  const btn = document.querySelector('#updates-btn');
  if (btn) {
    btn.hidden = !updates.length;
    const badge = btn.querySelector('.sb-badge');
    if (badge) { badge.hidden = !unread; badge.textContent = String(unread); }
  }
}

export function openUpdates() {
  const dlg = document.querySelector('#updates-dialog');
  if (!dlg) return;
  const list = dlg.querySelector('#updates-list');
  list.replaceChildren(...(updates.length ? updates.map((u) => h('article', { class: `upd${u.read ? '' : ' is-new'}` },
    h('header', {}, h('b', {}, u.title), h('small', {}, `${u.read ? '' : '🆕 '}${fmt(u.created_at)}`)),
    h('p', {}, u.body))) : [h('p', { class: 'form-hint' }, 'Gerade keine Neuigkeiten.')]));
  if (!dlg.open) dlg.showModal();
}

async function markRead() {
  if (!updates.some((u) => !u.read)) return;
  try {
    await ctx.api.platformUpdatesRead();
    updates = updates.map((u) => ({ ...u, read: true }));
    paintUpdates();
  } catch { /* nächstes Mal */ }
}

export async function loadUpdates({ open = true } = {}) {
  if (!ctx?.isTeam()) { updates = []; paintUpdates(); return; }
  updates = await ctx.api.platformUpdates().catch(() => []) ?? [];
  paintUpdates();
  // Ungelesene einmal pro Sitzung von selbst zeigen
  if (open && !updatesAsked && updates.some((u) => !u.read)) {
    updatesAsked = true;
    openUpdates();
  }
}

// ---------- Ping: Neu laden, Wartung, neue Version ----------
let reloading = false;
async function ping() {
  const p = await platformPing();
  if (p) {
    maintenance = p.maintenance ?? null;
    if (!reloading && reloadWanted(p.reload_at)) {
      reloading = true;
      ctx.toast('StreamHelp wurde aktualisiert – die Seite lädt in 10 Sekunden neu.', 'info', 10000);
      setTimeout(reloadFresh, 10_000);
    }
    paint();
  }
}

async function checkVersion() {
  if (newVersion) return;
  newVersion = await newVersionAvailable(ctx.page, ctx.entry);
  if (newVersion) paint();
}

export function startPlatformNotices(deps) {
  if (ctx) return;
  ctx = deps;
  const dlg = document.querySelector('#updates-dialog');
  dlg?.querySelector('#updates-ok')?.addEventListener('click', () => { markRead(); dlg.close(); });
  dlg?.addEventListener('close', markRead);
  document.querySelector('#updates-btn')?.addEventListener('click', openUpdates);
  ping();
  setInterval(() => { if (!document.hidden) ping(); }, 60_000);
  addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
  setTimeout(checkVersion, 30_000);
  setInterval(() => { if (!document.hidden) checkVersion(); }, 10 * 60_000);
}
