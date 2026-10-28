// Artist-Bereich (Dashboard → Artist-Bereich, Migration …_artists.sql): für alle mit Konto.
//   · Bewerben: Name, Kennung, Kurztext, Links zu eigenen Arbeiten. Der Plattform-Admin schaltet frei.
//   · Hochladen (freigeschaltet): Alert-Grafik, Szenen-Hintergrund, kompletter Look oder Sammelkarte.
//     Jeder Upload wartet auf die Prüfung, danach steht er kostenlos mit Credit in der Design-Bibliothek.
//   · Eigene Uploads: Status, Hinweis des Admins, wie oft übernommen, löschen.
import { RARITY_LABEL, h } from './extras-core.js';
import { OVERLAY_THEMES } from './overlay-stage.js';
import { artistFileUrl, isArtistVideo } from './artist-files.js';

export const ARTIST_KINDS = {
  alert: { label: 'Alert-Grafik', icon: '🔔', hint: 'Bild, GIF oder kurzes Video (WebM/MP4) – erscheint bei Follows, Abos und Bits.', accept: 'image/png,image/jpeg,image/gif,image/webp,video/webm,video/mp4' },
  background: { label: 'Szenen-Hintergrund', icon: '🖼️', hint: 'Bild im Querformat (am besten 1920 × 1080) für „Gleich geht’s los“, Pause und Ende.', accept: 'image/png,image/jpeg,image/webp' },
  look: { label: 'Kompletter Look', icon: '🎨', hint: 'Hintergrund + Akzentfarbe + Grund-Design, dazu optional ein eigenes Alert-Bild.', accept: 'image/png,image/jpeg,image/webp' },
  card: { label: 'Sammelkarte', icon: '🃏', hint: 'Bild im Hochformat (z. B. 600 × 840) für die Sammelkarten der Zuschauer.', accept: 'image/png,image/jpeg,image/gif,image/webp' },
};
const STATUS = { pending: ['⏳', 'Wird geprüft'], approved: ['✅', 'Freigegeben'], rejected: ['✖', 'Abgelehnt'], removed: ['🚫', 'Entfernt'] };
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_LINKS = 4;

let ctx = null;   // { api, toast, germanError, openLibrary }
let me = null;    // artist_me()
let slot = null;
let kind = 'alert';

const icon = (cls) => h('i', { class: `ph ${cls}`, 'aria-hidden': 'true' });
const card = (ico, title, sub, ...kids) => h('article', { class: 'dash-card dash-card--wide ar-card' },
  h('header', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, ico), h('div', {}, h('h2', {}, title), sub ? h('p', { class: 'dash-status' }, sub) : null)),
  ...kids);
const slugify = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

export async function renderArtist(el, deps) {
  ctx = deps;
  slot = el;
  slot.replaceChildren(h('p', { class: 'form-hint' }, 'Lädt …'));
  try {
    me = await ctx.api.artistMe();
  } catch (err) {
    slot.replaceChildren(card('🎨', 'Artist-Bereich', '', h('p', { class: 'form-hint' }, missing(err) ? 'Der Artist-Bereich ist noch nicht eingerichtet (Migration …_artists.sql).' : ctx.germanError(err))));
    return;
  }
  paint();
}

const missing = (err) => /artist_me|artists" does not exist|core\.artists/.test(err?.message ?? '');

function paint() {
  const a = me.artist;
  const parts = [intro(a)];
  if (!a || a.status === 'rejected') parts.push(applyForm(a));
  else if (a.status === 'pending') parts.push(pendingCard(a));
  else if (a.status === 'blocked') parts.push(card('🚫', 'Artist-Konto gesperrt', a.note || 'Bei Fragen schreib uns über das Kontaktformular auf der Startseite.'));
  else parts.push(uploadForm(), mine(), applyForm(a, true));
  slot.replaceChildren(...parts);
}

