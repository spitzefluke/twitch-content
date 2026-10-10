// Dashboard → Bot & Chat: die neuen Bot-Bereiche (Migration …_chat_bot_plus.sql)
//   · Stream-Infos (!uptime, !followage, !game, !title, !so)
//   · Begrüßung & Danke (Follow, Abo, Bits, Raid + Auto-Shoutout)
//   · Auto-Nachrichten (Timer, nur wenn im Chat etwas los ist)
//   · Moderation (Links, Großbuchstaben, Spam, gesperrte Wörter, !permit)
//   · Song-Wünsche (!sr) mit Player: Abgespielt wird in genau einem Browserfenster („Hier abspielen“),
//     OBS nimmt den Ton über das Desktop-Audio auf. Das Overlay zeigt nur an.
// Eingebunden von js/app.js (renderBotPanel). api = state.api, toast/germanError aus app.js.
import { h } from './extras-core.js';

let ctx = null;          // { api, toast, germanError }
let settings = null;     // aktueller Stand aus bot_settings_get
let missing = {};
let loaded = false;

const errText = (err) => (/bot_settings|bot_timers|bot_songs|bot_song|schema cache|does not exist/i.test(err?.message ?? '')
  ? 'Einmal nötig: supabase/migrations/20261109000000_chat_bot_plus.sql im SQL Editor ausführen.'
  : ctx.germanError(err));

// ---------- Formular-Bausteine (name = Spalte in bot_settings) ----------
const toggle = (name, label, hint) => h('label', { class: 'toggle bp-toggle' },
  h('input', { type: 'checkbox', name }), h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }), h('span', {}, label, hint ? h('small', {}, hint) : null));
const num = (name, label, min, max, unit = '') => h('label', { class: 'field bp-num' },
  h('span', {}, label), h('span', { class: 'bp-unit' }, h('input', { type: 'number', name, min, max, step: 1, inputmode: 'numeric' }), unit ? h('em', {}, unit) : null));
const text = (name, label, max = 300, placeholder = '') => h('label', { class: 'field' },
  h('span', {}, label), h('input', { name, maxlength: max, autocomplete: 'off', placeholder }));
const list = (name, label, placeholder) => h('label', { class: 'field' },
  h('span', {}, label), h('textarea', { name, rows: 3, 'data-list': '1', placeholder }));
const select = (name, label, options) => h('label', { class: 'field' },
  h('span', {}, label), h('select', { name }, ...options.map(([v, t]) => h('option', { value: v }, t))));

function fill(form) {
  for (const el of form.elements) {
    if (!el.name || !(el.name in settings)) continue;
    const v = settings[el.name];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.dataset.list) el.value = (v ?? []).join('\n');
    else el.value = v ?? '';
  }
}
function read(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || !(el.name in (settings ?? {}))) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = Math.round(Number(el.value) || 0);
    else if (el.dataset.list) out[el.name] = el.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    else out[el.name] = el.value.trim();
  }
  return out;
}

// Ein Einstellungs-Block mit eigenem Speichern-Knopf
function settingsForm(...kids) {
  const msg = h('p', { class: 'form-msg', role: 'status' });
  const btn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Speichern');
  const form = h('form', { class: 'bp-form', novalidate: true }, ...kids, h('div', { class: 'bp-save' }, btn, msg));
  form.addEventListener('input', () => { form.classList.add('is-dirty'); msg.textContent = ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    msg.classList.remove('is-ok');
    try {
      const res = await ctx.api.botPlus.save(read(form));
      settings = res.settings;
      missing = res.missing ?? {};
      fill(form);
      form.classList.remove('is-dirty');
      msg.textContent = '✓ Gespeichert';
      msg.classList.add('is-ok');
      paintWarnings();
    } catch (err) {
      msg.textContent = /check constraint|violates/i.test(err?.message ?? '') ? 'Ein Wert liegt außerhalb des Erlaubten – bitte prüfen.' : errText(err);
    } finally {
      btn.disabled = false;
    }
  });
  return form;
}

