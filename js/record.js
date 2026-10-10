// Aufnahme-Studio (record.html): ein Video für YouTube, Shorts oder TikTok aufnehmen – direkt im
// Browser, während OBS ganz normal streamt. Das Overlay steckt nur in OBS, im Video ist es deshalb
// nicht zu sehen – außer man schaltet hier einzelne Elemente dazu.
//
//   Bild:  Bildschirm oder Fenster (getDisplayMedia), auf Wunsch die Kamera dazu
//   Ton:   Spielton aus der Freigabe („Systemaudio teilen“) + Mikrofon, gemischt per Web Audio
//   Datei: WebM (Safari: MP4), direkt auf die Festplatte geschrieben (lange Videos) oder
//          am Ende zum Herunterladen
//
// Zwei Wege, das Bild zu bauen:
//   ohne Overlay → aus den Einzelbildern der Freigabe selbst zusammengesetzt (MediaStreamTrackProcessor
//                  → OffscreenCanvas → MediaStreamTrackGenerator). Läuft weiter, auch wenn das Studio
//                  im Hintergrund liegt und man spielt. Ohne diese Schnittstellen (Firefox): Canvas mit
//                  Takt aus einem Worker.
//   mit Overlay  → die Vorschau hier (Spiel + Kamera + Overlay mit rec=<Ebenen>) wird per Tab-Freigabe
//                  aufgenommen und auf die Vorschau zugeschnitten (Region Capture, Chrome und Edge).
import { CONFIG } from './config.js';
import { channelFromUrl, channelHeaders, channelParam, lookupChannel, setChannel, withChannelParam } from './channel.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'sh_rec_settings';
const SIZES = { '16:9': { 1080: [1920, 1080], 720: [1280, 720] }, '9:16': { 1080: [1080, 1920], 720: [720, 1280] } };
const BITRATE = { 1080: { 30: 10_000_000, 60: 16_000_000 }, 720: { 30: 6_000_000, 60: 9_000_000 } };
// WebM zuerst: liefert die Daten jede Sekunde (auch stundenlange Aufnahmen gehen direkt auf die Platte),
// MP4 sammelt in Chrome teils alles bis zum Ende im Speicher. H.264 rechnet meist die Grafikkarte – schont
// die CPU beim Spielen. YouTube, Shorts und TikTok nehmen WebM an. MP4 nur, wo es kein WebM gibt (Safari).
const MIMES = [
  ['video/webm;codecs=h264,opus', 'webm'],
  ['video/webm;codecs=vp9,opus', 'webm'],
  ['video/webm;codecs=vp8,opus', 'webm'],
  ['video/webm', 'webm'],
  ['video/mp4;codecs=avc1,mp4a.40.2', 'mp4'],
  ['video/mp4', 'mp4'],
];
// Overlay-Ebenen (Namen wie im OBS-Fenster). kind: wie die Ebene in den Overlay-Einstellungen an ist
const LAYERS = [
  ['alerts', 'Alerts'], ['chat', 'Chat'], ['ticker', 'Laufband', 'ticker'], ['camframe', 'Kamera-Rahmen', 'flag'],
  ['labels', 'Info-Leiste'], ['goal', 'Ziel-Balken'], ['recent', 'Letzter Follower & Abo'], ['next', 'Als Nächstes'],
  ['wheel', 'Glücksrad'], ['prank', 'Würfe & Sounds', 'flag'], ['pet', 'Haustier', 'flag'], ['quest', 'Unangenehme Fragen'],
  ['bingo', 'Fortnite-Bingo'], ['shop', 'Kisten-Shop'], ['challenge', 'Win-Challenge'], ['forbid', 'Verbotenes Wort'],
  ['subathon', 'Subathon-Timer'], ['quiz', 'Quiz'], ['queue', 'Mitspielen'], ['tts', 'Vorlesen'], ['cards', 'Sammelkarten'],
  ['giveaway', 'Verlosung'], ['hotwords', 'Hot Words'], ['poll', 'Umfrage'], ['counter', 'Zähler'], ['gamewheel', 'Spiel-Rad'], ['heart', 'Herzfrequenz'], ['pause', 'Pausen-Bildschirm', 'flag'], ['scene', 'Szenen-Bildschirm', 'scene'],
];

const form = $('rec-form');
const stage = $('rec-stage');
const gameVideo = $('rec-game');
const camVideo = $('rec-cam');
const frame = $('rec-overlay-frame');

const st = {
  game: null,        // MediaStream der Bildschirm-Freigabe
  cam: null,         // MediaStream der Kamera
  mic: null,         // MediaStream des Mikrofons
  self: null,        // Tab-Freigabe des Studios (nur mit Overlay)
  overlay: { params: null, layers: [], cam: null },
  mixer: null,
  rec: null,         // laufende Aufnahme
  files: [],
};

