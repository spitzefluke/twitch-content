// Zuschauer-Wette: Streamer und Mods fragen „Schaffe ich den Boss im 1. Versuch?“ (2–4 Antworten).
// Getippt wird im Chat mit „!tipp 1“ / „!tipp ja“ oder hier auf der Seite – kostenlos, ohne Kanalpunkte.
// Bei der Auflösung bekommen alle mit dem richtigen Tipp Tipp-Punkte (je weniger richtig lagen, desto mehr).
// Migration …_bet_scratch.sql.
import { $, X, act, clock, fill, h, isAdmin, makeDialog, onSubmit, onTick, openFeature, paintTile, secondsUntil, timeOf, toast } from './extras-core.js';

const DURATIONS = [0, 1, 2, 3, 5, 10, 15, 30];
const MAX_OPTIONS = 4;
const pct = (n, total) => (total ? Math.round((100 * n) / total) : 0);
// Wie in bet_resolve: Tipps gesamt ÷ richtige Tipps, aufgerundet, 1–20
export const betQuote = (n, total) => (n ? Math.min(20, Math.max(1, Math.ceil(total / n))) : null);
const isOpen = (b) => b?.status === 'open' && !(b.lock_at && secondsUntil(b.lock_at) === 0);

export const bet = {
  kind: 'bet', icon: '🎯', cta: 'Mittippen →',
  on: false, error: '', b: null, mine: null, myPoints: 0, top: [], subscribed: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-bet', cls: 'x-bet', eyebrow: 'Chat (!tipp) · hier', title: 'Zuschauer-Wette',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero pl-hero bt-hero">
            <span class="pl-state" data-state aria-live="polite"></span>
            <b class="pl-q" data-question></b>
            <div class="pl-opts" data-opts role="group"></div>
            <p class="pl-sub" data-sub></p>
          </div>
          <section class="bingo-box">
            <h3 class="prank-h3">🏆 Tipp-Rangliste</h3>
            <p class="form-hint" data-me hidden></p>
            <ol class="x-list bt-top" data-top></ol>
            <p class="form-hint">Im Chat: <b>!tipp punkte</b> für die eigenen Punkte, <b>!tipp top</b> für die Rangliste.</p>
          </section>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box" data-control>
            <h3 class="prank-h3">Steuern</h3>
            <div class="x-row">
              <button class="btn btn--ghost btn--sm" type="button" data-lock>🔒 Tipps schließen</button>
              <button class="btn btn--ghost btn--sm" type="button" data-cancel>Abbrechen</button>
            </div>
            <p class="form-hint" data-resolve-hint>Was ist passiert? Richtige Antwort wählen:</p>
            <div class="x-row bt-resolve" data-resolve></div>
            <button class="btn btn--outline btn--sm" type="button" data-test hidden>🎯 8 Test-Tipps (Demo)</button>
            <p class="form-hint" data-admin-hint></p>
          </section>
          <section class="bingo-box" data-new>
            <h3 class="prank-h3">Neue Wette</h3>
            <form class="x-form" data-start>
              <label class="field"><span>Frage</span><input type="text" name="question" maxlength="120" required placeholder="z. B. Schaffe ich den Boss im 1. Versuch?"></label>
              <div class="pl-inputs" data-inputs></div>
              <div class="x-row">
                <button class="btn btn--ghost btn--sm" type="button" data-more>＋ Antwort</button>
                <button class="btn btn--ghost btn--sm" type="button" data-yesno>Ja / Nein</button>
              </div>
              <label class="field"><span>Tipps offen</span><select name="minutes"></select></label>
              <button class="btn btn--primary btn--sm" type="submit">🎯 Wette starten</button>
              <p class="form-hint">Der Bot kündigt sie im Chat an. Im Stream zeigt sie die OBS-Ebene „Zuschauer-Wette“ <button class="btn btn--ghost btn--sm" type="button" data-open-obs>OBS-Editor öffnen</button></p>
            </form>
          </section>
          <section class="bingo-box" data-owner hidden>
            <h3 class="prank-h3">Rangliste</h3>
            <button class="btn btn--ghost btn--sm" type="button" data-reset>Alle Tipp-Punkte löschen</button>
            <p class="form-hint">Zum Beispiel am Monatsanfang – das kann nicht rückgängig gemacht werden.</p>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    d.querySelector('[name=minutes]').replaceChildren(...DURATIONS.map((m) => new Option(m ? `${m} ${m === 1 ? 'Minute' : 'Minuten'}` : 'bis ich schließe', String(m))));
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
      this.b = await X.api.bet.start({ question: form.question.value, options, minutes: Number(form.minutes.value) });
      toast('Wette läuft – der Chat tippt mit !tipp.', 'ok');
      form.question.value = '';
      this.setInputs(['', '']);
      await reload();
    });
    $('[data-lock]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { this.b = await X.api.bet.lock(); await reload(); }, 'Tipps geschlossen.'));
    $('[data-cancel]', d).addEventListener('click', (e) => {
      const running = ['open', 'locked'].includes(this.b?.status);
      if (running && !confirm('Wette abbrechen? Niemand bekommt Punkte.')) return;
      act(e.currentTarget, async () => { this.b = await X.api.bet.cancel(); await reload(); });
    });
    $('[data-test]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { await X.api.bet.addTest(8); await reload(); }));
    $('[data-reset]', d).addEventListener('click', (e) => {
      if (!confirm('Wirklich alle Tipp-Punkte löschen?')) return;
      act(e.currentTarget, async () => { await X.api.bet.resetScores(); await reload(); }, 'Rangliste gelöscht.');
    });
    // Countdown bis „Tipps geschlossen“ – läuft er ab, schließen lassen (passiert auch im Overlay)
    onTick(() => {
      const b = this.b;
      if (!b || b.status !== 'open' || !b.lock_at) return;
      const left = secondsUntil(b.lock_at);
      if (this.dialog.open) $('[data-state]', d).textContent = left > 0 ? `⏳ Tipps noch ${clock(left)}` : '🔒 Zeit um …';
      if (left === 0 && !this.ticking) {
        this.ticking = true;
        X.api.bet.tick().catch(() => {}).then(() => this.load()).then(() => { this.ticking = false; if (this.dialog.open) this.render(); });
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
      h('input', { type: 'text', maxlength: '40', value: v, required: i < 2, placeholder: i === 0 ? 'z. B. Ja' : i === 1 ? 'z. B. Nein' : '' }))));
    $('[data-more]', this.dialog).hidden = values.length >= MAX_OPTIONS;
    if (focus >= 0) box.querySelectorAll('input')[focus + 1]?.focus();
  },

  async load() {
    try {
      const b = await X.api.bet.get();
      const [me, top] = await Promise.all([
        X.ctx.state.user ? X.api.bet.me().catch(() => null) : null,
        X.api.bet.top(10).catch(() => []),
      ]);
      Object.assign(this, {
        b: b ?? { status: 'idle', options: [], counts: [], total: 0 }, mine: me?.choice ?? null, myPoints: me?.points ?? 0,
        top: top ?? [], on: true, error: '',
      });
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      let timer = 0;
      X.api.on('bets', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => { await this.load(); if (this.dialog.open) this.render(); }, 250);
      });
    }
    paintTile(this);
  },

  async tip(btn, choice) {
    await act(btn, async () => {
      const res = await X.api.bet.tip(choice);
      if (!res?.ok) {
        const why = { closed: 'Die Tipps sind schon geschlossen.', paused: 'Gerade pausiert (Raid-Schutz).', choice: 'Diese Antwort gibt es nicht.' };
        throw new Error(why[res?.reason] ?? 'Hat nicht geklappt.');
      }
      this.mine = res.choice;
      if (res.counts) Object.assign(this.b, { counts: res.counts, total: res.total });
      this.render();
    });
  },

  async resolve(btn, winner, label) {
    if (!confirm(`„${label}“ ist richtig? Dann gibt es jetzt die Tipp-Punkte.`)) return;
    await act(btn, async () => { this.b = await X.api.bet.resolve(winner); await this.load(); this.render(); }, 'Aufgelöst – der Bot nennt das Ergebnis.');
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
        ? `Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20261201000000_bet_scratch.sql ausführen.${this.error ? ` (${this.error})` : ''}`
        : 'Die Zuschauer-Wette ist noch nicht eingerichtet. Schau später noch mal vorbei.';
      return;
    }
    const b = this.b;
    const open = isOpen(b);
    const running = ['open', 'locked'].includes(b.status);
    const shown = b.status !== 'idle' && (b.options ?? []).length > 0;
    const state = {
      open: b.lock_at ? `⏳ Tipps noch ${clock(secondsUntil(b.lock_at))}` : '🟢 Tipps offen',
      locked: '🔒 Tipps geschlossen – gleich kommt die Auflösung',
      resolved: '🏁 Aufgelöst', cancelled: '✖ Abgebrochen',
    };
    $('[data-state]', d).textContent = !shown ? '' : open ? state.open : b.status === 'open' ? state.locked : state[b.status] ?? '';
    $('[data-question]', d).textContent = shown ? b.question : 'Gerade keine Wette.';
    const counts = b.counts ?? [];
    const canTip = open && !!X.ctx.state.user;
    const opts = $('[data-opts]', d);
    opts.setAttribute('aria-label', shown ? b.question : 'Antworten');
    opts.replaceChildren(...(shown ? b.options : []).map((label, i) => {
      const n = counts[i] ?? 0;
      const mine = this.mine === i + 1;
      const q = betQuote(n, b.total);
      const win = b.status === 'resolved' && b.winner === i + 1;
      return h('button', {
        type: 'button',
        class: `pl-opt bt-opt${mine ? ' is-mine' : ''}${win ? ' is-win' : ''}${b.status === 'resolved' && !win ? ' is-lose' : ''}`,
        style: { '--p': `${pct(n, b.total)}%` },
        'aria-pressed': String(mine),
        disabled: !canTip,
        onclick: (e) => { if (!mine) this.tip(e.currentTarget, i + 1); },
      }, h('span', { class: 'pl-n' }, String(i + 1)), h('span', { class: 'pl-label' }, win ? `✅ ${label}` : label),
      h('span', { class: 'bt-quote', title: 'Tipp-Punkte, wenn diese Antwort stimmt' }, q ? `×${q}` : '–'),
      h('small', { class: 'pl-count' }, `${pct(n, b.total)} %`));
    }));
    const right = b.status === 'resolved' ? counts[b.winner - 1] ?? 0 : 0;
    $('[data-sub]', d).textContent = !shown
      ? (admin ? 'Unter „Neue Wette“ eine Frage stellen – der Chat tippt mit !tipp 1, !tipp 2 …' : 'Sobald der Streamer eine Wette startet, kannst du hier oder im Chat mittippen.')
      : b.status === 'resolved'
        ? `${right} von ${b.total} lagen richtig${right ? ` – je ${b.points} Tipp-Punkte` : ''}.${this.mine ? (this.mine === b.winner ? ' Du warst dabei! 🎉' : ' Diesmal nicht – nächste Runde!') : ''}`
        : `${b.total} ${b.total === 1 ? 'Tipp' : 'Tipps'}${open ? ` · im Chat: !tipp 1–${b.options.length}` : ''}${open && !X.ctx.state.user ? ' · zum Tippen anmelden' : ''}${this.mine ? ' · dein Tipp ist gezählt (änderbar, solange offen)' : ''} · ×Zahl = Tipp-Punkte bei Treffer`;

    const me = $('[data-me]', d);
    me.hidden = !X.ctx.state.user;
    me.textContent = `Du hast ${this.myPoints} Tipp-Punkte.`;
    fill($('[data-top]', d), this.top, (r, i) => h('li', { class: `x-item cup-row${i < 3 ? ` is-top is-top-${i + 1}` : ''}` },
      h('span', { class: 'cup-place' }, String(i + 1)),
      h('span', { class: 'cup-name' }, h('b', {}, r.name || 'Zuschauer'), h('small', { class: 'pl-sub' }, `${r.wins} von ${r.tips} richtig`)),
      h('span', { class: 'cup-points' }, String(r.points), h('small', {}, ' P'))), 'Noch keine Tipp-Punkte – nach der ersten Auflösung steht hier, wer am besten tippt.');

    if (!admin) return;
    $('[data-control]', d).hidden = !shown;
    $('[data-new]', d).hidden = running;
    $('[data-owner]', d).hidden = !X.ctx.state.access?.is_owner;
    $('[data-lock]', d).hidden = !open;
    $('[data-cancel]', d).textContent = running ? 'Abbrechen' : 'Ausblenden';
    $('[data-resolve-hint]', d).hidden = !running;
    $('[data-resolve]', d).replaceChildren(...(running ? b.options : []).map((label, i) => h('button', {
      type: 'button', class: 'btn btn--primary btn--sm', onclick: (e) => this.resolve(e.currentTarget, i + 1, label),
    }, `✅ ${label}`)));
    $('[data-test]', d).hidden = !(X.ctx.state.api.demo && open);
    $('[data-admin-hint]', d).textContent = !shown ? '' : running
      ? `Gestartet um ${timeOf(b.opened_at)} Uhr. Neue Wette erst nach Auflösen oder Abbrechen.`
      : 'Das Ergebnis bleibt im Overlay stehen, bis du „Ausblenden“ drückst oder eine neue Wette startest.';
  },

  tileStatus() {
    const b = this.b;
    if (!this.on || !b || b.status === 'idle' || !(b.options ?? []).length) return '🎯 Der Chat tippt mit';
    if (isOpen(b)) return `🎯 Läuft · ${b.total} ${b.total === 1 ? 'Tipp' : 'Tipps'}`;
    if (b.status === 'open' || b.status === 'locked') return '🔒 Gleich kommt die Auflösung';
    if (b.status === 'resolved') return `🏁 ${b.options[b.winner - 1] ?? ''} war richtig`;
    return '🎯 Der Chat tippt mit';
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};
