// Webseite: Vorlesen (Text-to-Speech) und Sammelkarten
import {
  $, $$, RARITY_LABEL, X, act, fill, h, isAdmin, makeDialog, onSubmit, openFeature, paintNote, paintTile, timeOf, toast,
} from './extras-core.js';
import { RARITY_ORDER } from './extras-api.js';
import { TTS_VOICES, speak, stopSpeaking, ttsAvailable } from './tts-voice.js';
import { shrinkImage } from './bingo.js';

// Kanalpunkte-Belohnung (Kosten, Abklingzeit, an/aus, zu Twitch übernehmen) – nur Admins der Seite
function rewardBox(key) {
  return `
  <section class="bingo-box x-reward" data-reward="${key}">
    <h3 class="prank-h3">Kanalpunkte <small data-reward-state></small></h3>
    <form class="x-form" data-reward-form>
      <div class="x-grid2">
        <label class="field"><span>Kosten</span><input type="number" name="cost" min="1" max="1000000"></label>
        <label class="field"><span>Pause (Sekunden)</span><input type="number" name="cooldown" min="0" max="604800"></label>
      </div>
      <label class="toggle"><input type="checkbox" name="enabled"><span class="toggle-ui" aria-hidden="true"></span>Belohnung an</label>
      <button class="btn btn--outline btn--sm" type="submit">Speichern &amp; zu Twitch übernehmen</button>
    </form>
    <p class="form-hint">Legt die Belohnung im Twitch-Kanal an (nur Affiliates und Partner). Vor dem Starttermin der Kachel bleibt sie aus.</p>
  </section>`;
}

async function wireReward(dlg, key) {
  const box = $(`[data-reward="${key}"]`, dlg);
  const paint = (r) => {
    if (!r) return;
    const form = $('[data-reward-form]', box);
    if (!form.contains(document.activeElement)) {
      form.cost.value = r.cost;
      form.cooldown.value = r.cooldown;
      form.enabled.checked = r.enabled;
    }
    $('[data-reward-state]', box).textContent = r.error ? `· ⚠ ${r.error}` : r.reward_id ? '· ✓ bei Twitch angelegt' : '· noch nicht bei Twitch';
  };
  onSubmit($('[data-reward-form]', box), async (form) => {
    const r = await X.api.rewards.set(key, { cost: Number(form.cost.value), cooldown: Number(form.cooldown.value), enabled: form.enabled.checked });
    paint(r);
    try {
      await X.api.rewards.sync(key);
      toast('Bei Twitch übernommen.', 'ok');
    } catch (err) {
      toast(`Gespeichert, aber nicht bei Twitch: ${X.ctx.germanError(err)}`, 'error', 8000);
    }
    paint((await X.api.rewards.list().catch(() => [])).find((x) => x.key === key));
  });
  return async () => {
    // Kanalpunkte-Kosten bleiben beim Streamer und den Admins der Seite (nicht bei Mods)
    box.hidden = !isAdmin() || !!X.ctx.state.access?.is_mod && !X.ctx.state.access?.is_site_admin;
    if (!box.hidden) paint((await X.api.rewards.list().catch(() => [])).find((x) => x.key === key));
  };
}

