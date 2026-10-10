// Spiel-Rad (Migration …_game_packs.sql): „Was spielen wir als Nächstes?“ zwischen den aktiven Games –
// oder eine Challenge passend zum Game (Vorlagen in js/games.js, eigene Listen speichert die Datenbank).
// Das Ergebnis lost die Datenbank aus (gamewheel_spin), Overlay und Bot zeigen es.
import { $, X, act, h, isAdmin, makeDialog, openFeature, paintTile, timeOf, toast } from './extras-core.js';
import { GAMES, activeGames, gameById, liveGameId, packOf } from './games.js';
import { Wheel } from './wheel.js';


export const gamewheel = {
  kind: 'gamewheel', icon: '🎡', cta: 'Drehen →',
  on: false, error: '', g: null, mode: 'game', game: '', seen: 0, wheel: null, subscribed: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-gamewheel', cls: 'x-gamewheel', eyebrow: 'Das Rad entscheidet', title: 'Spiel-Rad',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="gw2-tabs" role="tablist" aria-label="Was soll das Rad entscheiden?">
            <button type="button" role="tab" class="stats-chip" data-mode="game">🎮 Nächstes Game</button>
            <button type="button" role="tab" class="stats-chip" data-mode="challenge">🎯 Challenge</button>
          </div>
          <label class="field gw2-game" data-game-field hidden><span>Challenge für</span><select name="game" data-game></select></label>
          <div class="gw2-stage">
            <span class="gw2-pointer" aria-hidden="true">▼</span>
            <canvas class="gw2-canvas" data-canvas width="400" height="400" role="img" aria-label="Spiel-Rad"></canvas>
          </div>
          <p class="gw2-result" data-result aria-live="polite"></p>
          <button class="btn btn--primary" type="button" data-spin>🎡 Drehen</button>
          <p class="form-hint" data-hint></p>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box" data-game-box>
            <h3 class="prank-h3">Games auf dem Rad</h3>
            <p class="form-hint">Alle Games, die du im Dashboard angeschaltet hast. Ändern: oben bei den Content-Ideen unter „Games verwalten“.</p>
            <label class="toggle"><input type="checkbox" name="auto" data-auto><span class="toggle-ui" aria-hidden="true"></span>Gewonnenes Game gleich im Dashboard einstellen</label>
          </section>
          <section class="bingo-box" data-ch-box hidden>
            <h3 class="prank-h3">Challenges <small data-ch-src></small></h3>
            <label class="field"><span>Eine pro Zeile (2–16)</span><textarea name="challenges" rows="9" data-ch></textarea></label>
            <div class="x-row">
              <button class="btn btn--primary btn--sm" type="button" data-ch-save>💾 Speichern</button>
              <button class="btn btn--ghost btn--sm" type="button" data-ch-reset>Vorlage</button>
            </div>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    this.wheel = new Wheel($('[data-canvas]', d));
    d.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { this.mode = b.dataset.mode; this.render(); }));
    $('[data-game]', d).addEventListener('change', (e) => { this.game = e.currentTarget.value; this.render(); });
    $('[data-spin]', d).addEventListener('click', (e) => this.spin(e.currentTarget));
    $('[data-auto]', d).addEventListener('change', (e) => act(null, async () => {
      this.g = await X.api.gamewheel.save({ auto: e.currentTarget.checked });
      toast('Gespeichert.', 'ok', 1500);
    }));
    $('[data-ch-save]', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
      const list = $('[data-ch]', d).value.split('\n').map((x) => x.trim()).filter(Boolean);
      if (list.length < 2) throw new Error('Mindestens 2 Challenges eintragen.');
      this.g = await X.api.gamewheel.save({ game: this.game, challenges: list });
      this.render();
    }, 'Challenges gespeichert.'));
    $('[data-ch-reset]', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
      this.g = await X.api.gamewheel.save({ game: this.game, challenges: [] });
      this.render();
    }, 'Vorlage wiederhergestellt.'));
  },

  // Aktuelles Game im Dashboard (gerade live → gewählt → erstes aktives mit Paket)
  currentGame() {
    const sg = X.ctx.state.games?.data;
    const id = liveGameId(sg) || sg?.current || '';
    if (packOf(id)) return id;
    return activeGames(sg).find((g) => packOf(g.id))?.id ?? 'just-chatting';
  },

  challengesFor(id) {
    const own = this.g?.challenges?.[id];
    return Array.isArray(own) && own.length >= 2 ? { list: own, own: true } : { list: packOf(id)?.challenges ?? [], own: false };
  },

  options() {
    if (this.mode === 'game') {
      const games = activeGames(X.ctx.state.games?.data);
      return { labels: games.map((g) => `${g.icon} ${g.name}`), ids: games.map((g) => g.id) };
    }
    return { labels: this.challengesFor(this.game).list, ids: null };
  },

  async spin(btn) {
    if (this.wheel.busy) return;
    const { labels, ids } = this.options();
    if (labels.length < 2) {
      toast(this.mode === 'game' ? 'Mindestens zwei Games anschalten (Games verwalten).' : 'Für dieses Game fehlen Challenges.', 'error');
      return;
    }
    await act(btn, async () => {
      this.wheel.setVariant({ segments: labels.map((label) => ({ label })), color: this.mode === 'game' ? '#4f7cff' : '#ff4fd8' });
      this.wheel.start();
      const g = await X.api.gamewheel.spin({ mode: this.mode, options: labels, ids, game: this.mode === 'challenge' ? this.game : '' });
      this.g = g;
      this.seen = g.n;
      $('[data-result]', this.dialog).textContent = '';
      await this.wheel.spinTo(g.result_index);
      this.showResult();
      // Bot verkündet erst jetzt (sonst verrät der Chat das Ergebnis, bevor das Rad steht)
      X.api.gamewheel.announce();
      // Demo: „automatisch wechseln“ macht hier die Seite (live die Datenbank)
      if (X.ctx.state.api.demo && g.mode === 'game' && g.auto_switch && ids) {
        const sg = X.ctx.state.games?.data ?? {};
        await X.ctx.state.api.saveStreamGames({ active: sg.active ?? [], current: ids[g.result_index], auto: sg.auto ?? true }).catch(() => {});
      }
    });
  },

  showResult() {
    const g = this.g;
    const el = $('[data-result]', this.dialog);
    if (!g?.spun_at) { el.textContent = ''; return; }
    const what = g.mode === 'game' ? 'Nächstes Game' : `Challenge${g.game ? ` (${gameById(g.game)?.name ?? g.game})` : ''}`;
    el.replaceChildren(h('small', {}, `${what} · ${timeOf(g.spun_at)} Uhr`), h('b', {}, g.result));
    paintTile(this);
  },

  async load() {
    try {
      const g = await X.api.gamewheel.get();
      Object.assign(this, { g: g ?? { challenges: {}, auto_switch: true, n: 0 }, on: true, error: '' });
      if (!this.seen) this.seen = this.g.n;
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      X.api.on('gamewheel', async (row) => {
        // Jemand anderes (Mod) hat gedreht: hier mitdrehen
        if (row?.n && row.n > this.seen && !this.wheel.busy) {
          this.seen = row.n;
          this.g = { ...this.g, ...row };
          if (this.dialog.open && row.options?.length >= 2) {
            this.wheel.setVariant({ segments: row.options.map((label) => ({ label })), color: row.mode === 'game' ? '#4f7cff' : '#ff4fd8' });
            this.wheel.start();
            await this.wheel.spinTo(row.result_index);
          }
          this.showResult();
        } else if (row) {
          this.g = { ...this.g, ...row };
        }
      });
    }
    paintTile(this);
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
        : 'Das Spiel-Rad ist noch nicht eingerichtet. Schau später noch mal vorbei.';
      return;
    }
    if (!this.game) this.game = this.currentGame();
    d.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === this.mode)));
    $('[data-game-field]', d).hidden = this.mode !== 'challenge';
    const sel = $('[data-game]', d);
    sel.replaceChildren(...GAMES.filter((g) => packOf(g.id)).map((g) => new Option(`${g.icon} ${g.name}`, g.id, false, g.id === this.game)));
    const { labels } = this.options();
    if (!this.wheel.busy) {
      this.wheel.setVariant({ segments: (labels.length >= 2 ? labels : ['?', '?']).map((label) => ({ label })), color: this.mode === 'game' ? '#4f7cff' : '#ff4fd8' });
    }
    $('[data-spin]', d).hidden = !admin;
    $('[data-spin]', d).disabled = labels.length < 2;
    $('[data-hint]', d).textContent = admin
      ? (this.mode === 'game' ? `${labels.length} Games auf dem Rad. Das Ergebnis sieht der Stream in der OBS-Ebene „Spiel-Rad“, der Bot sagt es im Chat.` : 'Die Challenge erscheint im Overlay und im Chat.')
      : 'Drehen dürfen der Streamer und die Mods – du siehst hier mit.';
    this.showResult();
    if (!admin) return;
    $('[data-auto]', d).checked = this.g?.auto_switch !== false;
    $('[data-game-box]', d).hidden = this.mode !== 'game';
    $('[data-ch-box]', d).hidden = this.mode !== 'challenge';
    const ch = this.challengesFor(this.game);
    const area = $('[data-ch]', d);
    if (document.activeElement !== area) area.value = ch.list.join('\n');
    $('[data-ch-src]', d).textContent = ch.own ? '· eigene' : '· Vorlage';
    $('[data-ch-reset]', d).hidden = !ch.own;
  },

  tileStatus() {
    const g = this.g;
    if (!this.on || !g?.spun_at) return '🎡 Was kommt als Nächstes?';
    return `🎡 ${g.result}`;
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};
