// Startseite: Balken mit Live-Zahlen aus allen Streams, Abschnitte gleiten beim Scrollen herein und –
// ohne „Bewegung reduzieren“ – die Reise beim Scrollen mit der Vorschau als Szene (js/landing-journey.js).
// Läuft nur, solange die Startseite zu sehen ist.
import { startJourney } from './landing-journey.js';
import { locale, t } from './i18n.js';

// Balken „Auf einen Blick“: Zahlen aus allen Streams (public.platform_stats), alle 30 Sekunden neu.
// Gezeigt werden die ersten acht, die schon etwas zählen; „today“ = wie viele davon heute.
const STATS_EVERY = 30_000;
const STATS_MAX = 8;
const LIVE_STATS = [
  { key: 'streamers', label: 'Streamer bei StreamHelp', always: true, sub: (s) => (s.live > 0 ? t('{n} gerade live', { n: fmt(s.live) }) : ''), dot: (s) => s.live > 0 },
  { key: 'viewers_now', label: 'Zuschauer gerade live', dot: () => true },
  { key: 'watch_hours', label: 'Watchtime gezählt', unit: 'Std' },
  { key: 'alerts', label: 'Alerts im Stream', today: 'alerts_today' },
  { key: 'spins', label: 'Glücksrad-Drehungen', today: 'spins_today' },
  { key: 'pranks', label: 'Streiche am Streamer', today: 'pranks_today' },
  { key: 'pet_moments', label: 'Haustier-Momente' },
  { key: 'hotwords', label: 'Hot Words im Chat' },
  { key: 'chat', label: 'Fragen & Ideen aus dem Chat', value: (s) => (s.questions ?? 0) + (s.ideas ?? 0) },
  { key: 'cards', label: 'Sammelkarten gezogen' },
  { key: 'quiz_answers', label: 'Quiz-Antworten' },
  { key: 'tts', label: 'Nachrichten vorgelesen' },
  { key: 'players', label: 'Zuschauer mitgespielt' },
  { key: 'winners', label: 'Verlosungs-Gewinner' },
  { key: 'viewers_total', label: 'Zuschauer gezählt' },
];
const fmt = (n) => Math.round(n).toLocaleString(locale());

let started = false;

// opts.stats: () => Promise<Zahlen | null>; opts.facts: [{ key, n, label, unit? }] – was in StreamHelp steckt
export function setupLanding(root, opts = {}) {
  if (started || !root) return;
  started = true;
  root.classList.add('nc-js');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const visible = () => !root.hidden && document.visibilityState === 'visible';

  navMenu(root);
  channelSearch(root);
  mailOpener(root);
  statsBand(root, still, visible, opts);
  revealOnScroll(root, still);
  if (still) progressBar(root);
  else startJourney(root, visible);
}

// Schmale Fenster: Menü-Knopf in der Kopfzeile klappt die Links auf (Klick auf einen Link, Esc
// oder breiteres Fenster schließt es wieder)
function navMenu(root) {
  const btn = root.querySelector('[data-menu]');
  const menu = root.querySelector('#nc-menu');
  if (!btn || !menu) return;
  const icon = btn.querySelector('.ph');
  const set = (open) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    icon.className = `ph ${open ? 'ph-x' : 'ph-list'}`;
  };
  btn.addEventListener('click', () => set(menu.hidden));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
  matchMedia('(min-width: 900px)').addEventListener('change', (e) => { if (e.matches) set(false); });
}

// „Stream finden“: Showcase (mit Zustimmung, weiß ob live) und Kanal-Liste (alle freigeschalteten) zu einer
// Liste zusammenführen – steht ein Kanal in beiden, bekommt seine Karte LIVE und das Spiel, live zuerst.
function mergeChannels(root) {
  const list = root.querySelector('#lp-channels');
  const show = root.querySelector('#lp-showcase-list');
  if (!list || !show) return;
  const byLogin = new Map([...show.querySelectorAll('a[data-login]')].map((a) => [a.dataset.login.toLowerCase(), a]));
  for (const btn of list.querySelectorAll('button[data-channel]')) {
    const a = byLogin.get(btn.dataset.channel.toLowerCase());
    if (!a) continue;
    a.closest('li').classList.add('is-dup');
    if (!('live' in a.dataset) || btn.querySelector('.nc-showcase-live')) continue;
    btn.dataset.live = '';
    btn.append(a.querySelector('.nc-showcase-live').cloneNode(true));
    const game = a.querySelector('small')?.textContent;
    if (game) btn.querySelector('small').textContent = game;
  }
  const items = [...list.children];
  const sorted = [...items].sort((x, y) => (y.querySelector('[data-live]') ? 1 : 0) - (x.querySelector('[data-live]') ? 1 : 0));
  if (sorted.some((li, i) => li !== items[i])) list.append(...sorted);
}