// ---------- Kopf: worum es geht ----------
function intro(a) {
  const approved = a?.status === 'approved';
  return h('article', { class: 'dash-card dash-card--wide ar-intro' },
    h('header', { class: 'dash-card-head' }, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, '🎨'),
      h('div', {}, h('h2', {}, approved ? `Hallo ${a.name}!` : 'Designs für Streamer gestalten'),
        h('p', { class: 'dash-status' }, approved
          ? 'Lade Alert-Grafiken, Hintergründe, Looks und Sammelkarten hoch. Nach der Prüfung stehen sie in der Design-Bibliothek – mit deinem Namen und deinen Links.'
          : 'Du zeichnest, animierst oder baust Overlays? Als Artist stellst du deine Designs allen Streamern auf StreamHelp kostenlos zur Verfügung – mit Credit und Link zu dir.'))),
    h('ol', { class: 'ar-steps' },
      h('li', { class: a ? 'is-done' : 'is-now' }, h('b', {}, '1. Bewerben'), h('span', {}, 'Name, Kurztext und Links zu deinen Arbeiten.')),
      h('li', { class: approved ? 'is-done' : a?.status === 'pending' ? 'is-now' : '' }, h('b', {}, '2. Freischaltung'), h('span', {}, 'Wir schauen uns deine Arbeiten an.')),
      h('li', { class: approved ? 'is-now' : '' }, h('b', {}, '3. Hochladen'), h('span', {}, 'Jeder Upload wird vor der Veröffentlichung geprüft.')),
      h('li', {}, h('b', {}, '4. Credit'), h('span', {}, 'Streamer sehen deinen Namen und deine Links bei jedem Design.'))));
}

// ---------- Bewerbung / Profil ----------
function applyForm(a, edit = false) {
  const links = [...(a?.links ?? [])];
  while (links.length < 2) links.push('');
  const form = h('form', { class: 'ar-form', novalidate: true },
    a?.status === 'rejected' ? h('p', { class: 'ar-note is-bad', role: 'status' }, `Deine letzte Bewerbung wurde abgelehnt${a.note ? `: ${a.note}` : '.'} Du kannst dich mit neuen Links noch einmal bewerben.`) : null,
    h('div', { class: 'pf-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Artist-Name'), h('input', { name: 'name', maxlength: '40', required: true, value: a?.name ?? '', autocomplete: 'nickname', placeholder: 'z. B. PixelPinsel' })),
      h('label', { class: 'field' }, h('span', {}, 'Kennung (für Links)'), h('input', { name: 'slug', maxlength: '30', required: true, value: a?.slug ?? '', pattern: '[a-z0-9][a-z0-9-]{1,28}[a-z0-9]', spellcheck: 'false', placeholder: 'pixel-pinsel' }))),
    h('label', { class: 'field' }, h('span', {}, 'Über dich (optional)'), h('textarea', { name: 'bio', maxlength: '300', rows: '3', placeholder: 'Was machst du, welcher Stil?' }, a?.bio ?? '')),
    h('fieldset', { class: 'ar-links' }, h('legend', {}, 'Links zu deinen Arbeiten (https://…, z. B. Portfolio, Instagram, Ko-fi)'),
      h('div', { class: 'ar-link-list' }, ...links.map((l, i) => linkInput(l, i))),
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-more-link': '' }, '＋ Link')),
    edit ? null : h('div', { class: 'ar-rules' },
      h('b', {}, 'Die Regeln'),
      h('ul', {},
        h('li', {}, 'Nur eigene Werke – keine fremden Bilder, Marken, Logos oder Figuren ohne Erlaubnis.'),
        h('li', {}, 'Alles ist für Streamer kostenlos; du bekommst Credit mit Namen und Links.'),
        h('li', {}, 'Wir prüfen jeden Upload und dürfen Designs ablehnen oder entfernen.')),
      h('label', { class: 'toggle' }, h('input', { type: 'checkbox', name: 'rules', required: true }), h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }), 'Gelesen und einverstanden')),
    h('div', { class: 'dash-actions' }, h('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, edit ? 'Profil speichern' : a ? 'Neu bewerben' : 'Als Artist bewerben')));
  const name = form.elements.name;
  const slugInput = form.elements.slug;
  let slugTouched = !!a?.slug;
  slugInput.addEventListener('input', () => { slugTouched = true; });
  name.addEventListener('input', () => { if (!slugTouched) slugInput.value = slugify(name.value); });
  form.querySelector('[data-more-link]').addEventListener('click', () => {
    const list = form.querySelector('.ar-link-list');
    if (list.childElementCount < MAX_LINKS) list.append(linkInput('', list.childElementCount));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!edit && !form.elements.rules.checked) { ctx.toast('Bitte die Regeln bestätigen.', 'error'); return; }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      me = await ctx.api.artistApply({
        name: name.value, slug: slugInput.value, bio: form.elements.bio.value,
        links: [...form.querySelectorAll('[name=link]')].map((i) => i.value.trim()).filter(Boolean),
      });
      ctx.toast(edit ? 'Profil gespeichert.' : 'Bewerbung abgeschickt – wir melden uns hier.', 'ok');
      paint();
    } catch (err) {
      ctx.toast(ctx.germanError(err), 'error');
    } finally {
      btn.disabled = false;
    }
  });
  if (edit) {
    return h('details', { class: 'dash-card dash-card--wide ar-card ar-profile' },
      h('summary', {}, h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, '👤'), h('span', {}, h('b', {}, 'Dein Artist-Profil'), h('small', {}, `${a.name} · ${a.links.length} ${a.links.length === 1 ? 'Link' : 'Links'}`))),
      form);
  }
  return card('✍️', a ? 'Noch einmal bewerben' : 'Als Artist bewerben', 'Dauert eine Minute. Wir schauen uns deine Links an und schalten dich frei.', form);
}

