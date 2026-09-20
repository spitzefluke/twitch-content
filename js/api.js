// Datenzugriff: Supabase (Live) oder localStorage (Demo).
// Beide Varianten haben dieselbe Schnittstelle, damit app.js nichts davon wissen muss.
import { CONFIG } from './config.js';
import { DEFAULT_ARCHIVE, DEFAULT_IDEAS, DEFAULT_TILES, DEFAULT_VARIANTS } from './defaults.js';

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
    async getSpins(limit = 15) {
      return unwrap(await sb.from('spins').select('*').order('created_at', { ascending: false }).limit(limit));
    },

    // ---------- Archiv (gefahrene Strecken) ----------
    async getArchive(limit = 12) {
      return unwrap(await sb.from('archive').select('*').order('happened_at', { ascending: false }).limit(limit));
    },
    async saveArchive(entry) {
      const row = entry.id
        ? await sb.from('archive').update(entry).eq('id', entry.id).select().single()
        : await sb.from('archive').insert(entry).select().single();
      return unwrap(row);
    },
    async deleteArchive(id) {
      unwrap(await sb.from('archive').delete().eq('id', id));
    },

    // ---------- Vorschläge ----------
    async getIdeas(user, limit = 12) {
      const ideas = unwrap(await sb.from('ideas').select('*').order('votes', { ascending: false }).order('created_at', { ascending: false }).limit(limit));
      if (!user || !ideas.length) return ideas.map((i) => ({ ...i, voted: false }));
      const mine = unwrap(await sb.from('idea_votes').select('idea_id').eq('user_id', user.id));
      const voted = new Set(mine.map((v) => v.idea_id));
      return ideas.map((i) => ({ ...i, voted: voted.has(i.id) }));
    },
    async addIdea(text, user, username) {
      return unwrap(await sb.from('ideas').insert({ text, user_id: user.id, author: username }).select().single());
    },
    async voteIdea(ideaId, on, user) {
      if (on) unwrap(await sb.from('idea_votes').insert({ idea_id: ideaId, user_id: user.id }));
      else unwrap(await sb.from('idea_votes').delete().eq('idea_id', ideaId).eq('user_id', user.id));
    },
    async deleteIdea(id) {
      unwrap(await sb.from('ideas').delete().eq('id', id));
    },
    async spin(variantId, announce) {
      return invoke('spin', { variant_id: variantId, announce });
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
    async getSpins(limit = 15) { return store.get('spins', []).slice(0, limit); },

    async getArchive(limit = 12) {
      return store.get('archive', DEFAULT_ARCHIVE).slice(0, limit);
    },
    async saveArchive(entry) {
      const rows = store.get('archive', DEFAULT_ARCHIVE);
      const row = { ...entry, id: entry.id ?? Date.now() };
      const next = entry.id ? rows.map((r) => (r.id === entry.id ? row : r)) : [row, ...rows];
      next.sort((a, b) => String(b.happened_at).localeCompare(String(a.happened_at)));
      store.set('archive', next);
      return row;
    },
    async deleteArchive(id) {
      store.set('archive', store.get('archive', DEFAULT_ARCHIVE).filter((r) => r.id !== id));
    },

    async getIdeas(_user, limit = 12) {
      return store.get('ideas', DEFAULT_IDEAS).slice(0, limit);
    },
    async addIdea(text, _user, username) {
      const idea = { id: Date.now(), text, author: username, votes: 1, voted: true, created_at: new Date().toISOString() };
      store.set('ideas', [idea, ...store.get('ideas', DEFAULT_IDEAS)]);
      return idea;
    },
    async voteIdea(ideaId, on) {
      store.set('ideas', store.get('ideas', DEFAULT_IDEAS).map((i) => (i.id === ideaId ? { ...i, voted: on, votes: i.votes + (on ? 1 : -1) } : i)));
    },
    async deleteIdea(id) {
      store.set('ideas', store.get('ideas', DEFAULT_IDEAS).filter((i) => i.id !== id));
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
