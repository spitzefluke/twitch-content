// Raid-Netzwerk und Freunde werben (Dashboard, Migration …_raid_network.sql, Edge Function stream-tools):
//   · Raid-Netzwerk: „Im Netzwerk sichtbar“ selbst einschalten, Sprache und Kurztext. Wer mitmacht, sieht
//     die Mitglieder, die gerade live sind (gleiches Spiel und Sprache zuerst, kleinere Kanäle vor großen)
//     und raidet mit einem Klick. Der Bot sagt den Raid an und begrüßt Raids aus dem Netzwerk.
//   · Freunde werben: eigener Link (?ref=<login>), wer darüber kam, Abzeichen ab 1, 3 und 10 Kanälen.
import { h } from './extras-core.js';

export const LANGUAGES = { de: 'Deutsch', en: 'Englisch', es: 'Spanisch', fr: 'Französisch', it: 'Italienisch', nl: 'Niederländisch', pl: 'Polnisch', pt: 'Portugiesisch', tr: 'Türkisch', ru: 'Russisch', other: 'Andere' };
export const BADGES = {
  werber: { icon: '🤝', name: 'Werber', need: 1 },
  netzwerker: { icon: '🌐', name: 'Netzwerker', need: 3 },
  botschafter: { icon: '🏆', name: 'Botschafter', need: 10 },
};
const LEVELS = Object.entries(BADGES);
const kanal = (n) => `${n} ${n === 1 ? 'Kanal' : 'Kanäle'}`;

const icon = (cls) => h('i', { class: `ph ${cls}`, 'aria-hidden': 'true' });
const card = (ico, title, sub, ...kids) => h('section', { class: 'dash-card dash-card--wide rn-card' },
  h('header', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, ico),
    h('div', {}, h('h2', {}, title), sub ? h('p', { class: 'dash-status' }, sub) : null)),
  ...kids);
const missing = (err, fn) => new RegExp(`${fn}|raid_network|referrals`).test(err?.message ?? '');
const avatar = (m) => (/^https:\/\//.test(m.avatar_url ?? '')
  ? h('img', { class: 'rn-ava', src: m.avatar_url, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' })
  : h('span', { class: 'rn-ava', 'aria-hidden': 'true' }, (m.display_name || m.login || '?').slice(0, 1).toUpperCase()));

// ============================================================
// Raid-Netzwerk
// ============================================================
let rctx = null;  // { api, toast, germanError, confirm }
let net = null;   // raid_network_get()
let draft = {};
let busy = false;

export async function renderRaids(slot, deps) {
  rctx = deps;
  slot.replaceChildren(h('p', { class: 'form-hint' }, 'Lädt …'));
  try {
    net = await rctx.api.raidNetworkGet();
  } catch (err) {
    slot.replaceChildren(card('🚀', 'Raid-Netzwerk', '', h('p', { class: 'form-hint' },
      missing(err, 'raid_network_get') ? 'Das Raid-Netzwerk ist noch nicht eingerichtet (Migration …_raid_network.sql).' : rctx.germanError(err))));
    return;
  }
  takeNet();
  paintRaids(slot);
}

function takeNet() {
  draft = { enabled: net.enabled, language: net.language, note: net.note, announce: net.announce, welcome: net.welcome, raid_text: net.raid_text };
}

function paintRaids(slot) {
  slot.replaceChildren(liveCard(slot), settingsCard(slot));
}

async function runRaid(slot, fn, done) {
  if (busy) return;
  busy = true;
  try {
    const res = await fn();
    if (res?.ok === false) throw new Error(res.error || 'Hat nicht geklappt.');
    if (done) rctx.toast(typeof done === 'function' ? done(res) : done, 'ok');
  } catch (err) {
    rctx.toast(rctx.germanError(err), 'error', 7000);
  } finally {
    busy = false;
    net = await rctx.api.raidNetworkGet().catch(() => net);
    paintRaids(slot);
  }
}

function toggle(obj, key, label) {
  const input = h('input', { type: 'checkbox', checked: !!obj[key] });
  input.addEventListener('change', () => { obj[key] = input.checked; });
  return h('label', { class: 'toggle' }, input, h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }), label);
}