// ---------- Einstellungen merken ----------
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch { /* ohne Speicher */ }
  for (const name of ['format', 'quality', 'fps', 'campos']) {
    if (!s[name]) continue;
    const el = form.elements[name];
    if (el instanceof RadioNodeList) { const r = [...el].find((x) => x.value === s[name]); if (r) r.checked = true; }
    else if ([...(el.options ?? [])].some((o) => o.value === s[name])) el.value = s[name];
  }
  for (const name of ['camsize', 'gamevol', 'micvol']) if (Number.isFinite(s[name])) form.elements[name].value = s[name];
  for (const name of ['camround', 'disk']) if (typeof s[name] === 'boolean') form.elements[name].checked = s[name];
  return s;
}
function saveSettings() {
  const f = form.elements;
  const s = {
    format: f.format.value, quality: f.quality.value, fps: f.fps.value, campos: f.campos.value,
    camsize: Number(f.camsize.value), gamevol: Number(f.gamevol.value), micvol: Number(f.micvol.value),
    camround: f.camround.checked, disk: f.disk.checked,
    camDevice: st.cam?.getVideoTracks()[0]?.getSettings().deviceId ?? '',
    micDevice: st.mic?.getAudioTracks()[0]?.getSettings().deviceId ?? '',
    layers: selectedLayers(),
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* egal */ }
}

const settings = () => {
  const f = form.elements;
  return {
    format: f.format.value, quality: Number(f.quality.value), fps: Number(f.fps.value),
    campos: f.campos.value, camsize: Number(f.camsize.value), camround: f.camround.checked,
    overlay: f.overlay.checked && f.format.value === '16:9',
  };
};

// ---------- Aufbau des Bildes ----------
// Bereiche als Anteile (0–1) der Bildfläche – gleich für die Vorschau und das selbst gebaute Bild.
function layout(s = settings()) {
  const camOn = !!st.cam;
  if (s.format === '9:16') {
    if (!camOn) return { game: { x: 0, y: 0, w: 1, h: 1, fit: 'cover' }, cam: null };
    return { cam: { x: 0, y: 0, w: 1, h: 0.38, fit: 'cover', round: false }, game: { x: 0, y: 0.38, w: 1, h: 0.62, fit: 'cover' } };
  }
  const game = { x: 0, y: 0, w: 1, h: 1, fit: 'contain' };
  if (!camOn) return { game, cam: null };
  if (s.campos === 'stream' && st.overlay.cam) return { game, cam: { ...st.overlay.cam, fit: 'cover', round: s.camround } };
  const cs = st.cam.getVideoTracks()[0]?.getSettings() ?? {};
  const aspect = cs.width && cs.height ? cs.width / cs.height : 16 / 9;
  const w = s.camsize / 100;
  const h = Math.min(0.9, (w * 16) / 9 / aspect);
  const mx = 0.02;
  const my = (mx * 16) / 9;
  const pos = ['tl', 'tr', 'bl', 'br'].includes(s.campos) ? s.campos : 'br';
  return {
    game,
    cam: { x: pos[1] === 'l' ? mx : 1 - mx - w, y: pos[0] === 't' ? my : 1 - my - h, w, h, fit: 'cover', round: s.camround },
  };
}

function fitRect(sw, sh, r, fit) {
  const k = fit === 'cover' ? Math.max(r.w / sw, r.h / sh) : Math.min(r.w / sw, r.h / sh);
  const w = sw * k;
  const h = sh * k;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

// Ein Bild zeichnen: Spiel und Kamera an ihren Platz (für das selbst gebaute Bild)
function drawScene(ctx, W, H, game, cam) {
  const L = layout();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const px = (r) => ({ x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H });
  const put = (src, sw, sh, rect, opts) => {
    if (!src || !sw || !sh) return;
    const r = px(rect);
    const d = fitRect(sw, sh, r, rect.fit);
    ctx.save();
    ctx.beginPath();
    if (opts?.round && ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.08);
    else ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.drawImage(src, d.x, d.y, d.w, d.h);
    ctx.restore();
  };
  if (game) put(game.src, game.w, game.h, L.game);
  if (cam && L.cam) put(cam.src, cam.w, cam.h, L.cam, L.cam);
}

// Vorschau: dieselben Bereiche als Prozent
function renderStage() {
  const s = settings();
  stage.dataset.format = s.format;
  const L = layout(s);
  const place = (el, r) => {
    Object.assign(el.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, objectFit: r.fit });
  };
  place(gameVideo, L.game);
  gameVideo.hidden = !st.game;
  camVideo.hidden = !L.cam;
  if (L.cam) {
    place(camVideo, L.cam);
    camVideo.classList.toggle('is-round', !!L.cam.round);
  }
  $('rec-empty').hidden = !!st.game;
  $('rec-overlay').hidden = !s.overlay;
  $('rec-cam-opts').hidden = !st.cam || s.format === '9:16';
  $('rec-cam-size-out').textContent = `${form.elements.camsize.value} %`;
  $('rec-game-vol-out').textContent = `${form.elements.gamevol.value} %`;
  $('rec-mic-vol-out').textContent = `${form.elements.micvol.value} %`;
  $('rec-mic-vol').hidden = !st.mic;
  scaleOverlay();
}

