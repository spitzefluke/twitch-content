// Zähler: Tode, Kills, Versuche, Jumpscares … (Migration …_game_packs.sql). Bis zu 12 je Kanal.
// Streamer und Mods zählen hier oder im Chat („!tode +“, „!tode -2“, „!tode =5“); „!tode“ zeigt allen den Stand.
// Vorlagen je Game stehen in js/games.js (PACKS).
import { $, X, act, fill, h, isAdmin, makeDialog, onSubmit, openFeature, paintTile, toast } from './extras-core.js';
import { GAMES, PACKS } from './games.js';

export const counter = {
  kind: 'counter', icon: '🔢', cta: 'Zähler →',
  on: false, error: '', list: [], editing: null, subscribed: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-counter', cls: 'x-counter', eyebrow: 'Live im Stream · Chat: !befehl', title: 'Zähler',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <ul class="ct-list" data-list aria-live="polite"></ul>
          <p class="form-hint" data-hint></p>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3" data-form-title>Neuer Zähler</h3>
            <form class="x-form" data-form>
              <div class="ct-row">
                <label class="field ct-emoji"><span>Symbol</span><input type="text" name="emoji" maxlength="8" value="💀" required></label>
                <label class="field"><span>Name</span><input type="text" name="label" maxlength="24" required placeholder="z. B. Tode"></label>
              </div>
              <label class="field"><span>Chat-Befehl (ohne !)</span><input type="text" name="command" maxlength="20" placeholder="z. B. tode" autocomplete="off"></label>
              <label class="toggle"><input type="checkbox" name="show" checked><span class="toggle-ui" aria-hidden="true"></span>Im Stream und im Twitch-Panel zeigen</label>
              <div class="x-row">
                <button class="btn btn--primary btn--sm" type="submit" data-submit>➕ Anlegen</button>
                <button class="btn btn--ghost btn--sm" type="button" data-cancel hidden>Abbrechen</button>
              </div>
            </form>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Vorlagen</h3>
            <div class="x-row ct-packs" data-packs></div>
            <p class="form-hint">Legt die passenden Zähler an (was es schon gibt, bleibt). Mods und du zählen im Chat mit <b>!tode +</b>, <b>!tode -2</b> oder <b>!tode =5</b>; alle anderen sehen mit <b>!tode</b> den Stand.</p>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    const reload = async () => { await this.load(); this.render(); };
    $('[data-packs]', d).replaceChildren(...Object.keys(PACKS).map((id) => {
      const game = GAMES.find((g) => g.id === id);
      return h('button', {
        type: 'button', class: 'btn btn--outline btn--sm',
        onclick: (e) => act(e.currentTarget, async () => {
          const have = new Set(this.list.map((c) => c.command));
          let added = 0;
          for (const [label, emoji, command] of PACKS[id].counters) {
            if (have.has(command)) continue;
            await X.api.counters.save({ label, emoji, command, show: true, game: id });
            added++;
          }
          await reload();
          toast(added ? `${added} Zähler für ${game?.name ?? id} angelegt.` : 'Die gibt es schon alle.', 'ok');
        }),
      }, `${game?.icon ?? ''} ${game?.name ?? id}`);
    }));
    onSubmit($('[data-form]', d), async (form) => {
      await X.api.counters.save({
        id: this.editing, label: form.label.value, emoji: form.emoji.value, command: form.command.value, show: form.show.checked,
      });
      toast(this.editing ? 'Gespeichert.' : 'Zähler angelegt.', 'ok', 2000);
      this.edit(null);
      await reload();
    });
    $('[data-cancel]', d).addEventListener('click', () => this.edit(null));
  },

  edit(c) {
    const f = $('[data-form]', this.dialog);
    this.editing = c?.id ?? null;
    f.emoji.value = c?.emoji ?? '💀';
    f.label.value = c?.label ?? '';
    f.command.value = c?.command ?? '';
    f.show.checked = c?.show ?? true;
    $('[data-form-title]', this.dialog).textContent = c ? `„${c.label}“ bearbeiten` : 'Neuer Zähler';
    $('[data-submit]', this.dialog).textContent = c ? '💾 Speichern' : '➕ Anlegen';
    $('[data-cancel]', this.dialog).hidden = !c;
    if (c) f.label.focus();
  },

  async load() {
    try {
      const list = await X.api.counters.list();
      Object.assign(this, { list: list ?? [], on: true, error: '' });
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      let timer = 0;
      X.api.on('counters', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => { await this.load(); if (this.dialog.open) this.render(); }, 200);
      });
    }
    paintTile(this);
  },

  async change(btn, c, delta, set = null) {
    await act(btn, async () => {
      const row = await X.api.counters.add(c.id, delta, set);
      Object.assign(c, row);
      this.render();
      paintTile(this);
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
        ? `Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20261106000000_game_packs.sql ausführen.${this.error ? ` (${this.error})` : ''}`
        : 'Zähler sind noch nicht eingerichtet. Schau später noch mal vorbei.';
      return;
    }
    fill($('[data-list]', d), this.list, (c, i) => h('li', { class: `ct-item${c.show ? '' : ' is-off'}` },
      h('span', { class: 'ct-emoji-big', 'aria-hidden': 'true' }, c.emoji),
      h('div', { class: 'ct-main' },
        h('b', { class: 'ct-value' }, String(c.value)),
        h('span', { class: 'ct-label' }, c.label),
        h('small', {}, [c.command ? `!${c.command}` : 'kein Chat-Befehl', c.show ? '' : 'nicht im Stream'].filter(Boolean).join(' · '))),
      admin && h('div', { class: 'ct-actions' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': `${c.label} minus 1`, onclick: (e) => this.change(e.currentTarget, c, -1) }, '−1'),
        h('button', { type: 'button', class: 'btn btn--primary btn--sm ct-plus', 'aria-label': `${c.label} plus 1`, onclick: (e) => this.change(e.currentTarget, c, 1) }, '+1'),
        h('button', {
          type: 'button', class: 'btn btn--ghost btn--sm', title: 'Wert setzen', 'aria-label': `${c.label} auf Wert setzen`,
          onclick: (e) => {
            const v = prompt(`Neuer Wert für „${c.label}“:`, String(c.value));
            if (v === null) return;
            const n = Number.parseInt(v, 10);
            if (!Number.isFinite(n)) { toast('Bitte eine Zahl eingeben.', 'error'); return; }
            this.change(e.currentTarget, c, 0, n);
          },
        }, '='),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', title: 'Bearbeiten', 'aria-label': `${c.label} bearbeiten`, onclick: () => this.edit(c) }, '✏️'),
        i > 0 && h('button', {
          type: 'button', class: 'btn btn--ghost btn--sm', title: 'Nach oben', 'aria-label': `${c.label} nach oben`,
          onclick: (e) => act(e.currentTarget, async () => {
            const ids = this.list.map((x) => x.id);
            [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
            await X.api.counters.order(ids);
            await this.load();
            this.render();
          }),
        }, '↑'),
        h('button', {
          type: 'button', class: 'btn btn--ghost btn--sm', title: 'Löschen', 'aria-label': `${c.label} löschen`,
          onclick: (e) => {
            if (!confirm(`Zähler „${c.label}“ löschen?`)) return;
            act(e.currentTarget, async () => { await X.api.counters.remove(c.id); await this.load(); this.render(); });
          },
        }, '🗑'))),
    admin ? 'Noch keine Zähler – rechts anlegen oder eine Vorlage wählen.' : 'Noch keine Zähler.');
    const cmds = this.list.filter((c) => c.command).map((c) => `!${c.command}`);
    $('[data-hint]', d).textContent = cmds.length ? `Im Chat: ${cmds.join(' · ')} zeigt den Stand.` : '';
  },

  tileStatus() {
    const c = this.list[0];
    if (!this.on || !c) return '🔢 Tode, Kills, Versuche …';
    return this.list.slice(0, 2).map((x) => `${x.emoji} ${x.value}`).join(' · ');
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};
