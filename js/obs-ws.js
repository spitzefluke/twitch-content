// Verbindung zu OBS über den eingebauten WebSocket-Server (OBS 28 oder neuer,
// Protokoll obs-websocket 5). Läuft im Browser auf dem PC, auf dem OBS läuft:
// Die Seite holt sich Bilder aus OBS für die Vorschau, liest aus, wo Daves
// Kamera sitzt, und richtet die Browserquelle für das Overlay ein.

export const OVERLAY_SOURCE = 'Stellwerk-Overlay';
const OVERLAY_SIZE = { width: 1920, height: 1080 };

// Typen, die fast immer eine Kamera sind (Windows, macOS, Linux, Capture-Karten, NDI)
const CAMERA_KIND = /dshow_input|av_capture|avcapture|v4l2|decklink|ndi|camera|webcam/i;
const CAMERA_NAME = /cam|kamera|webcam|face/i;
const NOT_VIDEO = /browser_source|text_|color_source|wasapi|coreaudio|pulse|alsa|jack|audio/i;

export class ObsSocket {
  constructor() {
    this.ws = null;
    this.pending = new Map();
    this.nextId = 1;
    this.onClose = null;
  }

  get connected() { return this.ws?.readyState === WebSocket.OPEN && this.identified; }

  // Verbindet und meldet sich an. Wirft Fehler mit deutscher Meldung.
  connect({ password = '', port = 4455 } = {}) {
    this.close();
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(`ws://127.0.0.1:${port}`);
      } catch {
        reject(new Error('Der Browser lässt die Verbindung zu OBS nicht zu.'));
        return;
      }
      this.ws = ws;
      this.identified = false;
      let settled = false;
      const fail = (message) => { if (!settled) { settled = true; reject(new Error(message)); } };
      const timer = setTimeout(() => { fail('OBS antwortet nicht.'); ws.close(); }, 6000);

      ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.op === 0) {
          // Hello: evtl. mit Passwort-Abfrage
          const identify = { rpcVersion: 1, eventSubscriptions: 0 };
          if (msg.d.authentication) {
            if (!password) { fail('OBS verlangt ein Passwort.'); ws.close(); return; }
            identify.authentication = await authString(password, msg.d.authentication.salt, msg.d.authentication.challenge);
          }
          ws.send(JSON.stringify({ op: 1, d: identify }));
        } else if (msg.op === 2) {
          clearTimeout(timer);
          this.identified = true;
          settled = true;
          this.version = msg.d.negotiatedRpcVersion;
          resolve();
        } else if (msg.op === 7) {
          const p = this.pending.get(msg.d.requestId);
          if (!p) return;
          this.pending.delete(msg.d.requestId);
          if (msg.d.requestStatus.result) p.resolve(msg.d.responseData ?? {});
          else p.reject(new Error(msg.d.requestStatus.comment || `OBS: Fehler ${msg.d.requestStatus.code}`));
        }
      };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        if (ev.code === 4009) fail('Falsches Passwort. Es steht in OBS unter Werkzeuge → WebSocket-Servereinstellungen → „Verbindungsinfo anzeigen“.');
        else if (ev.code === 4010) fail('Diese OBS-Version ist zu alt. Es braucht OBS 28 oder neuer.');
        else fail('Keine Verbindung zu OBS. Läuft OBS auf diesem PC und ist unter Werkzeuge → WebSocket-Servereinstellungen „WebSocket-Server aktivieren“ angehakt?');
        for (const p of this.pending.values()) p.reject(new Error('Verbindung zu OBS getrennt.'));
        this.pending.clear();
        const wasIdentified = this.identified;
        this.identified = false;
        if (wasIdentified) this.onClose?.();
      };
    });
  }

  close() {
    if (!this.ws) return;
    this.ws.onclose = null;
    this.ws.close();
    this.ws = null;
    this.identified = false;
  }

  request(requestType, requestData = {}) {
    if (!this.connected) return Promise.reject(new Error('Nicht mit OBS verbunden.'));
    const requestId = String(this.nextId++);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      setTimeout(() => {
        if (this.pending.delete(requestId)) reject(new Error('OBS antwortet nicht.'));
      }, 8000);
    });
  }

  async programScene() {
    const r = await this.request('GetCurrentProgramScene');
    return r.currentProgramSceneName ?? r.sceneName;
  }

  async canvas() {
    const v = await this.request('GetVideoSettings');
    return { width: v.baseWidth, height: v.baseHeight };
  }

  // Aktuelles Programmbild als JPEG-data:-URL
  async screenshot(scene, width = 960) {
    const r = await this.request('GetSourceScreenshot', {
      sourceName: scene, imageFormat: 'jpg', imageWidth: width, imageCompressionQuality: 70,
    });
    return r.imageData;
  }

  // Alle Bildquellen der Szene mit ihrem Bereich in Prozent; wahrscheinliche Kameras zuerst.
  async sources(scene) {
    const [{ sceneItems }, canvas] = await Promise.all([this.request('GetSceneItemList', { sceneName: scene }), this.canvas()]);
    return sceneItems
      .filter((it) => !it.isGroup && it.sourceName !== OVERLAY_SOURCE && !NOT_VIDEO.test(it.inputKind ?? ''))
      .map((it) => ({
        name: it.sourceName,
        kind: it.inputKind ?? '',
        enabled: it.sceneItemEnabled,
        camera: CAMERA_KIND.test(it.inputKind ?? '') || CAMERA_NAME.test(it.sourceName),
        rect: itemRect(it.sceneItemTransform, canvas),
      }))
      .filter((s) => s.rect)
      .sort((a, b) => Number(b.camera) - Number(a.camera) || Number(b.enabled) - Number(a.enabled));
  }

  // Legt die Browserquelle an oder aktualisiert ihre Adresse – und legt sie
  // in der aktuellen Szene ganz nach oben, über die Kamera.
  async applyOverlay(url) {
    const scene = await this.programScene();
    const canvas = await this.canvas();
    const settings = { url, ...OVERLAY_SIZE, reroute_audio: true, shutdown: false };
    const { inputs } = await this.request('GetInputList');
    const exists = inputs.some((i) => i.inputName === OVERLAY_SOURCE);
    let created = false;
    if (exists) {
      await this.request('SetInputSettings', { inputName: OVERLAY_SOURCE, inputSettings: settings, overlay: true });
    } else {
      await this.request('CreateInput', {
        sceneName: scene, inputName: OVERLAY_SOURCE, inputKind: 'browser_source', inputSettings: settings, sceneItemEnabled: true,
      });
      created = true;
    }
    let id;
    try {
      id = (await this.request('GetSceneItemId', { sceneName: scene, sourceName: OVERLAY_SOURCE })).sceneItemId;
    } catch {
      id = (await this.request('CreateSceneItem', { sceneName: scene, sourceName: OVERLAY_SOURCE })).sceneItemId;
      created = true;
    }
    if (created) {
      // Das Overlay ist für 1920 × 1080 gebaut – auf die Leinwand von OBS skalieren.
      await this.request('SetSceneItemTransform', {
        sceneName: scene,
        sceneItemId: id,
        sceneItemTransform: {
          positionX: 0, positionY: 0, rotation: 0, alignment: 5,
          scaleX: canvas.width / OVERLAY_SIZE.width, scaleY: canvas.height / OVERLAY_SIZE.height,
        },
      });
    }
    const { sceneItems } = await this.request('GetSceneItemList', { sceneName: scene });
    await this.request('SetSceneItemIndex', { sceneName: scene, sceneItemId: id, sceneItemIndex: sceneItems.length - 1 });
    await this.request('SetSceneItemEnabled', { sceneName: scene, sceneItemId: id, sceneItemEnabled: true });
    return { scene, created };
  }
}