// „Stream finden“: Suche filtert Showcase und Kanal-Liste nach Name, Spiel oder Twitch-Adresse
function channelSearch(root) {
  const input = root.querySelector('#lp-channel-q');
  const none = root.querySelector('#lp-channels-none');
  const box = root.querySelector('#lp-showcase');
  if (!input || !none) return;
  const lists = ['#lp-showcase-list', '#lp-channels'].map((s) => root.querySelector(s)).filter(Boolean);
  const visible = (li) => !li.hidden && !li.classList.contains('is-dup');
  const apply = () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const list of lists) {
      for (const li of list.children) {
        li.hidden = !!q && !li.textContent.toLowerCase().includes(q);
        if (visible(li)) shown++;
      }
    }
    box?.classList.toggle('is-empty', ![...(root.querySelector('#lp-showcase-list')?.children ?? [])].some(visible));
    none.hidden = !q || shown > 0;
  };
  input.addEventListener('input', apply);
  // Listen kommen erst später (Supabase) – dann zusammenführen und die Suche erneut anwenden
  const update = () => { mergeChannels(root); apply(); };
  lists.forEach((l) => new MutationObserver(update).observe(l, { childList: true }));
}

// Kontakt: Formular klappt auf, wenn ein Link dorthin führt (Fußzeile, #nachricht in der Adresse);
// dazu der Sprung zum Abschnitt aus der Adresse
function mailOpener(root) {
  const box = root.querySelector('#nachricht');
  if (!box) return;
  const open = () => { box.open = true; };
  if (location.hash === '#nachricht' || location.hash === '#contact-form') open();
  // Mit Sprungziel geöffnet (z. B. von „Über uns“): Die Startseite war beim Laden noch versteckt,
  // der Browser konnte nicht hinspringen – das jetzt nachholen
  let id = '';
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { /* kaputte Adresse: kein Sprung */ }
  const target = id && document.getElementById(id);
  if (target && root.contains(target)) requestAnimationFrame(() => target.scrollIntoView());
  addEventListener('hashchange', () => { if (location.hash === '#nachricht' || location.hash === '#contact-form') open(); });
  root.addEventListener('click', (e) => { if (e.target.closest('a[href="#nachricht"]')) open(); });
}