// Das Overlay ist für 1920 × 1080 gebaut – auf die Größe der Vorschau skalieren
function scaleOverlay() {
  const k = stage.clientWidth / 1920;
  frame.style.transform = `scale(${k})`;
}

// ---------- Ton ----------
class Mixer {
  constructor() {
    this.ctx = new AudioContext();
    this.dest = this.ctx.createMediaStreamDestination();
    this.parts = {};
  }

  set(name, stream, volume) {
    this.parts[name]?.src.disconnect();
    delete this.parts[name];
    const track = stream?.getAudioTracks()[0];
    if (!track) return;
    const src = this.ctx.createMediaStreamSource(new MediaStream([track]));
    const gain = this.ctx.createGain();
    const meter = this.ctx.createAnalyser();
    meter.fftSize = 512;
    gain.gain.value = volume;
    src.connect(gain).connect(this.dest);
    gain.connect(meter);
    this.parts[name] = { src, gain, meter, buf: new Float32Array(meter.fftSize) };
  }

  volume(name, v) { if (this.parts[name]) this.parts[name].gain.gain.value = v; }

  level(name) {
    const p = this.parts[name];
    if (!p) return 0;
    p.meter.getFloatTimeDomainData(p.buf);
    let sum = 0;
    for (const x of p.buf) sum += x * x;
    return Math.min(1, Math.sqrt(sum / p.buf.length) * 4);
  }

  get track() { return this.dest.stream.getAudioTracks()[0]; }
  get hasInput() { return Object.keys(this.parts).length > 0; }
}

function mixer() {
  st.mixer ??= new Mixer();
  if (st.mixer.ctx.state === 'suspended') st.mixer.ctx.resume().catch(() => {});
  return st.mixer;
}

function levels() {
  const bar = (id, v) => { $(id).style.transform = `scaleX(${v.toFixed(3)})`; };
  bar('rec-lvl-game', st.mixer?.level('game') ?? 0);
  bar('rec-lvl-mic', st.mixer?.level('mic') ?? 0);
  requestAnimationFrame(levels);
}

// ---------- Quellen ----------
async function pickGame() {
  msg('');
  const s = settings();
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: s.fps, max: s.fps }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
    });
    setGame(stream);
  } catch (err) {
    if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') msg(`Freigabe hat nicht geklappt: ${err.message ?? err}`);
  }
}

function setGame(stream) {
  stopStream(st.game);
  st.game = stream;
  gameVideo.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  track.contentHint = 'motion';
  track.addEventListener('ended', () => {
    if (st.game !== stream) return;
    if (st.rec) stopRecording('Die Bildschirm-Freigabe wurde beendet – die Aufnahme ist gespeichert.');
    st.game = null;
    gameVideo.srcObject = null;
    describeGame();
    renderStage();
    updateButtons();
  });
  mixer().set('game', stream, form.elements.gamevol.value / 100);
  describeGame();
  renderStage();
  updateButtons();
}

function describeGame() {
  const el = $('rec-picked');
  const track = st.game?.getVideoTracks()[0];
  el.hidden = !track;
  if (!track) { $('rec-pick').textContent = 'Spiel oder Bildschirm wählen'; return; }
  const surface = { monitor: 'Bildschirm', window: 'Fenster', browser: 'Browser-Tab' }[track.getSettings().displaySurface] ?? 'Freigabe';
  const audio = st.game.getAudioTracks().length > 0;
  el.textContent = `✓ ${surface}: ${track.label || 'ausgewählt'}${audio ? ' · mit Ton' : ' · ohne Ton'}`;
  $('rec-pick').textContent = 'Andere Quelle wählen';
  $('rec-game-audio-hint').textContent = audio
    ? 'Kommt aus der Bildschirm-Freigabe.'
    : 'Die Freigabe hat keinen Ton. Neu wählen und „Systemaudio teilen“ (Bildschirm) bzw. „Tab-Audio teilen“ anhaken.';
}

async function listDevices(kind, select, active) {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const list = all.filter((d) => d.kind === kind && d.deviceId);
  const labelled = list.some((d) => d.label);
  const word = kind === 'videoinput' ? 'Kamera' : 'Mikrofon';
  const opts = [new Option('Aus', '')];
  list.forEach((d, i) => opts.push(new Option(d.label || `${word} ${i + 1}`, d.deviceId)));
  if (!labelled) opts.push(new Option(`${word} wählen …`, 'ask'));
  select.replaceChildren(...opts);
  select.value = list.some((d) => d.deviceId === active) ? active : '';
}