function settingsCard(slot) {
  const lang = h('select', {}, ...Object.entries(LANGUAGES).map(([v, l]) => h('option', { value: v, selected: v === draft.language }, l)));
  lang.addEventListener('change', () => { draft.language = lang.value; });
  const note = h('input', { type: 'text', value: draft.note, maxlength: '120', placeholder: 'z. B. Ranked mit Chat, gemütliche Runde, Speedruns …' });
  note.addEventListener('input', () => { draft.note = note.value; });
  const text = h('input', { type: 'text', value: draft.raid_text, maxlength: '300' });
  text.addEventListener('input', () => { draft.raid_text = text.value; });
  const save = h('button', { type: 'button', class: 'btn btn--primary btn--sm' }, icon('ph-floppy-disk'), 'Speichern');
  save.addEventListener('click', () => runRaid(slot, async () => { net = await rctx.api.raidNetworkSave(draft); takeNet(); }, 'Gespeichert.'));
  return card('⚙️', 'Deine Einstellungen', `${kanal(net.members)} im Netzwerk. Sichtbar sind nur Name, Spiel, Sprache, dein Kurztext und ob du live bist – nur für andere Mitglieder.`,
    toggle(draft, 'enabled', 'Im Raid-Netzwerk sichtbar (und die anderen sehen)'),
    h('div', { class: 'rn-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Sprache deines Streams'), lang),
      h('label', { class: 'field' }, h('span', {}, 'Kurztext: Was gibt es bei dir?'), note)),
    toggle(draft, 'announce', 'Bot sagt den Raid im Chat an'),
    h('label', { class: 'field' }, h('span', {}, 'Ansage'), text),
    h('p', { class: 'form-hint' }, 'Platzhalter: {target} (Name des Kanals), {link} (twitch.tv/…). Die Ansage kommt, sobald Twitch den Raid startet – der Countdown läuft dann noch bis zu 90 Sekunden.'),
    toggle(draft, 'welcome', 'Raids aus dem Netzwerk im Chat begrüßen (mit ihrem Kurztext)'),
    h('div', { class: 'dash-actions' }, save));
}

function liveCard(slot) {
  if (!net.enabled) {
    return card('🚀', 'Raid-Netzwerk', 'Streamer auf StreamHelp raiden sich gegenseitig – so finden kleine Kanäle neue Zuschauer.',
      h('ol', { class: 'rn-steps' },
        h('li', {}, 'Unten „Im Raid-Netzwerk sichtbar“ einschalten und speichern.'),
        h('li', {}, 'Am Ende deines Streams hier schauen, wer aus dem Netzwerk gerade live ist – gleiches Spiel zuerst.'),
        h('li', {}, 'Auf „Raiden“ klicken: Twitch startet den Raid, der Bot sagt ihn im Chat an.')),
      h('p', { class: 'form-hint' }, 'Mitmachen ist freiwillig. Du siehst die anderen nur, solange du selbst sichtbar bist.'));
  }
  const reload = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('ph-arrow-clockwise'), 'Aktualisieren');
  reload.addEventListener('click', () => runRaid(slot, async () => {}));
  const cancel = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('ph-x'), 'Raid abbrechen');
  cancel.addEventListener('click', () => runRaid(slot, () => rctx.api.raidCancel(), 'Raid abgebrochen.'));
  const list = net.suggestions ?? [];
  return card('🚀', 'Gerade live im Netzwerk',
    net.live ? `Du bist live${net.category ? ` in ${net.category}` : ''} – passende Kanäle stehen oben.` : 'Du bist gerade nicht live. Raiden geht, sobald dein Stream läuft.',
    list.length
      ? h('ul', { class: 'rn-list' }, ...list.map((m) => memberRow(m, slot)))
      : h('p', { class: 'form-hint' }, 'Gerade ist niemand aus dem Netzwerk live. Schau gegen Ende deines Streams noch einmal rein.'),
    h('div', { class: 'dash-actions' }, reload, cancel));
}

