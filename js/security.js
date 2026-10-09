// Sicherheit auf der Webseite (Migration …_security.sql):
//   · Zwei-Faktor-Anmeldung (Authenticator-App): Code beim Anmelden, Einrichten und Ausschalten
//   · Angemeldete Geräte ansehen und abmelden
//   · Daten-Export des eigenen Kanals (Streamer)
//   · Rechte je Mod und Mod-Protokoll (Seite „Mods“, Streamer)
//   · Bot-Schutz beim Anmelden/Registrieren (Cloudflare Turnstile, wenn in js/config.js eingerichtet)
// app.js ruft setupSecurity(ctx) einmal beim Start auf.
import { CONFIG } from './config.js';
import { h } from './extras-core.js';

let ctx = null; // { state, toast, germanError, setPage }
const api = () => ctx.state.api;
const access = () => ctx.state.access ?? {};
const isOwner = () => !!(access().is_owner || access().is_site_admin || (ctx.state.api.demo && ctx.state.profile?.is_admin));

export function setupSecurity(c) {
  ctx = c;
}

// Bereiche, die der Streamer einzelnen Mods sperren kann – gleiche Schlüssel wie mod_areas() in der Datenbank
export const MOD_AREAS = [
  { key: 'ideas', icon: '💡', label: 'Content-Ideen & Kacheln' },
  { key: 'wheel', icon: '🎡', label: 'Glücksrad' },
  { key: 'bingo', icon: '🎯', label: 'Bingo & Tipprunde' },
  { key: 'games', icon: '🎮', label: 'Mitmach-Spiele', hint: 'Quiz, Kisten-Shop, Win-Challenge, Warteschlange, Sammelkarten, Verbotenes Wort, Hot Words, Pause' },
  { key: 'giveaway', icon: '🎁', label: 'Verlosung' },
  { key: 'pranks', icon: '😈', label: 'Ärgern, Sounds & Vorlesen' },
  { key: 'pet', icon: '🦖', label: 'Haustier' },
  { key: 'overlay', icon: '🎛️', label: 'Overlay, Alerts & Laufband', hint: 'auch Subathon-Timer und Kanal-Jubiläum' },
  { key: 'chat', icon: '🤖', label: 'Chat-Bot & Befehle' },
  { key: 'points', icon: '🎟️', label: 'Kanalpunkte-Belohnungen' },
  { key: 'guard', icon: '🛡️', label: 'Raid-Schutz' },
];
const areaByKey = Object.fromEntries(MOD_AREAS.map((a) => [a.key, a]));

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '');
function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'gestern' : `vor ${d} Tagen`;
}
const missing = (err) => /could not find the function|PGRST202|mod_rights|audit_list|my_sessions|channel_export/i.test(err?.message ?? '') || err?.code === 'PGRST202';
const MIGRATION_HINT = 'Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20261031000000_security.sql ausführen.';

function card({ icon, title, status, id, wide = true }) {
  const statusEl = h('p', { class: 'dash-status' }, status ?? '');
  const body = h('div', { class: 'sec-body' });
  const el = h('section', { class: `dash-card${wide ? ' dash-card--wide' : ''} sec-card`, id },
    h('header', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, icon), h('div', {}, h('h2', {}, title), statusEl)),
    body);
  return { el, body, status: statusEl };
}

// ============================================================
// Zwei-Faktor-Anmeldung beim Einsteigen
// ============================================================
// true: weiter ins Dashboard. false: abgemeldet (Code nicht eingegeben).
export async function mfaGate() {
  let st;
  try { st = await api().mfaStatus(); } catch (err) { console.warn('2FA-Status:', err); return true; }
  if (!(st.next === 'aal2' && st.current !== 'aal2' && st.factors.length)) return true;
  return askCode(st.factors[0].id, st.demo);
}