async function pickDevice(kind, value) {
  const video = kind === 'cam';
  const select = video ? $('rec-cam-select') : $('rec-mic-select');
  stopStream(st[kind]);
  st[kind] = null;
  if (video) camVideo.srcObject = null;
  else mixer().set('mic', null);
  if (value) {
    const id = value === 'ask' ? undefined : { exact: value };
    try {
      const stream = video
        ? await navigator.mediaDevices.getUserMedia({ video: { deviceId: id, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } })
        : await navigator.mediaDevices.getUserMedia({ audio: { deviceId: id, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      st[kind] = stream;
      if (video) camVideo.srcObject = stream;
      else mixer().set('mic', stream, form.elements.micvol.value / 100);
      stream.getTracks()[0].addEventListener('ended', () => { if (st[kind] === stream) pickDevice(kind, ''); });
    } catch (err) {
      msg(err?.name === 'NotAllowedError'
        ? `Der Browser darf ${video ? 'die Kamera' : 'das Mikrofon'} nicht nutzen – oben links in der Adressleiste erlauben.`
        : `${video ? 'Kamera' : 'Mikrofon'} geht gerade nicht: ${err?.message ?? err}`);
    }
  }
  if (video) st.rec?.compositor?.follow('cam', st.cam?.getVideoTracks()[0]);
  const active = (video ? st.cam?.getVideoTracks() : st.mic?.getAudioTracks())?.[0]?.getSettings().deviceId ?? '';
  await listDevices(video ? 'videoinput' : 'audioinput', select, active);
  renderStage();
  saveSettings();
}

// Gemerkte Kamera/Mikrofon gleich wieder an – nur wenn der Browser es schon erlaubt hat (keine Abfrage)
async function restoreDevices(saved) {
  const granted = async (name) => {
    try { return (await navigator.permissions.query({ name })).state === 'granted'; } catch { return false; }
  };
  await Promise.all([
    listDevices('videoinput', $('rec-cam-select'), ''),
    listDevices('audioinput', $('rec-mic-select'), ''),
  ]);
  if (saved.camDevice && await granted('camera')) await pickDevice('cam', saved.camDevice);
  if (saved.micDevice && await granted('microphone')) await pickDevice('mic', saved.micDevice);
}

function stopStream(stream) { stream?.getTracks().forEach((t) => t.stop()); }

// ---------- Overlay ----------
async function readOverlay() {
  let raw = '';
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    try { raw = JSON.parse(localStorage.getItem('zd_overlay_config'))?.params ?? ''; } catch { raw = ''; }
  } else {
    try {
      const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/overlay_config?id=eq.1&select=params`, {
        headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`, ...channelHeaders() },
        cache: 'no-store',
      });
      if (res.ok) raw = (await res.json())?.[0]?.params ?? '';
    } catch { /* ohne Einstellungen: alle Ebenen zur Auswahl */ }
  }
  const p = new URLSearchParams(raw);
  const off = (v) => ['0', 'false', 'off'].includes(v);
  const isOn = ([key, , kind]) => {
    if (kind === 'ticker') return !off(p.get('ticker_show') ?? '1');
    if (kind === 'flag') return p.has(key) && !off(p.get(key));
    if (kind === 'scene') return !!p.get('scene');
    return !!p.get(key) && !off(p.get(key));
  };
  const on = LAYERS.filter(isOn);
  st.overlay.params = p;
  st.overlay.layers = on.length ? on : LAYERS;
  const cam = (p.get('cam') ?? '').split(',').map(Number);
  st.overlay.cam = cam.length === 4 && cam.every(Number.isFinite) && (p.get('camframe') && !off(p.get('camframe')))
    ? { x: cam[0] / 100, y: cam[1] / 100, w: cam[2] / 100, h: cam[3] / 100 }
    : null;
  $('rec-cam-stream').hidden = !st.overlay.cam;
}

function renderLayers(saved) {
  const chosen = new Set(saved ?? st.overlay.layers.map(([k]) => k));
  $('rec-layer-list').replaceChildren(...st.overlay.layers.map(([key, name]) => {
    const label = document.createElement('label');
    label.className = 'rec-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'layer';
    input.value = key;
    input.checked = chosen.has(key);
    const span = document.createElement('span');
    span.textContent = name;
    label.append(input, span);
    return label;
  }));
}

const selectedLayers = () => [...form.querySelectorAll('input[name="layer"]:checked')].map((i) => i.value);

function overlayUrl() {
  const url = withChannelParam(new URL('overlay.html', location.href));
  url.searchParams.set('live', '1');
  url.searchParams.set('rec', selectedLayers().join(',') || 'none');
  return url.href;
}

