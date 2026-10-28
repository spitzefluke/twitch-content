// Profil & Zeitplan (Dashboard → Profil & Zeitplan, Migration …_profile_schedule.sql):
//   · Wochenplan: Wochentag, Uhrzeit, Dauer, Titel, Game – höchstens 21 Termine. Bearbeiten dürfen
//     Streamer, Admins und freigegebene Mods.
//   · Profil: Kurztext, Links, Zeitzone, „Pause bis …“. Öffentlich machen (profil.html?c=<login>)
//     entscheidet nur der Streamer – ohne Zustimmung gibt es keine öffentliche Seite.
// Rechts die nächsten Termine, so wie sie auf der öffentlichen Seite stehen.
import { h } from './extras-core.js';
import { socialFor } from './social-icons.js';

export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const DURATIONS = [30, 60, 90, 120, 150, 180, 240, 300, 360, 480];
const TIMEZONES = ['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London', 'Europe/Paris', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Amsterdam', 'Europe/Warsaw', 'Europe/Istanbul', 'Europe/Moscow', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];
const MAX_SLOTS = 21;
const MAX_LINKS = 8;

const icon = (cls) => h('i', { class: `ph ${cls}`, 'aria-hidden': 'true' });
export const fmtDuration = (m) => (m >= 60 ? `${Math.floor(m / 60)} Std${m % 60 ? ` ${m % 60} Min` : ''}` : `${m} Min`);
export const fmtWhen = (iso, tz) => new Date(iso).toLocaleString('de-DE', {
  weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}),
});

let ctx = null;   // { api, toast, germanError, profileUrl }
let data = null;  // profile_get()
let slots = [];
let links = [];
let draft = {};   // Profil-Felder, die noch nicht gespeichert sind
let busy = false;

export async function renderProfile(slot, deps) {
  ctx = deps;
  slot.replaceChildren(h('p', { class: 'form-hint' }, 'Lädt …'));
  try {
    data = await ctx.api.profileGet();
  } catch (err) {
    slot.replaceChildren(h('article', { class: 'dash-card dash-card--wide' }, h('p', { class: 'form-hint' }, ctx.germanError(err))));
    return;
  }
  takeSlots();
  takeProfile();
  paint(slot);
}

const takeSlots = () => { slots = (data.slots ?? []).map((s) => ({ ...s })); };
function takeProfile() {
  links = (data.links ?? []).map((l) => ({ ...l }));
  draft = { is_public: !!data.is_public, bio: data.bio ?? '', tz: data.tz, away_until: data.away_until ?? '', away_note: data.away_note ?? '' };
}

function paint(slot) {
  slot.replaceChildren(scheduleCard(slot), upcomingCard(), profileCard(slot));
}

// ---------- Wochenplan ----------
function scheduleCard(slot) {
  const rows = h('div', { class: 'pf-slots' }, ...slots.map((s, i) => slotRow(s, i, slot)));
  const add = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: slots.length >= MAX_SLOTS }, icon('ph-plus'), 'Termin hinzufügen');
  add.addEventListener('click', () => {
    const last = slots.at(-1);
    slots.push({ weekday: last ? (last.weekday % 7) + 1 : 1, start: last?.start ?? '19:00', minutes: last?.minutes ?? 120, title: '', game: '' });
    paint(slot);
    slot.querySelector('.pf-slot:last-child select')?.focus();
  });
  const save = h('button', { type: 'button', class: 'btn btn--primary btn--sm', disabled: busy }, icon('ph-floppy-disk'), 'Zeitplan speichern');
  save.addEventListener('click', () => run(slot, () => ctx.api.scheduleSave(slots.map(({ weekday, start, minutes, title, game }) => ({ weekday: Number(weekday), start, minutes: Number(minutes), title, game }))), 'Zeitplan gespeichert.', takeSlots));
  return h('section', { class: 'dash-card dash-card--wide pf-card', 'aria-labelledby': 'pf-plan-title' },
    h('header', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, '🗓️'),
      h('div', {}, h('h2', { id: 'pf-plan-title' }, 'Wochenplan'),
        h('p', { class: 'dash-status' }, slots.length ? `${slots.length} ${slots.length === 1 ? 'Termin' : 'Termine'} pro Woche · Uhrzeiten in ${data.tz}` : 'Noch keine festen Termine – trag ein, wann du meistens live bist.'))),
    slots.length ? h('div', { class: 'pf-slot-head', 'aria-hidden': 'true' }, h('span', {}, 'Tag'), h('span', {}, 'Start'), h('span', {}, 'Dauer'), h('span', {}, 'Titel'), h('span', {}, 'Game'), h('span')) : null,
    rows,
    h('div', { class: 'dash-actions' }, add, save),
    h('p', { class: 'form-hint' }, 'Feste Termine helfen Zuschauern, wiederzukommen. Ausfälle trägst du unten unter „Pause“ ein – dann verschwinden die Termine bis dahin.'));
}