function askCode(factorId, demo) {
  return new Promise((resolve) => {
    const input = h('input', { name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', pattern: '[0-9 ]*', placeholder: '123 456', required: true, 'aria-label': 'Sechsstelliger Code' });
    const msg = h('p', { class: 'form-msg', role: 'alert' });
    const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Bestätigen');
    const out = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Abmelden');
    const form = h('form', { class: 'sec-mfa-form', method: 'dialog' },
      h('p', { class: 'account-lead' }, 'Dein Konto ist mit Zwei-Faktor-Anmeldung geschützt. Gib den 6-stelligen Code aus deiner Authenticator-App ein.'),
      demo ? h('p', { class: 'form-hint' }, 'Demo: Der Code ist 123456.') : null,
      h('label', { class: 'field sec-code' }, h('span', {}, 'Code'), input),
      msg,
      h('div', { class: 'dash-actions' }, out, submit));
    const dlg = h('dialog', { class: 'dialog dialog--extra sec-mfa-dialog', 'aria-labelledby': 'sec-mfa-title' },
      h('div', { class: 'dialog-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Sicherheit'), h('h2', { id: 'sec-mfa-title' }, '🔐 Code aus der App'))),
      form);
    document.body.append(dlg);
    const done = (ok) => { dlg.close(); dlg.remove(); resolve(ok); };
    dlg.addEventListener('cancel', (e) => e.preventDefault()); // ohne Code geht es nicht weiter
    out.addEventListener('click', async () => { await api().signOut().catch(() => {}); done(false); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = input.value.replace(/\s+/g, '');
      if (!/^\d{6}$/.test(code)) { msg.textContent = 'Bitte die 6 Ziffern aus der App eingeben.'; input.focus(); return; }
      submit.disabled = true;
      msg.textContent = '';
      try {
        await api().mfaVerify(factorId, code);
        done(true);
      } catch (err) {
        msg.textContent = /invalid|expired|code/i.test(err?.message ?? '') && !ctx.state.api.demo
          ? 'Der Code passt nicht oder ist abgelaufen. Uhrzeit am Handy prüfen und den aktuellen Code eingeben.'
          : ctx.germanError(err);
        input.select();
      } finally {
        submit.disabled = false;
      }
    });
    dlg.showModal();
    input.focus();
  });
}

// ============================================================
// Seite „Sicherheit“
// ============================================================
export async function renderSecurityPage() {
  const slot = document.getElementById('security-slot');
  if (!slot) return;
  const mfa = card({ icon: '🔐', title: 'Zwei-Faktor-Anmeldung', status: '…', id: 'sec-mfa' });
  const sessions = card({ icon: '💻', title: 'Angemeldete Geräte', status: '…', id: 'sec-sessions' });
  const cards = [mfa.el, sessions.el];
  let exportCard = null;
  if (isOwner()) {
    exportCard = card({ icon: '📦', title: 'Daten-Export', status: 'Alle Daten deines Kanals als Datei – zum Sichern oder zum Umziehen.', id: 'sec-export' });
    cards.push(exportCard.el, emergencyCard());
  }
  slot.replaceChildren(...cards);
  paintMfa(mfa);
  paintSessions(sessions);
  if (exportCard) paintExport(exportCard);
}

async function paintMfa(c) {
  let st;
  try { st = await api().mfaStatus(); } catch (err) {
    c.status.textContent = `Gerade nicht abrufbar: ${ctx.germanError(err)}`;
    return;
  }
  const on = st.factors.length > 0;
  c.el.classList.toggle('is-on', on);
  c.status.replaceChildren(on
    ? h('span', { class: 'sec-chip sec-chip--ok' }, '✓ Aktiv')
    : h('span', { class: 'sec-chip sec-chip--warn' }, 'Aus'),
  ' ', on ? `Seit ${fmtTime(st.factors[0].created_at)} – beim Anmelden fragt StreamHelp zusätzlich nach dem Code aus deiner App.`
    : 'Ein geklautes Passwort reicht dann nicht mehr: Beim Anmelden kommt zusätzlich ein Code aus deiner Authenticator-App.');
  const team = !!ctx.state.profile?.is_admin;
  if (on) {
    const off = h('button', { class: 'btn btn--outline btn--sm', type: 'button' }, 'Ausschalten');
    off.addEventListener('click', async () => {
      if (!confirm('Zwei-Faktor-Anmeldung wirklich ausschalten? Dann reicht wieder das Passwort bzw. der Twitch-Login.')) return;
      off.disabled = true;
      try {
        await api().mfaUnenroll(st.factors[0].id);
        ctx.toast('Zwei-Faktor-Anmeldung ist aus.', 'ok');
      } catch (err) {
        ctx.toast(ctx.germanError(err), 'error');
      }
      paintMfa(c);
    });
    c.body.replaceChildren(
      h('p', { class: 'form-hint' }, 'Handy verloren? Melde dich auf einem anderen Gerät an, solange du noch angemeldet bist, und schalte 2FA hier aus. Sonst hilft der Plattform-Admin (siehe NOTFALLPLAN.md).'),
      h('div', { class: 'dash-actions' }, off));
    return;
  }
  const start = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, '🔐 Jetzt einrichten');
  start.addEventListener('click', () => enrollFlow(c, start));
  c.body.replaceChildren(
    team ? h('p', { class: 'sec-callout' }, 'Du steuerst einen Kanal mit – für Streamer und Mods ist 2FA dringend empfohlen.') : null,
    h('ol', { class: 'sec-steps' },
      h('li', {}, 'Authenticator-App aufs Handy holen (z. B. Google Authenticator, Microsoft Authenticator, 2FAS, Aegis).'),
      h('li', {}, 'QR-Code scannen.'),
      h('li', {}, 'Den 6-stelligen Code aus der App hier bestätigen.')),
    h('div', { class: 'dash-actions' }, start));
}

