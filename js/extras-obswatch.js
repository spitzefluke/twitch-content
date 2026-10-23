// OBS verbunden? Und der Notschalter „Soundkäufe pausieren“ (Migration …_obs_sound_pause.sql).
// Das Overlay meldet sich alle 30 Sekunden, wenn es in OBS läuft (js/overlay.js startObsPing). Fehlt die Meldung,
// laufen gekaufte Sounds (Bits in der Twitch-Erweiterung, Kanalpunkte) ins Leere – dann pausieren Streamer oder
// freigegebene Mods die Soundkäufe mit einem Klick. Karte im Dashboard (Seite „Raid-Schutz“), Hinweis oben auf
// der Seite, solange der Stream läuft und OBS fehlt.
import { $, X, act, h, isAdmin, timeOf } from './extras-core.js';

const POLL_MS = 30_000;
const LIVE_MS = 15 * 60_000; // wie bei „gerade live“ (games.live_at)

export const obsWatch = {
  on: false, data: null, timer: 0,

  setup() {
    const slot = $('#obswatch-slot');
    if (slot) {
      slot.append(h('section', { class: 'obs-card-form x-obswatch', id: 'obs-watch' },
        h('b', {}, '🔊 OBS & Soundkäufe'),
        h('small', {}, 'Ohne OBS hört niemand die Sounds, die Zuschauer kaufen. Pausiert: Die Twitch-Erweiterung bietet keine Sounds und keine Bits-Käufe mehr an, Kanalpunkte für Sounds gehen zurück. Das dürfen der Streamer und alle freigegebenen Mods.'),
        h('p', { class: 'x-obswatch-obs', 'data-obswatch-obs': '' }),
        h('p', { class: 'x-guard-state', 'data-obswatch-state': '' }),
        h('div', { class: 'x-inline' },
          h('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-obswatch-toggle': '', onclick: (e) => this.toggle(e.currentTarget) }, 'Soundkäufe pausieren')),
        h('p', { class: 'form-hint', 'data-obswatch-note': '', hidden: true },
          'Einmal nötig: supabase/migrations/20261119000000_obs_sound_pause.sql im SQL Editor ausführen.')));
    }
    const banner = h('div', { class: 'x-guard-banner x-obswatch-banner', id: 'obswatch-banner', hidden: true, role: 'status' },
      h('span', { 'data-obswatch-text': '' }),
      h('button', { class: 'btn btn--sm', type: 'button', 'data-obswatch-banner-btn': '', onclick: (e) => this.toggle(e.currentTarget) }));
    const guardBanner = $('#guard-banner');
    if (guardBanner) guardBanner.after(banner);
    else ($('.app-main') ?? $('#app'))?.prepend(banner);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.on) this.refresh(); });
  },

  async load() {
    clearInterval(this.timer);
    if (!isAdmin()) { this.on = false; this.data = null; this.render(); return; }
    await this.refresh();
    this.timer = setInterval(() => { if (!document.hidden) this.refresh(); }, POLL_MS);
  },

  async refresh() {
    if (!isAdmin()) return;
    try {
      this.data = await X.api.obsWatch.status();
      this.on = true;
    } catch {
      this.on = false;
      this.data = null;
    }
    this.render();
  },

  async toggle(btn) {
    const turnOn = !this.data?.sales_paused;
    await act(btn, async () => {
      this.data = await X.api.obsWatch.pause(turnOn);
      this.render();
      this.syncRewards();
    }, turnOn ? 'Soundkäufe sind pausiert.' : 'Soundkäufe laufen wieder.');
  },

  // Sound-Belohnungen auf Twitch an- bzw. ausschalten. Klappt das nicht (z. B. Mod ohne Kanalpunkte-Recht),
  // ist das nicht schlimm: Einlösungen während der Pause bekommen ihre Punkte zurück (twitch-eventsub).
  syncRewards() {
    const { state } = X.ctx;
    if (!state.twitch?.connected || !state.twitch.prank_rewards) return;
    state.api.syncPrankRewards()
      .then((r) => { state.twitch = { ...state.twitch, prank_rewards_active: r.active }; })
      .catch((err) => console.warn('Sound-Belohnungen:', err));
  },

  // Gibt es gerade etwas zu kaufen? (Ärgern an oder Sounds im Panel) – ohne Daten lieber ja
  offered() {
    const p = X.ctx.state.prank?.settings;
    return !p || !!p.enabled || !!p.panel_sounds;
  },

  live() {
    const at = X.ctx.state.games?.data?.live_at;
    return !!at && Date.now() - Date.parse(at) < LIVE_MS;
  },

  obsText(d) {
    if (d.online) return '🟢 OBS ist verbunden – Sounds kommen im Stream an.';
    if (!d.seen_at) return '⚪ OBS hat sich noch nicht gemeldet. In OBS die Overlay-Adresse als Browserquelle einfügen.';
    return `🔴 OBS ist nicht verbunden (zuletzt gemeldet um ${timeOf(d.seen_at)} Uhr).`;
  },

  render() {
    const d = this.data;
    const admin = isAdmin();
    const paused = !!d?.sales_paused;

    const banner = $('#obswatch-banner');
    if (banner) {
      // Hinweis nur, wenn er etwas bringt: OBS fehlt während des Streams (pausieren) oder ist zurück (freigeben)
      const missing = this.on && admin && !d.online && !paused && this.live() && this.offered();
      const back = this.on && admin && d.online && paused;
      banner.hidden = !missing && !back;
      banner.classList.toggle('is-ok', back);
      $('[data-obswatch-text]', banner).textContent = missing
        ? '⚠️ OBS ist nicht verbunden – gekaufte Sounds laufen gerade ins Leere.'
        : back ? `✅ OBS ist wieder verbunden. Soundkäufe sind noch pausiert${d.paused_by ? ` (von ${d.paused_by})` : ''}.` : '';
      $('[data-obswatch-banner-btn]', banner).textContent = paused ? '🔊 Wieder freigeben' : '⏸️ Soundkäufe pausieren';
    }

    const box = $('#obs-watch');
    if (!box) return;
    box.hidden = !admin;
    $('[data-obswatch-note]', box).hidden = this.on || !admin;
    const btn = $('[data-obswatch-toggle]', box);
    btn.disabled = !this.on;
    btn.textContent = paused ? '🔊 Wieder freigeben' : '⏸️ Soundkäufe pausieren';
    btn.classList.toggle('btn--primary', !paused);
    box.classList.toggle('is-active', paused);
    box.classList.toggle('is-offline', this.on && !d.online);
    $('[data-obswatch-obs]', box).textContent = this.on ? this.obsText(d) : '';
    $('[data-obswatch-state]', box).textContent = !this.on ? '' : paused
      ? `⏸️ Pausiert seit ${timeOf(d.paused_at)} Uhr${d.paused_by ? ` (${d.paused_by})` : ''}.`
      : 'Soundkäufe laufen normal.';
  },
};