// ============================================================
// Vorlesen (Text-to-Speech)
// ============================================================
export const tts = {
  kind: 'tts', icon: '🔊', cta: 'Zum Vorlesen →',
  on: false, error: '', settings: null, state: null, messages: [], subscribed: false, dialog: null, paintReward: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-tts', cls: 'x-tts', eyebrow: 'Kanalpunkte · im Stream vorgelesen', title: 'Vorlesen lassen',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero tt-hero">
            <b>So geht’s</b>
            <ol class="tt-steps">
              <li>Im Twitch-Chat auf die Kanalpunkte klicken.</li>
              <li><b>„🔊 Nachricht vorlesen“</b> einlösen und die Nachricht eintippen.</li>
              <li>Andere Stimme? Schreib sie an den Anfang, z. B. <code>oma: Hallo Kinder!</code></li>
            </ol>
            <p class="form-hint" data-rules></p>
          </div>
          <h3 class="prank-h3">Stimmen zum Anhören</h3>
          <div class="tt-voices" data-voices></div>
          <p class="form-hint" data-no-tts hidden>Dein Browser kann nicht vorlesen – im Stream klappt es trotzdem.</p>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Warten auf Freigabe <small data-pending-count></small></h3>
            <ul class="x-list" data-pending></ul>
            <div class="x-row">
              <button class="btn btn--ghost btn--sm" type="button" data-skip>⏭ Aktuelle abbrechen</button>
              <label class="toggle"><input type="checkbox" data-mute><span class="toggle-ui" aria-hidden="true"></span>Stumm (Overlay liest nichts)</label>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" data-simulate hidden>🧪 Probe-Einlösung (Demo)</button>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Selbst vorlesen lassen</h3>
            <form class="x-form" data-web>
              <label class="field"><span>Text</span><input type="text" name="text" maxlength="500" required></label>
              <div class="x-inline">
                <select name="voice" aria-label="Stimme">${TTS_VOICES.map((v) => `<option value="${v.id}">${v.name}</option>`).join('')}</select>
                <button class="btn btn--primary btn--sm" type="submit">🔊 Im Stream vorlesen</button>
              </div>
            </form>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Zuletzt</h3>
            <ul class="x-list x-list--compact" data-recent></ul>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Regeln</h3>
            <form class="x-form" data-settings>
              <label class="toggle"><input type="checkbox" name="approval"><span class="toggle-ui" aria-hidden="true"></span>Erst nach Freigabe vorlesen</label>
              <label class="field"><span>Höchstens Zeichen</span><input type="number" name="max" min="20" max="500"></label>
              <label class="field"><span>Gesperrte Wörter (eins pro Zeile)</span><textarea name="blocked" rows="4" maxlength="4000"></textarea></label>
              <p class="form-hint">Links werden nie vorgelesen. Abgelehnte Nachrichten bekommen ihre Kanalpunkte zurück.</p>
              <button class="btn btn--outline btn--sm" type="submit">Speichern</button>
            </form>
          </section>
          ${rewardBox('tts')}
        </div>
      </div>`,
    });
    const d = this.dialog;
    $('[data-voices]', d).replaceChildren(...TTS_VOICES.map((v) => h('button', {
      class: 'btn btn--ghost btn--sm', type: 'button',
      onclick: () => { stopSpeaking(); speak(`Hallo, ich bin die Stimme ${v.name}.`, v.id); },
    }, `▶ ${v.name}`)));
    $('[data-no-tts]', d).hidden = ttsAvailable();
    $('[data-skip]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { this.state = await X.api.tts.skip(); }, 'Abgebrochen.'));
    $('[data-mute]', d).addEventListener('change', (e) => act(null, async () => { this.state = await X.api.tts.skip(e.target.checked); }));
    $('[data-simulate]', d).addEventListener('click', () => X.api.tts.simulate?.('Lokfuehrer_Lena', 'Hallo zusammen, das ist eine Probe!', 'oma').then(() => this.reload()));
    onSubmit($('[data-web]', d), async (form) => {
      await X.api.tts.web(form.text.value, form.voice.value);
      form.text.value = '';
      toast('Wird im Stream vorgelesen.', 'ok');
      this.reload();
    });
    onSubmit($('[data-settings]', d), async (form) => {
      this.settings = await X.api.tts.save({ approval: form.approval.checked, max: Number(form.max.value), blocked: form.blocked.value.split('\n') });
      toast('Gespeichert.', 'ok');
      this.render();
    });
    wireReward(d, 'tts').then((fn) => { this.paintReward = fn; });
  },

  async load() {
    try {
      this.state = await X.api.tts.state();
      this.on = !!this.state;
      if (isAdmin()) {
        [this.settings, this.messages] = await Promise.all([X.api.tts.settings(), X.api.tts.messages()]);
      }
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed && isAdmin()) {
      this.subscribed = true;
      X.api.on('tts_messages', () => this.reload());
    }
    paintTile(this);
  },

  async reload() {
    if (!isAdmin()) return;
    this.messages = await X.api.tts.messages().catch(() => this.messages);
    paintTile(this);
    if (this.dialog.open) this.render();
  },

  render() {
    const d = this.dialog;
    paintNote(d, this);
    const admin = isAdmin() && this.on;
    $('[data-admin]', d).hidden = !admin;
    d.classList.toggle('has-side', admin);
    $('[data-rules]', d).textContent = `Stimmen: ${TTS_VOICES.map((v) => v.name).join(', ')}. Keine Links, keine Beleidigungen – sonst gibt es die Punkte zurück und nichts wird vorgelesen.`;
    if (!admin) return;
    $('[data-simulate]', d).hidden = !X.api.demo;
    $('[data-mute]', d).checked = !!this.state?.muted;
    const pending = this.messages.filter((m) => m.status === 'pending');
    $('[data-pending-count]', d).textContent = pending.length ? `· ${pending.length}` : '';
    const voice = (id) => TTS_VOICES.find((v) => v.id === id)?.name ?? id;
    fill($('[data-pending]', d), pending, (m) => h('li', { class: 'x-item tt-msg' },
      h('span', { class: 'x-item-main' }, h('b', {}, `${m.who} · ${voice(m.voice)}`), h('span', { class: 'tt-text' }, m.text)),
      h('span', { class: 'x-item-actions' },
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Hier anhören', onclick: () => { stopSpeaking(); speak(m.text, m.voice); } }, '👂'),
        h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await X.api.tts.review(m.id, 'approve'); this.reload(); }) }, '✅'),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await X.api.tts.review(m.id, 'reject'); this.reload(); }) }, '❌'))),
    'Nichts wartet.');
    const recent = this.messages.filter((m) => m.status !== 'pending').slice(0, 10);
    fill($('[data-recent]', d), recent, (m) => h('li', { class: 'x-item' },
      h('span', { class: 'x-item-main' }, h('b', {}, `${m.status === 'approved' ? '🔊' : '🚫'} ${m.who}`), h('small', { class: 'tt-text' }, m.text)),
      m.status === 'approved' ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Nochmal vorlesen', onclick: (e) => act(e.currentTarget, async () => { await X.api.tts.review(m.id, 'replay'); }) }, '🔁') : null),
    'Noch nichts vorgelesen.');
    const form = $('[data-settings]', d);
    if (this.settings && !form.contains(document.activeElement)) {
      form.approval.checked = this.settings.need_approval;
      form.max.value = this.settings.max_chars;
      form.blocked.value = (this.settings.blocked_words ?? []).join('\n');
    }
    this.paintReward?.();
  },

  tileStatus() {
    const pending = isAdmin() ? this.messages.filter((m) => m.status === 'pending').length : 0;
    return pending ? `📝 ${pending} warten auf Freigabe` : '🔊 Deine Nachricht im Stream';
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};

// ============================================================
// Sammelkarten
// ============================================================
export const cards = {
  kind: 'cards', icon: '🃏', cta: 'Zu den Karten →',
  on: false, error: '', defs: [], me: null, settings: null, board: [], trades: [], view: null, tab: 'packs', editing: null,
  subscribed: false, dialog: null, paintReward: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-cards', cls: 'x-cards', eyebrow: 'Jeden Tag ein Gratis-Pack · Packs auch per Kanalpunkte', title: 'Sammelkarten',
      body: `
      <div class="cd-tabs" role="tablist">
        <button type="button" role="tab" data-tab="packs">📦 Packs</button>
        <button type="button" role="tab" data-tab="collection">📖 Sammlung</button>
        <button type="button" role="tab" data-tab="board">🏆 Rangliste</button>
        <button type="button" role="tab" data-tab="trades">🔁 Tauschen <span data-trade-badge></span></button>
        <button type="button" role="tab" data-tab="admin" hidden>⚙️ Karten</button>
      </div>
      <div class="cd-pane" data-pane="packs">
        <div class="cd-packs">
          <button class="btn btn--primary btn--lg" type="button" data-daily>🎁 Gratis-Pack für heute holen</button>
          <p class="form-hint" data-daily-hint></p>
          <button class="btn btn--ghost btn--sm" type="button" data-grant hidden>🧪 Pack wie per Kanalpunkte (Demo)</button>
          <ul class="cd-pack-list" data-packs></ul>
        </div>
        <div class="cd-reveal" data-reveal hidden></div>
      </div>
      <div class="cd-pane" data-pane="collection" hidden>
        <p class="cd-progress" data-progress></p>
        <div class="cd-grid" data-collection></div>
      </div>
      <div class="cd-pane" data-pane="board" hidden>
        <ol class="x-rank cd-board" data-board></ol>
        <div class="cd-view" data-view hidden>
          <h3 class="prank-h3" data-view-title></h3>
          <p class="form-hint">Karte anklicken, die du haben möchtest – dann wählst du, was du dafür gibst.</p>
          <div class="cd-grid cd-grid--small" data-view-grid></div>
        </div>
      </div>
      <div class="cd-pane" data-pane="trades" hidden>
        <h3 class="prank-h3">An dich</h3>
        <ul class="x-list" data-incoming></ul>
        <h3 class="prank-h3">Von dir</h3>
        <ul class="x-list" data-outgoing></ul>
      </div>
      <div class="cd-pane" data-pane="admin" hidden>
        <div class="x-layout has-side-fixed">
          <div class="x-main">
            <ul class="x-list cd-admin-list" data-defs></ul>
          </div>
          <div class="x-side">
            <section class="bingo-box">
              <h3 class="prank-h3" data-edit-title>Neue Karte</h3>
              <form class="x-form" data-card-form>
                <label class="field"><span>Name</span><input type="text" name="name" maxlength="40" required></label>
                <div class="x-grid2">
                  <label class="field"><span>Seltenheit</span><select name="rarity">${RARITY_ORDER.map((r) => `<option value="${r}">${RARITY_LABEL[r]}</option>`).join('')}</select></label>
                  <label class="field"><span>Emoji</span><input type="text" name="emoji" maxlength="8" placeholder="🃏"></label>
                </div>
                <label class="field"><span>Text</span><input type="text" name="description" maxlength="120"></label>
                <label class="field"><span>Bild (optional, statt Emoji)</span><input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif"></label>
                <label class="toggle"><input type="checkbox" name="active" checked><span class="toggle-ui" aria-hidden="true"></span>Kann gezogen werden</label>
                <div class="x-row">
                  <button class="btn btn--outline btn--sm" type="submit">Speichern</button>
                  <button class="btn btn--ghost btn--sm" type="button" data-edit-cancel hidden>Abbrechen</button>
                </div>
              </form>
            </section>
            <section class="bingo-box">
              <h3 class="prank-h3">Packs</h3>
              <form class="x-form" data-settings>
                <div class="x-grid2">
                  <label class="field"><span>Karten pro Pack</span><input type="number" name="size" min="1" max="10"></label>
                  <label class="toggle"><input type="checkbox" name="daily"><span class="toggle-ui" aria-hidden="true"></span>Gratis-Pack jeden Tag</label>
                </div>
                <p class="form-hint">Wie oft kommt welche Seltenheit? (Gewichte)</p>
                <div class="cd-weights">${RARITY_ORDER.map((r, i) => `<label class="field"><span>${RARITY_LABEL[r]}</span><input type="number" name="w${i}" min="0" max="1000"></label>`).join('')}</div>
                <button class="btn btn--outline btn--sm" type="submit">Speichern</button>
              </form>
            </section>
            ${rewardBox('cards')}
          </div>
        </div>
      </div>`,
    });
    const d = this.dialog;
    $$('.cd-tabs [data-tab]', d).forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.render(); }));
    $('[data-daily]', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
      const pack = await X.api.cards.claimDaily();
      await this.loadMe();
      await this.openPack(pack);
    }));
    $('[data-grant]', d).addEventListener('click', () => X.api.cards.grant?.().then(() => this.loadMe()).then(() => this.render()));
    onSubmit($('[data-card-form]', d), async (form) => {
      let image = this.editing?.image_path ?? null;
      const file = form.image.files[0];
      if (file) image = await X.api.cards.upload(await shrinkImage(file, 320));
      await X.api.cards.save({
        id: this.editing?.id, name: form.name.value, rarity: form.rarity.value, emoji: form.emoji.value,
        image, description: form.description.value, active: form.active.checked,
      });
      toast('Karte gespeichert.', 'ok');
      this.edit(null);
      this.defs = await X.api.cards.defs();
      this.render();
    });
    $('[data-edit-cancel]', d).addEventListener('click', () => this.edit(null));
    onSubmit($('[data-settings]', d), async (form) => {
      this.settings = await X.api.cards.saveSettings({
        size: Number(form.size.value), daily: form.daily.checked, weights: RARITY_ORDER.map((_, i) => Number(form[`w${i}`].value)),
      });
      toast('Gespeichert.', 'ok');
    });
    wireReward(d, 'cards').then((fn) => { this.paintReward = fn; });
  },

  async load() {
    try {
      this.defs = await X.api.cards.defs();
      this.on = true;
      await Promise.all([
        X.ctx.state.user ? this.loadMe() : null,
        X.api.cards.settings().then((s) => { this.settings = s; }).catch(() => {}),
      ]);
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed && X.ctx.state.user) {
      this.subscribed = true;
      X.api.on('card_trades', () => this.loadTrades().then(() => this.dialog.open && this.render()));
    }
    paintTile(this);
  },

  async loadMe() {
    this.me = await X.api.cards.me().catch(() => null);
    await this.loadTrades();
    paintTile(this);
  },
  async loadTrades() { this.trades = await X.api.cards.trades().catch(() => []); },

  def(id) { return this.defs.find((c) => c.id === id); },

  // Eine Karte als Element (unbekannt = Umriss mit ???)
  cardEl(c, { count = 0, known = true, isNew = false, small = false, onclick = null } = {}) {
    const img = c.image_path ? h('img', { src: X.api.cards.imageUrl(c.image_path), alt: '', loading: 'lazy' }) : h('span', { class: 'xc-emoji' }, c.emoji);
    return h(onclick ? 'button' : 'div', {
      class: `xcard r-${c.rarity}${known ? '' : ' is-unknown'}${small ? ' is-small' : ''}`, type: onclick ? 'button' : null, onclick,
      title: known ? `${c.name} · ${RARITY_LABEL[c.rarity]}` : '???',
    },
    h('span', { class: 'xc-art' }, known ? img : h('span', { class: 'xc-emoji' }, '❔')),
    h('b', { class: 'xc-name' }, known ? c.name : '???'),
    h('small', { class: 'xc-rarity' }, RARITY_LABEL[c.rarity]),
    count > 1 ? h('span', { class: 'xc-count' }, `×${count}`) : null,
    isNew ? h('span', { class: 'xc-new' }, 'NEU') : null);
  },

  async openPack(id) {
    const d = this.dialog;
    const drawn = await X.api.cards.open(id);
    const stage = $('[data-reveal]', d);
    stage.hidden = false;
    const flips = drawn.map((c) => {
      const back = h('div', { class: 'xc-back' }, '🃏');
      const face = this.cardEl(c, { isNew: c.new });
      return h('div', { class: `cd-flip r-${c.rarity}` }, h('div', { class: 'cd-flip-inner' }, back, face));
    });
    stage.replaceChildren(h('p', { class: 'cd-reveal-title' }, 'Klick auf die Karten!'), h('div', { class: 'cd-reveal-row' }, flips),
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { stage.hidden = true; this.render(); } }, 'Fertig'));
    flips.forEach((f, i) => {
      const turn = () => f.classList.add('is-open');
      f.addEventListener('click', turn);
      setTimeout(turn, 900 + i * 700);
    });
    await this.loadMe();
    this.renderPacks();
    const best = drawn.find((c) => c.rarity === 'legendary') ?? drawn.find((c) => c.rarity === 'epic');
    if (best) setTimeout(() => toast(`✨ ${RARITY_LABEL[best.rarity]}: ${best.name}!`, 'ok'), 900 + drawn.indexOf(best) * 700);
  },

  edit(c) {
    this.editing = c;
    const form = $('[data-card-form]', this.dialog);
    form.reset();
    if (c) {
      form.name.value = c.name;
      form.rarity.value = c.rarity;
      form.emoji.value = c.emoji;
      form.description.value = c.description ?? '';
      form.active.checked = c.active;
      form.name.focus();
    }
    $('[data-edit-title]', this.dialog).textContent = c ? `„${c.name}“ bearbeiten` : 'Neue Karte';
    $('[data-edit-cancel]', this.dialog).hidden = !c;
  },

  ownedMap() { return new Map((this.me?.owned ?? []).map((o) => [o.card_id, o.count])); },

  renderPacks() {
    const d = this.dialog;
    const me = this.me;
    const daily = $('[data-daily]', d);
    daily.disabled = !me?.daily;
    $('[data-daily-hint]', d).textContent = !X.ctx.state.user ? 'Zum Sammeln anmelden.'
      : me?.daily ? 'Einmal pro Tag gratis – hol es dir!' : 'Dein Gratis-Pack für heute hast du schon. Morgen gibt es ein neues.';
    $('[data-grant]', d).hidden = !X.api.demo;
    const src = { daily: '🎁 Gratis-Pack', twitch: '💜 Kanalpunkte', admin: '🎉 Geschenk' };
    fill($('[data-packs]', d), me?.packs ?? [], (p) => h('li', { class: 'cd-pack' },
      h('span', { class: 'cd-pack-art' }, '📦'), h('span', {}, h('b', {}, src[p.source] ?? 'Pack'), h('small', {}, timeOf(p.created_at))),
      h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: (e) => act(e.currentTarget, () => this.openPack(p.id)) }, 'Öffnen')),
    'Keine ungeöffneten Packs. Per Kanalpunkte im Twitch-Chat gibt es mehr (mit Twitch anmelden, damit sie hier ankommen).');
  },

  render() {
    const d = this.dialog;
    paintNote(d, this);
    const admin = isAdmin() && this.on;
    $('.cd-tabs [data-tab="admin"]', d).hidden = !admin;
    if (this.tab === 'admin' && !admin) this.tab = 'packs';
    $$('.cd-tabs [data-tab]', d).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === this.tab)));
    $$('.cd-pane', d).forEach((p) => { p.hidden = p.dataset.pane !== this.tab || !this.on; });
    const incoming = this.trades.filter((t) => t.to_key === this.me?.key);
    $('[data-trade-badge]', d).textContent = incoming.length ? `(${incoming.length})` : '';
    if (!this.on) return;
    const owned = this.ownedMap();
    if (this.tab === 'packs') this.renderPacks();
    if (this.tab === 'collection') {
      const sorted = [...this.defs].sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
      $('[data-progress]', d).textContent = `${owned.size} von ${this.defs.length} Karten · ${[...owned.values()].reduce((s, n) => s + n, 0)} insgesamt`;
      $('[data-collection]', d).replaceChildren(...sorted.map((c) => this.cardEl(c, { count: owned.get(c.id) ?? 0, known: owned.has(c.id) })));
    }
    if (this.tab === 'board') this.renderBoard();
    if (this.tab === 'trades') this.renderTrades();
    if (this.tab === 'admin') this.renderAdmin();
  },

  async renderBoard() {
    const d = this.dialog;
    this.board = await X.api.cards.leaderboard().catch(() => []);
    fill($('[data-board]', d), this.board, (r) => h('li', {},
      h('button', { class: 'cd-board-btn', type: 'button', onclick: () => this.showPlayer(r) }, h('b', {}, r.name || 'Anonym'), h('span', {}, `${r.uniq} / ${this.defs.length} · ${r.total} Karten`))),
    'Noch sammelt niemand.');
  },

  // Sammlung von jemand anderem – Karte wählen, die man haben will
  async showPlayer(player) {
    const d = this.dialog;
    const view = $('[data-view]', d);
    view.hidden = false;
    $('[data-view-title]', d).textContent = `Sammlung von ${player.name || 'Anonym'}`;
    const theirs = await X.api.cards.collection(player.player_key);
    const mine = this.ownedMap();
    $('[data-view-grid]', d).replaceChildren(...theirs.map((o) => {
      const c = this.def(o.card_id);
      if (!c) return null;
      return this.cardEl(c, { count: o.count, small: true, onclick: player.player_key === this.me?.key ? null : () => this.offer(player, c, mine) });
    }).filter(Boolean));
    view.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  offer(player, want, mine) {
    const d = this.dialog;
    const mineList = [...mine].map(([id, count]) => ({ c: this.def(id), count })).filter((x) => x.c);
    if (!mineList.length) { toast('Du hast noch keine Karten zum Tauschen.', 'info'); return; }
    const grid = $('[data-view-grid]', d);
    grid.replaceChildren(
      h('p', { class: 'cd-offer-title' }, `Du möchtest „${want.name}“. Welche Karte gibst du dafür?`),
      ...mineList.map(({ c, count }) => this.cardEl(c, {
        count, small: true,
        onclick: (e) => act(e.currentTarget, async () => {
          await X.api.cards.offer(player.player_key, c.id, want.id);
          toast('Angebot geschickt! Sobald es angenommen wird, tauscht ihr.', 'ok');
          await this.loadTrades();
          this.showPlayer(player);
        }),
      })),
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => this.showPlayer(player) }, 'Zurück'),
    );
  },

  renderTrades() {
    const d = this.dialog;
    const name = (id) => this.def(id)?.name ?? '?';
    const incoming = this.trades.filter((t) => t.to_key === this.me?.key);
    const outgoing = this.trades.filter((t) => t.from_key === this.me?.key);
    const done = async () => { await this.loadMe(); this.render(); };
    fill($('[data-incoming]', d), incoming, (t) => h('li', { class: 'x-item' },
      h('span', { class: 'x-item-main' }, h('b', {}, `${t.from_name || 'Jemand'} bietet „${name(t.give_card)}“`), h('small', {}, `für deine „${name(t.want_card)}“`)),
      h('span', { class: 'x-item-actions' },
        h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { const r = await X.api.cards.answer(t.id, true); toast(r.status === 'accepted' ? 'Getauscht!' : 'Geht nicht mehr – eine der Karten ist weg.', r.status === 'accepted' ? 'ok' : 'info'); await done(); }) }, '✅ Tauschen'),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await X.api.cards.answer(t.id, false); await done(); }) }, '❌'))),
    'Keine Angebote an dich.');
    fill($('[data-outgoing]', d), outgoing, (t) => h('li', { class: 'x-item' },
      h('span', { class: 'x-item-main' }, h('b', {}, `„${name(t.give_card)}“ gegen „${name(t.want_card)}“`), h('small', {}, `an ${t.to_name || 'jemand'} · wartet`)),
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await X.api.cards.answer(t.id, false); await done(); }) }, 'Zurückziehen')),
    'Keine offenen Angebote. Tauschen geht über die Rangliste: Namen anklicken.');
  },

  renderAdmin() {
    const d = this.dialog;
    fill($('[data-defs]', d), [...this.defs].sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)), (c) => h('li', { class: `x-item${c.active ? '' : ' is-off'}` },
      this.cardEl(c, { small: true }),
      h('span', { class: 'x-item-main' }, h('b', {}, c.name), h('small', {}, `${RARITY_LABEL[c.rarity]}${c.active ? '' : ' · wird nicht gezogen'}`)),
      h('span', { class: 'x-item-actions' },
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => this.edit(c) }, '✏️'),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', title: 'Löschen',
          onclick: (e) => {
            if (!confirm(`„${c.name}“ löschen? Sie verschwindet aus allen Sammlungen. (Lieber „Kann gezogen werden“ ausschalten.)`)) return;
            act(e.currentTarget, async () => { await X.api.cards.remove(c); this.defs = this.defs.filter((x) => x.id !== c.id); this.render(); });
          },
        }, '🗑'))), 'Noch keine Karten.');
    const form = $('[data-settings]', d);
    if (this.settings && !form.contains(document.activeElement)) {
      form.size.value = this.settings.pack_size;
      form.daily.checked = this.settings.daily;
      this.settings.weights.forEach((w, i) => { form[`w${i}`].value = w; });
    }
    this.paintReward?.();
  },

  tileStatus() {
    if (!this.on) return '🃏 Sammle sie alle';
    const packs = this.me?.packs?.length ?? 0;
    if (packs) return `📦 ${packs} ${packs === 1 ? 'Pack wartet' : 'Packs warten'}!`;
    if (this.me?.daily) return '🎁 Gratis-Pack abholen!';
    const owned = this.ownedMap().size;
    return owned ? `🃏 ${owned} / ${this.defs.length} gesammelt` : '🃏 Sammle sie alle';
  },

  async open() {
    if (!openFeature(this)) return;
    $('[data-reveal]', this.dialog).hidden = true;
    $('[data-view]', this.dialog).hidden = true;
    this.render();
    await this.load();
    if (this.me?.packs?.length || this.me?.daily) this.tab = 'packs';
    this.render();
  },
};
