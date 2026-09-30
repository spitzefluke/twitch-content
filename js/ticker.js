// Laufband im OBS-Overlay: andere Seiten und Socials laufen langsam von
// rechts nach links durch. Die Texte pflegen Admins im OBS-Dialog.
// Steht eine bekannte Plattform in der Zeile (twitch.tv, youtube.com, tiktok.com …),
// bekommt sie das echte Logo (js/social-icons.js).
import { socialBadge, socialFor } from './social-icons.js';

export const DEFAULT_TICKER = ['🟣 twitch.tv/{kanal}', '💜 StreamHelp: {seite}'];
export const TICKER_STYLES = ['bar', 'neon', 'board'];

// Symbole, die früher automatisch vor Socials standen (auch in gespeicherten Texten):
// steht ein Logo davor, fallen sie weg
const OLD_SOCIAL_EMOJI = /^(🟣|▶️|▶|🎵|📸|💬|𝕏|🟢|🎧|🎮|💛)\s*/u;
// Für Seiten ohne Logo weiter ein Symbol
const ICONS = [[/throne|wunschliste|amazon/i, '🎁'], [/tipeee|spende|donat/i, '💛']];
const startsWithSymbol = (text) => /^[\p{Extended_Pictographic}\p{So}]/u.test(text);

// {kanal} wird zum Twitch-Namen des Streamers (setzt das Overlay, sobald er bekannt ist)
let channel = '';
export function setTickerChannel(login) { channel = String(login ?? '').trim(); }
const fillChannel = (line) => {
  const raw = String(line ?? '');
  if (!raw.includes('{kanal}')) return raw;
  return channel ? raw.replaceAll('{kanal}', channel) : ''; // Kanal unbekannt: Zeile weglassen
};

// Eine Zeile: Text und – falls bekannt – die Plattform fürs Logo
export function tickerLine(line, site = siteAddress()) {
  let text = fillChannel(line).replaceAll('{seite}', site).trim();
  const social = text ? socialFor(text) : null;
  if (social) text = text.replace(OLD_SOCIAL_EMOJI, '');
  return { text: social ? text : tickerText(text, site), social };
}

// Adresse der Webseite ohne https:// – für {seite}
export function siteAddress(loc = location) {
  const path = loc.pathname.replace(/[^/]*$/, '').replace(/\/$/, '');
  return `${loc.host}${path}`;
}

export function tickerText(line, site = siteAddress()) {
  const text = fillChannel(line).replaceAll('{seite}', site).trim();
  if (!text || startsWithSymbol(text)) return text;
  const icon = ICONS.find(([re]) => re.test(text))?.[1];
  return icon ? `${icon} ${text}` : text;
}

// Füllt die Laufschrift und lässt sie mit gleichmäßigem Tempo (px/s) laufen.
// Der Inhalt steht doppelt drin, damit das Band ohne Lücke weiterläuft.
export function fillTicker(track, items, { speed = 70, site } = {}) {
  const lines = (items?.length ? items : DEFAULT_TICKER).map((l) => tickerLine(l, site)).filter((l) => l.text);
  const group = () => {
    const g = document.createElement('span');
    g.className = 'ticker-group';
    for (const line of lines) {
      const item = document.createElement('span');
      item.className = 'ticker-item';
      if (line.social) item.append(socialBadge(line.social));
      item.append(line.text);
      const dot = document.createElement('span');
      dot.className = 'ticker-sep';
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = '◆';
      g.append(item, dot);
    }
    return g;
  };
  track.replaceChildren(group(), group());
  // Mindestens so breit wie der sichtbare Bereich, sonst entstehen Lücken
  const view = track.parentElement.clientWidth;
  const first = track.firstElementChild;
  let copies = 1;
  while (first.scrollWidth * copies < view && copies < 8) {
    first.append(...[...group().childNodes]);
    copies++;
  }
  track.lastElementChild.replaceWith(first.cloneNode(true));
  const distance = first.scrollWidth;
  track.style.setProperty('--tdist', `${distance}px`);
  track.style.animationDuration = `${Math.max(4, distance / Math.max(10, speed))}s`;
}
