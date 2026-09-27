// Twitch-Chat fürs OBS-Overlay: liest Daves Chat anonym über Twitchs Chat-Schnittstelle
// (IRC über WebSocket, Gast-Login „justinfan…“). Kein Login, kein Bot, keine Datenbank –
// das Overlay schreibt nie etwas, es liest nur mit. Emotes, Namensfarben und Abzeichen
// kommen direkt von Twitch mit. Löschen Mods eine Nachricht oder sperren jemanden,
// verschwindet sie auch im Overlay. Die Anzeige (renderMessage) nutzt auch der
// YouTube-Chat (js/youtube-chat.js) – im Overlay laufen beide in einer Liste.
import { SOCIAL_ICONS, socialBadge } from './social-icons.js';

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const EMOTE_URL = (id) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;

// Bekannte Bots – im Overlay standardmäßig ausgeblendet
export const CHAT_BOTS = ['streamelements', 'nightbot', 'moobot', 'streamlabs', 'fossabot', 'wizebot', 'soundalerts', 'sery_bot', 'kofistreambot', 'botrixoficial'];

// Twitchs Standardfarben für Namen ohne eigene Farbe (je Name immer dieselbe)
const DEFAULT_COLORS = ['#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];

// Abzeichen, die wir selbst zeichnen (die echten Bilder bräuchten einen API-Schlüssel)
const BADGES = {
  broadcaster: { label: 'Streamer', text: '▶' },
  moderator: { label: 'Moderator', text: '⚔' },
  vip: { label: 'VIP', text: '◆' },
  subscriber: { label: 'Abonnent', text: '★' },
  founder: { label: 'Gründer', text: '★' },
  partner: { label: 'Partner', text: '✓' },
  member: { label: 'Mitglied', text: '★' },
};
const PLATFORMS = Object.fromEntries(SOCIAL_ICONS.filter((s) => ['twitch', 'youtube'].includes(s.id)).map((s) => [s.id, s]));

// „@badge-info=;badges=moderator/1;color=#FF0000 :name!name@name.tmi.twitch.tv PRIVMSG #kanal :Hallo“
export function parseIrc(line) {
  let rest = line;
  const tags = {};
  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ');
    for (const pair of rest.slice(1, end).split(';')) {
      const i = pair.indexOf('=');
      const key = i < 0 ? pair : pair.slice(0, i);
      tags[key] = i < 0 ? '' : pair.slice(i + 1).replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
    }
    rest = rest.slice(end + 1);
  }
  let prefix = '';
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ');
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1);
  }
  const colon = rest.indexOf(' :');
  const trailing = colon >= 0 ? rest.slice(colon + 2) : null;
  const [command, ...params] = (colon >= 0 ? rest.slice(0, colon) : rest).split(' ').filter(Boolean);
  return { tags, prefix, command, params, trailing, login: prefix.split('!')[0] };
}

// Nachricht in Teile zerlegen: Text und Emotes (Positionen zählen Unicode-Zeichen)
export function messageParts(text, emotesTag = '') {
  const chars = Array.from(text);
  const spots = [];
  for (const entry of emotesTag.split('/').filter(Boolean)) {
    const [id, ranges] = entry.split(':');
    if (!/^[\w-]+$/.test(id) || !ranges) continue;
    for (const range of ranges.split(',')) {
      const [a, b] = range.split('-').map(Number);
      if (Number.isInteger(a) && Number.isInteger(b) && a <= b && b < chars.length) spots.push({ id, a, b });
    }
  }
  spots.sort((x, y) => x.a - y.a);
  const parts = [];
  let pos = 0;
  for (const s of spots) {
    if (s.a < pos) continue;
    if (s.a > pos) parts.push({ text: chars.slice(pos, s.a).join('') });
    parts.push({ emote: s.id, name: chars.slice(s.a, s.b + 1).join('') });
    pos = s.b + 1;
  }
  if (pos < chars.length) parts.push({ text: chars.slice(pos).join('') });
  return parts;
}