const head = (ico, title, sub) => h('header', { class: 'dash-card-head' },
  h('span', { class: 'dash-ico', 'aria-hidden': 'true' }, ico), h('div', {}, h('h2', {}, title), sub ? h('p', { class: 'dash-status' }, sub) : null));
const scopeWarn = (key, text) => h('p', { class: 'bp-warn', 'data-missing': key, hidden: true }, '⚠️ ', text);

function paintWarnings() {
  document.querySelectorAll('[data-missing]').forEach((el) => { el.hidden = !missing?.[el.dataset.missing]; });
}

// ---------- Karten ----------
function infoCard() {
  return [
    head('📺', 'Stream-Infos', 'Antworten mit echten Daten von Twitch'),
    h('ul', { class: 'cmd-list' },
      ...[['!uptime', 'Wie lange der Stream schon läuft'], ['!game', 'Was gerade gespielt wird'], ['!title', 'Der Stream-Titel'],
        ['!followage', 'Seit wann man folgt'], ['!so @name', 'Shoutout (nur Mods) – mit Link und letztem Spiel, dazu der offizielle Twitch-Shoutout']]
        .map(([c, t]) => h('li', {}, h('code', {}, c), t))),
    settingsForm(
      toggle('info_on', 'Stream-Infos an'),
      num('info_cooldown', 'Pause je Befehl', 0, 600, 's'),
      text('so_text', 'Text beim Shoutout', 300),
      h('p', { class: 'form-hint' }, 'Platzhalter: ', h('code', {}, '{target}'), ' Name, ', h('code', {}, '{login}'), ' für den Link, ', h('code', {}, '{game}'), ' letztes Spiel.'),
    ),
    scopeWarn('shoutout', 'Für den offiziellen Twitch-Shoutout fehlt ein Twitch-Recht – der Streamer muss Twitch einmal neu verbinden. Die Shoutout-Nachricht im Chat geht trotzdem.'),
    scopeWarn('followage', '!followage braucht das Twitch-Recht „Follower lesen“ – Twitch einmal neu verbinden.'),
  ];
}

function greetCard() {
  const bits = num('thank_bits_min', 'ab Bits', 1, 1000000);
  return [
    head('👋', 'Begrüßung & Danke', 'Der Bot begrüßt und bedankt sich – Texte aus deinen Vorlagen'),
    settingsForm(
      h('div', { class: 'bp-grid' },
        select('greet_mode', 'Begrüßung', [['off', 'Aus'], ['new', 'Nur neue Zuschauer (erste Nachricht überhaupt)'], ['stream', 'Jeden einmal pro Stream']]),
        text('greet_text', 'Text für Neue'),
        text('greet_back_text', 'Text für Wiederkommende (nur „einmal pro Stream“)')),
      h('h3', { class: 'bp-sub' }, 'Danke sagen'),
      h('div', { class: 'bp-grid' },
        h('div', { class: 'bp-box' }, toggle('thank_follow', '💜 Follow', 'höchstens alle 5 s – gegen Follow-Bots'), text('thank_follow_text', 'Text')),
        h('div', { class: 'bp-box' }, toggle('thank_sub', '⭐ Abos'), text('thank_sub_text', 'Neues Abo'),
          text('thank_resub_text', 'Resub ({months} = Monate)'), text('thank_gift_text', 'Verschenkt ({amount} = Anzahl)')),
        h('div', { class: 'bp-box' }, toggle('thank_bits', '💎 Bits'), bits, text('thank_bits_text', 'Text ({amount} = Bits)')),
        h('div', { class: 'bp-box' }, toggle('thank_raid', '🚀 Raid'), text('thank_raid_text', 'Text ({amount} = Zuschauer)'),
          toggle('raid_shoutout', 'Automatisch Shoutout für den Raider', 'mit dem Text vom Shoutout (Stream-Infos)'))),
      h('p', { class: 'form-hint' }, h('code', {}, '{user}'), ' wird zum Namen (mit @). Im Raid-Schutz begrüßt und bedankt sich der Bot bei Follows und Raids nicht.'),
    ),
  ];
}

