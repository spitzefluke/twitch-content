// Standard-Inhalte für den Demo-Modus.
// Im Live-Betrieb kommen dieselben Daten aus Supabase
// (siehe supabase/migrations/20260918000000_init.sql).

export const DEFAULT_VARIANTS = [
  {
    id: 'waffen',
    position: 1,
    name: 'Waffen-Roulette',
    description: 'Bestimmt, womit Dave kämpfen darf.',
    color: '#ffb81c',
    segments: [
      { label: 'Nur Schrotflinten', detail: 'Nur Shotguns (und die Spitzhacke) sind erlaubt.' },
      { label: 'Nur Grau & Grün', detail: 'Nur Waffen der Seltenheit Gewöhnlich und Ungewöhnlich.' },
      { label: 'Erste Waffe zählt', detail: 'Die erste gefundene Waffe bleibt die einzige Waffe.' },
      { label: 'Pistolen & MPs', detail: 'Nur Pistolen und Maschinenpistolen.' },
      { label: 'Keine Shotguns', detail: 'Alles ist erlaubt – außer Schrotflinten.' },
      { label: 'Sniper-Pflicht', detail: 'Ein Scharfschützengewehr muss immer im Inventar sein.' },
      { label: 'Nur Truhen-Loot', detail: 'Nur Items aus Truhen, kein Boden-Loot.' },
      { label: 'Freie Wahl', detail: 'Glück gehabt: keine Waffen-Regel!' },
    ],
  },
  {
    id: 'landung',
    position: 2,
    name: 'Lande-Lotto',
    description: 'Entscheidet, wo und wie Dave in die Runde startet.',
    color: '#3ddc84',
    segments: [
      { label: 'Hot Drop', detail: 'Lande am vollsten POI der Runde.' },
      { label: 'Letzter raus', detail: 'Springe als Allerletzter aus dem Bus.' },
      { label: 'Erster raus', detail: 'Springe sofort beim ersten möglichen Moment ab.' },
      { label: 'Chat wählt', detail: 'Der Chat bestimmt den Landeort.' },
      { label: 'Höchster Punkt', detail: 'Lande auf dem höchsten Punkt in Reichweite.' },
      { label: 'Nur zu Fuß', detail: 'Keine Fahrzeuge in dieser Runde.' },
      { label: 'Gleisarbeiter', detail: 'Lande so nah wie möglich an Gleisen oder einer Straße.' },
      { label: 'Freie Wahl', detail: 'Glück gehabt: lande, wo du willst!' },
    ],
  },
  {
    id: 'handicap',
    position: 3,
    name: 'Handicap-Express',
    description: 'Eine Extra-Challenge für die ganze Runde.',
    color: '#9146ff',
    segments: [
      { label: 'Kein Heilen', detail: 'Keine Heil- oder Schild-Items benutzen.' },
      { label: 'Kein Sprinten', detail: 'Nur gehen – niemals sprinten.' },
      { label: 'Emote nach Kill', detail: 'Nach jedem Kill sofort ein Emote.' },
      { label: 'Nur 3 Slots', detail: 'Maximal drei Inventarplätze belegen.' },
      { label: 'Ducken im Kampf', detail: 'Im Kampf nur geduckt bewegen.' },
      { label: 'Kein Bauen', detail: 'Nicht bauen – auch nicht im Build-Modus.' },
      { label: 'Pazifist bis Top 10', detail: 'Keine Kämpfe, bis nur noch 10 Spieler übrig sind.' },
      { label: 'Freifahrt', detail: 'Glück gehabt: keine Challenge!' },
    ],
  },
];

export const DEFAULT_TILES = [
  {
    id: 'wheel',
    position: 1,
    kind: 'wheel',
    title: 'Fortnite-Glücksrad',
    description: 'Drei Varianten, die Daves nächste Runde auf den Kopf stellen. Auch per Kanalpunkte direkt aus dem Chat drehbar.',
    theme: 'wheel',
    target_at: null,
    background: null,
  },
  {
    id: 'prank',
    position: 2,
    kind: 'prank',
    title: 'Ärgere den Dave',
    description: 'Bananen, Tomaten, Torten – wirf was auf Dave oder spiel ihm deine eigenen Sounds in den Stream.',
    theme: 'prank',
    target_at: null,
    background: null,
  },
  {
    id: 'idea-1',
    position: 3,
    kind: 'countdown',
    title: 'Nachtschicht Güterzug',
    description: 'Train Sim World: Langstrecke durch die Nacht – ohne Pause bis zum Zielbahnhof.',
    theme: 'tracks',
    target_at: '2026-10-03T20:00:00+02:00',
    background: null,
  },
  {
    id: 'idea-2',
    position: 4,
    kind: 'countdown',
    title: 'Fortnite Community-Cup',
    description: 'Zuschauer gegen Dave – mit Glücksrad-Regeln in jeder Runde.',
    theme: 'storm',
    target_at: '2026-10-17T18:00:00+02:00',
    background: null,
  },
  {
    id: 'idea-3',
    position: 5,
    kind: 'countdown',
    title: 'Geisterzug-Special',
    description: 'Halloween-Stream: Horror-Games und eine Fahrt ins Ungewisse.',
    theme: 'ghost',
    target_at: '2026-10-31T20:00:00+01:00',
    background: null,
  },
  {
    id: 'idea-4',
    position: 6,
    kind: 'countdown',
    title: 'Subathon: Endstation?',
    description: 'Jeder Sub verlängert die Fahrt. Wo liegt die Endstation?',
    theme: 'city',
    target_at: '2026-11-21T12:00:00+01:00',
    background: null,
  },
];

// Vorschläge aus der Community (nur Demo-Modus – live kommen sie aus Supabase)
export const DEFAULT_IDEAS = [
  { id: 1, text: 'Nachtzug durch die Alpen', author: 'lokfuchs', votes: 42, voters: [] },
  { id: 2, text: 'Glücksrad mit Chat-Regeln', author: 'signal_sina', votes: 31, voters: [] },
  { id: 3, text: '24h Güterverkehr-Schicht', author: 'kupplung_kev', votes: 18, voters: [] },
];
