// Herzfrequenz (Migration …_game_packs.sql): Der Streamer verbindet hier einen Pulsgurt oder eine Uhr per
// Bluetooth (Web Bluetooth, Standard-Dienst „Heart Rate“ – geht in Chrome und Edge am PC und unter Android,
// nicht in Firefox, Safari und auf dem iPhone). Die Seite schickt den Puls höchstens alle 3 Sekunden an die
// Datenbank; das Overlay (Ebene „Herzfrequenz“) und „!puls“ im Chat zeigen ihn. Dieses Fenster muss offen bleiben.
import { $, X, act, h, isAdmin, makeDialog, openFeature, paintTile, toast } from './extras-core.js';

const SEND_MS = 3000;
const FRESH_MS = 30000;

// Verbindung bleibt bestehen, auch wenn der Dialog zu ist
const ble = { device: null, char: null, status: 'off', last: 0, sent: 0, retries: 0, demo: 0 };

// Messwert laut Bluetooth-Spezifikation: Bit 0 der Flags sagt, ob der Puls 8 oder 16 Bit hat
export function parseHeartRate(view) {
  const flags = view.getUint8(0);
  return flags & 1 ? view.getUint16(1, true) : view.getUint8(1);
}

export const heart = {
  kind: 'heart', icon: '❤️', cta: 'Puls →',
  on: false, error: '', hr: null, subscribed: false, dialog: null,

  setup() {
    this.dialog = makeDialog({
      id: 'x-heart', cls: 'x-heart', eyebrow: 'Pulsgurt oder Uhr per Bluetooth', title: 'Herzfrequenz',
      body: `
      <div class="x-layout">
        <div class="x-main">
          <div class="x-hero hr-hero" data-hero>
            <span class="hr-heart" aria-hidden="true">❤️</span>
            <b class="hr-bpm" data-bpm>–</b>
            <span class="hr-unit">bpm</span>
            <p class="hr-sub" data-sub></p>
          </div>
          <div class="hr-stats" data-stats></div>
        </div>
        <div class="x-side" data-admin hidden>
          <section class="bingo-box">
            <h3 class="prank-h3">Verbinden</h3>
            <p class="hr-status" data-status aria-live="polite"></p>
            <div class="x-row">
              <button class="btn btn--primary btn--sm" type="button" data-connect>❤️ Pulsgurt verbinden</button>
              <button class="btn btn--ghost btn--sm" type="button" data-disconnect hidden>Trennen</button>
              <button class="btn btn--outline btn--sm" type="button" data-demo hidden>🫀 Simulieren (Demo)</button>
            </div>
            <p class="form-hint" data-support></p>
          </section>
          <section class="bingo-box">
            <h3 class="prank-h3">Einstellungen</h3>
            <form class="x-form" data-settings>
              <label class="field"><span>Ab diesem Puls wird das Herz im Stream rot</span><input type="number" name="alarm" min="60" max="220" step="5" required></label>
              <button class="btn btn--outline btn--sm" type="submit">Speichern</button>
            </form>
            <button class="btn btn--ghost btn--sm" type="button" data-stop>Puls ausblenden</button>
            <p class="form-hint">Im Stream: OBS-Ebene „Herzfrequenz“ einschalten. Im Chat: <b>!puls</b>. Gespeichert wird nur der letzte Wert und Min/Max/Durchschnitt der laufenden Sitzung.</p>
          </section>
        </div>
      </div>`,
    });
    const d = this.dialog;
    $('[data-connect]', d).addEventListener('click', (e) => act(e.currentTarget, () => this.connect()));
    $('[data-disconnect]', d).addEventListener('click', () => this.disconnect());
    $('[data-demo]', d).addEventListener('click', () => this.toggleDemo());
    $('[data-settings]', d).addEventListener('submit', (e) => {
      e.preventDefault();
      act(e.submitter, async () => { this.hr = await X.api.heart.settings({ alarm: Number(e.currentTarget.alarm.value) }); this.render(); }, 'Gespeichert.');
    });
    $('[data-stop]', d).addEventListener('click', (e) => act(e.currentTarget, async () => {
      this.disconnect();
      this.hr = await X.api.heart.settings({ stop: true });
      this.render();
    }));
    // Ohne Signal: Anzeige altern lassen
    setInterval(() => { if (this.dialog.open) this.render(); }, 5000);
  },

  supported: () => !!navigator.bluetooth?.requestDevice,

  async connect() {
    if (!this.supported()) throw new Error('Dieser Browser kann kein Bluetooth. Bitte Chrome oder Edge am PC oder unter Android nehmen.');
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] }).catch((err) => {
      if (err?.name === 'NotFoundError') return null; // Auswahl abgebrochen
      throw err;
    });
    if (!device) return;
    ble.device = device;
    ble.retries = 0;
    device.addEventListener('gattserverdisconnected', () => this.reconnect());
    await this.attach();
    toast(`Verbunden mit ${device.name || 'Pulsmesser'}.`, 'ok');
  },

  async attach() {
    ble.status = 'connecting';
    this.render();
    const server = await ble.device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    ble.char = await service.getCharacteristic('heart_rate_measurement');
    ble.char.addEventListener('characteristicvaluechanged', (e) => this.onValue(parseHeartRate(e.target.value)));
    await ble.char.startNotifications();
    ble.status = 'on';
    ble.retries = 0;
    this.render();
  },

  // Verbindung abgerissen (Gurt locker, außer Reichweite): ein paar Mal neu versuchen
  async reconnect() {
    if (!ble.device || ble.status === 'off') return;
    ble.status = 'lost';
    this.render();
    while (ble.device && ble.retries < 5) {
      ble.retries++;
      await new Promise((r) => setTimeout(r, 2000 * ble.retries));
      try { await this.attach(); return; } catch { /* nächster Versuch */ }
    }
    ble.status = 'off';
    this.render();
    toast('Pulsmesser getrennt – bitte neu verbinden.', 'error');
  },

  disconnect() {
    const dev = ble.device;
    ble.device = null;
    ble.char = null;
    ble.status = 'off';
    clearInterval(ble.demo);
    ble.demo = 0;
    if (dev?.gatt?.connected) dev.gatt.disconnect();
    this.render();
  },

  async onValue(bpm) {
    if (!(bpm >= 25 && bpm <= 250)) return;
    ble.last = bpm;
    const bpmEl = $('[data-bpm]', this.dialog);
    if (bpmEl && this.dialog.open) bpmEl.textContent = String(bpm);
    if (Date.now() - ble.sent < SEND_MS) return;
    ble.sent = Date.now();
    try {
      await X.api.heart.push(bpm);
    } catch (err) {
      console.warn('Puls:', err.message);
    }
  },

  // Demo: ein Puls, der langsam schwankt und ab und zu hochschießt (Jumpscare)
  toggleDemo() {
    if (ble.demo) { this.disconnect(); return; }
    let v = 82;
    ble.status = 'demo';
    ble.demo = setInterval(() => {
      v += (Math.random() - 0.5) * 6 + (Math.random() < 0.04 ? 45 : 0);
      v = Math.max(62, Math.min(175, v - (v - 85) * 0.08));
      this.onValue(Math.round(v));
    }, 1000);
    this.render();
  },

  async load() {
    try {
      const hr = await X.api.heart.get();
      Object.assign(this, { hr: hr ?? { alarm: 140 }, on: true, error: '' });
    } catch (err) {
      Object.assign(this, { on: false, error: err.message });
    }
    if (this.on && !this.subscribed) {
      this.subscribed = true;
      X.api.on('heart_rate', (row) => {
        if (row) this.hr = { ...this.hr, ...row };
        paintTile(this);
        if (this.dialog.open) this.render();
      });
    }
    paintTile(this);
  },

  fresh() {
    return !!this.hr?.at && this.hr.bpm && Date.now() - Date.parse(this.hr.at) < FRESH_MS;
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
        : 'Die Herzfrequenz ist noch nicht eingerichtet. Schau später noch mal vorbei.';
      return;
    }
    const hr = this.hr ?? {};
    const live = this.fresh();
    const bpm = ble.status === 'on' || ble.status === 'demo' ? ble.last || hr.bpm : live ? hr.bpm : null;
    const hero = $('[data-hero]', d);
    hero.classList.toggle('is-live', !!bpm);
    hero.classList.toggle('is-alarm', !!bpm && bpm >= (hr.alarm ?? 140));
    hero.style.setProperty('--beat', bpm ? `${(60 / bpm).toFixed(3)}s` : '1s');
    $('[data-bpm]', d).textContent = bpm ? String(bpm) : '–';
    $('[data-sub]', d).textContent = bpm
      ? (bpm >= (hr.alarm ?? 140) ? '😱 Puls über der Warnschwelle!' : 'Live')
      : 'Gerade kommt kein Puls an.';
    const stats = hr.s_n > 0 ? [['Min', hr.s_min], ['Ø', Math.round(hr.s_sum / hr.s_n)], ['Max', hr.s_max]] : [];
    $('[data-stats]', d).replaceChildren(...stats.map(([k, v]) => h('div', { class: 'hr-stat' }, h('small', {}, k), h('b', {}, String(v)))));
    if (!admin) return;
    const STATUS = { off: 'Nicht verbunden.', connecting: 'Verbinde …', on: `Verbunden mit ${ble.device?.name || 'Pulsmesser'} – lass dieses Fenster offen (darf im Hintergrund sein).`, lost: 'Verbindung weg – versuche es erneut …', demo: 'Demo: simulierter Puls.' };
    $('[data-status]', d).textContent = STATUS[ble.status] ?? '';
    $('[data-connect]', d).hidden = ble.status !== 'off' || (X.ctx.state.api.demo && !this.supported());
    $('[data-disconnect]', d).hidden = ble.status === 'off' || ble.status === 'demo';
    $('[data-demo]', d).hidden = !X.ctx.state.api.demo;
    $('[data-demo]', d).textContent = ble.demo ? '⏹ Simulation stoppen' : '🫀 Simulieren (Demo)';
    $('[data-support]', d).textContent = this.supported()
      ? 'Geht mit Pulsgurten (Polar, Garmin, Wahoo …) und Uhren, die ihren Puls per Bluetooth senden (oft „Herzfrequenz übertragen“ in den Einstellungen der Uhr).'
      : 'Dieser Browser kann kein Bluetooth. Öffne das Dashboard in Chrome oder Edge am PC (oder unter Android) – Firefox, Safari und das iPhone können es nicht.';
    const f = $('[data-settings]', d);
    if (!f.contains(document.activeElement)) f.alarm.value = String(hr.alarm ?? 140);
  },

  tileStatus() {
    if (!this.on) return '❤️ Puls live im Stream';
    return this.fresh() ? `❤️ ${this.hr.bpm} bpm` : '❤️ Gerade kein Signal';
  },

  async open() {
    if (!openFeature(this)) return;
    this.render();
    await this.load();
    this.render();
  },
};
