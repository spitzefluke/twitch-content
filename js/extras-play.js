// Webseite: Quiz und Mitspieler-Warteschlange
import {
  $, X, act, fill, h, isAdmin, makeDialog, onSubmit, onTick, openFeature, paintNote, paintTile, secondsUntil, timeOf, toast,
} from './extras-core.js';

const LETTERS = ['A', 'B', 'C', 'D'];

// ============================================================
// Quiz
// ============================================================
export const quiz = {
  kind: 'quiz', icon: '🧠', cta: 'Zum Quiz →',
  on: false, error: '', round: null, questions: [], scores: [], my: null, myScore: null, editing: null, subscribed: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-quiz', cls: 'x-quiz', eyebrow: 'Antwort im Chat mit !a !b !c !d – oder hier', title: 'Quiz',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero qz-hero">
            <div class="qz-top"><span class="qz-cat" data-cat></span><span class="qz-time" data-time></span></div>
            <b class="qz-question" data-question>Gerade läuft keine Frage.</b>
            <div class="qz-bar" aria-hidden="true"><i data-bar></i></div>
            <div class="qz-answers" data-answers></div>
            <p class="qz-info" data-info aria-live="polite"></p>
          </div>
          <p class="form-hint" data-me></p>
          <h3 class="prank-h3">Rangliste</h3>
          <ol class="x-rank" data-scores></ol>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Steuern</h3>
            <div class="x-inline">
              <select name="seconds" data-seconds aria-label="Zeit zum Antworten">
                <option value="15">15 Sekunden</option><option value="30" selected>30 Sekunden</option>
                <option value="45">45 Sekunden</option><option value="60">1 Minute</option><option value="120">2 Minuten</option>
              </select>
              <button class="btn btn--primary btn--sm" type="button" data-next>🎲 Nächste Frage</button>
            </div>
            <div class="x-row">
              <button class="btn btn--outline btn--sm" type="button" data-reveal>✅ Auflösen</button>
              <button class="btn btn--ghost btn--sm" type="button" data-hide>🙈 Ausblenden</button>
              <button class="btn btn--ghost btn--sm" type="button" data-reset>🗑 Rangliste leeren</button>
            </div>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Fragen <small data-qcount></small></h3>
            <form class="x-form qz-edit" data-edit>
              <label class="field"><span>Frage</span><input type="text" name="question" maxlength="200" required></label>
              <div class="qz-edit-answers">
                ${LETTERS.map((l, i) => `<label class="qz-edit-answer"><input type="radio" name="correct" value="${i}" ${i === 0 ? 'checked' : ''} aria-label="${l} ist richtig"><input type="text" name="a${i}" maxlength="80" placeholder="Antwort ${l}${i > 1 ? ' (optional)' : ''}"></label>`).join('')}
              </div>
              <p class="form-hint">Den Punkt vor die richtige Antwort setzen.</p>
              <label class="field"><span>Thema</span><input type="text" name="category" maxlength="30" placeholder="Fortnite"></label>
              <div class="x-row">
                <button class="btn btn--outline btn--sm" type="submit" data-save>Frage speichern</button>
                <button class="btn btn--ghost btn--sm" type="button" data-cancel hidden>Abbrechen</button>
              </div>
            </form>
            <ul class="x-list qz-list" data-questions></ul>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    $('[data-next]', d).addEventListener('click', (e) => act(e.currentTarget, async () => this.apply(await X.api.quiz.start(null, Number($('[data-seconds]', d).value)))));
    $('[data-reveal]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { this.apply(await X.api.quiz.reveal()); this.loadScores(); }));
    $('[data-hide]', d).addEventListener('click', (e) => act(e.currentTarget, async () => this.apply(await X.api.quiz.hide())));
    $('[data-reset]', d).addEventListener('click', (e) => {
      if (confirm('Rangliste wirklich leeren? Alle Punkte gehen auf 0.')) act(e.currentTarget, async () => { await X.api.quiz.resetScores(); await this.loadScores(); }, 'Rangliste geleert.');
    });
    $('[data-cancel]', d).addEventListener('click', () => this.edit(null));
    onSubmit($('[data-edit]', d), async (form) => {
      const answers = LETTERS.map((_, i) => form[`a${i}`].value);
      const picked = Number(form.correct.value);
      // Lücken schließen: die richtige Antwort behält ihren Platz unter den ausgefüllten
      const filled = answers.map((a, i) => ({ a: a.trim(), i })).filter((x) => x.a);
      const correct = filled.findIndex((x) => x.i === picked);
      if (correct < 0) throw new Error('Die als richtig markierte Antwort ist leer.');
      await X.api.quiz.saveQuestion({ id: this.editing?.id, question: form.question.value, answers: filled.map((x) => x.a), correct, category: form.category.value });
      toast('Frage gespeichert.', 'ok');
      this.edit(null);
      this.questions = await X.api.quiz.questions();
      this.render();
    });
    onTick(() => { if (this.dialog.open && this.round?.status === 'open') this.paintTime(); });
  },

  async load() {
    try {
      this.round = await X.api.quiz.round();
      this.on = !!this.round;
      const [my, myScore] = await Promise.all([
        X.api.quiz.myAnswer().catch(() => null),
        X.api.quiz.myScore().catch(() => null),
        this.loadScores(),
        isAdmin() ? X.api.quiz.questions().then((q) => { this.questions = q; }).catch(() => {}) : null,
      ]);
      Object.assign(this, { my, myScore });
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      X.api.on('quiz_round', (row) => this.apply(row));
    }
    paintTile(this);
  },

  async loadScores() {
    this.scores = await X.api.quiz.scores().catch(() => []);
    this.myScore = await X.api.quiz.myScore().catch(() => null);
    if (this.dialog.open) this.render();
  },

  apply(row) {
    if (!row) return;
    const before = this.round;
    this.round = row;
    if (before?.n !== row.n) this.my = null;
    if (before?.status !== 'revealed' && row.status === 'revealed') this.loadScores();
    paintTile(this);
    if (this.dialog.open) this.render();
  },

  edit(q) {
    this.editing = q;
    const form = $('[data-edit]', this.dialog);
    form.reset();
    if (q) {
      form.question.value = q.question;
      q.answers.forEach((a, i) => { form[`a${i}`].value = a; });
      form.correct.value = String(q.correct);
      form.category.value = q.category;
      form.question.focus();
    }
    $('[data-save]', this.dialog).textContent = q ? 'Änderung speichern' : 'Frage speichern';
    $('[data-cancel]', this.dialog).hidden = !q;
  },

  paintTime() {
    const r = this.round;
    const d = this.dialog;
    const left = r?.status === 'open' ? secondsUntil(r.closes_at) : 0;
    $('[data-time]', d).textContent = r?.status === 'open' ? (left ? `⏱ ${left} s` : '⏱ Zeit um') : r?.status === 'revealed' ? 'Aufgelöst' : '';
    $('[data-bar]', d).style.width = r?.status === 'open' ? `${(left / r.seconds) * 100}%` : '0%';
    if (r?.status === 'open' && !left) this.dialog.querySelectorAll('.qz-answer').forEach((b) => { b.disabled = true; });
  },

  render() {
    const d = this.dialog;
    paintNote(d, this);
    const admin = isAdmin() && this.on;
    $('[data-admin]', d).hidden = !admin;
    d.classList.toggle('has-side', admin);
    const r = this.round;
    const live = r && r.status !== 'idle';
    $('[data-cat]', d).textContent = live ? r.category : '';
    $('[data-question]', d).textContent = live ? r.question : 'Gerade läuft keine Frage.';
    const total = Math.max(1, r?.answered ?? 0);
    const open = r?.status === 'open' && secondsUntil(r.closes_at) > 0;
    $('[data-answers]', d).replaceChildren(...(live ? r.answers.map((a, i) => {
      const btn = h('button', {
        class: `qz-answer${r.correct === i ? ' is-right' : ''}${r.status === 'revealed' && this.my === i && r.correct !== i ? ' is-wrong' : ''}${this.my === i ? ' is-mine' : ''}`,
        type: 'button', disabled: !open || this.my !== null,
        onclick: (e) => act(e.currentTarget, async () => {
          await X.api.quiz.answer(i);
          this.my = i;
          this.render();
          toast(`Deine Antwort: ${LETTERS[i]}`, 'ok');
        }),
      }, h('b', {}, LETTERS[i]), h('span', {}, a));
      if (r.status === 'revealed') btn.append(h('small', { class: 'qz-pct' }, `${Math.round((r.counts[i] / total) * 100)} %`));
      return btn;
    }) : []));
    this.paintTime();
    $('[data-info]', d).textContent = !live ? 'Sobald der Streamer eine Frage stellt, erscheint sie hier und im Stream.'
      : r.status === 'revealed'
        ? `Richtig war ${LETTERS[r.correct]}. ${r.winners?.length ? `Am schnellsten: ${r.winners.map((w) => w.name).join(', ')}` : 'Niemand lag richtig.'}`
        : `${r.answered} ${r.answered === 1 ? 'Antwort' : 'Antworten'} bisher.${this.my !== null ? ` Du hast ${LETTERS[this.my]} gewählt.` : ''}`;
    const s = this.myScore;
    $('[data-me]', d).textContent = s ? `Du: ${s.points} Punkte · ${s.correct} von ${s.answered} richtig · Platz ${s.rank}` : 'Richtig = 10 Punkte, wer schnell ist, bekommt bis zu 5 extra.';
    fill($('[data-scores]', d), this.scores.slice(0, 10), (sc) => h('li', {}, h('b', {}, sc.name || 'Anonym'), h('span', {}, `${sc.points} P · ${sc.correct}/${sc.answered}`)), 'Noch keine Punkte.');
    if (!admin) return;
    $('[data-reveal]', d).disabled = r.status !== 'open';
    $('[data-hide]', d).disabled = r.status === 'idle';
    $('[data-qcount]', d).textContent = `· ${this.questions.length}`;
    fill($('[data-questions]', d), this.questions, (q) => h('li', { class: 'x-item' },
      h('span', { class: 'x-item-main' }, h('b', {}, q.question), h('small', {}, `${q.category} · richtig: ${LETTERS[q.correct]}) ${q.answers[q.correct]}${q.used_at ? ` · zuletzt ${timeOf(q.used_at)}` : ''}`)),
      h('span', { class: 'x-item-actions' },
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Jetzt stellen', onclick: (e) => act(e.currentTarget, async () => this.apply(await X.api.quiz.start(q.id, Number($('[data-seconds]', d).value)))) }, '▶'),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Bearbeiten', onclick: () => this.edit(q) }, '✏️'),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', title: 'Löschen',
          onclick: (e) => { if (confirm('Diese Frage löschen?')) act(e.currentTarget, async () => { await X.api.quiz.deleteQuestion(q.id); this.questions = this.questions.filter((x) => x.id !== q.id); this.render(); }); },
        }, '🗑'))), 'Noch keine Fragen.');
  },

  tileStatus() {
    const r = this.round;
    if (!this.on || !r) return '🧠 Teste dein Wissen';
    return r.status === 'open' ? '🔴 Frage läuft – jetzt antworten!' : r.status === 'revealed' ? '✅ Aufgelöst' : '🧠 Teste dein Wissen';
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};

