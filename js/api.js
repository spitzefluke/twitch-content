// Datenzugriff: Supabase (Live) oder localStorage (Demo).
// Beide Varianten haben dieselbe Schnittstelle, damit app.js nichts davon wissen muss.
import { CONFIG } from './config.js';
import { channelFetch, current as channel, rtSpec, storageFolder } from './channel.js';
import { BOARD } from './prank-fx.js';
import { DEFAULT_TILES, DEFAULT_VARIANTS, DEFAULT_IDEAS } from './defaults.js';
import { betLines, drawCard, fullBetLines } from './bingo.js';
import { COSTUMES, DEFAULT_PET } from './pet.js';
import { advanceStage, isSpecies } from './pet-species.js';
import { DEFAULT_STAGE } from './questions.js';
import { DEFAULT_TICKER } from './ticker.js';
import { DEFAULT_SHOP } from './shop.js';
import { DEFAULT_CHALLENGE, applyResult, gotoStage, resetChallenge, saveChallenge, undoChallenge } from './challenge.js';

export const isDemo = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY;

export function createApi() {
  return isDemo ? createLocalApi() : createSupabaseApi();
}

// Supabase-Fehlermeldungen auf Deutsch
const ERRORS = [
  [/could not find the '(species|stage|hatch_feeds|grow_days|stage_feeds|good_days)' column|column [\w.]*"?(species|stage|hatch_feeds|grow_days)"? (of relation "pet" )?does not exist/i, 'In der Datenbank fehlen die neuen Haustiere (Tierwahl, Ei → Baby → Erwachsen): supabase/migrations/20261021000000_pet_species.sql im SQL Editor ausführen.'],
  [/pet_species_check/i, 'Dieses Tier gibt es nicht.'],
  [/pet_hatch_feeds_check/i, 'Schlüpfen nach 5 bis 500 × Füttern.'],
  [/pet_grow_days_check/i, 'Wachsen nach 1 bis 30 Streams.'],
  // Supabase konnte den Code von Twitch & Co. nicht gegen ein Token tauschen: fast immer passt
  // das Client-Secret in Supabase nicht (mehr) zur App beim Anbieter
  [/unable to exchange external code/i, 'Der Anbieter hat die Anmeldung nicht bestätigt. In Supabase unter Authentication → Providers → Twitch stimmt das Client-Secret nicht (mehr) mit der Twitch-App überein – z. B. nach „Neues Secret“ in der Twitch-Konsole. Secret neu eintragen, dann klappt es wieder.'],
  [/invalid login credentials/i, 'E-Mail oder Passwort ist falsch.'],
  [/already registered|already been registered/i, 'Diese E-Mail ist bereits registriert.'],
  [/password should be at least (\d+)/i, 'Das Passwort ist zu kurz.'],
  [/password is known to be weak|weak.?password|pwned/i, 'Dieses Passwort ist bekannt geworden oder zu leicht zu erraten – bitte ein anderes nehmen.'],
  [/email not confirmed/i, 'Bitte bestätige zuerst den Link in deiner E-Mail.'],
  [/rate limit|too many/i, 'Zu viele Versuche. Bitte kurz warten.'],
  [/unable to validate email|invalid.*email/i, 'Diese E-Mail-Adresse ist ungültig.'],
  [/function ?not ?found|function \S+ not found|\bnot found\b.*function/i, 'Die Edge Function gibt es in Supabase (noch) nicht. Sie wird beim Merge automatisch hochgeladen (GitHub → Actions → „Edge Functions deployen“).'],
  [/failed to send a request to the edge function/i, 'Keine Antwort von der Edge Function. Bitte gleich noch einmal versuchen; bleibt es dabei, Werbeblocker ausschalten und in Supabase die Logs der Function ansehen.'],
  [/column "kind"|twitch_bot/i, 'In der Datenbank fehlt die Erweiterung für den Chat-Bot: supabase/migrations/20260923120000_chat_bot.sql im SQL Editor ausführen.'],
  [/relation "public\.(pranks|sounds|prank_settings)"|could not find the (table|function) '?public\.(pranks|sounds|prank_settings|send_prank)|bucket not found/i, 'In der Datenbank fehlt „Ärgere den Streamer“: supabase/migrations/20260924000000_pranks.sql im SQL Editor ausführen.'],
  [/bingo_player_cards/i, 'In der Datenbank fehlen die eigenen Bingo-Karten: supabase/migrations/20260925000000_channel_points.sql im SQL Editor ausführen.'],
  [/relation "public\.(questions|question_stage)"|could not find the (table|function) '?public\.(questions|question_stage|question_show|question_resolve|question_hide)/i, 'In der Datenbank fehlen „Unangenehme Fragen“: supabase/migrations/20260928000000_questions_pet.sql im SQL Editor ausführen.'],
  [/feed_command|pet_feed_command/i, 'In der Datenbank fehlt der Chat-Befehl für den Dino: supabase/migrations/20260930000000_live_overlay.sql im SQL Editor ausführen.'],
  [/relation "public\.overlay_config"|could not find the (table|function) '?public\.(overlay_config|overlay_access|overlay_save|overlay_allow_admins)/i, 'In der Datenbank fehlt das Live-Overlay: supabase/migrations/20260930000000_live_overlay.sql im SQL Editor ausführen.'],
  [/could not find the function '?public\.(shop_join_lobby|shop_leave_lobby|shop_start_lobby|shop_lobby_tick)|column .*(started_at|vs_at|chests_until)/i, 'In der Datenbank fehlt das Koop-Duell im Kisten-Shop: supabase/migrations/20261002000000_shop_versus.sql im SQL Editor ausführen.'],
  [/relation "public\.win_challenge"|could not find the (table|function) '?public\.(win_challenge|challenge_)/i, 'In der Datenbank fehlt die Win-Challenge: supabase/migrations/20261003000000_win_challenge.sql im SQL Editor ausführen.'],
  [/could not find the function '?public\.shop_lobby_by_(code|id)/i, 'In der Datenbank fehlt eine Sicherheits-Anpassung für den Kisten-Shop: supabase/migrations/20261008000000_shop_lobby_access.sql im SQL Editor ausführen.'],
  [/relation "public\.shop_|could not find the (table|function) '?public\.(shop_)/i, 'In der Datenbank fehlt der Kisten-Shop: supabase/migrations/20261001000000_loot_shop.sql im SQL Editor ausführen.'],
  [/relation "public\.(alert_config|alert_media)"|could not find the table '?public\.(alert_config|alert_media)/i, 'In der Datenbank fehlt der Alert-Designer: supabase/migrations/20261018000000_overlay_designs.sql im SQL Editor ausführen.'],
  [/relation "public\.alert_sounds"|could not find the table '?public\.alert_sounds|stream_alerts_kind_check/i, 'In der Datenbank fehlen Bits und eigene Alert-Sounds: supabase/migrations/20261009000000_alert_bits_sounds.sql im SQL Editor ausführen.'],
  [/relation "public\.stream_alerts"|could not find the (table|function) '?public\.(stream_alerts|alert_test|alerts_status)/i, 'In der Datenbank fehlen die Alerts: supabase/migrations/20261005000000_stream_alerts.sql im SQL Editor ausführen.'],
  [/column .*bonus|'bonus' column/i, 'In der Datenbank fehlt das zweite Glücksrad: supabase/migrations/20261007000000_wheel_bonus.sql im SQL Editor ausführen.'],
  [/could not find the function '?public\.wheel_variants_save/i, 'In der Datenbank fehlt das Bearbeiten des Glücksrads: supabase/migrations/20261006000000_wheel_edit.sql im SQL Editor ausführen.'],
  [/relation "public\.ticker"|could not find the table '?public\.ticker/i, 'In der Datenbank fehlt das Laufband: supabase/migrations/20260929000000_ticker.sql im SQL Editor ausführen.'],
  [/could not find the '(costume|costume_command|costume_cooldown|costume_changed_at|frenzy_at)' column|column [\w.]*"?(costume|costume_command|costume_cooldown|frenzy_at)"? (of relation "pet" )?does not exist|could not find the function '?public\.(pet_frenzy|pet_costume)|pet_events_kind_check/i, 'In der Datenbank fehlen Rexis Kostüme und der Heißhunger-Knopf: supabase/migrations/20261011000000_pet_costume.sql im SQL Editor ausführen.'],
  [/could not find the function '?public\.(streamer_info|my_access|overlay_allow_mods)|relation "public\.channel_mods"|could not find the table '?public\.channel_mods|column [\w.]*"?mods_enabled/i, 'In der Datenbank fehlen Streameransicht und Mods-Freigabe: supabase/migrations/20261012000000_streamer_mods.sql im SQL Editor ausführen.'],
  [/relation "public\.(pet|pet_events)"|could not find the (table|function) '?public\.(pet|pet_events|pet_action|pet_say)\b/i, 'In der Datenbank fehlt der Dino: supabase/migrations/20260928000000_questions_pet.sql im SQL Editor ausführen.'],
  [/column .*bet\b|'bet' column/i, 'In der Datenbank fehlt die Tipprunde: supabase/migrations/20260926120000_bingo_bet.sql im SQL Editor ausführen.'],
  [/column .*\b(vault|image_key)\b|'(vault|image_key)' column/i, 'In der Datenbank fehlt der Item-Tresor fürs Bingo: supabase/migrations/20261022000000_bingo_vault.sql im SQL Editor ausführen.'],
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
// Funktion gibt es (noch) nicht in der Datenbank – Migration fehlt
export function missingFunction(error) {
  return error?.code === 'PGRST202' || /could not find the function/i.test(error?.message ?? '');
}

export function germanError(err) {
  const msg = err?.message ?? String(err);
  return ERRORS.find(([re]) => re.test(msg))?.[1] ?? msg;
}

// ------------------------------------------------------------
// Supabase
// ------------------------------------------------------------
async function createSupabaseApi() {
  const { createClient } = await import('./supabase-js.js');
  // Jede Anfrage trägt den Kanal (Header x-channel, js/channel.js)
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { global: { fetch: channelFetch } });
  const unwrap = ({ data, error }) => { if (error) throw error; return data; };

  // Edge Function aufrufen. Kommt gar keine Antwort (Netzwerk, Kaltstart-Aussetzer, Werbeblocker),
  // versucht es die Seite bei twitch-oauth (nur Einstellungen und Prüfungen) einmal von selbst neu –
  // nicht bei spin oder bingo-bet, die würden sonst doppelt drehen bzw. starten.
  const RETRY_ON_NO_ANSWER = new Set(['twitch-oauth', 'stream-tools']);
  async function invoke(name, body) {
    let { data, error } = await sb.functions.invoke(name, { body });
    if (error?.name === 'FunctionsFetchError' && RETRY_ON_NO_ANSWER.has(name)) {
      await new Promise((r) => setTimeout(r, 1200));
      ({ data, error } = await sb.functions.invoke(name, { body }));
    }
    if (!error) return data;
    if (error.name === 'FunctionsFetchError') {
      throw new Error(`Keine Antwort von der Edge Function „${name}“. Meist ein kurzer Aussetzer bei Supabase – bitte gleich noch einmal versuchen. `
        + `Bleibt es dabei: Werbeblocker für diese Seite ausschalten und in Supabase unter Edge Functions → ${name} → Logs nachsehen.`);
    }
    if (error.name === 'FunctionsRelayError') {
      throw new Error(`Supabase konnte die Edge Function „${name}“ gerade nicht erreichen. Bitte gleich noch einmal versuchen.`);
    }
    // Antwort mit Fehlercode: unsere Functions schicken {error}, Supabase selbst {message} oder {msg}
    let message = error.message;
    const status = error.context?.status;
    try {
      const j = await error.context.json();
      message = j.error ?? j.message ?? j.msg ?? message;
    } catch { /* keine JSON-Antwort */ }
    if (status === 404 && /not found/i.test(message)) message = `Function ${name} not found`;
    else if ([502, 503, 504, 546].includes(status) && message === error.message) {
      message = `Die Edge Function „${name}“ hat nicht rechtzeitig geantwortet (Status ${status}). Bitte gleich noch einmal versuchen; sonst in Supabase unter Edge Functions → ${name} → Logs nachsehen.`;
    }
    throw new Error(message);
  }

  return {
    demo: false,
    // Für die neueren Content-Ideen (js/extras-api.js)
    raw: { sb, unwrap, invoke },
    // authError: warum aus dem Rückweg vom Anbieter-Login keine Sitzung wurde
    // (sonst landet man ohne Hinweis wieder auf der Startseite)
    authError: '',
    async getUser() {
      const { error: initError } = await sb.auth.initialize();
      const { data, error } = await sb.auth.getSession();
      this.authError = (initError ?? error)?.message ?? '';
      return data.session?.user ?? null;
    },
    onAuthChange(cb) {
      sb.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
    },
    // captchaToken: Bot-Schutz (Cloudflare Turnstile), nur wenn in js/config.js eingerichtet
    async signIn(email, password, captchaToken) {
      unwrap(await sb.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : {} }));
    },
    async signUp(username, email, password, captchaToken) {
      const data = unwrap(await sb.auth.signUp({
        email,
        password,
        options: { data: { username }, emailRedirectTo: location.origin + location.pathname, ...(captchaToken ? { captchaToken } : {}) },
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
      try { sessionStorage.setItem('zd_oauth_login', provider); } catch { /* egal */ }
      location.href = data.url;
    },
    // Einmal-Code aus admin.html einlösen → echte Sitzung als StreamHelp-Admin
    async adminSiteLogin(tokenHash) {
      unwrap(await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' }));
    },
    async signOut() { await sb.auth.signOut(); },

    // ---------- Sicherheit (Migration …_security.sql) ----------
    // Zwei-Faktor-Anmeldung mit Authenticator-App (TOTP, eingebaut in Supabase Auth)
    async mfaStatus() {
      const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      const { data: f, error: e2 } = await sb.auth.mfa.listFactors();
      if (e2) throw e2;
      return { current: aal.currentLevel, next: aal.nextLevel, factors: (f?.totp ?? []).filter((x) => x.status === 'verified') };
    },
    async mfaEnroll() {
      // Nie bestätigte Versuche aufräumen – sonst lehnt Supabase einen neuen ab
      const { data: f } = await sb.auth.mfa.listFactors();
      for (const x of (f?.all ?? []).filter((x) => x.factor_type === 'totp' && x.status !== 'verified')) {
        await sb.auth.mfa.unenroll({ factorId: x.id });
      }
      const data = unwrap(await sb.auth.mfa.enroll({ factorType: 'totp', issuer: 'StreamHelp', friendlyName: `StreamHelp ${Date.now().toString(36)}` }));
      return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
    },
    async mfaVerify(factorId, code) {
      unwrap(await sb.auth.mfa.challengeAndVerify({ factorId, code }));
    },
    async mfaUnenroll(factorId) {
      unwrap(await sb.auth.mfa.unenroll({ factorId }));
      await sb.auth.refreshSession();
    },
    async mySessions() { return unwrap(await sb.rpc('my_sessions')); },
    async revokeSession(id) { return unwrap(await sb.rpc('session_revoke', { p_id: id })); },
    async signOutOthers() { unwrap(await sb.auth.signOut({ scope: 'others' })); },
    async modRights() { return unwrap(await sb.rpc('mod_rights_list')); },
    async setModRights(twitchUserId, denied) { return unwrap(await sb.rpc('mod_rights_set', { p_twitch_user_id: twitchUserId, p_denied: denied })); },
    async auditLog({ before = null, role = null, limit = 60 } = {}) {
      return unwrap(await sb.rpc('audit_list', { p_limit: limit, p_before: before, p_role: role }));
    },
    async channelExport() { return unwrap(await sb.rpc('channel_export')); },
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
    // Admins: alle Varianten auf einmal speichern (Reihenfolge = Position, fehlende werden gelöscht)
    async saveVariants(variants) {
      return unwrap(await sb.rpc('wheel_variants_save', { p_variants: variants }));
    },
    // Admins: Kosten der Glücksrad-Belohnung auf Twitch ändern
    async setWheelCost(cost) {
      return invoke('twitch-oauth', { action: 'wheel_cost', cost });
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
    // Overlay-Vorlagen (…_overlay_presets.sql); fehlt die Migration: null
    async getOverlayPresets() {
      const { data, error } = await sb.from('overlay_presets').select('id, name, params, updated_at').order('name');
      return error ? null : data;
    },
    async saveOverlayPreset(name, params) { return unwrap(await sb.rpc('overlay_preset_save', { p_name: name, p_params: params })); },
    async deleteOverlayPreset(id) { return unwrap(await sb.rpc('overlay_preset_delete', { p_id: id })); },
    // ---------- Kanäle (Plattform, Migration …_platform.sql) ----------
    // Kanal suchen (Twitch-Login oder ID, null = Standard-Kanal). {platform:false}, solange die Migration fehlt.
    async resolveChannel(key) {
      const { data, error } = await sb.rpc('channel_info', { p_key: key ?? null });
      if (error) {
        if (missingFunction(error)) return { platform: false, channel: null };
        throw error;
      }
      return { platform: true, channel: data };
    },
    // Alle freigeschalteten Kanäle (Startseite, Kanal wechseln)
    async channelsList() {
      const { data, error } = await sb.rpc('channels_list');
      return error ? [] : data ?? [];
    },
    // Zahlen für den Balken auf der Startseite (Summen über alle Kanäle); null = Migration fehlt
    async platformStats() {
      const { data, error } = await sb.rpc('platform_stats');
      if (error) { if (missingFunction(error)) return null; throw error; }
      return data && typeof data === 'object' && 'streamers' in data ? data : null;
    },
    // Mein eigener Kanal (auch wenn er noch auf die Freischaltung wartet) oder null
    async channelMine() {
      const { data, error } = await sb.rpc('channel_mine');
      return error ? null : data;
    },
    async channelApply(note = '') { return unwrap(await sb.rpc('channel_apply', { p_note: note })); },
    // Zuschauer oder Streamer? null = noch nie gefragt, 'unknown' = Migration fehlt (dann nicht fragen)
    async accountType() {
      const { data: session } = await sb.auth.getSession();
      const user = session.session?.user;
      if (!user) return 'unknown';
      const { data, error } = await sb.from('profiles').select('account_type').eq('id', user.id).maybeSingle();
      return error ? 'unknown' : data?.account_type ?? null;
    },
    async setAccountType(type) { unwrap(await sb.rpc('profile_set_type', { p_type: type })); },
    // Mit Twitch angemeldet? (Streamer brauchen das – so ist klar, dass der Kanal ihnen gehört)
    async hasTwitchLogin() {
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      return !!user?.identities?.some((i) => i.provider === 'twitch') || user?.app_metadata?.provider === 'twitch';
    },
    // ---------- Streamer und Mods ----------
    // Name des verbundenen Kanals – auch ohne Anmeldung (Anmeldeseite, Overlay)
    async streamerInfo() { return unwrap(await sb.rpc('streamer_info')); },
    // Meine Rechte: Admin (auch als freigegebener Mod), Mod, Streamer, Freigabe an?
    async myAccess() { return unwrap(await sb.rpc('my_access')); },
    async getMods() { return unwrap(await sb.from('channel_mods').select('*').order('display_name')); },
    async syncMods() { return invoke('twitch-oauth', { action: 'sync_mods' }); },
    async allowModsOverlay(on) { return unwrap(await sb.rpc('overlay_allow_mods', { p_on: on })); },
    async spin(variantId, announce) {
      return invoke('spin', { variant_id: variantId, announce });
    },

    // ---------- Ärgere den Streamer ----------
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
    // Kanal-Jubiläum (…_channel_anniversary.sql): die Edge Function sammelt die Kanaldaten
    async startAnniversary(start = '') { return invoke('stream-tools', { action: 'anniversary', start: start || undefined }); },
    onPrank(cb) {
      sb.channel('pranks-feed')
        .on('postgres_changes', rtSpec('pranks', 'INSERT'), (p) => cb(p.new))
        .subscribe();
    },
    soundUrl(path) {
      return `${CONFIG.SUPABASE_URL}/storage/v1/object/public/sounds/${path.split('/').map(encodeURIComponent).join('/')}`;
    },
    async getSounds() {
      const { data: session } = await sb.auth.getSession();
      const uid = session.session?.user?.id;
      // Nummern wie in der Edge Function (pranks.ts, soundList): 1–9 eingebaut, ab 10 der älteste eigene Sound
      const rows = unwrap(await sb.from('sounds')
        .select('id, name, path, duration, author, user_id, created_at')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(500));
      return rows.map((r, i) => ({ ...r, no: BOARD.length + 1 + i, mine: r.user_id === uid, url: this.soundUrl(r.path) })).reverse();
    },
    // Sounds mit eigener Belohnung auf Twitch (Migration …_sound_rewards.sql; fehlt sie: leer)
    async getSoundRewards() {
      const { data, error } = await sb.from('prank_sound_rewards').select('id, board, sound_id, enabled, cost, reward_id, error').order('id');
      if (error) return null;
      return data;
    },
    async setSoundReward(target, patch) {
      const col = target.board ? 'board' : 'sound_id';
      const key = target.board ?? target.sound_id;
      const { data: found } = await sb.from('prank_sound_rewards').select('id').eq(col, key).maybeSingle();
      if (found) {
        return unwrap(await sb.from('prank_sound_rewards').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', found.id).select('*').single());
      }
      return unwrap(await sb.from('prank_sound_rewards').insert({ [col]: key, ...patch }).select('*').single());
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
    // Bilder liegen im Storage (alte Karten können noch Lootpool-Adressen haben: ohne Bild)
    bingoUrl(path) {
      if (path.startsWith('https://')) return '';
      return `${CONFIG.SUPABASE_URL}/storage/v1/object/public/bingo/${path.split('/').map(encodeURIComponent).join('/')}`;
    },
    async getBingo() {
      const [items, card] = await Promise.all([
        sb.from('bingo_items').select('*').order('created_at'),
        sb.from('bingo_card').select('*').eq('id', 1).maybeSingle(),
      ]);
      return {
        items: unwrap(items).filter((i) => !i.path.startsWith('https://')).map((i) => ({ ...i, url: this.bingoUrl(i.path) })),
        card: unwrap(card),
      };
    },
    // rarities: ein Bild in mehreren Seltenheiten – ein Eintrag je Seltenheit, jeder mit eigener
    // Datei-Kopie (Löschen des einen nimmt das Bild der anderen nicht mit). Alle teilen den Fingerabdruck.
    async addBingoItem(blob, name, { rarity = null, amount = null, imageKey = null, rarities = null } = {}) {
      const ext = blob.type === 'image/webp' ? 'webp' : 'png';
      const path = `${storageFolder()}${crypto.randomUUID()}.${ext}`;
      unwrap(await sb.storage.from('bingo').upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false }));
      const list = rarities?.length ? rarities : [rarity];
      const first = await this.insertBingoItem({ name, path, rarity: list[0], amount, image_key: imageKey });
      const made = [first];
      for (const r of list.slice(1)) made.push(await this.copyBingoItem(first, { rarity: r }));
      return made;
    },
    // Dasselbe Bild noch einmal, z. B. mit anderer Zahl. Die Datei wird kopiert,
    // damit Löschen des einen Eintrags das Bild des anderen nicht mitnimmt.
    async copyBingoItem(item, patch = {}) {
      const path = `${storageFolder()}${crypto.randomUUID()}.${item.path.split('.').pop()}`;
      unwrap(await sb.storage.from('bingo').copy(item.path, path));
      return this.insertBingoItem({ name: item.name, path, rarity: item.rarity, amount: item.amount, image_key: item.image_key ?? null, ...patch });
    },
    async insertBingoItem({ name, path, rarity, amount, image_key = null }) {
      // Leere Felder nicht mitschicken – so klappt das Hochladen auch, solange einzelne
      // Migrationen (…_bingo_rarity.sql, …_bingo_amount.sql, …_bingo_vault.sql) noch fehlen.
      const row = { name, path, ...(rarity ? { rarity } : {}), ...(amount ? { amount } : {}), ...(image_key ? { image_key } : {}) };
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
    // ---------- Games (Migration …_games.sql) – null, solange die Migration fehlt ----------
    async getStreamGames() {
      const { data, error } = await sb.from('stream_games').select('active, current, auto, live_category, live_game, live_at').eq('id', 1).maybeSingle();
      return error ? null : data ?? {};
    },
    async saveStreamGames({ active, current, auto }) {
      return unwrap(await sb.rpc('games_save', { p_active: active, p_current: current ?? '', p_auto: !!auto }));
    },
    onStreamGames(cb) {
      sb.channel('stream-games')
        .on('postgres_changes', rtSpec('stream_games', '*'), (p) => { if (p.new) cb(p.new); })
        .subscribe();
    },
    onBingo(cb) {
      sb.channel('bingo-feed')
        .on('postgres_changes', rtSpec('bingo_card', '*'), (p) => cb(p.new))
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
        .on('postgres_changes', rtSpec('questions', '*'), (p) => cb(p))
        .subscribe();
    },
    onQuestionStage(cb) {
      sb.channel('question-stage')
        .on('postgres_changes', rtSpec('question_stage', 'UPDATE'), (p) => cb(p.new))
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
    // Gelesen wird über Funktionen (Migration …_shop_lobby_access.sql): per Code für alle
    // Angemeldeten, per ID nur für Ersteller, Mitspieler und Admins
    async getShopLobby(code) {
      return unwrap(await sb.rpc('shop_lobby_by_code', { p_code: code.trim() }).maybeSingle());
    },
    async getShopLobbyById(id) {
      return unwrap(await sb.rpc('shop_lobby_by_id', { p_id: id }).maybeSingle());
    },
    async getLobbyRuns(lobbyId) {
      return unwrap(await sb.from('shop_runs').select('*').eq('lobby_id', lobbyId).order('score', { ascending: false }));
    },
    onShopRuns(cb) {
      sb.channel('shop-runs')
        .on('postgres_changes', rtSpec('shop_runs', '*'), (p) => cb(p.eventType === 'DELETE' ? null : p.new))
        .subscribe();
    },
    // ---------- Win-Challenge ----------
    async getChallenge() { return unwrap(await sb.from('win_challenge').select('*').eq('id', 1).maybeSingle()); },
    async challengeAccess() { return unwrap(await sb.rpc('challenge_access')); },
    async saveChallenge({ title, lives, stages }) {
      return unwrap(await sb.rpc('challenge_save', { p_title: title, p_lives: lives, p_stages: stages }));
    },
    async challengeResult(win) { return unwrap(await sb.rpc('challenge_result', { p_win: win })); },
    async challengeUndo() { return unwrap(await sb.rpc('challenge_undo')); },
    async challengeGoto(index) { return unwrap(await sb.rpc('challenge_goto', { p_index: index })); },
    async challengeReset() { return unwrap(await sb.rpc('challenge_reset')); },
    async challengeAllowAdmins(on) { return unwrap(await sb.rpc('challenge_allow_admins', { p_on: on })); },
    // Namen der Admins (Mods) – als Vorschläge für die Gegner
    async getModNames() {
      return (unwrap(await sb.from('profiles').select('username').eq('is_admin', true).order('username')) ?? []).map((p) => p.username);
    },
    onChallenge(cb) {
      sb.channel('win-challenge')
        .on('postgres_changes', rtSpec('win_challenge', 'UPDATE'), (p) => cb(p.new))
        .subscribe();
    },
    // ---------- Laufband im Overlay ----------
    async getTicker() {
      return unwrap(await sb.from('ticker').select('items').eq('id', 1).maybeSingle())?.items ?? null;
    },
    async saveTicker(items) {
      return unwrap(await sb.from('ticker').update({ items }).eq('id', 1).select('items').single()).items;
    },
    // ---------- Stream-Dino ----------
    async getPet() {
      return unwrap(await sb.from('pet').select('*').eq('id', 1).maybeSingle());
    },
    async getPetEvents(limit = 20) {
      return unwrap(await sb.from('pet_events').select('*').order('created_at', { ascending: false }).limit(limit));
    },
    async petAction(kind) { return unwrap(await sb.rpc('pet_action', { p_kind: kind })); },
    async petSay(text) { return unwrap(await sb.rpc('pet_say', { p_text: text })); },
    // Heißhunger per Knopf (on = false beendet ihn) und Kostüm wechseln – nur Admins
    async petFrenzy(on = true) { return unwrap(await sb.rpc('pet_frenzy', { p_on: on })); },
    async petCostume(costume) { return unwrap(await sb.rpc('pet_costume', { p_costume: costume })); },
    async updatePet(patch) {
      return unwrap(await sb.from('pet').update(patch).eq('id', 1).select('*').single());
    },
    onPet(cb) {
      sb.channel('pet-feed')
        .on('postgres_changes', rtSpec('pet', 'UPDATE'), (p) => cb(p.new))
        .subscribe();
    },
    onPetEvents(cb) {
      sb.channel('pet-events')
        .on('postgres_changes', rtSpec('pet_events', 'INSERT'), (p) => cb(p.new))
        .subscribe();
    },
    onSpin(cb) {
      sb.channel('spins-feed')
        .on('postgres_changes', rtSpec('spins', 'INSERT'), (p) => cb(p.new))
        .subscribe();
    },
    // ---------- Alerts im Overlay (Follower, Abos) ----------
    async getAlerts(limit = 10) {
      return unwrap(await sb.from('stream_alerts').select('*').order('created_at', { ascending: false }).limit(limit));
    },
    onAlerts(cb) {
      sb.channel('stream-alerts')
        .on('postgres_changes', rtSpec('stream_alerts', 'INSERT'), (p) => cb(p.new))
        .subscribe();
    },
    async testAlert(kind) { return unwrap(await sb.rpc('alert_test', { p_kind: kind })); },
    async alertsStatus() { return unwrap(await sb.rpc('alerts_status')); },
    // Twitch-Abos für die Alerts prüfen und fehlende neu anlegen (nur Admins)
    async checkAlertSubscriptions() { return invoke('twitch-oauth', { action: 'alerts_check' }); },
    // Gesundheitscheck (Migration …_streamhelp.sql): Rechte, Abos, Bot – repariert, was geht.
    // Ohne force höchstens einmal pro Minute wirklich bei Twitch (sonst letzter Stand).
    async twitchHealth(force = false) { return invoke('twitch-oauth', { action: 'health', force }); },
    async getTwitchHealth() {
      const { data, error } = await sb.from('twitch_health').select('*').eq('id', 1).maybeSingle();
      if (error) { console.warn('twitch_health:', error.message); return null; }
      return data;
    },
    onTwitchHealth(cb) {
      sb.channel('twitch-health')
        .on('postgres_changes', rtSpec('twitch_health', '*'), (p) => cb(p.new))
        .subscribe();
    },
    // Eigene Alert-Sounds (nur Admins laden hoch), Bucket "alert-sounds"
    alertSoundUrl(path) {
      return `${CONFIG.SUPABASE_URL}/storage/v1/object/public/alert-sounds/${path.split('/').map(encodeURIComponent).join('/')}`;
    },
    async getAlertSounds() {
      const rows = unwrap(await sb.from('alert_sounds').select('id, name, path, duration, created_at').order('created_at', { ascending: false }));
      return rows.map((r) => ({ ...r, url: this.alertSoundUrl(r.path) }));
    },
    async uploadAlertSound(file, name, duration) {
      const ext = (/\.([a-z0-9]{2,4})$/i.exec(file.name)?.[1] ?? 'mp3').toLowerCase();
      const path = `${storageFolder()}${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from('alert-sounds').upload(path, file, {
        contentType: file.type || 'audio/mpeg',
        cacheControl: '31536000',
        upsert: false,
      });
      // „Bucket not found“ hieße sonst „Ärgern fehlt“
      if (up.error && /bucket not found/i.test(up.error.message)) throw new Error('relation "public.alert_sounds" does not exist');
      unwrap(up);
      const { data, error } = await sb.from('alert_sounds')
        .insert({ name, path, duration })
        .select('id, name, path, duration, created_at')
        .single();
      if (error) {
        await sb.storage.from('alert-sounds').remove([path]).catch(() => {});
        throw error;
      }
      return { ...data, url: this.alertSoundUrl(path) };
    },
    async deleteAlertSound(sound) {
      unwrap(await sb.from('alert_sounds').delete().eq('id', sound.id));
      const { error } = await sb.storage.from('alert-sounds').remove([sound.path]);
      if (error) console.warn('Alert-Sound-Datei nicht gelöscht:', error);
    },
    // Alert-Designer (Migration …_overlay_designs.sql)
    async getAlertConfig() {
      return (unwrap(await sb.from('alert_config').select('config').eq('id', 1).maybeSingle()))?.config ?? {};
    },
    async saveAlertConfig(config) {
      const rows = unwrap(await sb.from('alert_config').update({ config, updated_at: new Date().toISOString() }).eq('id', 1).select('id'));
      if (!rows?.length) throw new Error('Nur der Streamer, Admins und freigegebene Mods dürfen die Alerts gestalten.');
    },
    alertMediaUrl(path) {
      return `${CONFIG.SUPABASE_URL}/storage/v1/object/public/alert-media/${path.split('/').map(encodeURIComponent).join('/')}`;
    },
    async getAlertMedia() {
      const rows = unwrap(await sb.from('alert_media').select('id, name, path, kind, created_at').order('created_at', { ascending: false }));
      return rows.map((r) => ({ ...r, url: this.alertMediaUrl(r.path) }));
    },
    async uploadAlertMedia(file, name) {
      const ext = (/\.([a-z0-9]{2,4})$/i.exec(file.name)?.[1] ?? '').toLowerCase().replace('jpeg', 'jpg');
      const kind = /^video\//.test(file.type) ? 'video' : 'image';
      const path = `${storageFolder()}${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from('alert-media').upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
      if (up.error && /bucket not found/i.test(up.error.message)) throw new Error('relation "public.alert_media" does not exist');
      unwrap(up);
      const { data, error } = await sb.from('alert_media').insert({ name, path, kind }).select('id, name, path, kind, created_at').single();
      if (error) {
        await sb.storage.from('alert-media').remove([path]).catch(() => {});
        throw error;
      }
      return { ...data, url: this.alertMediaUrl(path) };
    },
    async deleteAlertMedia(media) {
      unwrap(await sb.from('alert_media').delete().eq('id', media.id));
      const { error } = await sb.storage.from('alert-media').remove([media.path]);
      if (error) console.warn('Alert-Datei nicht gelöscht:', error);
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
    // Eigene Chat-Befehle und Watchtime (Migration …_chat_bot_commands.sql)
    botCommands: {
      list: async () => unwrap(await sb.from('bot_commands').select('*').order('command')),
      async save(c) {
        const row = { command: c.command, response: c.response, enabled: c.enabled, mod_only: c.mod_only, cooldown_seconds: c.cooldown_seconds };
        if (c.id) return unwrap(await sb.from('bot_commands').update({ ...row, updated_at: new Date().toISOString() }).eq('id', c.id).select('*').single());
        return unwrap(await sb.from('bot_commands').insert(row).select('*').single());
      },
      remove: async (id) => unwrap(await sb.from('bot_commands').delete().eq('id', id)),
    },
    async watchTop(limit = 10) { return unwrap(await sb.rpc('watch_top', { p_limit: limit })); },
    async watchState() { return unwrap(await sb.from('watch_state').select('*').eq('id', 1).maybeSingle()); },
    // Chat-Bot-Konto (Streamer, Admins, freigegebene Mods)
    async botConnect() {
      const { url } = await invoke('twitch-oauth', { action: 'bot_start' });
      location.href = url;
    },
    async botDisconnect() { return invoke('twitch-oauth', { action: 'bot_disconnect' }); },
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
    // Zweites Rad (z. B. Seltenheit beim Waffen-Lotto)
    if (variant.bonus?.segments?.length) {
      const b = randomInt(variant.bonus.segments.length);
      Object.assign(spin, {
        bonus_name: variant.bonus.name, bonus_index: b,
        bonus_result: variant.bonus.segments[b].label, bonus_detail: variant.bonus.segments[b].detail ?? '',
      });
    }
    store.set('spins', [spin, ...store.get('spins', [])].slice(0, 30));
    return spin;
  }

  const demoVariants = () => store.get('wheel_variants', null) ?? DEFAULT_VARIANTS;
  // Gespeicherte Kacheln plus neue Standard-Kacheln (neue Content-Ideen kommen so auch in alte Demos)
  function demoTiles() {
    const saved = store.get('tiles', null);
    if (!saved) return DEFAULT_TILES;
    const missing = DEFAULT_TILES.filter((d) => !saved.some((t) => t.id === d.id));
    return missing.length ? [...saved, ...missing].sort((a, b) => a.position - b.position) : saved;
  }
  // Dieselben Regeln wie wheel_variants_save in der Datenbank
  function cleanVariants(variants) {
    if (!Array.isArray(variants) || !variants.length) throw new Error('Mindestens eine Variante wird gebraucht.');
    if (variants.length > 8) throw new Error('Höchstens 8 Varianten.');
    const ids = new Set();
    return variants.map((v, i) => {
      const id = String(v.id ?? '').trim() || `v-${(nextId++).toString(36)}`;
      if (ids.has(id)) throw new Error('Eine Variante ist doppelt.');
      ids.add(id);
      const name = String(v.name ?? '').trim();
      if (!name || name.length > 40) throw new Error('Jede Variante braucht einen Namen (höchstens 40 Zeichen).');
      const description = String(v.description ?? '').trim();
      if (description.length > 160) throw new Error('Die Beschreibung ist zu lang (höchstens 160 Zeichen).');
      if (!/^#[0-9a-f]{6}$/i.test(v.color ?? '')) throw new Error('Ungültige Farbe.');
      const segs = Array.isArray(v.segments) ? v.segments : [];
      if (segs.length < 2 || segs.length > 16) throw new Error('Jede Variante braucht 2 bis 16 Ergebnisse.');
      const segments = segs.map((s) => {
        const label = String(s.label ?? '').trim();
        const detail = String(s.detail ?? '').trim();
        if (!label || label.length > 32) throw new Error('Jedes Ergebnis braucht einen Titel (höchstens 32 Zeichen).');
        if (detail.length > 200) throw new Error('Eine Erklärung ist zu lang (höchstens 200 Zeichen).');
        return { label, detail };
      });
      let bonus = null;
      if (v.bonus) {
        const bname = String(v.bonus.name ?? '').trim();
        if (!bname || bname.length > 40) throw new Error('Das zweite Rad braucht einen Namen (höchstens 40 Zeichen).');
        const bsegs = Array.isArray(v.bonus.segments) ? v.bonus.segments : [];
        if (bsegs.length < 2 || bsegs.length > 16) throw new Error('Das zweite Rad braucht 2 bis 16 Ergebnisse.');
        bonus = {
          name: bname,
          segments: bsegs.map((s) => {
            const label = String(s.label ?? '').trim();
            const detail = String(s.detail ?? '').trim();
            if (!label || label.length > 32) throw new Error('Jedes Ergebnis im zweiten Rad braucht einen Titel (höchstens 32 Zeichen).');
            if (detail.length > 200) throw new Error('Eine Erklärung ist zu lang (höchstens 200 Zeichen).');
            if (s.color && !/^#[0-9a-f]{6}$/i.test(s.color)) throw new Error('Ungültige Farbe im zweiten Rad.');
            return { label, detail, ...(s.color ? { color: s.color.toLowerCase() } : {}) };
          }),
        };
      }
      return { id, position: i + 1, name, description, color: v.color.toLowerCase(), segments, bonus };
    });
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
  async function changeChallenge(fn) {
    await requireAdmin();
    const ch = { ...DEFAULT_CHALLENGE, ...store.get('win_challenge', {}) };
    const next = { ...fn(ch, store.get('users', {})[current.email]?.username ?? ''), updated_at: new Date().toISOString() };
    store.set('win_challenge', next);
    emitDemo('win_challenge', next);
    return next;
  }
  function addPetEvent(ev) {
    const row = { id: nextId++, created_at: new Date().toISOString(), ...ev };
    store.set('pet_events', [row, ...store.get('pet_events', [])].slice(0, 40));
    emitDemo('pet_events', row);
    return row;
  }

  // Beispiel-Kanäle für die Demo (Plattform)
  function demoChannels() {
    return store.get('channels', null) ?? [
      { id: 'demo-default', login: (CONFIG.CHANNEL || 'streamhelp').toLowerCase(), display_name: CONFIG.CHANNEL || 'StreamHelp', avatar_url: '', status: 'active', is_default: true },
      { id: 'demo-retro', login: 'retrolena', display_name: 'RetroLena', avatar_url: '', status: 'active', is_default: false },
    ];
  }
  function demoChannelPublic(c) {
    return { id: c.id, login: c.login, display_name: c.display_name, avatar_url: c.avatar_url ?? '', is_default: !!c.is_default,
      status: c.status, is_owner: !!c.owner && c.owner === current?.email };
  }

  const sessionEmail = store.get('session', null);
  const users = store.get('users', {});
  if (sessionEmail && users[sessionEmail]) current = { id: sessionEmail, email: sessionEmail };

  return {
    demo: true,
    // Für die neueren Content-Ideen (js/extras-api.js)
    raw: {
      store,
      me: () => current,
      name: () => store.get('users', {})[current?.email]?.username ?? current?.email ?? 'Zuschauer',
      isAdmin: () => isAdminNow(),
      requireAdmin,
    },
    async getUser() { return current; },
    onAuthChange(cb) { listeners.push(cb); },
    async signIn(email, password) {
      const u = store.get('users', {})[email.toLowerCase()];
      if (!u || u.pass !== await hash(password)) throw new Error('E-Mail oder Passwort ist falsch.');
      current = { id: email.toLowerCase(), email: email.toLowerCase() };
      store.set('session', current.email);
      store.set('session_aal', 'aal1');
      store.set('session_at', new Date().toISOString());
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
      store.set('session_aal', 'aal1');
      emit();
    },

    // ---------- Sicherheit (Demo): Der Zwei-Faktor-Code ist hier immer 123456 ----------
    async mfaStatus() {
      const f = store.get(`mfa_${current?.email}`, null);
      const factors = f?.verified ? [{ id: f.id, factor_type: 'totp', status: 'verified', created_at: f.created_at }] : [];
      const aal = factors.length && store.get('session_aal', 'aal1') === 'aal2' ? 'aal2' : 'aal1';
      return { current: aal, next: factors.length ? 'aal2' : 'aal1', factors, demo: true };
    },
    async mfaEnroll() {
      if (!current) throw new Error('Bitte zuerst anmelden.');
      const f = { id: `demo-${Date.now().toString(36)}`, verified: false, created_at: new Date().toISOString() };
      store.set(`mfa_${current.email}`, f);
      return { id: f.id, qr: '', secret: 'DEMO MODE CODE 123456', demo: true };
    },
    async mfaVerify(factorId, code) {
      const f = store.get(`mfa_${current?.email}`, null);
      if (!f || f.id !== factorId) throw new Error('Bitte die Einrichtung neu starten.');
      if (String(code ?? '').replace(/\s+/g, '') !== '123456') throw new Error('Der Code passt nicht. (Demo: 123456)');
      store.set(`mfa_${current.email}`, { ...f, verified: true });
      store.set('session_aal', 'aal2');
    },
    async mfaUnenroll() { store.set(`mfa_${current?.email}`, null); },
    async mySessions() {
      const aal = store.get('session_aal', 'aal1');
      const others = store.get('demo_sessions', [
        { id: 'demo-phone', created_at: new Date(Date.now() - 3 * 86400_000).toISOString(), last_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
          user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari', ip: '84.150.12.7', aal: 'aal1' },
      ]);
      return [{ id: 'demo-this', created_at: store.get('session_at', new Date().toISOString()), last_at: new Date().toISOString(),
        user_agent: navigator.userAgent, ip: '', aal, current: true }, ...others.map((x) => ({ ...x, current: false }))];
    },
    async revokeSession(id) {
      const list = (await this.mySessions()).filter((x) => !x.current && x.id !== id);
      store.set('demo_sessions', list);
      return true;
    },
    async signOutOthers() { store.set('demo_sessions', []); },
    async modRights() {
      const denied = store.get('mod_rights', {});
      return (await this.getMods()).map((m) => ({ ...m, denied: denied[m.twitch_user_id] ?? [] }));
    },
    async setModRights(twitchUserId, list) {
      await requireAdmin();
      const all = store.get('mod_rights', {});
      all[twitchUserId] = [...new Set(list)].sort();
      store.set('mod_rights', all);
      const log = store.get('audit_log', []);
      log.unshift({ id: Date.now(), at: new Date().toISOString(), actor_name: store.get('users', {})[current.email]?.username ?? '', role: 'owner',
        action: 'mod_rights_set', tables: ['mod_rights'], ops: ['update'], detail: {} });
      store.set('audit_log', log.slice(0, 100));
      return { twitch_user_id: twitchUserId, denied: all[twitchUserId] };
    },
    async auditLog({ before = null, role = null } = {}) {
      await requireAdmin();
      const ago = (m) => new Date(Date.now() - m * 60_000).toISOString();
      const sample = [
        { id: 5, at: ago(12), actor_name: 'Lena_Mod', role: 'mod', action: 'giveaway_draw', tables: ['giveaway', 'giveaway_winners'], ops: ['update', 'insert'], detail: {} },
        { id: 4, at: ago(35), actor_name: 'Lena_Mod', role: 'mod', action: 'site_guard_set', tables: ['site_guard'], ops: ['update'], detail: {} },
        { id: 3, at: ago(80), actor_name: 'Kai_Mod', role: 'mod', action: 'wheel_cost', tables: [], ops: [], detail: { cost: 500 } },
        { id: 2, at: ago(240), actor_name: 'Kai_Mod', role: 'mod', action: 'bingo_new_card', tables: ['bingo_card'], ops: ['update'], detail: {} },
        { id: 1, at: ago(1500), actor_name: 'Du', role: 'owner', action: 'overlay_save', tables: ['overlay_config'], ops: ['update'], detail: {} },
      ];
      return [...store.get('audit_log', []), ...sample]
        .filter((x) => (before === null || x.id < before) && (!role || x.role === role));
    },
    async channelExport() {
      await requireAdmin();
      const tables = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith('zd_') || ['zd_users', 'zd_session', 'zd_session_aal'].includes(k)) continue;
        try { tables[k.slice(3)] = JSON.parse(localStorage.getItem(k)); } catch { /* egal */ }
      }
      return { format: 'streamhelp-export-1', exported_at: new Date().toISOString(), channel: { login: 'demo', display_name: 'Demo' }, tables };
    },
    async getProfile(user) {
      const u = store.get('users', {})[user.email] ?? {};
      return { username: u.username ?? user.email, is_admin: !!u.is_admin };
    },
    async getTiles() { return demoTiles(); },
    async updateTile(id, patch) {
      const tiles = demoTiles().map((t) => (t.id === id ? { ...t, ...patch } : t));
      store.set('tiles', tiles);
      return tiles.find((t) => t.id === id);
    },
    async getVariants() { return demoVariants(); },
    async saveVariants(variants) {
      await requireAdmin();
      const list = cleanVariants(variants);
      store.set('wheel_variants', list);
      return list;
    },
    async setWheelCost(cost) {
      await requireAdmin();
      const n = Math.round(Number(cost));
      if (!Number.isFinite(n) || n < 1 || n > 1000000) throw new Error('Die Kosten müssen zwischen 1 und 1.000.000 Kanalpunkten liegen.');
      store.set('wheel_cost', n);
      return { cost: n, title: 'Glücksrad' };
    },
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
    // Demo: Admins gelten als Streamer
    async getOverlayConfig() { return { params: '', admins_can_edit: false, updated_by: '', ...store.get('overlay_config', {}) }; },
    async overlayAccess() {
      const admin = isAdminNow();
      const cfg = store.get('overlay_config', {});
      return { can_edit: admin, is_owner: admin, admins_can_edit: !!cfg.admins_can_edit, mods_enabled: !!cfg.mods_enabled, is_mod: false };
    },
    async getOverlayPresets() { return [...store.get('overlay_presets', [])].sort((x, y) => x.name.localeCompare(y.name)); },
    async saveOverlayPreset(name, params) {
      if (!isAdminNow()) throw new Error('Vorlagen speichern darf nur, wer das Overlay anpassen darf.');
      const n = String(name ?? '').trim();
      if (!n || n.length > 40) throw new Error('Bitte einen Namen mit 1–40 Zeichen.');
      const list = store.get('overlay_presets', []);
      const old = list.find((x) => x.name.toLowerCase() === n.toLowerCase());
      if (old) Object.assign(old, { params, updated_at: new Date().toISOString() });
      else {
        if (list.length >= 50) throw new Error('Höchstens 50 Vorlagen – lösch erst eine alte.');
        list.push({ id: Date.now(), name: n, params, updated_at: new Date().toISOString() });
      }
      store.set('overlay_presets', list);
      return old ?? list[list.length - 1];
    },
    async deleteOverlayPreset(id) { store.set('overlay_presets', store.get('overlay_presets', []).filter((x) => x.id !== id)); },
    // ---------- Kanäle (Demo: zwei Beispiel-Kanäle, Bewerbungen bleiben im Browser) ----------
    async resolveChannel(key) {
      const k = String(key ?? '').toLowerCase();
      const mine = demoChannels().find((c) => c.owner === current?.email);
      const list = demoChannels().filter((c) => c.status === 'active' || c === mine);
      const c = k ? list.find((x) => x.id === k || x.login === k) : list.find((x) => x.is_default);
      return { platform: true, channel: c ? demoChannelPublic(c) : null };
    },
    async channelsList() { return demoChannels().filter((c) => c.status === 'active').map(demoChannelPublic); },
    // Beispielzahlen, die langsam weiterwachsen (plus was im Demo-Modus selbst passiert ist)
    async platformStats() {
      const k = Math.max(0, (Date.now() - Date.UTC(2026, 9, 1)) / 60000);
      const grow = (base, every) => base + Math.floor(k / every);
      const today = (list) => list.filter((x) => new Date(x.created_at).toDateString() === new Date().toDateString()).length;
      const spins = store.get('spins', []);
      const pranks = store.get('pranks', []);
      const alerts = store.get('stream_alerts', []).filter((a) => !a.test);
      const streamers = demoChannels().filter((c) => c.status === 'active').length;
      const live = Math.min(streamers, 1 + Math.floor(k / 7) % 3);
      return {
        streamers,
        live, viewers_now: live * 37 + Math.floor(k) % 23,
        watch_hours: grow(1840, 3), viewers_total: grow(612, 40),
        spins: grow(1284, 7) + spins.length, spins_today: 18 + Math.floor(k / 7) % 40 + today(spins),
        pranks: grow(731, 11) + pranks.length, pranks_today: 9 + Math.floor(k / 11) % 25 + today(pranks),
        questions: grow(214, 60) + store.get('questions', []).length, ideas: store.get('ideas', DEFAULT_IDEAS).length + 40,
        winners: grow(37, 900), alerts: grow(2650, 5) + alerts.length, alerts_today: 31 + Math.floor(k / 5) % 60 + today(alerts),
        pet_moments: grow(3920, 2) + store.get('pet_events', []).length, tts: grow(402, 30), cards: grow(1555, 9),
        quiz_answers: grow(980, 15), hotwords: grow(5230, 1), players: grow(148, 120),
        at: new Date().toISOString(),
      };
    },
    async channelMine() {
      const c = demoChannels().find((x) => x.owner && x.owner === current?.email);
      return c ? { ...demoChannelPublic(c), note: c.note ?? '', admin_note: '', created_at: c.created_at } : null;
    },
    async channelApply(note = '') {
      if (!current) throw new Error('Bitte zuerst anmelden.');
      const list = demoChannels();
      if (!list.some((c) => c.owner === current.email)) {
        const name = (store.get('users', {})[current.email]?.username ?? 'streamer').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25) || 'streamer';
        list.push({ id: `demo-${Date.now()}`, login: name, display_name: store.get('users', {})[current.email]?.username ?? name, avatar_url: '',
          status: 'pending', is_default: false, owner: current.email, note, created_at: new Date().toISOString() });
        store.set('channels', list);
      }
      store.set(`account_type_${current.email}`, 'streamer');
      return this.channelMine();
    },
    async accountType() { return current ? store.get(`account_type_${current.email}`, null) : 'unknown'; },
    async setAccountType(type) { if (current) store.set(`account_type_${current.email}`, type); },
    async hasTwitchLogin() { return true; }, // Demo: so tun, als wäre es ein Twitch-Konto
    // Demo: kein Twitch – der Streamer heißt wie der Kanal in js/config.js
    async streamerInfo() { return { connected: false, login: CONFIG.CHANNEL, name: CONFIG.CHANNEL || 'Streamer' }; },
    async myAccess() {
      const admin = isAdminNow();
      const cfg = store.get('overlay_config', {});
      return { is_admin: admin, is_site_admin: admin, is_owner: admin, is_mod: false, is_twitch_mod: false, mods_enabled: !!cfg.mods_enabled, mods_scope: false, mods_count: 0 };
    },
    // Zwei Beispiel-Mods, damit sich Mod-Rechte und Protokoll ausprobieren lassen
    async getMods() {
      return [
        { twitch_user_id: '1001', login: 'kai_mod', display_name: 'Kai_Mod' },
        { twitch_user_id: '1002', login: 'lena_mod', display_name: 'Lena_Mod' },
      ];
    },
    async syncMods() { await requireAdmin(); return { missing_scope: true, count: 0 }; },
    async allowModsOverlay(on) {
      await requireAdmin();
      const next = { ...store.get('overlay_config', {}), mods_enabled: !!on };
      store.set('overlay_config', next);
      return next;
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

    // ---------- Ärgere den Streamer (Demo) ----------
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
      if (!profile.is_admin) throw new Error('„Ärgere den Streamer“ geht über Kanalpunkte im Twitch-Chat.');
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
    // Demo: Beispieldaten statt Twitch – Name aus js/config.js, Kacheln und Watchtime aus dem Browser
    async startAnniversary(start = '') {
      const profile = await this.getProfile(current);
      if (!profile.is_admin) throw new Error('Das Kanal-Jubiläum starten nur der Streamer, Admins und freigegebene Mods.');
      const name = CONFIG.CHANNEL || 'DeinKanal';
      const since = /^\d{4}-\d{2}-\d{2}$/.test(start) ? new Date(`${start}T12:00:00Z`) : new Date(Date.now() - 366 * 864e5);
      const tiles = (await this.getTiles()).filter((t) => t.kind !== 'countdown').slice(0, 8);
      const next = (await this.getTiles()).filter((t) => t.target_at && Date.parse(t.target_at) > Date.now())
        .sort((a, b) => Date.parse(a.target_at) - Date.parse(b.target_at))[0];
      const data = {
        v: 1, name, login: name.toLowerCase(), avatar: '', since: since.toISOString(), since_kind: start ? 'custom' : 'twitch',
        title: 'Heute: Jubiläums-Stream', game: 'Fortnite', followers: 1284, watch_hours: 612, chatters: 318, bits: 25400, subs: 96,
        content_count: tiles.length, content: tiles.map((t) => ({ title: t.title, text: t.description })),
        mods: ['PixelPaul', 'GG_Gina', 'LootLukas'], top: [{ name: 'NightOwl_Mia', hours: 84.5 }, { name: 'CrispyCarl', hours: 61 }, { name: 'StreamSofia', hours: 40.2 }],
        next: next ? { title: next.title, at: next.target_at } : null,
      };
      const prank = { id: nextId++, created_at: new Date().toISOString(), kind: 'show', item: 'anniversary', label: '', sound_path: null, requested_by: profile.username, data };
      store.set('pranks', [prank, ...store.get('pranks', [])].slice(0, 30));
      setTimeout(() => prankListeners.forEach((cb) => cb(prank)), 50);
      return prank;
    },
    onPrank(cb) { prankListeners.push(cb); },
    soundUrl(path) { return store.get('sounds', []).find((x) => x.path === path)?.url ?? ''; },
    async getSounds() {
      const all = store.get('sounds', []);
      return all.map((x, i) => ({ ...x, no: BOARD.length + all.length - i, mine: x.user_id === current?.email }));
    },
    async getSoundRewards() { return store.get('sound_rewards', []); },
    async setSoundReward(target, patch) {
      const list = store.get('sound_rewards', []);
      const key = target.board ? 'board' : 'sound_id';
      let row = list.find((r) => r[key] === (target.board ?? target.sound_id));
      if (patch.enabled && !row?.enabled && list.filter((r) => r.enabled).length >= 20) {
        throw new Error('Höchstens 20 Sounds mit eigener Belohnung – Twitch erlaubt nur 50 Belohnungen pro Kanal. Schalte erst einen anderen aus.');
      }
      if (row) Object.assign(row, patch);
      else list.push(row = { id: nextId++, board: target.board ?? null, sound_id: target.sound_id ?? null, enabled: true, cost: 300, reward_id: null, error: '', ...patch });
      store.set('sound_rewards', list);
      return row;
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
      store.set('sound_rewards', store.get('sound_rewards', []).filter((r) => r.sound_id !== sound.id));
    },

    // ---------- Fortnite-Bingo (Demo) ----------
    // Bilder liegen als data:-URL in zd_bingo_items, die Karte in zd_bingo_card.
    bingoUrl(path) {
      return store.get('bingo_items', []).find((i) => i.path === path)?.url ?? '';
    },
    async getBingo() {
      return {
        items: store.get('bingo_items', []).filter((i) => i.source !== 'lootpool' && !i.path?.startsWith('https://')),
        card: store.get('bingo_card', null),
      };
    },
    async addBingoItem(blob, name, { rarity = null, amount = null, imageKey = null, rarities = null } = {}) {
      await requireAdmin();
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
        reader.readAsDataURL(blob);
      });
      const list = rarities?.length ? rarities : [rarity];
      const made = [];
      for (const r of list) made.push(await this.insertBingoItem({ name, rarity: r, amount, url, image_key: imageKey }));
      return made;
    },
    async copyBingoItem(item, patch = {}) {
      await requireAdmin();
      return this.insertBingoItem({ name: item.name, rarity: item.rarity, amount: item.amount, url: item.url, image_key: item.image_key ?? null, ...patch });
    },
    async insertBingoItem({ name, rarity = null, amount = null, url, image_key = null }) {
      const id = `demo-${nextId++}`;
      const item = { id, name, rarity, amount, path: `demo/${id}`, url, image_key, vault: false, created_at: new Date().toISOString() };
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
      const { cells, marked } = drawCard(await this.getBingo().then((b) => b.items), size, free);
      return saveCard({ id: 1, size, cells, marked, visible: true, created_at: new Date().toISOString() });
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
    // ---------- Games (Demo) ----------
    async getStreamGames() { return store.get('stream_games', {}); },
    async saveStreamGames({ active, current, auto }) {
      await requireAdmin();
      const next = { ...store.get('stream_games', {}), active: [...new Set(active)], current: current ?? '', auto: !!auto };
      store.set('stream_games', next);
      emitDemo('stream_games', next);
      return next;
    },
    onStreamGames(cb) { (demoListeners.stream_games ??= []).push(cb); },
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
    // ---------- Win-Challenge (Demo: Admins gelten als Streamer) ----------
    async getChallenge() { return { ...DEFAULT_CHALLENGE, ...store.get('win_challenge', {}) }; },
    async challengeAccess() {
      const admin = isAdminNow();
      return { can_edit: admin, is_owner: admin, admins_can_edit: !!store.get('win_challenge', {}).admins_can_edit };
    },
    async saveChallenge(patch) { return changeChallenge((ch, by) => saveChallenge(ch, patch, by)); },
    async challengeResult(win) { return changeChallenge((ch, by) => applyResult(ch, win, by)); },
    async challengeUndo() { return changeChallenge((ch, by) => undoChallenge(ch, by)); },
    async challengeGoto(index) { return changeChallenge((ch, by) => gotoStage(ch, index, by)); },
    async challengeReset() { return changeChallenge((ch, by) => resetChallenge(ch, by)); },
    async challengeAllowAdmins(on) { return changeChallenge((ch) => ({ ...ch, admins_can_edit: !!on })); },
    async getModNames() { return Object.values(store.get('users', {})).filter((u) => u.is_admin).map((u) => u.username).sort(); },
    onChallenge(cb) { (demoListeners.win_challenge ??= []).push(cb); },
    // ---------- Laufband (Demo) ----------
    async getTicker() { return store.get('ticker', null)?.items ?? DEFAULT_TICKER; },
    async saveTicker(items) {
      await requireAdmin();
      const list = items.map((t) => t.trim().slice(0, 120)).filter(Boolean).slice(0, 30);
      if (!list.length) throw new Error('Das Laufband braucht mindestens einen Text.');
      store.set('ticker', { items: list, updated_at: new Date().toISOString() });
      return list;
    },
    // ---------- Stream-Dino (Demo) ----------
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
        // Füttern beendet den Heißhunger (wie der Trigger in …_pet_costume.sql)
        const { pet: fed, changed } = advanceStage(pet, { ...pet, last_fed_at: new Date().toISOString(), last_fed_by: profile?.username ?? 'Zuschauer', fed_count: (pet.fed_count ?? 0) + 1, frenzy_at: null });
        savePet(fed);
        if (changed) addPetEvent({ kind: 'stage', who: changed.helpers, text: changed.stage });
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
      if (patch.costume_cooldown !== undefined && !(patch.costume_cooldown >= 0 && patch.costume_cooldown <= 300)) throw new Error('Abklingzeit 0 bis 300 Sekunden.');
      if (patch.species !== undefined && !isSpecies(patch.species)) throw new Error('Dieses Tier gibt es nicht.');
      if (patch.hatch_feeds !== undefined && !(patch.hatch_feeds >= 5 && patch.hatch_feeds <= 500)) throw new Error('Schlüpfen nach 5 bis 500 × Füttern.');
      if (patch.grow_days !== undefined && !(patch.grow_days >= 1 && patch.grow_days <= 30)) throw new Error('Wachsen nach 1 bis 30 Streams.');
      return savePet(advanceStage(await this.getPet(), next).pet);
    },
    async petFrenzy(on = true) {
      await requireAdmin();
      return savePet({ ...(await this.getPet()), frenzy_at: on ? new Date().toISOString() : null });
    },
    async petCostume(costume) {
      await requireAdmin();
      if (!COSTUMES.some((c) => c.id === costume)) throw new Error('Dieses Kostüm gibt es nicht.');
      const pet = savePet({ ...(await this.getPet()), costume, costume_changed_at: new Date().toISOString() });
      addPetEvent({ kind: 'costume', who: store.get('users', {})[current.email]?.username ?? 'Admin', text: costume });
      return pet;
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
      const variants = demoVariants();
      const variant = variants.find((v) => v.id === variantId) ?? variants[0];
      const profile = await this.getProfile(current);
      return { spin: makeSpin(variant, 'web', profile.username), announced: false };
    },
    onSpin(cb) { spinListeners.push(cb); },
    // Nur Demo: tut so, als hätte ein Zuschauer die Kanalpunkte-Belohnung eingelöst.
    simulateRedemption() {
      const names = ['NightOwl_Mia', 'PixelPaul', 'GG_Gina', 'LootLukas', 'CrispyCarl'];
      const variants = demoVariants();
      const variant = variants[randomInt(variants.length)];
      const spin = makeSpin(variant, 'twitch', names[randomInt(names.length)]);
      setTimeout(() => spinListeners.forEach((cb) => cb(spin)), 250);
    },
    // ---------- Alerts (Demo) ----------
    // Neue Einträge in zd_stream_alerts erreichen das Overlay im selben Browser über das storage-Ereignis.
    async getAlerts(limit = 10) { return store.get('stream_alerts', []).slice(0, limit); },
    onAlerts(cb) { (demoListeners.stream_alerts ??= []).push(cb); },
    async testAlert(kind) {
      await requireAdmin();
      if (!['follow', 'sub', 'resub', 'gift', 'bits', 'redeem'].includes(kind)) throw new Error('Diese Alert-Art gibt es nicht.');
      const names = ['NightOwl_Mia', 'PixelPaul', 'GG_Gina', 'LootLukas', 'CrispyCarl', 'StreamSofia'];
      const row = {
        id: nextId++, created_at: new Date().toISOString(), kind, user_name: names[randomInt(names.length)], tier: '1000',
        months: kind === 'resub' ? 3 + randomInt(20) : 0,
        amount: kind === 'gift' ? [1, 5, 10][randomInt(3)] : kind === 'bits' ? [100, 500, 1000][randomInt(3)] : kind === 'redeem' ? [500, 1000][randomInt(2)] : 0,
        message: kind === 'resub' ? 'Test-Nachricht: Weiter so!' : kind === 'bits' ? "Test-Cheer: Let's go!" : kind === 'redeem' ? '🎡 Glücksrad' : '', test: true,
      };
      store.set('stream_alerts', [row, ...store.get('stream_alerts', [])].slice(0, 30));
      emitDemo('stream_alerts', row);
      return row;
    },
    async alertsStatus() { return { connected: false, follows: false, subs: false, bits: false }; },
    // Demo: Die Datei landet als data:-URL im localStorage – höchstens 400 KB
    async getAlertSounds() { return store.get('alert_sounds', []); },
    async uploadAlertSound(file, name, duration) {
      await requireAdmin();
      if (file.size > 400 * 1024) throw new Error('Im Demo-Modus höchstens 400 KB (live: 1 MB).');
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
        reader.readAsDataURL(file);
      });
      const id = `demo-${nextId++}`;
      const sound = { id, name, path: `${id}.mp3`, duration, created_at: new Date().toISOString(), url };
      try {
        store.set('alert_sounds', [sound, ...store.get('alert_sounds', [])]);
      } catch {
        throw new Error('Im Browser ist kein Platz mehr – lösch einen Sound.');
      }
      return sound;
    },
    async deleteAlertSound(sound) {
      await requireAdmin();
      store.set('alert_sounds', store.get('alert_sounds', []).filter((x) => x.id !== sound.id));
    },
    // Alert-Designer im Demo-Modus: localStorage, das Overlay im selben Browser liest mit
    async getAlertConfig() { return store.get('alert_config', {}); },
    async saveAlertConfig(config) {
      await requireAdmin();
      store.set('alert_config', config);
    },
    alertMediaUrl(path) { return store.get('alert_media', []).find((x) => x.path === path)?.url ?? ''; },
    async getAlertMedia() { return store.get('alert_media', []); },
    async uploadAlertMedia(file, name) {
      await requireAdmin();
      if (file.size > 1024 * 1024) throw new Error('Im Demo-Modus höchstens 1 MB (live: 10 MB).');
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
        reader.readAsDataURL(file);
      });
      const ext = (/\.([a-z0-9]{2,4})$/i.exec(file.name)?.[1] ?? 'png').toLowerCase().replace('jpeg', 'jpg');
      const id = `demo-${nextId++}`;
      const media = { id, name, path: `${id}.${ext}`, kind: /^video\//.test(file.type) ? 'video' : 'image', created_at: new Date().toISOString(), url };
      try {
        store.set('alert_media', [media, ...store.get('alert_media', [])]);
      } catch {
        throw new Error('Im Browser ist kein Platz mehr – lösch ein Bild.');
      }
      return media;
    },
    async deleteAlertMedia(media) {
      await requireAdmin();
      store.set('alert_media', store.get('alert_media', []).filter((x) => x.id !== media.id));
    },
    // Demo: Kosten fürs Glücksrad lassen sich zum Ausprobieren einstellen
    async twitchStatus() { return { connected: false, reward_cost: store.get('wheel_cost', 10000) }; },
    async twitchConnect() {
      throw new Error('Im Demo-Modus nicht verfügbar. Trag zuerst Supabase in js/config.js ein (siehe README).');
    },
    async twitchDisconnect() {},
    async botConnect() {
      throw new Error('Im Demo-Modus nicht verfügbar. Der Chat-Bot braucht Supabase und Twitch.');
    },
    botCommands: {
      async list() {
        return store.get('bot_commands', [
          { id: 1, command: '!lurk', response: '{user} macht es sich gemütlich und lurkt mit. Danke fürs Dabeibleiben! 💜', enabled: true, mod_only: false, cooldown_seconds: 10, uses: 3 },
          { id: 2, command: '!hydrate', response: 'Trinkpause! {streamer} und alle im Chat: einmal Wasser trinken 💧', enabled: true, mod_only: false, cooldown_seconds: 10, uses: 0 },
        ]);
      },
      async save(c) {
        await requireAdmin();
        if (!/^![a-z0-9äöüß_]{2,25}$/.test(c.command)) throw new Error('Der Befehl braucht ein ! und 2–25 Kleinbuchstaben, Ziffern oder _.');
        if (['!join', '!leave', '!a', '!b', '!c', '!d', '!change', '!watchtime', '!befehle', '!commands', '!füttern', '!fuettern', '!erwischt', '!rate'].includes(c.command)) throw new Error('Diesen Befehl gibt es schon eingebaut.');
        const all = await this.list();
        if (all.some((x) => x.command === c.command && x.id !== c.id)) throw new Error('Diesen Befehl gibt es schon.');
        const row = { uses: 0, ...all.find((x) => x.id === c.id), ...c, id: c.id ?? Date.now() };
        store.set('bot_commands', c.id ? all.map((x) => (x.id === c.id ? row : x)) : [...all, row]);
        return row;
      },
      async remove(id) { await requireAdmin(); store.set('bot_commands', (await this.list()).filter((x) => x.id !== id)); },
    },
    async watchTop() {
      return [
        { display_name: 'NightOwl_Mia', seconds: 184320, pretty: '2 Tage 3 Std 12 Min' },
        { display_name: 'PixelPaul', seconds: 96000, pretty: '1 Tag 2 Std 40 Min' },
        { display_name: 'GG_Gina', seconds: 30600, pretty: '8 Std 30 Min' },
      ];
    },
    async watchState() { return { live: false, last_tick_at: null, source: '', viewers: 0 }; },
    async botDisconnect() {},
    // Demo: zeigt, wie ein Problem aussieht
    async twitchHealth() {
      await requireAdmin();
      const row = {
        checked_at: new Date().toISOString(), ok: false, last_event_at: null, last_event_type: '',
        problems: [{ code: 'not_connected', level: 'error', text: 'Twitch ist noch nicht verbunden – ohne Verbindung keine Alerts, Kanalpunkte und Chat-Befehle.', fix: 'Streamer: Twitch verbinden' }],
        details: {},
      };
      store.set('twitch_health', row);
      return row;
    },
    async getTwitchHealth() { return store.get('twitch_health', null); },
  };
}
