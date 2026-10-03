// Die Tiere des Kanals (Haustier): Rexi bekommt Gesellschaft. Alle Tiere nutzen dieselben
// Gelenke wie Rexi (Kopf, Kiefer, Augen, Beine, Arm, Schwanz – Klassen dino-… in js/pet.js,
// Drehpunkte in css/pet.css), deshalb funktionieren Laufen, Sprechen, Tricks und die drei
// Kostüme ohne neue Animationen. Eigenheiten (Kiemen, Flügel, Feuer, Watscheln) stehen in
// css/pet.css unter [data-species]. Zeichenfläche: viewBox 170 × 140, Blick nach rechts,
// Boden bei y ≈ 121. Farben über die CSS-Variablen --dn-… (bei Hunger rot).

export const SPECIES = [
  { id: 'dino', name: 'Dino', pet: 'Rexi', icon: '🦖' },
  { id: 'cat', name: 'Katze', pet: 'Mimi', icon: '🐱' },
  { id: 'fox', name: 'Fuchs', pet: 'Fipsi', icon: '🦊' },
  { id: 'axolotl', name: 'Axolotl', pet: 'Axel', icon: '🩷' },
  { id: 'penguin', name: 'Pinguin', pet: 'Pino', icon: '🐧' },
  { id: 'dragon', name: 'Drache', pet: 'Funki', icon: '🐉' },
];
export const speciesOf = (id) => SPECIES.find((s) => s.id === id) ?? SPECIES[0];
export const isSpecies = (id) => SPECIES.some((s) => s.id === id);

export const STAGES = [
  { id: 'egg', name: 'Ei' },
  { id: 'baby', name: 'Baby' },
  { id: 'adult', name: 'Erwachsen' },
];
export const stageName = (id) => STAGES.find((s) => s.id === id)?.name ?? 'Erwachsen';

// Eigene Sprüche je Tier (neben den Sprüchen aus der Datenbank, die oft vom Dino handeln)
export const SPECIES_LINES = {
  cat: ['Miau. Das heißt: Snacks, sofort.', 'Ich hab {streamer} vom Tisch geschubst. War Absicht.', 'Neun Leben, und alle schauen Stream.', 'Schnurr … oh, ein Laserpointer!', 'Ich lieg hier, bis jemand !füttern schreibt.', 'Ich bin keine Katze, ich bin ein Lebensgefühl.'],
  fox: ['Was sagt der Fuchs? Gib Snacks!', 'Ich bin schlauer als {streamer}. Nicht schwer.', 'Buschschwanz-Check: perfekt.', 'Ich hab den Plan. {streamer} hat Lag.', 'Füchse schlafen nie. Okay, manchmal.', 'Schleich, schleich … Snack geklaut!'],
  axolotl: ['Ich lächle immer. Auch wenn {streamer} verliert.', 'Blubb. Das heißt Hallo.', 'Meine Kiemen sind fabelhaft, danke.', 'Ich kann Beine nachwachsen lassen. {streamer} nicht mal Skill.', 'Mehr Wasser, weniger Lag!', 'Axolotl-Fakt: Ich bin süß.'],
  penguin: ['Watschel, watschel, Victory Royale!', 'Mir ist nicht kalt, ich bin nur cool.', 'Fisch? Hat jemand Fisch gesagt?', 'Ich trag immer Frack. Stream ist ein Anlass.', 'Rutschen ist schneller als Laufen.', 'Noot noot! … Moment, falscher Pinguin.'],
  dragon: ['Ich spuck gleich Feuer. Nur kleines.', 'Mein Schatz? Eure Kanalpunkte.', 'Flügel: an. Gehirn: {streamer}-Modus.', 'Ich bewache diesen Stream.', 'Wer hat meinen Hort geplündert?!', 'Rauch kommt raus, wenn ich Hunger hab.'],
};
// Sprüche aus der Datenbank, die nur zum Dino passen – bei anderen Tieren übersprungen
export const DINO_ONLY = /dino|t-rex|jura|prähistor|65 millionen|meteorit|kurze arme|ausgebrütet|mein ei|rawr/i;

