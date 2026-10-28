// Emote-Regen: nur die Kachel mit Erklärung. Das Overlay liest den Chat selbst mit (js/overlay-emoterain.js) –
// keine Datenbank, kein Bot. Eingeschaltet und eingestellt wird es im OBS-Editor (Ebene „Emote-Regen“).
import { $, h, isAdmin, makeDialog, openFeature, paintTile } from './extras-core.js';

const DEMO_EMOTES = ['💜', '🎉', '😂', '🔥', '✨', '👑', '🐸', '💥'];

export const emoterain = {
  kind: 'emoterain', icon: '🌧️', cta: 'So geht’s →',
  on: true, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-emoterain', cls: 'x-emoterain', eyebrow: 'Chat · Overlay', title: 'Emote-Regen',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero er-hero">
            <div class="er-sky" data-sky aria-hidden="true"></div>
            <b class="pl-q">Emotes regnen übers ganze Bild</b>
            <ul class="er-how">
              <li><b>!regen</b> im Chat – gern mit Emotes dahinter: <i>!regen Kappa PogChamp</i>. Ohne Emote regnen die zuletzt benutzten.</li>
              <li><b>Emote-Combo:</b> Schreibt der Chat dasselbe Emote oft hintereinander, regnet es von selbst.</li>
              <li>Streamer und Mods dürfen immer, alle anderen nach einer kurzen Pause.</li>
            </ul>
            <button class="btn btn--ghost btn--sm" type="button" data-rain>🌧️ Hier mal regnen lassen</button>
          </div>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Einrichten</h3>
            <p>Im OBS-Editor die Ebene <b>„Emote-Regen“</b> (unter „Bei Aktion“) einschalten. Dort stellst du den Befehl, wer darf, die Pause, die Combo-Länge und die Größe ein.</p>
            <button class="btn btn--primary btn--sm" type="button" data-open-obs>OBS-Editor öffnen</button>
            <p class="form-hint">Das Overlay liest den Twitch-Chat nur mit – kein Bot und keine Freigabe nötig. Im Testmodus des Overlays regnet es alle paar Sekunden zur Probe.</p>
          </section>
        </div>
      </div>`,
    });
    $('[data-rain]', this.dialog).addEventListener('click', () => this.rain());
  },

  // Kleine Vorschau im Dialog (Emojis statt Twitch-Emotes)
  rain() {
    const sky = $('[data-sky]', this.dialog);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (let i = 0; i < 24; i++) {
      const drop = h('span', {
        class: 'er-preview-drop',
        style: { left: `${Math.random() * 94}%`, animationDelay: `${Math.random() * 1.4}s`, animationDuration: `${1.8 + Math.random() * 1.4}s` },
      }, DEMO_EMOTES[i % DEMO_EMOTES.length]);
      drop.addEventListener('animationend', () => drop.remove(), { once: true });
      sky.append(drop);
    }
  },

  async load() { paintTile(this); },

  render() {
    const admin = isAdmin();
    $('[data-admin]', this.dialog).hidden = !admin;
    this.dialog.classList.toggle('has-side', admin);
    $('[data-note]', this.dialog).hidden = true;
  },

  tileStatus() { return '🌧️ !regen im Chat'; },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    this.rain();
  },
};
