// Datenzugriff für die neueren Content-Ideen (Migration …_stream_extras.sql):
// Verbotenes Wort, Subathon, Pause, Quiz, Mitspielen, Vorlesen (TTS), Sammelkarten; dazu die Verlosung (…_giveaway.sql)
// und Hot Words (…_hotwords.sql), Umfragen (…_polls.sql), Zähler, Spiel-Rad und Herzfrequenz (…_game_packs.sql).
// Live über Supabase (RPCs), im Demo-Modus mit localStorage – dieselben Regeln, vereinfacht.
import { CONFIG } from './config.js';
import { rtSpec, storageFolder } from './channel.js';
import { TTS_VOICES } from './tts-voice.js';
import { pickRandom, randomFloat, randomInt, shuffled } from './random.js';

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export { TTS_VOICES };

export function createExtrasApi(api) {
  return api.demo ? demoExtras(api.raw) : liveExtras(api.raw);
}

// ============================================================
// Supabase
// ============================================================
function liveExtras({ sb, unwrap, invoke }) {
  const one = async (table) => unwrap(await sb.from(table).select('*').eq('id', 1).maybeSingle());
  const rpc = async (name, args) => unwrap(await sb.rpc(name, args));
  // Bot-Nachrichten (Quizfrage, gezogene Mitspieler …) gleich in den Chat – ohne Bot passiert einfach nichts
  const flush = () => invoke('stream-tools', { action: 'flush' }).catch((err) => console.warn('Bot-Nachrichten:', err.message));
  const channels = new Map();

  return {
    demo: false,
    // Realtime: bei jeder Änderung an der Tabelle cb(neue Zeile)
    on(table, cb) {
      if (!channels.has(table)) {
        const list = [];
        channels.set(table, list);
        sb.channel(`extras-${table}`)
          .on('postgres_changes', rtSpec(table), (p) => list.forEach((fn) => fn(p.new, p)))
          .subscribe();
      }
      channels.get(table).push(cb);
    },
    myKey: () => rpc('my_player_key'),

    // ---------- Verbotenes Wort ----------
    forbidden: {
      get: () => one('forbidden_word'),
      reports: async () => unwrap(await sb.from('forbidden_reports').select('*').eq('status', 'pending').order('id')),
      report: () => rpc('forbidden_report_web'),
      draw: (word) => rpc('forbidden_draw', { p_word: word || null }),
      save: ({ words, each, what, command }) => rpc('forbidden_save', { p_words: words, p_each: each, p_what: what, p_command: command }),
      judge: (id, ok) => rpc('forbidden_judge', { p_report: id, p_ok: ok }),
      add: (delta) => rpc('forbidden_add', { p_delta: delta }),
      stop: () => rpc('forbidden_stop'),
    },

    // ---------- Subathon ----------
    subathon: {
      get: () => one('subathon'),
      log: async () => unwrap(await sb.from('subathon_log').select('*').order('id', { ascending: false }).limit(300)),
      control: (action, value = null) => rpc('subathon_control', { p_action: action, p_value: value }),
      save: ({ start, follow, sub, bits, cap }) => rpc('subathon_save', { p_start: start, p_follow: follow, p_sub: sub, p_bits: bits, p_cap: cap }),
    },

    // ---------- Pause ----------
    pause: {
      get: () => one('pause_screen'),
      async start({ minutes, title, message, game }) {
        const r = await rpc('pause_start', { p_minutes: minutes, p_title: title, p_message: message, p_game: game });
        flush();
        return r;
      },
      stop: () => rpc('pause_stop'),
      settings: ({ max, command }) => rpc('pause_settings', { p_max: max, p_command: command }),
      async guess(n) {
        const r = await rpc('pause_guess_web', { p_guess: n });
        if (r?.hint === 'hit') flush();
        return r;
      },
    },

    // ---------- Quiz ----------
    quiz: {
      round: () => one('quiz_round'),
      questions: async () => unwrap(await sb.from('quiz_questions').select('*').order('created_at')),
      scores: async () => unwrap(await sb.from('quiz_scores').select('name, points, correct, answered').order('points', { ascending: false }).limit(20)),
      myAnswer: () => rpc('quiz_my_answer'),
      myScore: () => rpc('quiz_my_score'),
      async start(questionId, seconds) {
        const r = await rpc('quiz_start', { p_question: questionId || null, p_seconds: seconds });
        flush();
        return r;
      },
      answer: (choice) => rpc('quiz_answer_web', { p_choice: choice }),
      async reveal() {
        const r = await rpc('quiz_reveal');
        flush();
        return r;
      },
      hide: () => rpc('quiz_hide'),
      resetScores: () => rpc('quiz_reset_scores'),
      saveQuestion: ({ id, question, answers, correct, category }) => rpc('quiz_question_save', {
        p_id: id || null, p_question: question, p_answers: answers, p_correct: correct, p_category: category,
      }),
      deleteQuestion: (id) => rpc('quiz_question_delete', { p_id: id }),
    },

    // ---------- Mitspielen ----------
    queue: {
      settings: () => one('queue_settings'),
      entries: async () => unwrap(await sb.from('queue_entries').select('id, name, is_sub, status, joined_at, picked_at').order('joined_at')),
      me: () => rpc('queue_me'),
      adminList: () => rpc('queue_admin_list'),
      join: (epic) => rpc('queue_join_web', { p_epic: epic }),
      leave: () => rpc('queue_leave_web'),
      async pick(count) {
        const r = await rpc('queue_pick', { p_count: count || null });
        flush();
        return r;
      },
      update: (action, id = null) => rpc('queue_update', { p_action: action, p_id: id }),
      async save({ open, mode, sub, max, squad, note }) {
        const r = await rpc('queue_save', { p_open: open, p_mode: mode, p_sub: sub, p_max: max, p_squad: squad, p_note: note });
        flush();
        return r;
      },
    },

    // ---------- Verlosung (…_giveaway.sql) ----------
    giveaway: {
      get: () => one('giveaway'),
      // Nur Name und Zeit – die Twitch-ID der Teilnehmer bleibt in der Datenbank
      entries: async (round) => {
        const q = (cols) => sb.from('giveaway_entries').select(cols).eq('round', round).order('id', { ascending: false }).limit(500);
        const r = await q('id, name, won, kicked, created_at');
        // Spalte kicked kommt mit …_giveaway_kick.sql – fehlt sie noch, ohne
        return r.error ? unwrap(await q('id, name, won, created_at')) : unwrap(r);
      },
      winners: async () => unwrap(await sb.from('giveaway_winners').select('*').order('id', { ascending: false }).limit(10)),
      me: () => rpc('giveaway_me'),
      async start({ prize, command, followersOnly, minutes, confirm }) {
        const r = await rpc('giveaway_start', { p_prize: prize, p_command: command, p_followers_only: followersOnly, p_minutes: minutes, p_confirm: confirm });
        flush();
        return r;
      },
      async close() { const r = await rpc('giveaway_close'); flush(); return r; },
      async draw() { const r = await rpc('giveaway_draw'); flush(); return r; },
      reset: () => rpc('giveaway_reset'),
      // Rauswerfen (kick = true) oder zurückholen (false) – Migration …_giveaway_kick.sql
      kick: (id, kick = true) => rpc('giveaway_kick', { p_entry: id, p_kick: kick }),
      addTest: null, // nur im Demo-Modus – echte Teilnehmer kommen aus dem Twitch-Chat
    },

    // ---------- Hot Words (…_hotwords.sql) ----------
    // Gezählt wird im Twitch-Chat (Edge Function twitch-eventsub → hotwords_note)
    hotwords: {
      get: () => one('hotwords'),
      counts: async (limit = 40) => unwrap(await sb.from('hotword_counts').select('word, label, n, last_at').order('n', { ascending: false }).order('last_at', { ascending: false }).limit(limit)),
      blocks: async () => unwrap(await sb.from('hotword_blocks').select('word, created_at').order('created_at', { ascending: false })),
      settings: ({ enabled = null, maxWords = null, minLength = null }) => rpc('hotwords_settings', { p_enabled: enabled, p_max_words: maxWords, p_min_length: minLength }),
      reset: () => rpc('hotwords_reset'),
      block: (word, block = true) => rpc('hotwords_block', { p_word: word, p_block: block }),
      addTest: null, // nur im Demo-Modus
    },

    // ---------- Umfrage (…_polls.sql) ----------
    // Abstimmen geht auch im Twitch-Panel (twitch-ext) und im Chat (!vote) – gezählt wird in poll_vote
    poll: {
      get: () => one('polls'),
      history: async () => unwrap(await sb.from('poll_history').select('*').order('closed_at', { ascending: false }).limit(10)),
      me: () => rpc('poll_me'),
      vote: (choice) => rpc('poll_vote_web', { p_choice: choice }),
      async start({ question, options, minutes, chat }) {
        const r = await rpc('poll_start', { p_question: question, p_options: options, p_minutes: minutes, p_chat: chat });
        flush();
        return r;
      },
      async close() { const r = await rpc('poll_close'); flush(); return r; },
      async hide() { const r = await rpc('poll_hide'); flush(); return r; },
      async tick() { await rpc('poll_tick'); flush(); },
      addTest: null, // nur im Demo-Modus
    },

    // ---------- Game-Pakete (…_game_packs.sql) ----------
    counters: {
      list: async () => unwrap(await sb.from('counters').select('*').order('position').order('id')),
      save: ({ id = null, label, emoji, command, show = true, game = '' }) => rpc('counter_save', { p_id: id, p_label: label, p_emoji: emoji, p_command: command || null, p_show: show, p_game: game }),
      add: (id, delta = 1, set = null) => rpc('counter_add', { p_id: id, p_delta: delta, p_set: set }),
      remove: (id) => rpc('counter_delete', { p_id: id }),
      order: (ids) => rpc('counter_order', { p_ids: ids }),
    },
    gamewheel: {
      get: () => one('gamewheel'),
      spin: ({ mode, options, ids = null, game = '' }) => rpc('gamewheel_spin', { p_mode: mode, p_options: options, p_ids: ids, p_game: game }),
      save: ({ game = null, challenges = null, auto = null }) => rpc('gamewheel_save', { p_game: game, p_challenges: challenges, p_auto: auto }),
      announce: flush, // Bot-Nachricht erst, wenn das Rad steht
    },
    heart: {
      get: () => one('heart_rate'),
      push: (bpm) => rpc('heart_push', { p_bpm: bpm }),
      settings: ({ alarm = null, stop = false }) => rpc('heart_settings', { p_alarm: alarm, p_stop: stop }),
    },

    // ---------- Vorlesen ----------
    tts: {
      settings: () => one('tts_settings'),
      state: () => one('tts_state'),
      messages: async () => unwrap(await sb.from('tts_messages').select('*').order('created_at', { ascending: false }).limit(40)),
      async review(id, action) {
        const r = await rpc('tts_review', { p_id: id, p_action: action });
        // Kanalpunkte bei Twitch einlösen bzw. zurückgeben
        invoke('stream-tools', { action: 'settle' }).catch((err) => console.warn('Einlösung:', err.message));
        return r;
      },
      web: (text, voice) => rpc('tts_web', { p_text: text, p_voice: voice }),
      skip: (mute = null) => rpc('tts_skip', { p_mute: mute }),
      save: ({ approval, max, blocked }) => rpc('tts_save', { p_approval: approval, p_max: max, p_blocked: blocked }),
    },

    // ---------- Sammelkarten ----------
    cards: {
      defs: async () => unwrap(await sb.from('card_defs').select('*').order('created_at')),
      settings: () => one('card_settings'),
      me: () => rpc('cards_me'),
      claimDaily: () => rpc('cards_claim_daily'),
      open: (pack) => rpc('cards_open', { p_pack: pack }),
      leaderboard: () => rpc('cards_leaderboard'),
      collection: async (key) => unwrap(await sb.from('card_owned').select('card_id, count').eq('player_key', key).gt('count', 0)),
      trades: async () => unwrap(await sb.from('card_trades').select('*').eq('status', 'open').order('created_at', { ascending: false })),
      offer: (to, give, want) => rpc('cards_offer', { p_to: to, p_give: give, p_want: want }),
      answer: (id, accept) => rpc('cards_answer', { p_trade: id, p_accept: accept }),
      save: ({ id, name, rarity, emoji, image, description, active }) => rpc('card_save', {
        p_id: id || null, p_name: name, p_rarity: rarity, p_emoji: emoji, p_image: image || null, p_description: description, p_active: active,
      }),
      async remove(card) {
        const path = await rpc('card_delete', { p_id: card.id });
        if (path) await sb.storage.from('cards').remove([path]).catch(() => {});
      },
      saveSettings: ({ size, daily, weights }) => rpc('cards_save_settings', { p_size: size, p_daily: daily, p_weights: weights }),
      async upload(blob) {
        const path = `${storageFolder()}${crypto.randomUUID()}.${blob.type === 'image/webp' ? 'webp' : 'png'}`;
        unwrap(await sb.storage.from('cards').upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false }));
        return path;
      },
      imageUrl: (path) => (path ? `${CONFIG.SUPABASE_URL}/storage/v1/object/public/cards/${path.split('/').map(encodeURIComponent).join('/')}` : ''),
    },

    // ---------- Raid-Schutz ----------
    guard: {
      get: () => one('site_guard'),
      async set(on, minutes) {
        const r = await rpc('site_guard_set', { p_on: on, p_minutes: minutes || null, p_reason: '' });
        flush();
        return r;
      },
    },

    // ---------- Kanalpunkte (Vorlesen, Karten-Pack) ----------
    rewards: {
      list: async () => unwrap(await sb.from('stream_rewards').select('*').order('key')),
      set: (key, { cost, cooldown, enabled }) => rpc('stream_reward_set', { p_key: key, p_cost: cost, p_cooldown: cooldown, p_enabled: enabled }),
      sync: (key) => invoke('stream-tools', { action: 'sync_reward', key }),
    },
  };
}

