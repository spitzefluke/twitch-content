// Umfrage: Streamer und Mods stellen eine Frage mit 2–5 Antworten (optional mit Zeitlimit).
// Abgestimmt wird im Twitch-Panel unter dem Stream, mit „!vote 2“ im Chat oder hier auf der Seite –
// jeder hat eine Stimme und kann sie bis zum Ende ändern. Migration …_polls.sql.
import { $, X, act, clock, fill, h, isAdmin, makeDialog, onSubmit, onTick, openFeature, paintTile, secondsUntil, timeOf, toast } from './extras-core.js';

const DURATIONS = [0, 1, 2, 3, 5, 10, 15, 30, 60];
const MAX_OPTIONS = 5;
const pct = (n, total) => (total ? Math.round((100 * n) / total) : 0);

export const poll = {
  kind: 'poll', icon: '📊', cta: 'Abstimmen →',
  on: false, error: '', p: null, mine: null, history: [], subscribed: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-poll', cls: 'x-poll', eyebrow: 'Twitch-Panel · Chat (!vote) · hier', title: 'Umfrage',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero pl-hero">
            <span class="pl-state" data-state aria-live="polite"></span>
            <b class="pl-q" data-question></b>
            <div class="pl-opts" data-opts role="group"></div>
            <p class="pl-sub" data-sub></p>
          </div>
          <div data-history-box hidden>
            <h3 class="prank-h3">🗂️ Letzte Umfragen</h3>
            <ul class="x-list pl-history" data-history></ul>
          </div>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Steuern</h3>
            <div class="x-row">
              <button class="btn btn--primary btn--sm" type="button" data-end>⏹ Jetzt beenden</button>
              <button class="btn btn--ghost btn--sm" type="button" data-hide>Ausblenden</button>
            </div>
            <button class="btn btn--outline btn--sm" type="button" data-test hidden>🗳️ 10 Test-Stimmen (Demo)</button>
            <p class="form-hint" data-admin-hint></p>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Neue Umfrage</h3>
            <form class="x-form" data-start>
              <label class="field"><span>Frage</span><input type="text" name="question" maxlength="120" required placeholder="z. B. Was spielen wir als Nächstes?"></label>
              <div class="pl-inputs" data-inputs></div>
              <div class="x-row">
                <button class="btn btn--ghost btn--sm" type="button" data-more>＋ Antwort</button>
                <button class="btn btn--ghost btn--sm" type="button" data-yesno>Ja / Nein</button>
              </div>
              <label class="field"><span>Dauer</span><select name="minutes"></select></label>
              <label class="toggle"><input type="checkbox" name="chat" checked><span class="toggle-ui" aria-hidden="true"></span>Abstimmen im Chat mit !vote (Bot kündigt an und nennt das Ergebnis)</label>
              <button class="btn btn--primary btn--sm" type="submit">📊 Umfrage starten</button>
              <p class="form-hint">Läuft schon eine, wird sie beendet und ihr Ergebnis gemerkt. Im Stream zeigt sie die OBS-Ebene „Umfrage“, unter dem Stream das Twitch-Panel.</p>
            </form>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    d.querySelector('[name=minutes]').replaceChildren(...DURATIONS.map((m) => new Option(m ? `${m} ${m === 1 ? 'Minute' : 'Minuten'}` : 'bis ich beende', String(m))));
    this.setInputs(['', '']);
    const reload = async () => { await this.load(); this.render(); };
    $('[data-more]', d).addEventListener('click', () => {
      const vals = this.inputValues();
      if (vals.length < MAX_OPTIONS) this.setInputs([...vals, ''], vals.length);
    });
    $('[data-yesno]', d).addEventListener('click', () => this.setInputs(['Ja', 'Nein']));
    onSubmit($('[data-start]', d), async (form) => {
      const options = this.inputValues().map((v) => v.trim()).filter(Boolean);
      if (options.length < 2) throw new Error('Mindestens zwei Antworten eintragen.');
      if (this.p?.status === 'open' && !confirm('Es läuft schon eine Umfrage. Beenden und die neue starten?')) return;
      this.p = await X.api.poll.start({ question: form.question.value, options, minutes: Number(form.minutes.value), chat: form.chat.checked });
      toast('Umfrage läuft – abstimmen im Panel, im Chat oder hier.', 'ok');
      form.question.value = '';
      this.setInputs(['', '']);
      await reload();
    });
    $('[data-end]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { this.p = await X.api.poll.close(); await reload(); }, 'Umfrage beendet.'));
    $('[data-hide]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { this.p = await X.api.poll.hide(); await reload(); }));
    $('[data-test]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { await X.api.poll.addTest(10); await reload(); }));
    // Countdown, und wenn er abläuft: beenden lassen (passiert auch im Overlay und Panel)
    onTick(() => {
      if (!this.p || this.p.status !== 'open' || !this.p.ends_at) return;
      const left = secondsUntil(this.p.ends_at);
      if (this.dialog.open) $('[data-state]', d).textContent = left > 0 ? `⏳ noch ${clock(left)}` : '⏳ Zeit um …';
      if (left === 0 && !this.ticking) {
        this.ticking = true;
        X.api.poll.tick().catch(() => {}).then(() => this.load()).then(() => { this.ticking = false; if (this.dialog.open) this.render(); });
      }
    });
  },

  inputValues() {
    return [...this.dialog.querySelectorAll('[data-inputs] input')].map((i) => i.value);
  },

  setInputs(values, focus = -1) {
    const box = $('[data-inputs]', this.dialog);
    box.replaceChildren(...values.map((v, i) => h('label', { class: 'field pl-field' },
      h('span', {}, `Antwort ${i + 1}${i < 2 ? '' : ' (optional)'}`),
      h('input', { type: 'text', maxlength: '60', value: v, required: i < 2, placeholder: i === 0 ? 'z. B. Fortnite' : i === 1 ? 'z. B. Minecraft' : '' }))));
    $('[data-more]', this.dialog).hidden = values.length >= MAX_OPTIONS;
    if (focus >= 0) box.querySelectorAll('input')[focus + 1]?.focus();
  },

  async load() {
    try {
      const p = await X.api.poll.get();
      const [mine, history] = await Promise.all([
        p?.status === 'open' && X.ctx.state.user ? X.api.poll.me().catch(() => null) : null,
        X.ctx.state.user ? X.api.poll.history().catch(() => []) : [],
      ]);
      Object.assign(this, { p: p ?? { status: 'idle', options: [], counts: [], total: 0 }, mine, history, on: true, error: '' });
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      let timer = 0;
      X.api.on('polls', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => { await this.load(); if (this.dialog.open) this.render(); }, 250);
      });
    }
    paintTile(this);
  },

  async vote(btn, choice) {
    await act(btn, async () => {
      const res = await X.api.poll.vote(choice);
      if (!res?.ok) {
        const why = { closed: 'Die Umfrage ist schon vorbei.', paused: 'Gerade pausiert (Raid-Schutz).', choice: 'Diese Antwort gibt es nicht.' };
        throw new Error(why[res?.reason] ?? 'Hat nicht geklappt.');
      }
      this.mine = res.choice;
      if (res.counts) Object.assign(this.p, { counts: res.counts, total: res.total });
      this.render();
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
        ? `Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20261105000000_polls.sql ausführen.${this.error ? ` (${this.error})` : ''}`
        : 'Umfragen sind noch nicht eingerichtet. Schau später noch mal vorbei.';
      return;
    }
    const p = this.p;
    const open = p.status === 'open' && !(p.ends_at && secondsUntil(p.ends_at) === 0);
    const shown = p.status !== 'idle' && (p.options ?? []).length > 0;
    $('[data-state]', d).textContent = !shown ? '' : open ? (p.ends_at ? `⏳ noch ${clock(secondsUntil(p.ends_at))}` : '🟢 läuft') : '🏁 beendet';
    $('[data-question]', d).textContent = shown ? p.question : 'Gerade keine Umfrage.';
    const counts = p.counts ?? [];
    const best = Math.max(0, ...counts);
    const canVote = open && !!X.ctx.state.user;
    const opts = $('[data-opts]', d);
    opts.setAttribute('aria-label', shown ? p.question : 'Antworten');
    opts.replaceChildren(...(shown ? p.options : []).map((label, i) => {
      const n = counts[i] ?? 0;
      const mine = this.mine === i + 1;
      return h('button', {
        type: 'button',
        class: `pl-opt${mine ? ' is-mine' : ''}${!open && n === best && n > 0 ? ' is-win' : ''}`,
        style: { '--p': `${pct(n, p.total)}%` },
        'aria-pressed': String(mine),
        disabled: !canVote,
        onclick: (e) => { if (!mine) this.vote(e.currentTarget, i + 1); },
      }, h('span', { class: 'pl-n' }, String(i + 1)), h('span', { class: 'pl-label' }, label),
      h('span', { class: 'pl-pct' }, `${pct(n, p.total)} %`), h('small', { class: 'pl-count' }, `${n}`));
    }));
    $('[data-sub]', d).textContent = !shown
      ? (admin ? 'Unter „Neue Umfrage“ eine Frage stellen – sie erscheint sofort im Panel und (wenn eingeschaltet) im Overlay.' : 'Sobald der Streamer eine Frage stellt, kannst du hier abstimmen.')
      : `${p.total} ${p.total === 1 ? 'Stimme' : 'Stimmen'}${open && p.chat_vote ? ` · im Chat: !vote 1–${p.options.length}` : ''}${open && !X.ctx.state.user ? ' · zum Abstimmen anmelden' : ''}${this.mine ? ' · deine Stimme ist gezählt' : ''}`;

    $('[data-history-box]', d).hidden = !this.history.length;
    fill($('[data-history]', d), this.history, (r) => {
      const top = Math.max(0, ...r.counts);
      return h('li', { class: 'x-item pl-past' },
        h('div', {},
          h('b', {}, r.question),
          h('small', {}, `${new Date(r.closed_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} · ${timeOf(r.closed_at)} Uhr · ${r.total} ${r.total === 1 ? 'Stimme' : 'Stimmen'}`)),
        h('span', { class: 'pl-past-res' }, ...r.options.map((o, i) => h('span', { class: r.counts[i] === top && top > 0 ? 'is-win' : '' }, `${o} ${pct(r.counts[i], r.total)} %`))));
    });

    if (!admin) return;
    $('[data-end]', d).hidden = !open;
    $('[data-hide]', d).hidden = !shown;
    $('[data-test]', d).hidden = !(X.ctx.state.api.demo && open);
    $('[data-admin-hint]', d).textContent = !shown
      ? 'Keine Umfrage aktiv.'
      : open ? `Gestartet um ${timeOf(p.opened_at)} Uhr.${p.chat_vote ? ' Der Bot hat sie im Chat angekündigt.' : ''}`
        : 'Beendet – das Ergebnis bleibt im Panel und Overlay stehen, bis du „Ausblenden“ drückst.';
  },

  tileStatus() {
    const p = this.p;
    if (!this.on || !p || p.status === 'idle' || !(p.options ?? []).length) return '📊 Der Chat entscheidet';
    if (p.status === 'open') return `📊 Läuft · ${p.total} ${p.total === 1 ? 'Stimme' : 'Stimmen'}`;
    const best = Math.max(...p.counts);
    return `🏁 ${p.options[p.counts.indexOf(best)] ?? ''} gewinnt`;
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};
