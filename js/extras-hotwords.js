// Hot Words: Die (höchstens) 5 Wörter, die im Twitch-Chat am häufigsten geschrieben werden – mit Zähler.
// Gezählt wird in der Edge Function twitch-eventsub (Chat-Bot liest mit), Migration …_hotwords.sql.
// Streamer und Mods können Wörter sperren, neu anfangen und einstellen, wie viele Wörter zu sehen sind.
import { $, X, act, fill, h, isAdmin, makeDialog, openFeature, paintTile, timeOf, toast } from './extras-core.js';

const MEDALS = ['🥇', '🥈', '🥉', '4', '5'];

export const hotwords = {
  kind: 'hotwords', icon: '🔥', cta: 'Hot Words →',
  on: false, error: '', hw: null, counts: [], blocks: [], subscribed: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-hotwords', cls: 'x-hotwords', eyebrow: 'Live aus dem Twitch-Chat', title: 'Hot Words',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero hw-hero">
            <span class="hw-flame" aria-hidden="true">🔥</span>
            <ol class="hw-top" data-top aria-live="polite"></ol>
            <p class="hw-sub" data-sub></p>
          </div>
          <h3 class="prank-h3">Alle Wörter <small data-total></small></h3>
          <ul class="x-list x-list--compact hw-list" data-counts></ul>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Einstellungen</h3>
            <form class="x-form" data-settings>
              <label class="toggle"><input type="checkbox" name="enabled"><span class="toggle-ui" aria-hidden="true"></span>Wörter im Chat zählen</label>
              <label class="field"><span>Wie viele Wörter zeigen?</span><select name="max">
                <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>
              </select></label>
              <label class="field"><span>Wörter zählen ab</span><select name="min">
                <option value="2">2 Buchstaben</option><option value="3">3 Buchstaben</option><option value="4">4 Buchstaben</option><option value="5">5 Buchstaben</option><option value="6">6 Buchstaben</option>
              </select></label>
            </form>
            <div class="x-row">
              <button class="btn btn--ghost btn--sm" type="button" data-reset>🔄 Neu anfangen</button>
              <button class="btn btn--outline btn--sm" type="button" data-test hidden>💬 Test-Chat (Demo)</button>
            </div>
            <p class="form-hint">Gezählt wird, was im Twitch-Chat steht (der Chat-Bot muss verbunden sein). Füllwörter wie „und“ oder „ich“, Befehle, Links und @Namen zählen nicht; dasselbe Wort zählt pro Person höchstens einmal pro Minute.</p>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">🚫 Gesperrt <small>zählen nie</small></h3>
            <form class="x-form x-row" data-block>
              <input type="text" name="word" maxlength="30" placeholder="Wort sperren …" autocomplete="off" aria-label="Wort sperren">
              <button class="btn btn--outline btn--sm" type="submit">Sperren</button>
            </form>
            <ul class="x-list x-list--compact" data-blocks></ul>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    const reload = async () => { await this.load(); this.render(); };
    $('[data-settings]', d).addEventListener('change', async (e) => {
      const f = e.currentTarget;
      try {
        this.hw = await X.api.hotwords.settings({ enabled: f.enabled.checked, maxWords: Number(f.max.value), minLength: Number(f.min.value) });
        toast('Gespeichert.', 'ok', 2000);
      } catch (err) {
        toast(X.ctx.germanError(err), 'error');
      }
      await reload();
    });
    $('[data-reset]', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
      if (!confirm('Alle Zähler auf 0 setzen? Die Hot Words fangen von vorne an.')) return;
      this.hw = await X.api.hotwords.reset();
      await reload();
    }));
    $('[data-test]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { await X.api.hotwords.addTest(8); await reload(); }));
    $('[data-block]', d).addEventListener('submit', (e) => {
      e.preventDefault();
      const input = e.currentTarget.word;
      const word = input.value.trim();
      if (!word) return;
      act(e.submitter, async () => {
        await X.api.hotwords.block(word, true);
        input.value = '';
        await reload();
        toast(`„${word}“ ist gesperrt.`, 'ok');
      });
    });
  },

  async load() {
    try {
      const hw = await X.api.hotwords.get();
      if (!hw) throw new Error('Tabelle hotwords fehlt.');
      const [counts, blocks] = await Promise.all([
        X.api.hotwords.counts(40).catch(() => []),
        isAdmin() ? X.api.hotwords.blocks().catch(() => []) : [],
      ]);
      Object.assign(this, { hw, counts, blocks, on: true, error: '' });
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      let timer = 0;
      X.api.on('hotwords', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => { await this.load(); if (this.dialog.open) this.render(); }, 300);
      });
    }
    paintTile(this);
  },

  async block(btn, word, block) {
    await act(btn, async () => {
      await X.api.hotwords.block(word, block);
      await this.load();
      this.render();
      toast(block ? `„${word}“ ist gesperrt und verschwindet.` : `„${word}“ zählt wieder.`, 'ok');
    });
  },

  render() {
    const d = this.dialog;
    const admin = isAdmin() && this.on;
    $('[data-admin]', d).hidden = !admin;
    d.classList.toggle('has-side', admin);
    const note = $('[data-note]', d);
    note.hidden = this.on;
    if (!this.on) {
      note.textContent = isAdmin()
        ? `Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20261026000000_hotwords.sql ausführen.${this.error ? ` (${this.error})` : ''}`
        : 'Hot Words sind noch nicht eingerichtet. Schau später noch mal vorbei.';
      return;
    }
    const hw = this.hw;
    const top = hw.top ?? [];
    const max = Math.max(1, ...top.map((t) => t.n));
    fill($('[data-top]', d), top, (t, i) => h('li', { class: 'hw-row', style: { '--p': (t.n / max).toFixed(3) } },
      h('span', { class: 'hw-rank' }, MEDALS[i] ?? String(i + 1)),
      h('b', { class: 'hw-word' }, t.w),
      h('span', { class: 'hw-n' }, `${t.n}×`)),
    hw.enabled ? 'Noch keine Wörter – sobald der Chat schreibt, geht’s los.' : 'Hot Words sind gerade aus.');
    $('[data-sub]', d).textContent = hw.enabled
      ? `${hw.max_words === 1 ? 'Das häufigste Wort' : `Die ${hw.max_words} häufigsten Wörter`} im Chat seit ${timeOf(hw.started_at)} Uhr${new Date(hw.started_at).toDateString() === new Date().toDateString() ? '' : ` (${new Date(hw.started_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })})`}.`
      : 'Zählen ist ausgeschaltet.';

    const counts = this.counts;
    $('[data-total]', d).textContent = counts.length ? `· ${counts.length >= 40 ? 'die 40 häufigsten' : counts.length}` : '';
    fill($('[data-counts]', d), counts, (c) => h('li', { class: 'x-item' },
      h('b', {}, c.label),
      h('span', { class: 'x-item-actions' },
        h('small', {}, `${c.n}×`),
        admin && h('button', {
          type: 'button', class: 'btn btn--ghost btn--sm hw-block', title: `„${c.label}“ sperren`, 'aria-label': `„${c.label}“ sperren`,
          onclick: (ev) => this.block(ev.currentTarget, c.word, true),
        }, '🚫'))),
    'Noch nichts gezählt.');

    if (!admin) return;
    const f = $('[data-settings]', d);
    if (!f.contains(document.activeElement)) {
      f.enabled.checked = hw.enabled;
      f.max.value = String(hw.max_words);
      f.min.value = String(hw.min_length);
    }
    $('[data-test]', d).hidden = !X.ctx.state.api.demo;
    fill($('[data-blocks]', d), this.blocks, (b) => h('li', { class: 'x-item is-off' },
      h('b', {}, b.word),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: (ev) => this.block(ev.currentTarget, b.word, false) }, '↩ Freigeben')),
    'Nichts gesperrt.');
  },

  tileStatus() {
    const top = this.hw?.top ?? [];
    if (!this.on || !this.hw) return '🔥 Was schreibt der Chat am meisten?';
    if (!this.hw.enabled) return '🔥 Gerade aus';
    return top.length ? `🔥 ${top[0].w} · ${top[0].n}×` : '🔥 Noch keine Wörter';
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};