async function enrollFlow(c, btn) {
  btn.disabled = true;
  let f;
  try {
    f = await api().mfaEnroll();
  } catch (err) {
    btn.disabled = false;
    ctx.toast(/mfa|factor|totp|not enabled/i.test(err?.message ?? '')
      ? `2FA ist in Supabase noch nicht freigeschaltet (Authentication → Multi-Factor → TOTP). ${ctx.germanError(err)}`
      : ctx.germanError(err), 'error', 9000);
    return;
  }
  const input = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', placeholder: '123 456', 'aria-label': 'Code aus der App' });
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const ok = h('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, 'Bestätigen & einschalten');
  const cancel = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Abbrechen');
  const copy = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Kopieren');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(f.secret.replace(/\s+/g, '')); ctx.toast('Schlüssel kopiert.', 'ok'); } catch { /* egal */ }
  });
  cancel.addEventListener('click', () => paintMfa(c));
  const form = h('form', { class: 'sec-enroll' },
    f.qr ? h('img', { class: 'sec-qr', src: f.qr, alt: 'QR-Code für die Authenticator-App', width: '180', height: '180' })
      : h('p', { class: 'form-hint' }, 'Demo: kein QR-Code – der Code ist hier immer 123456.'),
    h('div', { class: 'sec-enroll-side' },
      h('p', {}, 'Kein Scannen möglich? Diesen Schlüssel in der App von Hand eintragen:'),
      h('p', { class: 'sec-secret' }, h('code', {}, f.secret.replace(/(.{4})/g, '$1 ').trim()), ' ', copy),
      h('label', { class: 'field sec-code' }, h('span', {}, 'Code aus der App'), input),
      msg,
      h('div', { class: 'dash-actions' }, cancel, ok)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = input.value.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) { msg.textContent = 'Bitte die 6 Ziffern aus der App eingeben.'; return; }
    ok.disabled = true;
    try {
      await api().mfaVerify(f.id, code);
      ctx.toast('Zwei-Faktor-Anmeldung ist eingeschaltet. 🔐', 'ok', 6000);
      paintMfa(c);
      paintSessions(null);
    } catch (err) {
      msg.textContent = /invalid|expired/i.test(err?.message ?? '') ? 'Der Code passt nicht. Uhrzeit am Handy prüfen und den aktuellen Code eingeben.' : ctx.germanError(err);
      ok.disabled = false;
    }
  });
  c.body.replaceChildren(form);
  input.focus();
}

