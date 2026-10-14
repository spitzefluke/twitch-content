// Dashboard → Twitch-Verbindung → Karte „YouTube“ (Migration …_live_sync.sql, Edge Function youtube):
//   · YouTube-Kanal verbinden (Google-Login) und wieder trennen
//   · Schalter: mit Twitch live gehen, mit Twitch beenden, YouTube-Chat im Overlay, Sichtbarkeit
//   · Stream-Schlüssel für OBS (zweites Ziel neben Twitch) und „Jetzt starten/beenden“ zum Testen
// Einstellungen ändert nur der Streamer selbst; freigegebene Mods sehen den Stand.
import { h } from './extras-core.js';

const PRIVACY = { public: 'Öffentlich', unlisted: 'Nicht gelistet', private: 'Privat' };
const LIVE_TEXT = {
  idle: 'Gerade keine Sendung.',
  starting: 'Sendung angelegt – startet, sobald OBS Bild an YouTube schickt.',
  live: 'Live auf YouTube.',
  ended: 'Letzte Sendung beendet.',
  error: 'Fehler',
};

// replaceChildren macht aus null den Text „null“ – Lücken weglassen
const fill = (el, ...kids) => el.replaceChildren(...kids.filter(Boolean));
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

function toggle(name, label, checked, disabled) {
  return h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', name, checked: checked ? '' : null, disabled: disabled ? '' : null }),
    h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }),
    label);
}

