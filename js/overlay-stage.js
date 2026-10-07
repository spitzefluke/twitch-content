// OBS-Overlay: Design fürs ganze Overlay und Stream-Grafiken rundherum.
//   otheme=standard|neon|glass|gamer|retro|gold|candy|minimal|space|hud|kawaii|horror|forest|fantasy|ocean|spooky|xmas
//                              Design aller Karten (OVERLAY_THEMES); eigene Szenen-Hintergründe in assets/bg-<design>.svg
//   scene=start|brb|end|chat   Szenen-Bildschirm über das ganze Bild (liegt hinter allen Karten):
//                              Start mit Countdown, Pause („Bin gleich zurück“), Ende mit Dank,
//                              Chatting (große Kamera mit Rahmen, Chat daneben; die Kamera bleibt frei)
//   sctitle=… / scsub=…        eigene Überschrift und Zeile darunter
//   sctime=20:15               Countdown bis zu dieser Uhrzeit (Start und Pause)
//   camframe=1                 Rahmen um die Kamera (Bereich aus cam=…)      cfstyle=glow|clean|corners|neon
//   cflabel=0                  ohne Namensschild am Kamera-Rahmen
//   labels=bl|…                Info-Leiste: letzter Follower, letztes Abo, letzte Bits, Zuschauer, Laufzeit
//   lbitems=follow,sub,viewers welche Infos in der Leiste stehen                 lbsize=100
//   goal=tc|…                  Ziel-Balken                                      gsize=100
//   gtype=follow|sub|bits      was gezählt wird       gtarget=50   gtitle=…   gsince=2026-10-01 (ab diesem Tag)
// Zuschauerzahl und Laufzeit kommen aus stream_live_info(), der Ziel-Stand aus goal_progress()
// (Migration …_overlay_designs.sql) – beides ohne Anmeldung. Im Demo-Modus aus localStorage.
import { CONFIG } from './config.js';
import { channelHeaders } from './channel.js';

export const OVERLAY_THEMES = [
  { id: 'standard', name: 'Standard', desc: 'Dunkle Karten, klar und ruhig' },
  { id: 'neon', name: 'Neon', desc: 'Schwarz mit leuchtenden Rändern' },
  { id: 'glass', name: 'Glas', desc: 'Milchglas, weich und rund' },
  { id: 'gamer', name: 'Gamer', desc: 'Kantig, schräge Ecken, Rot' },
  { id: 'retro', name: 'Arcade', desc: 'Pixel-Look mit Doppelrand' },
  { id: 'gold', name: 'Gold', desc: 'Schwarz und Gold, edel' },
  { id: 'candy', name: 'Candy', desc: 'Pastell-Verlauf, sehr rund' },
  { id: 'minimal', name: 'Minimal', desc: 'Kaum Karte, viel Schrift' },
  { id: 'space', name: 'Weltraum', desc: 'Nachtblau mit Sternen, weiche Leuchtkante' },
  { id: 'hud', name: 'Sci-Fi-HUD', desc: 'Durchsichtig, feine Linien, Eckklammern' },
  { id: 'kawaii', name: 'Kawaii', desc: 'Pastellrosa, sehr rund, gepunktet' },
  { id: 'horror', name: 'Horror', desc: 'Tiefes Rot, harte Kanten, düster' },
  { id: 'forest', name: 'Wald', desc: 'Dunkelgrün mit Holzkante' },
  { id: 'fantasy', name: 'Fantasy', desc: 'Dunkles Pergament mit Gold-Doppelrand' },
  { id: 'ocean', name: 'Ozean', desc: 'Türkis-Verlauf wie unter Wasser' },
  { id: 'spooky', name: 'Halloween', desc: 'Kürbis-Orange und Lila' },
  { id: 'xmas', name: 'Weihnachten', desc: 'Tannengrün, Rot und Schnee' },
];
export const SCENES = {
  start: { tag: '● Gleich live', title: 'Gleich geht’s los!', sub: (n) => `${n} startet in Kürze` },
  brb: { tag: '☕ Kurz weg', title: 'Bin gleich zurück', sub: () => 'Nicht weglaufen – es geht gleich weiter' },
  end: { tag: '💜 Stream vorbei', title: 'Danke fürs Zuschauen!', sub: () => 'Bis zum nächsten Stream' },
  chat: { tag: '💬 Just Chatting', title: '', sub: () => '' },
};
export const LABEL_ITEMS = {
  follow: { icon: '💜', label: 'Letzter Follower' },
  sub: { icon: '⭐', label: 'Letztes Abo' },
  bits: { icon: '💎', label: 'Letzte Bits' },
  viewers: { icon: '👀', label: 'Zuschauer' },
  uptime: { icon: '⏱️', label: 'Live seit' },
};
export const GOAL_TYPES = {
  follow: { name: 'Follower', icon: '💜', title: 'Follower-Ziel' },
  sub: { name: 'Abos', icon: '⭐', title: 'Abo-Ziel' },
  bits: { name: 'Bits', icon: '💎', title: 'Bits-Ziel' },
};
const LIVE_POLL_MS = 60_000;
const pad = (n) => String(n).padStart(2, '0');

