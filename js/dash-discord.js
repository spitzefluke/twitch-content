// Discord (Dashboard → Discord, Migration …_discord.sql, Edge Function stream-tools):
//   · Verbinden: Webhook-Adresse aus dem eigenen Discord-Kanal einfügen. Die Edge Function prüft sie bei
//     Discord; danach zeigt die Seite nur noch den Namen des Webhooks – die Adresse ist geheim.
//   · Was gepostet wird: Live-Benachrichtigung (Text, Erwähnung), Rückblick nach dem Stream,
//     neue Termine von Content-Ideen automatisch.
//   · Jetzt posten: Wochenplan oder eine Content-Idee mit Termin, Testnachricht.
// Bearbeiten dürfen Streamer, Admins und Mods mit dem Bereich „Bot & Chat“.
import { h } from './extras-core.js';

const DEFAULT_TEXT = '🔴 {streamer} ist jetzt live: {title}';
const HOOK_RE = /^https:\/\/(ptb\.|canary\.)?discord(app)?\.com\/api\/webhooks\/[0-9]{5,25}\/[A-Za-z0-9_-]{20,100}$/;
export const STREAMHELP_DISCORD = 'https://discord.gg/XkVG2ZEDG';

let ctx = null;   // { api, toast, germanError, streamer: () => name, tiles: () => [] }
let data = null;  // discord_get()
let draft = {};
let busy = false;

const icon = (cls) => h('i', { class: `ph ${cls}`, 'aria-hidden': 'true' });
const card = (ico, title, sub, ...kids) => h('section', { class: 'dash-card dash-card--wide dc-card' },
  h('header', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, ico),
    h('div', {}, h('h2', {}, title), sub ? h('p', { class: 'dash-status' }, sub) : null)),
  ...kids);
const missing = (err) => /discord_get|discord_settings/.test(err?.message ?? '');

export async function renderDiscord(slot, deps) {
  ctx = deps;
  slot.replaceChildren(h('p', { class: 'form-hint' }, 'Lädt …'));
  try {
    data = await ctx.api.discordGet();
  } catch (err) {
    slot.replaceChildren(card('💬', 'Discord', '', h('p', { class: 'form-hint' },
      missing(err) ? 'Die Discord-Anbindung ist noch nicht eingerichtet (Migration …_discord.sql).' : ctx.germanError(err))));
    return;
  }
  take();
  paint(slot);
}

function take() {
  draft = { on_live: data.on_live, on_recap: data.on_recap, on_ideas: data.on_ideas, live_text: data.live_text || DEFAULT_TEXT, mention: data.mention ?? '' };
}

function paint(slot) {
  slot.replaceChildren(connectCard(slot), ...(data.connected ? [settingsCard(slot), postCard(slot)] : []), communityCard());
}

async function run(slot, fn, done) {
  if (busy) return;
  busy = true;
  try {
    const res = await fn();
    if (done) ctx.toast(done, 'ok');
    return res;
  } catch (err) {
    ctx.toast(ctx.germanError(err), 'error');
  } finally {
    busy = false;
    data = await ctx.api.discordGet().catch(() => data);
    paint(slot);
  }
}