// Abschnitte gleiten herein, sobald sie ins Bild kommen
function revealOnScroll(root, still) {
  const items = root.querySelectorAll('.nc-rv');
  if (still || !('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  items.forEach((el) => io.observe(el));
}

// Balken „Auf einen Blick“: zählt beim ersten Hinsehen von 0 hoch und danach bei jeder neuen Zahl
// vom alten zum neuen Wert. Ohne Live-Zahlen (Migration fehlt, keine Verbindung) zeigt er, was drin ist.
function statsBand(root, still, visible, { stats, facts = [] }) {
  const band = root.querySelector('[data-stats]');
  if (!band) return;
  const grid = band.querySelector('[data-stats-grid]');
  const chips = band.querySelector('[data-stats-facts]');
  const head = band.querySelector('[data-stats-head]');
  const when = band.querySelector('[data-stats-when]');
  const animate = !still && 'IntersectionObserver' in window;
  let seen = !animate;
  let data = null;
  let at = 0;
  let built = false;

  // Zahl von ihrem jetzigen Wert zum Ziel laufen lassen
  const count = (el, to, from) => {
    el.dataset.value = String(to);
    if (!seen) { el.textContent = '0'; return; }
    if (!animate || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const dur = from ? 900 : 1400;
    const tick = (t) => {
      if (el.dataset.value !== String(to)) return;   // schon wieder eine neuere Zahl
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(from + (to - from) * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if (from && to > from) {
      const item = el.closest('.nc-band-item');
      item?.classList.remove('is-bump');
      void item?.offsetWidth;
      item?.classList.add('is-bump');
    }
  };

  const itemEl = (it, i) => {
    const num = document.createElement('span');
    num.dataset.count = '';
    const p = document.createElement('p');
    p.className = 'nc-band-num';
    p.append(num);
    if (it.unit) {
      const small = document.createElement('small');
      small.textContent = ` ${t(it.unit)}`;
      p.append(small);
    }
    const label = document.createElement('p');
    label.className = 'nc-band-label';
    label.textContent = t(it.label);
    const sub = document.createElement('p');
    sub.className = 'nc-band-sub';
    const box = document.createElement('div');
    box.className = `nc-band-item nc-rv${built ? ' is-in is-new' : ''}`;
    box.style.setProperty('--i', String(i % 4));
    box.dataset.key = it.key;
    box.append(p, label, sub);
    return box;
  };

  // Liste fürs Raster: Live-Zahlen (falls da), aufgefüllt mit dem, was drin ist; Rest als Kärtchen darunter
  const items = () => {
    const live = data ? LIVE_STATS
      .map((d) => ({ ...d, n: Number(d.value ? d.value(data) : data[d.key]) || 0 }))
      .filter((d) => d.always || d.n > 0)
      .slice(0, STATS_MAX)
      .map((d) => ({ key: d.key, n: d.n, label: d.label, unit: d.unit,
        sub: d.sub ? d.sub(data) : d.today && data[d.today] > 0 ? t('+{n} heute', { n: fmt(data[d.today]) }) : '',
        dot: !!d.dot?.(data) })) : [];
    const fill = Math.max(0, 4 - live.length);
    return { grid: [...live, ...facts.slice(0, fill)], rest: facts.slice(fill) };
  };

  const render = () => {
    const { grid: list, rest } = items();
    const old = new Map([...grid.querySelectorAll('.nc-band-item')].map((el) => [el.dataset.key, el]));
    const same = old.size === list.length && list.every((it) => old.has(it.key));
    const nodes = list.map((it, i) => (same ? old.get(it.key) : old.get(it.key) ?? itemEl(it, i)));
    if (!same) grid.replaceChildren(...nodes);
    list.forEach((it, i) => {
      const el = nodes[i];
      const num = el.querySelector('[data-count]');
      count(num, it.n, Number(num.dataset.value ?? 0) || 0);
      const sub = el.querySelector('.nc-band-sub');
      sub.textContent = it.sub ?? '';
      sub.hidden = !it.sub;
      el.classList.toggle('has-dot', !!it.dot);
    });
    chips.replaceChildren(...rest.map((f) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = `${fmt(f.n)}${f.unit ? ` ${t(f.unit)}` : ''}`;
      li.append(b, ` ${t(f.label)}`);
      return li;
    }));
    chips.hidden = !rest.length;
    head.hidden = !data;
    built = true;
  };

  const ago = () => {
    if (!at) return;
    const s = Math.round((Date.now() - at) / 1000);
    when.textContent = s < 10 ? t('gerade aktualisiert') : s < 60 ? t('vor {n} s', { n: s }) : t('vor {n} Min', { n: Math.floor(s / 60) });
  };

  render();
  if (animate) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      seen = true;
      grid.querySelectorAll('[data-count]').forEach((el) => count(el, Number(el.dataset.value) || 0, 0));
    }, { threshold: 0.4 });
    io.observe(band);
  }
  if (!stats) return;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    for (;;) {
      while (!visible()) await wait(1000);
      try {
        const d = await stats();
        if (d) { data = d; at = Date.now(); render(); ago(); }
      } catch { /* letzte Zahlen bleiben stehen */ }
      for (let t = 0; t < STATS_EVERY; t += 5000) { await wait(5000); ago(); }
    }
  })();
}

// Ohne Bewegung: nur der Fortschrittsbalken oben
function progressBar(root) {
  const bar = root.querySelector('.nc-progress');
  let queued = false;
  const update = () => {
    queued = false;
    if (root.hidden) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar?.style.setProperty('--p', max > 0 ? (scrollY / max).toFixed(4) : '0');
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();
}