function linkInput(value, i) {
  return h('input', { type: 'url', name: 'link', value, maxlength: '195', placeholder: i === 0 ? 'https://dein-portfolio.de' : 'https://…', 'aria-label': `Link ${i + 1}`, inputmode: 'url' });
}

function pendingCard(a) {
  return card('⏳', 'Bewerbung wird geprüft', `Eingegangen am ${new Date(a.applied_at).toLocaleDateString('de-DE')}. Sobald du freigeschaltet bist, kannst du hier hochladen.`,
    ctx.api.demo ? h('p', { class: 'form-hint' }, 'Demo: Im Admin-Bereich (admin.html, Passwort „demo“) unter „Artists“ freischalten.') : null,
    h('dl', { class: 'ar-facts' }, h('dt', {}, 'Name'), h('dd', {}, a.name), h('dt', {}, 'Links'), h('dd', {}, ...a.links.map((l) => h('a', { href: l, target: '_blank', rel: 'noopener noreferrer nofollow' }, l)))));
}

// ---------- Hochladen ----------
function uploadForm() {
  const kinds = h('div', { class: 'ar-kinds', role: 'radiogroup', 'aria-label': 'Was lädst du hoch?' }, ...Object.entries(ARTIST_KINDS).map(([k, v]) =>
    h('label', { class: 'ar-kind' }, h('input', { type: 'radio', name: 'kind', value: k, checked: k === kind }),
      h('span', { class: 'ar-kind-ico', 'aria-hidden': 'true' }, v.icon), h('b', {}, v.label), h('small', {}, v.hint))));
  const preview = h('div', { class: 'ar-preview', 'aria-live': 'polite' }, h('span', { class: 'form-hint' }, 'Noch keine Datei gewählt.'));
  const form = h('form', { class: 'ar-form ar-upload', novalidate: true },
    kinds,
    h('div', { class: 'ar-upload-grid' },
      h('div', { class: 'ar-upload-fields' },
        h('label', { class: 'field' }, h('span', {}, 'Datei (höchstens 10 MB)'), h('input', { type: 'file', name: 'file', required: true })),
        h('div', { class: 'ar-extra', 'data-for': 'look', hidden: true },
          h('div', { class: 'pf-grid' },
            h('label', { class: 'field' }, h('span', {}, 'Grund-Design'), h('select', { name: 'base' }, ...OVERLAY_THEMES.map((t) => h('option', { value: t.id }, t.name)))),
            h('label', { class: 'field' }, h('span', {}, 'Akzentfarbe'), h('input', { type: 'color', name: 'accent', value: '#9146ff' }))),
          h('label', { class: 'field' }, h('span', {}, 'Eigenes Alert-Bild (optional)'), h('input', { type: 'file', name: 'alert', accept: ARTIST_KINDS.alert.accept }))),
        h('div', { class: 'ar-extra pf-grid', 'data-for': 'card', hidden: true },
          h('label', { class: 'field' }, h('span', {}, 'Seltenheit (Vorschlag)'), h('select', { name: 'rarity' }, ...Object.entries(RARITY_LABEL).map(([k, v]) => h('option', { value: k, selected: k === 'rare' }, v)))),
          h('label', { class: 'field' }, h('span', {}, 'Emoji (optional)'), h('input', { name: 'emoji', maxlength: '8', placeholder: '🌸' }))),
        h('label', { class: 'field' }, h('span', {}, 'Titel'), h('input', { name: 'title', maxlength: '60', required: true, placeholder: 'z. B. Neon-Rakete' })),
        h('label', { class: 'field' }, h('span', {}, 'Beschreibung (optional)'), h('textarea', { name: 'description', maxlength: '300', rows: '2', placeholder: 'Wofür passt es? Welche Stimmung?' })),
        h('label', { class: 'field' }, h('span', {}, 'Schlagwörter (mit Komma, höchstens 6)'), h('input', { name: 'tags', maxlength: '140', placeholder: 'neon, hype, cyberpunk' }))),
      preview),
    h('label', { class: 'toggle ar-rights' }, h('input', { type: 'checkbox', name: 'rights', required: true }), h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }),
      'Ich habe das Design selbst gemacht (oder habe alle Rechte daran) und Streamer dürfen es kostenlos in ihren Streams nutzen.'),
    h('div', { class: 'dash-actions' }, h('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, icon('ph-upload-simple'), ' Zur Prüfung einreichen'),
      h('span', { class: 'form-hint', 'data-progress': '' })));

  const setKind = (k) => {
    kind = k;
    form.elements.file.accept = ARTIST_KINDS[k].accept;
    form.querySelectorAll('.ar-extra').forEach((x) => { x.hidden = x.dataset.for !== k; });
    showPreview(form, preview);
  };
  kinds.addEventListener('change', (e) => { if (e.target.name === 'kind') setKind(e.target.value); });
  form.elements.file.addEventListener('change', () => showPreview(form, preview));
  form.elements.alert.addEventListener('change', () => showPreview(form, preview));
  form.elements.accent.addEventListener('input', () => showPreview(form, preview));
  setKind(kind);
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(form); });
  return card('⬆️', 'Neues Design hochladen', 'Wird vor der Veröffentlichung geprüft – meist innerhalb von ein paar Tagen.', form);
}