let frameUrl = '';
function updateOverlay() {
  const s = settings();
  $('rec-layers').hidden = !s.overlay;
  $('rec-overlay-hint').textContent = form.elements.format.value === '9:16'
    ? 'Im Hochformat gibt es kein Overlay – das Overlay ist für 16:9 gebaut.'
    : s.overlay
      ? 'An: Die angehakten Elemente kommen ins Video. Im Stream ändert sich nichts.'
      : 'Aus: Dein Video ist sauber – ohne Alerts, Chat, Laufband & Co. Im Stream sind sie trotzdem zu sehen.';
  form.elements.overlay.disabled = form.elements.format.value === '9:16' || !!st.rec;
  const want = s.overlay ? overlayUrl() : 'about:blank';
  if (want !== frameUrl) { frameUrl = want; frame.src = want; }
  renderStage();
}

// Mit Overlay: das Studio nimmt sich selbst auf (Tab-Freigabe), zugeschnitten auf die Vorschau
async function grabSelf() {
  if (st.self?.getVideoTracks()[0]?.readyState === 'live') return st.self;
  if (!('CropTarget' in window)) throw new Error('Overlay im Video geht nur in Chrome oder Edge.');
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: settings().fps, max: settings().fps } },
    audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude',
  });
  const track = stream.getVideoTracks()[0];
  try {
    if (track.getSettings().displaySurface !== 'browser' || !track.cropTo) throw new Error('tab');
    await track.cropTo(await CropTarget.fromElement(stage));
  } catch {
    stopStream(stream);
    throw new Error('Bitte „Diesen Tab“ (das Aufnahme-Studio) teilen – nicht den Bildschirm oder ein anderes Fenster.');
  }
  track.addEventListener('ended', () => {
    if (st.self !== stream) return;
    st.self = null;
    if (st.rec?.mode === 'overlay') stopRecording('Die Tab-Freigabe wurde beendet – die Aufnahme ist gespeichert.');
    else if (form.elements.overlay.checked) { form.elements.overlay.checked = false; updateOverlay(); }
    updateButtons();
  });
  st.self = stream;
  return stream;
}

async function toggleOverlay() {
  msg('');
  if (form.elements.overlay.checked) {
    try { await grabSelf(); } catch (err) {
      form.elements.overlay.checked = false;
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') msg(err.message ?? String(err));
    }
  } else if (st.self) {
    const s = st.self;
    st.self = null;
    stopStream(s);
  }
  updateOverlay();
  updateButtons();
  saveSettings();
}

// ---------- Bild ohne Overlay: selbst zusammensetzen ----------
// Chrome/Edge: Einzelbilder direkt aus den Spuren lesen – läuft auch im Hintergrund weiter.
class FrameCompositor {
  static get supported() { return typeof MediaStreamTrackProcessor === 'function' && typeof MediaStreamTrackGenerator === 'function' && typeof OffscreenCanvas === 'function'; }

  constructor(size, fps) {
    [this.W, this.H] = size;
    this.gap = 1000 / fps - 3;
    this.canvas = new OffscreenCanvas(this.W, this.H);
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingQuality = 'high';
    this.gen = new MediaStreamTrackGenerator({ kind: 'video' });
    this.writer = this.gen.writable.getWriter();
    this.frames = { game: null, cam: null };
    this.readers = {};
    this.clones = {};
    this.last = 0;
    this.running = true;
  }

  get track() { return this.gen; }

  follow(name, track) {
    // Alte Spur beenden statt den Leser abzubrechen: Die Schleife liest dann die restlichen Bilder und schließt sie
    this.clones[name]?.stop();
    this.frames[name]?.close();
    this.frames[name] = null;
    this.readers[name] = null;
    if (!track || track.readyState !== 'live') return;
    // Eigene Kopie der Spur: Stoppt die Aufnahme, laufen Vorschau und Freigabe weiter
    this.clones[name] = track.clone();
    const reader = new MediaStreamTrackProcessor({ track: this.clones[name] }).readable.getReader();
    this.readers[name] = reader;
    (async () => {
      while (this.running) {
        const { value, done } = await reader.read().catch(() => ({ done: true }));
        if (done) break;
        if (!this.running || this.readers[name] !== reader) { value.close(); break; }
        this.frames[name]?.close();
        this.frames[name] = value;
        this.tick();
      }
    })();
  }

  tick() {
    const now = performance.now();
    if (now - this.last < this.gap || !this.running) return;
    if (this.writer.desiredSize !== null && this.writer.desiredSize <= 0) return; // Kodierer hinterher: Bild auslassen
    this.last = now;
    const f = (vf) => (vf ? { src: vf, w: vf.displayWidth, h: vf.displayHeight } : null);
    drawScene(this.ctx, this.W, this.H, f(this.frames.game), f(this.frames.cam));
    const out = new VideoFrame(this.canvas, { timestamp: Math.round(now * 1000) });
    // Der Generator übernimmt das Bild; danach sicherheitshalber selbst schließen (doppelt schadet nicht)
    this.writer.write(out).finally(() => out.close()).catch(() => {});
  }

