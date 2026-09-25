// Datenzugriff: Supabase (Live) oder localStorage (Demo).
// Beide Varianten haben dieselbe Schnittstelle, damit app.js nichts davon wissen muss.
import { CONFIG } from './config.js';
import { DEFAULT_TILES, DEFAULT_VARIANTS, DEFAULT_IDEAS } from './defaults.js';
import { betLines, cardCell, fullBetLines } from './bingo.js';
import { DEFAULT_PET } from './pet.js';
import { DEFAULT_STAGE } from './questions.js';
import { DEFAULT_TICKER } from './ticker.js';
import { DEFAULT_SHOP } from './shop.js';

export const isDemo = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY;

export function createApi() {
  return isDemo ? createLocalApi() : createSupabaseApi();
}

// Supabase-Fehlermeldungen auf Deutsch
const ERRORS = [
  [/invalid login credentials/i, 'E-Mail oder Passwort ist falsch.'],
  [/already registered|already been registered/i, 'Diese E-Mail ist bereits registriert.'],
  [/password should be at least/i, 'Das Passwort muss mindestens 6 Zeichen haben.'],
  [/email not confirmed/i, 'Bitte bestätige zuerst den Link in deiner E-Mail.'],
  [/rate limit|too many/i, 'Zu viele Versuche. Bitte kurz warten.'],
  [/unable to validate email|invalid.*email/i, 'Diese E-Mail-Adresse ist ungültig.'],
  [/failed to send a request to the edge function|function ?not ?found|\bnot found\b.*function/i, 'Die Edge Function ist nicht erreichbar. Wurde sie schon zu Supabase hochgeladen? (siehe README, Schritt „Edge Functions“)'],
  [/column "kind"|twitch_bot/i, 'In der Datenbank fehlt die Erweiterung für den Chat-Bot: supabase/migrations/20260923120000_chat_bot.sql im SQL Editor ausführen.'],
  [/relation "public\.(pranks|sounds|prank_settings)"|could not find the (table|function) '?public\.(pranks|sounds|prank_settings|send_prank)|bucket not found/i, 'In der Datenbank fehlt „Ärgere den Dave“: supabase/migrations/20260924000000_pranks.sql im SQL Editor ausführen.'],
  [/bingo_player_cards/i, 'In der Datenbank fehlen die eigenen Bingo-Karten: supabase/migrations/20260925000000_channel_points.sql im SQL Editor ausführen.'],
  [/relation "public\.(questions|question_stage)"|could not find the (table|function) '?public\.(questions|question_stage|question_show|question_resolve|question_hide)/i, 'In der Datenbank fehlen „Unangenehme Fragen“: supabase/migrations/20260928000000_questions_pet.sql im SQL Editor ausführen.'],
  [/feed_command|pet_feed_command/i, 'In der Datenbank fehlt der Chat-Befehl für den Dino: supabase/migrations/20260930000000_live_overlay.sql im SQL Editor ausführen.'],
  [/relation "public\.overlay_config"|could not find the (table|function) '?public\.(overlay_config|overlay_access|overlay_save|overlay_allow_admins)/i, 'In der Datenbank fehlt das Live-Overlay: supabase/migrations/20260930000000_live_overlay.sql im SQL Editor ausführen.'],
  [/relation "public\.shop_|could not find the (table|function) '?public\.(shop_)/i, 'In der Datenbank fehlt der Kisten-Shop: supabase/migrations/20261001000000_loot_shop.sql im SQL Editor ausführen.'],
  [/relation "public\.ticker"|could not find the table '?public\.ticker/i, 'In der Datenbank fehlt das Laufband: supabase/migrations/20260929000000_ticker.sql im SQL Editor ausführen.'],
  [/relation "public\.(pet|pet_events)"|could not find the (table|function) '?public\.(pet|pet_events|pet_action|pet_say)\b/i, 'In der Datenbank fehlt Daves Dino: supabase/migrations/20260928000000_questions_pet.sql im SQL Editor ausführen.'],
  [/column .*bet\b|'bet' column/i, 'In der Datenbank fehlt die Tipprunde: supabase/migrations/20260926120000_bingo_bet.sql im SQL Editor ausführen.'],
  [/column .*amount|'amount' column/i, 'In der Datenbank fehlt die Zahl im Icon fürs Bingo: supabase/migrations/20260926000000_bingo_amount.sql im SQL Editor ausführen.'],
  [/column .*rarity|'rarity' column/i, 'In der Datenbank fehlt die Seltenheit fürs Bingo: supabase/migrations/20260925120000_bingo_rarity.sql im SQL Editor ausführen.'],
  [/relation "public\.bingo_(items|card)"|could not find the (table|function) '?public\.bingo_/i, 'In der Datenbank fehlt das Fortnite-Bingo: supabase/migrations/20260924120000_bingo.sql im SQL Editor ausführen.'],
  [/exceeded the maximum allowed size|payload too large|entity too large/i, 'Die Datei ist zu groß (höchstens 1 MB).'],
  [/mime type|invalid.*content.?type/i, 'Dieses Dateiformat geht nicht. Bitte MP3, OGG, WAV oder M4A nehmen.'],
  [/row-level security/i, 'Das ist gerade nicht erlaubt.'],
  [/failed to fetch|networkerror/i, 'Keine Verbindung zum Server.'],
  [/provider is not enabled|unsupported provider/i, 'Diese Anmelde-Möglichkeit ist noch nicht eingerichtet.'],
  [/access.denied|user denied|cancel/i, 'Anmeldung abgebrochen.'],
  [/email.*(not|kein).*(provided|available)|missing email/i, 'Der Anbieter hat keine E-Mail-Adresse geliefert. Bitte eine andere Möglichkeit wählen.'],
];
export function germanError(err) {
  const msg = err?.message ?? String(err);
  return ERRORS.find(([re]) => re.test(msg))?.[1] ?? msg;
}

// ------------------------------------------------------------
// Supabase
// ------------------------------------------------------------
async function createSupabaseApi() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  const unwrap = ({ data, error }) => { if (error) throw error; return data; };

  async function invoke(name, body) {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let message = error.message;
      try { message = (await error.context.json()).error ?? message; } catch { /* keine JSON-Antwort */ }
      throw new Error(message);
    }
    return data;
  }

  return {
    demo: false,
    async getUser() {
      const { data } = await sb.auth.getSession();
      return data.session?.user ?? null;
    },
    onAuthChange(cb) {
      sb.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
    },
    async signIn(email, password) {
      unwrap(await sb.auth.signInWithPassword({ email, password }));
    },
    async signUp(username, email, password) {
      const data = unwrap(await sb.auth.signUp({
        email,
        password,
        options: { data: { username }, emailRedirectTo: location.origin + location.pathname },
      }));
      return { needsConfirmation: !data.session };
    },
    // Welche Social-Logins sind in Supabase eingeschaltet?
    async authProviders() {
      const res = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY } });
      if (!res.ok) return {};
      return (await res.json()).external ?? {};
    },
    async signInWithProvider(provider) {
      const { data, error } = await sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo: location.origin + location.pathname, skipBrowserRedirect: true },
      });
      if (error) throw error;
      location.href = data.url;
    },
    // Einmal-Code aus admin.html einlösen → echte Sitzung als Stellwerk-Admin
    async adminSiteLogin(tokenHash) {
      unwrap(await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' }));
    },
    async signOut() { await sb.auth.signOut(); },
    async getProfile(user) {
      const { data } = await sb.from('profiles').select('username, is_admin').eq('id', user.id).maybeSingle();
      return data ?? { username: user.user_metadata?.username ?? user.email.split('@')[0], is_admin: false };
    },
    async getTiles() {
      return unwrap(await sb.from('tiles').select('*').order('position'));
    },
    async updateTile(id, patch) {
      return unwrap(await sb.from('tiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single());
    },
    async getVariants() {
      return unwrap(await sb.from('wheel_variants').select('*').order('position'));
    },
    // Vorschläge aus der Community. Die Tabellen kamen erst später dazu –
    // fehlen sie noch, liefert die Abfrage einen Fehler und app.js blendet
    // den Bereich aus.
    async getIdeas(limit = 12) {
      return unwrap(await sb.from('ideas_ranked')
        .select('id, text, author, votes, voted')
        .order('votes', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit));
    },
    async addIdea(text) {
      const { data: session } = await sb.auth.getSession();
      const user = session.session?.user;
      if (!user) throw new Error('Bitte zuerst anmelden.');
      const profile = await this.getProfile(user);
      const row = unwrap(await sb.from('ideas')
        .insert({ text, author: profile.username, user_id: user.id })
        .select('id, text, author')
        .single());
      return { ...row, votes: 0, voted: false };
    },
    async voteIdea(id, on) {
      const { data: session } = await sb.auth.getSession();
      const user = session.session?.user;
      if (!user) throw new Error('Bitte zuerst anmelden.');
      if (on) unwrap(await sb.from('idea_votes').insert({ idea_id: id, user_id: user.id }));
      else unwrap(await sb.from('idea_votes').delete().eq('idea_id', id).eq('user_id', user.id));
    },
    async getSpins(limit = 15) {
      return unwrap(await sb.from('spins').select('*').order('created_at', { ascending: false }).limit(limit));
    },
    // Ist die Datenbank fürs OBS-Overlay vorbereitet (Migration …_overlay.sql)?
    async overlayReady() {
      const { error } = await sb.from('overlay_spins').select('id', { head: true }).limit(1);
      return !error;
    },
    // ---------- OBS-Overlay live (overlay_config) ----------
    async getOverlayConfig() {
      return unwrap(await sb.from('overlay_config').select('params, admins_can_edit, updated_by, updated_at').eq('id', 1).maybeSingle());
    },
    async overlayAccess() { return unwrap(await sb.rpc('overlay_access')); },
    async saveOverlayConfig(params) { return unwrap(await sb.rpc('overlay_save', { p_params: params })); },
    async allowAdminsOverlay(on) { return unwrap(await sb.rpc('overlay_allow_admins', { p_on: on })); },
    async spin(variantId, announce) {
      return invoke('spin', { variant_id: variantId, announce });
    },

    // ---------- Ärgere den Dave ----------
    // Fehlt die Migration …_pranks.sql, schlägt getPrankSettings fehl und
    // app.js zeigt statt der Aktionen einen Hinweis.
    async getPrankSettings() {
      // throw_cost/sound_cost kamen mit …_channel_points.sql – fehlen sie noch, trotzdem laden
      const { data, error } = await sb.from('prank_settings').select('enabled, cooldown_seconds, allow_uploads, throw_cost, sound_cost').eq('id', 1).single();
      if (!error) return data;
      return unwrap(await sb.from('prank_settings').select('enabled, cooldown_seconds, allow_uploads').eq('id', 1).single());
    },
    async updatePrankSettings(patch) {
      return unwrap(await sb.from('prank_settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', 1)
        .select('*')
        .single());
    },
    // Kanalpunkte-Belohnungen fürs Ärgern auf Twitch anlegen bzw. abgleichen (nur Admins)
    async syncPrankRewards() {
      return invoke('twitch-oauth', { action: 'sync_pranks' });
    },
    async getPranks(limit = 12) {
      return unwrap(await sb.from('pranks').select('*').order('created_at', { ascending: false }).limit(limit));
    },
    // Pause, An/Aus und Name prüft die Datenbank (send_prank), nicht der Browser.
    async sendPrank(kind, item, soundId = null) {
      const { data, error } = await sb.rpc('send_prank', { p_kind: kind, p_item: item, p_sound: soundId });
      if (error) {
        const err = new Error(error.message);
        const wait = /^cooldown:(\d+)$/.exec(error.hint ?? '');
        if (wait) err.wait = Number(wait[1]);
        if (error.hint === 'paused') err.paused = true;
        throw err;
      }
      return data;
    },
    onPrank(cb) {
      sb.channel('pranks-feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pranks' }, (p) => cb(p.new))
        .subscribe();
    },
    soundUrl(path) {
      return `${CONFIG.SUPABASE_URL}/storage/v1/object/public/sounds/${path.split('/').map(encodeURIComponent).join('/')}`;
    },
    async getSounds() {
      const { data: session } = await sb.auth.getSession();
      const uid = session.session?.user?.id;
      const rows = unwrap(await sb.from('sounds')
        .select('id, name, path, duration, author, user_id, created_at')
        .order('created_at', { ascending: false })
        .limit(80));
      return rows.map((r) => ({ ...r, mine: r.user_id === uid, url: this.soundUrl(r.path) }));
    },
    async uploadSound(file, name, duration) {
      const { data: session } = await sb.auth.getSession();
      const user = session.session?.user;
      if (!user) throw new Error('Bitte zuerst anmelden.');
      const ext = (/\.([a-z0-9]{2,4})$/i.exec(file.name)?.[1] ?? 'mp3').toLowerCase();
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      unwrap(await sb.storage.from('sounds').upload(path, file, {
        contentType: file.type || 'audio/mpeg',
        cacheControl: '31536000',
        upsert: false,
      }));
      const { data, error } = await sb.from('sounds')
        .insert({ name, path, duration, user_id: user.id })
        .select('id, name, path, duration, author, user_id, created_at')
        .single();
      if (error) {
        await sb.storage.from('sounds').remove([path]).catch(() => {});
        throw error;
      }
      return { ...data, mine: true, url: this.soundUrl(path) };
    },
    async deleteSound(sound) {
      unwrap(await sb.from('sounds').delete().eq('id', sound.id));
      const { error } = await sb.storage.from('sounds').remove([sound.path]);
      if (error) console.warn('Sound-Datei nicht gelöscht:', error);
    },

    // ---------- Fortnite-Bingo ----------
    bingoUrl(path) {
      return `${CONFIG.SUPABASE_URL}/storage/v1/object/public/bingo/${path.split('/').map(encodeURIComponent).join('/')}`;
    },
    async getBingo() {
      const [items, card] = await Promise.all([
        sb.from('bingo_items').select('*').order('created_at'),
        sb.from('bingo_card').select('*').eq('id', 1).maybeSingle(),
      ]);
      return { items: unwrap(items).map((i) => ({ ...i, url: this.bingoUrl(i.path) })), card: unwrap(card) };
    },
    async addBingoItem(blob, name, { rarity = null, amount = null } = {}) {
      const ext = blob.type === 'image/webp' ? 'webp' : 'png';
      const path = `${crypto.randomUUID()}.${ext}`;
      unwrap(await sb.storage.from('bingo').upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false }));
      return this.insertBingoItem({ name, path, rarity, amount });
    },
    // Dasselbe Bild noch einmal, z. B. mit anderer Zahl. Die Datei wird kopiert,
    // damit Löschen des einen Eintrags das Bild des anderen nicht mitnimmt.
    async copyBingoItem(item, patch = {}) {
      const path = `${crypto.randomUUID()}.${item.path.split('.').pop()}`;
      unwrap(await sb.storage.from('bingo').copy(item.path, path));
      return this.insertBingoItem({ name: item.name, path, rarity: item.rarity, amount: item.amount, ...patch });
    },
    async insertBingoItem({ name, path, rarity, amount }) {
      // Seltenheit und Zahl nur mitschicken, wenn es sie gibt – so klappt das Hochladen
      // auch, solange die Migrationen …_bingo_rarity.sql / …_bingo_amount.sql noch fehlen.
      const row = { name, path, ...(rarity ? { rarity } : {}), ...(amount ? { amount } : {}) };
      const { data, error } = await sb.from('bingo_items').insert(row).select('*').single();
      if (error) {
        await sb.storage.from('bingo').remove([path]).catch(() => {});
        throw error;
      }
      return { ...data, url: this.bingoUrl(path) };
    },
    async updateBingoItem(id, patch) {
      unwrap(await sb.from('bingo_items').update(patch).eq('id', id));
    },
    async deleteBingoItem(item) {
      unwrap(await sb.from('bingo_items').delete().eq('id', item.id));
      const { error } = await sb.storage.from('bingo').remove([item.path]);
      if (error) console.warn('Bingo-Bild nicht gelöscht:', error);
    },
    async newBingoCard(size, free) {
      return unwrap(await sb.rpc('bingo_new_card', { p_size: size, p_free: free }));
    },
    // Tipprunde über eine Twitch-Vorhersage: action = start | check | cancel
    async bingoBet(action, seconds) {
      return invoke('bingo-bet', { action, seconds });
    },
    async toggleBingo(index) {
      return unwrap(await sb.rpc('bingo_toggle', { p_index: index }));
    },
    async updateBingoCard(patch) {
      return unwrap(await sb.from('bingo_card').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1).select().single());
    },
    // Eigene Bingo-Karte (nur für einen selbst sichtbar)
    async getMyBingo() {
      return unwrap(await sb.from('bingo_player_cards').select('size, cells, marked, created_at').maybeSingle());
    },
    async saveMyBingo(card) {
      const { data: session } = await sb.auth.getSession();
      const user = session.session?.user;
      if (!user) throw new Error('Bitte zuerst anmelden.');
      return unwrap(await sb.from('bingo_player_cards')
        .upsert({ user_id: user.id, size: card.size, cells: card.cells, marked: card.marked, created_at: card.created_at, updated_at: new Date().toISOString() })
        .select('size, cells, marked, created_at')
        .single());
    },
    onBingo(cb) {
      sb.channel('bingo-feed')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bingo_card' }, (p) => cb(p.new))
        .subscribe();
    },
    // ---------- Unangenehme Fragen ----------
    // Zuschauer sehen nur ihre eigenen Fragen, Admins alle (RLS).
    async getQuestions() {
      return unwrap(await sb.from('questions').select('*').order('created_at', { ascending: false }).limit(300));
    },
    async askQuestion(text, anonymous) {
      const { data: session } = await sb.auth.getSession();
      const user = session.session?.user;
      if (!user) throw new Error('Bitte zuerst anmelden.');
      return unwrap(await sb.from('questions').insert({ text, anonymous, user_id: user.id }).select('*').single());
    },
    async deleteQuestion(id) {
      unwrap(await sb.from('questions').delete().eq('id', id));
    },
    async reviewQuestion(id, status) {
      return unwrap(await sb.from('questions').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id).select('*').single());
    },
    async getQuestionStage() {
      return unwrap(await sb.from('question_stage').select('*').eq('id', 1).maybeSingle());
    },
    async showQuestion(id) { return unwrap(await sb.rpc('question_show', { p_id: id })); },
    async resolveQuestion(outcome) { return unwrap(await sb.rpc('question_resolve', { p_outcome: outcome })); },
    async hideQuestion() { return unwrap(await sb.rpc('question_hide')); },
    async savePunishments(punishments) {
      return unwrap(await sb.from('question_stage').update({ punishments }).eq('id', 1).select('*').single());
    },
    onQuestions(cb) {
      sb.channel('questions-feed')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, (p) => cb(p))
        .subscribe();
    },
    onQuestionStage(cb) {
      sb.channel('question-stage')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'question_stage' }, (p) => cb(p.new))
        .subscribe();
    },
    // ---------- Kisten-Shop ----------
    async getShopSettings() {
      return unwrap(await sb.from('shop_settings').select('items, prices, shop_seconds').eq('id', 1).maybeSingle());
    },
    async saveShopSettings(patch) {
      return unwrap(await sb.from('shop_settings').update(patch).eq('id', 1).select('items, prices, shop_seconds').single());
    },
    // Liefert { run, chests } – alle vier Kisten zum Aufdecken
    async openChest(chest, code = null, stream = false) {
      return unwrap(await sb.rpc('shop_open_chest', { p_chest: chest, p_code: code, p_stream: stream }));
    },
    async shopBuy(runId, name) { return unwrap(await sb.rpc('shop_buy', { p_run: runId, p_name: name })); },
    async shopDoneShopping(runId) { return unwrap(await sb.rpc('shop_done_shopping', { p_run: runId })); },
    async shopMark(runId, index, found) { return unwrap(await sb.rpc('shop_mark', { p_run: runId, p_index: index, p_found: found })); },
    async shopFinish(runId) { return unwrap(await sb.rpc('shop_finish', { p_run: runId })); },
    async getMyShopRun() {
      const { data: session } = await sb.auth.getSession();
      const user = session.session?.user;
      if (!user) return null;
      return unwrap(await sb.from('shop_runs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle());
    },
    async createShopLobby() { return unwrap(await sb.rpc('shop_create_lobby')); },
    async closeShopLobby(code) { return unwrap(await sb.rpc('shop_close_lobby', { p_code: code })); },
    async joinShopLobby(code) { return unwrap(await sb.rpc('shop_join_lobby', { p_code: code })); },
    async leaveShopLobby(code) { unwrap(await sb.rpc('shop_leave_lobby', { p_code: code })); },
    async startShopLobby(code) { return unwrap(await sb.rpc('shop_start_lobby', { p_code: code })); },
    // Läuft eine Zeit ab (Kisten, Shop), schiebt das die Runde in die nächste Phase
    async tickShopLobby(code) { return unwrap(await sb.rpc('shop_lobby_tick', { p_code: code })); },
    async getShopLobby(code) {
      return unwrap(await sb.from('shop_lobbies_public').select('*').eq('code', code.trim().toUpperCase()).maybeSingle());
    },
    async getShopLobbyById(id) {
      return unwrap(await sb.from('shop_lobbies_public').select('*').eq('id', id).maybeSingle());
    },
    async getLobbyRuns(lobbyId) {
      return unwrap(await sb.from('shop_runs').select('*').eq('lobby_id', lobbyId).order('score', { ascending: false }));
    },
    onShopRuns(cb) {
      sb.channel('shop-runs')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_runs' }, (p) => cb(p.eventType === 'DELETE' ? null : p.new))
        .subscribe();
    },
    // ---------- Laufband im Overlay ----------
    async getTicker() {
      return unwrap(await sb.from('ticker').select('items').eq('id', 1).maybeSingle())?.items ?? null;
    },
    async saveTicker(items) {
      return unwrap(await sb.from('ticker').update({ items }).eq('id', 1).select('items').single()).items;
    },
    // ---------- Daves Dino ----------
    async getPet() {
      return unwrap(await sb.from('pet').select('*').eq('id', 1).maybeSingle());
    },
    async getPetEvents(limit = 20) {
      return unwrap(await sb.from('pet_events').select('*').order('created_at', { ascending: false }).limit(limit));
    },
    async petAction(kind) { return unwrap(await sb.rpc('pet_action', { p_kind: kind })); },
    async petSay(text) { return unwrap(await sb.rpc('pet_say', { p_text: text })); },
    async updatePet(patch) {
      return unwrap(await sb.from('pet').update(patch).eq('id', 1).select('*').single());
    },
    onPet(cb) {
      sb.channel('pet-feed')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pet' }, (p) => cb(p.new))
        .subscribe();
    },
    onPetEvents(cb) {
      sb.channel('pet-events')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pet_events' }, (p) => cb(p.new))
        .subscribe();
    },
    onSpin(cb) {
      sb.channel('spins-feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'spins' }, (p) => cb(p.new))
        .subscribe();
    },
    async twitchStatus() {
      return unwrap(await sb.rpc('twitch_status'));
    },
    async twitchConnect() {
      const { url } = await invoke('twitch-oauth', { action: 'start' });
      location.href = url;
    },
    async twitchDisconnect() {
      await invoke('twitch-oauth', { action: 'disconnect' });
    },
  };
}

// ------------------------------------------------------------
// Demo (localStorage)
// ------------------------------------------------------------
function createLocalApi() {
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(`zd_${key}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(`zd_${key}`, JSON.stringify(value)); } catch { /* privater Modus */ }
    },
  };
  let listeners = [];
  let spinListeners = [];
  const prankListeners = [];
  const bingoListeners = [];
  let current = null;
  let nextId = Date.now();

  async function hash(text) {
    if (!crypto?.subtle) return text;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const emit = () => listeners.forEach((cb) => cb(current));
  const randomInt = (max) => Math.floor(Math.random() * max);

  function makeSpin(variant, source, requestedBy) {
    const index = randomInt(variant.segments.length);
    const seg = variant.segments[index];
    const spin = {
      id: nextId++,
      created_at: new Date().toISOString(),
      source,
      variant_id: variant.id,
      variant_name: variant.name,
      segment_index: index,
      result: seg.label,
      detail: seg.detail,
      requested_by: requestedBy,
    };
    store.set('spins', [spin, ...store.get('spins', [])].slice(0, 30));
    return spin;
  }

  async function requireAdmin() {
    const u = store.get('users', {})[current?.email];
    if (!u?.is_admin) throw new Error('Nur Admins dürfen das.');
  }
  function saveCard(card) {
    const next = { ...card, updated_at: new Date().toISOString() };
    store.set('bingo_card', next);
    setTimeout(() => bingoListeners.forEach((cb) => cb(next)), 30);
    return next;
  }

  // Fragen und Dino im Demo-Modus: in localStorage, Overlay im selben Browser liest mit
  const demoListeners = {};
  const emitDemo = (key, payload) => setTimeout(() => (demoListeners[key] ?? []).forEach((cb) => cb(payload)), 30);
  const isAdminNow = () => !!store.get('users', {})[current?.email]?.is_admin;
  const demoStage = () => ({ ...DEFAULT_STAGE, ...store.get('question_stage', {}) });
  function saveStage(patch) {
    const next = { ...demoStage(), ...patch, updated_at: new Date().toISOString() };
    store.set('question_stage', next);
    emitDemo('question_stage', next);
    return next;
  }
  function savePet(pet) {
    const next = { ...pet, updated_at: new Date().toISOString() };
    store.set('pet', next);
    emitDemo('pet', next);
    return next;
  }
  // Kisten-Shop im Demo-Modus
  const demoChests = () => [45 + randomInt(21), 90 + randomInt(31), 140 + randomInt(31), 200 + randomInt(41)].sort(() => Math.random() - 0.5);
  const shopScore = (items) => { const f = items.filter((i) => i.found).length; return f + (items.length && f === items.length ? 10 : 0); };
  function saveRuns(runs) {
    store.set('shop_runs', runs.slice(0, 200));
  }
  function updateRun(id, fn) {
    const runs = store.get('shop_runs', []);
    const run = runs.find((r) => r.id === id && r.user_id === current?.email);
    if (!run) throw new Error('Diese Runde gibt es nicht.');
    const next = { ...fn(run), updated_at: new Date().toISOString() };
    saveRuns(runs.map((r) => (r.id === id ? next : r)));
    emitDemo('shop_runs', next);
    return next;
  }
  // Koop-Runden im Demo-Modus: gleiche Phasen wie shop_lobby_advance in der Datenbank
  const LOBBY_CHEST_MS = 45000;
  const demoLobbies = () => store.get('shop_lobbies', []);
  const findLobby = (code) => demoLobbies().find((l) => l.code === String(code ?? '').trim().toUpperCase());
  const saveLobby = (lobby) => store.set('shop_lobbies', demoLobbies().map((l) => (l.id === lobby.id ? lobby : l)));
  const pubLobby = (l) => (l ? { ...l, chests: l.shop_until ? l.chests : null } : null);
  function saveLobbyRuns(runs) {
    saveRuns(runs);
    emitDemo('shop_runs', null);
  }
  function advanceLobby(id) {
    const l = demoLobbies().find((x) => x.id === id);
    if (!l?.started_at || l.ended_at) return;
    let runs = store.get('shop_runs', []);
    const inLobby = () => runs.filter((r) => r.lobby_id === id);
    const now = Date.now();
    const iso = new Date().toISOString();
    if (!l.shop_until) {
      if (inLobby().some((r) => r.status === 'choosing')) {
        if (now < Date.parse(l.chests_until)) return;
        for (const r of inLobby().filter((x) => x.status === 'choosing')) {
          const taken = new Set(inLobby().map((x) => x.chest).filter((c) => c != null));
          const free = [0, 1, 2, 3].filter((c) => !taken.has(c));
          const pick = free[randomInt(free.length)];
          runs = runs.map((x) => (x.id === r.id ? { ...x, chest: pick, coins: l.chests[pick], status: 'opened', updated_at: iso } : x));
        }
      }
      const secs = ({ ...DEFAULT_SHOP, ...store.get('shop_settings', {}) }).shop_seconds;
      l.shop_until = new Date(now + (secs + 3) * 1000).toISOString();
      runs = runs.map((x) => (x.lobby_id === id && x.status === 'opened' ? { ...x, status: 'shopping', shop_until: l.shop_until, updated_at: iso } : x));
    } else if (!l.vs_at) {
      if (inLobby().some((r) => r.status === 'shopping') && now <= Date.parse(l.shop_until) + 3000) return;
      l.vs_at = iso;
      runs = runs.map((x) => (x.lobby_id === id && ['shopping', 'playing'].includes(x.status) ? { ...x, status: 'playing', updated_at: iso } : x));
    } else if (inLobby().every((r) => r.status === 'done')) {
      Object.assign(l, { ended_at: iso, open: false });
    } else {
      return;
    }
    saveLobby(l);
    saveLobbyRuns(runs);
  }
  function lobbyOfRun(run) {
    return run.lobby_id ? demoLobbies().find((l) => l.id === run.lobby_id) : null;
  }
  // Mitspieler in anderen Tabs
  addEventListener('storage', (e) => {
    if (e.key === 'zd_shop_runs') (demoListeners.shop_runs ?? []).forEach((cb) => cb(null));
  });
  function addPetEvent(ev) {
    const row = { id: nextId++, created_at: new Date().toISOString(), ...ev };
    store.set('pet_events', [row, ...store.get('pet_events', [])].slice(0, 40));
    emitDemo('pet_events', row);
    return row;
  }

  const sessionEmail = store.get('session', null);
  const users = store.get('users', {});
  if (sessionEmail && users[sessionEmail]) current = { id: sessionEmail, email: sessionEmail };

  return {
    demo: true,
    async getUser() { return current; },
    onAuthChange(cb) { listeners.push(cb); },
    async signIn(email, password) {
      const u = store.get('users', {})[email.toLowerCase()];
      if (!u || u.pass !== await hash(password)) throw new Error('E-Mail oder Passwort ist falsch.');
      current = { id: email.toLowerCase(), email: email.toLowerCase() };
      store.set('session', current.email);
      emit();
    },
    async signUp(username, email, password) {
      const all = store.get('users', {});
      const key = email.toLowerCase();
      if (all[key]) throw new Error('Diese E-Mail ist bereits registriert.');
      // Im Demo-Modus wird der erste Account zum Admin, damit man das Bearbeiten testen kann.
      all[key] = { username, pass: await hash(password), is_admin: Object.keys(all).length === 0 };
      store.set('users', all);
      current = { id: key, email: key };
      store.set('session', key);
      emit();
      return { needsConfirmation: false };
    },
    async authProviders() {
      return { twitch: true, discord: true, google: true, spotify: true, github: true };
    },
    async signInWithProvider() {
      throw new Error('Im Demo-Modus nicht verfügbar. Social-Logins brauchen Supabase.');
    },
    async adminSiteLogin(email) {
      if (!store.get('users', {})[email]) throw new Error('Admin-Account nicht gefunden.');
      current = { id: email, email };
      store.set('session', email);
    },
    async signOut() {
      current = null;
      store.set('session', null);
      emit();
    },
    async getProfile(user) {
      const u = store.get('users', {})[user.email] ?? {};
      return { username: u.username ?? user.email, is_admin: !!u.is_admin };
    },
    async getTiles() { return store.get('tiles', DEFAULT_TILES); },
    async updateTile(id, patch) {
      const tiles = store.get('tiles', DEFAULT_TILES).map((t) => (t.id === id ? { ...t, ...patch } : t));
      store.set('tiles', tiles);
      return tiles.find((t) => t.id === id);
    },
    async getVariants() { return DEFAULT_VARIANTS; },
    async getIdeas(limit = 12) {
      const me = current?.email ?? '';
      return store.get('ideas', DEFAULT_IDEAS)
        .map(({ voters = [], ...i }) => ({ ...i, votes: i.votes + (voters.includes(me) ? 1 : 0), voted: voters.includes(me) }))
        .sort((a, b) => b.votes - a.votes || b.id - a.id)
        .slice(0, limit);
    },
    async addIdea(text) {
      const profile = await this.getProfile(current);
      const idea = { id: nextId++, text, author: profile.username, votes: 0, voters: [current.email] };
      store.set('ideas', [idea, ...store.get('ideas', DEFAULT_IDEAS)].slice(0, 40));
      return { id: idea.id, text, author: idea.author, votes: 1, voted: true };
    },
    async voteIdea(id, on) {
      const me = current?.email ?? '';
      store.set('ideas', store.get('ideas', DEFAULT_IDEAS).map((i) => {
        if (i.id !== id) return i;
        const voters = new Set(i.voters ?? []);
        if (on) voters.add(me); else voters.delete(me);
        return { ...i, voters: [...voters] };
      }));
    },
    async getSpins(limit = 15) { return store.get('spins', []).slice(0, limit); },
    async overlayReady() { return true; },
    // Demo: Admins gelten als Dave
    async getOverlayConfig() { return { params: '', admins_can_edit: false, updated_by: '', ...store.get('overlay_config', {}) }; },
    async overlayAccess() {
      const admin = isAdminNow();
      const cfg = store.get('overlay_config', {});
      return { can_edit: admin, is_owner: admin, admins_can_edit: !!cfg.admins_can_edit };
    },
    async saveOverlayConfig(params) {
      await requireAdmin();
      if (!/^[A-Za-z0-9_=&.,%+-]*$/.test(params) || params.length > 2000) throw new Error('Ungültige Einstellungen.');
      const next = { ...store.get('overlay_config', {}), params, updated_by: store.get('users', {})[current.email]?.username ?? '', updated_at: new Date().toISOString() };
      store.set('overlay_config', next);
      return next;
    },
    async allowAdminsOverlay(on) {
      await requireAdmin();
      const next = { ...store.get('overlay_config', {}), admins_can_edit: !!on };
      store.set('overlay_config', next);
      return next;
    },

    // ---------- Ärgere den Dave (Demo) ----------
    // Neue Einträge in zd_pranks erreichen das Overlay im selben Browser über das storage-Ereignis.
    async getPrankSettings() {
      return { enabled: true, cooldown_seconds: 20, allow_uploads: true, throw_cost: 500, sound_cost: 300, ...store.get('prank_settings', {}) };
    },
    async syncPrankRewards() {
      throw new Error('Im Demo-Modus nicht verfügbar. Die Belohnungen braucht Twitch und Supabase.');
    },
    async updatePrankSettings(patch) {
      const next = { ...(await this.getPrankSettings()), ...patch };
      store.set('prank_settings', next);
      return next;
    },
    async getPranks(limit = 12) { return store.get('pranks', []).slice(0, limit); },
    async sendPrank(kind, item, soundId = null) {
      const profile = await this.getProfile(current);
      // wie send_prank: Zuschauer lösen über Kanalpunkte aus, hier nur Admins
      if (!profile.is_admin) throw new Error('„Ärgere den Dave“ geht über Kanalpunkte im Twitch-Chat von Dave.');
      let sound = null;
      if (soundId) {
        sound = store.get('sounds', []).find((x) => x.id === soundId);
        if (!sound) throw new Error('Diesen Sound gibt es nicht mehr.');
      }
      const prank = {
        id: nextId++,
        created_at: new Date().toISOString(),
        kind,
        item: sound ? 'custom' : item,
        sound_path: sound?.path ?? null,
        label: sound?.name ?? '',
        requested_by: profile.username,
      };
      store.set('pranks', [prank, ...store.get('pranks', [])].slice(0, 30));
      setTimeout(() => prankListeners.forEach((cb) => cb(prank)), 50);
      return prank;
    },
    onPrank(cb) { prankListeners.push(cb); },
    soundUrl(path) { return store.get('sounds', []).find((x) => x.path === path)?.url ?? ''; },
    async getSounds() {
      return store.get('sounds', []).map((x) => ({ ...x, mine: x.user_id === current?.email }));
    },
    // Demo: Die Datei landet als data:-URL im localStorage – der ist klein, daher höchstens 400 KB.
    async uploadSound(file, name, duration) {
      if (file.size > 400 * 1024) throw new Error('Im Demo-Modus höchstens 400 KB (live: 1 MB).');
      const mine = store.get('sounds', []).filter((x) => x.user_id === current.email);
      if (mine.length >= 8) throw new Error('Du hast schon 8 Sounds hochgeladen. Lösch einen, um Platz zu schaffen.');
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
        reader.readAsDataURL(file);
      });
      const profile = await this.getProfile(current);
      const id = `demo-${nextId++}`;
      const sound = { id, name, path: `demo/${id}`, duration, author: profile.username, user_id: current.email, created_at: new Date().toISOString(), url };
      try {
        localStorage.setItem('zd_sounds', JSON.stringify([sound, ...store.get('sounds', [])]));
      } catch {
        throw new Error('Der Speicher im Browser ist voll. Lösch einen Sound oder nimm eine kürzere Datei.');
      }
      return { ...sound, mine: true };
    },
    async deleteSound(sound) {
      store.set('sounds', store.get('sounds', []).filter((x) => x.id !== sound.id));
    },

    // ---------- Fortnite-Bingo (Demo) ----------
    // Bilder liegen als data:-URL in zd_bingo_items, die Karte in zd_bingo_card.
    bingoUrl(path) { return store.get('bingo_items', []).find((i) => i.path === path)?.url ?? ''; },
    async getBingo() { return { items: store.get('bingo_items', []), card: store.get('bingo_card', null) }; },
    async addBingoItem(blob, name, { rarity = null, amount = null } = {}) {
      await requireAdmin();
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
        reader.readAsDataURL(blob);
      });
      return this.insertBingoItem({ name, rarity, amount, url });
    },
    async copyBingoItem(item, patch = {}) {
      await requireAdmin();
      return this.insertBingoItem({ name: item.name, rarity: item.rarity, amount: item.amount, url: item.url, ...patch });
    },
    async insertBingoItem({ name, rarity = null, amount = null, url }) {
      const id = `demo-${nextId++}`;
      const item = { id, name, rarity, amount, path: `demo/${id}`, url, created_at: new Date().toISOString() };
      try {
        localStorage.setItem('zd_bingo_items', JSON.stringify([...store.get('bingo_items', []), item]));
      } catch {
        throw new Error('Der Speicher im Browser ist voll – im Demo-Modus passen nicht so viele Bilder hinein.');
      }
      return item;
    },
    async updateBingoItem(id, patch) {
      await requireAdmin();
      store.set('bingo_items', store.get('bingo_items', []).map((i) => (i.id === id ? { ...i, ...patch } : i)));
    },
    async deleteBingoItem(item) {
      await requireAdmin();
      store.set('bingo_items', store.get('bingo_items', []).filter((i) => i.id !== item.id));
    },
    async bingoBet(action, seconds = 120) {
      await requireAdmin();
      const card = store.get('bingo_card', null);
      if (!card) throw new Error('Es gibt noch keine Bingo-Karte.');
      const bet = card.bet;
      if (action === 'start') {
        if (bet?.status === 'active') throw new Error('Es läuft schon eine Tipprunde.');
        if (fullBetLines(card).length) throw new Error('Auf der Karte ist schon eine Reihe voll. Erst „Haken entfernen“ oder eine neue Karte ziehen.');
        const now = Date.now();
        const outcomes = betLines(card.size).map(({ key, title }) => ({ id: `demo-${key}`, key, title }));
        return { bet: saveCard({ ...card, bet: { id: 'demo', status: 'active', outcomes, started_at: new Date(now).toISOString(), lock_at: new Date(now + seconds * 1000).toISOString() } }).bet };
      }
      if (bet?.status !== 'active') return { bet };
      if (action === 'cancel') return { bet: saveCard({ ...card, bet: { ...bet, status: 'canceled' } }).bet };
      const done = new Set(fullBetLines(card).map((l) => l.key));
      const winner = bet.outcomes.find((o) => done.has(o.key));
      if (!winner) return { bet };
      return { bet: saveCard({ ...card, bet: { ...bet, status: 'resolved', winner: winner.key, winner_title: winner.title } }).bet };
    },
    async newBingoCard(size, free) {
      await requireAdmin();
      if (store.get('bingo_card', null)?.bet?.status === 'active') throw new Error('Es läuft noch eine Tipprunde. Erst beenden oder abbrechen, dann eine neue Karte ziehen.');
      const items = store.get('bingo_items', []);
      const withFree = free && size % 2 === 1;
      const need = size * size - (withFree ? 1 : 0);
      if (items.length < need) throw new Error(`Für eine ${size}×${size}-Karte braucht es ${need} Bilder – hochgeladen sind erst ${items.length}.`);
      const shuffled = [...items].sort(() => Math.random() - 0.5).slice(0, need).map(cardCell);
      const center = Math.floor((size * size) / 2);
      if (withFree) shuffled.splice(center, 0, { free: true });
      return saveCard({ id: 1, size, cells: shuffled, marked: withFree ? [center] : [], visible: true, created_at: new Date().toISOString() });
    },
    async toggleBingo(index) {
      await requireAdmin();
      const card = store.get('bingo_card', null);
      if (!card) throw new Error('Es gibt noch keine Bingo-Karte.');
      if (card.cells[index]?.free) return card;
      const marked = card.marked.includes(index) ? card.marked.filter((i) => i !== index) : [...card.marked, index];
      return saveCard({ ...card, marked });
    },
    async updateBingoCard(patch) {
      await requireAdmin();
      return saveCard({ ...store.get('bingo_card', null), ...patch });
    },
    onBingo(cb) { bingoListeners.push(cb); },
    // ---------- Unangenehme Fragen (Demo) ----------
    async getQuestions() {
      const all = store.get('questions', []);
      return isAdminNow() ? all : all.filter((q) => q.user_id === current?.email);
    },
    async askQuestion(text, anonymous) {
      if (!current) throw new Error('Bitte zuerst anmelden.');
      const profile = store.get('users', {})[current.email];
      const mine = store.get('questions', []).filter((q) => q.user_id === current.email && Date.now() - Date.parse(q.created_at) < 86400000);
      if (!profile?.is_admin && mine.length >= 3) throw new Error('Du hast heute schon 3 Fragen gestellt. Morgen geht es weiter.');
      const q = {
        id: nextId++, text: text.trim(), anonymous: !!anonymous, author: profile?.username ?? 'Zuschauer', user_id: current.email,
        status: 'pending', outcome: null, punishment: null, created_at: new Date().toISOString(), reviewed_at: null, shown_at: null,
      };
      store.set('questions', [q, ...store.get('questions', [])]);
      emitDemo('questions', { eventType: 'INSERT', new: q });
      return q;
    },
    async deleteQuestion(id) {
      store.set('questions', store.get('questions', []).filter((q) => q.id !== id));
      emitDemo('questions', { eventType: 'DELETE', old: { id } });
    },
    async reviewQuestion(id, status) {
      await requireAdmin();
      let row = null;
      store.set('questions', store.get('questions', []).map((q) => (q.id === id ? (row = { ...q, status, reviewed_at: new Date().toISOString() }) : q)));
      emitDemo('questions', { eventType: 'UPDATE', new: row });
      return row;
    },
    async getQuestionStage() { return demoStage(); },
    async showQuestion(id) {
      await requireAdmin();
      const q = store.get('questions', []).find((x) => x.id === id);
      if (!q) throw new Error('Diese Frage gibt es nicht mehr.');
      if (!['approved', 'done'].includes(q.status)) throw new Error('Die Frage muss erst freigegeben werden.');
      return saveStage({ question_id: q.id, text: q.text, author: q.anonymous ? 'Anonym' : q.author, state: 'ask', punishment: null });
    },
    async resolveQuestion(outcome) {
      await requireAdmin();
      const stage = demoStage();
      if (!stage.question_id || stage.state === 'hidden') throw new Error('Im Stream steht gerade keine Frage.');
      const punishment = outcome === 'punished' ? stage.punishments[randomInt(stage.punishments.length)] : null;
      store.set('questions', store.get('questions', []).map((q) => (q.id === stage.question_id ? { ...q, status: 'done', outcome, punishment } : q)));
      emitDemo('questions', { eventType: 'UPDATE', new: store.get('questions', []).find((q) => q.id === stage.question_id) });
      return saveStage({ state: outcome, punishment });
    },
    async hideQuestion() { await requireAdmin(); return saveStage({ state: 'hidden' }); },
    async savePunishments(punishments) {
      await requireAdmin();
      const list = punishments.map((p) => p.trim().slice(0, 100)).filter(Boolean).slice(0, 50);
      if (!list.length) throw new Error('Es braucht mindestens eine Bestrafung.');
      return saveStage({ punishments: list });
    },
    onQuestions(cb) { (demoListeners.questions ??= []).push(cb); },
    onQuestionStage(cb) { (demoListeners.question_stage ??= []).push(cb); },
    // ---------- Kisten-Shop (Demo) ----------
    async getShopSettings() { return { ...DEFAULT_SHOP, ...store.get('shop_settings', {}) }; },
    async saveShopSettings(patch) {
      await requireAdmin();
      const next = { ...(await this.getShopSettings()), ...patch };
      if (!next.items?.length) throw new Error('Der Shop braucht mindestens ein Item.');
      store.set('shop_settings', next);
      return next;
    },
    async openChest(chest, code = null, stream = false) {
      if (!current) throw new Error('Bitte zuerst anmelden.');
      const profile = store.get('users', {})[current.email];
      const settings = await this.getShopSettings();
      const streamed = !!stream && !!profile?.is_admin;
      let runs = store.get('shop_runs', []).map((r) => (streamed ? { ...r, stream: false } : r));
      if (code) {
        const lobby = findLobby(code);
        if (!lobby) throw new Error('Diese Koop-Runde gibt es nicht. Code prüfen.');
        if (!lobby.open || lobby.ended_at) throw new Error('Diese Koop-Runde ist schon beendet.');
        if (!lobby.started_at) throw new Error(`Warte, bis ${lobby.host_name || 'der Ersteller'} die Runde startet.`);
        const mine = runs.find((r) => r.lobby_id === lobby.id && r.user_id === current.email);
        if (!mine) throw new Error('Du spielst in dieser Koop-Runde nicht mit.');
        if (mine.status !== 'choosing') throw new Error('Du hast schon eine Kiste.');
        const taker = runs.find((r) => r.lobby_id === lobby.id && r.chest === chest);
        if (taker) throw new Error(`Die Kiste hat sich schon ${taker.player} geschnappt.`);
        runs = runs.map((r) => (r.id === mine.id
          ? { ...r, chest, coins: lobby.chests[chest], status: 'opened', stream: r.stream || streamed, updated_at: new Date().toISOString() } : r));
        saveLobbyRuns(runs);
        advanceLobby(lobby.id);
        return {
          run: store.get('shop_runs', []).find((r) => r.id === mine.id),
          chests: pubLobby(demoLobbies().find((l) => l.id === lobby.id)).chests,
        };
      }
      const chests = demoChests();
      runs = runs.map((r) => (r.user_id === current.email && !r.lobby_id ? { ...r, status: 'done' } : r));
      const run = {
        id: `run-${nextId++}`, user_id: current.email, player: profile?.username ?? 'Zuschauer', lobby_id: null,
        stream: streamed, chest, coins: chests[chest], spent: 0, items: [], status: 'shopping',
        shop_until: new Date(Date.now() + settings.shop_seconds * 1000).toISOString(), score: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      saveRuns([run, ...runs]);
      return { run, chests };
    },
    async shopBuy(runId, name) {
      const settings = await this.getShopSettings();
      return updateRun(runId, (r) => {
        if (r.status !== 'shopping') throw new Error('Der Einkauf ist schon vorbei.');
        if (Date.now() > Date.parse(r.shop_until) + 3000) throw new Error('Die Zeit im Shop ist abgelaufen.');
        const item = settings.items.find((i) => i.name.toLowerCase() === name.trim().toLowerCase());
        if (!item) throw new Error('Dieses Item gibt es im Shop nicht.');
        if (r.items.some((i) => i.name.toLowerCase() === item.name.toLowerCase())) throw new Error('Das hast du schon gekauft.');
        const price = Number(settings.prices[item.rarity] ?? 10);
        if (r.spent + price > r.coins) throw new Error('Dafür reichen deine Goldbarren nicht.');
        return { ...r, items: [...r.items, { name: item.name, rarity: item.rarity, price, found: false }], spent: r.spent + price };
      });
    },
    async shopDoneShopping(runId) {
      const run = updateRun(runId, (r) => (r.status === 'shopping' ? { ...r, status: 'playing' } : r));
      if (!run.lobby_id) return run;
      advanceLobby(run.lobby_id);
      return store.get('shop_runs', []).find((r) => r.id === runId);
    },
    async shopMark(runId, index, found) {
      return updateRun(runId, (r) => {
        if (r.lobby_id && !lobbyOfRun(r)?.vs_at) throw new Error('Warte, bis alle eingekauft haben – dann geht das Duell los.');
        if (r.status !== 'playing') throw new Error('Abhaken geht, sobald der Einkauf vorbei ist und bis die Runde endet.');
        const items = r.items.map((it, i) => (i === index ? { ...it, found: !!found } : it));
        return { ...r, items, score: shopScore(items) };
      });
    },
    async shopFinish(runId) {
      const run = updateRun(runId, (r) => {
        if (r.lobby_id && !lobbyOfRun(r)?.vs_at) throw new Error('Warte, bis alle eingekauft haben – dann geht das Duell los.');
        return { ...r, status: 'done', score: shopScore(r.items) };
      });
      if (run.lobby_id) advanceLobby(run.lobby_id);
      return run;
    },
    async getMyShopRun() { return store.get('shop_runs', []).find((r) => r.user_id === current?.email) ?? null; },
    async createShopLobby() {
      if (!current) throw new Error('Bitte zuerst anmelden.');
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const code = Array.from({ length: 5 }, () => letters[randomInt(letters.length)]).join('');
      const name = store.get('users', {})[current.email]?.username ?? '';
      const now = new Date().toISOString();
      const lobby = {
        id: `lobby-${nextId++}`, code, host_id: current.email, host_name: name, chests: demoChests(), open: true, created_at: now,
        started_at: null, chests_until: null, shop_until: null, vs_at: null, ended_at: null,
      };
      store.set('shop_lobbies', [lobby, ...demoLobbies()]);
      const run = {
        id: `run-${nextId++}`, user_id: current.email, player: name || 'Zuschauer', lobby_id: lobby.id, stream: false,
        chest: null, coins: 0, spent: 0, items: [], status: 'waiting', shop_until: null, score: 0, created_at: now, updated_at: now,
      };
      saveLobbyRuns([run, ...store.get('shop_runs', [])]);
      return pubLobby(lobby);
    },
    async joinShopLobby(code) {
      if (!current) throw new Error('Bitte zuerst anmelden.');
      const lobby = findLobby(code);
      if (!lobby) throw new Error('Diese Koop-Runde gibt es nicht. Code prüfen.');
      const runs = store.get('shop_runs', []);
      const mine = runs.find((r) => r.lobby_id === lobby.id && r.user_id === current.email);
      if (mine) return mine;
      if (!lobby.open || lobby.ended_at) throw new Error('Diese Koop-Runde ist schon beendet.');
      if (lobby.started_at) throw new Error('Diese Koop-Runde hat schon angefangen.');
      if (runs.filter((r) => r.lobby_id === lobby.id).length >= 4) throw new Error('Die Koop-Runde ist voll – mehr als 4 geht nicht (4 Kisten).');
      const now = new Date().toISOString();
      const run = {
        id: `run-${nextId++}`, user_id: current.email, player: store.get('users', {})[current.email]?.username ?? 'Zuschauer',
        lobby_id: lobby.id, stream: false, chest: null, coins: 0, spent: 0, items: [], status: 'waiting', shop_until: null, score: 0,
        created_at: now, updated_at: now,
      };
      saveLobbyRuns([...runs, run]);
      return run;
    },
    async leaveShopLobby(code) {
      const lobby = findLobby(code);
      if (!lobby || lobby.started_at) return;
      const runs = store.get('shop_runs', []);
      if (lobby.host_id === current?.email) {
        saveLobby({ ...lobby, open: false, ended_at: new Date().toISOString() });
        saveLobbyRuns(runs.map((r) => (r.lobby_id === lobby.id ? { ...r, status: 'done' } : r)));
      } else {
        saveLobbyRuns(runs.filter((r) => !(r.lobby_id === lobby.id && r.user_id === current?.email)));
      }
    },
    async startShopLobby(code) {
      const lobby = findLobby(code);
      if (!lobby) throw new Error('Diese Koop-Runde gibt es nicht. Code prüfen.');
      if (lobby.host_id !== current?.email) throw new Error('Starten darf nur, wer die Runde eröffnet hat.');
      if (!lobby.open || lobby.ended_at) throw new Error('Diese Koop-Runde ist schon beendet.');
      if (!lobby.started_at) {
        const runs = store.get('shop_runs', []);
        if (runs.filter((r) => r.lobby_id === lobby.id).length < 2) throw new Error('Zum Starten braucht es mindestens 2 Spieler.');
        const now = Date.now();
        Object.assign(lobby, { started_at: new Date(now).toISOString(), chests_until: new Date(now + LOBBY_CHEST_MS).toISOString() });
        saveLobby(lobby);
        saveLobbyRuns(runs.map((r) => (r.lobby_id === lobby.id && r.status === 'waiting' ? { ...r, status: 'choosing', updated_at: lobby.started_at } : r)));
      }
      return pubLobby(lobby);
    },
    async tickShopLobby(code) {
      const lobby = findLobby(code);
      if (!lobby) throw new Error('Diese Koop-Runde gibt es nicht. Code prüfen.');
      advanceLobby(lobby.id);
      return pubLobby(findLobby(code));
    },
    async closeShopLobby(code) {
      const lobby = findLobby(code);
      if (!lobby || (lobby.host_id !== current?.email && !isAdminNow())) throw new Error('Beenden darf nur, wer die Runde eröffnet hat.');
      const now = new Date().toISOString();
      Object.assign(lobby, { open: false, ended_at: lobby.ended_at ?? now, vs_at: lobby.started_at ? (lobby.vs_at ?? now) : null });
      saveLobby(lobby);
      saveLobbyRuns(store.get('shop_runs', []).map((r) => (r.lobby_id === lobby.id && r.status !== 'done'
        ? { ...r, status: 'done', score: shopScore(r.items), updated_at: now } : r)));
      return pubLobby(lobby);
    },
    async getShopLobby(code) { return pubLobby(findLobby(code)); },
    async getShopLobbyById(id) { return pubLobby(demoLobbies().find((x) => x.id === id)); },
    async getLobbyRuns(lobbyId) { return store.get('shop_runs', []).filter((r) => r.lobby_id === lobbyId).sort((a, b) => b.score - a.score); },
    onShopRuns(cb) { (demoListeners.shop_runs ??= []).push(cb); },
    // ---------- Laufband (Demo) ----------
    async getTicker() { return store.get('ticker', null)?.items ?? DEFAULT_TICKER; },
    async saveTicker(items) {
      await requireAdmin();
      const list = items.map((t) => t.trim().slice(0, 120)).filter(Boolean).slice(0, 30);
      if (!list.length) throw new Error('Das Laufband braucht mindestens einen Text.');
      store.set('ticker', { items: list, updated_at: new Date().toISOString() });
      return list;
    },
    // ---------- Daves Dino (Demo) ----------
    async getPet() { return { ...DEFAULT_PET, last_fed_at: new Date().toISOString(), ...store.get('pet', {}) }; },
    async getPetEvents(limit = 20) { return store.get('pet_events', []).slice(0, limit); },
    async petAction(kind) {
      if (!current) throw new Error('Bitte zuerst anmelden.');
      const profile = store.get('users', {})[current.email];
      if (!profile?.is_admin) throw new Error('Im Stream füttern Zuschauer den Dino über den Twitch-Chat.');
      const key = `pet_cd_${current.email}_${kind}`;
      const wait = kind === 'feed' ? 600000 : 60000;
      const last = store.get(key, 0);
      if (!profile?.is_admin && Date.now() - last < wait) {
        throw new Error(`Kurz warten – noch ${Math.ceil((last + wait - Date.now()) / 1000)} Sekunden.`);
      }
      store.set(key, Date.now());
      if (kind === 'feed') {
        const pet = await this.getPet();
        savePet({ ...pet, last_fed_at: new Date().toISOString(), last_fed_by: profile?.username ?? 'Zuschauer', fed_count: (pet.fed_count ?? 0) + 1 });
      }
      return addPetEvent({ kind, who: profile?.username ?? 'Zuschauer', text: '' });
    },
    async petSay(text) {
      await requireAdmin();
      const t = String(text ?? '').trim();
      if (!t || t.length > 100) throw new Error('Bitte 1 bis 100 Zeichen.');
      return addPetEvent({ kind: 'say', who: store.get('users', {})[current.email]?.username ?? 'Admin', text: t });
    },
    async updatePet(patch) {
      await requireAdmin();
      const next = { ...(await this.getPet()), ...patch };
      if (patch.phrases) next.phrases = patch.phrases.map((p) => p.trim().slice(0, 80)).filter(Boolean).slice(0, 50);
      if (patch.name !== undefined) next.name = String(patch.name).trim().slice(0, 20) || 'Rexi';
      if (patch.feed_command !== undefined && !/^![^\s!]{1,29}$/.test(patch.feed_command)) throw new Error('Der Chat-Befehl beginnt mit ! und hat keine Leerzeichen.');
      return savePet(next);
    },
    onPet(cb) { (demoListeners.pet ??= []).push(cb); },
    onPetEvents(cb) { (demoListeners.pet_events ??= []).push(cb); },
    async getMyBingo() { return store.get(`my_bingo_${current?.email}`, null); },
    async saveMyBingo(card) {
      const next = { size: card.size, cells: card.cells, marked: card.marked, created_at: card.created_at };
      store.set(`my_bingo_${current?.email}`, next);
      return next;
    },
    async spin(variantId) {
      const variant = DEFAULT_VARIANTS.find((v) => v.id === variantId) ?? DEFAULT_VARIANTS[0];
      const profile = await this.getProfile(current);
      return { spin: makeSpin(variant, 'web', profile.username), announced: false };
    },
    onSpin(cb) { spinListeners.push(cb); },
    // Nur Demo: tut so, als hätte ein Zuschauer die Kanalpunkte-Belohnung eingelöst.
    simulateRedemption() {
      const names = ['Lokfuehrer_Lena', 'SchienenSeb', 'TTV_Weichensteller', 'Bahnhofskater', 'ICE_Irina'];
      const variant = DEFAULT_VARIANTS[randomInt(DEFAULT_VARIANTS.length)];
      const spin = makeSpin(variant, 'twitch', names[randomInt(names.length)]);
      setTimeout(() => spinListeners.forEach((cb) => cb(spin)), 250);
    },
    async twitchStatus() { return { connected: false }; },
    async twitchConnect() {
      throw new Error('Im Demo-Modus nicht verfügbar. Trag zuerst Supabase in js/config.js ein (siehe README).');
    },
    async twitchDisconnect() {},
  };
}