function memberRow(m, slot) {
  const go = h('button', { type: 'button', class: 'btn btn--primary btn--sm', disabled: !net.live, title: net.live ? `${m.display_name} raiden` : 'Erst live gehen' }, icon('ph-rocket-launch'), 'Raiden');
  go.addEventListener('click', async () => {
    const ok = await rctx.confirm(`Jetzt ${m.display_name} raiden? Twitch startet den Raid mit Countdown – dein Chat zieht dann mit.`);
    if (ok) runRaid(slot, () => rctx.api.raidStart(m.login), (res) => `Raid zu ${res?.target || m.display_name} gestartet 🚀`);
  });
  const tags = [
    m.same_game ? h('span', { class: 'rn-tag rn-tag--ok' }, 'gleiches Spiel') : null,
    m.language && m.language !== 'other' ? h('span', { class: 'rn-tag' }, LANGUAGES[m.language] ?? m.language) : null,
    m.raided_recently ? h('span', { class: 'rn-tag', title: 'Du hast diesen Kanal in den letzten 7 Tagen geraidet' }, 'kürzlich geraidet') : null,
  ];
  return h('li', { class: 'rn-item' },
    avatar(m),
    h('div', { class: 'rn-who' },
      h('a', { href: `https://www.twitch.tv/${encodeURIComponent(m.login)}`, target: '_blank', rel: 'noopener noreferrer' }, m.display_name || m.login),
      h('span', { class: 'rn-meta' }, [m.category, `${m.viewers} Zuschauer`].filter(Boolean).join(' · ')),
      m.note ? h('span', { class: 'rn-note' }, m.note) : null,
      h('span', { class: 'rn-tags' }, ...tags)),
    go);
}

// ============================================================
// Freunde werben
// ============================================================
export async function renderReferrals(slot, deps) {
  slot.replaceChildren(h('p', { class: 'form-hint' }, 'Lädt …'));
  let d;
  try {
    d = await deps.api.referralGet();
  } catch (err) {
    slot.replaceChildren(card('🤝', 'Freunde werben', '', h('p', { class: 'form-hint' },
      missing(err, 'referral_get') ? 'Freunde werben ist noch nicht eingerichtet (Migration …_raid_network.sql).' : deps.germanError(err))));
    return;
  }
  const url = new URL(`index.html?ref=${encodeURIComponent(d.login ?? '')}`, location.href).href;
  const copy = h('button', { type: 'button', class: 'btn btn--primary btn--sm' }, icon('ph-copy'), 'Link kopieren');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); deps.toast('Link kopiert.', 'ok'); } catch { deps.toast(url); }
  });
  const next = LEVELS.find(([, b]) => d.active < b.need);
  const ladder = h('ol', { class: 'rf-ladder' }, ...LEVELS.map(([key, b]) => h('li', { class: d.active >= b.need ? 'is-done' : key === next?.[0] ? 'is-next' : '' },
    h('span', { class: 'rf-badge', 'aria-hidden': 'true' }, b.icon), h('b', {}, b.name), h('small', {}, kanal(b.need)))));
  const cur = BADGES[d.badge];
  slot.replaceChildren(
    card('🤝', 'Freunde werben', 'Kennst du Streamer, denen StreamHelp hilft? Schick ihnen deinen Link.',
      h('div', { class: 'pf-url' }, h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Dein Einladungs-Link' }), copy),
      h('ul', { class: 'rf-perks' },
        h('li', {}, icon('ph-lightning'), h('span', {}, 'Wer über deinen Link kommt und sich als Streamer anmeldet, wird ', h('b', {}, 'bevorzugt freigeschaltet'), '.')),
        h('li', {}, icon('ph-medal'), h('span', {}, 'Du bekommst ein ', h('b', {}, 'Abzeichen'), ' im Dashboard und auf deinem öffentlichen Profil.')),
        h('li', {}, icon('ph-shield-check'), h('span', {}, 'Kein Geld, keine Daten: Wir merken uns nur, welcher Kanal über welchen Link kam.')))),
    card(cur ? cur.icon : '🎖️', cur ? `Dein Abzeichen: ${cur.name}` : 'Noch kein Abzeichen',
      `${d.active} geworbene${d.active === 1 ? 'r' : ''} ${d.active === 1 ? 'Kanal' : 'Kanäle'} freigeschaltet${d.pending ? ` · ${d.pending} warte${d.pending === 1 ? 't' : 'n'} noch` : ''}.${next ? ` Noch ${next[1].need - d.active} bis „${next[1].name}“.` : ''}`,
      ladder,
      (d.channels ?? []).length ? h('ul', { class: 'rn-list' }, ...d.channels.map((c) => h('li', { class: 'rn-item' }, avatar(c),
        h('div', { class: 'rn-who' }, h('b', {}, c.display_name || c.login), h('span', { class: 'rn-meta' }, `seit ${new Date(c.since).toLocaleDateString('de-DE')}`)),
        h('span', { class: `rn-tag ${c.status === 'active' ? 'rn-tag--ok' : ''}` }, c.status === 'active' ? 'freigeschaltet' : 'wartet')))) : null));
}
