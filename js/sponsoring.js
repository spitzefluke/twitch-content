// Sponsoring-Börse für Firmen (sponsoring.html, Migration …_sponsoring.sql, Edge Function sponsoring).
//   · Ohne #k: Formular – Firma, Angebot, Zielgruppe (Ø Zuschauer), Einblendung im Overlay mit Vorschau.
//     Nach dem Einreichen gibt es einmalig den privaten Verwaltungs-Link (sponsoring.html#k=<schlüssel>).
//   · Mit #k=<schlüssel>: Stand des Angebots, Bewerbungen (Zahlen nur, wenn der Streamer zustimmt),
//     Zusagen/Absagen, laufende Sponsorings beenden, Angebot beenden.
// Der Schlüssel steht im #-Teil der Adresse – der geht beim Laden nie an einen Server.
import { createApi, germanError } from './api.js';
import { h } from './extras-core.js';
import { SPONSORING_OPEN, SPONSORING_SOON, readLogo, sponsorLogoUrl } from './sponsor-files.js';

const $ = (sel) => document.querySelector(sel);
const api = createApi();
const icon = (cls) => h('i', { class: `ph ${cls}`, 'aria-hidden': 'true' });
const keyOf = () => /^#k=([0-9a-f]{64})$/.exec(location.hash)?.[1] ?? '';
const STATUS = { pending: '⏳ Wird geprüft', active: '✅ Freigegeben – Streamer können sich bewerben', rejected: '✖ Abgelehnt', closed: '⏹ Beendet' };
const APP_STATUS = { pending: 'wartet auf euch', accepted: 'läuft', declined: 'abgesagt', ended: 'beendet' };
const money = (c) => (c == null ? '' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(c / 100));
const range = (o) => `Ø ${o.min_viewers}${o.max_viewers != null ? `–${o.max_viewers}` : '+'} Zuschauer`;

// ---------- Formular ----------
let logoData = '';

function preview() {
  const f = $('#sp-form');
  $('#sp-ad-name').textContent = f.company.value.trim() || 'Eure Firma';
  $('#sp-ad-line').textContent = f.overlay_text.value.trim() || 'Text der Einblendung';
  const code = f.code.value.trim();
  $('#sp-ad-code').hidden = !code;
  $('#sp-ad-code').textContent = code ? `Code: ${code}` : '';
  $('#sp-ad-logo').replaceChildren(logoData ? h('img', { src: logoData, alt: '' }) : icon('ph-image'));
  f.show_sec_out.value = f.show_sec.value;
}

function setupForm() {
  const f = $('#sp-form');
  f.addEventListener('input', preview);
  f.logo.addEventListener('change', async () => {
    try {
      logoData = await readLogo(f.logo.files[0]);
      msg('');
    } catch (err) {
      logoData = '';
      f.logo.value = '';
      msg(err.message);
    }
    preview();
  });
  f.addEventListener('submit', submit);
  preview();
}

function msg(text, ok = false) {
  $('#sp-msg').textContent = text;
  $('#sp-msg').classList.toggle('is-ok', ok);
}

async function submit(e) {
  e.preventDefault();
  const f = e.currentTarget;
  if (!f.agree.checked) { msg('Bitte bestätigt die Bedingungen.'); return; }
  const amount = f.amount.value.trim() ? Math.round(Number.parseFloat(f.amount.value.replace(',', '.')) * 100) : '';
  if (amount !== '' && (!Number.isFinite(amount) || amount < 0)) { msg('Betrag: bitte eine Zahl wie 50 oder 49,90.'); return; }
  const offer = {
    company: f.company.value.trim(), contact_email: f.contact_email.value.trim(), website: f.website.value.trim(),
    title: f.title.value.trim(), description: f.description.value.trim(), reward: f.reward.value.trim(),
    pay_mode: f.pay_mode.value, amount_cents: amount, ends_on: f.ends_on.value,
    min_viewers: f.min_viewers.value, max_viewers: f.max_viewers.value, slots: f.slots.value,
    overlay_text: f.overlay_text.value.trim(), code: f.code.value.trim(), link: f.link.value.trim(),
    every_min: f.every_min.value, show_sec: f.show_sec.value,
  };
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  msg('Wird gesendet …', true);
  try {
    const res = await api.sponsoringSubmit(offer, logoData, f.website2.value);
    const link = new URL(`sponsoring.html#k=${res.token}`, location.href).href;
    $('#sp-link').value = link;
    $('#sp-open').href = link;
    f.hidden = true;
    $('#sp-intro').hidden = true;
    $('#sp-done').hidden = false;
    $('#sp-done').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    msg(germanError(err));
  } finally {
    btn.disabled = false;
  }
}

$('#sp-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#sp-link').value);
    $('#sp-copy').lastChild.textContent = 'Kopiert';
  } catch {
    $('#sp-link').select();
  }
});

// ---------- Verwaltung ----------
let data = null;

async function loadManage() {
  const box = $('#sp-manage');
  $('#sp-intro').hidden = true;
  $('#sp-form').hidden = true;
  $('#sp-soon').hidden = true;
  $('#sp-done').hidden = true;
  box.hidden = false;
  box.replaceChildren(h('p', { class: 'pp-loading' }, 'Lädt …'));
  try {
    data = await api.sponsoringManage(keyOf());
    paintManage();
  } catch (err) {
    box.replaceChildren(h('section', { class: 'sp-card' }, h('h2', {}, 'Dieser Link funktioniert nicht'),
      h('p', {}, germanError(err)), h('a', { class: 'pp-btn', href: 'sponsoring.html' }, 'Neues Angebot einreichen')));
  }
}

async function act(fn) {
  try {
    data = await fn();
    paintManage();
  } catch (err) {
    alert(germanError(err));
  }
}

