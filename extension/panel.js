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
  if (MOBILE) document.documentElement.classList.add('is-mobile');
  if (QUERY.get('theme') === 'light') document.documentElement.dataset.theme = 'light';

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
  setLang(QUERY.get('language') || navigator.language);
  function T(source, vars) {
    var out = (I18N.dicts[lang] || {})[source] || source;
    if (vars) out = out.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? String(vars[k]) : m; });
    return out;
  }

  var token = null;
  var data = null;
  var pending = null;   // Aktion, die nach der Freigabe der Twitch-ID ausgeführt wird
  var msgs = {};        // Rückmeldung je Bereich (giveaway, queue, vote, feed)
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
    if (!DEMO && data && data.me && !data.me.shared) {
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
        // Umfrage: Stand sofort zeigen, nicht erst nach dem Neuladen
        if (kind === 'vote' && data && data.poll && res.counts) {
          data.poll.counts = res.counts;
          data.poll.total = res.total;
          data.me.vote = res.choice;
        }
      } else if (res.reason === 'cooldown' && res.wait) {
        if (data && data.me) data.me.feed_wait = res.wait;
        msgs[kind] = { error: true, text: T('Du kannst in {n} wieder füttern.', { n: span(res.wait) }) };
      } else {
        msgs[kind] = { error: true, text: T(REASONS[res.reason] || 'Hat nicht geklappt.') };
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

    // Umfrage
    if (data.poll) parts.push(pollCard(data.poll, me));

    // Haustier füttern
    if (data.pet) parts.push(petCard(data.pet, me));

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

    // Link zur Seite (nicht auf dem Handy: Twitch lässt dort keine Links nach draußen zu)
    if (data.channel.link && !MOBILE) {
      var a = el('a', 'link', T('Mitmachen auf StreamHelp →'));
      a.href = data.channel.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      parts.push(a);
    }

    box.replaceChildren.apply(box, parts);
    tick();
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
    if (open && !me.vote && !msgs.vote) c.append(el('p', 'muted', T('Tippe auf eine Antwort – ändern geht bis zum Ende.')));
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
      poll: { status: 'open', round: 1, question: 'Was spielen wir als Nächstes?', options: ['Fortnite', 'Minecraft', 'Just Chatting'], counts: [7, 4, 2], total: 13, ends_at: new Date(Date.now() + 5 * 60000).toISOString(), chat: true },
      pet: { name: 'Rexi', species: 'dino', stage: 'adult', command: '!füttern', fed_count: 128, last_fed_by: 'Mia', last_fed_at: new Date(Date.now() - 60 * 60000).toISOString(), hungry_after: 45 },
      me: { shared: true, giveaway: false, queue: null, epic: '', vote: null, feed_wait: 0 },
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
        store.pet.last_fed_by = 'Demo-Zuschauer';
        store.pet.last_fed_at = new Date().toISOString();
        store.me.feed_wait = 600;
        reply = { ok: true, fed_count: store.pet.fed_count };
      }
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
