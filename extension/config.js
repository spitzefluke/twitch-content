// Konfigurationsseite der Twitch-Erweiterung: Streamer stellt vorher alles ein, die Vorschau (panel.html?demo)
// bekommt jede Änderung per postMessage, „Speichern“ schreibt in den Twitch-Konfigurationsdienst
// (Segment „broadcaster“, Version „1“). Ohne Twitch (direkt im Browser geöffnet) bleibt das Speichern aus und
// die Einstellungen stehen als Text unten – so lässt sich alles ausprobieren.
(function () {
  'use strict';

  var CFG = window.STREAMHELP_CFG;
  var DICT = (window.PANEL_I18N && window.PANEL_I18N.dicts.en) || {};
  var UI = 'en'; // Sprache dieser Seite (Standard Englisch); unabhängig von der Panel-Sprache
  var tr = function (s) { return UI === 'en' ? (DICT[s] || s) : s; };
  var ext = window.Twitch && window.Twitch.ext;
  var STANDALONE = !ext || window.self === window.top;
  var draft = CFG.preset('starter');
  var saved = null;      // zuletzt gespeicherter Stand (geprüft), zum Erkennen von „ungespeichert“
  var authorized = false;

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var frame = $('#preview');
  var stage = $('#stage');
  var saveBtn = $('#save');
  var msg = $('#msg');

  var MODE_HINT = {
    panel: 'Das Panel liegt unter dem Stream. In der Twitch-Entwicklerkonsole muss „Panel“ aktiv sein (README → Twitch-Erweiterung).',
    component: 'Die Komponente liegt auf dem Video. Du schiebst und skalierst sie später im Creator-Dashboard unter Erweiterungen. In der Entwicklerkonsole muss „Komponente“ aktiv sein.',
    overlay: 'Das Overlay liegt über dem ganzen Videobild. Die Ecke legst du hier fest; wähle wenige Module, damit das Bild frei bleibt. In der Entwicklerkonsole muss „Overlay“ aktiv sein.',
  };
  var STAGE_HINT = {
    panel: 'So sieht das Panel mit Beispieldaten aus.',
    component: 'So sieht die Komponente auf dem Video aus (Beispieldaten, gestreifter Hintergrund = dein Videobild).',
    overlay: 'So sieht das Overlay in der gewählten Ecke aus (Beispieldaten, gestreifter Hintergrund = dein Videobild).',
  };

  // ---------- Entwurf ⇄ Formular ----------
  function toForm() {
    $$('input[name="mode"]').forEach(function (r) { r.checked = r.value === draft.mode; });
    $('select[name="corner"]').value = draft.corner;
    $('select[name="size"]').value = draft.size;
    $('select[name="lang"]').value = draft.lang;
    $('select[name="theme"]').value = draft.theme;
    $('input[name="compact"]').checked = draft.compact;
    $$('input[name="mod"]').forEach(function (c) { c.checked = draft.modules[c.value] !== false; });
    $$('.preset').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.preset === draft.preset)); });
    refresh();
  }

  function fromForm() {
    var checked = $('input[name="mode"]:checked');
    draft.mode = checked ? checked.value : 'panel';
    draft.corner = $('select[name="corner"]').value;
    draft.size = $('select[name="size"]').value;
    draft.lang = $('select[name="lang"]').value;
    draft.theme = $('select[name="theme"]').value;
    draft.compact = $('input[name="compact"]').checked;
    $$('input[name="mod"]').forEach(function (c) { draft.modules[c.value] = c.checked; });
  }

  // Einstellungen, wie sie gespeichert und angezeigt werden (geprüft)
  var current = function () { return CFG.clean(draft); };

  function refresh() {
    var c = current();
    var overlay = draft.mode === 'overlay';
    $('#overlay-opts').hidden = !overlay;
    // Links nach draußen gibt es nur im Panel
    var link = $('#mod-link');
    link.disabled = draft.mode !== 'panel';
    $('#mode-hint').textContent = tr(MODE_HINT[draft.mode]);
    stage.dataset.mode = draft.mode;
    $('#stage-hint').textContent = tr(STAGE_HINT[draft.mode]);
    pushPreview(c);
    markDirty();
    $('#raw-json').textContent = JSON.stringify(c, null, 2);
  }

  // ---------- Vorschau ----------
  var frameReady = false;
  function pushPreview(c) {
    if (!frameReady || !frame.contentWindow) return;
    // Geht nur an das eigene Vorschau-Fenster; die Einstellungen sind nicht geheim
    frame.contentWindow.postMessage({ type: 'streamhelp-cfg', cfg: c }, '*');
  }
  frame.addEventListener('load', function () { frameReady = true; pushPreview(current()); });

  // ---------- Speichern ----------
  var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  function markDirty() {
    var dirty = !saved || !same(saved, current());
    saveBtn.disabled = STANDALONE || !authorized || !dirty;
    if (dirty && saved && !msg.classList.contains('is-error')) {
      msg.className = 'msg';
      msg.textContent = tr('Noch nicht gespeichert.');
    }
  }

  function say(text, kind) {
    msg.className = 'msg' + (kind ? ' is-' + kind : '');
    msg.textContent = tr(text);
  }

  saveBtn.addEventListener('click', function () {
    var c = current();
    var json = JSON.stringify(c);
    if (json.length > 4800) { say('Das ist zu lang für Twitch (höchstens 5 KB).', 'error'); return; }
    try {
      ext.configuration.set('broadcaster', '1', json);
      saved = c;
      say('✓ Gespeichert – Zuschauer sehen es in wenigen Sekunden.', 'ok');
      markDirty();
    } catch (e) {
      say('Speichern hat nicht geklappt. Lade die Seite neu und versuch es noch einmal.', 'error');
    }
  });

  // ---------- Bedienung ----------
  $$('.preset').forEach(function (b) {
    b.addEventListener('click', function () {
      var keepLang = draft.lang;
      draft = CFG.preset(b.dataset.preset);
      draft.lang = keepLang;            // gewählte Sprache bleibt beim Preset-Wechsel
      toForm();
    });
  });
  document.addEventListener('input', function () { fromForm(); draft.preset = 'custom'; $$('.preset').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); }); refresh(); });
  document.addEventListener('change', function () { fromForm(); draft.preset = 'custom'; $$('.preset').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); }); refresh(); });

  // ---------- Sprache dieser Seite ----------
  function applyUI() {
    document.documentElement.lang = UI;
    document.title = tr('StreamHelp einrichten');
    var skip = { SCRIPT: 1, STYLE: 1, PRE: 1, IFRAME: 1 }, skipId = { 'mode-hint': 1, 'stage-hint': 1, msg: 1 };
    (function walk(n) {
      if (n.nodeType === 3) {
        if (n.__s === undefined) { var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(n.nodeValue); n.__a = m[1]; n.__s = m[2]; n.__b = m[3]; }
        if (n.__s) n.nodeValue = n.__a + tr(n.__s) + n.__b;
        return;
      }
      if (n.nodeType !== 1 || skip[n.tagName] || skipId[n.id]) return;
      ['placeholder', 'title', 'aria-label'].forEach(function (a) {
        if (!n.hasAttribute(a)) return;
        if (n['__' + a] === undefined) n['__' + a] = n.getAttribute(a);
        n.setAttribute(a, tr(n['__' + a]));
      });
      Array.prototype.forEach.call(n.childNodes, walk);
    })(document.body);
    $$('[data-ui]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.ui === UI)); });
  }
  $$('[data-ui]').forEach(function (b) { b.addEventListener('click', function () { UI = b.dataset.ui; applyUI(); refresh(); }); });

  // ---------- Start ----------
  if (STANDALONE) {
    $('#raw').hidden = false;
    say('Ohne Twitch geöffnet: Vorschau und Einstellungen funktionieren, Speichern nicht.');
  } else {
    ext.onAuthorized(function () { authorized = true; markDirty(); });
    // Gespeicherte Einstellungen laden (auch wenn sie ein anderes Gerät geändert hat)
    ext.configuration.onChanged(function () {
      var b = ext.configuration.broadcaster;
      if (!b || !b.content) return;
      var c = CFG.parse(b.content);
      saved = c;
      draft = c;
      toForm();
    });
  }
  applyUI();
  toForm();
})();