// ---------- Verbinden ----------
function connectCard(slot) {
  if (data.connected) {
    const test = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('ph-paper-plane-tilt'), 'Testnachricht senden');
    test.addEventListener('click', () => run(slot, () => ctx.api.discordPost('test'), 'Testnachricht gesendet – schau in deinen Discord-Kanal.'));
    const off = h('button', { type: 'button', class: 'btn btn--ghost btn--sm dc-danger' }, icon('ph-plug'), 'Trennen');
    off.addEventListener('click', () => {
      if (!confirm('Discord trennen? StreamHelp postet dann nichts mehr in den Kanal.')) return;
      run(slot, () => ctx.api.discordDisconnect(), 'Discord getrennt.');
    });
    const status = data.last_error
      ? h('p', { class: 'dc-state dc-state--bad' }, icon('ph-warning'), data.last_error)
      : data.last_ok_at ? h('p', { class: 'dc-state dc-state--ok' }, icon('ph-check-circle'), `Zuletzt gepostet: ${new Date(data.last_ok_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`) : null;
    return card('💬', 'Discord ist verbunden', `Webhook „${data.webhook_name || 'ohne Namen'}“ – StreamHelp postet in diesen Kanal.`,
      status, h('div', { class: 'dash-actions' }, test, off));
  }
  const url = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://discord.com/api/webhooks/…', 'aria-label': 'Webhook-Adresse', maxlength: '300' });
  const go = h('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, icon('ph-link'), 'Verbinden');
  const form = h('form', { class: 'dc-connect' }, h('label', { class: 'field' }, h('span', {}, 'Webhook-Adresse'), url), h('div', { class: 'dash-actions' }, go));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = url.value.trim();
    if (!HOOK_RE.test(v)) { ctx.toast('Das ist keine Discord-Webhook-Adresse (https://discord.com/api/webhooks/…).', 'error'); return; }
    run(slot, () => ctx.api.discordConnect(v), 'Discord verbunden.');
  });
  return card('💬', 'Discord verbinden', 'Live-Benachrichtigung, Rückblick und Ankündigungen automatisch in deinem Discord.',
    h('ol', { class: 'dc-steps' },
      h('li', {}, 'In Discord: Zahnrad am gewünschten Kanal → ', h('b', {}, 'Integrationen'), ' → ', h('b', {}, 'Webhooks'), ' → ', h('b', {}, 'Neuer Webhook'), '.'),
      h('li', {}, 'Namen und Bild nach Wunsch (z. B. „StreamHelp“), dann ', h('b', {}, 'Webhook-URL kopieren'), '.'),
      h('li', {}, 'Hier einfügen und verbinden.')),
    form,
    h('p', { class: 'form-hint' }, '🔒 Die Adresse ist wie ein Passwort: Wer sie kennt, kann in den Kanal schreiben. Wir speichern sie nur auf dem Server und zeigen sie nie wieder an – auch nicht im Stream.'));
}

// ---------- Was gepostet wird ----------
function toggle(key, label) {
  const input = h('input', { type: 'checkbox', checked: !!draft[key] });
  input.addEventListener('change', () => { draft[key] = input.checked; });
  return h('label', { class: 'toggle' }, input, h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }), label);
}

function settingsCard(slot) {
  const preview = h('div', { class: 'dc-preview', 'aria-label': 'Vorschau der Live-Benachrichtigung' });
  const text = h('input', { type: 'text', value: draft.live_text, maxlength: '300' });
  const kind = /^\d+$/.test(draft.mention) ? 'role' : draft.mention;
  const mention = h('select', {},
    ...[['', 'Niemand'], ['here', '@here (alle, die online sind)'], ['everyone', '@everyone (alle)'], ['role', 'Eine Rolle …']]
      .map(([v, l]) => h('option', { value: v, selected: v === kind }, l)));
  const role = h('input', { type: 'text', inputmode: 'numeric', value: /^\d+$/.test(draft.mention) ? draft.mention : '', placeholder: 'Rollen-ID, z. B. 1234567890', maxlength: '40', hidden: kind !== 'role', 'aria-label': 'Rollen-ID' });
  const sync = () => {
    draft.live_text = text.value;
    draft.mention = mention.value === 'role' ? role.value.trim().replace(/^<@&(\d+)>$/, '$1') : mention.value;
    role.hidden = mention.value !== 'role';
    paintPreview(preview);
  };
  text.addEventListener('input', sync);
  mention.addEventListener('change', sync);
  role.addEventListener('input', sync);
  paintPreview(preview);
  const save = h('button', { type: 'button', class: 'btn btn--primary btn--sm' }, icon('ph-floppy-disk'), 'Speichern');
  save.addEventListener('click', () => {
    if (mention.value === 'role' && !/^(<@&)?\d{5,25}>?$/.test(role.value.trim())) { ctx.toast('Bitte die Rollen-ID eintragen (Discord: Rechtsklick auf die Rolle → ID kopieren).', 'error'); return; }
    run(slot, () => ctx.api.discordSave(draft), 'Gespeichert.');
  });
  return card('📣', 'Was gepostet wird', 'Alles läuft automatisch – du musst dafür nichts anklicken.',
    h('div', { class: 'dc-toggles' },
      toggle('on_live', 'Live-Benachrichtigung, sobald du live gehst'),
      toggle('on_recap', 'Rückblick nach dem Stream (Dauer, Zuschauer, neue Follower …)'),
      toggle('on_ideas', 'Neue Termine von Content-Ideen ankündigen')),
    h('div', { class: 'dc-grid' },
      h('div', { class: 'dc-fields' },
        h('label', { class: 'field' }, h('span', {}, 'Text der Live-Benachrichtigung'), text),
        h('p', { class: 'form-hint' }, 'Platzhalter: {streamer}, {title}, {game}, {link}'),
        h('label', { class: 'field' }, h('span', {}, 'Wen erwähnen?'), mention, role)),
      preview),
    h('div', { class: 'dash-actions' }, save));
}

