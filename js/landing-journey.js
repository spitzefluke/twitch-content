// Startseite als Reise beim Scrollen – nach dem Entwurf „StreamHelp Startseite v3“ (Claude Design).
// Kapitel: 1 Hero (Vorschau fixiert, wandert in die Mitte, klappt in ihre Ebenen auf und setzt sich wieder
// zusammen) · 2 Zahlen-Band wächst auf volle Breite · 3 Rollen-Karten fächern aus einem Stapel auf,
// Content-Ideen laufen in zwei Reihen gegeneinander · 4 Linie durch die Schritte · 5 Scan über die
// Sicherheit · 6 FAQ Zeile für Zeile · Abschluss: Logo dreht sich auf, Funken.
// Dazu: Licht im Hintergrund wandert mit (eins folgt der Maus), Kapitel-Leiste rechts, magnetische Knöpfe,
// Lichtfleck auf den Karten. Die Vorschau spielt eine Szene: Alerts mit Funken, Glücksrad mit Konfetti,
// Chat mit !Befehlen, Haustier hüpft bei !füttern, Subathon-Timer, ab und zu ein Raid.
// Nur wenn keine reduzierte Bewegung gewünscht ist (sonst bleibt die Seite ruhig, siehe landing.js).
import { dinoSvg } from './pet.js';
import { t } from './i18n.js';

const LAYERS = { bar: 24, alert: 160, chat: 110, wheel: 135, ticker: 70, timer: 95, fx: 175, raid: 200 };
const ALERTS = [
  { kind: 'sub', icon: 'ph-star', name: 'NightOwl_Mia', sub: 'hat abonniert · 3 Monate' },
  { kind: 'follow', icon: 'ph-heart', name: 'PixelPaul', sub: 'folgt jetzt' },
  { kind: 'bits', icon: 'ph-bell-ringing', name: 'GG_Gina', sub: 'hat 500 Bits geschickt' },
];
const WHEEL = ['Nur Schrotflinten', 'Keine Heilung', 'Nur graue Waffen', 'Landen in Tilted', 'Bauen verboten', 'Nur Pistole'];
const CHAT = [
  ['PixelPaul', '!join'],
  ['GG_Gina', '500 Bits für den Dino'],
  ['StreamHelpBot', '@PixelPaul du bist Platz 3', true],
  ['LootLukas', '!füttern'],
  ['NightOwl_Mia', 'Bingo! B-Reihe voll 🎉'],
  ['CrispyCarl', 'dreh das Rad!!'],
  ['StreamHelpBot', 'Rexi ist satt – danke LootLukas', true],
  ['Mia_Mods', 'Raid-Schutz ist aus, viel Spaß'],
];
const ALERT_EVERY = 4500;
// Elemente, deren Inline-Stil die Reise setzt – bei jedem Neuaufbau zurück auf den Stand aus dem HTML
const STYLED = '[data-scrub],[data-fx-pin],[data-fx-pin-inner],[data-fx-pin2],[data-fx-pin2-inner],[data-fx-line],[data-fx-herotext],'
  + '[data-fx-l1],[data-fx-l2],[data-fx-band],[data-fx-bandin],[data-fx-safe],[data-word],[data-fx-step],[data-nav],[data-layer],'
  + '[data-fx-label],[data-fx-caption],[data-pv],[data-fx-rail],[data-fx-aurora],[data-orb],.nc-cta-text,.nc-cta-glow,.nc-hero,'
  + '[data-fx-num],[data-fx-scan],[data-fx-faq],[data-fx-safety] .ph,.nc-btn-solid,.nc-title,[data-fx-group]';

const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const inout = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export function startJourney(root, visible) {
  const j = new Journey(root, visible);
  j.start();
  return j;
}

class Journey {
  constructor(root, visible) {
    this.root = root;
    this.visible = visible;
    this.q = (s) => root.querySelector(s);
    this.qa = (s) => [...root.querySelectorAll(s)];
    this.sy = scrollY;
    this.mx = 0; this.my = 0; this.tmx = 0; this.tmy = 0;
    this.raf = 0;
    this.k = 1; // Stärke der Effekte
    this.t0 = performance.now();
  }

  start() {
    this.splitWords();
    this.buildMarquee();
    this.splitTitle();
    this.cacheElements();
    this.scene();

    addEventListener('scroll', () => this.kick(), { passive: true });
    addEventListener('resize', () => { this.applyMode(); this.kick(); });
    addEventListener('pointermove', (e) => this.onMove(e), { passive: true });
    const re = () => { if (!this.root.hidden) { this.applyMode(); this.kick(); } };
    document.fonts?.ready?.then(re);
    addEventListener('load', re);
    // Startseite wieder sichtbar (z. B. nach dem Abmelden): neu vermessen
    new MutationObserver(re).observe(this.root, { attributes: true, attributeFilter: ['hidden'] });
    if ('ResizeObserver' in window) {
      let lastH = 0;
      const ro = new ResizeObserver(() => {
        const h = this.$.hero.offsetHeight + this.$.groupsEl.offsetHeight;
        if (Math.abs(h - lastH) > 4) { lastH = h; requestAnimationFrame(re); }
      });
      ro.observe(this.$.hero);
      ro.observe(this.$.groupsEl);
    }
    this.applyMode();
    this.kick();
  }