// o: Helfer aus overlay.js – params, position(), flag(), number(), text(), place(), opt, streamer, source, onAlerts()
export function setupOverlayStage(o) {
  const { params } = o;
  const theme = OVERLAY_THEMES.some((t) => t.id === params.get('otheme')) ? params.get('otheme') : 'standard';
  document.documentElement.dataset.theme = theme;
  const root = document.documentElement.style;
  root.setProperty('--lbs', o.number('lbsize', 100, 50, 200) / 100);
  root.setProperty('--gs', o.number('gsize', 100, 50, 200) / 100);

  const data = o.source.client ? liveData() : demoData();
  const scene = SCENES[params.get('scene')] ? params.get('scene') : null;
  const labels = o.position(params.get('labels'), null);
  const goal = o.position(params.get('goal'), null);
  if (scene) setupScene(o, data, scene);
  if (o.flag('camframe', false)) setupCamFrame(o);
  if (labels) setupLabels(o, data, labels);
  if (goal) setupGoal(o, data, goal);
}

// ---------- Daten ----------
async function rpc(name, body = {}) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', ...channelHeaders() },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
}
function liveData() {
  return {
    liveInfo: () => rpc('stream_live_info'),
    goal: (kind, since) => rpc('goal_progress', { p_kind: kind, p_since: since }),
  };
}
function demoData() {
  const alerts = () => { try { return JSON.parse(localStorage.getItem('zd_stream_alerts')) ?? []; } catch { return []; } };
  const started = new Date(Date.now() - 83 * 60_000).toISOString();
  return {
    liveInfo: async () => ({ live: true, viewers: 40 + Math.floor(Math.random() * 25), started_at: started }),
    goal: async (kind, since) => alerts()
      .filter((a) => !a.test && (!since || a.created_at >= since))
      .reduce((n, a) => n + (kind === 'follow' ? +(a.kind === 'follow')
        : kind === 'sub' ? (a.kind === 'gift' ? Math.max(1, a.amount | 0) : +['sub', 'resub'].includes(a.kind))
          : a.kind === 'bits' ? a.amount | 0 : 0), 0),
  };
}