function slotRow(s, i, slot) {
  const set = (k) => (e) => { slots[i][k] = e.target.value; };
  const day = h('select', { 'aria-label': `Termin ${i + 1}: Wochentag` }, ...WEEKDAYS.map((d, n) => h('option', { value: String(n + 1) }, d)));
  day.value = String(s.weekday);
  day.addEventListener('change', set('weekday'));
  const time = h('input', { type: 'time', value: s.start, required: true, 'aria-label': `Termin ${i + 1}: Uhrzeit` });
  time.addEventListener('change', set('start'));
  const dur = h('select', { 'aria-label': `Termin ${i + 1}: Dauer` },
    ...[...new Set([...DURATIONS, Number(s.minutes)])].sort((a, b) => a - b).map((m) => h('option', { value: String(m) }, fmtDuration(m))));
  dur.value = String(s.minutes);
  dur.addEventListener('change', set('minutes'));
  const title = h('input', { type: 'text', value: s.title, maxlength: '80', placeholder: 'z. B. Ranked-Abend', 'aria-label': `Termin ${i + 1}: Titel` });
  title.addEventListener('input', set('title'));
  const game = h('input', { type: 'text', value: s.game, maxlength: '60', placeholder: 'Game', 'aria-label': `Termin ${i + 1}: Game` });
  game.addEventListener('input', set('game'));
  const del = h('button', { type: 'button', class: 'pf-del', title: 'Termin entfernen', 'aria-label': `Termin ${i + 1} entfernen` }, icon('ph-trash'));
  del.addEventListener('click', () => { slots.splice(i, 1); paint(slot); });
  return h('div', { class: 'pf-slot' }, day, time, dur, title, game, del);
}

function upcomingCard() {
  const list = data.upcoming ?? [];
  const away = data.away_until && data.away_until >= new Date().toISOString().slice(0, 10);
  return h('section', { class: 'dash-card pf-card', 'aria-labelledby': 'pf-next-title' },
    h('header', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, '⏰'),
      h('div', {}, h('h2', { id: 'pf-next-title' }, 'Nächste Termine'), h('p', { class: 'dash-status' }, 'So stehen sie auf deinem Profil (gespeicherter Stand).'))),
    away ? h('p', { class: 'pf-away' }, icon('ph-airplane-tilt'), `Pause bis ${new Date(`${data.away_until}T12:00:00`).toLocaleDateString('de-DE')}${data.away_note ? ` – ${data.away_note}` : ''}`) : null,
    list.length
      ? h('ul', { class: 'pf-next' }, ...list.map((t) => h('li', {}, h('b', {}, fmtWhen(t.at, data.tz)), h('span', {}, [t.title, t.game].filter(Boolean).join(' · ') || 'Stream'), h('small', {}, fmtDuration(t.minutes)))))
      : h('p', { class: 'form-hint' }, 'In den nächsten 14 Tagen steht nichts an.'));
}

