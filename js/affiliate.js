// Twitch-Kanäle ohne Affiliate oder Partner (Migration …_live_sync.sql, channels.broadcaster_type):
// Kanalpunkte, Abos, Bits und Vorhersagen gibt es dort nicht – der Rest von StreamHelp (Chat-Bot, Overlay,
// Follower-Alerts, Content-Ideen) läuft ganz normal.
//   data-affiliate="Kanalpunkte"       → Hinweis oben drin, der Inhalt ist gesperrt (inert) und blass
//   data-affiliate-soft="Abo-Alerts"   → nur der Hinweis, nichts gesperrt
// Auch später eingefügte Bereiche (Fenster aus extras-*.js) bekommen den Hinweis.
const SEL = '[data-affiliate], [data-affiliate-soft]';
let off = false;
let observer = null;

export const affiliateText = (what) =>
  `${what} gibt es auf Twitch nur für Affiliates und Partner – in diesem Kanal ist das deshalb aus. Alles andere funktioniert ganz normal.`;

function note(what) {
  const p = document.createElement('p');
  p.className = 'aff-note';
  p.setAttribute('role', 'note');
  const ico = document.createElement('span');
  ico.setAttribute('aria-hidden', 'true');
  ico.textContent = 'ℹ️';
  const text = document.createElement('span');
  text.textContent = affiliateText(what);
  p.append(ico, text);
  return p;
}

function mark(el) {
  const soft = !el.hasAttribute('data-affiliate');
  const what = el.getAttribute(soft ? 'data-affiliate-soft' : 'data-affiliate') || 'Das';
  let n = [...el.children].find((c) => c.classList.contains('aff-note'));
  if (off && !n) el.prepend(n = note(what));
  if (!off && n) n.remove();
  el.classList.toggle('aff-off', off && !soft);
  if (soft) return;
  for (const child of el.children) {
    if (child.classList.contains('aff-note')) continue;
    child.inert = off;
  }
}

function scan(root) {
  if (root.matches?.(SEL)) mark(root);
  root.querySelectorAll?.(SEL).forEach(mark);
}

// isAffiliate: true/false, null = unbekannt (dann nichts sperren)
export function setAffiliate(isAffiliate) {
  const next = isAffiliate === false;
  if (next === off) return;
  off = next;
  scan(document);
  observer?.disconnect();
  observer = null;
  if (off) {
    observer = new MutationObserver((list) => {
      for (const m of list) for (const node of m.addedNodes) if (node.nodeType === 1 && !node.classList.contains('aff-note')) scan(node);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

export const noAffiliate = () => off;