// Browser und System aus dem User-Agent – nur zur Anzeige
function deviceName(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' auf ') || (ua ? ua.slice(0, 40) : 'Unbekanntes Gerät');
}

async function paintSessions(c) {
  c ??= (() => {
    const el = document.getElementById('sec-sessions');
    return el ? { el, body: el.querySelector('.sec-body'), status: el.querySelector('.dash-status') } : null;
  })();
  if (!c) return;
  let list;
  try { list = await api().mySessions(); } catch (err) {
    c.status.textContent = missing(err) ? MIGRATION_HINT : `Gerade nicht abrufbar: ${ctx.germanError(err)}`;
    c.body.replaceChildren();
    return;
  }
  const others = list.filter((s) => !s.current);
  c.status.textContent = others.length
    ? `${list.length} Anmeldungen. Etwas kommt dir unbekannt vor? Beenden – und dein Passwort ändern.`
    : 'Nur dieses Gerät ist angemeldet.';
  const rows = list.map((s) => {
    const end = s.current ? h('span', { class: 'sec-chip sec-chip--ok' }, 'Dieses Gerät')
      : h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Abmelden');
    if (!s.current) {
      end.addEventListener('click', async () => {
        end.disabled = true;
        try { await api().revokeSession(s.id); ctx.toast('Gerät abgemeldet.', 'ok'); } catch (err) { ctx.toast(ctx.germanError(err), 'error', 7000); }
        paintSessions(c);
      });
    }
    return h('li', { class: 'sec-session' },
      h('span', { class: 'sec-session-ico', 'aria-hidden': 'true' }, /iPhone|Android|Mobile/.test(s.user_agent) ? '📱' : '💻'),
      h('span', { class: 'sec-session-text' },
        h('b', {}, deviceName(s.user_agent)),
        h('small', {}, [s.ip, `aktiv ${ago(s.last_at)}`, `angemeldet ${fmtTime(s.created_at)}`, s.aal === 'aal2' ? '🔐 mit Code' : ''].filter(Boolean).join(' · '))),
      end);
  });
  const all = h('button', { class: 'btn btn--outline btn--sm', type: 'button', disabled: !others.length }, 'Alle anderen Geräte abmelden');
  all.addEventListener('click', async () => {
    all.disabled = true;
    try { await api().signOutOthers(); ctx.toast('Alle anderen Geräte sind abgemeldet.', 'ok'); } catch (err) { ctx.toast(ctx.germanError(err), 'error'); }
    paintSessions(c);
  });
  c.body.replaceChildren(h('ul', { class: 'sec-sessions' }, rows),
    h('p', { class: 'form-hint' }, 'Abgemeldete Geräte verlieren den Zugang spätestens nach einer Stunde (dann läuft ihr Zugangsschlüssel ab).'),
    h('div', { class: 'dash-actions' }, all));
}