// ---------- Szenen-Bildschirm ----------
function setupScene(o, data, kind) {
  const s = SCENES[kind];
  const el = document.createElement('div');
  el.className = 'ov-scene';
  el.dataset.scene = kind;
  el.innerHTML = `
    <div class="sc-bg" aria-hidden="true"><span class="sc-grid"></span></div>
    <div class="sc-center">
      <span class="sc-tag"></span>
      <b class="sc-title"></b>
      <span class="sc-sub"></span>
      <b class="sc-clock" hidden></b>
      <div class="sc-thanks" hidden><span>Danke an</span><p></p></div>
    </div>
    <div class="sc-foot"><span class="sc-live-dot" aria-hidden="true"></span><b class="sc-name"></b><span class="sc-url"></span></div>`;
  el.querySelector('.sc-tag').textContent = s.tag;
  el.querySelector('.sc-title').textContent = o.text('sctitle', s.title, 60);
  el.querySelector('.sc-sub').textContent = o.text('scsub', s.sub(o.streamer.name), 90);
  el.querySelector('.sc-name').textContent = o.streamer.name;
  el.querySelector('.sc-url').textContent = o.streamer.login ? `twitch.tv/${o.streamer.login}` : '';
  document.body.prepend(el);

  // Chatting: dort, wo die Kamera ist, ein Loch in den Hintergrund schneiden
  if (kind === 'chat') {
    const { x, y, w, h } = o.opt.cam;
    el.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x}% ${y}%, ${x + w}% ${y}%, ${x + w}% ${y + h}%, ${x}% ${y + h}%, ${x}% ${y}%)`;
  }

  // Countdown bis zur Uhrzeit (heute; ist sie schon vorbei: „gleich“)
  const time = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(o.params.get('sctime') ?? '');
  if (time && kind !== 'end' && kind !== 'chat') {
    const clock = el.querySelector('.sc-clock');
    clock.hidden = false;
    const target = new Date();
    target.setHours(Number(time[1]), Number(time[2]), 0, 0);
    // Countdown läuft ab: „Jetzt live“ öffnet sich als Kreis. War die Zeit beim Laden schon vorbei, bleibt „gleich“ stehen.
    const late = target <= Date.now();
    const openLive = () => {
      if (late) return;
      const live = document.createElement('div');
      live.className = 'sc-live';
      const title = document.createElement('b');
      title.textContent = kind === 'start' ? 'Jetzt live' : 'Wieder da';
      const sub = document.createElement('span');
      sub.textContent = o.streamer.name;
      live.append(title, sub);
      el.append(live);
      requestAnimationFrame(() => live.classList.add('is-open'));
    };
    const tick = () => {
      const left = Math.round((target - Date.now()) / 1000);
      if (left <= 0) {
        clock.textContent = kind === 'start' ? 'gleich!' : 'gleich zurück';
        if (!clock.classList.contains('is-done')) openLive();
        clock.classList.add('is-done');
        return;
      }
      const h = Math.floor(left / 3600);
      clock.textContent = `${h ? `${h}:` : ''}${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
    };
    tick();
    setInterval(tick, 1000);
  }
  // Ende: die letzten Unterstützer
  if (kind === 'end') {
    const box = el.querySelector('.sc-thanks');
    const names = [];
    const add = (a) => {
      if (!a || a.test || !['follow', 'sub', 'resub', 'gift', 'bits'].includes(a.kind) || names.includes(a.user_name)) return;
      names.unshift(a.user_name);
      names.length = Math.min(names.length, 8);
      box.hidden = false;
      box.querySelector('p').replaceChildren(...names.map((n) => Object.assign(document.createElement('span'), { textContent: n })));
    };
    o.source.alerts?.().then((list) => [...(list ?? [])].reverse().forEach(add)).catch(() => {});
    o.onAlerts(add);
  }
}