  cacheElements() {
    const q = this.q;
    this.$ = {
      progress: q('.nc-progress'), hero: q('.nc-hero'), card: q('[data-fx-card]'), text: q('[data-fx-herotext]'),
      l2: q('[data-fx-l2]'), pin: q('[data-fx-pin]'), pinInner: q('[data-fx-pin-inner]'), stage: q('[data-pv]'),
      caption: q('[data-fx-caption]'), band: q('[data-fx-band]'), bandIn: q('[data-fx-bandin]'),
      groupsEl: q('[data-fx-groups]'), pin2: q('[data-fx-pin2]'), pin2Inner: q('[data-fx-pin2-inner]'),
      ideas: q('[data-fx-ideas]'), rowA: q('[data-fx-row="a"]'), rowB: q('[data-fx-row="b"]'),
      steps: q('[data-fx-steps]'), line: q('[data-fx-line]'), safety: q('[data-fx-safety]'), scan: q('[data-fx-scan]'),
      faqList: q('[data-fx-faqlist]'), cta: q('[data-fx-cta]'), ctaLogo: q('[data-fx-ctalogo]'), ctaGlow: q('.nc-cta-glow'),
      ctaText: q('.nc-cta-text'), orbA: q('[data-orb="a"]'), orbB: q('[data-orb="b"]'), orbC: q('[data-orb="c"]'),
      aurora: q('[data-fx-aurora]'), rail: q('[data-fx-rail]'), zahlen: q('#zahlen'), title: q('.nc-title'),
    };
    this.$.groups = this.qa('[data-fx-group]');
    this.$.layers = this.qa('[data-layer]');
    this.$.labels = this.qa('[data-fx-label]');
    this.$.words = this.qa('[data-words]').map((h) => ({ h, ws: [...h.querySelectorAll('[data-word]')] }));
    this.$.stepItems = this.qa('[data-fx-step]');
    this.$.safeItems = this.qa('[data-fx-safe]');
    this.$.faqs = this.qa('[data-fx-faq]');
    this.$.nums = this.qa('[data-fx-num]');
    this.$.navs = this.qa('[data-nav]');
    this.$.rails = this.qa('[data-rail]').map((el) => ({ el, id: el.dataset.rail, bar: el.querySelector('[data-rail-bar]'), lb: el.querySelector('[data-rail-label]') }));
    this.$.solid = this.qa('.nc-btn-solid');
  }

  // Überschriften Wort für Wort (Lesbarkeit für Screenreader bleibt: aria-label mit dem ganzen Satz)
  splitWords() {
    this.qa('[data-words]').forEach((h) => {
      const text = h.textContent.trim();
      h.setAttribute('aria-label', text);
      h.replaceChildren(...text.split(' ').flatMap((w, i, all) => {
        const s = document.createElement('span');
        s.dataset.word = '';
        s.setAttribute('aria-hidden', 'true');
        s.textContent = w;
        return i < all.length - 1 ? [s, ' '] : [s];
      }));
    });
  }

  // Content-Ideen: zwei Reihen aus den vorhandenen Schlagwörtern
  buildMarquee() {
    const tags = this.q('[data-fx-ideas] .nc-tags');
    if (!tags) return;
    const all = [...tags.children];
    const half = Math.ceil(all.length / 2);
    const row = (items, id) => {
      const r = document.createElement('div');
      r.className = 'nc-marquee-row';
      r.dataset.fxRow = id;
      for (let n = 0; n < 3; n++) items.forEach((t) => r.append(t.cloneNode(true)));
      return r;
    };
    const box = document.createElement('div');
    box.className = 'nc-marquee';
    box.setAttribute('aria-hidden', 'true');
    box.append(row(all.slice(0, half), 'a'), row(all.slice(half), 'b'));
    tags.after(box);
    // Die ursprüngliche Liste bleibt für Screenreader da, nur unsichtbar
    tags.classList.add('nc-sr-only');
  }

