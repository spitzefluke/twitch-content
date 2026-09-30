// „Overlay-Hack“ (Ärgere den Streamer, nur Mods): Der Hacker 0xNULL übernimmt für knapp eine
// Minute das ganze Bild – Glitches, Terminal, Hexdump, Pop-ups, gestörte Kamera und am Ende
// „Overlay geklaut“. Tippt jemand im Twitch-Chat !firewall (oder ein Mod drückt im Dialog
// „Firewall“), fegt die Firewall alles weg. Sonst springt am Ende die Notfall-Firewall an.
// Nach dem Claude-Design „Overlay Hack“ (Nocturne-Farben, Rot als Hacker-Farbe).
import { connectTwitchChat } from './twitch-chat.js';

const TAKEOVER_AT = 24; // Sekunden: „Overlay geklaut“ mit Fortschrittsbalken
const TAKEOVER_LEN = 24; // bis 100 %
const AUTO_FIREWALL = TAKEOVER_AT + TAKEOVER_LEN + 2.5;
const FIREWALL_FROM = 5; // vorher ist noch nichts zu retten
const FPS_MS = 60;

const TERM = [
  [0, 'verbinde mit overlay.local … bitte warten'],
  [2.5, 'rate passwort: passwort123  [OK]'],
  [5, 'lade hacker_musik_epic.mp3'],
  [7.5, 'zugriff widget/titel  [OK]'],
  [10, 'ersetze alle emotes durch katzen  [OK]'],
  [12.5, 'schriftart -> comic sans  [OK]'],
  [15, 'zugriff widget/kamera  [OK]'],
  [18, 'installiere 47 toolbars'],
  [21, 'bestelle 200 pizzen an den streamer'],
  [24, 'benenne maus in „hamster“ um'],
  [27, 'lösche hausaufgaben.docx'],
  [31, 'root erlangt. mama ruft zum essen.'],
];
const TOASTS = [
  [0.6, 'Unbekannter Zugriff erkannt', 'Quelle: ein Keller in Wanne-Eickel'],
  [8, 'Widget-Integrität: 71 %', 'die anderen 29 % machen Mittagspause'],
  [15.5, 'Verbindung instabil', 'jemand hat den Router angeniest'],
];
const POPUPS = [
  'Streamer ist jetzt Praktikant', 'RAM an Oma verkauft', 'WLAN-Passwort geändert: bitte123', 'Maus heißt jetzt Günther',
  'Deine Tastatur hat gekündigt', 'Chat-Farbe auf Beige gestellt', 'Lautstärke ist jetzt ein Gefühl', 'Desktop-Hintergrund: Fuß',
  'Webcam-Filter: Kartoffel',
];
const FIREWALL_LINES = ['0xNULL zum Abendessen geschickt', 'Comic Sans deinstalliert', '200 Pizzen storniert', 'Hamster freigelassen'];
const GLYPHS = '!<>-_/\\[]{}=+*^?#01%$';

const hex4 = () => Math.floor(Math.random() * 65536).toString(16).padStart(4, '0');
const scramble = (s, amount) => s.split('').map((c) => (c !== ' ' && Math.random() < amount ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : c)).join('');
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