function modCard() {
  return [
    head('🛡️', 'Moderation', 'Der Bot löscht Nachrichten oder gibt einen Timeout – Mods und der Streamer sind immer ausgenommen'),
    scopeWarn('moderation', 'Zum Löschen und für Timeouts fehlen Twitch-Rechte – der Streamer muss Twitch einmal neu verbinden.'),
    settingsForm(
      toggle('mod_on', 'Moderation an'),
      h('div', { class: 'bp-grid' },
        h('div', { class: 'bp-box' }, toggle('mod_links', 'Links verbieten'), list('mod_link_allow', 'Erlaubte Seiten (eine pro Zeile)', 'twitch.tv\nyoutube.com'),
          num('mod_permit_seconds', '!permit @name gilt', 10, 600, 's'),
          h('p', { class: 'form-hint' }, 'Mods geben mit ', h('code', {}, '!permit @name'), ' einen Link frei.')),
        h('div', { class: 'bp-box' }, toggle('mod_caps', 'Zu viele GROSSBUCHSTABEN'), num('mod_caps_pct', 'ab Anteil', 30, 100, '%'), num('mod_caps_min', 'erst ab Buchstaben', 5, 200)),
        h('div', { class: 'bp-box' }, toggle('mod_spam', 'Spam'), num('mod_repeat', 'gleiches Zeichen hintereinander', 4, 100, '×'), num('mod_emotes', 'mehr Emotes als', 3, 100)),
        h('div', { class: 'bp-box' }, list('mod_words', 'Gesperrte Wörter (eins pro Zeile)', 'wort1\nwort2'),
          h('p', { class: 'form-hint' }, 'Zählt nur als ganzes Wort, Groß/klein egal.'))),
      h('div', { class: 'bp-grid bp-grid--row' },
        select('mod_action', 'Was passiert', [['delete', 'Nachricht löschen'], ['timeout', 'Timeout']]),
        num('mod_timeout', 'Timeout-Dauer', 1, 1209600, 's'),
        toggle('mod_warn', 'Ermahnung vom Bot', 'höchstens alle 30 s je Person'),
        toggle('mod_exempt_vip', 'VIPs ausnehmen'),
        toggle('mod_exempt_sub', 'Abonnenten ausnehmen')),
    ),
  ];
}

