// OBS-Overlay: die neueren Content-Ideen als Ebenen.
//   forbid=tr|…      Verbotenes Wort (Karte)           fwsize=100
//   subathon=tc|…    Subathon-Timer (Karte)            sasize=100
//   pause=1          Pausen-Bildschirm (ganzes Bild, liegt hinter allen Karten)
//   quiz=bc|…        Quizfrage (Karte, nur solange eine läuft)   qzsize=100
//   queue=tl|…       Mitspielen: wer dran ist, wer wartet         qusize=100
//   tts=bl|…         Vorlesen: Sprechblase beim Vorlesen – ohne diese Ebene liest das Overlay nichts vor   ttsize=100
//   cards=br|…       Sammelkarten: seltene Ziehungen (Episch, Legendär) springen auf                        cdsize=100
//   giveaway=tc|…    Verlosung: Preis, Befehl, Zahl im Lostopf, neue Teilnehmer; beim Ziehen laufen die Namen durch  gwsize=100
// Live liest das Overlay ohne Anmeldung (freigegeben in …_stream_extras.sql), im Demo-Modus localStorage.
import { CONFIG } from './config.js';
import { speak, stopSpeaking } from './tts-voice.js';

const RARITY = { common: 'Gewöhnlich', uncommon: 'Ungewöhnlich', rare: 'Selten', epic: 'Episch', legendary: 'Legendär' };
const LETTERS = ['A', 'B', 'C', 'D'];

// o: Helfer aus overlay.js – params, position(), number(), place(), opt (edit, test, volume), client (Supabase oder null)
export function setupOverlayExtras(o) {
  const cfg = {
    forbid: o.position(o.params.get('forbid'), null),
    subathon: o.position(o.params.get('subathon'), null),
    pause: o.flag('pause', false),
    quiz: o.position(o.params.get('quiz'), null),
    queue: o.position(o.params.get('queue'), null),
    tts: o.position(o.params.get('tts'), null),
    cards: o.position(o.params.get('cards'), null),
    giveaway: o.position(o.params.get('giveaway'), null),
  };
  const sizes = { fwsize: '--fws', sasize: '--sas', qzsize: '--qzs', qusize: '--qus', ttsize: '--tts', cdsize: '--cds', gwsize: '--gws' };
  for (const [param, cssVar] of Object.entries(sizes)) document.documentElement.style.setProperty(cssVar, o.number(param, 100, 50, 200) / 100);
  const src = o.client ? liveData(o.client) : demoData();
  const ctx = { ...o, src };
  if (cfg.pause) setupPause(ctx);
  if (cfg.forbid) setupForbidden(ctx, card('ov-x-forbid', 'forbid', cfg.forbid, o));
  if (cfg.subathon) setupSubathon(ctx, card('ov-x-subathon', 'subathon', cfg.subathon, o));
  if (cfg.quiz) setupQuiz(ctx, card('ov-x-quiz', 'quiz', cfg.quiz, o));
  if (cfg.queue) setupQueue(ctx, card('ov-x-queue', 'queue', cfg.queue, o));
  if (cfg.tts) setupTts(ctx, card('ov-x-tts', 'tts', cfg.tts, o));
  if (cfg.cards) setupCards(ctx, card('ov-x-cards', 'cards', cfg.cards, o));
  if (cfg.giveaway) setupGiveaway(ctx, card('ov-x-giveaway', 'giveaway', cfg.giveaway, o));
}