const objectUrls = new Set();
function fileUrl(file) {
  const u = URL.createObjectURL(file);
  objectUrls.add(u);
  return u;
}
function media(src, video, alt = '') {
  return video ? h('video', { src, muted: true, loop: true, autoplay: true, playsinline: true, 'aria-label': alt }) : h('img', { src, alt, loading: 'lazy' });
}

function showPreview(form, box) {
  for (const u of objectUrls) URL.revokeObjectURL(u);
  objectUrls.clear();
  const file = form.elements.file.files[0];
  if (!file) { box.replaceChildren(h('span', { class: 'form-hint' }, 'Noch keine Datei gewählt.')); return; }
  const video = /^video\//.test(file.type);
  const src = fileUrl(file);
  const alertFile = kind === 'look' ? form.elements.alert.files[0] : null;
  const stage = h('div', { class: `ar-stage ar-stage--${kind}`, style: kind === 'look' ? { '--ar-accent': form.elements.accent.value } : null },
    kind === 'alert' ? h('div', { class: 'ar-stage-alert' }, media(src, video), h('b', {}, 'NightOwl_Mia folgt jetzt!'))
      : kind === 'card' ? h('div', { class: 'ar-stage-card' }, media(src, false), h('b', {}, form.elements.title.value || 'Deine Karte'))
        : h('div', { class: 'ar-stage-bg', style: { backgroundImage: `url("${src}")` } },
          h('div', { class: 'ar-stage-label' }, h('small', {}, 'Gleich geht’s los'), h('b', {}, 'Stream startet gleich')),
          alertFile ? h('div', { class: 'ar-stage-alert ar-stage-alert--mini' }, media(fileUrl(alertFile), /^video\//.test(alertFile.type)), h('b', {}, 'Neuer Follower!')) : null));
  box.replaceChildren(stage, h('small', { class: 'form-hint' }, `${file.name} · ${(file.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB${file.size > MAX_BYTES ? ' – zu groß!' : ''}`));
}

async function submit(form) {
  const f = form.elements;
  const file = f.file.files[0];
  const alertFile = kind === 'look' ? f.alert.files[0] : null;
  const fail = (msg) => ctx.toast(msg, 'error');
  if (!file) return fail('Bitte eine Datei wählen.');
  if (!f.rights.checked) return fail('Bitte bestätige, dass du die Rechte an dem Design hast.');
  if (f.title.value.trim().length < 3) return fail('Der Titel braucht mindestens 3 Zeichen.');
  for (const x of [file, alertFile].filter(Boolean)) {
    if (x.size > MAX_BYTES) return fail(`„${x.name}“ ist größer als 10 MB.`);
    if (!ARTIST_KINDS[x === alertFile ? 'alert' : kind].accept.split(',').includes(x.type)) return fail(`„${x.name}“ hat ein Format, das hier nicht passt.`);
  }
  const btn = form.querySelector('[type=submit]');
  const progress = form.querySelector('[data-progress]');
  btn.disabled = true;
  try {
    progress.textContent = 'Lädt hoch …';
    const path = await ctx.api.artistUpload(file);
    const alertPath = alertFile ? await ctx.api.artistUpload(alertFile) : null;
    progress.textContent = 'Wird eingereicht …';
    const extra = kind === 'look' ? { base: f.base.value, accent: f.accent.value, ...(alertPath ? { alert: alertPath } : {}) }
      : kind === 'card' ? { rarity: f.rarity.value, emoji: f.emoji.value.trim() } : {};
    await ctx.api.artistSubmit({
      kind, title: f.title.value, description: f.description.value, tags: f.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
      file: path, extra, rights: true,
    });
    ctx.toast('Eingereicht – du siehst den Status unten bei „Deine Designs“.', 'ok');
    me = await ctx.api.artistMe();
    paint();
  } catch (err) {
    ctx.toast(ctx.germanError(err), 'error');
  } finally {
    btn.disabled = false;
    progress.textContent = '';
  }
}

// ---------- Eigene Uploads ----------
function mine() {
  const list = me.assets ?? [];
  const counts = list.reduce((o, x) => ({ ...o, [x.status]: (o[x.status] ?? 0) + 1 }), {});
  const sub = list.length
    ? [counts.approved && `${counts.approved} freigegeben`, counts.pending && `${counts.pending} in Prüfung`, counts.rejected && `${counts.rejected} abgelehnt`].filter(Boolean).join(' · ')
    : 'Noch nichts hochgeladen.';
  return card('🗂️', 'Deine Designs', sub,
    list.length ? h('ul', { class: 'ar-mine' }, ...list.map(item)) : h('p', { class: 'form-hint' }, 'Sobald du etwas einreichst, steht es hier – mit Status und Hinweisen aus der Prüfung.'),
    list.some((x) => x.status === 'approved') && ctx.openLibrary
      ? h('div', { class: 'dash-actions' }, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => ctx.openLibrary() }, icon('ph-books'), ' In der Design-Bibliothek ansehen'))
      : null);
}

function item(x) {
  const [ico, label] = STATUS[x.status] ?? ['', x.status];
  const src = artistFileUrl(x.file);
  return h('li', { class: `ar-item is-${x.status}` },
    h('div', { class: 'ar-thumb' }, src ? media(src, isArtistVideo(x.file), x.title) : h('span', { 'aria-hidden': 'true' }, ARTIST_KINDS[x.kind]?.icon)),
    h('div', { class: 'ar-item-body' },
      h('b', {}, x.title),
      h('small', {}, `${ARTIST_KINDS[x.kind]?.label ?? x.kind} · ${new Date(x.created_at).toLocaleDateString('de-DE')}${x.status === 'approved' ? ` · ${x.uses} ${x.uses === 1 ? 'Kanal nutzt' : 'Kanäle nutzen'} es` : ''}`),
      x.note ? h('p', { class: `ar-note${x.status === 'rejected' ? ' is-bad' : ''}` }, x.note) : null),
    h('span', { class: `ar-status is-${x.status}` }, `${ico} ${label}`),
    h('button', {
      class: 'pf-del', type: 'button', title: 'Löschen', 'aria-label': `„${x.title}“ löschen`,
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!confirm(`„${x.title}“ löschen?${x.status === 'approved' ? ' Streamer, die es nutzen, sehen es dann nicht mehr.' : ''}`)) return;
        btn.disabled = true;
        try {
          await ctx.api.artistDelete(x.id);
          me = await ctx.api.artistMe();
          paint();
        } catch (err) {
          ctx.toast(ctx.germanError(err), 'error');
          btn.disabled = false;
        }
      },
    }, icon('ph-trash')));
}