// ---------- Profil ----------
function profileCard(slot) {
  const url = ctx.profileUrl(data.login);
  const pub = h('input', { type: 'checkbox', checked: draft.is_public, disabled: !data.can_publish });
  pub.addEventListener('change', () => { draft.is_public = pub.checked; });
  const bio = h('textarea', { maxlength: '300', rows: '3', placeholder: 'Wer du bist, was du streamst, wann du live bist …' });
  bio.value = draft.bio;
  bio.addEventListener('input', () => { draft.bio = bio.value; });
  const tz = h('select', {}, ...[...new Set([draft.tz, ...TIMEZONES])].map((z) => h('option', { value: z }, z.replace('_', ' '))));
  tz.value = draft.tz;
  tz.addEventListener('change', () => { draft.tz = tz.value; });
  const awayUntil = h('input', { type: 'date', value: draft.away_until });
  awayUntil.addEventListener('change', () => { draft.away_until = awayUntil.value; });
  const awayNote = h('input', { type: 'text', maxlength: '120', value: draft.away_note, placeholder: 'z. B. Urlaub – ab Montag wieder live' });
  awayNote.addEventListener('input', () => { draft.away_note = awayNote.value; });
  const linkRows = h('div', { class: 'pf-links' }, ...links.map((l, i) => linkRow(l, i, slot)));
  const addLink = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: links.length >= MAX_LINKS }, icon('ph-plus'), 'Link hinzufügen');
  addLink.addEventListener('click', () => {
    links.push({ label: '', url: 'https://' });
    paint(slot);
    slot.querySelector('.pf-link:last-child input')?.focus();
  });
  const save = h('button', { type: 'button', class: 'btn btn--primary btn--sm', disabled: busy }, icon('ph-floppy-disk'), 'Profil speichern');
  save.addEventListener('click', () => {
    const bad = links.find((l) => l.url && l.url !== 'https://' && !/^https:\/\/\S{3,}$/.test(l.url.trim()));
    if (bad) { ctx.toast('Links müssen mit https:// anfangen.', 'error'); return; }
    run(slot, () => ctx.api.profileSave({
      bio: draft.bio, tz: draft.tz, away_until: draft.away_until || null, away_note: draft.away_note,
      links: links.filter((l) => l.url && l.url !== 'https://').map((l) => ({ label: l.label.trim() || socialFor(l.url)?.name || '', url: l.url.trim() })),
      is_public: data.can_publish ? draft.is_public : null,
    }), 'Profil gespeichert.', takeProfile);
  });
  const copy = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('ph-copy'), 'Link kopieren');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); ctx.toast('Link kopiert.', 'ok'); } catch { ctx.toast(url); }
  });
  return h('section', { class: 'dash-card dash-card--wide pf-card', 'aria-labelledby': 'pf-profile-title' },
    h('header', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, '🪪'),
      h('div', {}, h('h2', { id: 'pf-profile-title' }, 'Öffentliches Profil'),
        h('p', { class: 'dash-status' }, data.is_public ? 'Deine Seite ist öffentlich – teil den Link in Bio, Panels und Discord.' : 'Eine Seite zum Teilen: nächster Stream mit Countdown, Wochenplan und deine Links.'))),
    h('label', { class: 'toggle' }, pub, h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }), 'Profil öffentlich zeigen'),
    !data.can_publish ? h('p', { class: 'form-hint' }, '🔒 Ob das Profil öffentlich ist, entscheidet nur der Streamer.') : null,
    data.is_public ? h('div', { class: 'pf-url' }, h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Adresse deines Profils' }), copy,
      h('a', { class: 'btn btn--ghost btn--sm', href: url, target: '_blank', rel: 'noopener' }, icon('ph-arrow-square-out'), 'Ansehen')) : null,
    h('label', { class: 'field' }, h('span', {}, 'Über dich'), bio),
    h('div', { class: 'field' }, h('span', {}, 'Links (Socials, Discord, Shop …)'), linkRows, h('div', {}, addLink)),
    h('div', { class: 'pf-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Zeitzone deines Plans'), tz),
      h('label', { class: 'field' }, h('span', {}, 'Pause bis (Termine fallen bis dahin weg)'), awayUntil),
      h('label', { class: 'field pf-wide' }, h('span', {}, 'Hinweis zur Pause'), awayNote)),
    h('div', { class: 'dash-actions' }, save),
    h('p', { class: 'form-hint' }, 'Öffentlich sind nur: Name und Bild von Twitch, ob du live bist, dieser Text, die Links und dein Plan. Keine E-Mail, keine Zahlen.'));
}

function linkRow(l, i, slot) {
  const label = h('input', { type: 'text', value: l.label, maxlength: '30', placeholder: 'Name', 'aria-label': `Link ${i + 1}: Name` });
  label.addEventListener('input', (e) => { links[i].label = e.target.value; });
  const url = h('input', { type: 'url', value: l.url, maxlength: '300', placeholder: 'https://…', 'aria-label': `Link ${i + 1}: Adresse` });
  url.addEventListener('input', (e) => { links[i].url = e.target.value; });
  const del = h('button', { type: 'button', class: 'pf-del', title: 'Link entfernen', 'aria-label': `Link ${i + 1} entfernen` }, icon('ph-trash'));
  del.addEventListener('click', () => { links.splice(i, 1); paint(slot); });
  return h('div', { class: 'pf-link' }, label, url, del);
}

// Speichern: nur den gespeicherten Teil übernehmen – ungespeicherte Änderungen im anderen Teil bleiben
async function run(slot, fn, done, take) {
  if (busy) return;
  busy = true;
  try {
    data = await fn();
    take();
    ctx.toast(done, 'ok');
  } catch (err) {
    ctx.toast(`Nicht gespeichert: ${ctx.germanError(err)}`, 'error');
  } finally {
    busy = false;
    paint(slot);
  }
}
