// Trinkgeld & Sponsoren (Dashboard, Migration …_tips_sponsors_pro.sql). StreamHelp nimmt dabei kein Geld an:
//   · Trinkgeld: Ko-fi des Streamers per Webhook verbinden (Alert „💶 Trinkgeld“ im Overlay, Dank vom Bot)
//     und eigene Links (PayPal.me, Tipeee, Streamlabs …) für !trinkgeld und das öffentliche Profil.
//   · Sponsoren: eigene Partner mit Text, Rabattcode und Link – laufen mit „Anzeige“ im Laufband,
//     !sponsor im Chat, auf dem öffentlichen Profil.
import { h } from './extras-core.js';
import { money } from './alerts.js';
import { SPONSORING_OPEN, SPONSORING_SOON, sponsorLogoUrl } from './sponsor-files.js';

const DEFAULT_THANK = '💶 Danke {name} für {amount} Trinkgeld! {message}';
const URL_RE = /^https:\/\/[^\s<>"'\\]{3,}$/;
const MAX_LINKS = 4;

let ctx = null;  // { api, toast, germanError, webhookUrl(channelId), testAlert(kind) }
let tip = null;
let tipDraft = {};
let sponsors = [];
let editing = null; // Sponsor, der gerade bearbeitet wird
let fresh = null;   // neuer Sponsor im Formular (bleibt beim Neuzeichnen erhalten)
let market = null;  // sponsoring_offers(): Angebote aus der Sponsoring-Börse (null = Migration fehlt)
const applyDraft = {}; // Angebot-ID → { message, share }
let busy = false;

const icon = (cls) => h('i', { class: `ph ${cls}`, 'aria-hidden': 'true' });
const card = (ico, title, sub, ...kids) => h('section', { class: 'dash-card dash-card--wide mo-card' },
  h('header', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, ico),
    h('div', {}, h('h2', {}, title), sub ? h('p', { class: 'dash-status' }, sub) : null)),
  ...kids);
const missing = (err) => /tip_get|sponsor_admin_list|tip_settings|core\.sponsors/.test(err?.message ?? '');

export async function renderMoney(slot, deps) {
  ctx = deps;
  slot.replaceChildren(h('p', { class: 'form-hint' }, 'Lädt …'));
  try {
    [tip, sponsors] = await Promise.all([ctx.api.tipGet(), ctx.api.sponsorAdminList()]);
    market = !SPONSORING_OPEN ? null : await ctx.api.sponsoringOffers?.().catch((err) => { if (!/sponsoring_offers/.test(err?.message ?? '')) console.warn('Sponsoring-Börse:', err?.message ?? err); return null; }) ?? null;
  } catch (err) {
    slot.replaceChildren(card('💶', 'Trinkgeld & Sponsoren', '', h('p', { class: 'form-hint' },
      missing(err) ? 'Trinkgeld und Sponsoren sind noch nicht eingerichtet (Migration …_tips_sponsors_pro.sql).' : ctx.germanError(err))));
    return;
  }
  takeTip();
  paint(slot);
}

function takeTip() {
  tipDraft = {
    links: (tip.links ?? []).map((l) => ({ ...l })), alert: tip.alert, thank: tip.thank, thank_text: tip.thank_text || DEFAULT_THANK,
    min: tip.min_cents ? (tip.min_cents / 100).toFixed(2).replace('.', ',') : '',
  };
}

function paint(slot) {
  const soon = !SPONSORING_OPEN && card('🏷️', 'Sponsoring-Börse', '🛠️ In Arbeit – noch nicht verfügbar',
    h('p', { class: 'form-hint' }, `Hier bieten dir bald Firmen Sponsorings an, passend zu deiner Kanalgröße. ${SPONSORING_SOON} Eigene Sponsoren kannst du unten schon eintragen.`));
  slot.replaceChildren(kofiCard(slot), tipCard(slot), ...(market ? [marketCard(slot)] : soon ? [soon] : []), sponsorCard(slot));
}

async function run(slot, fn, done) {
  if (busy) return;
  busy = true;
  try {
    await fn();
    if (done) ctx.toast(done, 'ok');
  } catch (err) {
    ctx.toast(`Nicht gespeichert: ${ctx.germanError(err)}`, 'error', 7000);
  } finally {
    busy = false;
    paint(slot);
  }
}

