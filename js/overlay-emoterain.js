// Emote-Regen (Overlay-Ebene „Emote-Regen“, erain=1): Emotes aus dem Twitch-Chat regnen übers ganze Bild.
// Liest den Chat anonym mit (js/twitch-chat.js) – keine Datenbank, kein Bot nötig.
//   !regen (Befehl einstellbar)   lässt die Emotes aus der Nachricht regnen – ohne Emote die zuletzt
//                                 benutzten. Abklingzeit für alle; Streamer und Mods dürfen immer.
//   Emote-Combo                   schreibt der Chat dasselbe Emote oft genug in kurzer Zeit, regnet es von selbst.
//   Jedes Emote                   auf Wunsch fällt zu jedem Emote im Chat ein einzelnes herunter.
// Parameter: ercmd=regen  erwho=all|subs|mods  ercool=30 (s)  ercombo=5 (0 = aus)  erall=1  ermax=40  ersize=100
// Testmodus (test=1): alle paar Sekunden ein Probe-Regen.
import { EMOTE_URL, connectTwitchChat } from './twitch-chat.js';

const COMBO_WINDOW_MS = 8000;
const COMBO_COOLDOWN_MS = 20_000;
const MAX_ON_SCREEN = 160;
const RECENT = 12;
// Für den Testmodus: bekannte globale Twitch-Emotes (Kappa, <3, HeyGuys, LUL) – fällt ein Bild aus, kommt ein Emoji
const TEST_EMOTES = [{ id: '25', name: 'Kappa' }, { id: '9', name: '<3' }, { id: '30259', name: 'HeyGuys' }, { id: '425618', name: 'LUL' }];
const FALLBACK = ['💜', '✨', '🎉', '⭐'];

export function readEmoteRain({ flag, number, params }) {
  if (!flag('erain', false)) return null;
  const who = params.get('erwho');
  return {
    cmd: (params.get('ercmd') ?? 'regen').toLowerCase().replace(/[^a-z0-9äöüß]/g, '').slice(0, 20) || 'regen',
    who: ['subs', 'mods'].includes(who) ? who : 'all',
    coolMs: number('ercool', 30, 0, 600) * 1000,
    combo: number('ercombo', 5, 0, 50),
    all: flag('erall', false),
    max: number('ermax', 40, 5, 120),
    size: number('ersize', 100, 50, 250) / 100,
  };
}

export function setupEmoteRain(cfg, { channel, test }) {
  const layer = document.createElement('div');
  layer.className = 'ov-erain';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);

  const recent = [];                 // zuletzt benutzte Emotes (für !regen ohne Emote)
  const seen = new Map();            // Emote → Zeitpunkte (Combo)
  const comboAt = new Map();         // Emote → letzter Combo-Regen
  let lastRain = 0;

  function drop(emote, { delay = 0, small = false } = {}) {
    if (layer.childElementCount >= MAX_ON_SCREEN) return;
    const size = Math.round((small ? 40 : 48 + Math.random() * 40) * cfg.size);
    const el = document.createElement('span');
    el.className = 'er-drop';
    const dur = 3.2 + Math.random() * 2.6;
    el.style.cssText = `left:${Math.random() * 96}%;width:${size}px;height:${size}px;animation-duration:${dur}s;animation-delay:${delay}s;`
      + `--er-rot:${Math.round(Math.random() * 720 - 360)}deg;--er-sway:${Math.round(Math.random() * 120 - 60)}px`;
    if (emote.id) {
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.src = EMOTE_URL(emote.id);
      img.onerror = () => { img.replaceWith(document.createTextNode(FALLBACK[Math.floor(Math.random() * FALLBACK.length)])); };
      el.append(img);
    } else el.textContent = emote.text ?? '💜';
    el.addEventListener('animationend', () => el.remove(), { once: true });
    layer.append(el);
  }

  function rain(emotes, count = cfg.max) {
    const list = emotes.length ? emotes : recent.length ? recent.slice(-6) : [{ text: '💜' }];
    for (let i = 0; i < count; i++) drop(list[i % list.length], { delay: Math.random() * 2.2 });
  }

  const allowed = (badges) => {
    const ids = badges.map((b) => b.id);
    if (cfg.who === 'mods') return ids.includes('broadcaster') || ids.includes('moderator');
    if (cfg.who === 'subs') return ids.some((b) => ['broadcaster', 'moderator', 'vip', 'subscriber', 'founder'].includes(b));
    return true;
  };

  function onMessage(m) {
    const emotes = m.parts.filter((p) => p.emote).map((p) => ({ id: p.emote, name: p.name }));
    const now = Date.now();
    for (const e of emotes) {
      if (!recent.some((r) => r.id === e.id)) recent.push(e);
      if (recent.length > RECENT) recent.shift();
    }
    const word = m.text.trim().toLowerCase().split(/\s+/)[0];
    if (word === `!${cfg.cmd}`) {
      const staff = m.badges.some((b) => b.id === 'broadcaster' || b.id === 'moderator');
      if (staff || (allowed(m.badges) && now - lastRain >= cfg.coolMs)) {
        lastRain = now;
        rain(emotes);
      }
      return;
    }
    if (cfg.all) emotes.slice(0, 5).forEach((e, i) => drop(e, { delay: i * 0.15, small: true }));
    // Combo: dasselbe Emote oft in kurzer Zeit
    if (!cfg.combo) return;
    for (const e of new Map(emotes.map((x) => [x.id, x])).values()) {
      const times = (seen.get(e.id) ?? []).filter((t) => now - t < COMBO_WINDOW_MS);
      times.push(now);
      seen.set(e.id, times);
      if (times.length >= cfg.combo && now - (comboAt.get(e.id) ?? 0) > COMBO_COOLDOWN_MS) {
        comboAt.set(e.id, now);
        seen.set(e.id, []);
        rain([e], Math.round(cfg.max * 0.75));
      }
    }
  }

  const stop = channel ? connectTwitchChat(channel, { message: onMessage }) : () => {};
  let timer = 0;
  if (test) {
    rain(TEST_EMOTES, Math.round(cfg.max / 2));
    timer = setInterval(() => rain(TEST_EMOTES, Math.round(cfg.max / 2)), 7000);
  }
  return () => { stop(); clearInterval(timer); layer.remove(); };
}