function paintExport(c) {
  const btn = h('button', { class: 'btn btn--primary btn--sm', type: 'button' }, '⬇️ Kanal-Daten herunterladen');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const data = await api().channelExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `streamhelp-${data.channel?.login || 'kanal'}-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      ctx.toast(`Export fertig: ${Object.keys(data.tables ?? {}).length} Bereiche.`, 'ok');
    } catch (err) {
      ctx.toast(missing(err) ? MIGRATION_HINT : ctx.germanError(err), 'error', 8000);
    } finally {
      btn.disabled = false;
    }
  });
  c.body.replaceChildren(
    h('p', { class: 'form-hint' }, 'Enthält Kacheln, Glücksrad, Bingo, Overlay- und Alert-Einstellungen, Befehle, Watchtime, Protokoll und mehr. Ohne Twitch-Zugangsschlüssel und ohne Quiz-/Pausen-Lösungen. Bilder und Sounds liegen getrennt im Speicher und sind nicht in der Datei.'),
    h('div', { class: 'dash-actions' }, btn));
}

function emergencyCard() {
  const go = (page, text) => h('button', { class: 'btn btn--ghost btn--sm', type: 'button', dataset: { goto: page } }, text);
  const item = (title, text, ...actions) => h('li', {}, h('b', {}, title), h('span', {}, text), actions.length ? h('span', { class: 'sec-em-actions' }, actions) : null);
  return h('section', { class: 'dash-card dash-card--wide sec-card', id: 'sec-emergency' },
    h('header', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, '🚨'),
      h('div', {}, h('h2', {}, 'Wenn etwas schiefgeht'), h('p', { class: 'dash-status' }, 'Die wichtigsten Handgriffe – in dieser Reihenfolge.'))),
    h('ul', { class: 'sec-emergency' },
      item('Raid oder Spam im Stream', 'Raid-Schutz an: pausiert alle Zuschauer-Aktionen, Kanalpunkte gehen zurück.', go('guard', '🛡️ Raid-Schutz')),
      item('Ein Mod macht Unsinn', 'Im Protokoll nachsehen, dann seine Rechte einschränken oder „Für Mods freigeben“ ausschalten.', go('mods', '👥 Mods & Protokoll')),
      item('Passwort oder Konto geklaut', 'Hier oben alle anderen Geräte abmelden, Passwort ändern, 2FA einschalten.'),
      item('Twitch-Konto gekapert', 'Twitch trennen, auf twitch.tv Passwort ändern und unter Verbindungen StreamHelp entfernen, danach neu verbinden.', go('twitch', '🟣 Twitch-Verbindung'))));
}

// ============================================================
// Seite „Mods“: Rechte je Mod und Protokoll
// ============================================================
export async function renderModSecurity() {
  const rights = document.getElementById('mod-rights');
  const audit = document.getElementById('mod-audit');
  if (!rights || !audit) return;
  const a = access();
  const owner = isOwner();
  rights.hidden = !(owner || a.is_mod);
  audit.hidden = !owner;
  if (!rights.hidden) paintRights(rights, owner);
  if (!audit.hidden) paintAudit(audit, { reset: true });
}

async function paintRights(box, owner) {
  const head = h('header', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, '🎚️'),
    h('div', {}, h('h2', {}, owner ? 'Rechte je Mod' : 'Deine Rechte'),
      h('p', { class: 'dash-status' }, owner ? 'Haken weg = dieser Mod darf den Bereich nicht steuern. Twitch-Verbindung, Mod-Freigabe und Export bleiben immer bei dir.'
        : 'Was du als Mod in diesem Kanal steuern darfst. Gesperrtes kann nur der Streamer freigeben.')));
  box.replaceChildren(head, h('p', { class: 'dash-status' }, 'Lädt …'));
  let mods;
  try { mods = await api().modRights(); } catch (err) {
    box.replaceChildren(head, h('p', { class: 'form-hint' }, missing(err) ? MIGRATION_HINT : ctx.germanError(err)));
    return;
  }
  if (!mods.length) {
    box.replaceChildren(head, h('p', { class: 'form-hint' }, owner ? 'Noch keine Mods – oben „Mods von Twitch holen“.' : 'Keine Rechte gefunden.'));
    return;
  }
  const rows = mods.map((m) => {
    const denied = new Set(m.denied ?? []);
    const summary = h('small', { class: 'sec-mod-sum' });
    const paintSum = () => {
      summary.textContent = denied.size ? `${MOD_AREAS.length - denied.size} von ${MOD_AREAS.length} Bereichen` : 'Alles erlaubt';
    };
    paintSum();
    let timer = 0;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await api().setModRights(m.twitch_user_id, [...denied]);
          ctx.toast(`Rechte von ${m.display_name || m.login} gespeichert.`, 'ok', 2500);
        } catch (err) {
          ctx.toast(ctx.germanError(err), 'error');
        }
      }, 500);
    };
    const all = owner ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, denied.size ? 'Alles erlauben' : 'Alles sperren') : null;
    const chips = MOD_AREAS.map((area) => {
      const input = h('input', { type: 'checkbox', checked: !denied.has(area.key), disabled: !owner });
      input.addEventListener('change', () => {
        if (input.checked) denied.delete(area.key); else denied.add(area.key);
        paintSum();
        if (all) all.textContent = denied.size ? 'Alles erlauben' : 'Alles sperren';
        save();
      });
      return h('label', { class: 'sec-area', title: area.hint ?? area.label }, input, h('span', {}, `${area.icon} ${area.label}`));
    });
    all?.addEventListener('click', () => {
      const allow = denied.size > 0;
      denied.clear();
      if (!allow) MOD_AREAS.forEach((x) => denied.add(x.key));
      chips.forEach((c, i) => { c.querySelector('input').checked = !denied.has(MOD_AREAS[i].key); });
      all.textContent = denied.size ? 'Alles erlauben' : 'Alles sperren';
      paintSum();
      save();
    });
    return h('li', { class: 'sec-mod' },
      h('div', { class: 'sec-mod-head' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, (m.display_name || m.login || '?').slice(0, 1).toUpperCase()),
        h('b', {}, m.display_name || m.login), summary, all),
      h('div', { class: 'sec-areas' }, chips));
  });
  box.replaceChildren(head, h('ul', { class: 'sec-mods' }, rows),
    owner ? h('p', { class: 'form-hint' }, 'Gilt sofort. Bilder und Sounds hochladen hängt nicht an den Bereichen, sondern an der Mod-Freigabe.') : null);
}

// Was hinter einer Aktion steckt – Funktionen der Datenbank und Edge Functions auf Deutsch
const ACTIONS = {
  giveaway_start: 'Verlosung gestartet', giveaway_close: 'Verlosung geschlossen', giveaway_draw: 'Gewinner gezogen',
  giveaway_reset: 'Verlosung zurückgesetzt', giveaway_kick: 'Teilnehmer entfernt',
  site_guard_set: 'Raid-Schutz geschaltet', wheel_variants_save: 'Glücksrad bearbeitet', wheel_cost: 'Glücksrad-Kosten geändert',
  spin: 'Glücksrad gedreht (mit Chat-Ansage)', bingo_new_card: 'Neue Bingo-Karte', bingo_toggle: 'Bingo-Feld abgehakt',
  bingo_bet_start: 'Tipprunde gestartet', bingo_bet_cancel: 'Tipprunde abgebrochen',
  overlay_save: 'Overlay gespeichert', overlay_allow_mods: 'Mod-Freigabe geändert', overlay_allow_admins: 'Admin-Freigabe geändert',
  overlay_preset_save: 'Overlay-Vorlage gespeichert', overlay_preset_delete: 'Overlay-Vorlage gelöscht', alert_test: 'Test-Alert geschickt',
  send_prank: 'Streich ausgelöst', pet_action: 'Haustier gefüttert/gestreichelt', pet_say: 'Haustier spricht', pet_frenzy: 'Heißhunger ausgelöst',
  pet_costume: 'Haustier-Kostüm geändert', quiz_start: 'Quiz-Frage gestartet', quiz_reveal: 'Quiz-Lösung gezeigt',
  quiz_reset_scores: 'Quiz-Punkte zurückgesetzt', forbidden_save: 'Verbotenes Wort eingestellt', forbidden_draw: 'Verbotenes Wort gezogen',
  forbidden_judge: 'Meldung beim Verbotenen Wort bewertet', subathon_control: 'Subathon-Timer gesteuert', subathon_save: 'Subathon eingestellt',
  pause_start: 'Pause gestartet', pause_stop: 'Pause beendet', queue_pick: 'Mitspieler gezogen', queue_save: 'Warteschlange eingestellt',
  tts_review: 'Vorlese-Nachricht geprüft', tts_skip: 'Vorlesen übersprungen', tts_save: 'Vorlesen eingestellt',
  stream_reward_set: 'Kanalpunkte-Belohnung geändert', hotwords_reset: 'Hot Words zurückgesetzt', hotwords_settings: 'Hot Words eingestellt',
  mod_rights_set: 'Mod-Rechte geändert', sync_pranks: 'Ärgern-Belohnungen abgeglichen', sync_reward: 'Belohnung auf Twitch abgeglichen',
  sync_mods: 'Mods von Twitch geholt', anniversary: 'Kanal-Jubiläum gestartet', twitch_connect: 'Twitch-Verbinden gestartet',
  twitch_disconnect: 'Twitch getrennt', games_save: 'Games eingestellt', question_show: 'Frage gezeigt', question_resolve: 'Frage aufgelöst',
  question_hide: 'Frage ausgeblendet', challenge_result: 'Win-Challenge: Ergebnis', challenge_save: 'Win-Challenge bearbeitet',
  challenge_reset: 'Win-Challenge zurückgesetzt', cards_save_settings: 'Sammelkarten eingestellt', card_save: 'Sammelkarte gespeichert',
  shop_settings: 'Kisten-Shop eingestellt', bot_say: 'Bot-Nachricht', channel_set_status: 'Kanal-Status geändert',
};
const TABLES = {
  tiles: 'Kachel', ideas: 'Vorschlag', bot_commands: 'Bot-Befehl', ticker: 'Laufband', alert_config: 'Alert-Design',
  alert_media: 'Alert-Bild', alert_sounds: 'Alert-Sound', overlay_config: 'Overlay', overlay_presets: 'Overlay-Vorlage', bingo_items: 'Bingo-Item',
  bingo_card: 'Bingo-Karte', wheel_variants: 'Glücksrad', questions: 'Frage', quiz_questions: 'Quiz-Frage', card_defs: 'Sammelkarte',
  pet: 'Haustier', sounds: 'Sound', prank_settings: 'Ärgern-Einstellungen', shop_settings: 'Kisten-Shop', giveaway: 'Verlosung',
  site_guard: 'Raid-Schutz', mod_rights: 'Mod-Rechte', tts_settings: 'Vorlesen', subathon: 'Subathon', pause_screen: 'Pause',
};
const OPS = { insert: 'angelegt', update: 'geändert', delete: 'gelöscht' };
const DETAILS = { cost: 'Kosten', start: 'Start', seconds: 'Sekunden', key: 'Belohnung', result: 'Ergebnis', variant: 'Variante' };
const ROLES = { owner: 'Streamer', mod: 'Mod', admin: 'Admin' };

function actionText(e) {
  if (ACTIONS[e.action]) return ACTIONS[e.action];
  const t = e.tables?.[0];
  if (t) return `${TABLES[t] ?? t} ${e.ops?.map((o) => OPS[o] ?? o).join('/') ?? ''}`.trim();
  return e.action || 'Änderung';
}

const auditState = { items: [], role: null, done: false };

async function paintAudit(box, { reset = false } = {}) {
  if (reset) Object.assign(auditState, { items: [], done: false });
  const filter = h('select', { 'aria-label': 'Wer' },
    h('option', { value: '' }, 'Alle'), h('option', { value: 'mod', selected: auditState.role === 'mod' }, 'Nur Mods'),
    h('option', { value: 'owner', selected: auditState.role === 'owner' }, 'Nur ich'));
  filter.addEventListener('change', () => { auditState.role = filter.value || null; paintAudit(box, { reset: true }); });
  const head = h('header', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, '📜'),
    h('div', {}, h('h2', {}, 'Mod-Protokoll'), h('p', { class: 'dash-status' }, 'Wer hat wann was geändert? Zuschauer-Aktionen stehen hier nicht. Einträge bleiben 90 Tage.')),
    filter);
  const list = h('ol', { class: 'sec-audit' });
  const more = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Ältere laden');
  box.replaceChildren(head, list, h('div', { class: 'dash-actions' }, more));
  const load = async () => {
    more.disabled = true;
    try {
      const before = auditState.items.at(-1)?.id ?? null;
      const page = await api().auditLog({ before, role: auditState.role, limit: 40 });
      auditState.items.push(...page);
      auditState.done = page.length < 40;
    } catch (err) {
      list.replaceChildren(h('li', { class: 'form-hint' }, missing(err) ? MIGRATION_HINT : ctx.germanError(err)));
      more.hidden = true;
      return;
    }
    list.replaceChildren(...(auditState.items.length ? auditState.items.map((e) => h('li', { class: `sec-log sec-log--${e.role}` },
      h('time', { datetime: e.at, title: fmtTime(e.at) }, ago(e.at)),
      h('span', { class: `sec-chip sec-chip--${e.role === 'mod' ? 'warn' : 'ok'}` }, ROLES[e.role] ?? e.role),
      h('b', {}, e.actor_name || '–'),
      h('span', {}, actionText(e)),
      e.detail && Object.keys(e.detail).length ? h('small', {}, Object.entries(e.detail).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${DETAILS[k] ?? k}: ${v}`).join(' · ')) : null))
      : [h('li', { class: 'form-hint' }, 'Noch nichts passiert.')]));
    more.hidden = auditState.done;
    more.disabled = false;
  };
  more.addEventListener('click', load);
  await load();
}

