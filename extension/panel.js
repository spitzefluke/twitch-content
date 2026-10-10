// Twitch-Panel von StreamHelp: aktuelles Game mit passenden Content-Ideen, Mitmachen per Klick
// (Verlosung, Mitspieler-Warteschlange) und Link zur Seite. Daten kommen von der Edge Function
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

  // Sprache: Twitch hängt ?language=… an die Panel-Adresse und meldet sie in onContext
  var I18N = window.PANEL_I18N || { dicts: {} };
  var LOCALES = { de: 'de-DE', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', nl: 'nl-NL', pl: 'pl-PL', pt: 'pt-BR', tr: 'tr-TR', ru: 'ru-RU' };
  var lang = 'de';
  function setLang(code) {
    var c = String(code || '').slice(0, 2).toLowerCase();
    var next = I18N.dicts[c] || c === 'de' ? c : 'de';
    if (next === lang) return false;
    lang = next;
    document.documentElement.lang = lang;
    return true;
  }
  setLang(new URLSearchParams(location.search).get('language') || navigator.language);
  function T(source, vars) {
    var out = (I18N.dicts[lang] || {})[source] || source;
    if (vars) out = out.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? String(vars[k]) : m; });
    return out;
  }

  var token = null;
  var data = null;
  var pending = null;   // Aktion, die nach der Freigabe der Twitch-ID ausgeführt wird
  var msgs = {};        // Rückmeldung je Bereich (giveaway, queue)
  var timer = 0;

  // Texte auf Deutsch – T() übersetzt beim Anzeigen (extension/panel-i18n.js)
  var REASONS = {
    share: 'Gib deine Twitch-ID frei (Twitch fragt gleich nach) – dann klappt’s.',
    closed: 'Gerade geschlossen.',
    follower: 'Nur für Follower: Folge dem Kanal und versuch es noch einmal.',
    twice: 'Du bist schon dabei.',
    kicked: 'Bei dieser Verlosung kannst du nicht mehr mitmachen.',
    streamer: 'Der Streamer lost nicht selbst mit 😉',
    check: 'Die Follower-Prüfung klappt gerade nicht – versuch es gleich noch einmal.',
    epic: 'Bitte deinen Epic-Namen eintragen (3–32 Zeichen).',
    full: 'Die Warteschlange ist voll.',
    auth: 'Bitte die Seite neu laden.',
    unknown: 'Dieser Kanal ist (noch) nicht bei StreamHelp.',
    setup: 'StreamHelp ist für dieses Panel noch nicht fertig eingerichtet.',
  };

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
      data = d;
      render();
    }).catch(function (e) {
      renderError(T(REASONS[e.reason] || e.message));
    }).then(function () {
      timer = setTimeout(load, POLL_MS);
    });
  }

  function act(kind, extra) {
    if (!DEMO && data && data.me && !data.me.shared) {
      // Twitch-ID freigeben lassen, danach automatisch weiter
      pending = { kind: kind, extra: extra };
      msgs[kind] = { text: T(REASONS.share) };
      render();
      ext.actions.requestIdShare();
      return;
    }
    msgs[kind] = { text: '…' };
    render();
    call(kind, extra).then(function (res) {
      if (res.ok) {
        msgs[kind] = { ok: true, text: kind === 'giveaway' ? T('🍀 Du bist dabei – viel Glück!') : (res.picked ? T('🎮 Du bist dran!') : T('🎮 Du stehst auf Platz {n}.', { n: res.position })) };
      } else {
        msgs[kind] = { error: true, text: T(REASONS[res.reason] || 'Hat nicht geklappt.') };
      }
      load();
    }).catch(function (e) {
      msgs[kind] = { error: true, text: T(REASONS[e.reason] || e.message) };
      render();
    });
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
    document.getElementById('channel').textContent = data.channel.name;
    var parts = [];
    var me = data.me || {};

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
      parts.push(g);
    }

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
      parts.push(v);
    }

    // Mitspieler-Warteschlange
    if (data.queue && data.queue.open) {
      var q = el('section', 'card');
      q.append(el('h2', null, T('🎮 Mitspielen')));
      q.append(el('p', 'muted', T('{n} warten', { n: data.queue.waiting }) + (data.queue.note ? ' · ' + data.queue.note : '')));
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
      parts.push(q);
    }

    // Als Nächstes
    if (data.next) {
      var n = el('section', 'card');
      n.append(el('h2', null, T('⏰ Als Nächstes')));
      n.append(el('p', null, data.next.title), el('p', 'muted', when(data.next.at)));
      parts.push(n);
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
    parts.push(ideas);

    // Link zur Seite
    if (data.channel.link) {
      var a = el('a', 'link', T('Mitmachen auf StreamHelp →'));
      a.href = data.channel.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      parts.push(a);
    }

    box.replaceChildren.apply(box, parts);
  }

  function renderError(text) {
    var box = document.getElementById('content');
    box.replaceChildren(el('p', 'muted center', text));
  }

  // ---------- Start ----------
  var loading = document.querySelector('#content p');
  if (loading) loading.textContent = T('Lädt …');
  if (DEMO) {
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
  ext.onContext(function (ctx) {
    if (ctx && ctx.theme) document.documentElement.dataset.theme = ctx.theme;
    if (ctx && ctx.language && setLang(ctx.language) && data) render();
  });
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
        { kind: 'wheel', title: 'Fortnite-Glücksrad', description: 'Vier Varianten, die die nächste Runde auf den Kopf stellen.' },
        { kind: 'bingo', title: 'Fortnite-Bingo', description: 'Items finden, Karte abhaken.' },
        { kind: 'prank', title: 'Ärgere den Streamer', description: 'Tomaten, Torten und Sounds per Kanalpunkte.' },
      ],
      placeholder: false,
      next: { title: 'Subathon', at: new Date(Date.now() + 2 * 86400000).toISOString() },
      giveaway: { open: true, prize: 'Fortnite-Skin nach Wahl', command: '!mitmachen', followers_only: true, entries: 12, round: 1 },
      queue: { open: true, waiting: 4, note: 'Squads ab 20 Uhr' },
      me: { shared: true, giveaway: false, queue: null, epic: '' },
    });
    var reply;
    if (action === 'giveaway') {
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