// ---------- Auto-Nachrichten ----------
async function timersCard(card) {
  const listEl = h('ul', { class: 'bp-timers' });
  const add = h('form', { class: 'bp-timer-add', novalidate: true },
    h('label', { class: 'field bp-timer-text' }, h('span', {}, 'Neue Auto-Nachricht'), h('input', { name: 'text', maxlength: 400, placeholder: 'Gefällt dir der Stream? Ein Follow hilft enorm 💜', autocomplete: 'off' })),
    h('label', { class: 'field bp-num' }, h('span', {}, 'alle'), h('span', { class: 'bp-unit' }, h('input', { type: 'number', name: 'interval_min', min: 5, max: 240, value: 15 }), h('em', {}, 'Min'))),
    h('label', { class: 'field bp-num' }, h('span', {}, 'ab Nachrichten'), h('input', { type: 'number', name: 'min_lines', min: 0, max: 200, value: 5 })),
    h('button', { class: 'btn btn--primary', type: 'submit' }, '＋ Anlegen'),
    h('p', { class: 'form-msg', role: 'alert' }));
  const gap = settingsForm(num('timer_gap', 'Mindestens Pause zwischen zwei Auto-Nachrichten', 30, 3600, 's'));
  gap.classList.add('bp-form--inline');
  card.replaceChildren(
    head('⏰', 'Auto-Nachrichten', 'Kommen nur, wenn im Chat etwas los ist: frühestens nach X Minuten und erst nach N neuen Nachrichten'),
    add, listEl, gap,
    h('p', { class: 'form-hint' }, 'Platzhalter: ', h('code', {}, '{streamer}'), '. Im Raid-Schutz pausieren die Auto-Nachrichten.'));
  fill(gap);

  let timers = [];
  const row = (t) => {
    const li = h('li', { class: `bp-timer${t.enabled ? '' : ' is-off'}` },
      h('label', { class: 'toggle', title: 'An/aus' }, h('input', { type: 'checkbox', name: 'enabled' }), h('span', { class: 'toggle-ui', 'aria-hidden': 'true' })),
      h('input', { class: 'bp-timer-input', name: 'text', maxlength: 400, 'aria-label': 'Text' }),
      h('label', { class: 'bp-unit', title: 'Frühestens alle … Minuten' }, h('input', { type: 'number', name: 'interval_min', min: 5, max: 240, 'aria-label': 'Minuten' }), h('em', {}, 'Min')),
      h('label', { class: 'bp-unit', title: 'Erst nach so vielen Chat-Nachrichten' }, h('input', { type: 'number', name: 'min_lines', min: 0, max: 200, 'aria-label': 'Nachrichten' }), h('em', {}, '💬')),
      h('span', { class: 'bp-timer-sent', title: 'So oft geschickt' }, `${t.sent ?? 0}×`),
      h('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-save': '1' }, 'Speichern'),
      h('button', { class: 'icon-btn', type: 'button', 'data-del': '1', 'aria-label': 'Auto-Nachricht löschen' }, '🗑'));
    li.querySelector('[name=enabled]').checked = !!t.enabled;
    li.querySelector('[name=text]').value = t.text;
    li.querySelector('[name=interval_min]').value = t.interval_min;
    li.querySelector('[name=min_lines]').value = t.min_lines;
    li.addEventListener('input', () => li.classList.add('is-dirty'));
    li.addEventListener('click', async (e) => {
      const val = (n) => li.querySelector(`[name=${n}]`);
      if (e.target.closest('[data-save]')) {
        try {
          await ctx.api.botPlus.timers.save({ id: t.id, text: val('text').value.trim(), enabled: val('enabled').checked,
            interval_min: Math.round(Number(val('interval_min').value) || 15), min_lines: Math.round(Number(val('min_lines').value) || 0) });
          ctx.toast('✓ Auto-Nachricht gespeichert.', 'ok', 2500);
          await load();
        } catch (err) { ctx.toast(/check constraint|violates/i.test(err?.message ?? '') ? 'Text 1–400 Zeichen, alle 5–240 Min, 0–200 Nachrichten.' : errText(err), 'error', 6000); }
      }
      if (e.target.closest('[data-del]')) {
        if (!confirm('Auto-Nachricht wirklich löschen?')) return;
        try { await ctx.api.botPlus.timers.remove(t.id); await load(); } catch (err) { ctx.toast(errText(err), 'error'); }
      }
    });
    return li;
  };
  const load = async () => {
    try {
      timers = await ctx.api.botPlus.timers.list();
    } catch (err) {
      listEl.replaceChildren(h('li', { class: 'cmd-empty' }, errText(err)));
      return;
    }
    listEl.replaceChildren(...(timers.length ? timers.map(row) : [h('li', { class: 'cmd-empty' }, 'Noch keine Auto-Nachrichten – oben die erste anlegen.')]));
  };
  add.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = add.querySelector('.form-msg');
    const t = { text: add.text.value.trim(), enabled: true, interval_min: Math.round(Number(add.interval_min.value) || 15), min_lines: Math.round(Number(add.min_lines.value) || 0) };
    if (!t.text) { msg.textContent = 'Bitte einen Text eintragen.'; return; }
    msg.textContent = '';
    try {
      await ctx.api.botPlus.timers.save(t);
      add.text.value = '';
      await load();
    } catch (err) {
      msg.textContent = /check constraint|violates/i.test(err?.message ?? '') ? 'Alle 5–240 Minuten, 0–200 Nachrichten.' : errText(err);
    }
  });
  await load();
}

// ---------- Song-Wünsche ----------
const PLAY_KEY = 'zd_song_player';
const songPlayer = { on: false, frame: null, current: null, volume: 60, paused: false, ending: false };
const fmtLen = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');