// ============================================================
// Bot-Schutz: Cloudflare Turnstile beim Anmelden und Registrieren
// ============================================================
const captcha = { loading: null, widgets: new Map() };
export const captchaOn = () => !!CONFIG.TURNSTILE_SITE_KEY && !ctx?.state.api?.demo;

function loadTurnstile() {
  return captcha.loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => { captcha.loading = null; reject(new Error('Der Bot-Schutz (Cloudflare) lädt nicht. Werbeblocker für diese Seite aus?')); };
    document.head.append(s);
  });
}

// Prüf-Feld in ein Formular setzen (einmal je Formular)
export async function mountCaptcha(form) {
  if (!captchaOn() || captcha.widgets.has(form)) return;
  const slot = form.querySelector('.captcha-slot') ?? form.insertBefore(h('div', { class: 'captcha-slot' }), form.querySelector('[type=submit]'));
  captcha.widgets.set(form, null);
  try {
    const ts = await loadTurnstile();
    captcha.widgets.set(form, ts.render(slot, { sitekey: CONFIG.TURNSTILE_SITE_KEY, theme: 'dark', language: 'de', appearance: 'interaction-only' }));
  } catch (err) {
    captcha.widgets.delete(form);
    slot.textContent = err.message;
  }
}

// Token fürs Absenden (undefined, wenn kein Bot-Schutz eingerichtet ist). Jedes Token gilt nur einmal.
export async function captchaToken(form) {
  if (!captchaOn()) return undefined;
  await mountCaptcha(form);
  const id = captcha.widgets.get(form);
  const token = id != null ? window.turnstile?.getResponse(id) : '';
  if (!token) throw new Error('Bitte kurz warten, bis die Bot-Prüfung fertig ist, und dann noch einmal absenden.');
  return token;
}

export function resetCaptcha(form) {
  const id = captcha.widgets.get(form);
  if (id != null) window.turnstile?.reset(id);
}

// Einfache Bot-Falle ohne Fremddienst: verstecktes Feld, das nur Bots ausfüllen,
// und Absenden schneller als ein Mensch tippen kann.
export function botTrap(form) {
  const shown = Date.now();
  if (!form.querySelector('input[name="website"]')) {
    form.append(h('label', { class: 'sec-trap', 'aria-hidden': 'true' }, 'Website',
      h('input', { name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' })));
  }
  form.dataset.shownAt = String(shown);
}

export function looksLikeBot(form) {
  const filled = !!form.querySelector('input[name="website"]')?.value;
  const fast = Date.now() - Number(form.dataset.shownAt || 0) < 1500;
  return filled || fast;
}
