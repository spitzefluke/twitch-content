// Verlosung: Der Streamer legt einen Preis fest, Zuschauer schreiben den Befehl (Standard !verlosung)
// in den Chat – nur Follower, jeder einmal. „Gewinner ziehen“ lost in der Datenbank (giveaway_draw).
// Die Follower-Prüfung macht die Edge Function twitch-eventsub (Migration …_giveaway.sql).
// Streamer und Mods können Teilnehmer rauswerfen und zurückholen (…_giveaway_kick.sql).
import { $, X, act, fill, h, isAdmin, makeDialog, onSubmit, onTick, openFeature, paintTile, secondsUntil, clock, timeOf, toast } from './extras-core.js';

const DURATIONS = [0, 2, 5, 10, 15, 30, 60];
const CONFETTI = ['#ff4fd8', '#ffd36b', '#3ddc84', '#35c7ff', '#9146ff'];

export const giveaway = {
  kind: 'giveaway', icon: '🎁', cta: 'Mitmachen →',
  on: false, error: '', g: null, entries: [], winners: [], me: null, subscribed: false, dialog: null, rolling: false,

  setup() {
    this.dialog = makeDialog({
      id: 'x-giveaway', cls: 'x-giveaway', eyebrow: 'Befehl im Chat · nur Follower · jeder einmal', title: 'Verlosung',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero gw-hero" data-hero>
            <span class="gw-gift" aria-hidden="true">🎁</span>
            <b class="gw-prize" data-prize></b>
            <span class="gw-state" data-state aria-live="polite"></span>
            <span class="gw-roll" data-roll aria-live="polite"></span>
            <span class="gw-meta"><span class="gw-chip" data-count></span><span class="gw-chip" data-cmd></span><span class="gw-chip" data-time hidden></span></span>
            <span class="gw-fx" data-fx aria-hidden="true"></span>
          </div>
          <section class="bingo-box">
            <h3 class="prank-h3">Du</h3>
            <p class="gw-me" data-me></p>
          </section>
          <h3 class="prank-h3">🍀 Im Lostopf <small data-total></small></h3>
          <ul class="x-list gw-list" data-entries></ul>
          <div data-kicked-box hidden>
            <h3 class="prank-h3">🚫 Rausgeworfen <small>sehen nur Streamer und Mods</small></h3>
            <ul class="x-list x-list--compact gw-list" data-kicked></ul>
          </div>
          <h3 class="prank-h3">🏆 Letzte Gewinner</h3>
          <ul class="x-list" data-winners></ul>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Steuern</h3>
            <div class="x-row">
              <button class="btn btn--primary btn--sm" type="button" data-draw>🎲 Gewinner ziehen</button>
              <button class="btn btn--ghost btn--sm" type="button" data-close>🔒 Schließen</button>
              <button class="btn btn--ghost btn--sm" type="button" data-reset>Beenden</button>
            </div>
            <button class="btn btn--outline btn--sm" type="button" data-test hidden>➕ 5 Test-Teilnehmer (Demo)</button>
            <p class="form-hint" data-admin-hint></p>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Neue Verlosung</h3>
            <form class="x-form" data-start>
              <label class="field"><span>Preis</span><input type="text" name="prize" maxlength="100" required placeholder="z. B. 1000 V-Bucks oder ein Spiel deiner Wahl"></label>
              <label class="field"><span>Befehl im Chat</span><input type="text" name="command" maxlength="21" placeholder="!verlosung"></label>
              <label class="field"><span>Dauer</span><select name="minutes"></select></label>
              <label class="toggle"><input type="checkbox" name="followers" checked><span class="toggle-ui" aria-hidden="true"></span>Nur Follower dürfen mitmachen</label>
              <label class="toggle"><input type="checkbox" name="confirm" checked><span class="toggle-ui" aria-hidden="true"></span>Bot bestätigt jede Teilnahme im Chat</label>
              <button class="btn btn--primary btn--sm" type="submit">🎁 Verlosung starten</button>
              <p class="form-hint">Beim Start verkündet der Bot Preis und Befehl im Chat, beim Ziehen den Gewinner. Jeder darf pro Verlosung nur einmal mitmachen.</p>
            </form>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    d.querySelector('[name=minutes]').replaceChildren(...DURATIONS.map((m) => new Option(m ? `${m} Minuten` : 'bis ich schließe', String(m))));
    const reload = async () => { await this.load(); this.render(); };
    onSubmit($('[data-start]', d), async (form) => {
      if (this.g?.status === 'open' && !confirm('Es läuft schon eine Verlosung. Neu starten? Der Lostopf wird geleert.')) return;
      this.g = await X.api.giveaway.start({
        prize: form.prize.value, command: form.command.value, minutes: Number(form.minutes.value),
        followersOnly: form.followers.checked, confirm: form.confirm.checked,
      });
      toast(`Verlosung läuft – im Chat mit ${this.g.command} mitmachen.`, 'ok');
      await reload();
    });
    $('[data-draw]', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
      const before = this.entries.filter((x) => !x.kicked).map((x) => x.name);
      const g = await X.api.giveaway.draw();
      this.g = g;
      await this.load();
      await this.roll(before.length ? before : [g.winner_name], g.winner_name);
      this.render();
    }));
    $('[data-close]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { this.g = await X.api.giveaway.close(); await reload(); }));
    $('[data-reset]', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
      if (!confirm('Verlosung beenden? Sie verschwindet aus dem Overlay.')) return;
      this.g = await X.api.giveaway.reset();
      await reload();
    }));
    $('[data-test]', d).addEventListener('click', (e) => act(e.currentTarget, async () => { await X.api.giveaway.addTest(5); await reload(); }));
    onTick(() => { if (this.dialog.open) this.paintTime(); });
  },

  async load() {
    try {
      const g = await X.api.giveaway.get();
      if (!g) throw new Error('Tabelle giveaway fehlt.');
      const [entries, winners] = await Promise.all([
        g.round ? X.api.giveaway.entries(g.round) : [],
        X.api.giveaway.winners().catch(() => []),
      ]);
      Object.assign(this, { g, entries, winners, on: true, error: '' });
      this.me = X.ctx.state.user && g.round ? await X.api.giveaway.me().catch(() => null) : null;
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      let timer = 0;
      X.api.on('giveaway', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const was = this.g;
          await this.load();
          if (!this.dialog.open) return;
          // Hat jemand anderes gezogen (Mod im anderen Fenster)? Dann hier auch die Auslosung zeigen
          if (this.g?.draws > (was?.draws ?? 0) && !this.rolling) await this.roll(this.entries.filter((x) => !x.kicked).map((x) => x.name), this.g.winner_name);
          this.render();
        }, 250);
      });
    }
    paintTile(this);
  },

  // Namen laufen durch, dann steht der Gewinner da (mit Konfetti)
  async roll(names, winner) {
    const el = $('[data-roll]', this.dialog);
    if (!el || !winner) return;
    this.rolling = true;
    el.classList.remove('is-winner');
    el.classList.add('is-rolling');
    const pool = names.length ? names : [winner];
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (let i = 0, delay = 50; !still && delay < 260; i++, delay *= 1.12) {
      el.textContent = pool[Math.floor(Math.random() * pool.length)];
      await new Promise((r) => setTimeout(r, delay));
    }
    el.classList.remove('is-rolling');
    el.textContent = `🏆 ${winner}`;
    void el.offsetWidth;
    el.classList.add('is-winner');
    if (!still) this.confetti();
    this.rolling = false;
  },

  confetti() {
    const fx = $('[data-fx]', this.dialog);
    fx.replaceChildren(...Array.from({ length: 36 }, (_, n) => {
      const i = h('i', { style: { background: CONFETTI[n % CONFETTI.length], animationDelay: `${Math.random() * 120}ms` } });
      const a = (n / 36) * Math.PI * 2;
      const r = 120 + Math.random() * 160;
      i.style.setProperty('--x', `${Math.cos(a) * r}px`);
      i.style.setProperty('--y', `${Math.sin(a) * r * 0.7}px`);
      i.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
      return i;
    }));
    setTimeout(() => fx.replaceChildren(), 1900);
  },

  paintTime() {
    const t = $('[data-time]', this.dialog);
    const g = this.g;
    const left = g?.status === 'open' && g.ends_at ? secondsUntil(g.ends_at) : 0;
    t.hidden = !left;
    if (left) t.textContent = `⏱ noch ${clock(left)}`;
    // Zeit abgelaufen: Stand neu holen (die Datenbank schließt beim nächsten Versuch)
    if (g?.status === 'open' && g.ends_at && !left && !this.expiring) {
      this.expiring = true;
      setTimeout(async () => { this.expiring = false; await this.load(); this.render(); }, 1200);
    }
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
        ? `Einmal nötig: In Supabase im SQL Editor die Datei supabase/migrations/20261023000000_giveaway.sql ausführen.${this.error ? ` (${this.error})` : ''}`
        : 'Die Verlosung ist noch nicht eingerichtet. Schau später noch mal vorbei.';
      return;
    }
    const g = this.g;
    const live = g.status !== 'idle' && g.round > 0;
    $('[data-prize]', d).textContent = live ? g.prize : 'Gerade keine Verlosung';
    const state = $('[data-state]', d);
    state.className = `gw-state is-${g.status}`;
    state.textContent = g.status === 'open' ? `🟢 Läuft – schreib ${g.command} in den Twitch-Chat${g.followers_only ? ' (nur Follower)' : ''}`
      : g.status === 'closed' ? '🔒 Geschlossen – gleich wird gezogen'
        : g.status === 'drawn' ? `🎉 Gezogen um ${timeOf(g.drawn_at)} Uhr` : 'Sobald der Streamer eine startet, steht sie hier.';
    const roll = $('[data-roll]', d);
    if (!this.rolling) {
      roll.classList.remove('is-rolling');
      roll.textContent = g.status === 'drawn' && g.winner_name ? `🏆 ${g.winner_name}` : '';
    }
    $('[data-count]', d).textContent = `${g.entries} im Lostopf`;
    $('[data-count]', d).hidden = !live;
    const cmd = $('[data-cmd]', d);
    cmd.replaceChildren('Befehl: ', h('code', {}, g.command));
    cmd.hidden = g.status !== 'open';
    this.paintTime();

    const me = this.me;
    const meEl = $('[data-me]', d);
    meEl.classList.toggle('is-in', !!me?.joined);
    meEl.textContent = !live ? 'Gerade läuft keine Verlosung.'
      : me?.kicked ? '🚫 Du wurdest aus dieser Verlosung genommen.'
      : me?.won ? '🏆 Du hast gewonnen! Der Streamer meldet sich bei dir.'
        : me?.joined ? '✅ Du bist im Lostopf. Viel Glück!'
          : g.status !== 'open' ? 'Mitmachen geht gerade nicht mehr.'
            : !X.ctx.state.user ? `Schreib ${g.command} in den Twitch-Chat, um mitzumachen.`
              : me?.twitch === false && !X.ctx.state.api.demo
                ? `Schreib ${g.command} in den Twitch-Chat. (Melde dich hier mit Twitch an, dann siehst du, ob du dabei bist.)`
                : `Schreib ${g.command} in den Twitch-Chat, um mitzumachen${g.followers_only ? ' – nur Follower' : ''}. Jeder einmal.`;

    $('[data-total]', d).textContent = live ? `· ${g.entries}` : '';
    // Streamer und Mods: ✕ wirft raus (nicht mehr ziehbar, kein neues Mitmachen in dieser Verlosung)
    const canKick = admin && live && !!X.api.giveaway.kick;
    const inPot = this.entries.filter((e) => !e.kicked);
    const kicked = this.entries.filter((e) => e.kicked);
    fill($('[data-entries]', d), live ? inPot.slice(0, 200) : [], (e) => h('li', { class: `x-item${e.won ? ' is-won' : ''}` },
      h('b', {}, `${e.won ? '🏆 ' : ''}${e.name}`),
      h('span', { class: 'x-item-actions' },
        h('small', {}, timeOf(e.created_at)),
        canKick && h('button', {
          type: 'button', class: 'btn btn--ghost btn--sm gw-kick', title: `${e.name} rauswerfen`, 'aria-label': `${e.name} rauswerfen`,
          onclick: (ev) => this.kick(ev.currentTarget, e, true),
        }, '✕'))),
    g.status === 'open' ? 'Noch niemand dabei – der Erste kriegt kein Extra-Los, aber Ruhm.' : 'Niemand im Lostopf.');
    $('[data-kicked-box]', d).hidden = !(canKick && kicked.length);
    if (canKick) {
      fill($('[data-kicked]', d), kicked, (e) => h('li', { class: 'x-item is-off' },
        h('b', {}, e.name),
        h('button', {
          type: 'button', class: 'btn btn--ghost btn--sm', title: `${e.name} wieder in den Lostopf`,
          onclick: (ev) => this.kick(ev.currentTarget, e, false),
        }, '↩ Zurückholen')));
    }
    fill($('[data-winners]', d), this.winners, (w) => h('li', { class: 'x-item' },
      h('span', { class: 'x-item-main' }, h('b', {}, w.name), h('small', {}, w.prize)),
      h('small', {}, `${new Date(w.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} · ${w.entries} Lose`)), 'Noch keine Gewinner.');

    if (!admin) return;
    const pool = this.entries.filter((e) => !e.won && !e.kicked).length;
    const draw = $('[data-draw]', d);
    draw.textContent = g.draws ? '🔁 Neu ziehen' : '🎲 Gewinner ziehen';
    draw.disabled = !live || !pool;
    draw.title = g.draws ? 'Jemand anderen ziehen (z. B. wenn der Gewinner nicht da ist)' : '';
    $('[data-close]', d).disabled = g.status !== 'open';
    $('[data-reset]', d).disabled = !live;
    $('[data-test]', d).hidden = !(X.ctx.state.api.demo && g.status === 'open');
    $('[data-admin-hint]', d).textContent = !live ? 'Rechts eine neue Verlosung starten.'
      : !pool && g.entries ? 'Alle im Lostopf wurden schon gezogen.'
        : g.status === 'drawn' ? 'Gewinner nicht da? „Neu ziehen“ lost jemand anderen aus.' : 'Ziehen schließt die Verlosung automatisch.';
    const form = $('[data-start]', d);
    if (!form.contains(document.activeElement)) {
      if (!form.prize.value && g.prize) form.prize.value = g.prize;
      if (!form.command.value) form.command.value = g.command;
      form.followers.checked = g.followers_only;
      form.confirm.checked = g.confirm_in_chat;
    }
    form.querySelector('[type=submit]').textContent = g.status === 'open' ? '🎁 Neu starten' : '🎁 Verlosung starten';
  },

  async kick(btn, entry, kick) {
    const winner = kick && entry.won && this.g?.status === 'drawn' && this.g.winner_name === entry.name;
    if (kick && !confirm(winner
      ? `${entry.name} hat gerade gewonnen. Trotzdem rauswerfen? Dann kannst du neu ziehen.`
      : `${entry.name} aus der Verlosung werfen? Wer rausfliegt, kann in dieser Runde nicht mehr mitmachen.`)) return;
    await act(btn, async () => {
      this.g = await X.api.giveaway.kick(entry.id, kick);
      await this.load();
      this.render();
      toast(kick ? `${entry.name} ist raus.${winner ? ' Jetzt „Neu ziehen“.' : ''}` : `${entry.name} ist wieder im Lostopf.`, 'ok');
    });
  },

  tileStatus() {
    const g = this.g;
    if (!this.on || !g || g.status === 'idle' || !g.round) return '🎁 Bald gibt es was zu gewinnen';
    if (g.status === 'open') return `🟢 ${g.command} · ${g.entries} dabei`;
    if (g.status === 'closed') return '🔒 Gleich wird gezogen';
    return `🏆 ${g.winner_name} hat gewonnen`;
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};