function toggle(obj, key, label) {
  const input = h('input', { type: 'checkbox', checked: !!obj[key] });
  input.addEventListener('change', () => { obj[key] = input.checked; });
  return h('label', { class: 'toggle' }, input, h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }), label);
}

// ---------- Ko-fi ----------
function kofiCard(slot) {
  const url = ctx.webhookUrl(tip.channel_id);
  const copy = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('ph-copy'), 'Kopieren');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); ctx.toast('Webhook-Adresse kopiert.', 'ok'); } catch { ctx.toast(url); }
  });
  const test = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('ph-play'), 'Test-Alert');
  test.addEventListener('click', () => ctx.testAlert('tip', test));
  if (tip.kofi) {
    const off = h('button', { type: 'button', class: 'btn btn--ghost btn--sm mo-danger' }, icon('ph-plug'), 'Trennen');
    off.addEventListener('click', () => {
      if (!confirm('Ko-fi trennen? Trinkgelder lösen dann keinen Alert mehr aus.')) return;
      run(slot, async () => { tip = await ctx.api.tipKofiToken(''); takeTip(); }, 'Ko-fi getrennt.');
    });
    return card('☕', 'Ko-fi ist verbunden', tip.last_at ? `Letztes Trinkgeld: ${new Date(tip.last_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : 'Noch kein Trinkgeld angekommen.',
      h('div', { class: 'pf-url' }, h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Webhook-Adresse für Ko-fi' }), copy),
      h('div', { class: 'dash-actions' }, test, off));
  }
  const token = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', maxlength: '100', placeholder: 'Verification Token', 'aria-label': 'Ko-fi Verification Token' });
  const go = h('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, icon('ph-link'), 'Verbinden');
  const form = h('form', { class: 'mo-kofi' }, h('label', { class: 'field' }, h('span', {}, 'Verification Token von Ko-fi'), token), h('div', { class: 'dash-actions' }, go, test));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run(slot, async () => { tip = await ctx.api.tipKofiToken(token.value.trim()); takeTip(); }, 'Ko-fi verbunden.');
  });
  return card('☕', 'Trinkgeld über Ko-fi', 'Zuschauer geben dir auf Ko-fi Trinkgeld – im Stream erscheint ein Alert, der Bot sagt Danke.',
    h('ol', { class: 'mo-steps' },
      h('li', {}, 'Auf ko-fi.com anmelden → ', h('b', {}, 'Settings'), ' → ', h('b', {}, 'More'), ' → ', h('b', {}, 'API'), '.'),
      h('li', {}, 'Diese Adresse bei ', h('b', {}, 'Webhook URL'), ' einfügen und speichern:'),
      h('li', { class: 'mo-steps-url' }, h('div', { class: 'pf-url' }, h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Webhook-Adresse für Ko-fi' }), copy)),
      h('li', {}, 'Den ', h('b', {}, 'Verification Token'), ' von dort hier einfügen.')),
    form,
    h('p', { class: 'form-hint' }, '🔒 Das Geld geht direkt an dein Ko-fi – StreamHelp sieht nur Name, Betrag und Nachricht (anonyme Trinkgelder ohne Namen). E-Mail-Adressen speichern wir nicht.'));
}

// ---------- Links, Alert und Dank ----------
function tipCard(slot) {
  const rows = h('div', { class: 'pf-links' }, ...tipDraft.links.map((l, i) => {
    const label = h('input', { type: 'text', value: l.label, maxlength: '30', placeholder: 'z. B. PayPal', 'aria-label': `Link ${i + 1}: Name` });
    label.addEventListener('input', () => { tipDraft.links[i].label = label.value; });
    const url = h('input', { type: 'url', value: l.url, maxlength: '300', placeholder: 'https://paypal.me/…', 'aria-label': `Link ${i + 1}: Adresse` });
    url.addEventListener('input', () => { tipDraft.links[i].url = url.value; });
    const del = h('button', { type: 'button', class: 'pf-del', title: 'Link entfernen', 'aria-label': `Link ${i + 1} entfernen` }, icon('ph-trash'));
    del.addEventListener('click', () => { tipDraft.links.splice(i, 1); paint(slot); });
    return h('div', { class: 'pf-link' }, label, url, del);
  }));
  const add = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: tipDraft.links.length >= MAX_LINKS }, icon('ph-plus'), 'Link hinzufügen');
  add.addEventListener('click', () => { tipDraft.links.push({ label: '', url: 'https://' }); paint(slot); });
  const text = h('input', { type: 'text', value: tipDraft.thank_text, maxlength: '300' });
  text.addEventListener('input', () => { tipDraft.thank_text = text.value; });
  const min = h('input', { type: 'text', inputmode: 'decimal', value: tipDraft.min, placeholder: '0', 'aria-label': 'Mindestbetrag für den Alert in Euro' });
  min.addEventListener('input', () => { tipDraft.min = min.value; });
  const save = h('button', { type: 'button', class: 'btn btn--primary btn--sm' }, icon('ph-floppy-disk'), 'Speichern');
  save.addEventListener('click', () => {
    const links = tipDraft.links.filter((l) => l.url && l.url !== 'https://');
    if (links.some((l) => !URL_RE.test(l.url.trim()))) { ctx.toast('Bitte nur https-Links (z. B. https://paypal.me/…).', 'error'); return; }
    const minCents = Math.round(Number.parseFloat(String(tipDraft.min || '0').replace(',', '.')) * 100);
    if (!Number.isFinite(minCents) || minCents < 0) { ctx.toast('Mindestbetrag: eine Zahl wie 2 oder 2,50.', 'error'); return; }
    run(slot, async () => {
      tip = await ctx.api.tipSave({ links, alert: tipDraft.alert, thank: tipDraft.thank, thank_text: tipDraft.thank_text, min_cents: minCents });
      takeTip();
    }, 'Gespeichert.');
  });
  const recent = tip.recent ?? [];
  return card('💶', 'Trinkgeld', 'Deine Links stehen auf deinem öffentlichen Profil und bei !trinkgeld im Chat.',
    h('div', { class: 'field' }, h('span', {}, 'Deine Trinkgeld-Links (PayPal.me, Tipeee, Streamlabs, Ko-fi …)'), rows, h('div', {}, add)),
    toggle(tipDraft, 'alert', 'Ko-fi-Trinkgeld als Alert im Overlay zeigen'),
    toggle(tipDraft, 'thank', 'Bot bedankt sich im Chat'),
    h('div', { class: 'mo-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Dank im Chat'), text),
      h('label', { class: 'field' }, h('span', {}, 'Alert erst ab (Euro)'), min)),
    h('p', { class: 'form-hint' }, 'Platzhalter: {name}, {amount}, {message}. Aussehen und Sound des Alerts stellst du wie bei den anderen Alerts ein (Alert-Designer, OBS-Fenster).'),
    h('div', { class: 'dash-actions' }, save),
    recent.length ? h('div', { class: 'field' }, h('span', {}, 'Zuletzt'),
      h('ul', { class: 'mo-recent' }, ...recent.map((r) => h('li', {},
        h('b', {}, money({ amount: r.cents, tier: r.currency })), h('span', {}, r.name), r.message ? h('small', {}, r.message) : null,
        h('time', {}, new Date(r.at).toLocaleDateString('de-DE')))))) : null);
}

// ---------- Sponsoren ----------
function sponsorCard(slot) {
  const f = editing ?? (fresh ??= { name: '', text: '', code: '', url: '', active: true });
  const field = (key, label, attrs = {}) => {
    const input = h('input', { type: 'text', value: f[key] ?? '', ...attrs });
    input.addEventListener('input', () => { f[key] = input.value; });
    return h('label', { class: 'field' }, h('span', {}, label), input);
  };
  const save = h('button', { type: 'button', class: 'btn btn--primary btn--sm' }, icon(f.id ? 'ph-floppy-disk' : 'ph-plus'), f.id ? 'Sponsor speichern' : 'Sponsor hinzufügen');
  save.addEventListener('click', () => {
    if (!String(f.name ?? '').trim()) { ctx.toast('Bitte einen Namen eingeben.', 'error'); return; }
    if (f.url && !URL_RE.test(f.url.trim())) { ctx.toast('Der Link muss mit https:// beginnen.', 'error'); return; }
    run(slot, async () => { sponsors = await ctx.api.sponsorSave(f); editing = null; fresh = null; }, 'Sponsor gespeichert.');
  });
  const cancel = f.id ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Abbrechen') : null;
  cancel?.addEventListener('click', () => { editing = null; paint(slot); });
  const list = sponsors.length ? h('ul', { class: 'mo-sponsors' }, ...sponsors.map((s) => {
    // aus der Sponsoring-Börse: Inhalt legt die Firma fest – nur zeigen/pausieren und beenden
    const edit = s.offer_id ? h('span', { class: 'mo-fixed', title: 'Legt die Firma fest' }, icon('ph-handshake'), 'Börse')
      : h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('ph-pencil-simple'), 'Bearbeiten');
    if (!s.offer_id) edit.addEventListener('click', () => { editing = { ...s }; paint(slot); });
    const onoff = h('input', { type: 'checkbox', checked: s.active, 'aria-label': `${s.name} zeigen` });
    onoff.addEventListener('change', () => run(slot, async () => { sponsors = await ctx.api.sponsorSave({ ...s, active: onoff.checked }); }, onoff.checked ? 'Sponsor wird gezeigt.' : 'Sponsor pausiert.'));
    const del = h('button', { type: 'button', class: 'pf-del', title: 'Sponsor löschen', 'aria-label': `${s.name} löschen` }, icon('ph-trash'));
    del.addEventListener('click', () => {
      if (!confirm(s.offer_id ? `Sponsoring mit „${s.name}“ beenden? Die Firma sieht das.` : `„${s.name}“ löschen?`)) return;
      run(slot, async () => { sponsors = await ctx.api.sponsorDelete(s.id); }, 'Sponsor gelöscht.');
    });
    return h('li', { class: `mo-sponsor${s.active ? '' : ' is-off'}` },
      h('label', { class: 'toggle' }, onoff, h('span', { class: 'toggle-ui', 'aria-hidden': 'true' })),
      h('div', { class: 'mo-sponsor-text' }, h('b', {}, s.logo_path ? h('img', { class: 'mo-logo', src: sponsorLogoUrl(s.logo_path), alt: '' }) : null, s.name),
        h('span', {}, [s.text, s.code && `Code ${s.code}`].filter(Boolean).join(' · ') || '–'),
        s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.url.replace(/^https:\/\//, '')) : null),
      edit, del);
  })) : h('p', { class: 'form-hint' }, 'Noch keine Sponsoren.');
  return card('🤝', 'Sponsoren', 'Deine Partner laufen im Laufband des Overlays mit – immer mit „Anzeige“ davor. !sponsor im Chat nennt sie mit Code.',
    list,
    h('div', { class: 'mo-grid' },
      field('name', 'Name', { maxlength: '60', placeholder: 'z. B. GamerFuel' }),
      field('code', 'Rabattcode (optional)', { maxlength: '40', placeholder: 'STREAM10' }),
      field('text', 'Kurztext (optional)', { maxlength: '140', placeholder: 'Energy ohne Zucker – 10 % mit Code' }),
      field('url', 'Link (optional)', { maxlength: '300', placeholder: 'https://…', type: 'url' })),
    h('div', { class: 'dash-actions' }, save, cancel),
    h('p', { class: 'form-hint' }, '⚖️ Werbung muss erkennbar sein: Im Overlay steht „Anzeige“, im Chat „Werbung“. Sag es im Stream auch selbst, wenn du über einen Sponsor sprichst. Twitch erlaubt keine Werbung in der Twitch-Erweiterung – dort erscheinen Sponsoren deshalb nicht.'));
}

// ---------- Sponsoring-Börse (Migration …_sponsoring.sql): Angebote von Firmen für deine Kanalgröße ----------
const MINE = { pending: '⏳ beworben – die Firma entscheidet', accepted: '✅ läuft', declined: '✖ abgesagt', ended: '⏹ beendet' };
const euro = (c) => (c == null ? '' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(c / 100));

function offerInfo(o) {
  const logo = sponsorLogoUrl(o.logo_path);
  return [
    h('div', { class: 'mo-offer-head' }, logo ? h('img', { class: 'mo-logo', src: logo, alt: '' }) : null,
      h('div', {}, h('b', {}, o.title), h('span', {}, o.website ? h('a', { href: o.website, target: '_blank', rel: 'noopener noreferrer' }, o.company) : o.company))),
    h('p', { class: 'mo-offer-text' }, o.description),
    h('ul', { class: 'mo-offer-facts' },
      o.reward ? h('li', {}, `🎁 ${o.reward}`) : null,
      o.amount_cents != null ? h('li', {}, `💶 ${euro(o.amount_cents)}`) : null,
      h('li', {}, o.pay_mode === 'streamhelp' ? '💳 über StreamHelp' : '💳 direkt von der Firma'),
      h('li', {}, `👥 Ø ${o.min_viewers}${o.max_viewers != null ? `–${o.max_viewers}` : '+'} Zuschauer`),
      h('li', {}, `🎟️ ${Math.max(0, o.slots - (o.taken ?? 0))} von ${o.slots} Plätzen frei`),
      h('li', {}, `📺 Einblendung alle ${o.every_min} Min. für ${o.show_sec} s`),
      o.ends_on ? h('li', {}, `📅 bis ${new Date(o.ends_on).toLocaleDateString('de-DE')}`) : null),
  ];
}

function marketCard(slot) {
  const offers = market.offers ?? [];
  const mine = market.mine ?? [];
  return card('🏷️', 'Sponsoring-Börse', `Angebote von Firmen für deine Kanalgröße (Ø ${market.size?.avg ?? 0} Zuschauer in den letzten 30 Tagen). Sagt die Firma zu, läuft ihre Einblendung automatisch – mit „Anzeige“.`,
    mine.length ? h('div', { class: 'field' }, h('span', {}, 'Deine Bewerbungen'),
      h('ul', { class: 'mo-offers' }, ...mine.map((m) => {
        const stop = ['pending', 'accepted'].includes(m.status)
          ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, m.status === 'accepted' ? 'Beenden' : 'Zurückziehen') : null;
        stop?.addEventListener('click', () => {
          if (!confirm(m.status === 'accepted' ? 'Sponsoring beenden? Die Einblendung verschwindet sofort.' : 'Bewerbung zurückziehen?')) return;
          run(slot, async () => { market = await ctx.api.sponsoringWithdraw(m.offer.id); sponsors = await ctx.api.sponsorAdminList(); }, 'Erledigt.');
        });
        return h('li', { class: 'mo-offer' }, ...offerInfo(m.offer),
          h('p', { class: 'mo-offer-state' }, MINE[m.status] ?? m.status, m.company_note ? ` · „${m.company_note}“` : ''),
          m.status === 'accepted' ? h('p', { class: 'form-hint' }, '📺 Damit die Einblendung im Stream erscheint: OBS-Fenster → Ebene „Sponsor-Einblendung“ einschalten. Im Laufband und bei !sponsor läuft sie automatisch.') : null,
          stop ? h('div', { class: 'dash-actions' }, stop) : null);
      }))) : null,
    offers.length ? h('ul', { class: 'mo-offers' }, ...offers.map((o) => {
      const d = (applyDraft[o.id] ??= { message: '', share: true });
      const text = h('textarea', { rows: '2', maxlength: '500', placeholder: 'Kurz zu dir und deinem Stream (optional)', 'aria-label': `Nachricht an ${o.company}` });
      text.value = d.message;
      text.addEventListener('input', () => { d.message = text.value; });
      const share = h('input', { type: 'checkbox', checked: d.share });
      share.addEventListener('change', () => { d.share = share.checked; });
      const go = h('button', { type: 'button', class: 'btn btn--primary btn--sm' }, icon('ph-paper-plane-tilt'), 'Bewerben');
      go.addEventListener('click', () => run(slot, async () => { market = await ctx.api.sponsoringApply(o.id, d.message, d.share); delete applyDraft[o.id]; }, 'Beworben – die Firma entscheidet.'));
      return h('li', { class: 'mo-offer' }, ...offerInfo(o),
        h('label', { class: 'field' }, h('span', {}, 'Nachricht an die Firma'), text),
        h('label', { class: 'toggle' }, share, h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }), 'Meine Zahlen mitschicken (Ø und Spitze der Zuschauer, Anzahl Streams)'),
        h('div', { class: 'dash-actions' }, go));
    })) : h('p', { class: 'form-hint' }, 'Gerade gibt es kein passendes Angebot. Neue Angebote erscheinen hier, sobald StreamHelp sie freigegeben hat.'),
    h('p', { class: 'form-hint' }, '⚖️ Vertrag und Bezahlung regelst du mit der Firma (bei „über StreamHelp“ melden wir uns). Werbung ist im Stream immer als „Anzeige“ gekennzeichnet.'));
}
