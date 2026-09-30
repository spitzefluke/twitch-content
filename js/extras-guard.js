// Raid-Schutz: Streamer und Mods pausieren mit einem Klick alle Zuschauer-Aktionen
// (Migration …_security_hardening.sql). Schalter im Dashboard (Raid-Schutz), Hinweis für alle oben auf der Seite.
import { $, X, act, h, isAdmin, onTick, secondsUntil, span, timeOf, toast } from './extras-core.js';

export const guard = {
  on: false, data: null, subscribed: false,

  setup() {
    // Platz im Dashboard (Seite „Raid-Schutz“), sonst vor den Mods
    const slot = $('#guard-slot');
    const mods = $('#obs-mods');
    if (slot || mods) {
      const box = (h('section', { class: 'obs-card-form x-guard', id: 'obs-guard' },
        h('b', {}, '🛡️ Raid-Schutz'),
        h('small', {}, 'Bei einem Hate-Raid oder Spam: pausiert sofort alle Zuschauer-Aktionen – Chat-Befehle, Kanalpunkte (Punkte gehen zurück) und Aktionen hier auf der Seite. Du und die Mods können weiter alles.'),
        h('p', { class: 'x-guard-state', 'data-guard-state': '' }),
        h('div', { class: 'x-inline' },
          h('select', { 'data-guard-minutes': '', 'aria-label': 'Wie lange?' },
            h('option', { value: '15' }, '15 Minuten'), h('option', { value: '30' }, '30 Minuten'),
            h('option', { value: '60' }, '1 Stunde'), h('option', { value: '0' }, 'bis ich ausschalte')),
          h('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-guard-toggle': '', onclick: (e) => this.toggle(e.currentTarget) }, 'Einschalten')),
        h('p', { class: 'form-hint', 'data-guard-note': '', hidden: true },
          'Einmal nötig: supabase/migrations/20261015000000_security_hardening.sql im SQL Editor ausführen.')));
      if (slot) slot.append(box);
      else mods.before(box);
    }
    ($('.app-main') ?? $('#app'))?.prepend(h('div', { class: 'x-guard-banner', id: 'guard-banner', hidden: true, role: 'status' }));
    onTick(() => { if (this.data?.viewer_pause && this.data.until) this.render(); });
  },

  active() {
    const g = this.data;
    return !!g?.viewer_pause && (!g.until || Date.parse(g.until) > Date.now());
  },

  async load() {
    try {
      this.data = await X.api.guard.get();
      this.on = !!this.data;
    } catch {
      this.on = false;
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      X.api.on('site_guard', (row) => { if (row) { this.data = row; this.render(); } });
    }
    this.render();
  },

  async toggle(btn) {
    const turnOn = !this.active();
    await act(btn, async () => {
      this.data = await X.api.guard.set(turnOn, Number($('[data-guard-minutes]').value));
      this.render();
    }, turnOn ? 'Raid-Schutz ist an.' : 'Raid-Schutz ist aus.');
  },

  render() {
    const active = this.active();
    const banner = $('#guard-banner');
    if (banner) {
      banner.hidden = !active;
      banner.textContent = active
        ? `🛡️ Raid-Schutz: Zuschauer-Aktionen sind gerade kurz pausiert${this.data.until ? ` (noch ${span(secondsUntil(this.data.until))})` : ''}.`
        : '';
    }
    const box = $('#obs-guard');
    if (!box) return;
    box.hidden = !isAdmin();
    $('[data-guard-note]', box).hidden = this.on;
    $('[data-guard-toggle]', box).disabled = !this.on;
    $('[data-guard-toggle]', box).textContent = active ? '✅ Ausschalten' : '🛡️ Einschalten';
    $('[data-guard-toggle]', box).classList.toggle('btn--primary', !active);
    $('[data-guard-minutes]', box).disabled = active;
    box.classList.toggle('is-active', active);
    $('[data-guard-state]', box).textContent = !this.on ? '' : active
      ? `Aktiv seit ${timeOf(this.data.updated_at)}${this.data.updated_by ? ` (${this.data.updated_by})` : ''}${this.data.until ? ` · endet in ${span(secondsUntil(this.data.until))}` : ' · bis zum Ausschalten'}`
      : 'Aus – alles läuft normal.';
  },
};

// Für andere Teile der Seite: Zuschauer-Knöpfe kurz erklären, statt still nichts zu tun
export const viewerPaused = () => guard.active() && !isAdmin();
export function pausedToast() { toast('Gerade ist alles kurz pausiert (Raid-Schutz).', 'info'); }
