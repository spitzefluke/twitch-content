// Theme-Pakete für die Design-Bibliothek (wie die Themes bei StreamElements und Streamlabs – eigene
// Entwürfe, keine fremden Grafiken): Ein Paket stellt
// alles auf einen Look ein – Overlay-Design, Kamera-Rahmen, Alerts, Laufband, Chat und Bingo –
// und bringt fünf Szenen mit: Gameplay, Gleich live, Pause, Just Chatting und Stream-Ende.
//   overlay: Werte für die Overlay-Einstellungen (otheme, cfstyle, alook, tstyle, chstyle, bstyle)
//   alert:   fertiges Alert-Design (ALERT_PRESETS in js/alerts.js) für alle Alert-Arten
//   bg:      Bild für die Kachel in der Galerie (assets/…)
// Ebenen schaltet ein Paket nicht an oder aus – es ändert nur, wie sie aussehen.

// Standardwerte der Overlay-Einstellungen: was gleich ist, steht nicht in der Adresse
export const OVERLAY_DEFAULTS = { otheme: 'standard', cfstyle: 'glow', alook: 'classic', tstyle: 'bar', chstyle: 'card', bstyle: 'classic' };

export const THEME_CATEGORIES = [
  { id: 'all', name: 'Alle' },
  { id: 'gaming', name: 'Gaming' },
  { id: 'cozy', name: 'Gemütlich' },
  { id: 'fun', name: 'Bunt & verspielt' },
  { id: 'scifi', name: 'Sci-Fi' },
  { id: 'nature', name: 'Natur' },
  { id: 'fantasy', name: 'Fantasy & Horror' },
  { id: 'retro', name: 'Retro' },
  { id: 'elegant', name: 'Edel' },
  { id: 'minimal', name: 'Minimal' },
  { id: 'seasonal', name: 'Saisonal' },
];

export const THEME_SCENES = [
  { id: 'game', name: 'Gameplay', icon: '🎮', desc: 'Das Overlay während des Spiels' },
  { id: 'start', name: 'Gleich live', icon: '🚀', desc: 'Vor dem Stream, mit Countdown' },
  { id: 'brb', name: 'Pause', icon: '☕', desc: '„Bin gleich zurück“' },
  { id: 'chat', name: 'Just Chatting', icon: '💬', desc: 'Große Kamera, Chat daneben' },
  { id: 'end', name: 'Stream-Ende', icon: '💜', desc: 'Danke an die Unterstützer' },
  { id: 'alert', name: 'Alerts', icon: '🔔', desc: 'So sehen Follower, Abos und Bits aus' },
];