function card(id, key, pos, o) {
  const el = document.createElement('section');
  el.id = id;
  el.className = `ov-card ov-x ov-x-${key}`;
  el.hidden = true;
  if (o.opt.edit) el.dataset.drag = key;
  document.body.append(el);
  o.place(el, pos);
  return el;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function span(sec) {
  const s = Math.abs(Math.round(sec));
  const m = Math.floor(s / 60);
  return m ? `${m}:${pad(s % 60)}` : `${s} s`;
}
const until = (iso) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 1000)) : 0);
function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// Kleine Töne (WebAudio), leise genug für den Stream
let audio = null;
function beep(volume, notes) {
  if (!volume) return;
  try {
    audio ??= new (window.AudioContext ?? window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    notes.forEach(([freq, at, dur = 0.18, type = 'triangle']) => {
      const t = audio.currentTime + at;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18 * volume, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });
  } catch { /* ohne Ton */ }
}

// ============================================================
// Datenquellen
// ============================================================
function liveData(sb) {
  const rows = async (q) => { const { data, error } = await q; if (error) throw error; return data; };
  return {
    one: (table) => rows(sb.from(table).select('*').eq('id', 1).maybeSingle()),
    queue: () => rows(sb.from('queue_entries').select('id, name, is_sub, status, joined_at, picked_at').order('joined_at')),
    // Verlosung: nur Namen (die Twitch-ID bleibt in der Datenbank)
    giveawayNames: (round, limit) => rows(sb.from('giveaway_entries').select('id, name').eq('round', round).order('id', { ascending: false }).limit(limit)),
    ttsRecent: () => rows(sb.from('tts_messages').select('id, who, text, voice, status, reviewed_at').eq('status', 'approved')
      .gte('reviewed_at', new Date(Date.now() - 90000).toISOString()).order('reviewed_at')),
    on(table, cb) {
      sb.channel(`ov-x-${table}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, (p) => cb(p.new, p.eventType))
        .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.error(`Overlay: Realtime für ${table} fehlgeschlagen`); });
    },
    cardUrl: (path) => (path ? `${CONFIG.SUPABASE_URL}/storage/v1/object/public/cards/${encodeURIComponent(path)}` : ''),
  };
}

function demoData() {
  const read = (key, fb) => { try { const v = localStorage.getItem(`zd_${key}`); return v ? JSON.parse(v) : fb; } catch { return fb; } };
  return {
    one: async (table) => read(table, null),
    queue: async () => read('queue_entries', []).filter((e) => ['waiting', 'picked'].includes(e.status)),
    giveawayNames: async (round, limit) => read('giveaway_entries', []).filter((e) => e.round === round).reverse().slice(0, limit).map(({ id, name }) => ({ id, name })),
    ttsRecent: async () => [],
    on(table, cb) {
      addEventListener('storage', (e) => {
        if (e.key !== `zd_${table}`) return;
        const v = read(table, null);
        if (Array.isArray(v)) v.forEach((row) => cb(row, 'UPDATE'));
        else cb(v, 'UPDATE');
      });
    },
    cardUrl: (path) => path || '',
  };
}

// ============================================================
// Verbotenes Wort
// ============================================================
async function setupForbidden({ src, opt }, el) {
  el.innerHTML = `
    <header class="ov-head"><span class="ov-dot" aria-hidden="true"></span><span>Verbotenes Wort</span><span class="ov-sep">·</span><span class="ov-who" data-cmd></span></header>
    <div class="fwo-body">
      <b class="fwo-word" data-word></b>
      <div class="fwo-row"><span class="fwo-count"><b data-count>0</b>× erwischt</span><span class="fwo-penalty" data-penalty></span></div>
      <span class="fwo-flash" data-flash hidden></span>
    </div>`;
  let data = null;
  const paint = (f, { effects = true } = {}) => {
    const before = data;
    data = f;
    el.hidden = !(f?.running || opt.edit);
    if (!f) return;
    el.querySelector('[data-word]').textContent = f.running ? f.word : 'Kein Wort';
    el.querySelector('[data-count]').textContent = f.count;
    el.querySelector('[data-cmd]').textContent = f.report_command;
    el.querySelector('[data-penalty]').textContent = f.penalty_each ? `${f.count * f.penalty_each} ${f.penalty_what}` : '';
    const ev = f.last_event;
    if (!effects || !before || !ev?.n || ev.n === before.last_event?.n || el.hidden) return;
    const flash = el.querySelector('[data-flash]');
    if (ev.type === 'hit') {
      flash.textContent = `🚨 +1 · ${f.penalty_each ? `+${f.penalty_each} ${f.penalty_what}` : 'Erwischt!'}`;
      flash.hidden = false;
      restart(el, 'is-hit');
      restart(flash, 'is-show');
      beep(opt.vols.forbid, [[880, 0, 0.12, 'square'], [660, 0.14, 0.12, 'square'], [880, 0.28, 0.25, 'square']]);
    } else if (ev.type === 'report') {
      flash.textContent = '👀 Gemeldet! Ein Mod prüft …';
      flash.hidden = false;
      restart(flash, 'is-show');
    } else if (ev.type === 'draw') {
      restart(el, 'is-new');
      beep(opt.vols.forbid, [[523, 0, 0.15], [659, 0.12, 0.15], [784, 0.24, 0.3]]);
    }
  };
  if (opt.test || opt.edit) {
    let demo = { running: true, word: 'Digga', count: 2, penalty_each: 10, penalty_what: 'Liegestütze', report_command: '!erwischt', last_event: { n: 1 } };
    paint(demo, { effects: false });
    if (opt.test && !opt.edit) setInterval(() => { demo = { ...demo, count: demo.count + 1, last_event: { n: demo.last_event.n + 1, type: 'hit' } }; paint(demo); }, 7000);
    return;
  }
  paint(await src.one('forbidden_word').catch(() => null), { effects: false });
  src.on('forbidden_word', (row) => paint(row));
}

// ============================================================
// Subathon
// ============================================================
async function setupSubathon({ src, opt }, el) {
  el.innerHTML = `
    <header class="ov-head"><span class="ov-dot" aria-hidden="true"></span><span>Subathon</span><span class="ov-sep">·</span><span class="ov-who" data-state></span></header>
    <div class="sao-body"><b class="sao-clock" data-clock>0:00:00</b><div class="sao-float" data-float></div></div>`;
  let s = null;
  const left = () => (!s ? 0 : s.status === 'running' ? until(s.ends_at) : s.status === 'ended' ? 0 : s.remaining);
  const tick = () => {
    if (!s) return;
    const l = left();
    el.querySelector('[data-clock]').textContent = clock(l);
    const over = s.status === 'ended' || (s.status === 'running' && l === 0);
    el.querySelector('[data-state]').textContent = over ? 'vorbei!' : s.status === 'paused' ? 'pausiert' : s.status === 'running' ? 'läuft' : 'bereit';
    el.classList.toggle('is-over', over);
    el.classList.toggle('is-paused', s.status === 'paused');
    el.classList.toggle('is-low', s.status === 'running' && l > 0 && l < 300);
  };
  const paint = (next, { effects = true } = {}) => {
    const before = s;
    s = next;
    el.hidden = !(s && (s.status !== 'ready' || opt.edit));
    tick();
    const ev = s?.last_event;
    if (!effects || !before || !ev?.n || ev.n === before.last_event?.n || !ev.seconds || el.hidden) return;
    const f = document.createElement('span');
    f.className = `sao-plus${ev.seconds < 0 ? ' is-minus' : ''}`;
    f.innerHTML = `${ev.seconds > 0 ? '+' : '−'}${esc(span(ev.seconds))}${ev.who && ev.kind !== 'manual' ? ` <small>${esc(ev.who)}</small>` : ''}`;
    el.querySelector('[data-float]').append(f);
    setTimeout(() => f.remove(), 3200);
    restart(el, 'is-bump');
    if (ev.seconds > 0) beep(opt.vols.subathon, [[784, 0, 0.12], [1047, 0.1, 0.25]]);
  };
  setInterval(tick, 1000);
  if (opt.test || opt.edit) {
    let demo = { status: 'running', ends_at: new Date(Date.now() + 5025000).toISOString(), last_event: { n: 1 } };
    paint(demo, { effects: false });
    if (opt.test && !opt.edit) {
      const who = ['NightOwl_Mia', 'PixelPaul', 'CrispyCarl'];
      setInterval(() => {
        const secs = [30, 300, 150][demo.last_event.n % 3];
        demo = { ...demo, ends_at: new Date(Date.parse(demo.ends_at) + secs * 1000).toISOString(), last_event: { n: demo.last_event.n + 1, seconds: secs, who: who[demo.last_event.n % 3], kind: 'sub' } };
        paint(demo);
      }, 6000);
    }
    return;
  }
  paint(await src.one('subathon').catch(() => null), { effects: false });
  src.on('subathon', (row) => paint(row));
}

// ============================================================
// Pausen-Bildschirm
// ============================================================
async function setupPause({ src, opt }) {
  const el = document.createElement('div');
  el.id = 'ov-x-pause';
  el.className = 'ov-x-pause';
  el.hidden = true;
  el.innerHTML = `
    <div class="pzo-bg" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="pzo-center">
      <span class="pzo-tag">☕ Kurze Pause</span>
      <b class="pzo-title" data-title></b>
      <span class="pzo-msg" data-msg></span>
      <b class="pzo-clock" data-clock hidden></b>
      <div class="pzo-game" data-game hidden>
        <span class="pzo-game-head">🔢 Errate die Zahl im Chat: <b data-cmd></b></span>
        <span class="pzo-range">zwischen <b data-low></b> und <b data-high></b></span>
        <span class="pzo-last" data-last></span>
        <span class="pzo-win" data-win></span>
      </div>
    </div>`;
  document.body.prepend(el);
  let p = null;
  const tick = () => {
    const c = el.querySelector('[data-clock]');
    c.hidden = !p?.ends_at;
    if (!c.hidden) c.textContent = until(p.ends_at) ? clock(until(p.ends_at)).replace(/^0:/, '') : 'gleich geht’s los!';
  };
  const paint = (next, { effects = true } = {}) => {
    const before = p;
    p = next;
    el.hidden = !(p?.active || opt.edit || opt.test);
    if (!p) return;
    el.querySelector('[data-title]').textContent = p.title;
    el.querySelector('[data-msg]').textContent = p.message;
    el.querySelector('[data-game]').hidden = !p.game_on;
    el.querySelector('[data-cmd]').textContent = `${p.guess_command} ZAHL`;
    el.querySelector('[data-low]').textContent = p.game_low;
    el.querySelector('[data-high]').textContent = p.game_high;
    const last = p.game_last;
    el.querySelector('[data-last]').textContent = last?.who && last.hint !== 'hit'
      ? `${last.who}: ${last.guess} – ${last.hint === 'higher' ? 'höher ⬆' : 'tiefer ⬇'}` : '';
    const win = p.game_winners?.[0];
    el.querySelector('[data-win]').textContent = win ? `🏆 ${win.who} hat die ${win.number} erraten!` : '';
    tick();
    if (effects && before && last?.n && last.n !== before.game_last?.n && last.hint === 'hit') {
      restart(el.querySelector('[data-win]'), 'is-show');
      beep(opt.vols.pause, [[523, 0, 0.15], [659, 0.12, 0.15], [784, 0.24, 0.15], [1047, 0.36, 0.4]]);
    }
  };
  setInterval(tick, 1000);
  if (opt.test || opt.edit) {
    paint({ active: true, title: 'Gleich geht’s weiter!', message: 'Kurz Kaffee holen', ends_at: new Date(Date.now() + 300000).toISOString(), game_on: true, guess_command: '!rate', game_low: 23, game_high: 61, game_last: { n: 1, who: 'PixelPaul', guess: 62, hint: 'lower' }, game_winners: [] }, { effects: false });
    return;
  }
  paint(await src.one('pause_screen').catch(() => null), { effects: false });
  src.on('pause_screen', (row) => paint(row));
}

// ============================================================
// Quiz
// ============================================================
async function setupQuiz({ src, opt }, el) {
  el.innerHTML = `
    <header class="ov-head"><span class="ov-dot" aria-hidden="true"></span><span>Quiz</span><span class="ov-sep">·</span><span class="ov-who" data-cat></span><span class="qzo-time" data-time></span></header>
    <div class="qzo-body">
      <b class="qzo-q" data-q></b>
      <div class="qzo-bar" aria-hidden="true"><i data-bar></i></div>
      <div class="qzo-answers" data-answers></div>
      <span class="qzo-foot" data-foot></span>
    </div>`;
  let r = null;
  let hideTimer = 0;
  const tick = () => {
    if (!r || r.status !== 'open') return;
    const l = until(r.closes_at);
    el.querySelector('[data-time]').textContent = l ? `${l} s` : 'Zeit um';
    el.querySelector('[data-bar]').style.width = `${(l / r.seconds) * 100}%`;
    el.classList.toggle('is-closed', !l);
  };
  const paint = (next, { effects = true } = {}) => {
    const before = r;
    r = next;
    clearTimeout(hideTimer);
    el.hidden = !(r && r.status !== 'idle') && !opt.edit;
    if (!r || r.status === 'idle') return;
    el.querySelector('[data-cat]').textContent = r.category;
    el.querySelector('[data-q]').textContent = r.question;
    const total = Math.max(1, r.answered);
    const revealed = r.status === 'revealed';
    el.classList.toggle('is-revealed', revealed);
    el.querySelector('[data-answers]').innerHTML = r.answers.map((a, i) => `
      <span class="qzo-a${revealed && r.correct === i ? ' is-right' : revealed ? ' is-wrong' : ''}" style="--p:${revealed ? Math.round((r.counts[i] / total) * 100) : 0}%">
        <b>${LETTERS[i]}</b><span>${esc(a)}</span>${revealed ? `<small>${Math.round((r.counts[i] / total) * 100)} %</small>` : ''}
      </span>`).join('');
    el.querySelector('[data-foot]').textContent = revealed
      ? (r.winners?.length ? `⚡ Am schnellsten: ${r.winners.slice(0, 3).map((w) => w.name).join(', ')}` : 'Niemand lag richtig!')
      : `Antworte im Chat mit ${r.answers.map((_, i) => `!${LETTERS[i].toLowerCase()}`).join(' ')} · ${r.answered} ${r.answered === 1 ? 'Antwort' : 'Antworten'}`;
    if (revealed) {
      el.querySelector('[data-time]').textContent = 'Auflösung';
      el.querySelector('[data-bar]').style.width = '0%';
      if (!opt.edit && !opt.test) hideTimer = setTimeout(() => { el.hidden = true; }, 20000);
    } else tick();
    if (!effects || !before) return;
    if (before.n !== r.n && r.status === 'open') { restart(el, 'is-new'); beep(opt.vols.quiz, [[440, 0, 0.12], [660, 0.12, 0.2]]); }
    if (before.status === 'open' && revealed) beep(opt.vols.quiz, [[523, 0, 0.12], [784, 0.12, 0.3]]);
  };
  setInterval(tick, 500);
  if (opt.test || opt.edit) {
    const q = { n: 1, status: 'open', category: 'Fortnite', question: 'Wie viele Spieler starten in einem normalen Battle-Royale-Match?', answers: ['50', '100', '150', '64'], counts: [3, 14, 2, 1], answered: 20, seconds: 30, closes_at: new Date(Date.now() + 24000).toISOString(), winners: [] };
    paint(q, { effects: false });
    if (opt.test && !opt.edit) {
      let revealed = false;
      setInterval(() => {
        revealed = !revealed;
        paint(revealed ? { ...q, status: 'revealed', correct: 1, winners: [{ name: 'CrispyCarl' }, { name: 'PixelPaul' }] } : { ...q, n: q.n + 1, closes_at: new Date(Date.now() + 30000).toISOString() });
      }, 8000);
    }
    return;
  }
  paint(await src.one('quiz_round').catch(() => null), { effects: false });
  src.on('quiz_round', (row) => paint(row));
}

// ============================================================
// Mitspielen
// ============================================================
async function setupQueue({ src, opt }, el) {
  el.innerHTML = `
    <header class="ov-head"><span class="ov-dot" aria-hidden="true"></span><span>Mitspielen</span><span class="ov-sep">·</span><span class="ov-who" data-open></span></header>
    <div class="quo-body">
      <span class="quo-join" data-join>!join DeinEpicName</span>
      <div class="quo-sec" data-picked-box><small>🎮 Dran</small><ul data-picked></ul></div>
      <div class="quo-sec" data-next-box><small>⏳ Als Nächstes <span data-count></span></small><ol data-next></ol></div>
    </div>`;
  let settings = null;
  let entries = [];
  const paint = () => {
    const picked = entries.filter((e) => e.status === 'picked');
    const waiting = entries.filter((e) => e.status === 'waiting')
      .sort((a, b) => ((settings?.sub_priority && b.is_sub) - (settings?.sub_priority && a.is_sub)) || Date.parse(a.joined_at) - Date.parse(b.joined_at));
    el.hidden = !(settings?.open || picked.length || opt.edit);
    if (!settings) return;
    el.querySelector('[data-open]').textContent = settings.open ? 'offen' : 'geschlossen';
    el.querySelector('[data-join]').hidden = !settings.open;
    el.querySelector('[data-join]').textContent = settings.note ? `!join DeinEpicName · ${settings.note}` : '!join DeinEpicName';
    const li = (e) => `<li>${esc(e.name)}${e.is_sub ? ' <span class="quo-sub">⭐</span>' : ''}</li>`;
    el.querySelector('[data-picked-box]').hidden = !picked.length;
    el.querySelector('[data-picked]').innerHTML = picked.map(li).join('');
    el.querySelector('[data-next-box]').hidden = !waiting.length;
    el.querySelector('[data-next]').innerHTML = waiting.slice(0, 5).map(li).join('');
    el.querySelector('[data-count]').textContent = waiting.length > 5 ? `(${waiting.length})` : '';
  };
  if (opt.test || opt.edit) {
    settings = { open: true, sub_priority: true, note: 'EU · Null Bauen' };
    entries = [
      { name: 'NightOwl_Mia', status: 'picked', is_sub: true }, { name: 'PixelPaul', status: 'picked' },
      { name: 'CrispyCarl', status: 'waiting', is_sub: true, joined_at: '2026-01-01T10:00:00Z' }, { name: 'LootLukas', status: 'waiting', joined_at: '2026-01-01T10:01:00Z' },
      { name: 'StreamSofia', status: 'waiting', joined_at: '2026-01-01T10:02:00Z' },
    ];
    paint();
    return;
  }
  const reload = async () => {
    [settings, entries] = await Promise.all([src.one('queue_settings').catch(() => settings), src.queue().catch(() => entries)]);
    paint();
  };
  await reload();
  let timer = 0;
  const soon = () => { clearTimeout(timer); timer = setTimeout(reload, 250); };
  src.on('queue_entries', soon);
  src.on('queue_settings', soon);
  // Wer rausfällt (fertig/entfernt), meldet Realtime ohne Anmeldung nicht – deshalb zusätzlich nachsehen
  setInterval(reload, 15000);
}

// ============================================================
// Vorlesen
// ============================================================
async function setupTts({ src, opt }, el) {
  el.innerHTML = `
    <div class="tto-body"><span class="tto-icon" aria-hidden="true">🔊</span><span class="tto-main"><b data-who></b><span data-text></span></span></div>`;
  const PLAYED_KEY = 'zd_tts_played';
  let played;
  try { played = new Set(JSON.parse(localStorage.getItem(PLAYED_KEY)) ?? []); } catch { played = new Set(); }
  const remember = (id) => {
    played.add(id);
    try { localStorage.setItem(PLAYED_KEY, JSON.stringify([...played].slice(-200))); } catch { /* egal */ }
  };
  const queue = [];
  let busy = false;
  let muted = false;
  let skipN = null;
  const show = (m) => {
    el.querySelector('[data-who]').textContent = `${m.who} sagt:`;
    el.querySelector('[data-text]').textContent = m.text;
    el.hidden = false;
    restart(el, 'is-in');
  };
  const next = async () => {
    if (busy || !queue.length) return;
    busy = true;
    const m = queue.shift();
    if (!muted) {
      show(m);
      await new Promise((r) => setTimeout(r, 500));
      await speak(m.text, m.voice, { volume: opt.vols.tts || 0 });
      await new Promise((r) => setTimeout(r, 800));
      if (!opt.edit) el.hidden = true;
    }
    busy = false;
    next();
  };
  // Jede Freigabe (und jedes „Nochmal vorlesen“) einmal
  const take = (m) => {
    if (!m || m.status !== 'approved' || !m.reviewed_at) return;
    if (Date.now() - Date.parse(m.reviewed_at) > 120000) return;
    const id = `${m.id}@${m.reviewed_at}`;
    if (played.has(id)) return;
    remember(id);
    queue.push(m);
    next();
  };
  if (opt.test || opt.edit) {
    show({ who: 'NightOwl_Mia', text: 'Hallo zusammen, das ist eine Probe fürs Vorlesen!' });
    if (opt.edit) return;
  }
  const state = await src.one('tts_state').catch(() => null);
  if (state) { muted = state.muted; skipN = state.skip_n; }
  src.on('tts_state', (s) => {
    if (!s) return;
    muted = s.muted;
    if (skipN !== null && s.skip_n !== skipN) stopSpeaking();
    if (muted) { queue.length = 0; stopSpeaking(); }
    skipN = s.skip_n;
  });
  for (const m of await src.ttsRecent().catch(() => [])) take(m);
  src.on('tts_messages', (m) => take(m));
}

// ============================================================
// Sammelkarten: seltene Ziehungen
// ============================================================
async function setupCards({ src, opt }, el) {
  el.innerHTML = `
    <div class="cdo-body">
      <span class="cdo-art" data-art></span>
      <span class="cdo-main"><small data-who></small><b data-name></b><span class="cdo-rarity" data-rarity></span></span>
    </div>`;
  const queue = [];
  let busy = false;
  const seen = new Set();
  const show = async (p) => {
    const art = el.querySelector('[data-art]');
    art.replaceChildren();
    if (p.image_path) {
      const img = new Image();
      img.src = src.cardUrl(p.image_path);
      img.alt = '';
      art.append(img);
    } else art.textContent = p.emoji || '🃏';
    el.querySelector('[data-who]').textContent = `${p.who} zieht`;
    el.querySelector('[data-name]').textContent = p.card_name;
    el.querySelector('[data-rarity]').textContent = RARITY[p.rarity] ?? '';
    el.className = el.className.replace(/\br-\w+/g, '').trim();
    el.classList.add(`r-${p.rarity}`);
    el.hidden = false;
    restart(el, 'is-in');
    beep(opt.vols.cards, p.rarity === 'legendary'
      ? [[523, 0, 0.15], [659, 0.1, 0.15], [784, 0.2, 0.15], [1047, 0.3, 0.2], [1319, 0.45, 0.5]]
      : [[659, 0, 0.15], [880, 0.12, 0.35]]);
  };
  const next = async () => {
    if (busy || !queue.length) return;
    busy = true;
    await show(queue.shift());
    await new Promise((r) => setTimeout(r, 6500));
    if (!opt.edit) el.hidden = true;
    await new Promise((r) => setTimeout(r, 600));
    busy = false;
    next();
  };
  if (opt.test || opt.edit) {
    show({ who: 'CrispyCarl', card_name: 'Goldener Pott', rarity: 'legendary', emoji: '🏆' });
    if (opt.edit) return;
  }
  src.on('card_pulls', (p, type) => {
    if (!p?.id || seen.has(p.id) || (type && type !== 'INSERT' && !(p.created_at && Date.now() - Date.parse(p.created_at) < 30000))) return;
    seen.add(p.id);
    queue.push(p);
    next();
  });
}

// ============================================================
// Verlosung
// ============================================================
// Zeigt Preis, Befehl, Zeit und wie viele im Lostopf sind; neue Teilnehmer ploppen kurz auf.
// Wird gezogen, laufen die Namen durch und bleiben beim Gewinner stehen (mit Konfetti und Fanfare).
async function setupGiveaway({ src, opt, editTests }, el) {
  el.innerHTML = `
    <header class="ov-head"><span class="ov-dot" aria-hidden="true"></span><span>Verlosung</span><span class="ov-sep">·</span><span class="ov-who" data-count></span></header>
    <div class="gwo-body">
      <span class="gwo-gift" aria-hidden="true">🎁</span>
      <b class="gwo-prize" data-prize></b>
      <span class="gwo-join" data-join></span>
      <span class="gwo-time" data-time></span>
      <span class="gwo-roll" data-roll hidden></span>
      <span class="gwo-last" data-last></span>
    </div>
    <div class="gwo-fx" data-fx aria-hidden="true"></div>`;
  const $q = (sel) => el.querySelector(sel);
  let g = null;
  let names = [];
  let rolling = false;

  const paint = () => {
    const live = g && g.round > 0 && g.status !== 'idle';
    el.hidden = !(live || opt.edit);
    if (!g) return;
    el.dataset.status = g.status;
    $q('[data-prize]').textContent = live ? g.prize : 'Verlosung';
    $q('[data-count]').textContent = `${g.entries} im Lostopf`;
    $q('[data-join]').textContent = g.status === 'open' ? `${g.command} in den Chat${g.followers_only ? ' · nur Follower' : ''}` : g.status === 'closed' ? '🔒 Gleich wird gezogen …' : '';
    $q('[data-join]').hidden = !['open', 'closed'].includes(g.status);
    if (!rolling) {
      const roll = $q('[data-roll]');
      roll.hidden = g.status !== 'drawn' || !g.winner_name;
      roll.textContent = g.winner_name ? `🏆 ${g.winner_name}` : '';
    }
    tick();
  };
  const tick = () => {
    const left = g?.status === 'open' && g.ends_at ? until(g.ends_at) : 0;
    $q('[data-time]').textContent = left ? `⏱ ${span(left)}` : '';
    $q('[data-time]').hidden = !left;
  };
  setInterval(tick, 1000);

  const popJoin = (name) => {
    const last = $q('[data-last]');
    last.textContent = `+ ${name} ist dabei`;
    restart(last, 'is-in');
  };
  const confetti = () => {
    const colors = ['#ff4fd8', '#ffd36b', '#3ddc84', '#35c7ff', '#9146ff'];
    const fx = $q('[data-fx]');
    fx.replaceChildren(...Array.from({ length: 40 }, (_, n) => {
      const i = document.createElement('i');
      const a = (n / 40) * Math.PI * 2;
      const r = 5 + Math.random() * 7;
      i.style.background = colors[n % colors.length];
      i.style.setProperty('--x', `${Math.cos(a) * r}em`);
      i.style.setProperty('--y', `${Math.sin(a) * r * 0.75}em`);
      i.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
      i.style.animationDelay = `${Math.random() * 150}ms`;
      return i;
    }));
    setTimeout(() => fx.replaceChildren(), 2000);
  };
  // Namen laufen durch (immer langsamer), dann der Gewinner
  const rollTo = async (winner, pool) => {
    if (rolling) return;
    rolling = true;
    const roll = $q('[data-roll]');
    roll.hidden = false;
    el.classList.add('is-rolling');
    roll.classList.remove('is-winner');
    const list = pool.length ? pool : [winner];
    for (let delay = 55; delay < 300; delay *= 1.1) {
      roll.textContent = list[Math.floor(Math.random() * list.length)];
      beep(opt.vols.giveaway ?? opt.volume, [[660 + Math.random() * 200, 0, 0.05, 'square']]);
      await new Promise((r) => setTimeout(r, delay));
    }
    el.classList.remove('is-rolling');
    roll.textContent = `🏆 ${winner}`;
    restart(roll, 'is-winner');
    restart(el, 'is-won');
    confetti();
    beep(opt.vols.giveaway ?? opt.volume, [[523, 0, 0.18], [659, 0.15, 0.18], [784, 0.3, 0.18], [1047, 0.45, 0.5]]);
    rolling = false;
  };

  // Probe (test=1) und OBS-Editor: Beispiel, „▶ Testen“ zieht einen Gewinner
  if (opt.test || opt.edit) {
    const SAMPLE = ['NightOwl_Mia', 'PixelPaul', 'GG_Gina', 'LootLukas', 'CrispyCarl', 'StreamSofia', 'BuildBenno', 'SnipeSina', 'LamaLeni'];
    g = { round: 1, status: 'open', prize: '1000 V-Bucks', command: '!verlosung', followers_only: true, entries: 37, ends_at: new Date(Date.now() + 299000).toISOString(), winner_name: '' };
    paint();
    if (editTests) editTests.giveaway = () => {
      const winner = SAMPLE[Math.floor(Math.random() * SAMPLE.length)];
      g = { ...g, status: 'drawn', winner_name: winner };
      paint();
      rollTo(winner, SAMPLE);
      setTimeout(() => { g = { ...g, status: 'open', winner_name: '' }; paint(); }, 9000);
    };
    if (opt.test && !opt.edit) {
      setInterval(() => {
        if (g.status !== 'open') return;
        g = { ...g, entries: g.entries + 1 };
        paint();
        popJoin(SAMPLE[Math.floor(Math.random() * SAMPLE.length)]);
      }, 3500);
    }
    return;
  }

  const reload = async (animate) => {
    const before = g;
    const fresh = await src.one('giveaway').catch(() => null);
    if (!fresh) return;
    g = fresh;
    // Neue Runde oder neue Teilnehmer: Namen nachladen (für das Durchlaufen und „+ Name ist dabei“)
    if (g.round && (g.round !== before?.round || g.entries !== before?.entries || g.draws !== before?.draws)) {
      names = (await src.giveawayNames(g.round, 60).catch(() => [])).map((e) => e.name);
    }
    paint();
    if (!animate || !before) return;
    if (g.round === before.round && g.entries > before.entries && names[0]) popJoin(names[0]);
    if (g.status === 'drawn' && g.draws > (before.draws ?? 0) && g.winner_name) rollTo(g.winner_name, names);
  };
  await reload(false);
  let timer = 0;
  src.on('giveaway', () => { clearTimeout(timer); timer = setTimeout(() => reload(true), 150); });
  setInterval(() => reload(true), 20000);
}