  stop() {
    this.running = false;
    for (const t of Object.values(this.clones)) t?.stop();
    for (const f of Object.values(this.frames)) f?.close();
    this.writer.close().catch(() => {});
    this.gen.stop();
  }
}

// Firefox & Co.: Canvas, getaktet aus einem Worker (Worker-Takte bremst der Browser im Hintergrund nicht)
class CanvasCompositor {
  constructor(size, fps) {
    [this.W, this.H] = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.stream = this.canvas.captureStream(fps);
    const code = `let t;onmessage=(e)=>{clearInterval(t);if(e.data)t=setInterval(()=>postMessage(0),e.data)}`;
    this.url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    this.worker = new Worker(this.url);
    this.worker.onmessage = () => this.draw();
    this.worker.postMessage(Math.round(1000 / fps));
  }

  get track() { return this.stream.getVideoTracks()[0]; }

  follow() { /* liest direkt aus den Vorschau-Videos */ }

  draw() {
    const v = (el) => (el.srcObject && el.videoWidth ? { src: el, w: el.videoWidth, h: el.videoHeight } : null);
    drawScene(this.ctx, this.W, this.H, v(gameVideo), st.cam ? v(camVideo) : null);
  }

  stop() {
    this.worker.postMessage(0);
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
    this.track.stop();
  }
}

// ---------- Aufnahme ----------
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIMES.find(([m]) => MediaRecorder.isTypeSupported(m)) ?? null;
}

