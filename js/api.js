// Datenzugriff: Supabase (Live) oder localStorage (Demo).
// Beide Varianten haben dieselbe Schnittstelle, damit app.js nichts davon wissen muss.
import { CONFIG } from './config.js';
import { DEFAULT_TILES, DEFAULT_VARIANTS, DEFAULT_IDEAS } from './defaults.js';

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
    async spin(variantId, announce) {
      return invoke('spin', { variant_id: variantId, announce });
    },

    // ---------- Ärgere den Dave ----------
    // Fehlt die Migration …_pranks.sql, schlägt getPrankSettings fehl und
    // app.js zeigt statt der Aktionen einen Hinweis.
    async getPrankSettings() {
      return unwrap(await sb.from('prank_settings').select('enabled, cooldown_seconds, allow_uploads').eq('id', 1).single());
    },
    async updatePrankSettings(patch) {
      return unwrap(await sb.from('prank_settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', 1)
        .select('enabled, cooldown_seconds, allow_uploads')
        .single());
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

    // ---------- Ärgere den Dave (Demo) ----------
    // Neue Einträge in zd_pranks erreichen das Overlay im selben Browser über das storage-Ereignis.
    async getPrankSettings() { return store.get('prank_settings', { enabled: true, cooldown_seconds: 20, allow_uploads: true }); },
    async updatePrankSettings(patch) {
      const next = { ...(await this.getPrankSettings()), ...patch };
      store.set('prank_settings', next);
      return next;
    },
    async getPranks(limit = 12) { return store.get('pranks', []).slice(0, limit); },
    async sendPrank(kind, item, soundId = null) {
      const profile = await this.getProfile(current);
      const cfg = await this.getPrankSettings();
      if (!cfg.enabled && !profile.is_admin) {
        throw Object.assign(new Error('Dave hat „Ärgere den Dave“ gerade pausiert.'), { paused: true });
      }
      const last = store.get('prank_last', {});
      const left = Math.ceil(((last[current.email] ?? 0) + cfg.cooldown_seconds * 1000 - Date.now()) / 1000);
      if (!profile.is_admin && left > 0) {
        throw Object.assign(new Error(`Kurz durchatmen: noch ${left} Sekunden bis zur nächsten Aktion.`), { wait: left });
      }
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
      store.set('prank_last', { ...last, [current.email]: Date.now() });
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