export const THEME_PACKS = [
  {
    id: 'neon-night', name: 'Neon Night', cat: 'gaming', color: '#ff4fd8', bg: 'bg-city',
    desc: 'Leuchtreklame bei Nacht: pinke Neonränder, flackernder Kamera-Rahmen und Alerts in Leuchtschrift.',
    overlay: { otheme: 'neon', cfstyle: 'neon', alook: 'neon', tstyle: 'neon', chstyle: 'bubble', bstyle: 'neon' },
    alert: 'neon',
  },
  {
    id: 'cyber', name: 'Cyber-Glitch', cat: 'gaming', color: '#ff2e4d', bg: 'bg-storm',
    desc: 'Kantig und laut: schräge Ecken, roter Akzent und Alerts mit digitalem Störeffekt.',
    overlay: { otheme: 'gamer', cfstyle: 'corners', alook: 'glitch', tstyle: 'neon', chstyle: 'clean', bstyle: 'neon' },
    alert: 'glitch',
  },
  {
    id: 'inferno', name: 'Inferno', cat: 'gaming', color: '#ff5a2e', bg: 'bg-challenge',
    desc: 'Für Sweat-Runden: Gamer-Karten, glühender Rahmen und Feuer-Alerts, die von der Seite einfahren.',
    overlay: { otheme: 'gamer', cfstyle: 'glow', alook: 'banner', tstyle: 'bar', chstyle: 'card', bstyle: 'classic' },
    alert: 'fire',
  },
  {
    id: 'champion', name: 'Champion', cat: 'gaming', color: '#ffb81c', bg: 'bg-shop',
    desc: 'Siegerpose: Gold-Karten, Eckrahmen um die Kamera und Pokal-Alerts als Banner.',
    overlay: { otheme: 'gold', cfstyle: 'corners', alook: 'banner', tstyle: 'board', chstyle: 'card', bstyle: 'classic' },
    alert: 'champ',
  },
  {
    id: 'pixel', name: 'Pixel-Arcade', cat: 'retro', color: '#3ddc84', bg: 'bg-quiz',
    desc: 'Wie am Spielautomaten: Pixel-Schrift, Doppelrand, LED-Laufband und Münz-Alerts.',
    overlay: { otheme: 'retro', cfstyle: 'corners', alook: 'retro', tstyle: 'board', chstyle: 'card', bstyle: 'classic' },
    alert: 'arcade',
  },
  {
    id: 'synthwave', name: 'Synthwave', cat: 'retro', color: '#c46cff', bg: 'bg-tracks',
    desc: '80er-Sonnenuntergang: Neon-Lila, leuchtende Kanten und Alerts mit Regenbogen-Rand.',
    overlay: { otheme: 'neon', cfstyle: 'glow', alook: 'hype', tstyle: 'neon', chstyle: 'bubble', bstyle: 'neon' },
    alert: 'hype',
  },
  {
    id: 'royal', name: 'Royal Gold', cat: 'elegant', color: '#e8c46a', bg: 'bg-pause',
    desc: 'Schwarz und Gold: ruhige, edle Karten, schlichter Rahmen und Kronen-Alerts.',
    overlay: { otheme: 'gold', cfstyle: 'clean', alook: 'gold', tstyle: 'bar', chstyle: 'clean', bstyle: 'paper' },
    alert: 'royal',
  },
  {
    id: 'crystal', name: 'Kristall', cat: 'elegant', color: '#35c7ff', bg: 'bg-questions',
    desc: 'Milchglas und Diamanten: weich, rund und hell – mit funkelnden Diamant-Alerts.',
    overlay: { otheme: 'glass', cfstyle: 'clean', alook: 'glass', tstyle: 'bar', chstyle: 'card', bstyle: 'paper' },
    alert: 'diamond',
  },
  {
    id: 'cozy', name: 'Gemütlicher Abend', cat: 'cozy', color: '#ffd23f', bg: 'bg-pet',
    desc: 'Tee, Decke, Chat: warme Standard-Karten, Sprechblasen-Chat und Sternchen-Alerts.',
    overlay: { otheme: 'standard', cfstyle: 'clean', alook: 'glass', tstyle: 'bar', chstyle: 'bubble', bstyle: 'paper' },
    alert: 'star',
  },
  {
    id: 'frost', name: 'Frostbite', cat: 'cozy', color: '#7fd6ff', bg: 'bg-ghost',
    desc: 'Kalt und klar: Glas-Karten, hellblauer Rahmen und Schneeflocken-Alerts, die sanft einblenden.',
    overlay: { otheme: 'glass', cfstyle: 'glow', alook: 'minimal', tstyle: 'bar', chstyle: 'clean', bstyle: 'paper' },
    alert: 'ice',
  },
  {
    id: 'candy', name: 'Candy Pop', cat: 'fun', color: '#ff7ac8', bg: 'bg-prank',
    desc: 'Pastell und Zuckerguss: runde Verlaufs-Karten, Sprechblasen und Geschenk-Alerts.',
    overlay: { otheme: 'candy', cfstyle: 'glow', alook: 'classic', tstyle: 'bar', chstyle: 'bubble', bstyle: 'classic' },
    alert: 'gift',
  },
  {
    id: 'comic', name: 'Comic Boom', cat: 'fun', color: '#ffd23f', bg: 'bg-cards',
    desc: 'Zack, Bumm, Wow: bunte Sprechblasen-Alerts, die ins Bild springen.',
    overlay: { otheme: 'candy', cfstyle: 'corners', alook: 'bubble', tstyle: 'board', chstyle: 'bubble', bstyle: 'classic' },
    alert: 'comic',
  },
  {
    id: 'party', name: 'Lila Party', cat: 'fun', color: '#9146ff', bg: 'bg-bingo',
    desc: 'Der StreamHelp-Klassiker: Twitch-Lila, Konfetti und Party-Alerts.',
    overlay: { otheme: 'standard', cfstyle: 'glow', alook: 'classic', tstyle: 'bar', chstyle: 'card', bstyle: 'classic' },
    alert: 'party',
  },
  {
    id: 'clean', name: 'Clean & Minimal', cat: 'minimal', color: '#ffb81c', bg: 'bg-subathon',
    desc: 'Kaum Karte, viel Schrift: nichts lenkt vom Spiel ab.',
    overlay: { otheme: 'minimal', cfstyle: 'clean', alook: 'minimal', tstyle: 'bar', chstyle: 'clean', bstyle: 'paper' },
    alert: 'clean',
  },
  {
    id: 'kosmos', name: 'Kosmos', cat: 'scifi', color: '#8ea2ff', bg: 'bg-space',
    desc: 'Unterwegs zwischen den Sternen: nachtblaue Karten mit Sternenstaub, Planeten-Alerts und eine Galaxie als Szene.',
    overlay: { otheme: 'space', cfstyle: 'glow', alook: 'glass', tstyle: 'neon', chstyle: 'card', bstyle: 'neon' },
    alert: 'cosmos',
  },
  {
    id: 'mission', name: 'Mission Control', cat: 'scifi', color: '#35f0ff', bg: 'bg-hud',
    desc: 'Wie ein Cockpit-Display: durchsichtige HUD-Karten mit Eckklammern, Scan-Linien und Helm-Alerts mit Störeffekt.',
    overlay: { otheme: 'hud', cfstyle: 'corners', alook: 'glitch', tstyle: 'board', chstyle: 'clean', bstyle: 'neon' },
    alert: 'mission',
  },
  {
    id: 'kawaii', name: 'Kawaii Café', cat: 'fun', color: '#ff8fc8', bg: 'bg-kawaii',
    desc: 'Zuckersüß: pastellrosa, gepunktete Karten, Wolken und Herzen – und ein Kätzchen, das bei jedem Follow hüpft.',
    overlay: { otheme: 'kawaii', cfstyle: 'glow', alook: 'bubble', tstyle: 'bar', chstyle: 'bubble', bstyle: 'classic' },
    alert: 'kawaii',
  },
  {
    id: 'bloodmoon', name: 'Blutmond', cat: 'fantasy', color: '#d1162f', bg: 'bg-horror',
    desc: 'Für Horror-Games: tiefrote Kanten, roter Mond über dem Friedhof und wackelnde Totenkopf-Alerts.',
    overlay: { otheme: 'horror', cfstyle: 'corners', alook: 'glitch', tstyle: 'bar', chstyle: 'clean', bstyle: 'paper' },
    alert: 'bloodmoon',
  },
  {
    id: 'heroes', name: 'Heldensaga', cat: 'fantasy', color: '#d8a64a', bg: 'bg-fantasy',
    desc: 'Für RPG-Abenteuer: Pergament mit Gold-Doppelrand, eine Burg im Abendlicht und Schwert-Alerts, die sich umdrehen.',
    overlay: { otheme: 'fantasy', cfstyle: 'corners', alook: 'gold', tstyle: 'board', chstyle: 'card', bstyle: 'paper' },
    alert: 'quest',
  },
  {
    id: 'woods', name: 'Waldlichtung', cat: 'nature', color: '#79c95a', bg: 'bg-forest',
    desc: 'Ruhig und grün: Karten mit Holzkante, Glühwürmchen im Tannenwald und Blatt-Alerts, die sanft einblenden.',
    overlay: { otheme: 'forest', cfstyle: 'clean', alook: 'classic', tstyle: 'bar', chstyle: 'bubble', bstyle: 'paper' },
    alert: 'forest',
  },
  {
    id: 'deepsea', name: 'Tiefsee', cat: 'nature', color: '#2fd3c6', bg: 'bg-ocean',
    desc: 'Abtauchen: türkise Karten, Lichtstrahlen unter Wasser, Luftblasen und ein Fisch, der zu jedem Abo schwimmt.',
    overlay: { otheme: 'ocean', cfstyle: 'glow', alook: 'glass', tstyle: 'bar', chstyle: 'bubble', bstyle: 'classic' },
    alert: 'deepsea',
  },
  {
    id: 'halloween', name: 'Halloween-Nacht', cat: 'seasonal', color: '#ff8a1c', bg: 'bg-spooky',
    desc: 'Für den Oktober: Kürbis-Orange und Lila, Fledermäuse vor dem Vollmond und ein grinsender Kürbis als Alert.',
    overlay: { otheme: 'spooky', cfstyle: 'glow', alook: 'banner', tstyle: 'neon', chstyle: 'card', bstyle: 'classic' },
    alert: 'halloween',
  },
  {
    id: 'winter', name: 'Winterwunder', cat: 'seasonal', color: '#e3283e', bg: 'bg-xmas',
    desc: 'Für die Weihnachtszeit: Tannengrün mit rotem Rand, Schnee, Geschenke und ein blinkender Tannenbaum als Alert.',
    overlay: { otheme: 'xmas', cfstyle: 'clean', alook: 'classic', tstyle: 'bar', chstyle: 'card', bstyle: 'classic' },
    alert: 'xmas',
  },
];