const pad = (n) => String(n).padStart(2, '0');
function fileName(ext) {
  const d = new Date();
  return `StreamHelp-Aufnahme-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}

async function startRecording() {
  if (st.rec || !st.game) return;
  msg('');
  const s = settings();
  const mime = pickMime();
  if (!mime) { msg('Dieser Browser kann keine Videos aufnehmen.'); return; }
  const [type, ext] = mime;
  const name = fileName(ext);

  // Datei zuerst wählen (der Browser fragt nur direkt nach dem Klick)
  let writable = null;
  let handle = null;
  if (form.elements.disk.checked && 'showSaveFilePicker' in window) {
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: ext === 'mp4' ? 'MP4-Video' : 'WebM-Video', accept: { [`video/${ext}`]: [`.${ext}`] } }],
      });
      writable = await handle.createWritable();
    } catch (err) {
      if (err?.name === 'AbortError') return; // abgebrochen: nicht starten
      msg('Direkt speichern geht gerade nicht – das Video wird am Ende zum Herunterladen angeboten.');
      handle = null;
      writable = null;
    }
  }

  let video;
  let compositor = null;
  if (s.overlay) {
    try { video = (await grabSelf()).getVideoTracks()[0]; } catch (err) {
      await writable?.abort?.();
      msg(err.message ?? String(err));
      return;
    }
  } else {
    const size = SIZES[s.format][s.quality];
    compositor = FrameCompositor.supported ? new FrameCompositor(size, s.fps) : new CanvasCompositor(size, s.fps);
    compositor.follow('game', st.game.getVideoTracks()[0]);
    compositor.follow('cam', st.cam?.getVideoTracks()[0]);
    video = compositor.track;
  }
  // Tonspur immer dabei (zur Not still) – Mikrofon lässt sich so auch während der Aufnahme dazuschalten
  const stream = new MediaStream([video, mixer().track]);

  let recorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: BITRATE[s.quality][s.fps], audioBitsPerSecond: 192_000 });
  } catch (err) {
    compositor?.stop();
    await writable?.abort?.();
    msg(`Aufnahme lässt sich nicht starten: ${err.message ?? err}`);
    return;
  }

  const rec = {
    mode: s.overlay ? 'overlay' : 'clean', recorder, compositor, writable, handle, name, type, ext,
    chunks: [], bytes: 0, chain: Promise.resolve(), started: Date.now(), pausedAt: 0, pausedMs: 0, timer: 0,
  };
  rec.finished = new Promise((resolve) => { rec.resolve = resolve; });
  recorder.ondataavailable = (e) => {
    if (!e.data?.size) return;
    rec.bytes += e.data.size;
    if (rec.writable) rec.chain = rec.chain.then(() => rec.writable.write(e.data)).catch((err) => { rec.error = err; });
    else rec.chunks.push(e.data);
  };
  recorder.onstop = () => finish(rec);
  recorder.onerror = (e) => { rec.error = e.error ?? e; stopRecording(); };
  recorder.start(1000);
  st.rec = rec;
  rec.timer = setInterval(() => showTime(rec), 250);
  showTime(rec);
  setState('rec', 'Aufnahme läuft');
  updateButtons();
  updateOverlay();
  if (rec.mode === 'overlay') {
    const t = video.getSettings();
    if (t.width && t.height) msg(`Aufnahme in ${t.width} × ${t.height} – für schärfere Videos das Studio-Fenster größer ziehen.`, 'info');
  }
}

function elapsed(rec) {
  const paused = rec.pausedMs + (rec.pausedAt ? Date.now() - rec.pausedAt : 0);
  return Math.max(0, Date.now() - rec.started - paused);
}

function clock(ms) {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  return `${h ? `${h}:` : ''}${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

function mb(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2).replace('.', ',')} GB` : `${(bytes / 1e6).toFixed(1).replace('.', ',')} MB`;
}

function showTime(rec) {
  $('rec-time').textContent = clock(elapsed(rec));
  $('rec-size').textContent = rec.bytes ? mb(rec.bytes) : '';
  document.title = `${rec.pausedAt ? '❚❚' : '●'} ${clock(elapsed(rec))} · Aufnahme-Studio`;
}

function togglePause() {
  const rec = st.rec;
  if (!rec) return;
  if (rec.recorder.state === 'recording') {
    rec.recorder.pause();
    rec.pausedAt = Date.now();
    setState('paused', 'Pausiert');
    $('rec-pause').textContent = '▶ Weiter';
  } else if (rec.recorder.state === 'paused') {
    rec.recorder.resume();
    rec.pausedMs += Date.now() - rec.pausedAt;
    rec.pausedAt = 0;
    setState('rec', 'Aufnahme läuft');
    $('rec-pause').textContent = '❚❚ Pause';
  }
  showTime(rec);
}

function stopRecording(note) {
  const rec = st.rec;
  if (!rec) return;
  rec.note = note;
  if (rec.pausedAt) { rec.pausedMs += Date.now() - rec.pausedAt; rec.pausedAt = 0; }
  rec.duration = elapsed(rec);
  setState('saving', 'Wird gespeichert …');
  if (rec.recorder.state !== 'inactive') rec.recorder.stop();
  else finish(rec);
}

async function finish(rec) {
  if (rec.done) return rec.finished;
  rec.done = true;
  clearInterval(rec.timer);
  rec.duration ??= elapsed(rec);
  rec.compositor?.stop();
  let url = null;
  if (rec.writable) {
    await rec.chain;
    await rec.writable.close().catch((err) => { rec.error ??= err; });
  } else {
    url = URL.createObjectURL(new Blob(rec.chunks, { type: rec.type.split(';')[0] }));
    rec.chunks = [];
  }
  st.files.unshift({ name: rec.handle?.name ?? rec.name, url, bytes: rec.bytes, duration: rec.duration, disk: !!rec.writable, type: rec.type });
  st.rec = null;
  document.title = 'Aufnahme-Studio · StreamHelp';
  setState('idle', 'Bereit');
  $('rec-pause').textContent = '❚❚ Pause';
  if (rec.error) msg(`Beim Speichern ist etwas schiefgegangen: ${rec.error.message ?? rec.error}`);
  else msg(rec.note ?? (rec.writable ? `Gespeichert: ${rec.handle?.name ?? rec.name}` : 'Fertig – unten herunterladen.'), 'ok');
  renderFiles();
  updateButtons();
  updateOverlay();
  rec.resolve();
}

function renderFiles() {
  $('rec-files').hidden = !st.files.length;
  $('rec-file-list').replaceChildren(...st.files.map((f) => {
    const li = document.createElement('li');
    li.className = 'rec-file';
    const info = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = f.name;
    const small = document.createElement('small');
    small.textContent = `${clock(f.duration)} · ${mb(f.bytes)}${f.disk ? ' · auf dem PC gespeichert' : ''}`;
    info.append(b, small);
    li.append(info);
    if (f.url) {
      const actions = document.createElement('div');
      actions.className = 'rec-file-actions';
      const dl = document.createElement('a');
      dl.className = 'btn btn--primary btn--sm';
      dl.href = f.url;
      dl.download = f.name;
      dl.textContent = '⬇ Herunterladen';
      dl.addEventListener('click', () => { f.saved = true; });
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'btn btn--ghost btn--sm';
      view.textContent = '▶ Ansehen';
      view.addEventListener('click', () => {
        const old = li.querySelector('video');
        if (old) { old.remove(); return; }
        const v = document.createElement('video');
        v.controls = true;
        v.src = f.url;
        v.className = 'rec-file-video';
        li.append(v);
      });
      actions.append(view, dl);
      li.append(actions);
    }
    return li;
  }));
}

// ---------- Oberfläche ----------
function msg(text, kind = 'error') {
  const el = $('rec-msg');
  el.textContent = text;
  el.dataset.kind = kind;
}

function setState(state, text) {
  $('rec-state').dataset.state = state;
  $('rec-state-text').textContent = text;
  document.body.dataset.rec = state;
}

function updateButtons() {
  const rec = st.rec;
  $('rec-start').hidden = !!rec;
  $('rec-start').disabled = !st.game;
  $('rec-start').title = st.game ? '' : 'Erst Spiel oder Bildschirm wählen';
  $('rec-pause').hidden = !rec;
  $('rec-stop').hidden = !rec;
  if (!rec) { $('rec-time').textContent = '00:00'; $('rec-size').textContent = ''; }
  // Während der Aufnahme bleibt das Format fest
  for (const name of ['format', 'quality', 'fps']) {
    const el = form.elements[name];
    (el instanceof RadioNodeList ? [...el] : [el]).forEach((x) => { x.disabled = !!rec; });
  }
  $('rec-pick').disabled = !!rec;
  form.elements.disk.disabled = !!rec;
}

async function setupChannel() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return;
  const key = channelFromUrl();
  try {
    const { platform, channel } = await lookupChannel(CONFIG, key);
    if (platform) setChannel(channel ?? { id: key, login: key, is_default: false });
  } catch {
    if (key) setChannel({ id: key, login: key, is_default: false });
  }
}

async function back(e) {
  e.preventDefault();
  const rec = st.rec;
  if (rec) {
    if (!confirm('Die Aufnahme läuft noch. Beenden und speichern?')) return;
    stopRecording();
    await rec.finished;
    // Nicht auf der Festplatte: gleich herunterladen, sonst wäre das Video weg
    const f = st.files[0];
    if (f?.url && !f.saved) {
      f.saved = true;
      const a = document.createElement('a');
      a.href = f.url;
      a.download = f.name;
      a.click();
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (window.opener && !window.opener.closed) { window.close(); return; }
  const c = channelParam();
  location.href = `./${c ? `#/c/${c}` : ''}`;
}

async function start() {
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
    $('rec-unsupported').hidden = false;
    $('rec-main').hidden = true;
    return;
  }
  const saved = loadSettings();
  if (!('showSaveFilePicker' in window)) {
    $('rec-disk-wrap').hidden = true;
    form.elements.disk.checked = false;
  }
  const mime = pickMime();
  $('rec-format-hint').textContent = mime
    ? `Datei: ${mime[1].toUpperCase()} – YouTube, Shorts und TikTok nehmen das direkt an.`
    : '';
  document.querySelectorAll('[data-back]').forEach((a) => a.addEventListener('click', back));

  $('rec-pick').addEventListener('click', pickGame);
  $('rec-start').addEventListener('click', startRecording);
  $('rec-pause').addEventListener('click', togglePause);
  $('rec-stop').addEventListener('click', () => stopRecording());
  $('rec-cam-select').addEventListener('change', (e) => pickDevice('cam', e.target.value));
  $('rec-mic-select').addEventListener('change', (e) => pickDevice('mic', e.target.value));
  form.elements.overlay.addEventListener('change', toggleOverlay);
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => {
    const n = e.target.name;
    if (n === 'gamevol') st.mixer?.volume('game', e.target.value / 100);
    if (n === 'micvol') st.mixer?.volume('mic', e.target.value / 100);
    if (n === 'layer') { updateOverlay(); saveSettings(); return; }
    if (n === 'format') updateOverlay();
    renderStage();
    saveSettings();
  });
  $('rec-layers-all').addEventListener('click', () => { form.querySelectorAll('input[name="layer"]').forEach((i) => { i.checked = true; }); updateOverlay(); saveSettings(); });
  $('rec-layers-none').addEventListener('click', () => { form.querySelectorAll('input[name="layer"]').forEach((i) => { i.checked = false; }); updateOverlay(); saveSettings(); });
  addEventListener('resize', scaleOverlay);
  if ('ResizeObserver' in window) new ResizeObserver(scaleOverlay).observe(stage);
  addEventListener('beforeunload', (e) => {
    if (st.rec || st.files.some((f) => f.url && !f.saved)) { e.preventDefault(); e.returnValue = ''; }
  });
  // Ton läuft erst nach einem Klick (Browser-Regel)
  addEventListener('pointerdown', () => { if (st.mixer?.ctx.state === 'suspended') st.mixer.ctx.resume().catch(() => {}); });
  navigator.mediaDevices.addEventListener?.('devicechange', () => {
    listDevices('videoinput', $('rec-cam-select'), st.cam?.getVideoTracks()[0]?.getSettings().deviceId ?? '');
    listDevices('audioinput', $('rec-mic-select'), st.mic?.getAudioTracks()[0]?.getSettings().deviceId ?? '');
  });

  updateButtons();
  renderStage();
  requestAnimationFrame(levels);
  await setupChannel();
  await readOverlay();
  renderLayers(Array.isArray(saved.layers) ? saved.layers : null);
  updateOverlay();
  await restoreDevices(saved);
}

start();
