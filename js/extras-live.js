// Webseite: Verbotenes Wort, Subathon-Timer, Pausen-Bildschirm
import {
  $, X, act, clock, fill, h, isAdmin, makeDialog, onSubmit, onTick, openFeature, paintNote, paintTile, secondsUntil, span, timeOf, toast,
} from './extras-core.js';

// ============================================================
// Verbotenes Wort
// ============================================================
export const forbidden = {
  kind: 'forbidden', icon: '🤐', cta: 'Zum Wort →',
  on: false, error: '', data: null, reports: [], subscribed: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-forbidden', cls: 'x-forbidden', eyebrow: 'Live im Stream · !erwischt im Chat', title: 'Verbotenes Wort',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero fw-hero">
            <span class="fw-label">Das verbotene Wort</span>
            <b class="fw-word" data-word>–</b>
            <div class="fw-stats">
              <span><b data-count>0</b> Verstöße</span>
              <span class="fw-penalty" data-penalty></span>
            </div>
          </div>
          <button class="btn btn--primary btn--lg btn--block" type="button" data-report>🚨 Erwischt! Er hat es gesagt</button>
          <p class="form-hint" data-how></p>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Steuern</h3>
            <div class="x-row">
              <button class="btn btn--outline btn--sm" type="button" data-draw>🎲 Neues Wort ziehen</button>
              <button class="btn btn--ghost btn--sm" type="button" data-stop>⏹ Beenden</button>
            </div>
            <form class="x-inline" data-own-form>
              <input type="text" name="word" maxlength="40" placeholder="Eigenes Wort …" aria-label="Eigenes Wort">
              <button class="btn btn--ghost btn--sm" type="submit">Nehmen</button>
            </form>
            <div class="x-row">
              <button class="btn btn--ghost btn--sm" type="button" data-add="1">＋1 Verstoß</button>
              <button class="btn btn--ghost btn--sm" type="button" data-add="-1">−1</button>
            </div>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Meldungen <small data-pending-count></small></h3>
            <ul class="x-list" data-reports></ul>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Einstellungen</h3>
            <form class="x-form" data-settings>
              <label class="field"><span>Wörter zum Ziehen (eins pro Zeile)</span><textarea name="words" rows="5" maxlength="4000"></textarea></label>
              <div class="x-grid2">
                <label class="field"><span>Strafe je Verstoß</span><input type="number" name="each" min="0" max="1000"></label>
                <label class="field"><span>Was?</span><input type="text" name="what" maxlength="40" placeholder="Liegestütze"></label>
              </div>
              <label class="field"><span>Chat-Befehl</span><input type="text" name="command" maxlength="21" placeholder="!erwischt"></label>
              <button class="btn btn--outline btn--sm" type="submit">Speichern</button>
            </form>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    $('[data-report]', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
      const r = await X.api.forbidden.report();
      toast(r?.ok === false ? 'Du hast gerade erst gemeldet – kurz warten.' : 'Gemeldet! Ein Mod prüft es gleich.', r?.ok === false ? 'info' : 'ok');
    }));
    $('[data-draw]', d).addEventListener('click', (e) => act(e.currentTarget, async () => this.apply(await X.api.forbidden.draw())));
    $('[data-stop]', d).addEventListener('click', (e) => act(e.currentTarget, async () => this.apply(await X.api.forbidden.stop())));
    d.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => act(b, async () => this.apply(await X.api.forbidden.add(Number(b.dataset.add))))));
    onSubmit($('[data-own-form]', d), async (form) => {
      const word = form.word.value.trim();
      if (!word) return;
      this.apply(await X.api.forbidden.draw(word));
      form.reset();
    });
    onSubmit($('[data-settings]', d), async (form) => {
      this.apply(await X.api.forbidden.save({
        words: form.words.value.split('\n'), each: Number(form.each.value), what: form.what.value, command: form.command.value,
      }));
      toast('Gespeichert.', 'ok');
    });
  },

  async load() {
    try {
      this.data = await X.api.forbidden.get();
      this.on = !!this.data;
      if (isAdmin()) this.reports = await X.api.forbidden.reports().catch(() => []);
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      X.api.on('forbidden_word', (row) => this.apply(row));
      X.api.on('forbidden_reports', async () => { if (isAdmin()) { this.reports = await X.api.forbidden.reports().catch(() => []); this.render(); } });
    }
    paintTile(this);
  },

  apply(row) {
    if (!row) return;
    const before = this.data;
    this.data = row;
    paintTile(this);
    if (this.dialog.open) this.render();
    if (before && row.last_event?.n !== before.last_event?.n && row.last_event?.type === 'hit' && this.dialog.open) {
      const hero = $('.fw-hero', this.dialog);
      hero.classList.remove('is-hit');
      void hero.offsetWidth;
      hero.classList.add('is-hit');
    }
    if (isAdmin() && row.pending !== this.reports.length) X.api.forbidden.reports().then((r) => { this.reports = r; this.render(); }).catch(() => {});
  },

  penaltyText(f) {
    if (!f.penalty_each) return '';
    return `${f.count ? `${f.count} × ${f.penalty_each} = ${f.count * f.penalty_each}` : `${f.penalty_each} je Verstoß`} ${f.penalty_what}`;
  },

  render() {
    const d = this.dialog;
    paintNote(d, this);
    const f = this.data;
    const admin = isAdmin() && this.on;
    $('[data-admin]', d).hidden = !admin;
    d.classList.toggle('has-side', admin);
    $('[data-word]', d).textContent = f?.running ? f.word : 'Gerade kein Wort';
    $('[data-count]', d).textContent = f?.count ?? 0;
    $('[data-penalty]', d).textContent = f ? this.penaltyText(f) : '';
    $('[data-report]', d).disabled = !f?.running;
    $('[data-how]', d).textContent = f?.running
      ? `Hat der Streamer „${f.word}“ gesagt? Drück den Knopf oder schreib ${f.report_command} in den Chat. Ein Mod bestätigt – dann zählt es.`
      : 'Sobald ein Wort gezogen ist, kannst du hier und im Chat melden.';
    if (!admin) return;
    $('[data-stop]', d).disabled = !f.running;
    $('[data-pending-count]', d).textContent = this.reports.length ? `· ${this.reports.length} offen` : '';
    fill($('[data-reports]', d), this.reports, (r) => h('li', { class: 'x-item' },
      h('span', { class: 'x-item-main' }, h('b', {}, r.reporters.slice(0, 4).join(', ') + (r.reporters.length > 4 ? ` +${r.reporters.length - 4}` : '')), h('small', {}, `um ${timeOf(r.created_at)} · ${r.reporters.length} ${r.reporters.length === 1 ? 'Meldung' : 'Meldungen'}`)),
      h('span', { class: 'x-item-actions' },
        h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => this.apply(await X.api.forbidden.judge(r.id, true))) }, '✅ Zählt'),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => this.apply(await X.api.forbidden.judge(r.id, false))) }, '❌'))),
    'Keine offenen Meldungen.');
    const form = $('[data-settings]', d);
    if (!form.contains(document.activeElement)) {
      form.words.value = f.words.join('\n');
      form.each.value = f.penalty_each;
      form.what.value = f.penalty_what;
      form.command.value = f.report_command;
    }
  },

  tileStatus() {
    if (!this.on) return '🤐 Pssst …';
    return this.data?.running ? `🤐 Läuft · ${this.data.count} ${this.data.count === 1 ? 'Verstoß' : 'Verstöße'}` : '🤐 Gerade kein Wort';
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};