// Wo liegt eine Quelle auf der Leinwand? Berücksichtigt Skalierung, Zuschnitt,
// Begrenzungsrahmen und Ausrichtung (ohne Drehung). Ergebnis in Prozent.
export function itemRect(t, canvas) {
  if (!t || !canvas?.width) return null;
  let w;
  let h;
  if (t.boundsType && t.boundsType !== 'OBS_BOUNDS_NONE') {
    w = t.boundsWidth;
    h = t.boundsHeight;
  } else {
    w = Math.abs((t.sourceWidth - (t.cropLeft ?? 0) - (t.cropRight ?? 0)) * t.scaleX);
    h = Math.abs((t.sourceHeight - (t.cropTop ?? 0) - (t.cropBottom ?? 0)) * t.scaleY);
  }
  if (!w || !h) return null;
  const a = t.alignment ?? 5; // 1 = links, 2 = rechts, 4 = oben, 8 = unten, 0 = Mitte
  const x = t.positionX - (a & 1 ? 0 : a & 2 ? w : w / 2);
  const y = t.positionY - (a & 4 ? 0 : a & 8 ? h : h / 2);
  const pct = (v, total) => Math.round((v / total) * 1000) / 10;
  const clamp = (v) => Math.min(100, Math.max(0, v));
  const left = clamp(pct(x, canvas.width));
  const top = clamp(pct(y, canvas.height));
  const right = clamp(pct(x + w, canvas.width));
  const bottom = clamp(pct(y + h, canvas.height));
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: left, y: top, w: Math.round((right - left) * 10) / 10, h: Math.round((bottom - top) * 10) / 10 };
}

// obs-websocket 5: base64(sha256(base64(sha256(passwort + salt)) + challenge))
async function authString(password, salt, challenge) {
  const sha = async (text) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  };
  return sha((await sha(password + salt)) + challenge);
}