// ---------- Zeichnungen ----------
// Jedes Tier liefert die Teile; js/pet.js setzt sie in dieselbe Gelenk-Struktur.
//   body: Umriss des Körpers (auch Clip-Pfad für die Warnweste)
//   back: hinter dem Körper (Flügel), headBack: hinter dem Kopf (Kiemen), tail, legB, legA, arm,
//   deco (auf dem Körper)
//   head, jaw, face (über dem Kopf: Nase, Schnurrhaare), eye {cx, cy, r, white}, brow
//   cap / neck: Verschiebung der Mützen bzw. von Halstuch und Pfeife [x, y], damit sie passen
const LEG = (x, w = 14, h = 19) => `M${x} 94 h${w} v${h} c0 2 2 3 4 3 h4 c3 0 3 5 0 5 h-${w + 4} c-3 0 -4 -2 -4 -4 z`;

export function speciesParts(species, skin) {
  switch (species) {
    case 'cat': return {
      body: 'M46 86 C44 66 60 56 84 58 C102 59 110 68 110 82 C110 100 98 110 78 110 C58 110 47 101 46 86 Z',
      tail: `<path d="M50 84 C34 84 26 72 26 58 C26 46 32 36 26 26" fill="none" class="dn-ln" stroke-width="11" stroke-linecap="round"/>
        <path d="M50 84 C34 84 26 72 26 58 C26 46 32 36 26 26" fill="none" class="dn-st-s2" stroke-width="6.5" stroke-linecap="round"/>
        <path d="M27 40 l6 2 M28 52 l6 1 M31 64 l6 -1" class="dn-st-s3" stroke-width="2.4" stroke-linecap="round"/>`,
      legB: '<path class="dn-ln dn-f-lb" d="M63 96 h12 v18 a5 5 0 0 1 -5 5 h-2 a5 5 0 0 1 -5 -5 z" stroke-width="2.5" stroke-linejoin="round"/>',
      legA: '<path class="dn-ln dn-f-lf" d="M84 96 h12 v18 a5 5 0 0 1 -5 5 h-2 a5 5 0 0 1 -5 -5 z" stroke-width="2.5" stroke-linejoin="round"/><path d="M88 117 v2 M92 117 v2" stroke="#fff" stroke-opacity=".7" stroke-width="1.2" stroke-linecap="round"/>',
      arm: '',
      deco: `<path class="dn-f-bl" d="M62 102 C70 109 92 109 102 100 C105 92 101 86 97 84 C85 90 71 94 62 102 Z"/>
        <path class="dn-st-s3" d="M60 62 q4 8 0 15 M72 59 q4 8 0 15 M84 59 q4 8 0 15" fill="none" stroke-width="3" stroke-linecap="round"/>
        <path d="M60 64 C68 58 80 57 92 59" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="3" stroke-linecap="round"/>`,
      head: `<path class="dn-ln dn-f-s2" d="M104 30 L106 9 L121 23 Z M133 23 L148 9 L150 31 Z" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M107 26 L108 15 L116 23 Z M137 23 L146 15 L147 27 Z" fill="#ff9fc0"/>
        <path class="dn-ln" d="M96 46 C96 30 108 20 125 20 C143 20 155 30 155 46 C155 60 143 66 125 66 C108 66 96 60 96 46 Z" fill="${skin}" stroke-width="2.5"/>
        <path class="dn-st-s3" d="M118 23 v7 M126 22 v8 M134 23 v7" stroke-width="2.4" stroke-linecap="round"/>
        <ellipse cx="143" cy="52" rx="11" ry="8" fill="#fff4e6"/>`,
      jaw: '<path class="dn-ln dn-f-jw" d="M136 58 C140 64 150 64 154 58 C150 61 140 61 136 58 Z" stroke-width="2" stroke-linejoin="round"/>',
      face: `<path d="M150 46 l5 -2 v5 z" fill="#ff7aa0" stroke="#7a2a44" stroke-width="1" stroke-linejoin="round"/>
        <path d="M146 54 q4 4 8 0" fill="none" class="dn-ln" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M146 50 l20 -4 M146 52 l20 1 M146 54 l18 6" stroke="#fff" stroke-opacity=".85" stroke-width="1.1" stroke-linecap="round"/>
        <ellipse cx="136" cy="54" rx="5" ry="3" fill="#ff8fa3" opacity=".5"/>`,
      eye: { cx: 128, cy: 39, r: 7, white: true, slit: true },
      brow: 'M120 30 L135 33',
      cap: [2, 2], neck: [0, 4],
    };
    case 'fox': return {
      body: 'M46 82 C46 64 62 56 84 58 C100 59 108 68 108 80 C108 96 96 104 78 104 C58 104 46 96 46 82 Z',
      tail: `<path class="dn-ln" d="M50 76 C32 68 12 74 5 92 C14 87 24 89 33 93 C25 97 21 105 23 110 C33 99 44 93 52 88 Z" fill="${skin}" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M5 92 C9 88 16 86 22 88 C16 92 14 97 15 101 C10 100 6 96 5 92 Z" fill="#fff8f0"/>`,
      legB: `<path class="dn-ln dn-f-lb" d="${LEG(64, 10, 20)}" stroke-width="2.3" stroke-linejoin="round"/>`,
      legA: `<path class="dn-ln dn-f-lf" d="${LEG(82, 10, 20)}" stroke-width="2.3" stroke-linejoin="round"/>`,
      arm: '',
      deco: `<path class="dn-f-bl" d="M90 64 C103 68 108 80 104 93 C98 100 90 99 86 95 C91 85 91 75 90 64 Z"/>
        <path d="M58 62 C66 58 78 57 90 59" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="3" stroke-linecap="round"/>`,
      head: `<path class="dn-ln dn-f-s2" d="M104 34 L103 6 L119 25 Z M121 27 L131 4 L138 29 Z" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M106 29 L106 14 L114 25 Z M124 26 L130 12 L134 27 Z" fill="#3a1c0b" opacity=".75"/>
        <path class="dn-ln" d="M96 48 C96 32 108 23 124 24 C136 25 146 33 163 46 C151 54 137 58 120 58 C104 58 96 56 96 48 Z" fill="${skin}" stroke-width="2.5" stroke-linejoin="round"/>
        <path class="dn-f-bl" d="M116 50 C130 56 146 54 160 47 C151 57 135 61 119 58 Z"/>`,
      jaw: '<path class="dn-ln dn-f-jw" d="M126 57 C138 61 152 58 160 51 C158 59 146 65 131 63 Z" stroke-width="2" stroke-linejoin="round"/>',
      face: '<circle cx="162" cy="46" r="3.2" fill="#1d130c"/><circle cx="161" cy="45" r="1" fill="#fff" opacity=".7"/>',
      eye: { cx: 123, cy: 40, r: 6, white: true },
      brow: 'M115 33 L130 36',
      cap: [-1, 4], neck: [0, 2],
    };
    case 'axolotl': return {
      body: 'M46 94 C46 80 62 72 86 74 C102 75 110 82 110 92 C110 104 98 110 80 110 C60 110 46 106 46 94 Z',
      headBack: `<g class="pet-gills">
          <path class="dn-st-s3" d="M108 60 C100 50 96 44 92 36 M110 58 C104 46 102 38 102 28 M114 58 C112 46 114 38 118 30" fill="none" stroke-width="5" stroke-linecap="round"/>
          <path class="dn-st-gill" d="M108 60 C100 50 96 44 92 36 M110 58 C104 46 102 38 102 28 M114 58 C112 46 114 38 118 30" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 3"/>
        </g>`,
      tail: `<path class="dn-ln" d="M50 86 C34 82 18 86 4 94 C18 99 34 101 52 96 Z" fill="${skin}" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M48 84 C34 78 18 82 4 94" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>`,
      legB: '<path class="dn-ln dn-f-lb" d="M64 102 h9 v11 c0 2 2 3 4 3 h2 c2 0 2 4 0 4 h-13 c-2 0 -2 -1 -2 -3 z" stroke-width="2.2" stroke-linejoin="round"/>',
      legA: '<path class="dn-ln dn-f-lf" d="M86 102 h9 v11 c0 2 2 3 4 3 h2 c2 0 2 4 0 4 h-13 c-2 0 -2 -1 -2 -3 z" stroke-width="2.2" stroke-linejoin="round"/>',
      arm: '',
      deco: `<path class="dn-f-bl" d="M62 104 C72 110 92 110 102 102 C104 96 102 92 98 90 C86 96 72 98 62 104 Z"/>
        <circle class="dn-f-sp" cx="64" cy="84" r="2"/><circle class="dn-f-sp" cx="76" cy="80" r="2.2"/><circle class="dn-f-sp" cx="88" cy="83" r="1.8"/>`,
      head: `<path class="dn-ln" d="M98 66 C96 48 110 40 128 40 C148 40 160 52 158 66 C156 78 142 84 126 84 C108 84 99 78 98 66 Z" fill="${skin}" stroke-width="2.5"/>
        <path d="M108 50 C116 44 130 42 142 44" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="3" stroke-linecap="round"/>`,
      jaw: '<path class="dn-ln dn-f-jw" d="M136 76 C144 80 152 78 156 72 C152 78 142 80 136 76 Z" stroke-width="1.8" stroke-linejoin="round"/>',
      face: `<path d="M134 72 q10 7 20 -2" fill="none" class="dn-ln" stroke-width="2" stroke-linecap="round"/>
        <ellipse cx="128" cy="70" rx="5" ry="3" fill="#ff6fa5" opacity=".45"/>`,
      eye: { cx: 140, cy: 58, r: 4.2, white: false },
      brow: 'M134 50 L146 52',
      cap: [4, 18], neck: [2, 18],
    };
    case 'penguin': return {
      body: 'M56 114 C44 94 46 56 74 46 C94 40 112 54 112 80 C112 102 104 118 82 120 C70 121 60 120 56 114 Z',
      tail: '<path class="dn-ln dn-f-s3" d="M56 108 L42 116 L58 116 Z" stroke-width="2" stroke-linejoin="round"/>',
      legB: '<path class="dn-ln dn-f-lb" d="M64 112 h14 c4 0 5 5 0 7 h-16 c-4 0 -3 -7 2 -7 z" stroke-width="2" stroke-linejoin="round"/>',
      legA: '<path class="dn-ln dn-f-lf" d="M84 112 h14 c4 0 5 5 0 7 h-16 c-4 0 -3 -7 2 -7 z" stroke-width="2" stroke-linejoin="round"/>',
      arm: '<path class="dn-ln dn-f-s3" d="M100 68 C112 72 116 88 110 102 C102 96 98 82 100 68 Z" stroke-width="2.2" stroke-linejoin="round"/>',
      deco: `<path class="dn-f-bl" d="M70 112 C60 96 62 70 80 60 C96 56 104 70 104 86 C104 102 96 114 84 116 C78 116 73 115 70 112 Z"/>
        <path d="M66 58 C72 52 80 50 88 50" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="3" stroke-linecap="round"/>`,
      head: `<path class="dn-ln" d="M84 40 C82 22 96 12 110 14 C126 16 134 28 132 42 C130 54 118 60 104 60 C92 60 85 52 84 40 Z" fill="${skin}" stroke-width="2.5"/>
        <path class="dn-f-bl" d="M104 26 C116 24 126 30 126 40 C126 50 116 56 106 54 C102 46 101 36 104 26 Z"/>`,
      jaw: '<path class="dn-ln" d="M126 44 L141 44 L126 50 Z" fill="#e8780f" stroke-width="1.8" stroke-linejoin="round"/>',
      face: '<path class="dn-ln" d="M124 37 L146 42 L124 45 Z" fill="#ff9a1c" stroke-width="2" stroke-linejoin="round"/><ellipse cx="114" cy="46" rx="4" ry="2.4" fill="#ff8fa3" opacity=".5"/>',
      eye: { cx: 115, cy: 35, r: 5.5, white: true },
      brow: 'M108 28 L120 31',
      cap: [-12, -2], neck: [-8, 2],
    };
    case 'dragon': return {
      body: 'M44 80 C42 58 62 44 88 48 C102 50 110 60 111 72 C112 92 100 106 78 106 C58 106 46 96 44 80 Z',
      back: `<g class="pet-wing">
          <path class="dn-ln dn-f-wing" d="M72 58 C60 32 72 12 98 6 C93 20 97 28 106 32 C97 35 93 43 95 52 C86 49 79 53 72 58 Z" stroke-width="2.5" stroke-linejoin="round"/>
          <path class="dn-ln" d="M76 54 C78 40 86 26 98 10 M84 50 C88 42 94 36 104 32" fill="none" stroke-width="1.6" stroke-linecap="round"/>
        </g>`,
      tail: `<path class="dn-ln" d="M50 78 C30 80 12 72 3 52 C18 66 34 68 52 64 Z" fill="${skin}" stroke-width="2.5" stroke-linejoin="round"/>
        <path class="dn-ln dn-f-wing" d="M3 52 L-4 44 L8 46 L2 38 L12 46 Z" stroke-width="1.6" stroke-linejoin="round"/>`,
      legB: `<path class="dn-ln dn-f-lb" d="${LEG(62)}" stroke-width="2.5" stroke-linejoin="round"/>`,
      legA: `<path class="dn-ln dn-f-lf" d="${LEG(80)}" stroke-width="2.5" stroke-linejoin="round"/><path d="M101 116 l2 5 M97 116 l1 5" stroke="#fff3cf" stroke-width="1.4" stroke-linecap="round"/>`,
      arm: '<path class="dn-ln dn-f-lf" d="M103 74 q10 2 11 10 q-4 1 -6 -2 q-2 3 -6 1 z" stroke-width="2" stroke-linejoin="round"/>',
      deco: `<path class="dn-f-bl" d="M60 96 C66 106 88 107 100 96 C106 88 106 78 102 72 C88 78 70 82 60 96 Z"/>
        <path class="dn-st-bs" d="M66 98 q16 5 32 -4 M72 90 q13 2 27 -7 M82 82 q8 0 17 -6" fill="none" stroke-width="1.6" stroke-linecap="round"/>
        <path class="dn-ln dn-f-wing" d="M54 54 l3 -9 5 7 M65 48 l4 -10 5 8 M78 46 l5 -9 4 9" stroke-width="2" stroke-linejoin="round"/>`,
      head: `<path class="dn-ln dn-f-horn" d="M110 28 L102 8 L118 22 Z M126 22 L128 4 L136 22 Z" stroke-width="2" stroke-linejoin="round"/>
        <path class="dn-ln" d="M96 50 C98 28 120 16 140 22 C154 27 160 42 154 54 C142 60 116 61 102 58 C98 57 96 54 96 50 Z" fill="${skin}" stroke-width="2.5" stroke-linejoin="round"/>
        <path class="dn-ln" d="M118 58 l3 4 3 -4 M128 58 l3 4 3 -4" fill="#fff" stroke-width="1.2" stroke-linejoin="round"/>
        <circle class="dn-f-ln" cx="151" cy="37" r="1.8"/><circle class="dn-f-ln" cx="146" cy="36" r="1.4"/>`,
      jaw: `<path class="dn-ln dn-f-jw" d="M102 56 C114 62 136 64 150 58 C150 66 140 72 122 70 C110 69 104 64 102 56 Z" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M120 67 C126 70 136 68 142 64" fill="none" stroke="#ff9a6a" stroke-width="3" stroke-linecap="round"/>`,
      face: `<g class="pet-fire"><path d="M152 58 C164 50 178 52 188 46 C182 56 190 60 196 58 C186 70 170 70 156 66 Z" fill="#ffb347"/>
        <path d="M154 60 C164 56 174 57 182 54 C178 60 182 63 186 62 C178 68 166 67 156 64 Z" fill="#ffe58a"/></g>
        <g class="pet-smoke"><circle cx="156" cy="34" r="3" fill="#cfd4e0"/><circle cx="160" cy="27" r="2.2" fill="#cfd4e0"/></g>`,
      eye: { cx: 120, cy: 38, r: 7.5, white: true },
      brow: 'M111 29 L128 33.5',
      cap: [0, 0],
    };
    default: return null; // Dino: Rexis eigene Zeichnung in js/pet.js
  }
}