function songCard(card) {
  let on = false;
  try { on = localStorage.getItem(PLAY_KEY) === '1'; } catch { /* egal */ }
  try { songPlayer.volume = Math.max(0, Math.min(100, Number(localStorage.getItem(`${PLAY_KEY}_vol`) ?? 60))); } catch { /* egal */ }
  songPlayer.on = on;

  const nowTitle = h('b', { class: 'bp-now-title' }, '–');
  const nowWho = h('small', {});
  const frameBox = h('div', { class: 'bp-player', hidden: true });
  const playBtn = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Pause / weiter' }, '⏸');
  const skipBtn = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Nächster Song' }, '⏭ Überspringen');
  const vol = h('input', { type: 'range', min: 0, max: 100, value: songPlayer.volume, 'aria-label': 'Lautstärke', class: 'bp-vol' });
  const here = h('label', { class: 'toggle bp-toggle' }, h('input', { type: 'checkbox' }), h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }),
    h('span', {}, '🔊 Hier abspielen', h('small', {}, 'Nur in einem Fenster an – OBS nimmt den Ton über das Desktop-Audio auf')));
  here.querySelector('input').checked = on;
  const queueEl = h('ol', { class: 'bp-queue' });
  const histEl = h('ol', { class: 'bp-queue bp-queue--done' });
  const addForm = h('form', { class: 'bp-song-add', novalidate: true },
    h('input', { name: 'url', placeholder: 'YouTube-Link einfügen …', autocomplete: 'off', 'aria-label': 'YouTube-Link' }),
    h('button', { class: 'btn btn--primary', type: 'submit' }, '＋ Eintragen'));
  const clearBtn = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Warteschlange leeren');

  const cfgForm = settingsForm(
    toggle('song_on', 'Song-Wünsche im Chat an (!sr)'),
    h('div', { class: 'bp-grid bp-grid--row' },
      select('song_who', 'Wer darf wünschen', [['everyone', 'Alle'], ['sub', 'Abonnenten (und VIPs, Mods)'], ['vip', 'VIPs und Mods'], ['mod', 'Nur Mods']]),
      num('song_max_user', 'Wünsche je Person', 1, 20),
      num('song_max_queue', 'Warteschlange höchstens', 1, 200),
      num('song_max_minutes', 'Song höchstens', 1, 60, 'Min'),
      num('song_cooldown', 'Pause je Person', 0, 3600, 's')),
    h('p', { class: 'form-hint' }, 'Im Chat: ', h('code', {}, '!sr <YouTube-Link>'), ' wünschen, ', h('code', {}, '!song'), ' was läuft, ',
      h('code', {}, '!queue'), ' Warteschlange, ', h('code', {}, '!wrongsong'), ' eigenen Wunsch zurücknehmen, ', h('code', {}, '!skip'), ' (Mods) überspringen.'));

  card.replaceChildren(
    head('🎵', 'Song-Wünsche', 'Zuschauer wünschen per !sr – du spielst sie hier ab, das Overlay zeigt sie (Ebene „Song-Wünsche“)'),
    h('div', { class: 'bp-songs' },
      h('div', { class: 'bp-songs-main' },
        h('div', { class: 'bp-now' }, h('span', { class: 'bp-now-ico', 'aria-hidden': 'true' }, '🎶'), h('div', {}, nowTitle, nowWho)),
        frameBox,
        h('div', { class: 'dash-actions bp-controls' }, playBtn, skipBtn, h('label', { class: 'bp-vol-wrap' }, '🔈', vol), here),
        addForm),
      h('div', { class: 'bp-songs-side' },
        h('div', { class: 'bp-side-head' }, h('h3', { class: 'bp-sub' }, 'Warteschlange'), clearBtn), queueEl,
        h('h3', { class: 'bp-sub' }, 'Zuletzt'), histEl)),
    cfgForm);
  fill(cfgForm);

  // YouTube-Player ohne Zusatz-Skript: eingebettetes Video, gesteuert per postMessage (enablejsapi=1)
  const post = (func, args = []) => songPlayer.frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  const loadVideo = (song) => {
    songPlayer.current = song;
    songPlayer.paused = false;
    playBtn.textContent = '⏸';
    if (!songPlayer.on || !song) { frameBox.hidden = true; frameBox.replaceChildren(); songPlayer.frame = null; return; }
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(song.video_id)}?enablejsapi=1&autoplay=1&playsinline=1&rel=0&origin=${encodeURIComponent(location.origin)}`;
    const frame = h('iframe', { src, title: `YouTube: ${song.title}`, allow: 'autoplay; encrypted-media', referrerpolicy: 'strict-origin-when-cross-origin' });
    frame.addEventListener('load', () => {
      frame.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
      setTimeout(() => post('setVolume', [songPlayer.volume]), 400);
    });
    songPlayer.frame = frame;
    frameBox.replaceChildren(frame);
    frameBox.hidden = false;
  };
  const step = async (action) => {
    if (songPlayer.ending) return;
    songPlayer.ending = true;
    try { await ctx.api.botPlus.songs.control(action); } catch (err) { ctx.toast(errText(err), 'error'); }
    songPlayer.ending = false;
    await load();
  };

  let lastList = [];
  const songRow = (s, i, queued) => {
    const li = h('li', { class: `bp-song${s.status === 'playing' ? ' is-playing' : ''}` },
      h('span', { class: 'bp-song-n' }, queued ? String(i + 1) : s.status === 'skipped' ? '⏭' : '✓'),
      h('span', { class: 'bp-song-t' }, h('a', { href: `https://youtu.be/${s.video_id}`, target: '_blank', rel: 'noopener noreferrer' }, s.title),
        h('small', {}, [s.who, fmtLen(s.seconds)].filter(Boolean).join(' · '))),
      queued ? h('span', { class: 'bp-song-btns' },
        h('button', { class: 'icon-btn', type: 'button', 'data-a': 'play', title: 'Jetzt spielen', 'aria-label': 'Jetzt spielen' }, '▶'),
        h('button', { class: 'icon-btn', type: 'button', 'data-a': 'up', title: 'Nach oben', 'aria-label': 'Nach oben', disabled: i === 0 }, '↑'),
        h('button', { class: 'icon-btn', type: 'button', 'data-a': 'down', title: 'Nach unten', 'aria-label': 'Nach unten' }, '↓'),
        h('button', { class: 'icon-btn', type: 'button', 'data-a': 'remove', title: 'Entfernen', 'aria-label': 'Entfernen' }, '✕'))
        : h('span', { class: 'bp-song-btns' }, h('button', { class: 'icon-btn', type: 'button', 'data-a': 'play', title: 'Nochmal spielen', 'aria-label': 'Nochmal spielen' }, '↻')));
    li.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      try { await ctx.api.botPlus.songs.control(a, s.id); await load(); } catch (err) { ctx.toast(errText(err), 'error'); }
    });
    return li;
  };

  const load = async () => {
    let songs;
    let hist = [];
    try {
      [songs, hist] = await Promise.all([ctx.api.botPlus.songs.list(), ctx.api.botPlus.songs.history().catch(() => [])]);
    } catch (err) {
      queueEl.replaceChildren(h('li', { class: 'cmd-empty' }, errText(err)));
      return;
    }
    lastList = songs;
    const playing = songs.find((s) => s.status === 'playing') ?? null;
    const queued = songs.filter((s) => s.status === 'queued');
    nowTitle.textContent = playing ? playing.title : 'Gerade läuft nichts';
    nowWho.textContent = playing ? [playing.who && `gewünscht von ${playing.who}`, fmtLen(playing.seconds)].filter(Boolean).join(' · ') : queued.length ? 'Mit ⏭ startet der nächste Wunsch.' : '';
    queueEl.replaceChildren(...(queued.length ? queued.map((s, i) => songRow(s, i, true)) : [h('li', { class: 'cmd-empty' }, 'Keine Wünsche in der Warteschlange.')]));
    histEl.replaceChildren(...hist.slice(0, 8).map((s, i) => songRow(s, i, false)));
    if (songPlayer.on) {
      if (playing && playing.id !== songPlayer.current?.id) loadVideo(playing);
      else if (!playing && songPlayer.current) loadVideo(null);
      // Player an, nichts läuft, aber es warten Wünsche: den nächsten starten
      else if (!playing && queued.length && !songPlayer.ending) step('next');
    } else if (playing?.id !== songPlayer.current?.id) songPlayer.current = playing;
  };

  addEventListener('message', (e) => {
    if (!songPlayer.frame || e.source !== songPlayer.frame.contentWindow) return;
    let data;
    try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (data?.event === 'onError') step('skip');                         // nicht abspielbar: weiter
    if (data?.event === 'infoDelivery' && data.info?.playerState === 0) step('next'); // zu Ende
  });
  playBtn.addEventListener('click', () => {
    if (!songPlayer.on) { ctx.toast('Erst „Hier abspielen“ anschalten.', 'info'); return; }
    songPlayer.paused = !songPlayer.paused;
    post(songPlayer.paused ? 'pauseVideo' : 'playVideo');
    playBtn.textContent = songPlayer.paused ? '▶' : '⏸';
  });
  skipBtn.addEventListener('click', () => step('skip'));
  vol.addEventListener('input', () => {
    songPlayer.volume = Number(vol.value);
    post('setVolume', [songPlayer.volume]);
    try { localStorage.setItem(`${PLAY_KEY}_vol`, String(songPlayer.volume)); } catch { /* egal */ }
  });
  here.querySelector('input').addEventListener('change', (e) => {
    songPlayer.on = e.target.checked;
    try { localStorage.setItem(PLAY_KEY, songPlayer.on ? '1' : '0'); } catch { /* egal */ }
    songPlayer.current = null;
    if (!songPlayer.on) loadVideo(null);
    load();
  });
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Alle wartenden Wünsche entfernen?')) return;
    try { await ctx.api.botPlus.songs.control('clear'); await load(); } catch (err) { ctx.toast(errText(err), 'error'); }
  });
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = addForm.url.value.trim();
    if (!url) return;
    const btn = addForm.querySelector('button');
    btn.disabled = true;
    try {
      const res = await ctx.api.botPlus.songs.add(url);
      if (res?.ok === false) ctx.toast(res.error ?? 'Nicht eingetragen.', 'error');
      else { ctx.toast(`✓ „${res.title}“ ist auf Platz ${res.position}.`, 'ok', 3000); addForm.url.value = ''; }
    } catch (err) {
      ctx.toast(errText(err), 'error');
    } finally {
      btn.disabled = false;
      load();
    }
  });
  let t = 0;
  ctx.api.botPlus.songs.on?.(() => { clearTimeout(t); t = setTimeout(load, 150); });
  setInterval(() => { if (!document.hidden) load(); }, 30000);
  load();
  return lastList;
}

// ---------- Einstieg ----------
// Einmal aufbauen; danach nur noch die Einstellungen neu laden (z. B. beim erneuten Öffnen der Seite).
export async function renderBotPlus(deps) {
  ctx = deps;
  const cards = Object.fromEntries([...document.querySelectorAll('[data-botplus]')].map((el) => [el.dataset.botplus, el]));
  if (!cards.info) return;
  try {
    const res = await ctx.api.botPlus.get();
    settings = res.settings;
    missing = res.missing ?? {};
  } catch (err) {
    for (const el of Object.values(cards)) el.replaceChildren(h('p', { class: 'form-msg' }, errText(err)));
    loaded = false;
    return;
  }
  if (!loaded) {
    cards.info.replaceChildren(...infoCard());
    cards.greet.replaceChildren(...greetCard());
    cards.mod.replaceChildren(...modCard());
    await timersCard(cards.timers);
    songCard(cards.songs);
    loaded = true;
  }
  for (const form of document.querySelectorAll('[data-botplus] .bp-form')) if (!form.classList.contains('is-dirty')) fill(form);
  paintWarnings();
}