// ============================================================
// Mitspieler-Warteschlange
// ============================================================
export const queue = {
  kind: 'queue', icon: '🎮', cta: 'Anstellen →',
  on: false, error: '', settings: null, entries: [], me: null, admin: [], subscribed: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-queue', cls: 'x-queue', eyebrow: '!join EpicName im Chat – oder hier', title: 'Mitspielen',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero qu-hero">
            <span class="qu-open" data-open></span>
            <span class="qu-note" data-note-text></span>
          </div>
          <section class="bingo-box" data-mine>
            <h3 class="prank-h3">Du</h3>
            <p class="qu-me" data-me aria-live="polite"></p>
            <form class="x-inline" data-join>
              <input type="text" name="epic" maxlength="32" placeholder="Dein Epic-Name" aria-label="Dein Epic-Name" autocomplete="off">
              <button class="btn btn--primary btn--sm" type="submit">Anstellen</button>
            </form>
            <button class="btn btn--ghost btn--sm" type="button" data-leave hidden>Raus aus der Schlange</button>
            <p class="form-hint">Den Epic-Namen sehen nur der Streamer und die Mods.</p>
          </section>
          <h3 class="prank-h3">🎮 Gerade dran</h3>
          <ul class="x-list qu-list" data-picked></ul>
          <h3 class="prank-h3">⏳ Warteschlange <small data-count></small></h3>
          <ol class="x-list qu-list" data-waiting></ol>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Steuern</h3>
            <div class="x-row">
              <button class="btn btn--primary btn--sm" type="button" data-pick>🎲 Nächste ziehen</button>
              <button class="btn btn--ghost btn--sm" type="button" data-done-all>✔ Alle Dran-Seienden fertig</button>
              <button class="btn btn--ghost btn--sm" type="button" data-clear>🗑 Schlange leeren</button>
            </div>
            <ul class="x-list qu-admin" data-admin-list></ul>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Einstellungen</h3>
            <form class="x-form" data-settings>
              <label class="toggle"><input type="checkbox" name="open"><span class="toggle-ui" aria-hidden="true"></span>Warteschlange offen</label>
              <label class="toggle"><input type="checkbox" name="sub"><span class="toggle-ui" aria-hidden="true"></span>Subs zuerst</label>
              <div class="x-grid2">
                <label class="field"><span>Ziehen</span><select name="mode"><option value="order">der Reihe nach</option><option value="random">per Zufall</option></select></label>
                <label class="field"><span>Pro Runde</span><input type="number" name="squad" min="1" max="20"></label>
                <label class="field"><span>Höchstens wartend</span><input type="number" name="max" min="1" max="500"></label>
              </div>
              <label class="field"><span>Hinweis (z. B. Server, Modus)</span><input type="text" name="note" maxlength="100" placeholder="EU-Server · Null Bauen"></label>
              <button class="btn btn--outline btn--sm" type="submit">Speichern</button>
            </form>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    onSubmit($('[data-join]', d), async (form) => {
      const r = await X.api.queue.join(form.epic.value);
      toast(r?.position ? `Du stehst auf Platz ${r.position}.` : 'Du bist dabei!', 'ok');
      await this.load();
      this.render();
    });
    $('[data-leave]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { await X.api.queue.leave(); await this.load(); this.render(); }));
    $('[data-pick]', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
      const r = await X.api.queue.pick(null);
      toast(`${r.picked} ${r.picked === 1 ? 'Person ist' : 'Leute sind'} dran – der Bot sagt im Chat Bescheid.`, 'ok');
      await this.load();
      this.render();
    }));
    const upd = (btn, action, id = null) => act(btn, async () => { await X.api.queue.update(action, id); await this.load(); this.render(); });
    $('[data-done-all]', d).addEventListener('click', (e) => upd(e.currentTarget, 'done_all'));
    $('[data-clear]', d).addEventListener('click', (e) => { if (confirm('Alle aus der Warteschlange nehmen?')) upd(e.currentTarget, 'clear'); });
    this.upd = upd;
    onSubmit($('[data-settings]', d), async (form) => {
      this.settings = await X.api.queue.save({
        open: form.open.checked, sub: form.sub.checked, mode: form.mode.value, squad: Number(form.squad.value), max: Number(form.max.value), note: form.note.value,
      });
      toast(this.settings.open ? 'Gespeichert – die Warteschlange ist offen.' : 'Gespeichert.', 'ok');
      this.render();
      paintTile(this);
    });
  },

  async load() {
    try {
      const [settings, entries] = await Promise.all([X.api.queue.settings(), X.api.queue.entries()]);
      Object.assign(this, { settings, entries, on: !!settings });
      this.me = X.ctx.state.user ? await X.api.queue.me().catch(() => null) : null;
      if (isAdmin()) this.admin = await X.api.queue.adminList().catch(() => []);
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      let timer = 0;
      const again = () => { clearTimeout(timer); timer = setTimeout(async () => { await this.load(); if (this.dialog.open) this.render(); }, 300); };
      X.api.on('queue_entries', again);
      X.api.on('queue_settings', again);
    }
    paintTile(this);
  },

  render() {
    const d = this.dialog;
    paintNote(d, this);
    const admin = isAdmin() && this.on;
    $('[data-admin]', d).hidden = !admin;
    d.classList.toggle('has-side', admin);
    const s = this.settings;
    if (!s) return;
    $('[data-open]', d).textContent = s.open ? '🟢 Die Warteschlange ist offen' : '🔴 Gerade geschlossen';
    $('[data-note-text]', d).textContent = s.note;
    const me = this.me;
    const inQueue = me?.status === 'waiting' || me?.status === 'picked';
    $('[data-me]', d).textContent = me?.status === 'picked' ? '🎮 Du bist dran! Schau in deine Freundschaftsanfragen bei Epic.'
      : me?.status === 'waiting' ? `⏳ Du stehst auf Platz ${me.position}.` : s.open ? 'Du stehst noch nicht an.' : 'Sobald die Schlange offen ist, kannst du dich hier anstellen.';
    const join = $('[data-join]', d);
    join.hidden = inQueue;
    join.querySelector('button').disabled = !s.open;
    if (me?.epic && !join.epic.value && document.activeElement !== join.epic) join.epic.value = me.epic;
    $('[data-leave]', d).hidden = me?.status !== 'waiting';
    const picked = this.entries.filter((e) => e.status === 'picked');
    const waiting = this.entries.filter((e) => e.status === 'waiting')
      .sort((a, b) => ((s.sub_priority && b.is_sub) - (s.sub_priority && a.is_sub)) || Date.parse(a.joined_at) - Date.parse(b.joined_at));
    const name = (e) => h('span', {}, e.name, e.is_sub ? h('span', { class: 'qu-sub', title: 'Abonnent' }, ' ⭐') : null);
    fill($('[data-picked]', d), picked, (e) => h('li', { class: 'x-item' }, name(e), h('small', {}, e.picked_at ? `seit ${timeOf(e.picked_at)}` : '')), 'Gerade spielt niemand mit.');
    $('[data-count]', d).textContent = `· ${waiting.length}`;
    fill($('[data-waiting]', d), waiting.slice(0, 50), (e) => h('li', { class: 'x-item' }, name(e), h('small', {}, timeOf(e.joined_at))), 'Niemand wartet.');
    if (!admin) return;
    const form = $('[data-settings]', d);
    if (!form.contains(document.activeElement)) {
      form.open.checked = s.open;
      form.sub.checked = s.sub_priority;
      form.mode.value = s.mode;
      form.squad.value = s.squad_size;
      form.max.value = s.max_size;
      form.note.value = s.note;
    }
    $('[data-pick]', d).textContent = `🎲 Nächste ${s.squad_size} ziehen`;
    $('[data-pick]', d).disabled = !waiting.length;
    $('[data-done-all]', d).disabled = !picked.length;
    fill($('[data-admin-list]', d), this.admin, (e) => h('li', { class: `x-item${e.status === 'picked' ? ' is-picked' : ''}` },
      h('span', { class: 'x-item-main' },
        h('b', {}, `${e.status === 'picked' ? '🎮 ' : `${e.place}. `}${e.name}${e.is_sub ? ' ⭐' : ''}`),
        h('small', {}, 'Epic: ', h('code', {}, e.epic_name || '–'))),
      h('span', { class: 'x-item-actions' },
        e.epic_name ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Epic-Namen kopieren', onclick: () => navigator.clipboard?.writeText(e.epic_name).then(() => toast('Kopiert.', 'ok')) }, '📋') : null,
        e.status === 'picked'
          ? [h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Hat mitgespielt', onclick: (ev) => this.upd(ev.currentTarget, 'done', e.id) }, '✔'),
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Zurück in die Schlange', onclick: (ev) => this.upd(ev.currentTarget, 'back', e.id) }, '↩')]
          : null,
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Entfernen', onclick: (ev) => this.upd(ev.currentTarget, 'remove', e.id) }, '✕'))),
    'Niemand in der Schlange.');
  },

  tileStatus() {
    if (!this.on || !this.settings) return '🎮 Spiel mit!';
    const waiting = this.entries.filter((e) => e.status === 'waiting').length;
    return this.settings.open ? `🟢 Offen · ${waiting} warten` : '🔴 Gerade geschlossen';
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};