export async function renderYoutube(card, { api, toast, germanError }) {
  if (!card || !api.youtubeStatus) return;
  const body = card.querySelector('[data-yt-body]');
  const status = card.querySelector('[data-yt-status]');
  let st;
  try {
    st = await api.youtubeStatus();
  } catch (err) {
    // Migration fehlt: Karte aus
    card.hidden = true;
    console.warn('YouTube-Status nicht lesbar:', err);
    return;
  }
  card.hidden = !st?.allowed;
  if (!st?.allowed) return;
  const run = async (btn, fn) => {
    btn.disabled = true;
    try { await fn(); } catch (err) { toast(germanError(err), 'error', 9000); } finally { btn.disabled = false; }
  };

  if (!st.connected) {
    status.textContent = 'Nicht verbunden';
    const connect = h('button', { class: 'btn btn--primary', type: 'button', disabled: st.can_edit ? null : '' }, '▶️ YouTube verbinden');
    connect.addEventListener('click', () => run(connect, () => api.youtubeConnect()));
    fill(body,
      h('p', {}, 'Verbinde deinen YouTube-Kanal: Dann startet und beendet StreamHelp deinen YouTube-Livestream zusammen mit Twitch, und der YouTube-Chat kommt ohne Suchen und mit wenig Verzögerung ins Overlay.'),
      h('p', { class: 'form-hint' }, 'Für das Bild sendet OBS an beide (Multistream-Plugin, z. B. „Multiple RTMP outputs“ oder Aitum Multistream) – den Stream-Schlüssel dafür zeigt StreamHelp nach dem Verbinden.'),
      st.can_edit ? null : h('p', { class: 'form-hint' }, 'Verbinden kann nur der Streamer selbst.'),
      h('div', { class: 'dialog-actions' }, connect));
    return;
  }

  status.textContent = `Verbunden mit ${st.title || st.handle || 'YouTube'}`;
  const live = st.live ?? {};
  const liveLine = h('p', { class: `yt-live yt-live--${live.status ?? 'idle'}` },
    h('b', {}, live.status === 'error' ? `⚠️ ${live.message ?? 'Fehler'}` : LIVE_TEXT[live.status] ?? LIVE_TEXT.idle),
    live.video_id && ['starting', 'live'].includes(live.status)
      ? h('a', { href: `https://www.youtube.com/watch?v=${encodeURIComponent(live.video_id)}`, target: '_blank', rel: 'noopener' }, ' Sendung öffnen ↗')
      : null,
    live.started_at && live.status !== 'idle' ? h('small', {}, ` (seit ${fmt(live.started_at)})`) : null);

  const edit = !!st.can_edit;
  const form = h('form', { class: 'yt-form' },
    toggle('auto_start', 'YouTube-Livestream starten, wenn der Twitch-Stream startet', st.auto_start, !edit),
    toggle('auto_stop', 'YouTube-Livestream beenden, wenn der Twitch-Stream endet', st.auto_stop, !edit),
    toggle('chat_merge', 'YouTube-Chat im Overlay zeigen (Chat-Ebene, zusammen mit Twitch)', st.chat_merge, !edit),
    h('label', { class: 'field' }, h('span', {}, 'Sichtbarkeit neuer YouTube-Sendungen'),
      h('select', { name: 'privacy', disabled: edit ? null : '' },
        ...Object.entries(PRIVACY).map(([v, label]) => h('option', { value: v, selected: v === st.privacy ? '' : null }, label)))));
  form.addEventListener('change', async () => {
    const f = new FormData(form);
    try {
      await api.youtubeSave({
        auto_start: f.has('auto_start'), auto_stop: f.has('auto_stop'), chat_merge: f.has('chat_merge'), privacy: f.get('privacy'),
      });
      toast('YouTube-Einstellungen gespeichert.', 'ok');
    } catch (err) {
      toast(germanError(err), 'error');
    }
  });

  // Stream-Schlüssel: erst auf Klick holen, nie speichern
  const keyBox = h('div', { class: 'yt-key', hidden: '' });
  const showKey = h('button', { class: 'btn btn--outline btn--sm', type: 'button' }, '🔑 Stream-Schlüssel für OBS');
  showKey.addEventListener('click', () => run(showKey, async () => {
    if (!keyBox.hidden) { keyBox.hidden = true; keyBox.replaceChildren(); return; }
    const k = await api.youtubeStreamKey();
    const copy = (text) => {
      const b = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Kopieren');
      b.addEventListener('click', () => navigator.clipboard?.writeText(text).then(() => toast('Kopiert.', 'ok')).catch(() => {}));
      return b;
    };
    keyBox.replaceChildren(
      h('p', { class: 'form-hint' }, 'In OBS im Multistream-Plugin als zweites Ziel eintragen. Den Schlüssel niemandem zeigen – wer ihn hat, kann auf deinem Kanal senden.'),
      h('label', { class: 'field' }, h('span', {}, 'Server'), h('div', { class: 'yt-key-row' }, h('input', { type: 'text', readonly: '', value: k.server }), copy(k.server))),
      h('label', { class: 'field' }, h('span', {}, 'Stream-Schlüssel'), h('div', { class: 'yt-key-row' }, h('input', { type: 'password', readonly: '', value: k.key, autocomplete: 'off' }), copy(k.key))),
      h('p', { class: 'form-hint' }, k.status === 'active' ? '✓ Gerade kommt Bild aus OBS an.' : 'Gerade kommt kein Bild an (das ist normal, solange du nicht streamst).'));
    keyBox.hidden = false;
  }));
  const goLive = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, '▶️ Jetzt starten');
  goLive.addEventListener('click', () => run(goLive, async () => {
    const r = await api.youtubeGoLive();
    toast(r?.ok ? 'YouTube-Sendung ist angelegt – sie startet, sobald OBS Bild schickt.' : `YouTube: ${r?.reason ?? 'nicht gestartet'}`, r?.ok ? 'ok' : 'error', 9000);
    renderYoutube(card, { api, toast, germanError });
  }));
  const endLive = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, '⏹️ Jetzt beenden');
  endLive.addEventListener('click', () => run(endLive, async () => {
    if (!confirm('YouTube-Livestream jetzt beenden?')) return;
    const r = await api.youtubeEndLive();
    toast(r?.ok ? 'YouTube-Sendung beendet.' : `YouTube: ${r?.reason ?? 'nicht beendet'}`, r?.ok ? 'ok' : 'error');
    renderYoutube(card, { api, toast, germanError });
  }));
  const disconnect = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'YouTube trennen');
  disconnect.addEventListener('click', () => run(disconnect, async () => {
    if (!confirm('YouTube trennen? StreamHelp startet dann keine YouTube-Sendungen mehr.')) return;
    await api.youtubeDisconnect();
    toast('YouTube ist getrennt.', 'ok');
    renderYoutube(card, { api, toast, germanError });
  }));
  const reconnect = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Neu verbinden');
  reconnect.addEventListener('click', () => run(reconnect, () => api.youtubeConnect()));

  fill(body,
    liveLine,
    form,
    edit ? h('div', { class: 'dialog-actions yt-actions' }, showKey, goLive, endLive, reconnect, disconnect) : null,
    keyBox,
    h('p', { class: 'form-hint' }, 'Wenig Verzögerung: Neue Sendungen laufen mit „ultra niedriger Latenz“. Der YouTube-Chat kommt über die Video-ID der Sendung ins Overlay – sofort, wenn Twitch startet.'),
    edit ? null : h('p', { class: 'form-hint' }, 'Ändern kann das nur der Streamer selbst.'));
}
