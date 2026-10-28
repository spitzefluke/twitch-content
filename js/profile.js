// Öffentliches Streamer-Profil: profil.html?c=<twitch-login> (Migration …_profile_schedule.sql).
// Zeigt nur, was der Streamer freigegeben hat: Name und Bild von Twitch, ob er live ist, Kurztext,
// Links, Wochenplan und die nächsten Termine (mit Countdown). Termine kommen schon in echter Zeit
// aus der Datenbank (Zeitzone des Streamers, Sommerzeit, „Pause bis …“) und stehen hier in der
// Zeitzone des Besuchers. „In den Kalender“ lädt den Wochenplan als .ics (wiederholt sich wöchentlich).
import { createApi, germanError } from './api.js';
import { h } from './extras-core.js';
import { socialFor } from './social-icons.js';
import { WEEKDAYS, fmtDuration } from './dash-profile.js';

const $ = (sel) => document.querySelector(sel);
const login = (new URLSearchParams(location.search).get('c') ?? '').trim().toLowerCase();
const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const icon = (cls) => h('i', { class: `ph ${cls}`, 'aria-hidden': 'true' });
const api = createApi();
let profile = null;
let tick = 0;

const fmtWhen = (iso) => new Date(iso).toLocaleString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
const fmtShort = (iso) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const tzName = (tz) => tz.replace(/_/g, ' ');

async function load() {
  if (!/^[a-z0-9_]{1,25}$/.test(login)) return missing();
  try {
    profile = await api.publicProfile(login);
  } catch (err) {
    $('#pp-loading').textContent = `Profil konnte nicht geladen werden: ${germanError(err)}`;
    return null;
  }
  if (!profile) return missing();
  paint();
  return profile;
}

function missing() {
  $('#pp-loading').hidden = true;
  $('#pp-missing').hidden = false;
  $('#pp').setAttribute('aria-busy', 'false');
  return null;
}

function paint() {
  const p = profile;
  const name = p.display_name || p.login;
  document.title = `${name} · Streamer-Profil · StreamHelp`;
  $('#pp-loading').hidden = true;
  $('#pp-body').hidden = false;
  $('#pp-share').hidden = false;
  $('#pp').setAttribute('aria-busy', 'false');

  const ava = $('#pp-ava');
  if (/^https:\/\//.test(p.avatar_url ?? '')) {
    ava.replaceChildren(h('img', { src: p.avatar_url, alt: '', referrerpolicy: 'no-referrer' }));
  } else ava.textContent = name.slice(0, 1).toUpperCase();
  $('#pp-name').textContent = name;
  $('#pp-bio').textContent = p.bio || '';
  $('#pp-bio').hidden = !p.bio;
  $('#pp-live').hidden = !p.live;
  $('#pp-live-text').textContent = p.category ? `Jetzt live · ${p.category}` : 'Jetzt live';
  $('#pp-twitch').href = `https://www.twitch.tv/${encodeURIComponent(p.login)}`;
  $('#pp-ics').hidden = !(p.slots ?? []).length;

  // Links mit Logo der Plattform
  const links = (p.links ?? []).filter((l) => /^https:\/\//.test(l.url ?? ''));
  $('#pp-links-card').hidden = !links.length;
  $('#pp-links').replaceChildren(...links.map((l) => {
    const s = socialFor(l.url);
    let logo = icon('ph-link');
    if (s) {
      logo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      logo.setAttribute('viewBox', '0 0 24 24');
      logo.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', s.path);
      logo.append(path);
    }
    return h('li', {}, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, logo,
      h('span', {}, l.label || s?.name || new URL(l.url).hostname), icon('ph-arrow-up-right')));
  }));

  // Wochenplan in der Zeitzone des Streamers
  const slots = p.slots ?? [];
  $('#pp-week-tz').textContent = slots.length ? `Uhrzeiten in ${tzName(p.tz)}${p.tz !== myTz ? ' (Zeitzone des Streamers)' : ''}` : '';
  $('#pp-week').replaceChildren(...WEEKDAYS.map((day, i) => {
    const mine = slots.filter((s) => s.weekday === i + 1);
    return h('li', { class: mine.length ? '' : 'is-off' }, h('b', {}, day.slice(0, 2)),
      mine.length
        ? h('div', {}, ...mine.map((s) => h('span', { class: 'pp-slot' }, h('time', {}, s.start), ` · ${fmtDuration(s.minutes)}`,
          s.title || s.game ? h('small', {}, [s.title, s.game].filter(Boolean).join(' · ')) : null)))
        : h('div', {}, h('span', { class: 'pp-free' }, 'frei')));
  }));
  if (!slots.length) $('#pp-week').replaceChildren(h('li', { class: 'is-empty' }, 'Noch kein fester Plan – folg auf Twitch, um nichts zu verpassen.'));

  // Nächste Termine in der Zeitzone des Besuchers
  const up = p.upcoming ?? [];
  $('#pp-up-tz').textContent = up.length ? `In deiner Zeit (${tzName(myTz)})` : '';
  $('#pp-up').replaceChildren(...(up.length
    ? up.map((t) => h('li', {}, h('b', {}, fmtShort(t.at)), h('span', {}, [t.title, t.game].filter(Boolean).join(' · ') || 'Stream'), h('small', {}, fmtDuration(t.minutes))))
    : [h('li', { class: 'is-empty' }, 'In den nächsten zwei Wochen steht nichts im Plan.')]));

  const away = $('#pp-away');
  away.hidden = !p.away_until;
  if (p.away_until) {
    away.replaceChildren(icon('ph-airplane-tilt'),
      `Pause bis ${new Date(`${p.away_until}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: 'long' })}${p.away_note ? ` – ${p.away_note}` : ''}`);
  }
  paintNext();
}

// Nächster Stream mit Countdown (läuft jede Sekunde)
function paintNext() {
  const p = profile;
  const now = Date.now();
  const next = (p.upcoming ?? []).find((t) => new Date(t.at).getTime() + t.minutes * 60_000 > now);
  const running = next && new Date(next.at).getTime() <= now;
  const box = $('#pp-next');
  box.classList.toggle('is-live', !!p.live || !!running);
  if (p.live) {
    $('#pp-next-title').textContent = 'Gerade live';
    $('#pp-next-when').textContent = p.category ? `Live mit ${p.category}` : 'Jetzt live auf Twitch';
    $('#pp-next-what').textContent = 'Komm vorbei – der Chat wartet.';
    $('#pp-count').replaceChildren(h('a', { class: 'pp-btn', href: `https://www.twitch.tv/${encodeURIComponent(p.login)}`, target: '_blank', rel: 'noopener noreferrer' }, icon('ph-play'), 'Zum Stream'));
    return;
  }
  if (!next) {
    $('#pp-next-title').textContent = 'Nächster Stream';
    $('#pp-next-when').textContent = p.away_until ? 'Gerade Pause' : 'Noch kein Termin geplant';
    $('#pp-next-what').textContent = p.away_until ? '' : 'Folg auf Twitch, dann bekommst du Bescheid, wenn es losgeht.';
    $('#pp-count').replaceChildren();
    return;
  }
  $('#pp-next-title').textContent = running ? 'Laut Plan gerade dran' : 'Nächster Stream';
  $('#pp-next-when').textContent = fmtWhen(next.at);
  $('#pp-next-what').textContent = [next.title, next.game, fmtDuration(next.minutes)].filter(Boolean).join(' · ');
  const left = Math.max(0, new Date(next.at).getTime() - now);
  const parts = [[Math.floor(left / 86_400_000), 'Tage'], [Math.floor(left / 3_600_000) % 24, 'Std'], [Math.floor(left / 60_000) % 60, 'Min'], [Math.floor(left / 1000) % 60, 'Sek']];
  $('#pp-count').replaceChildren(...(running ? [] : parts.map(([n, l]) => h('span', {}, h('b', {}, String(n).padStart(2, '0')), h('small', {}, l)))));
  $('#pp-count').setAttribute('aria-label', running ? '' : `noch ${parts.map(([n, l]) => `${n} ${l}`).join(', ')}`);
}