// Namensfarbe: eigene Farbe, sonst Twitch-Standard – zu dunkle Farben aufgehellt (dunkler Hintergrund)
export function nameColor(color, login) {
  let hex = /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : null;
  if (!hex) {
    let h = 0;
    for (const c of login ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
    hex = DEFAULT_COLORS[h % DEFAULT_COLORS.length];
  }
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (light >= 0.5) return hex;
  const mix = (v) => Math.round(v + (255 - v) * (0.5 - light) * 1.4);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// Twitch schickt „moderator/1,subscriber/12“, YouTube eine Liste von Namen
export function badgeList(tag = '') {
  if (Array.isArray(tag)) return tag.filter((b) => BADGES[b]).map((b) => ({ id: b, ...BADGES[b] }));
  return tag.split(',').map((b) => b.split('/')[0]).filter((b) => BADGES[b]).map((b) => ({ id: b, ...BADGES[b] }));
}

// Chat-Nachricht als Element. showPlatform: kleines Twitch-/YouTube-Logo vor dem Namen
export function renderMessage(msg, { showPlatform = false, doc = document } = {}) {
  const row = doc.createElement('div');
  row.className = `chat-msg${msg.action ? ' is-action' : ''}${msg.highlight ? ' is-highlight' : ''}`;
  row.dataset.id = msg.id ?? '';
  row.dataset.user = msg.login ?? '';
  row.dataset.platform = msg.platform ?? 'twitch';
  const color = nameColor(msg.color, msg.login);
  row.style.setProperty('--nc', color);
  const platform = PLATFORMS[msg.platform ?? 'twitch'];
  if (showPlatform && platform) {
    const logo = socialBadge(platform, doc);
    logo.classList.add('chat-platform');
    row.append(logo);
  }
  const badges = Array.isArray(msg.badges) && typeof msg.badges[0] === 'string' ? badgeList(msg.badges) : msg.badges ?? [];
  for (const b of badges) {
    const badge = doc.createElement('span');
    badge.className = `chat-badge chat-badge-${b.id}`;
    badge.title = b.label;
    badge.textContent = b.text;
    row.append(badge);
  }
  const name = doc.createElement('b');
  name.className = 'chat-name';
  name.textContent = msg.name;
  row.append(name, doc.createTextNode(msg.action ? ' ' : ': '));
  const body = doc.createElement('span');
  body.className = 'chat-text';
  if (msg.paid) {
    const paid = doc.createElement('span');
    paid.className = 'chat-paid';
    paid.textContent = msg.paid;
    body.append(paid, ' ');
  }
  for (const part of msg.parts) {
    if (part.image && /^https:\/\/[a-z0-9.-]+\.(ggpht|googleusercontent|ytimg|youtube)\.com\//.test(part.image)) {
      const img = doc.createElement('img');
      img.className = 'chat-emote';
      img.src = part.image;
      img.alt = part.name ?? '';
      img.title = part.name ?? '';
      body.append(img);
    } else if (part.emote) {
      const img = doc.createElement('img');
      img.className = 'chat-emote';
      img.src = EMOTE_URL(part.emote);
      img.alt = part.name;
      img.title = part.name;
      body.append(img);
    } else {
      body.append(part.text);
    }
  }
  row.append(body);
  return row;
}

// Verbindung zu einem Kanal. on.message(msg), on.remove(id), on.clear(login | null), on.status(text).
// Liefert eine Funktion zum Beenden. Bricht die Verbindung ab, verbindet es sich selbst neu.
export function connectTwitchChat(channel, on = {}) {
  const chan = String(channel ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!chan) return () => {};
  let ws = null;
  let stopped = false;
  let retry = 1000;
  let pingTimer = 0;
  const open = () => {
    if (stopped) return;
    try {
      ws = new WebSocket(IRC_URL);
    } catch (err) {
      console.warn('Twitch-Chat: keine Verbindung', err);
      return later();
    }
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE');
      ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      ws.send(`JOIN #${chan}`);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { if (ws?.readyState === 1) ws.send('PING :stellwerk'); }, 4 * 60_000);
    };
    ws.onmessage = (e) => {
      for (const line of String(e.data).split('\r\n')) {
        if (line) handle(parseIrc(line));
      }
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      on.status?.('getrennt');
      later();
    };
    ws.onerror = () => ws?.close();
  };
  const later = () => {
    if (stopped) return;
    setTimeout(open, retry);
    retry = Math.min(60_000, retry * 2);
  };
  const handle = (m) => {
    if (m.command === 'PING') { ws.send(`PONG :${m.trailing ?? 'tmi.twitch.tv'}`); return; }
    if (m.command === 'RECONNECT') { ws.close(); return; }
    if (m.command === 'JOIN' && m.login.startsWith('justinfan')) { retry = 1000; on.status?.('verbunden'); return; }
    if (m.command === 'CLEARMSG') { on.remove?.(m.tags['target-msg-id']); return; }
    if (m.command === 'CLEARCHAT') { on.clear?.(m.trailing || null); return; }
    if (m.command !== 'PRIVMSG' || m.trailing === null) return;
    let text = m.trailing;
    let action = false;
    const me = /^\u0001ACTION (.*)\u0001$/.exec(text);
    if (me) { text = me[1]; action = true; }
    on.message?.({
      platform: 'twitch',
      id: m.tags.id,
      login: m.login,
      name: m.tags['display-name'] || m.login,
      color: m.tags.color,
      badges: badgeList(m.tags.badges),
      text,
      parts: messageParts(text, m.tags.emotes),
      action,
      highlight: m.tags['msg-id'] === 'highlighted-message',
    });
  };
  open();
  return () => {
    stopped = true;
    clearInterval(pingTimer);
    ws?.close();
  };
}

// Probe-Nachrichten für die Vorschau im OBS-Dialog (test=1)
const SAMPLES = [
  ['Lokfuehrer_Lena', '#FF69B4', 'subscriber/6', 'Guten Abend, Dave! 🚂'],
  ['SchienenSeb', '', 'moderator/1', 'Denkt an !füttern, Rexi hat Hunger'],
  ['TTV_Weichensteller', '#1E90FF', '', 'Was für ein Kunstschuss 😂'],
  ['Bahnhofskater', '#9ACD32', 'vip/1', 'GG! Nächste Runde gleich?'],
  ['ICE_Irina', '#DAA520', 'subscriber/24', '!change lok'],
  ['Gleis9dreiviertel', '', '', 'Ich wette, Dave landet wieder am Pleasant Park'],
];
const YT_SAMPLES = [
  ['Zugfan Sabine', 'member', 'Hallo aus dem YouTube-Chat! 👋', null],
  ['Max Gleisbett', '', 'Stark gespielt!', '5,00 €'],
];
// youtube = true: jede dritte Probe-Nachricht kommt von YouTube
export function sampleMessage(n = 0, { youtube = false } = {}) {
  if (youtube && n % 3 === 2) {
    const [name, badge, text, paid] = YT_SAMPLES[Math.floor(n / 3) % YT_SAMPLES.length];
    return { platform: 'youtube', id: `test-yt-${Date.now()}-${n}`, login: `yt:${name}`, name, color: null, badges: badgeList(badge ? [badge] : []), text, parts: [{ text }], paid, highlight: !!paid };
  }
  const [name, color, badges, text] = SAMPLES[n % SAMPLES.length];
  return { platform: 'twitch', id: `test-${Date.now()}-${n}`, login: name.toLowerCase(), name, color, badges: badgeList(badges), text, parts: [{ text }] };
}
