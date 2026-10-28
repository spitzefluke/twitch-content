// Rubbellos: „!rubbeln“ im Chat zieht ein Los – Shoutout, Sound, Spiel aussuchen oder eine Niete.
// Gewinne und ihre Häufigkeit stellen Streamer und Mods hier ein; das Overlay (Ebene „Rubbellos“) rubbelt
// das Los live frei, der Bot schreibt das Ergebnis. Es gibt kein Geld – Gewinne löst der Streamer selbst ein.
// Migration …_bet_scratch.sql.
import { $, X, act, fill, h, isAdmin, makeDialog, onSubmit, openFeature, paintTile, timeOf, toast } from './extras-core.js';

const MAX_PRIZES = 12;
const WHO = { all: 'alle Zuschauer', subs: 'Abos, VIPs und Mods', mods: 'nur Mods' };

export const scratch = {
  kind: 'scratch', icon: '🎟️', cta: 'Rubbeln →',
  on: false, error: '', cfg: null, draws: [], subscribed: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-scratch', cls: 'x-scratch', eyebrow: 'Chat (!rubbeln) · Overlay', title: 'Rubbellos',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero sc-hero">
            <div class="sc-ticket" data-ticket>
              <span class="sc-ticket-head">RUBBELLOS</span>
              <span class="sc-ticket-emoji" data-emoji aria-hidden="true">🎟️</span>
              <b class="sc-ticket-label" data-label>Schreib !rubbeln in den Chat</b>
              <small class="sc-ticket-who" data-who></small>
            </div>
            <p class="pl-sub" data-sub></p>
            <div class="x-row" data-admin-actions hidden>
              <button class="btn btn--primary btn--sm" type="button" data-test>🎟️ Probe-Los ziehen</button>
              <button class="btn btn--outline btn--sm" type="button" data-sim hidden>💬 Zuschauer rubbelt (Demo)</button>
              <button class="btn btn--ghost btn--sm" type="button" data-open-obs>OBS-Editor öffnen</button>
            </div>
          </div>
          <section class="bingo-box">
            <h3 class="prank-h3">🗂️ Letzte Lose</h3>
            <ul class="x-list sc-list" data-draws></ul>
          </section>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Einstellungen</h3>
            <form class="x-form" data-form>
              <label class="toggle"><input type="checkbox" name="enabled"><span class="toggle-ui" aria-hidden="true"></span>!rubbeln im Chat an</label>
              <label class="field"><span>Wer darf rubbeln?</span>
                <select name="who"><option value="all">Alle Zuschauer</option><option value="subs">Abos, VIPs und Mods</option><option value="mods">Nur Mods</option></select></label>
              <label class="field"><span>Pause je Zuschauer (Minuten, 0 = keine)</span><input type="number" name="cooldown" min="0" max="1440" step="1" required></label>
              <fieldset class="cup-prizes">
                <legend>Gewinne <small class="pl-sub">(Häufigkeit = Gewicht, die Chance steht daneben)</small></legend>
                <div class="sc-prizes" data-prizes></div>
                <button class="btn btn--ghost btn--sm" type="button" data-add>＋ Gewinn</button>
              </fieldset>
              <button class="btn btn--primary btn--sm" type="submit">Speichern</button>
              <p class="form-hint">„Gewinn“ aus = Niete (der Bot schreibt dann nicht „der Streamer löst ein“). Bitte keine Geld- oder Sachpreise versprechen, die du nicht selbst einlöst.</p>
            </form>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    $('[data-add]', d).addEventListener('click', () => {
      const list = this.readPrizes();
      if (list.length < MAX_PRIZES) this.setPrizes([...list, { emoji: '🎁', label: '', weight: 10, win: true }], list.length);
    });
    $('[data-prizes]', d).addEventListener('input', () => this.paintChances());
    onSubmit($('[data-form]', d), async (form) => {
      const prizes = this.readPrizes().filter((p) => p.label.trim());
      if (!prizes.length) throw new Error('Mindestens einen Gewinn eintragen.');
      this.cfg = await X.api.scratch.save({ enabled: form.enabled.checked, who: form.who.value, cooldown: Number(form.cooldown.value), prizes });
      toast('Rubbellos gespeichert.', 'ok');
      this.fillForm();
      paintTile(this);
    });
    $('[data-test]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { await X.api.scratch.test(); await this.reload(); }));
    $('[data-sim]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { await X.api.scratch.simulate(); await this.reload(); }));
  },

  readPrizes() {
    return [...this.dialog.querySelectorAll('[data-prizes] .sc-prize')].map((row) => ({
      emoji: row.querySelector('[name=emoji]').value.trim(),
      label: row.querySelector('[name=label]').value,
      weight: Math.max(0, Math.round(Number(row.querySelector('[name=weight]').value) || 0)),
      win: row.querySelector('[name=win]').checked,
    }));
  },

  setPrizes(list, focus = -1) {
    const box = $('[data-prizes]', this.dialog);
    box.replaceChildren(...list.map((p, i) => h('div', { class: 'sc-prize' },
      h('input', { type: 'text', name: 'emoji', value: p.emoji ?? '', maxlength: '8', 'aria-label': `Emoji für Gewinn ${i + 1}`, class: 'sc-emoji' }),
      h('input', { type: 'text', name: 'label', value: p.label ?? '', maxlength: '60', required: true, 'aria-label': `Gewinn ${i + 1}`, placeholder: 'z. B. Shoutout vom Streamer' }),
      h('div', { class: 'sc-meta' },
        h('label', { class: 'sc-weight-wrap' }, h('span', {}, 'Häufigkeit'),
          h('input', { type: 'number', name: 'weight', value: String(p.weight ?? 0), min: '0', max: '1000', step: '1', class: 'sc-weight' })),
        h('label', { class: 'sc-win', title: 'Gewinn (aus = Niete)' }, h('input', { type: 'checkbox', name: 'win', checked: p.win !== false }), h('span', {}, 'Gewinn')),
        h('small', { class: 'sc-chance', 'data-chance': '', title: 'Chance' })),
      h('button', {
        type: 'button', class: 'icon-btn sc-del', 'aria-label': `Gewinn ${i + 1} löschen`,
        onclick: () => { const rest = this.readPrizes(); rest.splice(i, 1); this.setPrizes(rest.length ? rest : [{ emoji: '🍀', label: '', weight: 1, win: false }]); },
      }, '×'))));
    $('[data-add]', this.dialog).hidden = list.length >= MAX_PRIZES;
    if (focus >= 0) box.querySelectorAll('[name=label]')[focus]?.focus();
    this.paintChances();
  },

  paintChances() {
    const rows = [...this.dialog.querySelectorAll('[data-prizes] .sc-prize')];
    const weights = this.readPrizes().map((p) => p.weight);
    const sum = weights.reduce((a, b) => a + b, 0);
    rows.forEach((row, i) => {
      const share = sum ? (100 * weights[i]) / sum : 0;
      row.querySelector('[data-chance]').textContent = `${share >= 10 ? Math.round(share) : Math.round(share * 10) / 10} %`.replace('.', ',');
    });
  },

  fillForm() {
    const form = $('[data-form]', this.dialog);
    const c = this.cfg;
    if (!c) return;
    form.enabled.checked = !!c.enabled;
    form.who.value = c.who;
    form.cooldown.value = String(c.cooldown_min);
    this.setPrizes(c.prizes ?? []);
  },

  async reload() {
    this.draws = await X.api.scratch.draws(12).catch(() => this.draws);
    if (this.dialog.open) this.render();
    paintTile(this);
  },

  async load() {
    try {
      this.draws = (await X.api.scratch.draws(12)) ?? [];
      this.cfg = isAdmin() ? await X.api.scratch.get() : null;
      Object.assign(this, { on: true, error: '' });
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      let timer = 0;
      X.api.on('scratch_draws', () => { clearTimeout(timer); timer = setTimeout(() => this.reload(), 250); });
    }
    paintTile(this);
  },

  render() {
    const d = this.dialog;
    const admin = isAdmin() && this.on;
    $('[data-admin]', d).hidden = !admin;
    $('[data-admin-actions]', d).hidden = !admin;
    d.classList.toggle('has-side', admin);
    const note = $('[data-note]', d);
    note.hidden = this.on;
    if (!this.on) {
      note.textContent = isAdmin()
        ? `Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20261201000000_bet_scratch.sql ausführen.${this.error ? ` (${this.error})` : ''}`
        : 'Das Rubbellos ist noch nicht eingerichtet. Schau später noch mal vorbei.';
      return;
    }
    const last = this.draws[0];
    const ticket = $('[data-ticket]', d);
    ticket.classList.toggle('is-win', !!last?.win);
    ticket.classList.toggle('is-empty', !last);
    $('[data-emoji]', d).textContent = last?.emoji || '🎟️';
    $('[data-label]', d).textContent = last ? last.label : 'Schreib !rubbeln in den Chat';
    $('[data-who]', d).textContent = last ? `${last.source === 'test' ? 'Probe-Los' : last.name || 'Zuschauer'} · ${timeOf(last.created_at)} Uhr` : '';
    const c = this.cfg;
    $('[data-sub]', d).textContent = c
      ? (c.enabled
        ? `!rubbeln, !rubbellos oder !los im Chat – erlaubt für ${WHO[c.who]}${c.cooldown_min ? `, ein Los alle ${c.cooldown_min} Minuten` : ', ohne Pause'}. Im Stream rubbelt die OBS-Ebene „Rubbellos“ frei.`
        : 'Gerade ausgeschaltet – der Bot reagiert nicht auf !rubbeln. Probe-Lose gehen trotzdem.')
      : 'Schreib !rubbeln in den Chat und schau, was du ziehst – im Stream wird das Los live freigerubbelt.';
    fill($('[data-draws]', d), this.draws, (r) => h('li', { class: `x-item sc-draw${r.win ? ' is-win' : ''}` },
      h('span', { class: 'sc-draw-emoji', 'aria-hidden': 'true' }, r.emoji || '🎟️'),
      h('span', { class: 'cup-name' }, h('b', {}, r.label), h('small', { class: 'pl-sub' }, `${r.source === 'test' ? 'Probe-Los' : r.name || 'Zuschauer'} · ${timeOf(r.created_at)} Uhr`))),
    'Noch keine Lose gezogen.');
    if (!admin) return;
    $('[data-sim]', d).hidden = !X.ctx.state.api.demo;
    if (!$('[data-prizes]', d).childElementCount) this.fillForm();
  },

  tileStatus() {
    if (!this.on) return '🎟️ Glück im Chat';
    if (this.cfg && !this.cfg.enabled) return '🎟️ Ausgeschaltet';
    const last = this.draws[0];
    return last ? `${last.emoji || '🎟️'} ${last.source === 'test' ? 'Probe' : last.name || 'Zuschauer'}: ${last.label}` : '🎟️ !rubbeln im Chat';
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.fillForm();
    this.render();
  },
};