// ---------- Kamera-Rahmen ----------
function setupCamFrame(o) {
  const style = ['clean', 'corners', 'neon'].includes(o.params.get('cfstyle')) ? o.params.get('cfstyle') : 'glow';
  const el = document.createElement('div');
  el.className = 'ov-camframe';
  el.dataset.style = style;
  el.innerHTML = '<i class="cf-c cf-tl"></i><i class="cf-c cf-tr"></i><i class="cf-c cf-bl"></i><i class="cf-c cf-br"></i>';
  if (o.flag('cflabel', true)) {
    const tag = document.createElement('span');
    tag.className = 'cf-tag';
    tag.innerHTML = '<i aria-hidden="true"></i><b></b>';
    tag.querySelector('b').textContent = o.streamer.name;
    el.append(tag);
  }
  const { x, y, w, h } = o.opt.cam;
  Object.assign(el.style, { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` });
  document.body.append(el);
  // Vorschau im OBS-Fenster: der Rahmen folgt dem roten Kamera-Rahmen
  if (o.opt.edit) {
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.data?.type !== 'stellwerk-cam') return;
      const [cx, cy, cw, ch] = String(e.data.value).split(',').map(Number);
      if ([cx, cy, cw, ch].every(Number.isFinite)) Object.assign(el.style, { left: `${cx}%`, top: `${cy}%`, width: `${cw}%`, height: `${ch}%` });
    });
  }
}

// ---------- Info-Leiste ----------
function setupLabels(o, data, pos) {
  const wanted = (o.params.get('lbitems') ?? 'follow,sub,viewers').split(',').filter((k) => LABEL_ITEMS[k]);
  const items = wanted.length ? [...new Set(wanted)] : ['follow', 'sub', 'viewers'];
  const el = document.createElement('section');
  el.className = 'ov-card ov-labels';
  el.id = 'ov-labels';
  if (o.opt.edit) el.dataset.drag = 'labels';
  const cells = {};
  for (const key of items) {
    const cell = document.createElement('div');
    cell.className = 'lb-item';
    cell.dataset.item = key;
    cell.innerHTML = '<span class="lb-ico" aria-hidden="true"></span><span class="lb-text"><small></small><b>–</b></span>';
    cell.querySelector('.lb-ico').textContent = LABEL_ITEMS[key].icon;
    cell.querySelector('small').textContent = LABEL_ITEMS[key].label;
    cells[key] = cell;
    el.append(cell);
  }
  document.body.append(el);
  o.place(el, pos);

  const set = (key, value, bump = true) => {
    const cell = cells[key];
    if (!cell) return;
    const b = cell.querySelector('b');
    if (b.textContent === value) return;
    b.textContent = value;
    if (!bump) return;
    cell.classList.remove('is-new');
    void cell.offsetWidth;
    cell.classList.add('is-new');
  };
  const onAlert = (a, bump = true) => {
    if (!a || a.test) return;
    if (a.kind === 'follow') set('follow', a.user_name, bump);
    else if (['sub', 'resub', 'gift'].includes(a.kind)) set('sub', a.kind === 'gift' && a.amount > 1 ? `${a.user_name} (${a.amount}×)` : a.user_name, bump);
    else if (a.kind === 'bits') set('bits', `${a.user_name} (${Number(a.amount).toLocaleString('de-DE')})`, bump);
  };
  o.source.alerts?.().then((list) => [...(list ?? [])].reverse().forEach((a) => onAlert(a, false))).catch(() => {});
  o.onAlerts((a) => onAlert(a));
  if (o.opt.edit || o.opt.test) {
    set('follow', 'NightOwl_Mia', false);
    set('sub', 'PixelPaul', false);
    set('bits', 'GG_Gina (500)', false);
  }

  if (!cells.viewers && !cells.uptime) return;
  let started = null;
  const uptime = () => {
    if (!cells.uptime) return;
    if (!started) { set('uptime', 'offline', false); return; }
    const m = Math.max(0, Math.floor((Date.now() - started) / 60000));
    set('uptime', `${Math.floor(m / 60)}:${pad(m % 60)} h`, false);
  };
  const poll = async () => {
    const info = await data.liveInfo().catch(() => null);
    if (info?.live) {
      set('viewers', Number(info.viewers ?? 0).toLocaleString('de-DE'), false);
      started = info.started_at ? Date.parse(info.started_at) : null;
    } else {
      set('viewers', o.opt.edit || o.opt.test ? '42' : 'offline', false);
      started = o.opt.edit || o.opt.test ? Date.now() - 83 * 60_000 : null;
    }
    uptime();
  };
  poll();
  setInterval(poll, LIVE_POLL_MS);
  setInterval(uptime, 30_000);
}

// ---------- Ziel-Balken ----------
function setupGoal(o, data, pos) {
  const kind = GOAL_TYPES[o.params.get('gtype')] ? o.params.get('gtype') : 'follow';
  const type = GOAL_TYPES[kind];
  const target = o.number('gtarget', kind === 'bits' ? 5000 : kind === 'sub' ? 10 : 50, 1, 10000000);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(o.params.get('gsince') ?? '') ? o.params.get('gsince') : null;
  const since = day ? new Date(`${day}T00:00:00`).toISOString() : null;
  const el = document.createElement('section');
  el.className = 'ov-card ov-goal';
  el.id = 'ov-goal';
  el.dataset.kind = kind;
  if (o.opt.edit) el.dataset.drag = 'goal';
  el.innerHTML = `
    <div class="gl-top"><span class="gl-ico" aria-hidden="true"></span><b class="gl-title"></b><span class="gl-count"></span></div>
    <div class="gl-bar"><div class="gl-fill"><i class="gl-shine"></i></div><span class="gl-pct"></span></div>`;
  el.querySelector('.gl-ico').textContent = type.icon;
  el.querySelector('.gl-title').textContent = o.text('gtitle', type.title, 40);
  document.body.append(el);
  o.place(el, pos);

  let current = -1;
  const paint = (n) => {
    const value = Math.max(0, Number(n) || 0);
    const pct = Math.min(100, (value / target) * 100);
    el.querySelector('.gl-fill').style.width = `${pct}%`;
    el.querySelector('.gl-pct').textContent = `${Math.floor(pct)} %`;
    el.querySelector('.gl-count').textContent = `${value.toLocaleString('de-DE')} / ${target.toLocaleString('de-DE')} ${type.name}`;
    const reached = value >= target;
    if (current >= 0 && value > current) {
      el.classList.remove('is-up');
      void el.offsetWidth;
      el.classList.add('is-up');
    }
    if (reached && !el.classList.contains('is-done') && current >= 0 && current < target) el.classList.add('is-celebrate');
    el.classList.toggle('is-done', reached);
    current = value;
  };
  const refresh = () => data.goal(kind, since).then(paint).catch((err) => { console.warn('Overlay: Ziel-Stand nicht lesbar', err); if (current < 0) paint(0); });
  if (o.opt.edit || o.opt.test) paint(Math.round(target * 0.62));
  else refresh();
  o.onAlerts((a) => { if (!a.test) setTimeout(refresh, 1500); });
  if (!o.opt.edit && !o.opt.test) setInterval(refresh, LIVE_POLL_MS);
}
