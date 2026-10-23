// Twitch-Panel von StreamHelp: aktuelles Game mit passenden Content-Ideen, Mitmachen per Klick
// (Umfrage, Haustier füttern, Verlosung, Mitspieler-Warteschlange) und Link zur Seite.
// Hell/Dunkel folgt Twitch (onContext → theme), auf dem Handy (Twitch hängt ?platform=mobile an)
// werden die Knöpfe größer und der Link nach draußen fällt weg. Daten kommen von der Edge Function
// twitch-ext – sie prüft den Ausweis, den Twitch dem Panel gibt (Twitch.ext.onAuthorized).
// Ohne Twitch (direkt im Browser geöffnet) zeigt das Panel Beispieldaten.
(function () {
  'use strict';

  // Steht auch in js/config.js (SUPABASE_URL) und ist nicht geheim.
  var API = 'https://ssibsphuttjlphijilsc.supabase.co/functions/v1/twitch-ext';
  var POLL_MS = 45000;
  var ext = window.Twitch && window.Twitch.ext;
  // Direkt im Browser geöffnet (nicht bei Twitch im Rahmen): Beispieldaten
  var DEMO = !ext || window.self === window.top || /[?&]demo\b/.test(location.search);
  var QUERY = new URLSearchParams(location.search);
  var MOBILE = QUERY.get('platform') === 'mobile';

  // Einstellungen des Streamers (config.html, Twitch-Konfigurationsdienst) – siehe extension/ext-config.js.
  // Ansicht: Twitch hängt ?anchor=panel|component|video_overlay an; zum Ausprobieren ?mode=overlay (nur mit ?demo).
  var CFGLIB = window.STREAMHELP_CFG;
  var cfg = CFGLIB.clean(null);
  var ctxTheme = null;
  // Vier Ansichten, jede mit eigenem Design (panel.css): panel | mobile | component | overlay.
  // Welche Ansicht läuft, bestimmt Twitch (?anchor=… bzw. ?platform=mobile) – nicht die gespeicherten Einstellungen.
  var VIEWS = ['panel', 'mobile', 'component', 'overlay'];
  var MODE = 'panel';
  var forcedView = null; // nur Vorschau in config.html (per postMessage)
  // Eigene Datei je Ansicht (component.html, video-overlay.html, mobile.html): <html data-view="…">.
  // panel.html hat keins – dort entscheiden ?anchor=… und ?platform=mobile wie bisher.
  var FILE_VIEW = VIEWS.indexOf(document.documentElement.getAttribute('data-view')) >= 0 ? document.documentElement.getAttribute('data-view') : null;
  function modeFor() {
    if (DEMO && forcedView) return forcedView;
    if (DEMO && VIEWS.indexOf(QUERY.get('mode')) >= 0) return QUERY.get('mode');
    if (FILE_VIEW) return FILE_VIEW;
    var a = QUERY.get('anchor');
    if (MOBILE || a === 'mobile') return 'mobile';
    return a === 'video_overlay' ? 'overlay' : a === 'component' ? 'component' : 'panel';
  }
  function applyChrome() {
    var root = document.documentElement;
    MODE = modeFor();
    setLang(cfg.lang === 'auto' ? viewerLang : cfg.lang);
    root.dataset.mode = MODE;
    root.classList.toggle('is-mobile', MODE === 'mobile');
    root.dataset.compact = cfg.compact || MODE === 'component' || MODE === 'overlay' ? '1' : '0';
    root.dataset.corner = cfg.corner;
    root.dataset.size = cfg.size;
    // Farbschema: fest (Streamer) → sonst Twitch beim Zuschauer → sonst ?theme= → dunkel
    root.dataset.theme = cfg.theme !== 'auto' ? cfg.theme : (ctxTheme || QUERY.get('theme') || 'dark');
  }
  function useConfig(next, view) {
    var before = lang;
    if (view !== undefined) forcedView = VIEWS.indexOf(view) >= 0 ? view : null;
    cfg = CFGLIB.clean(next);
    applyChrome();
    if (window.console && console.info) console.info('[StreamHelp] Ansicht:', MODE, '· Einstellungen:', cfg);
    if (DEMO && lang !== before) { window.__demo = null; load(); } else if (data) render();
  }

  // Sprache: Standard ist die des Zuschauers (Twitch hängt ?language=… an die Adresse und meldet sie in
  // onContext); der Streamer kann in config.html eine feste Sprache wählen. Unbekannte Sprachen → Englisch.
  var I18N = window.PANEL_I18N || { dicts: {} };
  var viewerLang = QUERY.get('language') || navigator.language || 'en';
  var LOCALES = { de: 'de-DE', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', nl: 'nl-NL', pl: 'pl-PL', pt: 'pt-BR', tr: 'tr-TR', ru: 'ru-RU' };
  var lang = 'en';
  function setLang(code) {
    var c = String(code || '').slice(0, 2).toLowerCase();
    var next = (I18N.dicts[c] || c === 'de') ? c : 'en';
    document.documentElement.lang = next;
    if (next === lang) return false;
    lang = next;
    return true;
  }
  setLang(cfg.lang === 'auto' ? viewerLang : cfg.lang);
  function T(source, vars) {
    var out = (I18N.dicts[lang] || {})[source] || source;
    if (vars) out = out.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? String(vars[k]) : m; });
    return out;
  }

  var token = null;
  var data = null;
  var pending = null;   // Aktion, die nach der Freigabe der Twitch-ID ausgeführt wird
  var msgs = {};        // Rückmeldung je Bereich (giveaway, queue, vote, feed, sound)
  var timer = 0;
  var ticker = 0;       // Sekundentakt für Countdown und Hunger
  var busy = {};        // Aktion läuft gerade (Knöpfe gesperrt)
  var PET_ICON = { dino: '🦖', cat: '🐱', fox: '🦊', axolotl: '🦎', penguin: '🐧', dragon: '🐉' };

  // Texte auf Deutsch – T() übersetzt beim Anzeigen (extension/panel-i18n.js)
  var REASONS = {
    share: 'Gib deine Twitch-ID frei (Twitch fragt gleich nach) – dann klappt’s.',
    closed: 'Gerade geschlossen.',
    follower: 'Nur für Follower: Folge dem Kanal und versuch es noch einmal.',
    twice: 'Du bist schon dabei.',
    kicked: 'Bei dieser Verlosung kannst du nicht mehr mitmachen.',
    won_today: 'Du hast heute schon gewonnen – morgen darfst du wieder mitmachen.',
    streamer: 'Der Streamer lost nicht selbst mit 😉',
    check: 'Die Follower-Prüfung klappt gerade nicht – versuch es gleich noch einmal.',
    epic: 'Bitte deinen Epic-Namen eintragen (3–32 Zeichen).',
    full: 'Die Warteschlange ist voll.',
    auth: 'Bitte die Seite neu laden.',
    unknown: 'Dieser Kanal ist (noch) nicht bei StreamHelp.',
    setup: 'StreamHelp ist für dieses Panel noch nicht fertig eingerichtet.',
    paused: 'Gerade pausiert – gleich geht’s weiter.',
    choice: 'Diese Antwort gibt es nicht.',
    busy: 'Kaut noch – in ein paar Sekunden wieder.',
    rate: 'Zu viele Klicks – kurz warten.',
    cooldown: 'Gerade im Abklingen – gleich wieder.',
    off: 'Sounds sind gerade aus.',
    sound: 'Diesen Sound gibt es nicht mehr.',
    sub: 'Nur für Abonnenten.',
    receipt: 'Die Zahlung ließ sich nicht bestätigen – bitte melde dich beim Streamer.',
  };

  var logoImg = document.querySelector('.logo img');
  if (logoImg) {
    var showLogo = function () { if (logoImg.naturalWidth) logoImg.parentNode.classList.add('has-img'); };
    logoImg.addEventListener('load', showLogo);
    if (logoImg.complete) showLogo();
  }

  // ---------- Daten ----------
  function call(action, extra) {
    if (DEMO) return demoCall(action, extra || {});
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(Object.assign({ action: action }, extra || {})),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) { var e = new Error(body.message || T('Fehler {n}', { n: res.status })); e.reason = body.error; throw e; }
        return body;
      });
    });
  }

  function load() {
    if (!token && !DEMO) return;
    clearTimeout(timer);
    call('state').then(function (d) {
      // Neue Umfrage: alte Rückmeldung weg
      if (data && data.poll && (!d.poll || d.poll.round !== data.poll.round)) delete msgs.vote;
      data = d;
      render();
    }).catch(function (e) {
      renderError(T(REASONS[e.reason] || e.message));
    }).then(function () {
      timer = setTimeout(load, POLL_MS);
    });
  }

  function act(kind, extra) {
    if (!DEMO && kind !== 'bits_sound' && data && data.me && !data.me.shared) {
      // Twitch-ID freigeben lassen, danach automatisch weiter
      pending = { kind: kind, extra: extra };
      msgs[kind] = { text: T(REASONS.share) };
      render();
      ext.actions.requestIdShare();
      return;
    }
    if (busy[kind]) return;
    busy[kind] = true;
    msgs[kind] = { text: '…' };
    render();
    call(kind, extra).then(function (res) {
      busy[kind] = false;
      if (res.ok) {
        msgs[kind] = { ok: true, text: okText(kind, res) };
        if (kind === 'bits_sound') { msgs.sound = msgs[kind]; delete msgs[kind]; }
        // Umfrage: Stand sofort zeigen, nicht erst nach dem Neuladen
        if (kind === 'vote' && data && data.poll && res.counts) {
          data.poll.counts = res.counts;
          data.poll.total = res.total;
          data.me.vote = res.choice;
        }
      } else if (res.reason === 'cooldown' && res.wait && kind === 'feed') {
        if (data && data.me) data.me.feed_wait = res.wait;
        msgs[kind] = { error: true, text: T('Du kannst in {n} wieder füttern.', { n: span(res.wait) }) };
      } else if (res.reason === 'cooldown' && res.wait && kind === 'sound') {
        msgs[kind] = { error: true, text: T('Nächster Sound in {n}.', { n: span(res.wait) }) };
      } else {
        msgs[kind === 'bits_sound' ? 'sound' : kind] = { error: true, text: T(REASONS[res.reason] || 'Hat nicht geklappt.') };
      }
      load();
    }).catch(function (e) {
      busy[kind] = false;
      msgs[kind] = { error: true, text: T(REASONS[e.reason] || e.message) };
      render();
    });
  }

  function okText(kind, res) {
    if (kind === 'giveaway') return T('🍀 Du bist dabei – viel Glück!');
    if (kind === 'vote') return T('✓ Deine Stimme zählt.');
    if (kind === 'feed') return T('😋 Danke, das hat geschmeckt!');
    if (kind === 'sound') return T('🔊 Läuft im Stream!');
    if (kind === 'bits_sound') return T('💎 Danke! Läuft sofort im Stream.');
    return res.picked ? T('🎮 Du bist dran!') : T('🎮 Du stehst auf Platz {n}.', { n: res.position });
  }

  // 135 → „2:15“, 3700 → „1:01:40“
  function span(sec) {
    var s = Math.max(0, Math.round(sec));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return h ? h + ':' + two(m) + ':' + two(r) : m + ':' + two(r);
  }

  // ---------- Darstellung (nur Text, nie HTML aus den Daten) ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function msgEl(kind) {
    var m = msgs[kind];
    if (!m) return null;
    return el('p', 'msg' + (m.error ? ' is-error' : m.ok ? ' is-ok' : ''), m.text);
  }

  function when(iso) {
    var d = new Date(iso);
    var loc = LOCALES[lang] || 'de-DE';
    return d.toLocaleDateString(loc, { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' · ' +
      d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) + (lang === 'de' ? ' Uhr' : '');
  }

  function render() {
    var box = document.getElementById('content');
    var name = data.channel.name || 'StreamHelp';
    document.getElementById('channel').textContent = name;
    document.getElementById('avatar').textContent = name.charAt(0).toUpperCase();
    document.title = name + ' · StreamHelp';
    var parts = [];
    var me = data.me || {};
    // Nur Module, die der Streamer eingeschaltet hat. Links nach draußen gibt es nur im Panel (Twitch erlaubt sie sonst nicht).
    var entries = [];
    function add(mod, node) {
      if (cfg.modules[mod] === false) return;
      if (mod === 'link' && MODE !== 'panel') return;
      entries.push({ mod: mod, node: node });
    }

    // Game
    if (data.game) {
      var g = el('section', 'card game');
      g.append(el('span', 'game-ico', data.game.icon));
      var t = el('div');
      t.append(el('small', null, data.game.live ? T('Gerade im Stream') : T('Heute dran')), el('b', null, data.game.name));
      g.append(t);
      if (data.game.live) {
        var live = el('span', 'live', 'Live');
        live.lang = 'en'; // sonst macht text-transform auf Türkisch „LİVE“ daraus
        g.append(live);
      }
      add('game', g);
    }

    // Umfrage
    if (data.poll) add('poll', pollCard(data.poll, me));

    // Haustier füttern
    if (data.pet) add('pet', petCard(data.pet, me));

    // Zähler (Tode, Kills, Versuche …)
    if (data.counters && data.counters.length) add('counters', countersCard(data.counters));

    // Sounds: Zuschauer spielen einen Sound im Stream ab (Overlay); Abklingzeit prüft der Server
    if (data.sounds && data.sounds.length) add('sounds', soundsCard(data.sounds, me));
    else if (data.sounds_paused) add('sounds', pausedSoundsCard());

    // Verlosung
    if (data.giveaway && data.giveaway.open) {
      var v = el('section', 'card');
      v.append(el('h2', null, T('🍀 Verlosung')));
      v.append(el('p', null, data.giveaway.prize || T('Mach mit!')));
      v.append(el('p', 'muted', T('{n} im Lostopf', { n: data.giveaway.entries }) + (data.giveaway.followers_only ? ' · ' + T('nur Follower') : '') +
        (data.giveaway.command ? ' · ' + T('oder im Chat: {name}', { name: data.giveaway.command }) : '')));
      if (me.giveaway) {
        var done = el('button', 'btn btn--ok', T('✓ Du bist dabei'));
        done.disabled = true;
        v.append(done);
      } else {
        var join = el('button', 'btn', T('Mitmachen'));
        join.type = 'button';
        join.addEventListener('click', function () { act('giveaway'); });
        v.append(join);
      }
      var gm = msgEl('giveaway');
      if (gm && !me.giveaway) v.append(gm);
      add('giveaway', v);
    }

    // Mitspieler-Warteschlange
    if (data.queue && data.queue.open) {
      var q = el('section', 'card');
      q.append(el('h2', null, T('🎮 Mitspielen')));
      q.append(el('p', 'muted', T('{n} warten', { n: data.queue.waiting }) + (data.queue.note ? ' · ' + data.queue.note : '')));
      // Abonnenten mit Abo-Vorrang (prüft der Server bei Twitch)
      if (me.sub && data.queue.sub_first) q.append(el('p', 'muted', T('⭐ Als Abonnent stehst du weiter vorn.')));
      if (typeof me.queue === 'number' && me.queue > 0) {
        q.append(el('p', 'msg is-ok', T('Du stehst auf Platz {n}.', { n: me.queue })));
      } else {
        var form = el('form', 'row');
        var input = el('input');
        input.name = 'epic';
        input.maxLength = 32;
        input.placeholder = T('Dein Epic-Name');
        input.setAttribute('aria-label', T('Epic-Name'));
        input.value = me.epic || '';
        var go = el('button', 'btn', T('Anstellen'));
        go.type = 'submit';
        form.append(input, go);
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          act('queue', { epic: input.value.trim() });
        });
        q.append(form);
        var qm = msgEl('queue');
        if (qm) q.append(qm);
      }
      add('queue', q);
    }

    // Als Nächstes
    if (data.next) {
      var n = el('section', 'card');
      n.append(el('h2', null, T('⏰ Als Nächstes')));
      n.append(el('p', null, data.next.title), el('p', 'muted', when(data.next.at)));
      add('next', n);
    }

    // Content-Ideen
    var ideas = el('section', 'card');
    ideas.append(el('h2', null, data.game ? T('💡 Passt zu {name}', { name: data.game.name }) : T('💡 Content-Ideen')));
    if (data.placeholder) ideas.append(el('p', 'muted', T('Wir arbeiten an einer Content-Idee für dieses Game. Bis dahin passt das hier zu jedem Game:')));
    if (data.ideas.length) {
      var ul = el('ul', 'ideas');
      data.ideas.forEach(function (i) {
        var li = el('li');
        li.append(el('b', null, i.title));
        if (i.description) li.append(el('span', null, i.description));
        ul.append(li);
      });
      ideas.append(ul);
    } else {
      ideas.append(el('p', 'muted', T('Gerade keine Ideen aktiv.')));
    }
    add('ideas', ideas);

    // Link zur Seite (nur im Panel: auf dem Handy und über dem Video lässt Twitch keine Links nach draußen zu)
    if (data.channel.link && MODE === 'panel') {
      var a = el('a', 'link', T('Mitmachen auf StreamHelp →'));
      a.href = data.channel.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      add('link', a);
    }

    // Overlay: höchstens drei Karten, das Wichtigste (zum Mitmachen) zuerst – das Videobild bleibt frei
    if (MODE === 'overlay') {
      var rank = function (e) { var i = OVERLAY_ORDER.indexOf(e.mod); return i < 0 ? 99 : i; };
      entries.sort(function (a, b) { return rank(a) - rank(b); });
      entries = entries.slice(0, 3);
    }
    parts = entries.map(function (e) { return e.node; });
    if (!parts.length && (MODE === 'panel' || MODE === 'mobile')) parts.push(el('p', 'muted center', T('Gerade nichts zu zeigen.')));
    // Komponente: eine Karte nach der anderen (Punkte unten, wechselt von selbst) statt Scrollen
    if (MODE === 'component' && parts.length > 1) parts = [slides(parts)];
    else stopSlides();
    box.replaceChildren.apply(box, parts);
    tick();
  }

  var OVERLAY_ORDER = ['poll', 'giveaway', 'queue', 'sounds', 'pet', 'counters', 'game', 'next', 'ideas'];

  // ---------- Komponente: Karten nacheinander ----------
  var slideIdx = 0;
  var slideTimer = 0;
  var slideHold = 0;      // bis dahin nicht weiterschalten (Zuschauer bedient gerade etwas)
  var SLIDE_MS = 9000;
  function stopSlides() { clearInterval(slideTimer); slideTimer = 0; }
  function slides(cards) {
    var frag = el('div', 'slides-box');
    var wrap = el('div', 'slides');
    var dots = el('div', 'dots');
    dots.setAttribute('role', 'tablist');
    cards.forEach(function (c, i) {
      var s = el('div', 'slide');
      s.append(c);
      wrap.append(s);
      var d = el('button', 'dot');
      d.type = 'button';
      d.setAttribute('role', 'tab');
      d.setAttribute('aria-label', (i + 1) + '/' + cards.length);
      d.addEventListener('click', function () { show(i); hold(20000); });
      dots.append(d);
    });
    function show(i) {
      slideIdx = (i + cards.length) % cards.length;
      Array.prototype.forEach.call(wrap.children, function (n, k) { n.classList.toggle('is-active', k === slideIdx); });
      Array.prototype.forEach.call(dots.children, function (n, k) { n.setAttribute('aria-selected', String(k === slideIdx)); n.classList.toggle('is-active', k === slideIdx); n.classList.toggle('is-done', k < slideIdx); });
    }
    // Angehalten: der Fortschrittsbalken bleibt voll stehen, bis wieder weitergeschaltet wird
    function hold(ms) { slideHold = Date.now() + ms; frag.classList.add('is-held'); }
    if (Date.now() < slideHold) frag.classList.add('is-held');
    show(Math.min(slideIdx, cards.length - 1));
    // Eingabe/Klick im Feld: Weiterschalten pausieren
    wrap.addEventListener('focusin', function () { hold(30000); });
    wrap.addEventListener('pointerdown', function () { hold(20000); });
    stopSlides();
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!calm) {
      slideTimer = setInterval(function () {
        var a = document.activeElement;
        if (Date.now() < slideHold || document.hidden || (a && a.tagName === 'INPUT')) return;
        frag.classList.remove('is-held');
        show(slideIdx + 1);
      }, SLIDE_MS);
    }
    frag.append(wrap, dots);
    return frag;
  }

  // Sounds: gratis (mit Wartezeit) oder – wenn der Streamer es anbietet und Twitch Bits erlaubt – sofort gegen Bits.
  // ⭐ = nur für Abonnenten (prüft der Server bei Twitch).
  function soundsCard(list, me) {
    var c = el('section', 'card');
    c.append(el('h2', null, T('🔊 Sounds')));
    var product = bitsProduct();
    if (!product) soundMode = 'free';
    if (product) {
      var modes = el('div', 'sound-modes');
      modes.setAttribute('role', 'group');
      [['free', T('Gratis')], ['bits', T('💎 Sofort · {n} Bits', { n: product.cost.amount })]].forEach(function (m) {
        var b = el('button', 'sound-mode' + (soundMode === m[0] ? ' is-on' : ''), m[1]);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(soundMode === m[0]));
        b.addEventListener('click', function () { soundMode = m[0]; render(); });
        modes.append(b);
      });
      c.append(modes);
    }
    var box = el('div', 'sounds');
    var anySub = false;
    list.slice(0, 20).forEach(function (s) {
      var locked = s.sub && me.sub === false;
      if (s.sub) anySub = true;
      var b = el('button', 'btn' + (s.sub ? ' is-sub' : '') + (locked ? ' is-locked' : ''), (s.sub ? '⭐ ' : '') + String(s.name || '').slice(0, 24));
      b.type = 'button';
      b.disabled = !!busy.sound || !!busy.bits_sound;
      b.addEventListener('click', function () {
        if (locked) { msgs.sound = { error: true, text: T(REASONS.sub) }; render(); return; }
        if (soundMode === 'bits' && product) buySound(s.id, product.sku);
        else act('sound', { sound: s.id });
      });
      box.append(b);
    });
    c.append(box, el('p', 'muted hint', soundMode === 'bits' ? T('Tippe auf einen Sound – er läuft sofort, ohne Wartezeit.') : T('Tippe auf einen Sound – er läuft im Stream.')));
    if (anySub) c.append(el('p', 'muted hint', T('⭐ = nur für Abonnenten')));
    var m = msgEl('sound');
    if (m) c.append(m);
    return c;
  }

  // Streamer oder Mods haben die Soundkäufe pausiert (OBS nicht verbunden) – keine Knöpfe, nur ein Hinweis
  function pausedSoundsCard() {
    var c = el('section', 'card');
    c.append(el('h2', null, T('🔊 Sounds')), el('p', 'muted', '⏸️ ' + T(REASONS.paused)));
    return c;
  }

  // ---------- Bits (Twitch.ext.bits) ----------
  // Produkte legt der Entwickler in der Twitch-Konsole an (sound_50 … sound_500), der Streamer wählt eins.
  // Twitch zeigt den Kauf-Dialog; danach kommt eine signierte Quittung, die twitch-ext prüft.
  var soundMode = 'free';
  var bitsProducts = DEMO ? [{ sku: 'sound_100', cost: { amount: 100, type: 'bits' } }] : [];
  var bitsPending = null; // Sound, der gerade gekauft wird
  function bitsProduct() {
    var sku = data && data.sound_bits;
    if (!sku) return null;
    if (!DEMO && !(ext.features && ext.features.isBitsEnabled)) return null;
    for (var i = 0; i < bitsProducts.length; i++) if (bitsProducts[i].sku === sku) return bitsProducts[i];
    return null;
  }
  function buySound(id, sku) {
    if (DEMO) { act('bits_sound', { sound: id, receipt: 'demo' }); return; }
    bitsPending = id;
    msgs.sound = { text: '…' };
    render();
    ext.bits.useBits(sku);
  }
  function setupBits() {
    if (!ext.bits || !ext.features) return;
    var fetchProducts = function () {
      if (!ext.features.isBitsEnabled) { bitsProducts = []; if (data) render(); return; }
      ext.bits.getProducts().then(function (list) { bitsProducts = list || []; if (data) render(); }).catch(function () { bitsProducts = []; });
    };
    fetchProducts();
    if (ext.features.onChanged) ext.features.onChanged(function (changed) { if (changed.indexOf('isBitsEnabled') >= 0) fetchProducts(); });
    ext.bits.onTransactionComplete(function (tx) {
      // Nur der eigene Kauf (Twitch meldet auch Käufe anderer Zuschauer)
      if (!tx || String(tx.initiator).toLowerCase() !== 'current_user' || !bitsPending) return;
      var id = bitsPending;
      bitsPending = null;
      act('bits_sound', { sound: id, receipt: tx.transactionReceipt });
    });
    if (ext.bits.onTransactionCancelled) {
      ext.bits.onTransactionCancelled(function () {
        if (!bitsPending) return;
        bitsPending = null;
        msgs.sound = { error: true, text: T('Abgebrochen – es wurden keine Bits abgebucht.') };
        render();
      });
    }
  }

  function pollCard(poll, me) {
    var open = poll.status === 'open' && !(poll.ends_at && Date.parse(poll.ends_at) <= Date.now());
    var c = el('section', 'card poll');
    var head = el('h2', null, T('📊 Umfrage'));
    if (open && poll.ends_at) {
      var left = el('span', 'poll-time');
      left.dataset.ends = poll.ends_at;
      head.append(left);
    } else if (!open) {
      head.append(el('span', 'poll-time is-done', T('beendet')));
    }
    c.append(head, el('p', 'poll-q', poll.question));
    var max = Math.max.apply(null, poll.counts.concat([0]));
    var list = el('div', 'poll-opts');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', poll.question);
    poll.options.forEach(function (label, i) {
      var n = poll.counts[i] || 0;
      var pct = poll.total ? Math.round((100 * n) / poll.total) : 0;
      var mine = me.vote === i + 1;
      var b = el('button', 'poll-opt' + (mine ? ' is-mine' : '') + (!open && n === max && n > 0 ? ' is-win' : ''));
      b.type = 'button';
      b.disabled = !open || !!busy.vote;
      b.setAttribute('aria-pressed', String(mine));
      b.style.setProperty('--p', pct + '%');
      b.append(el('span', 'poll-n', String(i + 1)), el('span', 'poll-label', label), el('span', 'poll-pct', pct + ' %'));
      b.addEventListener('click', function () { if (!mine) act('vote', { choice: i + 1 }); });
      list.append(b);
    });
    c.append(list);
    var info = T('Stimmen: {n}', { n: poll.total });
    if (open && poll.chat) info += ' · ' + T('oder im Chat: {name}', { name: '!vote 1–' + poll.options.length });
    c.append(el('p', 'muted', info));
    if (open && !me.vote && !msgs.vote) c.append(el('p', 'muted hint', T('Tippe auf eine Antwort – ändern geht bis zum Ende.')));
    var m = msgEl('vote');
    if (m && open) c.append(m);
    return c;
  }

  function petCard(pet, me) {
    var c = el('section', 'card pet');
    var egg = pet.stage === 'egg';
    var hungry = !pet.last_fed_at || Date.now() - Date.parse(pet.last_fed_at) > pet.hungry_after * 60000;
    var head = el('div', 'game');
    head.append(el('span', 'game-ico' + (hungry ? ' is-hungry' : ''), egg ? '🥚' : (PET_ICON[pet.species] || '🦖')));
    var t = el('div');
    t.append(el('small', null, egg ? T('Das Ei braucht Futter, damit es schlüpft.') : hungry ? T('{name} hat Hunger!', { name: pet.name }) : T('{name} ist satt.', { name: pet.name })),
      el('b', null, pet.name));
    head.append(t);
    c.append(head);
    var sub = T('{n}× gefüttert', { n: pet.fed_count });
    if (pet.last_fed_by) sub += ' · ' + T('zuletzt von {name}', { name: pet.last_fed_by });
    c.append(el('p', 'muted', sub));
    var wait = me.feed_wait || 0;
    var b = el('button', 'btn', T('🍖 Füttern'));
    b.type = 'button';
    b.disabled = wait > 0 || !!busy.feed;
    if (wait > 0) {
      b.dataset.wait = String(Date.now() + wait * 1000);
      b.textContent = T('🍖 Wieder in {n}', { n: span(wait) });
    }
    b.addEventListener('click', function () { act('feed'); });
    var row = el('div', 'row');
    row.append(b, el('span', 'muted pet-cmd', T('oder im Chat: {name}', { name: pet.command })));
    c.append(row);
    var m = msgEl('feed');
    if (m) c.append(m);
    return c;
  }

  function countersCard(list) {
    var c = el('section', 'card counters');
    c.append(el('h2', null, T('🔢 Zähler')));
    var grid = el('div', 'counter-grid');
    list.forEach(function (x) {
      var item = el('div', 'counter');
      item.append(el('span', 'counter-emoji', x.emoji), el('b', 'counter-value', String(x.value)), el('small', null, x.label));
      if (x.command) item.title = '!' + x.command;
      grid.append(item);
    });
    c.append(grid);
    var cmds = list.filter(function (x) { return x.command; }).map(function (x) { return '!' + x.command; });
    if (cmds.length) c.append(el('p', 'muted hint', T('Stand im Chat: {name}', { name: cmds.slice(0, 3).join(' · ') })));
    return c;
  }

  // Jede Sekunde: Restzeit der Umfrage, Wartezeit beim Füttern
  function tick() {
    clearInterval(ticker);
    var run = function () {
      var still = false;
      document.querySelectorAll('[data-ends]').forEach(function (n) {
        var s = (Date.parse(n.dataset.ends) - Date.now()) / 1000;
        if (s <= 0) { n.removeAttribute('data-ends'); load(); return; }
        n.textContent = T('noch {n}', { n: span(s) });
        still = true;
      });
      document.querySelectorAll('[data-wait]').forEach(function (n) {
        var s = (Number(n.dataset.wait) - Date.now()) / 1000;
        if (s <= 0) {
          n.removeAttribute('data-wait');
          n.disabled = false;
          n.textContent = T('🍖 Füttern');
          if (data && data.me) data.me.feed_wait = 0;
          return;
        }
        n.textContent = T('🍖 Wieder in {n}', { n: span(s) });
        still = true;
      });
      if (!still) clearInterval(ticker);
    };
    run();
    ticker = setInterval(run, 1000);
  }

  function renderError(text) {
    var box = document.getElementById('content');
    box.replaceChildren(el('p', 'muted center', text));
  }

  // ---------- Start ----------
  var loading = document.querySelector('#content p');
  if (loading) loading.textContent = T('Lädt …');
  applyChrome();
  if (DEMO) {
    // Vorschau in config.html: Einstellungen kommen per Adresse (?cfg=…) und später per postMessage
    try { if (QUERY.get('cfg')) useConfig(JSON.parse(decodeURIComponent(escape(atob(QUERY.get('cfg').replace(/-/g, '+').replace(/_/g, '/')))))); } catch (e) { /* Standard */ }
    window.addEventListener('message', function (e) {
      // Nur von der Seite, in der die Vorschau steckt (config.html), und nur Einstellungen – nichts Geheimes
      if (e.source !== window.parent || !e.data || e.data.type !== 'streamhelp-cfg') return;
      useConfig(e.data.cfg, e.data.view || null);
    });
    load();
    return;
  }
  ext.onAuthorized(function (auth) {
    token = auth.token;
    load();
    // Twitch-ID gerade freigegeben: die angefangene Aktion jetzt ausführen
    if (pending && ext.viewer && ext.viewer.isLinked) {
      var p = pending;
      pending = null;
      setTimeout(function () { act(p.kind, p.extra); }, 300);
    }
  });
  setupBits();
  ext.onContext(function (ctx) {
    var relang = false;
    if (ctx && ctx.language && ctx.language !== viewerLang) { viewerLang = ctx.language; relang = cfg.lang === 'auto'; }
    if (ctx && ctx.theme) ctxTheme = ctx.theme;
    if ((ctx && ctx.theme) || relang) { var before = lang; applyChrome(); if (lang !== before && data) render(); }
  });
  if (ext.configuration && ext.configuration.onChanged) {
    ext.configuration.onChanged(function () {
      var b = ext.configuration.broadcaster;
      useConfig(CFGLIB.parse(b && b.content));
    });
  }
  if (ext.onVisibilityChanged) {
    ext.onVisibilityChanged(function (visible) {
      if (visible) load();
      else clearTimeout(timer);
    });
  }

  // ---------- Beispieldaten (ohne Twitch) ----------
  function demoCall(action, extra) {
    var store = window.__demo || (window.__demo = {
      channel: { name: 'StreamHelp', login: 'streamhelp', link: '../index.html' },
      game: { id: 'fortnite', name: 'Fortnite', icon: '🏝️', live: true, category: 'Fortnite' },
      ideas: [
        { kind: 'wheel', title: T('Fortnite-Glücksrad'), description: T('Vier Varianten, die die nächste Runde auf den Kopf stellen.') },
        { kind: 'bingo', title: T('Fortnite-Bingo'), description: T('Items finden, Karte abhaken.') },
        { kind: 'prank', title: T('Ärgere den Streamer'), description: T('Tomaten, Torten und Sounds per Kanalpunkte.') },
      ],
      placeholder: false,
      next: { title: 'Subathon', at: new Date(Date.now() + 2 * 86400000).toISOString() },
      giveaway: { open: true, prize: T('Fortnite-Skin nach Wahl'), command: '!mitmachen', followers_only: true, entries: 12, round: 1 },
      queue: { open: true, waiting: 4, note: T('Squads ab 20 Uhr'), sub_first: true },
      poll: { status: 'open', round: 1, question: T('Was spielen wir als Nächstes?'), options: ['Fortnite', 'Minecraft', 'Just Chatting'], counts: [7, 4, 2], total: 13, ends_at: new Date(Date.now() + 5 * 60000).toISOString(), chat: true },
      pet: { name: 'Rexi', species: 'dino', stage: 'adult', command: '!feed', fed_count: 128, last_fed_by: 'Mia', last_fed_at: new Date(Date.now() - 60 * 60000).toISOString(), hungry_after: 45 },
      counters: [{ emoji: '💀', label: T('Tode'), value: 17, command: 'deaths' }, { emoji: '🔫', label: 'Kills', value: 42, command: 'kills' }, { emoji: '👑', label: 'Wins', value: 3, command: 'wins' }],
      sounds: ['Airhorn', 'Sad violin', 'Gong', 'Whistle', 'Drumroll', 'Applause'].map(function (n, i) { return { id: 's' + i, name: n, sub: i >= 4 }; }),
      sound_bits: 'sound_100',
      me: { shared: true, giveaway: false, queue: null, epic: '', vote: null, feed_wait: 0, sub: false },
    });
    var reply;
    if (action === 'vote') {
      var p = store.poll;
      var old = store.me.vote;
      if (old) p.counts[old - 1] -= 1; else p.total += 1;
      p.counts[extra.choice - 1] += 1;
      store.me.vote = extra.choice;
      reply = { ok: true, choice: extra.choice, counts: p.counts.slice(), total: p.total };
    } else if (action === 'feed') {
      if (store.me.feed_wait > 0) reply = { ok: false, reason: 'cooldown', wait: store.me.feed_wait };
      else {
        store.pet.fed_count += 1;
        store.pet.last_fed_by = T('Demo-Zuschauer');
        store.pet.last_fed_at = new Date().toISOString();
        store.me.feed_wait = 600;
        reply = { ok: true, fed_count: store.pet.fed_count };
      }
    } else if (action === 'sound') {
      var snd = store.sounds.filter(function (x) { return x.id === extra.sound; })[0];
      reply = snd && snd.sub && !store.me.sub ? { ok: false, reason: 'sub' } : { ok: true };
    } else if (action === 'bits_sound') {
      reply = { ok: true };
    } else if (action === 'giveaway') {
      store.me.giveaway = true;
      store.giveaway.entries += 1;
      reply = { ok: true };
    } else if (action === 'queue') {
      if (!extra.epic || extra.epic.length < 3) reply = { ok: false, reason: 'epic' };
      else { store.queue.waiting += 1; store.me.queue = store.queue.waiting; store.me.epic = extra.epic; reply = { ok: true, position: store.me.queue }; }
    } else {
      reply = JSON.parse(JSON.stringify(store));
    }
    return new Promise(function (resolve) { setTimeout(function () { resolve(reply); }, 150); });
  }
})();