// ============================================================
// Subathon
// ============================================================
export const subathon = {
  kind: 'subathon', icon: '⏱️', cta: 'Zum Timer →',
  on: false, error: '', data: null, log: [], subscribed: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-subathon', cls: 'x-subathon', eyebrow: 'Follows, Abos und Bits verlängern den Stream', title: 'Subathon',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero sa-hero">
            <span class="sa-status" data-status></span>
            <b class="sa-clock" data-clock>0:00:00</b>
            <span class="sa-added" data-added></span>
          </div>
          <div class="sa-rates" data-rates></div>
          <h3 class="prank-h3">Am meisten Zeit geschenkt</h3>
          <ol class="x-rank" data-top></ol>
          <h3 class="prank-h3">Zuletzt</h3>
          <ul class="x-list x-list--compact" data-log></ul>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Steuern</h3>
            <form class="x-inline" data-start-form>
              <input type="number" name="minutes" min="1" max="10080" aria-label="Startzeit in Minuten">
              <button class="btn btn--primary btn--sm" type="submit">▶ Starten (Minuten)</button>
            </form>
            <div class="x-row">
              <button class="btn btn--outline btn--sm" type="button" data-pause>⏸ Pause</button>
              <button class="btn btn--ghost btn--sm" type="button" data-end>⏹ Beenden</button>
              <button class="btn btn--ghost btn--sm" type="button" data-reset>🔄 Zurücksetzen</button>
            </div>
            <div class="x-row">
              <button class="btn btn--ghost btn--sm" type="button" data-plus="60">＋1 Min</button>
              <button class="btn btn--ghost btn--sm" type="button" data-plus="300">＋5 Min</button>
              <button class="btn btn--ghost btn--sm" type="button" data-plus="1800">＋30 Min</button>
              <button class="btn btn--ghost btn--sm" type="button" data-plus="-60">−1 Min</button>
            </div>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">So viel Zeit gibt es</h3>
            <form class="x-form" data-settings>
              <div class="x-grid2">
                <label class="field"><span>Start (Minuten)</span><input type="number" name="start" min="1" max="10080"></label>
                <label class="field"><span>Höchstens (Stunden, 0 = offen)</span><input type="number" name="cap" min="0" max="720"></label>
                <label class="field"><span>Follow (Sekunden)</span><input type="number" name="follow" min="0" max="86400"></label>
                <label class="field"><span>Abo (Sekunden)</span><input type="number" name="sub" min="0" max="86400"></label>
                <label class="field"><span>100 Bits (Sekunden)</span><input type="number" name="bits" min="0" max="86400"></label>
              </div>
              <p class="form-hint">Abo Stufe 2 zählt doppelt, Stufe 3 fünffach. Verschenkte Abos zählen je Abo. Test-Alerts zählen nicht.</p>
              <button class="btn btn--outline btn--sm" type="submit">Speichern</button>
            </form>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    const ctl = (btn, action, value) => act(btn, async () => this.apply(await X.api.subathon.control(action, value)));
    onSubmit($('[data-start-form]', d), async (form) => this.apply(await X.api.subathon.control('start', Number(form.minutes.value) || null)));
    $('[data-pause]', d).addEventListener('click', (e) => ctl(e.currentTarget, this.data?.status === 'paused' ? 'resume' : 'pause'));
    $('[data-end]', d).addEventListener('click', (e) => { if (confirm('Subathon beenden? Der Timer bleibt bei 0 stehen.')) ctl(e.currentTarget, 'end'); });
    $('[data-reset]', d).addEventListener('click', (e) => { if (confirm('Zurücksetzen? Verlauf und Zeit gehen auf Anfang.')) ctl(e.currentTarget, 'reset'); });
    d.querySelectorAll('[data-plus]').forEach((b) => b.addEventListener('click', () => ctl(b, 'add', Number(b.dataset.plus))));
    onSubmit($('[data-settings]', d), async (form) => {
      this.apply(await X.api.subathon.save({
        start: Number(form.start.value), cap: Number(form.cap.value), follow: Number(form.follow.value), sub: Number(form.sub.value), bits: Number(form.bits.value),
      }));
      toast('Gespeichert.', 'ok');
    });
    onTick(() => {
      if (this.dialog.open) this.paintClock();
      if (this.data?.status === 'running') paintTile(this);
    });
  },

  left() {
    const s = this.data;
    if (!s) return 0;
    return s.status === 'running' ? secondsUntil(s.ends_at) : s.status === 'ended' ? 0 : s.remaining;
  },

  async load() {
    try {
      this.data = await X.api.subathon.get();
      this.on = !!this.data;
      this.log = await X.api.subathon.log().catch(() => []);
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      X.api.on('subathon', (row) => { this.apply(row); X.api.subathon.log().then((l) => { this.log = l; if (this.dialog.open) this.render(); }).catch(() => {}); });
    }
    paintTile(this);
  },

  apply(row) {
    if (!row) return;
    this.data = row;
    paintTile(this);
    if (this.dialog.open) this.render();
  },

  paintClock() {
    const d = this.dialog;
    const s = this.data;
    $('[data-clock]', d).textContent = clock(this.left());
    const done = s?.status === 'running' && this.left() === 0;
    $('[data-status]', d).textContent = !s ? '' : done || s.status === 'ended' ? '🏁 Vorbei' : { ready: 'Bereit', running: '🔴 Läuft', paused: '⏸ Pausiert' }[s.status];
  },

  render() {
    const d = this.dialog;
    paintNote(d, this);
    const s = this.data;
    const admin = isAdmin() && this.on;
    $('[data-admin]', d).hidden = !admin;
    d.classList.toggle('has-side', admin);
    this.paintClock();
    $('[data-added]', d).textContent = s?.added ? `${s.added > 0 ? '+' : '−'}${span(s.added)} dazugekommen` : '';
    $('[data-rates]', d).replaceChildren(...(s ? [
      h('span', {}, `💜 Follow +${span(s.sec_follow)}`),
      h('span', {}, `⭐ Abo +${span(s.sec_sub)}`),
      h('span', {}, `💎 100 Bits +${span(s.sec_bits)}`),
      s.cap_hours ? h('span', {}, `⛔ höchstens ${s.cap_hours} Std`) : null,
    ] : []));
    const byWho = new Map();
    for (const l of this.log) if (l.kind !== 'manual' && l.seconds > 0) byWho.set(l.who, (byWho.get(l.who) ?? 0) + l.seconds);
    const top = [...byWho].sort((a, b) => b[1] - a[1]).slice(0, 10);
    fill($('[data-top]', d), top, ([who, secs]) => h('li', {}, h('b', {}, who || 'Anonym'), h('span', {}, `+${span(secs)}`)), 'Noch keine Zeit geschenkt.');
    const icon = { follow: '💜', sub: '⭐', resub: '⭐', gift: '🎁', bits: '💎', manual: '🛠️' };
    fill($('[data-log]', d), this.log.slice(0, 15), (l) => h('li', { class: 'x-item' },
      h('span', {}, `${icon[l.kind] ?? '•'} ${l.who || 'Anonym'}`), h('small', {}, `${l.seconds > 0 ? '+' : '−'}${span(l.seconds)} · ${timeOf(l.created_at)}`)), 'Noch nichts.');
    if (!admin) return;
    const running = ['running', 'paused'].includes(s.status);
    $('[data-start-form] button', d).disabled = running;
    $('[data-pause]', d).disabled = !running;
    $('[data-pause]', d).textContent = s.status === 'paused' ? '▶ Weiter' : '⏸ Pause';
    $('[data-end]', d).disabled = !running;
    d.querySelectorAll('[data-plus]').forEach((b) => { b.disabled = !running; });
    const start = $('[data-start-form]', d).minutes;
    if (document.activeElement !== start) start.value = s.start_minutes;
    const form = $('[data-settings]', d);
    if (!form.contains(document.activeElement)) {
      Object.assign(form.start, { value: s.start_minutes });
      form.cap.value = s.cap_hours;
      form.follow.value = s.sec_follow;
      form.sub.value = s.sec_sub;
      form.bits.value = s.sec_bits;
    }
  },

  tileStatus() {
    const s = this.data;
    if (!this.on || !s) return '⏱️ Jeder Sub zählt';
    if (s.status === 'running') return this.left() ? `🔴 Noch ${clock(this.left())}` : '🏁 Vorbei';
    return { ready: '⏱️ Startet bald', paused: `⏸ Pausiert · ${clock(s.remaining)}`, ended: '🏁 Vorbei' }[s.status] ?? '⏱️';
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};

