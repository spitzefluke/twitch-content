// Cup: ein Turnier mit der Community. Der Streamer legt Titel, Regeln, Preisgelder je Platz und den
// Spielcode fest; der Bot schickt Regeln und Code in den Chat. Zuschauer treten mit „!cup join“ bei,
// Streamer und Mods tragen Spieler auch von Hand ein und vergeben die Punkte – daraus die Rangliste.
// Migration …_cup.sql.
import { $, X, act, fill, h, isAdmin, makeDialog, onSubmit, openFeature, paintTile, toast } from './extras-core.js';

const MAX_PRIZES = 10;
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

export const cup = {
  kind: 'cup', icon: '🏆', cta: 'Zur Rangliste →',
  on: false, error: '', b: null, code: '', subscribed: false, dialog: null, editing: false,

  setup() {
    this.dialog = makeDialog({
      id: 'x-cup', cls: 'x-cup', eyebrow: 'Chat: !cup join · Rangliste mit Preisgeld', title: 'Cup',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero cup-hero">
            <span class="cup-state" data-state aria-live="polite"></span>
            <b class="cup-title" data-title></b>
            <p class="cup-sub" data-sub></p>
            <p class="cup-me" data-me hidden></p>
          </div>
          <section data-rules-box hidden>
            <h3 class="prank-h3">📜 Regeln</h3>
            <p class="cup-rules" data-rules></p>
          </section>
          <section>
            <h3 class="prank-h3">🏆 Rangliste <small data-count></small></h3>
            <ol class="x-list cup-board" data-board></ol>
          </section>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Steuern</h3>
            <div class="x-row">
              <button class="btn btn--primary btn--sm" type="button" data-open></button>
              <button class="btn btn--ghost btn--sm" type="button" data-send="rules">📜 Regeln in den Chat</button>
              <button class="btn btn--ghost btn--sm" type="button" data-send="code">🔑 Spielcode in den Chat</button>
            </div>
            <button class="btn btn--outline btn--sm" type="button" data-test hidden>➕ 6 Test-Spieler (Demo)</button>
            <p class="form-hint" data-admin-hint></p>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Spieler hinzufügen</h3>
            <form class="x-row cup-add" data-add autocomplete="off">
              <label class="field" style="flex:1 1 160px"><span class="sr-only">Name</span><input type="text" name="name" maxlength="40" required placeholder="Name, z. B. NightOwl_Mia"></label>
              <button class="btn btn--primary btn--sm" type="submit">➕ Hinzufügen</button>
            </form>
            <p class="form-hint">Für Spieler ohne Chat. Jeder Name nur einmal. Punkte vergibst du direkt in der Rangliste.</p>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Einstellungen</h3>
            <form class="x-form" data-save autocomplete="off">
              <label class="field"><span>Name des Cups</span><input type="text" name="title" maxlength="60" placeholder="z. B. Fortnite Zero Build Cup"></label>
              <label class="field"><span>Regeln <small data-rules-len></small></span><textarea name="rules" rows="4" maxlength="450" placeholder="z. B. Nur Zero Build · Solo · 3 Runden · Punkte: Sieg 10, Top 5 = 5, je Kill 1"></textarea></label>
              <label class="field"><span>Spielcode <small>(nur für dich und deine Mods, bis du ihn verschickst)</small></span>
                <span class="cup-code-row"><input type="password" name="code" maxlength="60" placeholder="z. B. Matchmaking-Schlüssel" autocomplete="off"><button class="btn btn--ghost btn--sm" type="button" data-show-code>Zeigen</button></span>
              </label>
              <fieldset class="cup-prizes">
                <legend>Preisgelder je Platz <small>(optional)</small></legend>
                <div class="cup-prize-list" data-prizes></div>
                <button class="btn btn--ghost btn--sm" type="button" data-more-prize>＋ Platz</button>
              </fieldset>
              <label class="toggle"><input type="checkbox" name="open"><span class="toggle-ui" aria-hidden="true"></span>Anmeldung offen (!cup join im Chat)</label>
              <button class="btn btn--primary btn--sm" type="submit">💾 Speichern</button>
              <p class="form-hint">Die Regeln gehen als eine Chat-Nachricht raus (höchstens 450 Zeichen, Zeilen werden zu „·“). Zuschauer fragen sie mit !cup regeln ab.</p>
            </form>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Neuer Cup</h3>
            <div class="x-row">
              <button class="btn btn--ghost btn--sm" type="button" data-reset="keep">↺ Punkte auf 0 (Spieler bleiben)</button>
              <button class="btn btn--ghost btn--sm" type="button" data-reset="clear">🗑 Alle Spieler entfernen</button>
            </div>
            <p class="form-hint">Beides leert auch den Spielcode. Regeln und Preisgelder bleiben.</p>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    const reload = async () => { await this.load(); this.render(); };
    const form = $('[data-save]', d);
    form.addEventListener('input', () => { this.editing = true; this.paintRulesLen(); });
    $('[data-more-prize]', d).addEventListener('click', () => {
      const vals = this.prizeValues();
      if (vals.length < MAX_PRIZES) this.setPrizes([...vals, ''], vals.length);
    });
    $('[data-show-code]', d).addEventListener('click', (e) => {
      const input = form.code;
      input.type = input.type === 'password' ? 'text' : 'password';
      e.currentTarget.textContent = input.type === 'password' ? 'Zeigen' : 'Verbergen';
    });
    onSubmit(form, async () => {
      await X.api.cup.save({
        title: form.title.value, rules: form.rules.value, prizes: this.prizeValues(), open: form.open.checked, code: form.code.value,
      });
      this.editing = false;
      toast('Cup gespeichert.', 'ok');
      await reload();
    });
    onSubmit($('[data-add]', d), async (f) => {
      const name = f.elements.name.value.replace(/^\s*@+/, '').trim();
      if (!name) return;
      this.b = await X.api.cup.add(name);
      f.elements.name.value = '';
      toast(`${name} ist im Cup.`, 'ok');
      this.render();
      f.elements.name.focus();
    });
    $('[data-open]', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
      const next = !this.b?.open;
      await X.api.cup.setOpen(next);
      toast(next ? 'Anmeldung offen – der Bot sagt im Chat Bescheid.' : 'Anmeldung geschlossen.', 'ok');
      await reload();
    }));
    for (const btn of d.querySelectorAll('[data-send]')) {
      btn.addEventListener('click', (e) => act(e.currentTarget, async () => {
        const what = e.currentTarget.dataset.send;
        if (this.editing && !confirm('Es gibt ungespeicherte Änderungen. Trotzdem den gespeicherten Stand verschicken?')) return;
        if (what === 'code' && !confirm('Spielcode jetzt in den Chat schicken? Danach kann ihn jeder im Chat lesen.')) return;
        await X.api.cup.announce(what);
        toast(X.ctx.state.api.demo ? 'Im Demo-Modus geht nichts in den Chat – live schickt es der Bot.' : (what === 'code' ? 'Spielcode ist im Chat.' : 'Regeln sind im Chat.'), 'ok');
        await reload();
      }));
    }
    $('[data-test]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { this.b = await X.api.cup.addTest(6); this.render(); }));
    for (const btn of d.querySelectorAll('[data-reset]')) {
      btn.addEventListener('click', (e) => act(e.currentTarget, async () => {
        const keep = e.currentTarget.dataset.reset === 'keep';
        if (!confirm(keep ? 'Alle Punkte auf 0 setzen und den Spielcode leeren?' : 'Alle Spieler entfernen und den Spielcode leeren?')) return;
        await X.api.cup.reset(keep);
        toast(keep ? 'Punkte zurückgesetzt.' : 'Alle Spieler entfernt.', 'ok');
        await reload();
      }));
    }
  },

  prizeValues() {
    return [...this.dialog.querySelectorAll('[data-prizes] input')].map((i) => i.value);
  },

  setPrizes(values, focus = -1) {
    const vals = values.length ? values : ['', '', ''];
    const box = $('[data-prizes]', this.dialog);
    box.replaceChildren(...vals.map((v, i) => h('label', { class: 'field cup-prize' },
      h('span', {}, `${MEDAL[i + 1] ?? ''} Platz ${i + 1}`),
      h('input', { type: 'text', maxlength: '40', value: v, placeholder: i === 0 ? 'z. B. 50 €' : i === 1 ? 'z. B. 25 €' : i === 2 ? 'z. B. 10 €' : '' }))));
    $('[data-more-prize]', this.dialog).hidden = vals.length >= MAX_PRIZES;
    if (focus >= 0) box.querySelectorAll('input')[focus]?.focus();
  },

  paintRulesLen() {
    const n = $('[data-save]', this.dialog).rules.value.replace(/[\r\n]+/g, ' · ').trim().length;
    $('[data-rules-len]', this.dialog).textContent = `${n}/450`;
  },

  async load() {
    try {
      const b = await X.api.cup.get();
      const code = isAdmin() ? (await X.api.cup.admin().catch(() => null))?.code ?? '' : '';
      Object.assign(this, { b, code, on: true, error: '' });
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      let timer = 0;
      X.api.on('cup', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => { await this.load(); if (this.dialog.open) this.render(); }, 300);
      });
    }
    paintTile(this);
  },

  async points(btn, p, delta, set = null) {
    await act(btn, async () => { this.b = await X.api.cup.points(p.id, delta, set); this.render(); });
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
        ? `Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20261115000000_cup.sql ausführen.${this.error ? ` (${this.error})` : ''}`
        : 'Der Cup ist noch nicht eingerichtet. Schau später noch mal vorbei.';
      return;
    }
    const b = this.b;
    const prizes = b.prizes ?? [];
    $('[data-state]', d).textContent = b.open ? '🟢 Anmeldung offen' : '🔒 Anmeldung geschlossen';
    $('[data-title]', d).textContent = b.title;
    $('[data-sub]', d).textContent = `${b.count} ${b.count === 1 ? 'Spieler' : 'Spieler'}${b.open ? ' · im Chat: !cup join' : ''}${prizes[0] ? ` · 1. Platz: ${prizes[0]}` : ''}`;
    const me = $('[data-me]', d);
    me.hidden = !b.me;
    if (b.me) me.textContent = `Du bist auf Platz ${b.me.place} mit ${b.me.points} Punkten${b.me.points > 0 && prizes[b.me.place - 1] ? ` – Preisgeld: ${prizes[b.me.place - 1]}` : ''}.`;
    $('[data-rules-box]', d).hidden = !b.rules;
    $('[data-rules]', d).textContent = b.rules;
    $('[data-count]', d).textContent = b.count > (b.players?.length ?? 0) ? `(Top ${b.players.length} von ${b.count})` : '';

    fill($('[data-board]', d), b.players ?? [], (p) => {
      // Medaille und Preisgeld erst mit Punkten – sonst stünden zu Beginn alle mit 0 auf einem Preisplatz
      const scored = p.points > 0;
      const prize = scored ? prizes[p.place - 1] : '';
      const row = h('li', { class: `x-item cup-row${scored && p.place <= 3 ? ` is-top is-top-${p.place}` : ''}${b.me?.id === p.id ? ' is-me' : ''}` },
        h('span', { class: 'cup-place', 'aria-label': `Platz ${p.place}` }, (scored && MEDAL[p.place]) || `${p.place}.`),
        h('span', { class: 'cup-name' }, h('b', {}, p.name), prize ? h('small', { class: 'cup-prize-tag' }, `💰 ${prize}`) : null));
      if (!admin) {
        row.append(h('span', { class: 'cup-points' }, `${p.points}`, h('small', {}, ' Pkt.')));
        return row;
      }
      const input = h('input', { type: 'number', class: 'cup-points-input', value: String(p.points), min: '-99999', max: '99999', step: '1', 'aria-label': `Punkte von ${p.name}` });
      input.addEventListener('change', () => {
        const v = Math.round(Number(input.value));
        if (Number.isFinite(v) && v !== p.points) this.points(input, p, null, v);
      });
      row.append(h('span', { class: 'cup-edit' },
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `${p.name} einen Punkt abziehen`, onclick: (e) => this.points(e.currentTarget, p, -1) }, '−'),
        input,
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `${p.name} einen Punkt geben`, onclick: (e) => this.points(e.currentTarget, p, 1) }, '+'),
        h('button', {
          class: 'btn btn--ghost btn--sm gw-kick', type: 'button', title: 'Aus dem Cup entfernen', 'aria-label': `${p.name} entfernen`,
          onclick: (e) => { if (confirm(`${p.name} aus dem Cup entfernen?`)) act(e.currentTarget, async () => { this.b = await X.api.cup.remove(p.id); this.render(); }); },
        }, '✕')));
      return row;
    }, b.open ? 'Noch niemand dabei – im Chat mit !cup join beitreten.' : 'Noch niemand dabei.');

    if (!admin) return;
    $('[data-open]', d).textContent = b.open ? '🔒 Anmeldung schließen' : '🟢 Anmeldung öffnen';
    $('[data-test]', d).hidden = !(X.ctx.state.api.demo && b.open);
    $('[data-admin-hint]', d).textContent = b.code_sent_at
      ? `Spielcode verschickt um ${new Date(b.code_sent_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.`
      : this.code ? 'Spielcode gespeichert, noch nicht verschickt.' : 'Noch kein Spielcode eingetragen.';
    // Formular nur füllen, solange niemand darin tippt (Realtime lädt sonst mitten im Schreiben neu)
    if (!this.editing) {
      const form = $('[data-save]', d);
      form.title.value = b.title;
      form.rules.value = b.rules;
      form.code.value = this.code;
      form.open.checked = !!b.open;
      this.setPrizes(prizes);
      this.paintRulesLen();
    }
  },

  tileStatus() {
    const b = this.b;
    if (!this.on || !b) return '🏆 Turnier mit der Community';
    if (b.open) return `🟢 !cup join · ${b.count} dabei`;
    const top = b.players?.[0];
    return top && top.points > 0 ? `🥇 ${top.name} führt (${top.points})` : `🏆 ${b.count} Spieler`;
  },

  async open() {
    if (!openFeature(this)) return;
    this.editing = false;
    this.render();
    await this.load();
    this.render();
  },
};