// Ei (Stadium „egg“): wackelt, bekommt Risse, kurz vor dem Schlüpfen schauen Augen heraus.
// Farbe der Flecken je Tier (CSS --egg-spot).
export function eggSvg() {
  return `<svg class="pet-egg-svg" viewBox="0 0 100 120" aria-hidden="true">
    <ellipse class="pet-egg-shadow" cx="50" cy="114" rx="30" ry="5" fill="#000"/>
    <path class="pet-egg-shell" d="M50 6 C74 6 90 44 90 72 C90 98 72 112 50 112 C28 112 10 98 10 72 C10 44 26 6 50 6 Z" stroke-width="3"/>
    <circle class="pet-egg-spot" cx="34" cy="44" r="7"/><circle class="pet-egg-spot" cx="64" cy="30" r="5"/>
    <circle class="pet-egg-spot" cx="68" cy="74" r="8"/><circle class="pet-egg-spot" cx="30" cy="86" r="5"/>
    <path d="M30 28 C36 18 44 14 52 14" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="4" stroke-linecap="round"/>
    <path class="pet-egg-crack pet-egg-crack-1" d="M14 64 L26 58 L32 66 L42 56 L48 64" fill="none" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
    <path class="pet-egg-crack pet-egg-crack-2" d="M48 64 L58 54 L64 64 L76 56 L88 62" fill="none" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
    <g class="pet-egg-peek"><path d="M28 62 L36 56 L44 64 L56 54 L66 64 L74 58 L74 70 L28 70 Z" fill="#1b1430"/>
      <circle cx="42" cy="64" r="4.2" fill="#fff"/><circle cx="60" cy="64" r="4.2" fill="#fff"/>
      <circle class="pet-egg-pupil" cx="43" cy="65" r="2" fill="#1b1430"/><circle class="pet-egg-pupil" cx="61" cy="65" r="2" fill="#1b1430"/></g>
  </svg>`;
}

