// Laufband im OBS-Overlay: andere Seiten und Socials laufen langsam von
// rechts nach links durch. Die Texte pflegen Admins im OBS-Dialog.

export const DEFAULT_TICKER = ['🟣 twitch.tv/zugfahrer_davetv', '🚂 Content-Stellwerk: {seite}'];
export const TICKER_STYLES = ['bar', 'neon', 'board'];

// Symbol passend zur Seite, falls die Zeile nicht schon mit einem beginnt
const ICONS = [
  [/twitch/i, '🟣'], [/youtu/i, '▶️'], [/tiktok/i, '🎵'], [/insta/i, '📸'], [/discord/i, '💬'],
  [/(^|\W)(x\.com|twitter)/i, '𝕏'], [/kick\.com/i, '🟢'], [/spotify/i, '🎧'], [/steam/i, '🎮'],
  [/throne|wunschliste|amazon/i, '🎁'], [/paypal|tipeee|streamlabs|kofi|ko-fi/i, '💛'],
];
const startsWithSymbol = (text) => /^[\p{Extended_Pictographic}\p{So}]/u.test(text);

// Adresse der Webseite ohne https:// – für {seite}
export function siteAddress(loc = location) {
  const path = loc.pathname.replace(/[^/]*$/, '').replace(/\/$/, '');
  return `${loc.host}${path}`;
}

export function tickerText(line, site = siteAddress()) {
  const text = String(line ?? '').replaceAll('{seite}', site).trim();
  if (!text || startsWithSymbol(text)) return text;
  const icon = ICONS.find(([re]) => re.test(text))?.[1];
  return icon ? `${icon} ${text}` : text;
}

// Füllt die Laufschrift und lässt sie mit gleichmäßigem Tempo (px/s) laufen.
// Der Inhalt steht doppelt drin, damit das Band ohne Lücke weiterläuft.
export function fillTicker(track, items, { speed = 70, site } = {}) {
  const lines = (items?.length ? items : DEFAULT_TICKER).map((l) => tickerText(l, site)).filter(Boolean);
  const group = () => {
    const g = document.createElement('span');
    g.className = 'ticker-group';
    for (const line of lines) {
      const item = document.createElement('span');
      item.className = 'ticker-item';
      item.textContent = line;
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