// ============================================================
// Pausen-Bildschirm mit Zahlenraten
// ============================================================
export const pause = {
  kind: 'pause', icon: '☕', cta: 'Zur Pause →',
  on: false, error: '', data: null, subscribed: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-pause', cls: 'x-pause', eyebrow: 'Gleich zurück · Zahlenraten im Chat', title: 'Kurze Pause',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero pz-hero">
            <span class="pz-state" data-state></span>
            <b class="pz-title" data-title></b>
            <span class="pz-msg" data-msg></span>
            <b class="pz-clock" data-clock hidden></b>
          </div>
          <section class="bingo-box pz-game" data-game>
            <h3 class="prank-h3">🔢 Zahlenraten <small data-round></small></h3>
            <p class="pz-range" data-range></p>
            <p class="pz-last" data-last aria-live="polite"></p>
            <form class="x-inline" data-guess>
              <input type="number" name="n" min="1" required aria-label="Deine Zahl">
              <button class="btn btn--primary btn--sm" type="submit">Raten</button>
            </form>
            <p class="form-hint" data-how></p>
            <ul class="x-list x-list--compact" data-winners></ul>
          </section>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Pause</h3>
            <form class="x-form" data-start>
              <label class="field"><span>Überschrift</span><input type="text" name="title" maxlength="60" placeholder="Gleich geht’s weiter!"></label>
              <label class="field"><span>Text darunter</span><input type="text" name="message" maxlength="140" placeholder="Kurz Kaffee holen …"></label>
              <label class="field"><span>Countdown (Minuten, 0 = ohne)</span><input type="number" name="minutes" min="0" max="600" value="5"></label>
              <label class="toggle"><input type="checkbox" name="game" checked><span class="toggle-ui" aria-hidden="true"></span>Zahlenraten im Chat</label>
              <div class="x-row">
                <button class="btn btn--primary btn--sm" type="submit" data-start-btn>☕ Pause starten</button>
                <button class="btn btn--ghost btn--sm" type="button" data-stop>⏹ Pause beenden</button>
              </div>
            </form>
            <p class="form-hint">Im OBS-Fenster die Ebene „Pausen-Bildschirm“ einschalten. Chat und Dino bleiben darüber sichtbar, wenn ihre Ebenen an sind.</p>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Zahlenraten</h3>
            <form class="x-form" data-settings>
              <div class="x-grid2">
                <label class="field"><span>Zahl von 1 bis</span><input type="number" name="max" min="10" max="10000"></label>
                <label class="field"><span>Chat-Befehl</span><input type="text" name="command" maxlength="21"></label>
              </div>
              <button class="btn btn--outline btn--sm" type="submit">Speichern (neue Runde)</button>
            </form>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    onSubmit($('[data-start]', d), async (form) => {
      this.apply(await X.api.pause.start({ minutes: Number(form.minutes.value) || 0, title: form.title.value, message: form.message.value, game: form.game.checked }));
      toast('Pause läuft – im Overlay ist jetzt der Pausen-Bildschirm zu sehen.', 'ok');
    });
    $('[data-stop]', d).addEventListener('click', (e) => act(e.currentTarget, async () => this.apply(await X.api.pause.stop())));
    onSubmit($('[data-settings]', d), async (form) => {
      this.apply(await X.api.pause.settings({ max: Number(form.max.value), command: form.command.value }));
      toast('Gespeichert – neue Runde.', 'ok');
    });
    onSubmit($('[data-guess]', d), async (form) => {
      const r = await X.api.pause.guess(Number(form.n.value));
      toast(r.hint === 'hit' ? `🎉 Richtig! Die Zahl war ${r.guess}.` : r.hint === 'higher' ? `${r.guess}? Höher!` : `${r.guess}? Tiefer!`, r.hint === 'hit' ? 'ok' : 'info');
      form.reset();
    });
    onTick(() => { if (this.dialog.open && this.data?.ends_at) this.paintClock(); });
  },

  async load() {
    try {
      this.data = await X.api.pause.get();
      this.on = !!this.data;
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      X.api.on('pause_screen', (row) => this.apply(row));
    }
    paintTile(this);
  },

  apply(row) {
    if (!row) return;
    this.data = row;
    paintTile(this);
    if (this.dialog.open) this.render();
  },

  paintClock() {
    const el = $('[data-clock]', this.dialog);
    const p = this.data;
    el.hidden = !p?.active || !p.ends_at;
    if (!el.hidden) el.textContent = secondsUntil(p.ends_at) ? clock(secondsUntil(p.ends_at)) : 'gleich!';
  },

  render() {
    const d = this.dialog;
    paintNote(d, this);
    const p = this.data;
    const admin = isAdmin() && this.on;
    $('[data-admin]', d).hidden = !admin;
    d.classList.toggle('has-side', admin);
    if (!p) return;
    $('[data-state]', d).textContent = p.active ? '☕ Gerade Pause' : 'Gerade keine Pause';
    $('[data-title]', d).textContent = p.active ? p.title : '–';
    $('[data-msg]', d).textContent = p.active ? p.message : '';
    this.paintClock();
    const game = p.active && p.game_on;
    $('[data-game]', d).hidden = !game && !admin;
    $('[data-round]', d).textContent = `· Runde ${p.game_round}`;
    $('[data-range]', d).textContent = `Die Zahl liegt zwischen ${p.game_low} und ${p.game_high}.`;
    const last = p.game_last;
    $('[data-last]', d).textContent = last?.who ? `${last.who}: ${last.guess} → ${last.hint === 'hit' ? '🎉 Treffer!' : last.hint === 'higher' ? 'höher ⬆' : 'tiefer ⬇'}` : '';
    const form = $('[data-guess]', d);
    form.n.max = p.game_max;
    form.querySelector('button').disabled = !game;
    $('[data-how]', d).textContent = game ? `Oder im Chat: ${p.guess_command} ZAHL` : 'Das Zahlenraten läuft nur während der Pause.';
    fill($('[data-winners]', d), p.game_winners ?? [], (w) => h('li', { class: 'x-item' }, h('span', {}, `🏆 ${w.who}`), h('small', {}, `Zahl ${w.number} · ${w.guesses} Tipps`)), 'Noch keine Gewinner.');
    if (!admin) return;
    $('[data-stop]', d).disabled = !p.active;
    $('[data-start-btn]', d).textContent = p.active ? '💾 Pause ändern' : '☕ Pause starten';
    const start = $('[data-start]', d);
    if (!start.contains(document.activeElement)) {
      start.title.value = p.title;
      start.message.value = p.message;
      start.game.checked = p.game_on;
    }
    const settings = $('[data-settings]', d);
    if (!settings.contains(document.activeElement)) {
      settings.max.value = p.game_max;
      settings.command.value = p.guess_command;
    }
  },

  tileStatus() {
    if (!this.on || !this.data) return '☕ Gleich zurück';
    return this.data.active ? '☕ Gerade Pause · Zahlenraten!' : '▶ Der Stream läuft';
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};
