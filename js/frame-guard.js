// Schutz gegen Clickjacking: Die Webseite und der Admin-Bereich dürfen nicht in einer
// fremden Seite (iframe) stecken – sonst könnte jemand unsichtbar Klicks „unterschieben“.
// GitHub Pages kann dafür keinen Header (X-Frame-Options) setzen, deshalb hier im Skript.
// Eingebettet in die eigene Seite (z. B. die OBS-Vorschau) ist erlaubt.
export function guardFrame() {
  if (window.top === window.self) return true;
  let sameOrigin = false;
  try { sameOrigin = window.top.location.origin === location.origin; } catch { /* fremde Seite */ }
  if (sameOrigin) return true;
  document.documentElement.innerHTML = '<body style="font:16px system-ui;padding:24px;background:#07090f;color:#eef1f7">'
    + 'Diese Seite darf nicht eingebettet werden. <a style="color:#ffb81c" target="_top" rel="noopener" href="' + location.href.replace(/"/g, '%22') + '">Direkt öffnen</a></body>';
  return false;
}