  // Titel Buchstabe für Buchstabe einblenden
  splitTitle() {
    const chars = [];
    const title = this.q('.nc-title');
    title.setAttribute('aria-label', title.textContent.replace(/\s+/g, ' ').trim().replace(/\.(?=\S)/, '. '));
    this.qa('[data-fx-l1],[data-fx-l2]').forEach((p) => {
      p.setAttribute('aria-hidden', 'true');
      const words = p.textContent.split(' ');
      p.textContent = '';
      words.forEach((w, wi) => {
        const ws = document.createElement('span');
        ws.style.display = 'inline-block';
        ws.style.whiteSpace = 'nowrap';
        [...w].forEach((ch) => { const c = document.createElement('span'); c.textContent = ch; c.style.display = 'inline-block'; ws.append(c); chars.push(c); });
        p.append(ws);
        if (wi < words.length - 1) p.append(' ');
      });
    });
    chars.forEach((c, i) => c.animate(
      [{ opacity: 0, transform: 'translateY(.6em) rotateX(-75deg)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }],
      { duration: 950, delay: 260 + i * 34, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
  }

  onMove(e) {
    this.tmx = (e.clientX / innerWidth - 0.5) * 2;
    this.tmy = (e.clientY / innerHeight - 0.5) * 2;
    this.px = e.clientX; this.py = e.clientY;
    if (this.root.hidden) return;
    // Knöpfe ziehen sich leicht zum Mauszeiger
    this.$.solid.forEach((btn) => {
      const b = btn.getBoundingClientRect();
      const dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2);
      btn.style.translate = Math.hypot(dx, dy) < 120 ? `${(dx * 0.28).toFixed(1)}px ${(dy * 0.38).toFixed(1)}px` : '';
    });
    // Lichtfleck auf der Rollen-Karte unter dem Mauszeiger
    const g = e.target.closest?.('[data-fx-group]');
    this.$.groups.forEach((el) => {
      const s = el.querySelector('[data-spot]');
      if (el !== g) { s.style.opacity = '0'; return; }
      const b = el.getBoundingClientRect();
      s.style.setProperty('--mx', `${e.clientX - b.left}px`);
      s.style.setProperty('--my', `${e.clientY - b.top}px`);
      s.style.opacity = '1';
    });
    this.kick();
  }

  applyMode() {
    if (this.root.hidden) return;
    this.qa(STYLED).forEach((el) => {
      if (el.dataset.os === undefined) el.dataset.os = el.getAttribute('style') || '';
      el.setAttribute('style', el.dataset.os);
    });
    this.pinOn = false; this.pin2On = false; this.fan = null;
    const $ = this.$;
    this.qa('[data-scrub]').forEach((el) => { el.classList.add('is-in'); el.style.transition = 'none'; });
    $.line.style.opacity = '1';
    $.aurora.style.opacity = '1';
    [...$.nums, $.scan].forEach((el) => { el.style.display = 'block'; });
    $.solid.forEach((el) => { el.style.transition = 'background-color .15s, transform .2s cubic-bezier(.34,1.4,.64,1), box-shadow .2s, translate .45s cubic-bezier(.2,.8,.2,1)'; });
    $.title.style.perspective = '600px';
    this.railOn = innerWidth >= 1100;
    if (this.railOn) $.rail.style.display = 'flex';
    const vh = innerHeight, vw = innerWidth;

    // Hero fixieren – nur zweispaltig und wenn sein Inhalt ins Fenster passt (fixiert wird er mittig
    // gesetzt, der Innenabstand fällt dann weg)
    const cr = $.card.getBoundingClientRect(), tr = $.text.getBoundingClientRect();
    const twoCol = cr.left >= tr.right - 1 && Math.abs((cr.top + cr.height / 2) - (tr.top + tr.height / 2)) < cr.height;
    if (vw >= 900 && twoCol && this.heroFits()) {
      this.pinOn = true;
      $.pin.style.height = `${Math.round(vh * 3.6)}px`;
      Object.assign($.pinInner.style, { position: 'sticky', top: '0px', height: `${vh}px`, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: '40px' });
      $.hero.style.width = '100%';
      $.hero.style.paddingBlock = '0';
      $.caption.style.display = 'block';
      $.card.style.transformStyle = 'preserve-3d';
      $.stage.style.transformStyle = 'preserve-3d';
      this.q('[data-layer="ticker"]').style.clipPath = 'inset(-60px 0 0 0)';
    }

    // Rollen-Karten: fächern aus einem Stapel auf (nur wenn sie nebeneinander stehen)
    const gr = $.groups.map((g) => g.getBoundingClientRect());
    if (gr.length === 3 && Math.abs(gr[0].top - gr[2].top) < 4) {
      const cx = (gr[0].left + gr[2].right) / 2;
      this.fan = gr.map((b) => cx - (b.left + b.width / 2));
      if ($.pin2Inner.offsetHeight < vh - 90) {
        this.pin2On = true;
        $.pin2.style.height = `${Math.round($.pin2Inner.offsetHeight + vh * 1.2)}px`;
        Object.assign($.pin2Inner.style, { position: 'sticky', top: `${Math.max(64, Math.round((vh - $.pin2Inner.offsetHeight) / 2))}px` });
      }
    }
    this.measure();
  }

  // Passt der Hero (Text und Vorschau, ohne Innenabstand) samt Kopfzeile ins Fenster?
  heroFits() {
    const h = Math.max(this.$.text.offsetHeight, this.$.card.offsetHeight);
    return h + 160 < innerHeight;
  }

  // Wohin die Vorschau in der Mitte des Bildschirms wandert und wie groß sie wird
  measure() {
    const { card, pinInner } = this.$;
    const prev = card.style.transform;
    card.style.transform = 'none';
    const c = card.getBoundingClientRect(), i = pinInner.getBoundingClientRect();
    card.style.transform = prev;
    const vw = innerWidth, vh = innerHeight;
    this.cardM = {
      dx: vw / 2 - (c.left + c.width / 2),
      dy: (i.top + 56 + (vh - 56) / 2) - (c.top + c.height / 2) - vh * 0.03,
      s: Math.max(1, Math.min(1.5, (vw * 0.7) / c.width, ((vh - 56) * 0.72) / c.height)),
    };
  }

  kick() { if (!this.raf && !this.root.hidden) this.raf = requestAnimationFrame(this.frame); }

  frame = () => {
    this.raf = 0;
    if (this.root.hidden) return;
    const target = scrollY;
    // Weich hinterherziehen statt hart springen
    this.sy += (target - this.sy) * 0.14;
    if (Math.abs(target - this.sy) < 0.4) this.sy = target;
    this.vel = target - this.sy;
    this.mx += (this.tmx - this.mx) * 0.08;
    this.my += (this.tmy - this.my) * 0.08;
    let cm = false;
    if (this.px != null) {
      this.cx = this.cx == null ? this.px : this.cx + (this.px - this.cx) * 0.12;
      this.cy = this.cy == null ? this.py : this.cy + (this.py - this.cy) * 0.12;
      cm = Math.abs(this.px - this.cx) + Math.abs(this.py - this.cy) > 0.5;
    }
    const intro = Math.min(1, Math.max(0, (performance.now() - this.t0 - 200) / 1300));
    this.paint(intro);
    if (this.sy !== target || intro < 1 || cm || Math.abs(this.tmx - this.mx) > 0.002 || Math.abs(this.tmy - this.my) > 0.002) this.kick();
  };

  paint(intro) {
    const $ = this.$, vh = innerHeight, vw = innerWidth, K = this.k;
    const max = document.documentElement.scrollHeight - vh;
    $.progress.style.setProperty('--p', (max > 0 ? clamp(scrollY / max) : 0).toFixed(4));
    this.root.style.setProperty('--sy', String(Math.round(this.sy)));
    const off = scrollY - this.sy;
    const top = (el) => el.getBoundingClientRect().top + off;
    const prog = (el, a, b) => clamp((vh * a - top(el)) / (vh * (a - b)));
    const Js = max > 0 ? clamp(this.sy / max) : 0;

    // Hintergrund-Licht wandert mit der Reise
    const va = Math.max(vw, vh) * 0.7, vb = Math.max(vw, vh) * 0.6;
    $.orbA.style.transform = `translate3d(${(vw * (0.75 - 0.9 * Js) - va / 2).toFixed(0)}px, ${(vh * (0.05 + 0.55 * Math.sin(Js * Math.PI)) - va / 2).toFixed(0)}px, 0)`;
    $.orbB.style.transform = `translate3d(${(vw * (0.05 + 0.85 * Js) - vb / 2).toFixed(0)}px, ${(vh * (0.85 - 0.5 * Js) - vb / 2).toFixed(0)}px, 0)`;

    // Kapitel 1 – Hero: zentrieren, in 3D aufklappen, wieder zusammensetzen
    if (this.pinOn && !this.heroFits()) { this.applyMode(); return; }
    const ie = 1 - Math.pow(1 - intro, 4);
    const M = this.cardM || { dx: 0, dy: 0, s: 1 };
    let a = 0, x = 0, lab = 0;
    if (this.pinOn) {
      const p = clamp(-top($.pin) / ($.pin.offsetHeight - vh));
      a = inout(p / 0.24);
      const b = inout((p - 0.28) / 0.22), c = inout((p - 0.74) / 0.18);
      x = b * (1 - c);
      lab = ease((p - 0.4) / 0.1) * (1 - ease((p - 0.7) / 0.07));
    } else {
      a = ease(clamp(this.sy / (vh * 0.9))) * 0.35;
    }
    const rest = 1 - a;
    const tilt = rest * (1 - x);
    const rx = (rest * 7 - this.my * 5 * tilt + (1 - ie) * 24) * K + x * 54;
    const ry = (rest * -11 + this.mx * 7 * tilt) * K + x * this.mx * 6;
    const rz = -26 * x;
    const dx = this.pinOn ? M.dx * a : 0;
    const dy = this.pinOn ? M.dy * a + x * vh * 0.06 : -this.sy * 0.08 * K;
    const s = (this.pinOn ? 1 + (M.s - 1) * a : 1) * (1 - 0.24 * x) * (0.94 + 0.06 * ie);
    const card = $.card;
    card.style.transform = `perspective(1800px) translate3d(${dx.toFixed(1)}px, ${(dy + (1 - ie) * 70).toFixed(1)}px, 0) scale(${s.toFixed(4)}) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;
    card.style.opacity = String(ie);
    card.style.zIndex = '2';
    card.style.boxShadow = `0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,.65), 0 50px 140px -30px rgba(120,185,0,${(0.12 + 0.38 * a).toFixed(3)})`;
    if (this.pinOn) {
      const open = x > 0.005;
      card.style.overflow = open ? 'visible' : '';
      $.stage.style.overflow = open ? 'visible' : '';
      $.layers.forEach((el) => {
        const z = LAYERS[el.dataset.layer] * x * K;
        el.style.translate = open ? `0 0 ${z.toFixed(1)}px` : '';
        el.style.boxShadow = open && el.dataset.layer !== 'bar' ? `0 ${(20 * x).toFixed(0)}px ${(50 * x).toFixed(0)}px rgba(0,0,0,${(0.5 * x).toFixed(2)})` : '';
      });
      $.labels.forEach((el, i) => {
        const z = LAYERS[el.dataset.fxLabel] * x * K + 2;
        const li = clamp(lab * 1.6 - i * 0.15);
        el.style.opacity = li.toFixed(3);
        el.style.transform = `translate3d(0, ${((1 - li) * 8).toFixed(1)}px, ${z.toFixed(1)}px) rotateZ(${(26 * x).toFixed(2)}deg) rotateX(${(-54 * x).toFixed(2)}deg)`;
      });
      $.caption.style.opacity = lab.toFixed(3);
      $.caption.style.transform = `translate3d(0, ${((1 - lab) * 24).toFixed(1)}px, 0)`;
      $.caption.style.filter = lab < 0.99 ? `blur(${((1 - lab) * 6).toFixed(1)}px)` : '';
    }
    const te = this.pinOn ? clamp(a * 1.5) : 0;
    $.text.style.opacity = String(1 - te);
    $.text.style.transform = `translate3d(${(-te * 90 * K).toFixed(1)}px, 0, 0)`;
    $.text.style.filter = te > 0.01 ? `blur(${(te * 10).toFixed(1)}px)` : '';
    $.text.style.pointerEvents = te > 0.6 ? 'none' : '';
    $.l2.style.transform = `translate3d(${(-te * 40 * K).toFixed(1)}px,0,0)`;

    // Kapitel 2 – Band wächst aus einer Karte auf volle Breite
    const be = ease(prog($.band, 1.0, 0.4));
    const ins = (1 - be) * Math.min(72, vw * 0.06) * K, rad = (1 - be) * 28;
    $.band.style.clipPath = `inset(0 ${ins.toFixed(1)}px round ${rad.toFixed(1)}px)`;
    $.band.style.transformOrigin = '50% 0';
    $.band.style.transform = `perspective(1400px) rotateX(${((1 - be) * 14 * K).toFixed(2)}deg)`;
    $.bandIn.style.transform = `translate3d(0, ${((1 - be) * 36 * K).toFixed(1)}px, 0)`;

    // Wörter tauchen der Reihe nach auf
    $.words.forEach(({ h, ws }) => {
      const q = prog(h, 0.95, 0.55) * ws.length;
      ws.forEach((w, i) => {
        const v = clamp(q - i);
        w.style.opacity = (0.14 + 0.86 * v).toFixed(3);
        w.style.filter = v < 0.99 ? `blur(${((1 - v) * 3).toFixed(2)}px)` : '';
        w.style.display = 'inline-block';
        w.style.transform = `translate3d(0, ${((1 - v) * 10).toFixed(1)}px, 0)`;
      });
    });

    // Kapitel 3 – Rollen-Karten: fliegen als Stapel herein und fächern auf
    if (this.fan) {
      let enter, fan;
      if (this.pin2On) {
        enter = ease((vh * 1.05 - top($.pin2)) / (vh * 0.75));
        const dist = $.pin2.offsetHeight - $.pin2Inner.offsetHeight;
        fan = inout(clamp(-(top($.pin2) - parseFloat($.pin2Inner.style.top)) / (dist * 0.8)));
      } else {
        enter = ease(prog($.groupsEl, 1.05, 0.6));
        fan = inout(prog($.groupsEl, 0.75, 0.3));
      }
      $.groups.forEach((el, i) => {
        if (enter >= 0.999 && fan >= 0.999) { el.style.transform = ''; el.style.opacity = ''; el.style.transition = ''; el.style.zIndex = ''; return; }
        const k = 1 - fan;
        el.style.transition = 'none';
        el.style.transformOrigin = '50% 100%';
        el.style.zIndex = String(i === 1 ? 3 : 2 - Math.abs(i - 1));
        el.style.transform = `perspective(1200px) translate3d(${(this.fan[i] * k).toFixed(1)}px, ${((1 - enter) * vh * 0.45 * K + Math.abs(i - 1) * 14 * k).toFixed(1)}px, 0) rotateX(${((1 - enter) * 28 * K).toFixed(2)}deg) rotateZ(${((i - 1) * 7 * k * K).toFixed(2)}deg) scale(${(0.9 + 0.1 * fan).toFixed(4)})`;
        el.style.opacity = clamp(enter * 1.4).toFixed(3);
      });
    } else {
      const gt = top($.groupsEl);
      $.groups.forEach((el, i) => {
        const g = ease((vh * 1.02 - gt) / (vh * 0.5) - i * 0.16);
        if (g >= 0.999) { el.style.transform = ''; el.style.opacity = ''; el.style.transition = ''; return; }
        el.style.transition = 'none';
        el.style.transformOrigin = '50% 100%';
        el.style.transform = `perspective(1000px) translate3d(0, ${((1 - g) * 90 * K).toFixed(1)}px, 0) rotateX(${((1 - g) * 22 * K).toFixed(2)}deg) scale(${(0.93 + 0.07 * g).toFixed(4)})`;
        el.style.opacity = g.toFixed(3);
      });
    }

    // Content-Ideen: zwei Reihen laufen gegeneinander, neigen sich mit dem Tempo
    if ($.rowA && $.rowB) {
      const pp = (vh - top($.ideas)) / (vh + $.ideas.offsetHeight);
      const sk = Math.max(-7, Math.min(7, (this.vel || 0) * 0.025));
      $.rowA.style.transform = `translate3d(${(-$.rowA.scrollWidth / 3 * 0.25 - pp * 420 * K).toFixed(1)}px,0,0) skewX(${(-sk).toFixed(2)}deg)`;
      $.rowB.style.transform = `translate3d(${(-$.rowB.scrollWidth / 3 * 1.1 + pp * 420 * K).toFixed(1)}px,0,0) skewX(${(-sk).toFixed(2)}deg)`;
    }

    // Kapitel 4 – Schritte: Linie zieht sich durch
    const sq = prog($.steps, 0.86, 0.42);
    $.line.style.transform = `scaleX(${sq.toFixed(4)})`;
    $.stepItems.forEach((li, i) => {
      const on = ease((sq - i / 3) * 5 + 0.15);
      li.style.opacity = (0.28 + 0.72 * on).toFixed(3);
      li.style.transform = `translate3d(0, ${((1 - on) * 22 * K).toFixed(1)}px, 0)`;
      li.style.borderTopColor = on > 0.5 ? 'transparent' : '';
    });

    // Kapitel 5 – Sicherheit: ein Scan läuft durch und schaltet die Punkte frei
    const sp = prog($.safety, 0.95, 0.45);
    const scanY = sp * $.safety.offsetHeight;
    $.scan.style.transform = `translateY(${scanY.toFixed(1)}px)`;
    $.scan.style.opacity = (clamp(sp * 8) * clamp((1 - sp) * 6)).toFixed(3);
    $.safeItems.forEach((li) => {
      const v = ease((scanY - li.offsetTop + 24) / (li.offsetHeight * 0.9));
      li.style.opacity = (0.08 + 0.92 * v).toFixed(3);
      li.style.transform = `translate3d(${((1 - v) * 60 * K).toFixed(1)}px, 0, 0)`;
      const ic = li.querySelector('.ph');
      ic.style.transform = `scale(${(0.4 + 0.6 * v).toFixed(3)}) rotate(${((1 - v) * -60).toFixed(1)}deg)`;
      ic.style.filter = v > 0.05 && v < 0.98 ? 'drop-shadow(0 0 8px #78b900)' : '';
    });

    // Kapitel 6 – FAQ fächert sich Zeile für Zeile auf
    const fp = prog($.faqList, 0.95, 0.5);
    $.faqs.forEach((d, i) => {
      const v = ease(fp * 1.6 - i * 0.12);
      d.style.opacity = v.toFixed(3);
      d.style.transform = `translate3d(0, ${((1 - v) * 26 * K).toFixed(1)}px, 0)`;
    });

    // Ankunft – Logo dreht sich auf, das Licht wird größer, Funken
    const ce = ease(prog($.cta, 1.0, 0.45));
    $.ctaLogo.style.transform = `scale(${(0.55 + 0.45 * ce).toFixed(4)}) rotate(${((1 - ce) * -120 * K).toFixed(1)}deg)`;
    $.ctaLogo.style.opacity = (0.2 + 0.8 * ce).toFixed(3);
    if (ce > 0.96 && !this.sparked) { this.sparked = true; this.burst(); }
    if (ce < 0.4) this.sparked = false;
    $.ctaGlow.style.inset = `${(-30 - 40 * ce).toFixed(0)}px`;
    $.ctaText.style.transform = `translate3d(0, ${((1 - ce) * 24 * K).toFixed(1)}px, 0)`;

    // Große Kapitelnummern ziehen langsamer vorbei
    $.nums.forEach((el) => {
      const sec = el.parentElement;
      const pr = (vh - top(sec)) / (vh + sec.offsetHeight);
      el.style.transform = `translate3d(${((0.5 - pr) * -40 * K).toFixed(1)}px, ${((0.5 - pr) * 220 * K).toFixed(1)}px, 0)`;
      el.style.opacity = (clamp(pr * 4) * clamp((1 - pr) * 4)).toFixed(3);
    });

    // Licht folgt dem Mauszeiger
    if (this.cx != null) { $.orbC.style.opacity = '1'; $.orbC.style.transform = `translate3d(${(this.cx - 320).toFixed(0)}px, ${(this.cy - 320).toFixed(0)}px, 0)`; }

    // Navigation + Kapitel-Leiste
    let cur = null;
    ['funktionen', 'streamer', 'start', 'sicherheit', 'faq'].forEach((id) => {
      const sec = this.root.querySelector(`#${id}`);
      if (sec && !sec.hidden && sec.getBoundingClientRect().top < vh * 0.45) cur = id;
    });
    $.navs.forEach((el) => { el.style.color = el.dataset.nav === cur ? '#b3e05a' : ''; });
    if (this.railOn) {
      let ch = 'top';
      if ($.zahlen.getBoundingClientRect().top < vh * 0.5) ch = 'zahlen';
      if (cur && cur !== 'streamer') ch = cur;
      if (cur === 'streamer') ch = 'funktionen';
      const wide = vw >= 1440;
      $.rails.forEach(({ id, bar, lb }) => {
        const on = id === ch;
        bar.style.width = on ? '32px' : '16px';
        bar.style.background = on ? '#78b900' : '#4f5280';
        bar.style.boxShadow = on ? '0 0 10px color-mix(in srgb, #78b900 70%, transparent)' : '';
        lb.style.opacity = on && wide ? '1' : '0';
        lb.style.transform = on && wide ? 'none' : 'translateX(6px)';
        lb.style.color = on ? '#b3e05a' : '';
      });
    }
  }

  burst() {
    const { cta, ctaLogo } = this.$;
    const c = cta.getBoundingClientRect(), l = ctaLogo.getBoundingClientRect();
    const cx = l.left + l.width / 2 - c.left, cy = l.top + l.height / 2 - c.top;
    const cols = ['#78b900', '#b3e05a', '#def5b5', '#34379a'];
    const ring = document.createElement('i');
    Object.assign(ring.style, { position: 'absolute', left: `${cx - 60}px`, top: `${cy - 60}px`, width: '120px', height: '120px', borderRadius: '50%', border: '1px solid #78b900', boxShadow: '0 0 24px color-mix(in srgb, #78b900 60%, transparent)', pointerEvents: 'none' });
    cta.append(ring);
    ring.animate([{ transform: 'scale(.5)', opacity: 0.9 }, { transform: 'scale(2.8)', opacity: 0 }], { duration: 1100, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => ring.remove();
    for (let i = 0; i < 24; i++) {
      const d = document.createElement('i');
      const sz = 3 + Math.random() * 4, col = cols[i % cols.length];
      Object.assign(d.style, { position: 'absolute', left: `${cx}px`, top: `${cy}px`, width: `${sz}px`, height: `${sz}px`, borderRadius: '50%', background: col, boxShadow: `0 0 8px ${col}`, pointerEvents: 'none' });
      cta.append(d);
      const a = (i / 24) * Math.PI * 2 + Math.random() * 0.3, rr = 90 + Math.random() * 160;
      d.animate([{ transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${(Math.cos(a) * rr).toFixed(0)}px), calc(-50% + ${(Math.sin(a) * rr).toFixed(0)}px)) scale(.3)`, opacity: 0 }],
        { duration: 900 + Math.random() * 600, easing: 'cubic-bezier(.15,.8,.25,1)' }).onfinish = () => d.remove();
    }
  }

  // ---------- Die Vorschau als Szene ----------
  scene() {
    const stage = this.$.stage;
    if (!stage) return;
    const until = async () => { while (!this.visible()) await wait(800); };
    const pet = stage.querySelector('[data-pv-pet]');
    const fxl = stage.querySelector('[data-pv-fx]');
    const chatEl = stage.querySelector('[data-pv-chat]');
    const timer = stage.querySelector('[data-pv-timer]');
    const timeEl = stage.querySelector('[data-pv-time]'), bumpEl = stage.querySelector('[data-pv-bump]');
    const KIND = { sub: ['ph-star', '#78b900'], follow: ['ph-heart', '#c9a3ff'], bits: [null, '#35c7ff'] };
    const fit = () => {
      timer.hidden = stage.clientWidth < 440; // schmale Vorschau: Timer weglassen
      stage.style.setProperty('--stage-w', `${stage.clientWidth}px`);
    };
    fit();
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(stage);
    // Position relativ zur Bühne (auch wenn die Karte in 3D skaliert ist)
    const rel = (el) => {
      const sr = stage.getBoundingClientRect(), b = el.getBoundingClientRect();
      const k = sr.width / (stage.offsetWidth || 1) || 1;
      return { x: (b.left - sr.left) / k, y: (b.top - sr.top) / k, w: b.width / k, h: b.height / k };
    };
    const float = (x, y, col, icon) => {
      const d = document.createElement('i');
      if (icon) { d.className = `ph ${icon}`; Object.assign(d.style, { fontSize: `${(12 + Math.random() * 8).toFixed(0)}px`, color: col, textShadow: `0 0 10px ${col}` }); }
      else Object.assign(d.style, { width: '6px', height: '6px', borderRadius: '50%', background: col, boxShadow: `0 0 8px ${col}` });
      Object.assign(d.style, { position: 'absolute', left: `${x}px`, top: `${y}px`, pointerEvents: 'none' });
      fxl.append(d);
      const dx = (Math.random() - 0.5) * 60, up = 50 + Math.random() * 80;
      d.animate([
        { transform: 'translate(-50%, -50%) scale(.4)', opacity: 0 },
        { offset: 0.15, transform: 'translate(-50%, -50%) scale(1.1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx.toFixed(0)}px), calc(-50% - ${up.toFixed(0)}px)) scale(.7)`, opacity: 0 },
      ], { duration: 1400 + Math.random() * 700, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => d.remove();
    };
    const confetti = (x, y, n) => {
      const cols = ['#78b900', '#b3e05a', '#def5b5', '#34379a', '#c9a3ff'];
      for (let i = 0; i < n; i++) {
        const d = document.createElement('i');
        const col = cols[i % cols.length], w = 4 + Math.random() * 4;
        Object.assign(d.style, { position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${w * 0.5}px`, borderRadius: '1px', background: col, pointerEvents: 'none' });
        fxl.append(d);
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, v = 60 + Math.random() * 90;
        const ex = Math.cos(a) * v, ey = Math.sin(a) * v;
        d.animate([
          { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
          { offset: 0.55, transform: `translate(calc(-50% + ${(ex * 0.85).toFixed(0)}px), calc(-50% + ${(ey * 0.85).toFixed(0)}px)) rotate(${(Math.random() * 360).toFixed(0)}deg)`, opacity: 1 },
          { transform: `translate(calc(-50% + ${ex.toFixed(0)}px), calc(-50% + ${(ey + 70).toFixed(0)}px)) rotate(${(360 + Math.random() * 360).toFixed(0)}deg)`, opacity: 0 },
        ], { duration: 1300 + Math.random() * 500, easing: 'cubic-bezier(.2,.6,.4,1)' }).onfinish = () => d.remove();
      }
    };
    const ring = (el, col) => {
      const r = rel(el);
      const d = document.createElement('i');
      Object.assign(d.style, { position: 'absolute', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, borderRadius: '8px', border: `1px solid ${col}`, boxShadow: `0 0 18px ${col}`, pointerEvents: 'none' });
      fxl.append(d);
      d.animate([{ transform: 'scale(1)', opacity: 0.9 }, { transform: 'scale(1.18, 1.5)', opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => d.remove();
    };

    // Subathon-Timer: läuft ab, Abos und Bits verlängern
    let secs = 2 * 3600 + 14 * 60 + 37;
    const showTime = () => {
      const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), x = secs % 60;
      timeEl.textContent = [h, m, x].map((v) => String(v).padStart(2, '0')).join(':');
    };
    const bump = (n) => {
      secs += n; showTime();
      bumpEl.textContent = `+${n}s`;
      bumpEl.animate([{ transform: 'translateY(6px) scale(.8)', opacity: 0 }, { offset: 0.2, transform: 'none', opacity: 1 }, { offset: 0.75, opacity: 1 }, { transform: 'translateY(-10px)', opacity: 0 }], { duration: 1600, easing: 'cubic-bezier(.2,.8,.2,1)' });
      timeEl.animate([{ transform: 'scale(1)', color: '#eceef8' }, { offset: 0.3, transform: 'scale(1.18)', color: '#b3e05a' }, { transform: 'scale(1)', color: '#eceef8' }], { duration: 700, easing: 'cubic-bezier(.34,1.4,.64,1)' });
    };
    (async () => { for (;;) { await wait(1000); await until(); secs = Math.max(0, secs - 1); showTime(); } })();

    // Haustier auf dem Laufband, hüpft bei !füttern
    pet.innerHTML = `<div class="dino is-walking" data-species="dino"><div class="dino-pose"><div class="dino-grow"><div class="dino-body">${dinoSvg('schaffner', 'dino')}</div></div></div></div>`;
    const hop = () => {
      const dino = pet.querySelector('.dino');
      if (!dino) return;
      dino.animate([{ translate: '0 0' }, { offset: 0.3, translate: '0 -18px' }, { offset: 0.55, translate: '0 0' }, { offset: 0.75, translate: '0 -8px' }, { translate: '0 0' }], { duration: 850, easing: 'ease-out' });
      const r = rel(dino);
      for (let i = 0; i < 4; i++) setTimeout(() => float(r.x + r.w / 2, r.y + 4, '#c9a3ff', 'ph-heart'), 120 + i * 140);
    };

    // Chat: !Befehle und @Namen hervorgehoben
    const pushChat = (who, text, bot) => {
      const line = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = who;
      if (bot) { b.className = 'nc-bot'; line.className = 'nc-muted'; }
      line.append(b);
      text.split(' ').forEach((w) => {
        line.append(' ');
        if (/^[!@]/.test(w)) { const c = document.createElement('span'); c.textContent = w; c.style.color = '#b3e05a'; line.append(c); }
        else line.append(w);
      });
      chatEl.append(line);
      const lines = [...chatEl.children].filter((l) => !l.classList.contains('is-old'));
      if (lines.length > 4) { lines[0].classList.add('is-old'); setTimeout(() => lines[0].remove(), 400); }
      if (text.includes('!füttern')) setTimeout(hop, 300);
    };

    // Alerts: kommen, stehen, gehen – mit Funken; Abo und Bits verlängern den Subathon
    const alert = stage.querySelector('[data-pv-alert]');
    const onAlert = (a) => {
      const [icon, col] = KIND[a.kind];
      setTimeout(() => {
        ring(alert, col);
        const r = rel(alert);
        for (let i = 0; i < 8; i++) setTimeout(() => float(r.x + 12 + Math.random() * (r.w - 24), r.y + r.h / 2, col, icon), i * 90);
        if (a.kind === 'sub') bump(30);
        if (a.kind === 'bits') {
          bump(10);
          const sub = alert.querySelector('[data-pv-alert-sub]'), t0 = performance.now();
          const tick = (t) => { const k = Math.min(1, (t - t0) / 900); sub.textContent = `hat ${Math.round(500 * (1 - (1 - k) ** 3))} Bits geschickt`; if (k < 1) requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        }
      }, 260);
    };
    (async () => {
      let n = 0;
      for (;;) {
        await until();
        const a = ALERTS[n++ % ALERTS.length];
        alert.dataset.kind = a.kind;
        alert.querySelector('.ph').className = `ph ${a.icon}`;
        alert.querySelector('[data-pv-alert-name]').textContent = a.name;
        alert.querySelector('[data-pv-alert-sub]').textContent = t(a.sub);
        alert.style.setProperty('--dur', `${(ALERT_EVERY - 900) / 1000}s`);
        alert.classList.remove('is-out', 'is-in');
        void alert.offsetWidth;
        alert.classList.add('is-in');
        onAlert(a);
        await wait(ALERT_EVERY - 900);
        alert.classList.replace('is-in', 'is-out');
        await wait(900);
      }
    })();

    // Glücksrad: ausholen, drehen, stehen bleiben – Konfetti
    const wheel = stage.querySelector('[data-pv-wheel]');
    const disc = wheel.querySelector('.nc-pv-disc');
    const result = wheel.querySelector('[data-pv-result]');
    (async () => {
      let rot = 0;
      for (;;) {
        await wait(2600);
        await until();
        wheel.classList.remove('is-done');
        wheel.classList.add('is-spinning');
        result.textContent = 'Dreht …';
        const windUp = rot - 25;
        const target = windUp + 1080 + Math.floor(Math.random() * 360);
        await disc.animate([{ transform: `rotate(${rot}deg)` }, { transform: `rotate(${windUp}deg)` }], { duration: 380, easing: 'cubic-bezier(.3, 0, .4, 1)', fill: 'forwards' }).finished;
        await disc.animate([{ transform: `rotate(${windUp}deg)` }, { transform: `rotate(${target}deg)` }], { duration: 2600, easing: 'cubic-bezier(.15, .6, .15, 1)', fill: 'forwards' }).finished;
        rot = target % 360;
        disc.getAnimations().forEach((an) => an.cancel());
        disc.style.setProperty('--rot', `${rot}deg`);
        wheel.classList.replace('is-spinning', 'is-done');
        result.textContent = t(WHEEL[Math.floor(Math.random() * WHEEL.length)]);
        const r = rel(disc);
        confetti(r.x + r.w / 2, r.y + r.h / 2, 22);
        await wait(3200);
      }
    })();

    // Chat schreibt weiter (während eines Raids übernimmt der Raid)
    let raiding = false;
    (async () => {
      let n = 0;
      for (;;) {
        await until();
        const [who, text, bot] = CHAT[n++ % CHAT.length];
        if (!raiding) pushChat(who, t(text), bot);
        await wait(1700 + Math.random() * 1300);
      }
    })();

    // Raid: Banner fegt herein, Bild wackelt, Chat läuft über
    const raidCard = stage.querySelector('[data-pv-raid]').firstElementChild, raidN = stage.querySelector('[data-pv-raid-n]');
    (async () => {
      await wait(9000);
      for (;;) {
        await until();
        raiding = true;
        const sweep = document.createElement('i');
        Object.assign(sweep.style, { position: 'absolute', top: 0, bottom: 0, left: 0, width: '45%', background: 'linear-gradient(90deg, transparent, color-mix(in srgb, #78b900 22%, transparent), transparent)', pointerEvents: 'none' });
        fxl.append(sweep);
        sweep.animate([{ transform: 'translateX(-110%) skewX(-18deg)' }, { transform: 'translateX(260%) skewX(-18deg)' }], { duration: 900, easing: 'cubic-bezier(.5,0,.3,1)' }).onfinish = () => sweep.remove();
        raidCard.animate([
          { transform: 'translateX(-130%) skewX(-14deg)', filter: 'blur(8px)', opacity: 0 },
          { offset: 0.7, transform: 'translateX(5%) skewX(3deg)', filter: 'blur(0px)', opacity: 1 },
          { transform: 'none', filter: 'blur(0px)', opacity: 1 },
        ], { duration: 720, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
        stage.animate([{ translate: '0 0' }, { translate: '-5px 2px' }, { translate: '4px -3px' }, { translate: '-3px 2px' }, { translate: '2px -1px' }, { translate: '0 0' }], { duration: 480, delay: 420 });
        const t0 = performance.now();
        const tick = (t) => { const k = Math.min(1, (t - t0) / 1200); raidN.textContent = String(Math.round(42 * (1 - (1 - k) ** 3))); if (k < 1) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        await wait(500);
        const r = rel(raidCard);
        for (let i = 0; i < 16; i++) setTimeout(() => float(r.x + Math.random() * r.w, r.y + r.h, i % 3 ? '#b3e05a' : '#c9a3ff', i % 4 ? null : 'ph-users-three'), i * 70);
        for (const [w, t, b] of [['CrispyCarl', 'RAID 🚀'], ['Raider_Rita', 'Hallo zusammen!'], ['StreamHelpBot', 'Willkommen, 42 Raider!', true]]) { pushChat(w, t, b); await wait(520); }
        await wait(1600);
        await raidCard.animate([{ transform: 'none', opacity: 1, filter: 'blur(0px)' }, { transform: 'translateX(130%) skewX(14deg)', opacity: 0, filter: 'blur(8px)' }], { duration: 520, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }).finished;
        raiding = false;
        await wait(19000);
      }
    })();
  }
}