// ---------- Kalender (.ics) ----------
// Nächster Tag mit diesem Wochentag in der Zeitzone des Streamers (als JJJJMMTT)
function nextDate(weekday, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const iso = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  for (let d = 0; d < 7; d++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(Date.now() + d * 86_400_000)).map((x) => [x.type, x.value]));
    if (iso[parts.weekday] === weekday) return `${parts.year}${parts.month}${parts.day}`;
  }
  return '';
}
const icsText = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');

function downloadIcs() {
  const p = profile;
  const name = p.display_name || p.login;
  const url = `https://www.twitch.tv/${p.login}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const events = (p.slots ?? []).map((s, i) => [
    'BEGIN:VEVENT',
    `UID:${p.login}-${s.weekday}-${s.start.replace(':', '')}-${i}@streamhelp`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${p.tz}:${nextDate(s.weekday, p.tz)}T${s.start.replace(':', '')}00`,
    `DURATION:PT${s.minutes}M`,
    'RRULE:FREQ=WEEKLY',
    `SUMMARY:${icsText(`${name} live${s.title ? `: ${s.title}` : ''}`)}`,
    `DESCRIPTION:${icsText([s.game, url].filter(Boolean).join(' – '))}`,
    `URL:${url}`,
    'END:VEVENT',
  ].join('\r\n'));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StreamHelp//Streamplan//DE', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(`${name} – Streamplan`)}`, ...events, 'END:VCALENDAR'].join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })), download: `${p.login}-streamplan.ics` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function share() {
  const data = { title: `${profile.display_name || profile.login} auf StreamHelp`, url: location.href };
  try {
    if (navigator.share) await navigator.share(data);
    else {
      await navigator.clipboard.writeText(location.href);
      $('#pp-share').replaceChildren(icon('ph-check'), 'Link kopiert');
      setTimeout(() => $('#pp-share').replaceChildren(icon('ph-share-network'), 'Teilen'), 2500);
    }
  } catch { /* Teilen abgebrochen */ }
}

$('#pp-ics').addEventListener('click', downloadIcs);
$('#pp-share').addEventListener('click', share);
load().then((p) => {
  if (!p) return;
  tick = setInterval(paintNext, 1000);
  // Live-Status und Plan alle zwei Minuten frisch
  setInterval(() => { if (!document.hidden) load(); }, 120_000);
});
addEventListener('pagehide', () => clearInterval(tick));