function paintManage() {
  const o = data.offer;
  const apps = data.applications ?? [];
  const logo = sponsorLogoUrl(o.logo_path);
  const close = h('button', { type: 'button', class: 'pp-btn pp-btn--ghost' }, icon('ph-stop-circle'), 'Angebot beenden');
  close.addEventListener('click', () => {
    if (!confirm('Angebot beenden? Es kommen keine neuen Bewerbungen, laufende Einblendungen enden sofort.')) return;
    act(() => api.sponsoringClose(keyOf()));
  });
  const open = ['pending', 'active'].includes(o.status);
  $('#sp-manage').replaceChildren(
    h('section', { class: 'sp-card' },
      h('span', { class: 'sp-status', 'data-s': o.status }, STATUS[o.status] ?? o.status),
      h('h2', {}, o.title),
      h('ul', { class: 'sp-facts' },
        h('li', {}, `🏢 ${o.company}`), h('li', {}, `👥 ${range(o)}`), h('li', {}, `🎟️ ${o.taken ?? 0} von ${o.slots} Plätzen vergeben`),
        h('li', {}, o.pay_mode === 'streamhelp' ? '💳 Abrechnung über StreamHelp' : '💳 Ihr zahlt den Streamer direkt'),
        o.amount_cents != null ? h('li', {}, `💶 ${money(o.amount_cents)}`) : null,
        o.ends_on ? h('li', {}, `📅 bis ${new Date(o.ends_on).toLocaleDateString('de-DE')}`) : null),
      o.admin_note ? h('p', { class: 'sp-hint' }, `Hinweis von StreamHelp: ${o.admin_note}`) : null,
      o.status === 'pending' ? h('p', { class: 'sp-hint' }, 'Wir prüfen euer Angebot. Danach sehen es passende Streamer im Dashboard – schaut einfach hier wieder rein.') : null,
      h('div', { class: 'sp-stage' }, h('div', { class: 'sp-ad' }, h('span', { class: 'sp-ad-tag' }, 'Anzeige'),
        h('span', { class: 'sp-ad-logo' }, logo ? h('img', { src: logo, alt: '' }) : icon('ph-image')),
        h('span', { class: 'sp-ad-text' }, h('b', {}, o.company), h('span', {}, o.overlay_text || ''), o.code ? h('span', { class: 'sp-ad-code' }, `Code: ${o.code}`) : null))),
      h('p', { class: 'sp-hint' }, `Einblendung alle ${o.every_min} Minuten für ${o.show_sec} Sekunden, dazu im Laufband und bei !sponsor im Chat.`),
      open ? h('div', {}, close) : null),
    h('section', { class: 'sp-card' },
      h('h2', {}, `Bewerbungen (${apps.length})`),
      apps.length ? h('ul', { class: 'sp-apps' }, ...apps.map(appRow)) : h('p', { class: 'sp-hint' }, 'Noch keine Bewerbungen.')));
}

function appRow(a) {
  const name = a.display_name || a.login;
  const btns = [];
  if (a.status === 'pending' && data.offer.status === 'active') {
    const yes = h('button', { type: 'button', class: 'pp-btn' }, icon('ph-check'), 'Zusagen');
    yes.addEventListener('click', () => {
      const note = prompt(`${name} zusagen? Eure Einblendung läuft dann in diesem Kanal. Nachricht an den Streamer (optional):`, '');
      if (note !== null) act(() => api.sponsoringDecide(keyOf(), a.id, 'accept', note));
    });
    const no = h('button', { type: 'button', class: 'pp-btn pp-btn--ghost' }, 'Absagen');
    no.addEventListener('click', () => {
      const note = prompt(`${name} absagen? Nachricht (optional):`, '');
      if (note !== null) act(() => api.sponsoringDecide(keyOf(), a.id, 'decline', note));
    });
    btns.push(yes, no);
  }
  if (a.status === 'accepted') {
    const end = h('button', { type: 'button', class: 'pp-btn pp-btn--ghost' }, 'Beenden');
    end.addEventListener('click', () => {
      if (confirm(`Sponsoring mit ${name} beenden? Die Einblendung verschwindet aus dem Stream.`)) act(() => api.sponsoringDecide(keyOf(), a.id, 'end'));
    });
    btns.push(end);
  }
  const s = a.stats;
  return h('li', { class: 'sp-app' },
    h('span', { class: 'sp-app-ava', 'aria-hidden': 'true' }, /^https:\/\//.test(a.avatar_url ?? '') ? h('img', { src: a.avatar_url, alt: '', referrerpolicy: 'no-referrer' }) : name.slice(0, 1).toUpperCase()),
    h('span', { class: 'sp-app-who' },
      h('a', { href: `https://www.twitch.tv/${encodeURIComponent(a.login)}`, target: '_blank', rel: 'noopener noreferrer' }, name),
      h('span', {}, `${APP_STATUS[a.status] ?? a.status}${s ? ` · Ø ${s.avg} Zuschauer, Spitze ${s.peak}, ${s.streams} Streams in 30 Tagen` : ' · Zahlen nicht geteilt'}`),
      a.message ? h('q', {}, a.message) : null),
    h('span', { class: 'sp-app-btns' }, ...btns));
}

// ---------- Start ----------
// Solange die Börse geschlossen ist (Gewerbe in Anmeldung), gibt es statt des Formulars einen Hinweis
$('#sp-soon-text').textContent = SPONSORING_SOON;
$('#sp-soon').hidden = SPONSORING_OPEN;
$('#sp-form').hidden = !SPONSORING_OPEN;
setupForm();
if (keyOf()) loadManage();
addEventListener('hashchange', () => { if (keyOf()) loadManage(); });