// Wie der Trigger pet_stage_progress() (Migration …_pet_species.sql) – für den Demo-Modus.
// Liefert das neue Tier und ggf. das neue Stadium (für den 'stage'-Eintrag).
export function advanceStage(prev, next, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })) {
  const pet = { ...next, stage_helpers: [...(next.stage_helpers ?? prev.stage_helpers ?? [])] };
  if ((pet.stage ?? 'adult') !== (prev.stage ?? 'adult')) {
    Object.assign(pet, { stage_feeds: 0, good_days: 0, day_feeds: 0, feed_day: null, stage_helpers: [], stage_changed_at: new Date().toISOString() });
    return { pet, changed: null };
  }
  if ((pet.fed_count ?? 0) <= (prev.fed_count ?? 0) || pet.stage === 'adult') return { pet, changed: null };
  const who = String(pet.last_fed_by ?? '').trim().slice(0, 40);
  if (who && !pet.stage_helpers.includes(who)) pet.stage_helpers = [...pet.stage_helpers, who].slice(-20);
  const helpers = pet.stage_helpers.slice(0, 5).join(', ');
  if (pet.stage === 'egg') {
    pet.stage_feeds = (prev.stage_feeds ?? 0) + 1;
    if (pet.stage_feeds >= (pet.hatch_feeds ?? 50)) {
      Object.assign(pet, { stage: 'baby', stage_feeds: 0, good_days: 0, day_feeds: 0, feed_day: null, stage_helpers: [], stage_changed_at: new Date().toISOString() });
      return { pet, changed: { stage: 'baby', helpers } };
    }
  } else if (pet.stage === 'baby') {
    if (pet.feed_day !== today) { pet.feed_day = today; pet.day_feeds = 0; }
    pet.day_feeds = (pet.day_feeds ?? 0) + 1;
    pet.stage_feeds = (prev.stage_feeds ?? 0) + 1;
    if (pet.day_feeds === 3) pet.good_days = (prev.good_days ?? 0) + 1;
    if ((pet.good_days ?? 0) >= (pet.grow_days ?? 5)) {
      Object.assign(pet, { stage: 'adult', stage_feeds: 0, stage_helpers: [], stage_changed_at: new Date().toISOString() });
      return { pet, changed: { stage: 'adult', helpers } };
    }
  }
  return { pet, changed: null };
}
