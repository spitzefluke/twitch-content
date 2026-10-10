// Chat-Kommandos (Migration …_chat_control.sql): Der Chat steuert das Spiel. Zuschauer tippen „!springen“
// oder lösen eine Kanalpunkte-Belohnung ein – das Overlay (Ebene „Chat-Kommandos“) zeigt groß, was der Streamer
// tun muss. Modus „direkt“ (jedes Kommando sofort) oder „abstimmen“ (alle X Sekunden gewinnt das häufigste).
// Vorlagen je Game: js/games.js (PACKS → commands).
import { $, X, act, clock, fill, h, isAdmin, makeDialog, onSubmit, onTick, openFeature, paintTile, secondsUntil, timeOf, toast } from './extras-core.js';
import { GAMES, PACKS } from './games.js';

const SOURCE = { chat: '💬', points: '🪙', vote: '🗳️', web: '🖱️' };

export const chatcontrol = {
  kind: 'chatcontrol', icon: '🕹️', cta: 'Kommandos →',
  on: false, error: '', cfg: null, cmds: [], events: [], editing: null, subscribed: false, ticking: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-chatcontrol', cls: 'x-chatcontrol', eyebrow: 'Der Chat steuert das Spiel', title: 'Chat-Kommandos',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero cc-hero" data-hero aria-live="polite"></div>
          <h3 class="prank-h3">Kommandos <small data-count></small></h3>
          <ul class="x-list cc-list" data-list></ul>
          <h3 class="prank-h3">Zuletzt</h3>
          <ul class="x-list x-list--compact" data-events></ul>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Einstellungen</h3>
            <form class="x-form" data-settings>
              <label class="toggle"><input type="checkbox" name="enabled"><span class="toggle-ui" aria-hidden="true"></span>Chat-Kommandos an</label>
              <label class="field"><span>Modus</span><select name="mode">
                <option value="direct">Direkt – jedes Kommando sofort</option>
                <option value="vote">Abstimmen – das häufigste gewinnt</option>
              </select></label>
              <label class="field" data-vote-field><span>Abstimm-Runde (Sekunden)</span><input type="number" name="vote" min="10" max="120" step="5"></label>
              <label class="field" data-user-field><span>Pause je Zuschauer (Sekunden)</span><input type="number" name="user" min="0" max="600" step="5"></label>
              <label class="field"><span>So lange im Stream (Sekunden)</span><input type="number" name="show" min="2" max="30"></label>
            </form>
            <div class="x-row">
              <button class="btn btn--outline btn--sm" type="button" data-sync>🪙 Kanalpunkte abgleichen</button>
              <button class="btn btn--outline btn--sm" type="button" data-sim hidden>💬 Chat simulieren (Demo)</button>
            </div>
            <p class="form-hint" data-sync-hint>Kommandos mit Kanalpunkten bekommen eine eigene Belohnung bei Twitch („🎮 …“). Nach dem Ändern einmal abgleichen.</p>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3" data-form-title>Neues Kommando</h3>
            <form class="x-form" data-form>
              <div class="ct-row">
                <label class="field ct-emoji"><span>Symbol</span><input type="text" name="emoji" maxlength="8" value="🦘" required></label>
                <label class="field"><span>Befehl (ohne !)</span><input type="text" name="word" maxlength="20" required placeholder="springen" autocomplete="off"></label>
              </div>
              <label class="field"><span>Was du tun musst</span><input type="text" name="label" maxlength="40" required placeholder="Spring!"></label>
              <div class="ct-row cc-row2">
                <label class="field"><span>Abklingzeit (s)</span><input type="number" name="cooldown" min="0" max="3600" value="15"></label>
                <label class="field"><span>Kanalpunkte (0 = keine)</span><input type="number" name="cost" min="0" max="1000000" step="50" value="0"></label>
              </div>
              <label class="toggle"><input type="checkbox" name="chat" checked><span class="toggle-ui" aria-hidden="true"></span>Kostenlos per Chat-Befehl</label>
              <div class="x-row">
                <button class="btn btn--primary btn--sm" type="submit" data-submit>➕ Anlegen</button>
                <button class="btn btn--ghost btn--sm" type="button" data-cancel hidden>Abbrechen</button>
              </div>
            </form>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Vorlagen</h3>
            <div class="x-row ct-packs" data-packs></div>
            <p class="form-hint">Legt die passenden Kommandos an (was es schon gibt, bleibt). Teure Kommandos (z. B. „Waffe wegwerfen“) gehen nur mit Kanalpunkten.</p>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    const reload = async () => { await this.load(); this.render(); };
    $('[data-settings]', d).addEventListener('change', async (e) => {
      const f = e.currentTarget;
      try {
        this.cfg = await X.api.chatcontrol.saveSettings({
          enabled: f.enabled.checked, mode: f.mode.value, voteSeconds: Number(f.vote.value), userCooldown: Number(f.user.value), showSeconds: Number(f.show.value),
        });
        toast('Gespeichert.', 'ok', 1500);
      } catch (err) {
        toast(X.ctx.germanError(err), 'error');
      }
      await reload();
    });
    $('[data-packs]', d).replaceChildren(...Object.keys(PACKS).filter((id) => PACKS[id].commands?.length).map((id) => {
      const game = GAMES.find((g) => g.id === id);
      return h('button', {
        type: 'button', class: 'btn btn--outline btn--sm',
        onclick: (e) => act(e.currentTarget, async () => {
          const have = new Set(this.cmds.map((c) => c.word));
          let added = 0;
          for (const [word, label, emoji, cooldown, cost = 0] of PACKS[id].commands) {
            if (have.has(word)) continue;
            await X.api.chatcontrol.save({ word, label, emoji, cooldown, cost, chat: !cost, game: id });
            added++;
          }
          await reload();
          toast(added ? `${added} Kommandos für ${game?.name ?? id} angelegt.` : 'Die gibt es schon alle.', 'ok');
        }),
      }, `${game?.icon ?? ''} ${game?.name ?? id}`);
    }));
    onSubmit($('[data-form]', d), async (form) => {
      await X.api.chatcontrol.save({
        id: this.editing, word: form.word.value, label: form.label.value, emoji: form.emoji.value,
        cooldown: Number(form.cooldown.value), cost: Number(form.cost.value), chat: form.chat.checked,
        enabled: this.editing ? (this.cmds.find((c) => c.id === this.editing)?.enabled ?? true) : true,
      });
      toast(this.editing ? 'Gespeichert.' : 'Kommando angelegt.', 'ok', 2000);
      this.edit(null);
      await reload();
    });
    $('[data-cancel]', d).addEventListener('click', () => this.edit(null));
    $('[data-sync]', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
      const res = await X.api.chatcontrol.sync();
      const bad = (res?.commands ?? []).filter((c) => c.error);
      await reload();
      toast(bad.length ? `${bad.length} Belohnung(en) mit Fehler – siehe Liste.` : 'Belohnungen bei Twitch sind auf dem Stand.', bad.length ? 'error' : 'ok');
    }));
    $('[data-sim]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { await X.api.chatcontrol.simulate(6); await reload(); }));
    // Abstimm-Runde: Countdown, und wenn sie abläuft, auswerten lassen
    onTick(() => {
      const c = this.cfg;
      if (!c?.round_ends_at) return;
      const left = secondsUntil(c.round_ends_at);
      const el = this.dialog.open && $('[data-left]', this.dialog);
      if (el) el.textContent = left > 0 ? clock(left) : '…';
      if (left === 0 && !this.ticking) {
        this.ticking = true;
        X.api.chatcontrol.tick().catch(() => {}).then(() => this.load()).then(() => { this.ticking = false; if (this.dialog.open) this.render(); });
      }
    });
  },

  edit(c) {
    const f = $('[data-form]', this.dialog);
    this.editing = c?.id ?? null;
    f.emoji.value = c?.emoji ?? '🦘';
    f.word.value = c?.word ?? '';
    f.label.value = c?.label ?? '';
    f.cooldown.value = String(c?.cooldown ?? 15);
    f.cost.value = String(c?.cost ?? 0);
    f.chat.checked = c?.chat ?? true;
    $('[data-form-title]', this.dialog).textContent = c ? `!${c.word} bearbeiten` : 'Neues Kommando';
    $('[data-submit]', this.dialog).textContent = c ? '💾 Speichern' : '➕ Anlegen';
    $('[data-cancel]', this.dialog).hidden = !c;
    if (c) f.label.focus();
  },

  async load() {
    try {
      const [cfg, cmds, events] = await Promise.all([X.api.chatcontrol.get(), X.api.chatcontrol.commands(), X.api.chatcontrol.events(12)]);
      Object.assign(this, { cfg: cfg ?? { enabled: true, mode: 'direct', vote_seconds: 30, user_cooldown: 20, show_seconds: 6, tally: {} }, cmds: cmds ?? [], events: events ?? [], on: true, error: '' });
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      let timer = 0;
      const again = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => { await this.load(); if (this.dialog.open) this.render(); }, 250);
      };
      X.api.on('cc_events', again);
      X.api.on('chat_control', again);
      X.api.on('cc_commands', again);
    }
    paintTile(this);
  },

  async toggle(btn, c) {
    await act(btn, async () => {
      await X.api.chatcontrol.save({ ...c, enabled: !c.enabled });
      await this.load();
      this.render();
    });
  },

  renderHero() {
    const c = this.cfg ?? {};
    const hero = $('[data-hero]', this.dialog);
    if (!c.enabled) { hero.replaceChildren(h('p', { class: 'cc-off' }, '⏸️ Die Chat-Kommandos sind gerade aus.')); return; }
    if (c.mode === 'vote' && c.round_ends_at) {
      const tally = c.tally ?? {};
      const rows = this.cmds.map((x) => ({ x, n: Number(tally[x.id] ?? 0) })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
      const total = rows.reduce((s, r) => s + r.n, 0) || 1;
      hero.replaceChildren(
        h('p', { class: 'cc-vote-head' }, h('b', {}, '🗳️ Der Chat stimmt ab'), h('span', { 'data-left': true }, clock(secondsUntil(c.round_ends_at)))),
        h('div', { class: 'pl-opts' }, ...rows.map((r) => h('div', { class: 'pl-opt', style: { '--p': `${Math.round((100 * r.n) / total)}%` } },
          h('span', { class: 'pl-n' }, r.x.emoji), h('span', { class: 'pl-label' }, `!${r.x.word} · ${r.x.label}`), h('span', { class: 'pl-pct' }, String(r.n))))),
        h('small', { class: 'cc-sub' }, `${c.voters} ${c.voters === 1 ? 'Stimme' : 'Stimmen'} – am Ende gewinnt das häufigste Kommando.`));
      return;
    }
    const last = this.events[0];
    hero.replaceChildren(last
      ? h('div', { class: 'cc-last' }, h('span', { class: 'cc-last-emoji', 'aria-hidden': 'true' }, last.emoji), h('b', {}, last.label),
        h('small', {}, `${SOURCE[last.source] ?? ''} !${last.word} · ${last.who || 'Chat'}${last.votes ? ` · ${last.votes} Stimmen` : ''} · ${timeOf(last.created_at)} Uhr`))
      : h('p', { class: 'cc-off' }, c.mode === 'vote' ? 'Sobald jemand ein Kommando tippt, startet eine Abstimm-Runde.' : 'Noch kein Kommando – tippt eins in den Chat!'));
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
        ? `Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20261107000000_chat_control.sql ausführen.${this.error ? ` (${this.error})` : ''}`
        : 'Chat-Kommandos sind noch nicht eingerichtet. Schau später noch mal vorbei.';
      return;
    }
    this.renderHero();
    const c = this.cfg ?? {};
    const list = admin ? this.cmds : this.cmds.filter((x) => x.enabled);
    $('[data-count]', d).textContent = list.length ? `· ${list.length}` : '';
    fill($('[data-list]', d), list, (x) => h('li', { class: `x-item cc-item${x.enabled ? '' : ' is-off'}` },
      h('span', { class: 'cc-emoji', 'aria-hidden': 'true' }, x.emoji),
      h('div', { class: 'cc-main' },
        h('b', {}, x.label),
        h('small', {}, [
          x.chat ? `!${x.word}` : 'nur Kanalpunkte',
          x.cost ? `🪙 ${x.cost.toLocaleString('de-DE')}` : '',
          x.cooldown ? `alle ${x.cooldown} s` : '',
          admin && x.uses ? `${x.uses}× ausgelöst` : '',
        ].filter(Boolean).join(' · ')),
        admin && x.reward_error ? h('small', { class: 'cc-err' }, `⚠️ ${x.reward_error}`) : null),
      admin && h('span', { class: 'x-item-actions' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', title: 'Im Overlay ausprobieren', 'aria-label': `!${x.word} ausprobieren`, onclick: (e) => act(e.currentTarget, async () => { await X.api.chatcontrol.test(x.id); await this.load(); this.render(); }) }, '▶'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', title: x.enabled ? 'Ausschalten' : 'Einschalten', 'aria-label': `!${x.word} ${x.enabled ? 'aus' : 'an'}schalten`, onclick: (e) => this.toggle(e.currentTarget, x) }, x.enabled ? '⏸' : '⏵'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', title: 'Bearbeiten', 'aria-label': `!${x.word} bearbeiten`, onclick: () => this.edit(x) }, '✏️'),
        h('button', {
          type: 'button', class: 'btn btn--ghost btn--sm', title: 'Löschen', 'aria-label': `!${x.word} löschen`,
          onclick: (e) => {
            if (!confirm(`Kommando !${x.word} löschen?${x.reward_id ? ' Danach „Kanalpunkte abgleichen“, damit die Belohnung bei Twitch verschwindet.' : ''}`)) return;
            act(e.currentTarget, async () => { await X.api.chatcontrol.remove(x.id); await this.load(); this.render(); });
          },
        }, '🗑'))),
    admin ? 'Noch keine Kommandos – rechts anlegen oder eine Vorlage wählen.' : 'Noch keine Kommandos.');
    fill($('[data-events]', d), this.events.slice(0, 8), (e) => h('li', { class: 'x-item' },
      h('span', {}, `${e.emoji} ${e.label}`),
      h('small', {}, `${SOURCE[e.source] ?? ''} ${e.who || 'Chat'}${e.votes ? ` (${e.votes} Stimmen)` : ''} · ${timeOf(e.created_at)}`)),
    'Noch nichts passiert.');

    if (!admin) return;
    const f = $('[data-settings]', d);
    if (!f.contains(document.activeElement)) {
      f.enabled.checked = c.enabled !== false;
      f.mode.value = c.mode ?? 'direct';
      f.vote.value = String(c.vote_seconds ?? 30);
      f.user.value = String(c.user_cooldown ?? 20);
      f.show.value = String(c.show_seconds ?? 6);
    }
    $('[data-vote-field]', d).hidden = c.mode !== 'vote';
    $('[data-user-field]', d).hidden = c.mode === 'vote';
    $('[data-sim]', d).hidden = !X.ctx.state.api.demo;
    $('[data-sync]', d).hidden = X.ctx.state.api.demo;
  },

  tileStatus() {
    if (!this.on || !this.cfg) return '🕹️ Der Chat steuert das Spiel';
    if (!this.cfg.enabled) return '🕹️ Gerade aus';
    if (this.cfg.round_ends_at) return '🗳️ Der Chat stimmt ab …';
    const last = this.events[0];
    return last ? `${last.emoji} ${last.label}` : `🕹️ ${this.cmds.filter((x) => x.enabled).length} Kommandos`;
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};