// ============================================================
// Demo (localStorage) – das Overlay im selben Browser liest mit
// ============================================================
function demoExtras({ store, me, name, isAdmin, requireAdmin }) {
  const listeners = {};
  const emit = (table, row) => setTimeout(() => (listeners[table] ?? []).forEach((cb) => cb(row)), 20);
  const now = () => new Date().toISOString();
  let nextId = Date.now();
  const key = () => (me() ? `u:${me().email}` : null);
  const needUser = () => { if (!me()) throw new Error('Bitte anmelden.'); };
  const oneRow = (table, fallback) => ({ ...fallback, ...store.get(table, {}) });
  const put = (table, fallback, patch) => {
    const next = { ...oneRow(table, fallback), ...patch, updated_at: now() };
    store.set(table, next);
    emit(table, next);
    return next;
  };
  const pick = pickRandom;
  const clampInt = (v, lo, hi, fb) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : fb);

  const F0 = { id: 1, words: ['Digga', 'Sorry', 'Eigentlich', 'Krass', 'Bruder', 'Safe', 'Alter', 'Genau', 'Ehrlich gesagt', 'Lag'], word: '', running: false, count: 0, penalty_each: 10, penalty_what: 'Liegestütze', report_command: '!erwischt', pending: 0, last_event: {} };
  const S0 = { id: 1, status: 'ready', ends_at: null, remaining: 7200, start_minutes: 120, sec_follow: 30, sec_sub: 300, sec_bits: 60, cap_hours: 0, started_at: null, added: 0, last_event: {} };
  const P0 = { id: 1, active: false, title: 'Gleich geht’s weiter!', message: '', ends_at: null, started_at: null, game_on: true, guess_command: '!rate', game_max: 100, game_round: 1, game_low: 1, game_high: 100, game_guesses: 0, game_last: {}, game_winners: [] };
  const Q0 = { id: 1, n: 0, status: 'idle', question_id: null, question: '', answers: [], category: '', correct: null, opened_at: null, closes_at: null, counts: [0, 0, 0, 0], answered: 0, winners: [], seconds: 30 };
  const QS0 = { id: 1, open: false, mode: 'order', sub_priority: true, max_size: 100, squad_size: 3, note: '' };
  const T0 = { id: 1, need_approval: true, max_chars: 200, blocked_words: [] };
  const CS0 = { id: 1, pack_size: 3, daily: true, weights: [55, 25, 12, 6, 2] };
  const HW0 = { id: 1, enabled: true, max_words: 5, min_length: 3, round: 1, top: [], started_at: now(), updated_at: now() };
  const GWH0 = { id: 1, challenges: {}, auto_switch: true, n: 0, mode: 'game', game: '', options: [], result_index: null, result: '', spun_by: '', spun_at: null };
  const HR0 = { id: 1, bpm: null, at: null, alarm: 140, session_at: null, s_min: null, s_max: null, s_sum: 0, s_n: 0 };
  const PL0 = { id: 1, status: 'idle', round: 0, question: '', options: [], counts: [], total: 0, chat_vote: true, opened_at: null, ends_at: null, closed_at: null };
  const GW0 = { id: 1, round: 0, status: 'idle', prize: '', command: '!verlosung', followers_only: true, confirm_in_chat: true, entries: 0, opened_at: null, ends_at: null, winner_name: '', drawn_at: null, draws: 0 };
  const ev = (row, type, by) => ({ n: (row.last_event?.n ?? 0) + 1, type, by, at: now() });

  const tileOpen = (kind) => {
    if (isAdmin()) return true;
    const g = store.get('site_guard', {});
    if (g.viewer_pause && (!g.until || Date.parse(g.until) > Date.now())) return false;
    const tile = (store.get('tiles', null) ?? []).find((t) => t.kind === kind);
    return !tile?.target_at || Date.parse(tile.target_at) <= Date.now();
  };

  // ---------- Quizfragen (Startfragen wie in der Migration, gekürzt) ----------
  const DEMO_QUESTIONS = [
    ['Wie viele Spieler starten in einem normalen Battle-Royale-Match?', ['50', '100', '150', '64'], 1],
    ['Wie heißt das Fahrzeug, aus dem alle zu Beginn abspringen?', ['Kampfbus', 'Sturm-Gleiter', 'Loot-Laster', 'Party-Zeppelin'], 0],
    ['Welche Farbe hat die Seltenheit „Episch“?', ['Blau', 'Lila', 'Gold', 'Grün'], 1],
    ['Wie viel Schild gibt ein kleiner Schildtrank?', ['10', '25', '50', '75'], 1],
    ['Was füllt Leben UND Schild komplett auf?', ['Medikit', 'Pott', 'Bandage', 'Kleiner Schildtrank'], 1],
    ['Welches Baumaterial hält am wenigsten aus?', ['Holz', 'Stein', 'Metall', 'Alle gleich viel'], 0],
    ['Wie heißt der Modus ganz ohne Bauen?', ['Null Bauen', 'Kreativ', 'Rette die Welt', 'Team-Rumble'], 0],
    ['Wie viele Spieler hat ein Squad höchstens?', ['2', '3', '4', '5'], 2],
  ].map(([question, answers, correct], i) => ({ id: `dq${i}`, question, answers, correct, category: 'Fortnite', used_at: null, created_at: now() }));
  const questions = () => store.get('quiz_questions', null) ?? DEMO_QUESTIONS;

  // ---------- Karten (Startkarten wie in der Migration) ----------
  const DEMO_CARDS = [
    ['Chat-Spam', 'common', '💬'], ['Lag', 'common', '🐌'], ['Aus Versehen gebaut', 'common', '🧱'], ['Vergessen zu heilen', 'common', '🩹'],
    ['Busfahrer-Gruß', 'common', '🚌'], ['Loot-Goblin', 'common', '🎒'], ['No-Scope-Versuch', 'uncommon', '🎯'], ['Tanz-Emote', 'uncommon', '💃'],
    ['Sturm-Surfer', 'uncommon', '🌪️'], ['Clutch-Moment', 'rare', '🔥'], ['Mod mit Bann-Hammer', 'rare', '🔨'], ['Stream-Dino', 'rare', '🦖'],
    ['Victory Royale', 'epic', '👑'], ['Rage-Quit', 'epic', '😡'], ['Der Streamer', 'legendary', '⭐'], ['Goldener Pott', 'legendary', '🏆'],
  ].map(([n, rarity, emoji], i) => ({ id: `dc${i}`, name: n, rarity, emoji, image_path: null, description: '', active: true, created_at: now() }));
  const defs = () => store.get('card_defs', null) ?? DEMO_CARDS;
  const owned = () => store.get('card_owned', {}); // {key: {cardId: count}}
  function drawCard() {
    const w = oneRow('card_settings', CS0).weights;
    const active = defs().filter((c) => c.active);
    const avail = RARITY_ORDER.map((r, i) => ({ r, w: active.some((c) => c.rarity === r) ? Math.max(0, w[i]) : 0 }));
    const total = avail.reduce((s, a) => s + a.w, 0);
    if (!total) return pick(active);
    let roll = randomFloat() * total;
    const r = avail.find((a) => (roll -= a.w) < 0)?.r ?? avail.find((a) => a.w)?.r;
    return pick(active.filter((c) => c.rarity === r));
  }

  return {
    demo: true,
    on(table, cb) { (listeners[table] ??= []).push(cb); },
    myKey: async () => key(),

    forbidden: {
      get: async () => oneRow('forbidden_word', F0),
      reports: async () => store.get('forbidden_reports', []).filter((r) => r.status === 'pending'),
      async report() {
        needUser();
        const f = oneRow('forbidden_word', F0);
        if (!f.running) throw new Error('Gerade läuft kein verbotenes Wort.');
        const reports = store.get('forbidden_reports', []);
        const k = key();
        if (reports.some((r) => r.reporter_keys.includes(k) && Date.now() - Date.parse(r.created_at) < 30000)) return { ok: false };
        const open = reports.find((r) => r.status === 'pending' && Date.now() - Date.parse(r.created_at) < 60000);
        if (open) { open.reporters.push(name()); open.reporter_keys.push(k); } else reports.push({ id: nextId++, reporters: [name()], reporter_keys: [k], status: 'pending', created_at: now() });
        store.set('forbidden_reports', reports);
        emit('forbidden_reports', null);
        put('forbidden_word', F0, { pending: reports.filter((r) => r.status === 'pending').length, last_event: ev(f, 'report', name()) });
        return { ok: true };
      },
      async draw(word) {
        await requireAdmin();
        const f = oneRow('forbidden_word', F0);
        const w = String(word ?? '').trim().slice(0, 40) || pick(f.words.filter((x) => x !== f.word).length ? f.words.filter((x) => x !== f.word) : f.words);
        store.set('forbidden_reports', store.get('forbidden_reports', []).map((r) => (r.status === 'pending' ? { ...r, status: 'rejected' } : r)));
        return put('forbidden_word', F0, { word: w, running: true, count: 0, pending: 0, last_event: ev(f, 'draw', name()) });
      },
      async save({ words, each, what, command }) {
        await requireAdmin();
        const list = [...new Set(words.map((w) => w.trim().slice(0, 40)).filter(Boolean))];
        if (!list.length) throw new Error('Mindestens ein Wort eintragen.');
        let cmd = String(command ?? '').trim().toLowerCase();
        if (!cmd.startsWith('!')) cmd = `!${cmd}`;
        if (!/^![a-zäöüß0-9_]{2,20}$/.test(cmd)) throw new Error('Der Befehl darf nur Buchstaben und Zahlen haben, z. B. !erwischt.');
        return put('forbidden_word', F0, { words: list, penalty_each: clampInt(each, 0, 1000, 10), penalty_what: String(what ?? '').trim().slice(0, 40), report_command: cmd });
      },
      async judge(id, ok) {
        await requireAdmin();
        const reports = store.get('forbidden_reports', []);
        const r = reports.find((x) => x.id === id && x.status === 'pending');
        if (!r) throw new Error('Diese Meldung ist schon erledigt.');
        r.status = ok ? 'confirmed' : 'rejected';
        store.set('forbidden_reports', reports);
        const f = oneRow('forbidden_word', F0);
        return put('forbidden_word', F0, {
          pending: reports.filter((x) => x.status === 'pending').length,
          ...(ok ? { count: f.count + 1, last_event: ev(f, 'hit', r.reporters.slice(0, 3).join(', ')) } : {}),
        });
      },
      async add(delta) {
        await requireAdmin();
        const f = oneRow('forbidden_word', F0);
        return put('forbidden_word', F0, { count: Math.max(0, f.count + delta), last_event: ev(f, delta > 0 ? 'hit' : 'undo', name()) });
      },
      async stop() {
        await requireAdmin();
        const f = oneRow('forbidden_word', F0);
        store.set('forbidden_reports', store.get('forbidden_reports', []).map((r) => (r.status === 'pending' ? { ...r, status: 'rejected' } : r)));
        return put('forbidden_word', F0, { running: false, pending: 0, last_event: ev(f, 'stop', name()) });
      },
    },

    subathon: {
      async get() {
        const s = oneRow('subathon', S0);
        if (s.status === 'running' && Date.parse(s.ends_at) <= Date.now()) return put('subathon', S0, { status: 'ended', remaining: 0 });
        return s;
      },
      log: async () => store.get('subathon_log', []),
      async control(action, value = null) {
        await requireAdmin();
        const s = await this.get();
        const left = s.status === 'running' ? Math.max(0, Math.ceil((Date.parse(s.ends_at) - Date.now()) / 1000)) : s.remaining;
        const logIt = (seconds) => store.set('subathon_log', [{ id: nextId++, kind: 'manual', who: name(), seconds, created_at: now() }, ...store.get('subathon_log', [])].slice(0, 300));
        const e = (seconds, kind) => ({ n: (s.last_event?.n ?? 0) + 1, seconds, who: name(), kind, at: now() });
        if (action === 'start') {
          if (['running', 'paused'].includes(s.status)) throw new Error('Der Subathon läuft schon.');
          const min = clampInt(value, 1, 10080, s.start_minutes);
          store.set('subathon_log', []);
          return put('subathon', S0, { status: 'running', start_minutes: min, ends_at: new Date(Date.now() + min * 60000).toISOString(), started_at: now(), added: 0, remaining: 0, last_event: e(0, 'start') });
        }
        if (action === 'pause') {
          if (s.status !== 'running') throw new Error('Der Subathon läuft gerade nicht.');
          return put('subathon', S0, { status: 'paused', remaining: left, ends_at: null });
        }
        if (action === 'resume') {
          if (s.status !== 'paused') throw new Error('Der Subathon ist nicht pausiert.');
          return put('subathon', S0, { status: 'running', ends_at: new Date(Date.now() + s.remaining * 1000).toISOString(), remaining: 0 });
        }
        if (action === 'add') {
          if (!['running', 'paused'].includes(s.status)) throw new Error('Erst den Subathon starten.');
          const secs = Math.max(-left, Math.round(value));
          logIt(secs);
          if (s.status === 'running') return put('subathon', S0, { ends_at: new Date(Date.parse(s.ends_at) + secs * 1000).toISOString(), added: s.added + secs, last_event: e(secs, 'manual') });
          return put('subathon', S0, { remaining: s.remaining + secs, added: s.added + secs, last_event: e(secs, 'manual') });
        }
        if (action === 'end') return put('subathon', S0, { status: 'ended', remaining: 0, ends_at: null });
        if (action === 'reset') {
          store.set('subathon_log', []);
          return put('subathon', S0, { status: 'ready', remaining: s.start_minutes * 60, ends_at: null, started_at: null, added: 0 });
        }
        throw new Error('Unbekannte Aktion.');
      },
      async save({ start, follow, sub, bits, cap }) {
        await requireAdmin();
        const s = oneRow('subathon', S0);
        const min = clampInt(start, 1, 10080, s.start_minutes);
        return put('subathon', S0, {
          start_minutes: min, remaining: s.status === 'ready' ? min * 60 : s.remaining,
          sec_follow: clampInt(follow, 0, 86400, s.sec_follow), sec_sub: clampInt(sub, 0, 86400, s.sec_sub),
          sec_bits: clampInt(bits, 0, 86400, s.sec_bits), cap_hours: clampInt(cap, 0, 720, s.cap_hours),
        });
      },
    },

    pause: {
      get: async () => oneRow('pause_screen', P0),
      async start({ minutes, title, message, game }) {
        await requireAdmin();
        const p = oneRow('pause_screen', P0);
        if (!p.active) store.set('pause_secret', 1 + randomInt(p.game_max));
        return put('pause_screen', P0, {
          active: true, started_at: p.active ? p.started_at : now(),
          ends_at: minutes > 0 ? new Date(Date.now() + Math.min(600, minutes) * 60000).toISOString() : null,
          title: String(title ?? '').trim().slice(0, 60) || p.title, message: String(message ?? '').trim().slice(0, 140),
          game_on: game ?? p.game_on, ...(p.active ? {} : { game_low: 1, game_high: p.game_max, game_guesses: 0 }),
        });
      },
      async stop() { await requireAdmin(); return put('pause_screen', P0, { active: false, ends_at: null }); },
      async settings({ max, command }) {
        await requireAdmin();
        let cmd = String(command ?? '').trim().toLowerCase();
        if (!cmd.startsWith('!')) cmd = `!${cmd}`;
        if (!/^![a-zäöüß0-9_]{2,20}$/.test(cmd)) throw new Error('Der Befehl darf nur Buchstaben und Zahlen haben, z. B. !rate.');
        const m = clampInt(max, 10, 10000, 100);
        store.set('pause_secret', 1 + randomInt(m));
        return put('pause_screen', P0, { game_max: m, guess_command: cmd, game_low: 1, game_high: m, game_guesses: 0 });
      },
      async guess(n) {
        needUser();
        const p = oneRow('pause_screen', P0);
        if (!p.active || !p.game_on) throw new Error('Gerade läuft keine Pause mit Zahlenraten.');
        const g = Math.round(Number(n));
        if (!(g >= 1 && g <= p.game_max)) throw new Error(`Eine Zahl zwischen 1 und ${p.game_max}.`);
        let secret = store.get('pause_secret', null) ?? 1 + randomInt(p.game_max);
        const hint = g === secret ? 'hit' : g < secret ? 'higher' : 'lower';
        const patch = {
          game_guesses: p.game_guesses + 1,
          game_low: hint === 'higher' ? Math.max(p.game_low, g + 1) : p.game_low,
          game_high: hint === 'lower' ? Math.min(p.game_high, g - 1) : p.game_high,
          game_last: { n: (p.game_last?.n ?? 0) + 1, who: name(), guess: g, hint, at: now() },
        };
        if (hint === 'hit') {
          Object.assign(patch, {
            game_winners: [{ who: name(), round: p.game_round, guesses: p.game_guesses + 1, number: secret, at: now() }, ...p.game_winners].slice(0, 5),
            game_round: p.game_round + 1, game_low: 1, game_high: p.game_max, game_guesses: 0,
          });
          secret = 1 + randomInt(p.game_max);
        }
        store.set('pause_secret', secret);
        put('pause_screen', P0, patch);
        return { hint, guess: g };
      },
    },

    quiz: {
      round: async () => oneRow('quiz_round', Q0),
      questions: async () => questions(),
      scores: async () => Object.values(store.get('quiz_scores', {})).sort((a, b) => b.points - a.points).slice(0, 20),
      myAnswer: async () => store.get('quiz_answers', []).find((a) => a.round_n === oneRow('quiz_round', Q0).n && a.key === key())?.choice ?? null,
      async myScore() {
        const all = Object.values(store.get('quiz_scores', {}));
        const mine = store.get('quiz_scores', {})[key()];
        return mine ? { ...mine, rank: all.filter((s) => s.points > mine.points).length + 1 } : null;
      },
      async start(questionId, seconds) {
        await requireAdmin();
        const list = questions();
        if (!list.length) throw new Error('Es gibt noch keine Quizfragen.');
        const q = questionId ? list.find((x) => x.id === questionId)
          : shuffled(list).sort((a, b) => (a.used_at ? Date.parse(a.used_at) : 0) - (b.used_at ? Date.parse(b.used_at) : 0))[0];
        store.set('quiz_questions', list.map((x) => (x.id === q.id ? { ...x, used_at: now() } : x)));
        store.set('quiz_secret', q.correct);
        const secs = clampInt(seconds, 10, 300, 30);
        const r = oneRow('quiz_round', Q0);
        return put('quiz_round', Q0, {
          n: r.n + 1, status: 'open', question_id: q.id, question: q.question, answers: q.answers, category: q.category, correct: null,
          opened_at: now(), closes_at: new Date(Date.now() + secs * 1000).toISOString(), seconds: secs,
          counts: q.answers.map(() => 0), answered: 0, winners: [],
        });
      },
      async answer(choice) {
        needUser();
        const r = oneRow('quiz_round', Q0);
        if (r.status !== 'open' || Date.parse(r.closes_at) <= Date.now()) throw new Error('Die Zeit für diese Frage ist um.');
        if (!tileOpen('quiz')) throw new Error('Das Quiz ist noch nicht freigeschaltet.');
        const answers = store.get('quiz_answers', []);
        if (answers.some((a) => a.round_n === r.n && a.key === key())) throw new Error('Du hast schon geantwortet.');
        answers.push({ round_n: r.n, key: key(), name: name(), choice, created_at: now() });
        store.set('quiz_answers', answers.filter((a) => a.round_n > r.n - 5));
        const counts = [...r.counts];
        counts[choice] += 1;
        put('quiz_round', Q0, { counts, answered: r.answered + 1 });
        return { ok: true };
      },
      async reveal() {
        await requireAdmin();
        const r = oneRow('quiz_round', Q0);
        if (r.status !== 'open') throw new Error('Gerade ist keine Frage offen.');
        const correct = store.get('quiz_secret', 0);
        const answers = store.get('quiz_answers', []).filter((a) => a.round_n === r.n);
        const scores = store.get('quiz_scores', {});
        const span = Math.max(1, Date.parse(r.closes_at) - Date.parse(r.opened_at));
        for (const a of answers) {
          const ok = a.choice === correct;
          const pts = ok ? 10 + Math.max(0, Math.min(5, Math.round(5 * (1 - (Date.parse(a.created_at) - Date.parse(r.opened_at)) / span)))) : 0;
          const s = scores[a.key] ?? { name: a.name, points: 0, correct: 0, answered: 0 };
          scores[a.key] = { name: a.name, points: s.points + pts, correct: s.correct + (ok ? 1 : 0), answered: s.answered + 1 };
        }
        store.set('quiz_scores', scores);
        emit('quiz_scores', null);
        const winners = answers.filter((a) => a.choice === correct).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(0, 5).map((a) => ({ name: a.name }));
        return put('quiz_round', Q0, { status: 'revealed', correct, winners, closes_at: new Date(Math.min(Date.parse(r.closes_at), Date.now())).toISOString() });
      },
      async hide() { await requireAdmin(); return put('quiz_round', Q0, { status: 'idle' }); },
      async resetScores() { await requireAdmin(); store.set('quiz_scores', {}); emit('quiz_scores', null); },
      async saveQuestion({ id, question, answers, correct, category }) {
        await requireAdmin();
        const clean = answers.map((a) => String(a).trim().slice(0, 80)).filter(Boolean);
        if (clean.length < 2 || clean.length > 4) throw new Error('Eine Frage braucht 2 bis 4 Antworten.');
        if (!(correct >= 0 && correct < clean.length)) throw new Error('Bitte die richtige Antwort wählen.');
        if (String(question).trim().length < 3) throw new Error('Die Frage ist zu kurz.');
        const row = { id: id || `dq${nextId++}`, question: String(question).trim().slice(0, 200), answers: clean, correct, category: String(category || 'Fortnite').trim().slice(0, 30), used_at: null, created_at: now() };
        const list = questions();
        store.set('quiz_questions', id ? list.map((q) => (q.id === id ? { ...q, ...row, used_at: q.used_at } : q)) : [...list, row]);
        return row;
      },
      async deleteQuestion(id) { await requireAdmin(); store.set('quiz_questions', questions().filter((q) => q.id !== id)); },
    },

    queue: {
      settings: async () => oneRow('queue_settings', QS0),
      entries: async () => store.get('queue_entries', []).filter((e) => ['waiting', 'picked'].includes(e.status)).map(({ epic, key: _k, ...e }) => e),
      async me() {
        const list = store.get('queue_entries', []);
        const mine = list.find((e) => e.key === key() && ['waiting', 'picked'].includes(e.status));
        return { status: mine?.status ?? null, position: mine?.status === 'waiting' ? this._order(list).findIndex((e) => e.key === key()) + 1 : null, epic: store.get('queue_players', {})[key()] ?? null };
      },
      _order(list) {
        const cfg = oneRow('queue_settings', QS0);
        return list.filter((e) => e.status === 'waiting')
          .sort((a, b) => ((cfg.sub_priority && b.is_sub) - (cfg.sub_priority && a.is_sub)) || Date.parse(a.joined_at) - Date.parse(b.joined_at) || a.id - b.id);
      },
      async adminList() {
        await requireAdmin();
        const list = store.get('queue_entries', []);
        const order = this._order(list);
        const players = store.get('queue_players', {});
        return list.filter((e) => ['waiting', 'picked'].includes(e.status))
          .map((e) => ({ ...e, epic_name: players[e.key] ?? '', place: e.status === 'waiting' ? order.indexOf(e) + 1 : null }))
          .sort((a, b) => (a.status === b.status ? (a.place ?? 0) - (b.place ?? 0) : a.status === 'picked' ? -1 : 1));
      },
      async join(epic) {
        needUser();
        const cfg = oneRow('queue_settings', QS0);
        if (!cfg.open || !tileOpen('queue')) throw new Error('Die Warteschlange ist gerade zu.');
        const e = String(epic ?? '').trim().slice(0, 32);
        if (!/^[\p{L}\p{N} ._-]{3,32}$/u.test(e)) throw new Error('Bitte einen gültigen Epic-Namen eintragen (3–32 Zeichen).');
        store.set('queue_players', { ...store.get('queue_players', {}), [key()]: e });
        const list = store.get('queue_entries', []);
        if (!list.some((x) => x.key === key() && ['waiting', 'picked'].includes(x.status))) {
          if (list.filter((x) => x.status === 'waiting').length >= cfg.max_size) throw new Error('Die Warteschlange ist voll.');
          list.push({ id: nextId++, key: key(), name: name(), is_sub: false, source: 'web', status: 'waiting', joined_at: now(), picked_at: null });
        }
        store.set('queue_entries', list);
        emit('queue_entries', null);
        return { ok: true, position: this._order(list).findIndex((x) => x.key === key()) + 1 };
      },
      async leave() {
        needUser();
        store.set('queue_entries', store.get('queue_entries', []).map((x) => (x.key === key() && x.status === 'waiting' ? { ...x, status: 'removed' } : x)));
        emit('queue_entries', null);
      },
      async pick(count) {
        await requireAdmin();
        const cfg = oneRow('queue_settings', QS0);
        const list = store.get('queue_entries', []);
        let order = this._order(list);
        if (cfg.mode === 'random') {
          const subs = shuffled(order.filter((e) => cfg.sub_priority && e.is_sub));
          const rest = shuffled(order.filter((e) => !(cfg.sub_priority && e.is_sub)));
          order = [...subs, ...rest];
        }
        const chosen = order.slice(0, clampInt(count, 1, 20, cfg.squad_size));
        if (!chosen.length) throw new Error('Gerade wartet niemand.');
        chosen.forEach((e) => Object.assign(e, { status: 'picked', picked_at: now() }));
        store.set('queue_entries', list);
        emit('queue_entries', null);
        return { picked: chosen.length };
      },
      async update(action, id = null) {
        await requireAdmin();
        const list = store.get('queue_entries', []).map((e) => {
          if (action === 'done' && e.id === id) return { ...e, status: 'done' };
          if (action === 'remove' && e.id === id) return { ...e, status: 'removed' };
          if (action === 'back' && e.id === id && e.status === 'picked') return { ...e, status: 'waiting', picked_at: null };
          if (action === 'done_all' && e.status === 'picked') return { ...e, status: 'done' };
          if (action === 'clear' && ['waiting', 'picked'].includes(e.status)) return { ...e, status: 'removed' };
          return e;
        });
        store.set('queue_entries', list.filter((e) => ['waiting', 'picked'].includes(e.status)));
        emit('queue_entries', null);
      },
      async save({ open, mode, sub, max, squad, note }) {
        await requireAdmin();
        const c = oneRow('queue_settings', QS0);
        return put('queue_settings', QS0, {
          open: open ?? c.open, mode: ['order', 'random'].includes(mode) ? mode : c.mode, sub_priority: sub ?? c.sub_priority,
          max_size: clampInt(max, 1, 500, c.max_size), squad_size: clampInt(squad, 1, 20, c.squad_size), note: String(note ?? c.note).trim().slice(0, 100),
        });
      },
    },

    // Verlosung: Im Demo-Modus gibt es keinen Twitch-Chat – „Test-Teilnehmer“ füllt den Lostopf
    giveaway: {
      async get() {
        const g = oneRow('giveaway', GW0);
        if (g.status === 'open' && g.ends_at && Date.parse(g.ends_at) <= Date.now()) return put('giveaway', GW0, { status: 'closed' });
        return g;
      },
      entries: async (round) => store.get('giveaway_entries', []).filter((e) => e.round === round).map(({ key: _k, ...e }) => e).reverse(),
      winners: async () => store.get('giveaway_winners', []).slice(0, 10),
      me: async () => {
        const g = oneRow('giveaway', GW0);
        const mine = store.get('giveaway_entries', []).find((e) => e.round === g.round && e.key === key());
        return { joined: !!mine && !mine.kicked, won: !!mine?.won && !mine.kicked, kicked: !!mine?.kicked, twitch: false };
      },
      async start({ prize, command, followersOnly, minutes, confirm }) {
        await requireAdmin();
        const p = String(prize ?? '').trim();
        if (p.length < 2 || p.length > 100) throw new Error('Bitte einen Preis eintragen (2–100 Zeichen).');
        let cmd = String(command ?? '').trim().toLowerCase() || '!verlosung';
        if (!cmd.startsWith('!')) cmd = `!${cmd}`;
        if (!/^![a-z0-9äöüß_]{2,20}$/.test(cmd)) throw new Error('Der Befehl darf nur Buchstaben, Zahlen und _ haben (2–20 Zeichen), z. B. !verlosung.');
        const mins = clampInt(minutes, 0, 240, 0);
        const g = oneRow('giveaway', GW0);
        const round = g.round + 1;
        store.set('giveaway_entries', store.get('giveaway_entries', []).filter((e) => e.round >= round - 1));
        return put('giveaway', GW0, {
          round, status: 'open', prize: p, command: cmd, followers_only: followersOnly !== false, confirm_in_chat: confirm !== false,
          entries: 0, opened_at: now(), ends_at: mins ? new Date(Date.now() + mins * 60000).toISOString() : null, winner_name: '', drawn_at: null, draws: 0,
        });
      },
      async close() {
        await requireAdmin();
        const g = await this.get();
        return g.status === 'open' ? put('giveaway', GW0, { status: 'closed', ends_at: now() }) : g;
      },
      async draw() {
        await requireAdmin();
        const g = await this.get();
        if (g.status === 'idle' || !g.round) throw new Error('Erst eine Verlosung starten.');
        const list = store.get('giveaway_entries', []);
        const pool = list.filter((e) => e.round === g.round && !e.won && !e.kicked);
        if (!pool.length) throw new Error(g.entries ? 'Alle Teilnehmer wurden schon gezogen.' : 'Noch niemand im Lostopf.');
        const win = pick(pool);
        win.won = true;
        store.set('giveaway_entries', list);
        store.set('giveaway_winners', [{ id: nextId++, round: g.round, prize: g.prize, name: win.name, entries: g.entries, created_at: now() }, ...store.get('giveaway_winners', [])].slice(0, 50));
        return put('giveaway', GW0, { status: 'drawn', winner_name: win.name, drawn_at: now(), draws: g.draws + 1, ends_at: g.ends_at && Date.parse(g.ends_at) < Date.now() ? g.ends_at : now() });
      },
      async reset() { await requireAdmin(); return put('giveaway', GW0, { status: 'idle', ends_at: null }); },
      // wie giveaway_kick: aus dem Lostopf, nicht mehr ziehbar; war es der Gewinner, wieder „geschlossen“
      async kick(id, kick = true) {
        await requireAdmin();
        const g = await this.get();
        const list = store.get('giveaway_entries', []);
        const e = list.find((x) => x.id === id && x.round === g.round);
        if (!e) throw new Error('Diesen Teilnehmer gibt es in der aktuellen Verlosung nicht (mehr).');
        if (!!e.kicked === kick) return g;
        const wasWinner = kick && e.won && g.status === 'drawn' && g.winner_name === e.name;
        if (kick && e.won) {
          const wins = store.get('giveaway_winners', []);
          const i = wins.findIndex((w) => w.round === g.round && w.name === e.name);
          if (i >= 0) { wins.splice(i, 1); store.set('giveaway_winners', wins); }
        }
        e.kicked = kick;
        if (kick) e.won = false;
        store.set('giveaway_entries', list);
        return put('giveaway', GW0, {
          entries: Math.max(0, g.entries + (kick ? -1 : 1)),
          ...(wasWinner ? { status: 'closed', winner_name: '', drawn_at: null } : {}),
        });
      },
      // Demo: ein paar Zuschauer „schreiben“ den Befehl in den Chat
      async addTest(n = 5) {
        await requireAdmin();
        const g = await this.get();
        if (g.status !== 'open') throw new Error('Die Verlosung ist gerade nicht offen.');
        const NAMES = ['NightOwl_Mia', 'PixelPaul', 'GG_Gina', 'LootLukas', 'CrispyCarl', 'StreamSofia', 'BuildBenno', 'SnipeSina', 'Kartoffel_Kai', 'LamaLeni', 'NoScopeNils', 'VictoryVera'];
        const list = store.get('giveaway_entries', []);
        const taken = new Set(list.filter((e) => e.round === g.round).map((e) => e.key));
        let added = 0;
        for (const name of shuffled(NAMES)) {
          if (added >= n) break;
          const k = `demo:${name}`;
          if (taken.has(k)) continue;
          list.push({ id: nextId++, round: g.round, key: k, name, won: false, created_at: now() });
          added++;
        }
        store.set('giveaway_entries', list);
        return put('giveaway', GW0, { entries: g.entries + added });
      },
    },
    // Game-Pakete: wie counter_*/gamewheel_*/heart_* in der Migration
    counters: {
      list: async () => [...store.get('counters', [])].sort((a, b) => a.position - b.position || a.id - b.id),
      async save({ id = null, label, emoji, command, show = true, game = '' }) {
        await requireAdmin();
        const list = store.get('counters', []);
        const cmd = String(command ?? '').replace(/^!+/, '').trim().toLowerCase() || null;
        if (!String(label ?? '').trim() || String(label).trim().length > 24) throw new Error('Der Name braucht 1 bis 24 Zeichen.');
        if (cmd && !/^[a-z0-9äöüß]{2,20}$/.test(cmd)) throw new Error('Der Chat-Befehl darf nur Buchstaben und Zahlen haben (2–20 Zeichen), z. B. tode.');
        if (cmd && list.some((c) => c.command === cmd && c.id !== id)) throw new Error(`Den Befehl !${cmd} hat schon ein anderer Zähler.`);
        if (id === null) {
          if (list.length >= 12) throw new Error('Höchstens 12 Zähler.');
          const row = { id: nextId++, label: label.trim(), emoji: emoji?.trim() || '🔢', command: cmd, value: 0, game, show, position: list.length + 1, last_delta: 0, last_by: '', updated_at: now() };
          store.set('counters', [...list, row]);
          emit('counters', row);
          return row;
        }
        const next = list.map((c) => (c.id === id ? { ...c, label: label.trim(), emoji: emoji?.trim() || '🔢', command: cmd, show, updated_at: now() } : c));
        store.set('counters', next);
        emit('counters', next.find((c) => c.id === id));
        return next.find((c) => c.id === id);
      },
      async add(id, delta = 1, set = null) {
        await requireAdmin();
        let row = null;
        const next = store.get('counters', []).map((c) => {
          if (c.id !== id) return c;
          const value = Math.max(-999999, Math.min(999999, set !== null ? set : c.value + delta));
          row = { ...c, value, last_delta: value - c.value, last_by: name(), updated_at: now() };
          return row;
        });
        if (!row) throw new Error('Diesen Zähler gibt es nicht.');
        store.set('counters', next);
        emit('counters', row);
        return row;
      },
      async remove(id) { await requireAdmin(); store.set('counters', store.get('counters', []).filter((c) => c.id !== id)); emit('counters', { id }); },
      async order(ids) {
        await requireAdmin();
        store.set('counters', store.get('counters', []).map((c) => ({ ...c, position: ids.indexOf(c.id) + 1 || c.position })));
        emit('counters', {});
      },
    },
    gamewheel: {
      get: async () => oneRow('gamewheel', GWH0),
      async spin({ mode, options, ids = null, game = '' }) {
        await requireAdmin();
        const opts = (options ?? []).map((o) => String(o).trim().slice(0, 80)).filter(Boolean);
        if (opts.length < 2 || opts.length > 16) throw new Error('Das Rad braucht 2 bis 16 Felder.');
        const i = randomInt(opts.length);
        const g = oneRow('gamewheel', GWH0);
        return put('gamewheel', GWH0, { n: g.n + 1, mode, game, options: opts, result_index: i, result: opts[i], spun_by: name(), spun_at: now(), ids });
      },
      async save({ game = null, challenges = null, auto = null }) {
        await requireAdmin();
        const g = oneRow('gamewheel', GWH0);
        const all = { ...g.challenges };
        if (game) {
          const list = (challenges ?? []).map((c) => String(c).trim().slice(0, 80)).filter(Boolean);
          if (list.length > 16) throw new Error('Höchstens 16 Challenges je Game.');
          if (list.length === 1) throw new Error('Mindestens 2 Challenges (oder keine für die Vorlage).');
          if (list.length) all[game] = list; else delete all[game];
        }
        return put('gamewheel', GWH0, { challenges: all, auto_switch: auto ?? g.auto_switch });
      },
      announce: async () => {},
    },
    heart: {
      get: async () => oneRow('heart_rate', HR0),
      async push(bpm) {
        await requireAdmin();
        if (!(bpm >= 25 && bpm <= 250)) throw new Error(`Unplausibler Puls: ${bpm}`);
        const h = oneRow('heart_rate', HR0);
        if (h.at && Date.now() - Date.parse(h.at) < 2000) return { ok: false, reason: 'fast' };
        const fresh = !h.at || Date.now() - Date.parse(h.at) > 600000;
        put('heart_rate', HR0, fresh
          ? { bpm, at: now(), session_at: now(), s_min: bpm, s_max: bpm, s_sum: bpm, s_n: 1 }
          : { bpm, at: now(), s_min: Math.min(h.s_min, bpm), s_max: Math.max(h.s_max, bpm), s_sum: h.s_sum + bpm, s_n: h.s_n + 1 });
        return { ok: true };
      },
      async settings({ alarm = null, stop = false }) {
        await requireAdmin();
        if (alarm !== null && (alarm < 60 || alarm > 220)) throw new Error('Die Warnschwelle kann 60 bis 220 sein.');
        const h = oneRow('heart_rate', HR0);
        return put('heart_rate', HR0, { alarm: alarm ?? h.alarm, ...(stop ? { at: null, bpm: null } : {}) });
      },
    },
    // Umfrage: wie poll_start/poll_vote/poll_finish in der Migration
    poll: {
      get: async () => oneRow('polls', PL0),
      history: async () => store.get('poll_history', []).slice(0, 10),
      async me() {
        const p = oneRow('polls', PL0);
        return store.get('poll_votes', {})[`${p.round}:${key()}`] ?? null;
      },
      finish() {
        const p = oneRow('polls', PL0);
        if (p.status !== 'open') return p;
        const done = put('polls', PL0, { status: 'closed', closed_at: now() });
        if (done.total > 0) {
          store.set('poll_history', [{ id: nextId++, question: done.question, options: done.options, counts: done.counts, total: done.total, opened_at: done.opened_at, closed_at: done.closed_at },
            ...store.get('poll_history', [])].slice(0, 20));
        }
        return done;
      },
      async start({ question, options, minutes = 0, chat = true }) {
        await requireAdmin();
        const q = String(question ?? '').replace(/\s+/g, ' ').trim();
        const opts = (options ?? []).map((o) => String(o).replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean);
        if (q.length < 3 || q.length > 120) throw new Error('Die Frage braucht 3 bis 120 Zeichen.');
        if (opts.length < 2 || opts.length > 5) throw new Error('Eine Umfrage braucht 2 bis 5 Antworten.');
        if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) throw new Error('Zwei Antworten sind gleich.');
        this.finish();
        const p = oneRow('polls', PL0);
        const m = clampInt(minutes, 0, 60, 0);
        store.set('poll_votes', {});
        return put('polls', PL0, {
          status: 'open', round: p.round + 1, question: q, options: opts, counts: opts.map(() => 0), total: 0, chat_vote: !!chat,
          opened_at: now(), ends_at: m ? new Date(Date.now() + m * 60000).toISOString() : null, closed_at: null,
        });
      },
      async close() { await requireAdmin(); return this.finish(); },
      async hide() { await requireAdmin(); this.finish(); return put('polls', PL0, { status: 'idle' }); },
      async tick() {
        const p = oneRow('polls', PL0);
        if (p.status === 'open' && p.ends_at && Date.parse(p.ends_at) <= Date.now()) this.finish();
      },
      cast(voter, choice) {
        const p = oneRow('polls', PL0);
        if (p.status !== 'open' || !tileOpen('poll')) return { ok: false, reason: 'closed' };
        if (p.ends_at && Date.parse(p.ends_at) <= Date.now()) { this.finish(); return { ok: false, reason: 'closed' }; }
        if (!(choice >= 1 && choice <= p.options.length)) return { ok: false, reason: 'choice' };
        const votes = store.get('poll_votes', {});
        const k = `${p.round}:${voter}`;
        const old = votes[k];
        const counts = [...p.counts];
        let total = p.total;
        if (!old) { counts[choice - 1] += 1; total += 1; }
        else if (old !== choice) { counts[old - 1] = Math.max(0, counts[old - 1] - 1); counts[choice - 1] += 1; }
        votes[k] = choice;
        store.set('poll_votes', votes);
        if (old !== choice) put('polls', PL0, { counts, total });
        return { ok: true, choice, changed: !!old && old !== choice, counts, total };
      },
      async vote(choice) { needUser(); return this.cast(key(), Number(choice)); },
      // Demo: der „Chat“ stimmt ab
      async addTest(n = 10) {
        await requireAdmin();
        const p = oneRow('polls', PL0);
        if (p.status !== 'open') throw new Error('Gerade läuft keine Umfrage.');
        const weights = p.options.map((_, i) => 1 / (i + 1.5));
        const sum = weights.reduce((a, b) => a + b, 0);
        for (let i = 0; i < n; i++) {
          let r = randomFloat() * sum;
          const choice = weights.findIndex((w) => (r -= w) < 0) + 1 || 1;
          this.cast(`demo:${nextId++}`, choice);
        }
        return oneRow('polls', PL0);
      },
    },
    // Hot Words: wie hotwords_note/-refresh in der Migration (ohne Spam-Schutz)
    hotwords: {
      get: async () => oneRow('hotwords', HW0),
      counts: async (limit = 40) => [...store.get('hotword_counts', [])].sort((a, b) => b.n - a.n || Date.parse(b.last_at) - Date.parse(a.last_at)).slice(0, limit),
      blocks: async () => store.get('hotword_blocks', []),
      refresh() {
        const h = oneRow('hotwords', HW0);
        const top = [...store.get('hotword_counts', [])].filter((c) => c.n > 0)
          .sort((a, b) => b.n - a.n || Date.parse(b.last_at) - Date.parse(a.last_at)).slice(0, h.max_words).map((c) => ({ w: c.label, n: c.n }));
        return JSON.stringify(top) === JSON.stringify(h.top) ? h : put('hotwords', HW0, { top });
      },
      async settings({ enabled = null, maxWords = null, minLength = null }) {
        await requireAdmin();
        if (maxWords !== null && (maxWords < 1 || maxWords > 5)) throw new Error('Es können 1 bis 5 Wörter angezeigt werden.');
        if (minLength !== null && (minLength < 2 || minLength > 10)) throw new Error('Die Mindestlänge kann 2 bis 10 Buchstaben sein.');
        const h = oneRow('hotwords', HW0);
        put('hotwords', HW0, { enabled: enabled ?? h.enabled, max_words: maxWords ?? h.max_words, min_length: minLength ?? h.min_length });
        return this.refresh();
      },
      async reset() {
        await requireAdmin();
        store.set('hotword_counts', []);
        const h = oneRow('hotwords', HW0);
        return put('hotwords', HW0, { round: h.round + 1, top: [], started_at: now() });
      },
      async block(word, block = true) {
        await requireAdmin();
        const w = String(word ?? '').trim().toLowerCase().slice(0, 30);
        if (!w) throw new Error('Kein Wort angegeben.');
        const blocks = store.get('hotword_blocks', []).filter((b) => b.word !== w);
        if (block) {
          blocks.unshift({ word: w, created_at: now() });
          store.set('hotword_counts', store.get('hotword_counts', []).filter((c) => c.word !== w));
        }
        store.set('hotword_blocks', blocks);
        return this.refresh();
      },
      // Demo: der „Chat“ schreibt ein paar Nachrichten
      async addTest(n = 8) {
        await requireAdmin();
        const h = oneRow('hotwords', HW0);
        if (!h.enabled) throw new Error('Hot Words sind gerade aus.');
        const POOL = ['KEKW', 'Sniper', 'GG', 'Pog', 'Clutch', 'Lag', 'Victory', 'Bruder', 'Zone', 'Pizza', 'Lama', 'Noob', 'Sweaty', 'W', 'OMEGALUL'];
        const weights = POOL.map((_, i) => 1 / (i + 1));
        const sum = weights.reduce((a, b) => a + b, 0);
        const blocked = new Set(store.get('hotword_blocks', []).map((b) => b.word));
        const counts = store.get('hotword_counts', []);
        for (let i = 0; i < n; i++) {
          let roll = randomFloat() * sum;
          const label = POOL[weights.findIndex((w) => (roll -= w) < 0)] ?? POOL[0];
          const w = label.toLowerCase();
          if (w.length < h.min_length || blocked.has(w)) continue;
          const row = counts.find((c) => c.word === w);
          if (row) { row.n += 1; row.last_at = now(); } else counts.push({ word: w, label, n: 1, last_at: now() });
        }
        store.set('hotword_counts', counts);
        return this.refresh();
      },
    },
    tts: {
      settings: async () => oneRow('tts_settings', T0),
      state: async () => oneRow('tts_state', { id: 1, skip_n: 0, muted: false }),
      messages: async () => store.get('tts_messages', []),
      async review(id, action) {
        await requireAdmin();
        const list = store.get('tts_messages', []);
        const m = list.find((x) => x.id === id);
        if (!m || (action !== 'replay' && m.status !== 'pending') || (action === 'replay' && m.status !== 'approved')) throw new Error('Diese Nachricht ist schon erledigt.');
        Object.assign(m, action === 'reject' ? { status: 'rejected' } : { status: 'approved' }, { reviewed_at: now(), reviewed_by: name() });
        store.set('tts_messages', list);
        emit('tts_messages', m);
        return m;
      },
      async web(text, voice) {
        await requireAdmin();
        const t = String(text ?? '').trim();
        if (!t) throw new Error('Bitte einen Text eingeben.');
        if (t.length > oneRow('tts_settings', T0).max_chars) throw new Error('Die Nachricht ist zu lang.');
        const m = { id: `tts${nextId++}`, who: name(), text: t, voice: TTS_VOICES.some((v) => v.id === voice) ? voice : 'normal', status: 'approved', source: 'web', reviewed_at: now(), reviewed_by: name(), created_at: now() };
        store.set('tts_messages', [m, ...store.get('tts_messages', [])].slice(0, 40));
        emit('tts_messages', m);
        return m;
      },
      // Demo: eine Einlösung wie von Twitch (zum Ausprobieren der Freigabe)
      async simulate(who, text, voice = 'normal') {
        const cfg = oneRow('tts_settings', T0);
        const m = { id: `tts${nextId++}`, who, text, voice, status: cfg.need_approval ? 'pending' : 'approved', source: 'twitch', reviewed_at: cfg.need_approval ? null : now(), reviewed_by: '', created_at: now() };
        store.set('tts_messages', [m, ...store.get('tts_messages', [])].slice(0, 40));
        emit('tts_messages', m);
        return m;
      },
      async skip(mute = null) {
        await requireAdmin();
        const s = oneRow('tts_state', { id: 1, skip_n: 0, muted: false });
        return put('tts_state', { id: 1, skip_n: 0, muted: false }, mute === null ? { skip_n: s.skip_n + 1 } : { muted: mute });
      },
      async save({ approval, max, blocked }) {
        await requireAdmin();
        return put('tts_settings', T0, { need_approval: approval, max_chars: clampInt(max, 20, 500, 200), blocked_words: [...new Set(blocked.map((w) => w.trim().toLowerCase()).filter(Boolean))] });
      },
    },

    cards: {
      defs: async () => defs(),
      settings: async () => oneRow('card_settings', CS0),
      async me() {
        needUser();
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
        const players = store.get('card_players', {});
        return {
          key: key(),
          packs: store.get('card_packs', []).filter((p) => p.key === key() && !p.opened_at),
          daily: oneRow('card_settings', CS0).daily && tileOpen('cards') && (players[key()]?.last_daily ?? '') < today,
          owned: Object.entries(owned()[key()] ?? {}).filter(([, n]) => n > 0).map(([card_id, count]) => ({ card_id, count })),
        };
      },
      async claimDaily() {
        needUser();
        if (!tileOpen('cards')) throw new Error('Die Sammelkarten starten erst später.');
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
        const players = store.get('card_players', {});
        if ((players[key()]?.last_daily ?? '') >= today) throw new Error('Dein Gratis-Pack für heute hast du schon – morgen gibt es ein neues.');
        players[key()] = { name: name(), last_daily: today };
        store.set('card_players', players);
        const pack = { id: `pk${nextId++}`, key: key(), source: 'daily', created_at: now(), opened_at: null };
        store.set('card_packs', [...store.get('card_packs', []), pack]);
        return pack.id;
      },
      async open(packId) {
        needUser();
        const packs = store.get('card_packs', []);
        const pack = packs.find((p) => p.id === packId && p.key === key());
        if (!pack) throw new Error('Dieses Pack gibt es nicht.');
        if (pack.opened_at) throw new Error('Dieses Pack ist schon offen.');
        const all = owned();
        const mine = all[key()] ?? {};
        const out = [];
        for (let i = 0; i < oneRow('card_settings', CS0).pack_size; i++) {
          const c = drawCard();
          out.push({ ...c, new: !(mine[c.id] > 0) });
          mine[c.id] = (mine[c.id] ?? 0) + 1;
          if (['epic', 'legendary'].includes(c.rarity)) {
            const pull = { id: nextId++, who: name(), card_id: c.id, card_name: c.name, rarity: c.rarity, emoji: c.emoji, image_path: c.image_path, created_at: now() };
            store.set('card_pulls', [pull, ...store.get('card_pulls', [])].slice(0, 20));
            emit('card_pulls', pull);
          }
        }
        all[key()] = mine;
        store.set('card_owned', all);
        pack.opened_at = now();
        store.set('card_packs', packs);
        const players = store.get('card_players', {});
        players[key()] = { ...players[key()], name: name() };
        store.set('card_players', players);
        return out;
      },
      async leaderboard() {
        const players = store.get('card_players', {});
        return Object.entries(owned()).map(([k, cards]) => ({
          player_key: k, name: players[k]?.name ?? k, uniq: Object.values(cards).filter((n) => n > 0).length, total: Object.values(cards).reduce((s, n) => s + n, 0),
        })).filter((r) => r.uniq > 0).sort((a, b) => b.uniq - a.uniq || b.total - a.total);
      },
      collection: async (k) => Object.entries(owned()[k] ?? {}).filter(([, n]) => n > 0).map(([card_id, count]) => ({ card_id, count })),
      trades: async () => store.get('card_trades', []).filter((t) => t.status === 'open' && (t.from_key === key() || t.to_key === key())),
      async offer(to, give, want) {
        needUser();
        const all = owned();
        if (to === key()) throw new Error('Mit dir selbst tauschen geht nicht.');
        if (!(all[key()]?.[give] > 0)) throw new Error('Diese Karte hast du nicht.');
        if (!(all[to]?.[want] > 0)) throw new Error('Diese Karte hat die andere Person nicht (mehr).');
        const t = { id: `tr${nextId++}`, from_key: key(), from_name: name(), to_key: to, to_name: store.get('card_players', {})[to]?.name ?? '', give_card: give, want_card: want, status: 'open', created_at: now() };
        store.set('card_trades', [t, ...store.get('card_trades', [])]);
        return t;
      },
      async answer(id, accept) {
        needUser();
        const trades = store.get('card_trades', []);
        const t = trades.find((x) => x.id === id && x.status === 'open');
        if (!t) throw new Error('Dieses Angebot gibt es nicht mehr.');
        if (!accept) t.status = t.to_key === key() ? 'declined' : 'canceled';
        else {
          if (t.to_key !== key()) throw new Error('Das Angebot ist nicht an dich.');
          const all = owned();
          if (!(all[t.from_key]?.[t.give_card] > 0) || !(all[t.to_key]?.[t.want_card] > 0)) t.status = 'failed';
          else {
            all[t.from_key][t.give_card] -= 1;
            all[t.to_key][t.want_card] -= 1;
            all[t.to_key][t.give_card] = (all[t.to_key][t.give_card] ?? 0) + 1;
            all[t.from_key][t.want_card] = (all[t.from_key][t.want_card] ?? 0) + 1;
            store.set('card_owned', all);
            t.status = 'accepted';
          }
        }
        store.set('card_trades', trades);
        return t;
      },
      async save({ id, name: cardName, rarity, emoji, image, description, active }) {
        await requireAdmin();
        if (!String(cardName ?? '').trim()) throw new Error('Die Karte braucht einen Namen.');
        const row = { id: id || `dc${nextId++}`, name: cardName.trim().slice(0, 40), rarity, emoji: String(emoji ?? '').trim().slice(0, 8) || '🃏', image_path: image || null, description: String(description ?? '').trim().slice(0, 120), active: active ?? true, created_at: now() };
        const list = defs();
        store.set('card_defs', id ? list.map((c) => (c.id === id ? { ...c, ...row, created_at: c.created_at } : c)) : [...list, row]);
        return row;
      },
      async remove(card) {
        await requireAdmin();
        store.set('card_defs', defs().filter((c) => c.id !== card.id));
        const all = owned();
        for (const k of Object.keys(all)) delete all[k][card.id];
        store.set('card_owned', all);
      },
      async saveSettings({ size, daily, weights }) {
        await requireAdmin();
        if (weights && (weights.length !== 5 || weights.some((w) => !(w >= 0 && w <= 1000)) || !weights.some((w) => w > 0))) throw new Error('Fünf Gewichte zwischen 0 und 1000, nicht alle 0.');
        const c = oneRow('card_settings', CS0);
        return put('card_settings', CS0, { pack_size: clampInt(size, 1, 10, c.pack_size), daily: daily ?? c.daily, weights: weights ?? c.weights });
      },
      // Demo: Bilder als data:-URL direkt in der Karte
      async upload(blob) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
          reader.readAsDataURL(blob);
        });
      },
      imageUrl: (path) => path || '',
      // Demo: ein Pack wie per Kanalpunkte
      async grant() {
        needUser();
        store.set('card_packs', [...store.get('card_packs', []), { id: `pk${nextId++}`, key: key(), source: 'twitch', created_at: now(), opened_at: null }]);
      },
    },

    guard: {
      get: async () => oneRow('site_guard', { id: 1, viewer_pause: false, until: null, reason: '', updated_by: '' }),
      async set(on, minutes) {
        await requireAdmin();
        return put('site_guard', { id: 1 }, { viewer_pause: on, until: on && minutes > 0 ? new Date(Date.now() + minutes * 60000).toISOString() : null, updated_by: name() });
      },
    },

    rewards: {
      list: async () => [
        { key: 'tts', title: '🔊 Nachricht vorlesen', cost: 500, cooldown: 30, enabled: true, reward_id: null, synced_at: null, error: '' },
        { key: 'cards', title: '🃏 Sammelkarten-Pack', cost: 1000, cooldown: 0, enabled: true, reward_id: null, synced_at: null, error: '' },
      ].map((r) => ({ ...r, ...(store.get('stream_rewards', {})[r.key] ?? {}) })),
      async set(k, patch) {
        await requireAdmin();
        const all = store.get('stream_rewards', {});
        all[k] = { ...all[k], ...patch };
        store.set('stream_rewards', all);
        return all[k];
      },
      async sync() { throw new Error('Im Demo-Modus gibt es keine Kanalpunkte – dafür Supabase und Twitch verbinden.'); },
    },
  };
}