function paintPreview(el) {
  const streamer = ctx.streamer?.() || 'Du';
  const title = 'Ranked mit Chat – heute knacken wir Diamant!';
  const m = draft.mention === 'here' || draft.mention === 'everyone' ? `@${draft.mention} ` : /^\d+$/.test(draft.mention) ? '@Rolle ' : '';
  const body = (draft.live_text || DEFAULT_TEXT).replaceAll('{streamer}', streamer).replaceAll('{title}', title)
    .replaceAll('{game}', 'Valorant').replaceAll('{link}', 'twitch.tv/…');
  el.replaceChildren(
    h('div', { class: 'dc-msg-head' }, h('span', { class: 'dc-avatar', 'aria-hidden': 'true' }, 'S'), h('b', {}, data.webhook_name || 'StreamHelp'), h('span', { class: 'dc-bot' }, 'APP')),
    h('p', { class: 'dc-msg-text' }, m ? h('span', { class: 'dc-mention' }, m.trim()) : null, m ? ' ' : null, body),
    h('div', { class: 'dc-embed' }, h('b', {}, title), h('span', {}, '🎮 Valorant'), h('div', { class: 'dc-embed-img', 'aria-hidden': 'true' }, icon('ph-play'))));
}

// ---------- Jetzt posten ----------
function postCard(slot) {
  const plan = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('ph-calendar-blank'), 'Wochenplan posten');
  plan.addEventListener('click', () => run(slot, () => ctx.api.discordPost('schedule'), 'Wochenplan gepostet.'));
  const upcoming = (ctx.tiles?.() ?? []).filter((t) => t.target_at && Date.parse(t.target_at) > Date.now())
    .sort((a, b) => Date.parse(a.target_at) - Date.parse(b.target_at));
  const pick = h('select', { 'aria-label': 'Content-Idee', disabled: !upcoming.length },
    ...(upcoming.length ? upcoming.map((t) => h('option', { value: t.id }, `${t.title} – ${new Date(t.target_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`))
      : [h('option', { value: '' }, 'Keine Content-Idee mit Termin')]));
  const idea = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: !upcoming.length }, icon('ph-sparkle'), 'Idee posten');
  idea.addEventListener('click', () => pick.value && run(slot, () => ctx.api.discordPost('idea', pick.value), 'Content-Idee gepostet.'));
  return card('📅', 'Jetzt posten', 'Ankündigungen auf Knopfdruck – Zeiten zeigt Discord in der Zeitzone jedes Lesers.',
    h('div', { class: 'dc-post' },
      h('div', { class: 'dc-post-row' }, h('span', {}, 'Die nächsten Streams aus „Profil & Zeitplan“'), plan),
      h('div', { class: 'dc-post-row' }, pick, idea)));
}

// ---------- StreamHelp-Community ----------
function communityCard() {
  return h('section', { class: 'dash-card dash-card--wide dc-community' },
    h('div', {}, h('h2', {}, 'StreamHelp-Discord'), h('p', { class: 'dash-status' }, 'Fragen, Ideen, Hilfe von anderen Streamern und als Erste von neuen Funktionen erfahren.')),
    h('a', { class: 'btn btn--primary btn--sm', href: STREAMHELP_DISCORD, target: '_blank', rel: 'noopener' }, icon('ph-discord-logo'), 'Beitreten'));
}