// host: document.body · cam: Kamera-Bereich in Prozent · sfx: Sfx der Ebene „Würfe & Sounds“
// channel: Twitch-Login für !firewall · who: wer den Hack gestartet hat · onEnd: fertig
export function startHack({ host = document.body, cam, sfx, channel, who = 'jemand', onEnd = () => {} }) {
  const el = document.createElement('div');
  el.className = 'ov-hack';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="hk-shade"></div>
    <div class="hk-vignette"></div>
    <div class="hk-cam"><div class="hk-noise"></div><b>SIGNAL ABGEFANGEN</b><span>bitte lächeln :)</span></div>
    <section class="hk-term hk-term1"><header>▣ 0xNULL@overlay:~</header><div class="hk-lines"></div></section>
    <section class="hk-term hk-term2"><header>dump widgets.bin</header><pre class="hk-hex"></pre></section>
    <div class="hk-popups"></div>
    <div class="hk-toast"><i>⚠</i><div><b></b><span></span></div></div>
    <section class="hk-takeover">
      <span class="hk-kicker">0xNULL // ROOT</span>
      <b class="hk-title">OVERLAY GEKLAUT</b>
      <div class="hk-progress"><span>Übernahme</span><span class="hk-pct">0 %</span></div>
      <div class="hk-bar"><i></i></div>
      <span class="hk-hint">Tippe <b>!firewall</b> in den Chat, bevor er deine Oma anruft.</span>
    </section>
    <div class="hk-slices"></div>
    <div class="hk-scan"></div>
    <div class="hk-sweep"></div>
    <section class="hk-fw">
      <div class="hk-fw-head"><i>🛡️</i><b>Firewall aktiviert</b></div>
      <p class="hk-fw-by"></p>
      <ul class="hk-fw-lines"></ul>
    </section>
    <div class="hk-badge">🛡️ Firewall aktiv · Overlay gesichert</div>`;
  const q = (sel) => el.querySelector(sel);
  if (cam) Object.assign(q('.hk-cam').style, { left: `${cam.x}%`, top: `${cam.y}%`, width: `${cam.w}%`, height: `${cam.h}%` });
  q('.hk-kicker').textContent = `0xNULL // ROOT · bestellt von ${who}`;
  host.append(el);
  document.body.classList.add('is-hacked');

  const start = performance.now();
  let fwAt = null;
  let fwBy = '';
  let timer = 0;
  let stopChat = () => {};
  let lastTerm = -1;
  let lastToast = -1;
  let popups = 0;
  let pctShown = -1;

  // !firewall im Chat – jeder darf retten
  if (channel) {
    stopChat = connectTwitchChat(channel, {
      message: (m) => { if (/^!firewall\b/i.test(m.text.trim())) firewall(m.name); },
    });
  }

  const t = () => (performance.now() - start) / 1000;
  const sound = {
    glitch() { sfx?.tone(90 + Math.random() * 60, { type: 'sawtooth', release: 0.12, peak: 0.05, filter: { type: 'lowpass', freq: 900 } }); },
    type() { sfx?.tone(1800 + Math.random() * 600, { type: 'square', release: 0.03, peak: 0.02, filter: { type: 'lowpass', freq: 4000 } }); },
    alarm() { [0, 0.28].forEach((at) => sfx?.tone(740, { at, type: 'square', to: 520, release: 0.25, peak: 0.05, filter: { type: 'lowpass', freq: 2200 } })); },
    firewall() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => sfx?.tone(f, { at: i * 0.09, type: 'triangle', release: 0.5, peak: 0.12 })); },
  };
  sound.alarm();

  function frame() {
    const now = t();
    if (fwAt === null) runHack(now);
    else runFirewall(now - fwAt);
  }

  function runHack(now) {
    const h = clamp(now / TAKEOVER_AT);
    el.style.setProperty('--h', h.toFixed(3));
    el.classList.toggle('is-term1', now >= 4);
    el.classList.toggle('is-term2', now >= 14);
    el.classList.toggle('is-cam', now >= 12);
    el.classList.toggle('is-takeover', now >= TAKEOVER_AT);
    document.body.classList.toggle('is-hacked-hard', now >= 10);

    // Glitch-Spitzen: Streifen, RGB-Versatz, Wackeln
    const spike = Math.random() < 0.06 + h * 0.3;
    el.classList.toggle('is-spike', spike);
    document.body.classList.toggle('is-hack-spike', spike);
    if (spike) {
      if (Math.random() < 0.5) sound.glitch();
      q('.hk-slices').replaceChildren(...Array.from({ length: 4 }, (_, k) => {
        const s = document.createElement('i');
        s.style.cssText = `top:${Math.random() * 100}%;height:${2 + Math.random() * 28}px;transform:translateX(${(Math.random() - 0.5) * 200}px);`
          + `background:${k % 2 ? 'oklch(0.7 0.18 22 / .35)' : 'oklch(0.7 0.13 289 / .3)'}`;
        return s;
      }));
    } else if (q('.hk-slices').firstChild) q('.hk-slices').replaceChildren();

    // Terminal: Zeile für Zeile tippen
    const shown = TERM.filter((l) => now - 4 >= l[0]);
    if (now >= 4) {
      const lines = shown.slice(-9).map((l, i, a) => {
        const n = Math.floor((now - 4 - l[0]) * 30);
        const last = i === a.length - 1;
        const div = document.createElement('div');
        div.textContent = `> ${l[1].slice(0, n)}${last && Math.floor(now * 2) % 2 === 0 ? '▌' : ''}`;
        if (l[1].includes('[OK]') && n >= l[1].length) div.className = 'is-ok';
        return div;
      });
      q('.hk-lines').replaceChildren(...lines);
      const typing = shown.length && (now - 4 - shown[shown.length - 1][0]) * 30 < shown[shown.length - 1][1].length;
      if (typing && Math.random() < 0.5) sound.type();
      if (shown.length !== lastTerm) lastTerm = shown.length;
    }
    if (now >= 14) {
      const base = Math.floor(now * 12);
      q('.hk-hex').textContent = Array.from({ length: 10 }, (_, r) => `${((0x4f00 + (base + r) * 16) % 0xffffff).toString(16).padStart(6, '0')}  ${Array.from({ length: 6 }, hex4).join(' ')}`).join('\n');
    }
    // Kamera: Rauschen
    if (now >= 12) {
      q('.hk-noise').replaceChildren(...Array.from({ length: 14 }, (_, k) => {
        const s = document.createElement('i');
        s.style.cssText = `height:${2 + Math.random() * 8}px;margin-left:${Math.random() * 40}%;width:${10 + Math.random() * 60}%;`
          + `background:${k % 3 ? '#75798c' : 'oklch(0.6 0.15 22 / .8)'}`;
        return s;
      }));
    }
    // Warnungen oben
    const toast = TOASTS.findIndex((x) => now >= x[0] && now < x[0] + 6);
    if (toast !== lastToast) {
      lastToast = toast;
      q('.hk-toast').classList.toggle('is-on', toast >= 0);
      if (toast >= 0) {
        q('.hk-toast b').textContent = TOASTS[toast][1];
        q('.hk-toast span').textContent = TOASTS[toast][2];
      }
    }
    // Übernahme: Balken, Pop-ups, verrutschter Titel
    if (now >= TAKEOVER_AT) {
      const pct = Math.floor(clamp((now - TAKEOVER_AT) / TAKEOVER_LEN) * 100);
      if (pct !== pctShown) {
        pctShown = pct;
        q('.hk-pct').textContent = `${pct} %`;
        q('.hk-bar i').style.width = `${pct}%`;
        if (pct === 100) { q('.hk-hint').textContent = '0xNULL hat gewonnen … 😈 Notfall-Firewall startet'; sound.alarm(); }
      }
      q('.hk-title').textContent = scramble('OVERLAY GEKLAUT', spike ? 0.2 : 0.03);
      const want = Math.min(POPUPS.length, Math.floor((now - TAKEOVER_AT) / 2.6) + 1);
      while (popups < want) {
        const p = document.createElement('div');
        p.className = 'hk-popup';
        p.style.cssText = `left:${18 + Math.random() * 52}%;top:${10 + Math.random() * 60}%;transform:rotate(${((Math.random() - 0.5) * 6).toFixed(1)}deg)`;
        p.innerHTML = '<b>🔒 ZUGRIFF VERWEIGERT</b><span></span>';
        p.querySelector('span').textContent = POPUPS[popups];
        q('.hk-popups').append(p);
        popups += 1;
        sound.glitch();
      }
    }
    if (now >= AUTO_FIREWALL) firewall('');
  }

  function firewall(by) {
    if (fwAt !== null || t() < FIREWALL_FROM) return;
    fwAt = t();
    fwBy = by;
    el.classList.add('is-firewall');
    el.classList.remove('is-spike');
    document.body.classList.remove('is-hacked-hard', 'is-hack-spike');
    q('.hk-slices').replaceChildren();
    q('.hk-fw-by').textContent = by ? `ausgelöst von ${by} – danke!` : 'Notfall-Firewall – das war knapp.';
    sound.firewall();
    stopChat();
  }

  function runFirewall(d) {
    q('.hk-sweep').style.left = `${clamp(d / 1.6) * 100}%`;
    el.classList.toggle('is-sweep', d < 1.8);
    el.classList.toggle('is-cleared', d >= 1);
    el.classList.toggle('is-fwcard', d >= 0.4 && d < 7);
    el.classList.toggle('is-badge', d >= 6.6);
    const lines = FIREWALL_LINES.filter((_, k) => d > 0.9 + k * 0.6);
    if (lines.length !== q('.hk-fw-lines').children.length) {
      q('.hk-fw-lines').replaceChildren(...lines.map((l) => Object.assign(document.createElement('li'), { textContent: l })));
    }
    if (d >= 10) stop();
  }

  function stop() {
    clearInterval(timer);
    stopChat();
    document.body.classList.remove('is-hacked', 'is-hacked-hard', 'is-hack-spike');
    el.classList.add('is-gone');
    setTimeout(() => { el.remove(); onEnd(); }, 600);
  }

  timer = setInterval(frame, FPS_MS);
  frame();
  return { firewall, stop, get by() { return fwBy; } };
}
