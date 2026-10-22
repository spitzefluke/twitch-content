// Gemeinsame Einstellungen der Twitch-Erweiterung (Panel, Komponente, Overlay) und der Konfigurationsseite.
// Der Streamer stellt alles vorher in config.html ein; gespeichert wird es im Twitch-Konfigurationsdienst
// (Segment „broadcaster“, höchstens 5 KB) und von panel.js bei jedem Zuschauer gelesen.
// Alles hier wird geprüft (clean), bevor es angezeigt wird – nie HTML aus den Einstellungen.
// Gespeichert sind nur Auswahlwerte (keine freien Texte), alte Felder (z. B. „ad“) fallen beim Prüfen weg.
(function () {
  'use strict';

  var VERSION = 1;
  var MODES = ['panel', 'component', 'overlay'];
  // Ansichten mit eigenem Design. Welche läuft, bestimmt Twitch (anchor/platform) – „mode“ unten ist nur Altlast und wird nicht mehr ausgewertet.
  var VIEWS = ['panel', 'mobile', 'component', 'overlay'];
  var CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  var SIZES = ['s', 'm', 'l'];
  // Panel-Sprache: „auto“ = Sprache des Zuschauers (Twitch meldet sie), sonst fest
  var LANGS = ['auto', 'de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'tr'];
  var MODULES = ['game', 'poll', 'pet', 'counters', 'giveaway', 'queue', 'next', 'ideas', 'link', 'sounds'];
  // Werbung gibt es in der Erweiterung bewusst nicht: Twitch verbietet sie dort (Extension-Richtlinie 4.4).
  // Gekennzeichnete Werbung geht über das Laufband im OBS-Overlay.

  // Zwei Ausgangspunkte für zwei Arten von Streamern – danach lässt sich alles einzeln ändern.
  //  starter: komplett neu, soll einfach und ruhig bleiben
  //  noaff:   kein Affiliate/Partner – nur Funktionen, die ohne Kanalpunkte, Bits und Abos laufen
  var PRESETS = {
    starter: {
      mode: 'panel', compact: false,
      modules: { game: true, poll: true, pet: false, counters: false, giveaway: false, queue: false, next: true, ideas: true, link: true, sounds: false },
    },
    noaff: {
      mode: 'panel', compact: false,
      modules: { game: true, poll: true, pet: true, counters: true, giveaway: true, queue: true, next: true, ideas: true, link: true, sounds: true },
    },
  };

  function defaults() {
    return {
      v: VERSION,
      preset: 'starter',
      mode: 'panel',
      theme: 'auto',
      compact: false,
      corner: 'bottom-left',
      size: 'm',
      lang: 'auto',
      modules: { game: true, poll: true, pet: true, counters: true, giveaway: true, queue: true, next: true, ideas: true, link: true, sounds: false },
    };
  }

  var pick = function (v, list, fallback) { return list.indexOf(v) >= 0 ? v : fallback; };

  // Beliebige (auch kaputte oder alte) Eingabe → gültige Einstellungen
  function clean(input) {
    var base = defaults();
    var raw = input && typeof input === 'object' ? input : {};
    var out = {
      v: VERSION,
      preset: pick(raw.preset, ['starter', 'noaff', 'custom'], 'starter'),
      mode: pick(raw.mode, MODES, base.mode),
      theme: pick(raw.theme, ['auto', 'dark', 'light'], 'auto'),
      compact: !!raw.compact,
      corner: pick(raw.corner, CORNERS, base.corner),
      size: pick(raw.size, SIZES, base.size),
      lang: pick(raw.lang, LANGS, 'auto'),
      modules: {},
    };
    var mods = raw.modules && typeof raw.modules === 'object' ? raw.modules : {};
    MODULES.forEach(function (m) { out.modules[m] = m in mods ? !!mods[m] : base.modules[m]; });
    return out;
  }

  // Entwurf für die Konfigurationsseite
  function preset(name) {
    var p = PRESETS[name] || PRESETS.starter;
    var d = defaults();
    d.preset = PRESETS[name] ? name : 'starter';
    d.mode = p.mode;
    d.compact = p.compact;
    Object.keys(p.modules).forEach(function (m) { d.modules[m] = p.modules[m]; });
    return d;
  }

  // Aus dem Twitch-Konfigurationsdienst lesen (JSON-Text) – bei Fehlern Standardwerte
  function parse(content) {
    try { return clean(JSON.parse(content)); } catch (e) { return clean(null); }
  }

  window.STREAMHELP_CFG = {
    VERSION: VERSION, MODES: MODES, VIEWS: VIEWS, CORNERS: CORNERS, SIZES: SIZES, LANGS: LANGS, MODULES: MODULES, PRESETS: PRESETS,
    defaults: defaults, clean: clean, preset: preset, parse: parse,
  };
})();
