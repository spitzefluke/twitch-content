// Der Stream-Dino: ein kleines Tamagotchi, das im OBS-Overlay (und in der Vorschau
// auf der Webseite) hin und her läuft, freche Sprüche sagt und an den
// Zuschauern knabbert, wenn es Hunger hat. Bei Hunger wird er rot. Bei Heißhunger
// (doppelte Hungerzeit oder per Knopf, pet.frenzy_at) wächst er, klettert im
// Overlay an Karten hoch und frisst Stücke aus dem Rand – nach dem Füttern wächst
// der Rand wieder zu. Kostüme wechseln Zuschauer mit !change. Aussehen in
// css/pet.css, Sounds in js/rexi-sfx.js.
import { rexiSound } from './rexi-sfx.js';
import { DINO_ONLY, SPECIES_LINES, eggSvg, isSpecies, speciesParts } from './pet-species.js';

export const DEFAULT_PET = {
  name: 'Rexi',
  hungry_after: 45,
  last_fed_at: null,
  last_fed_by: '',
  fed_count: 0,
  feed_command: '!füttern',
  costume: 'schaffner',
  costume_command: true,
  costume_cooldown: 60,
  frenzy_at: null,
  species: 'dino',
  stage: 'adult',
  hatch_feeds: 50,
  grow_days: 5,
  stage_feeds: 0,
  good_days: 0,
  day_feeds: 0,
  feed_day: null,
  stage_helpers: [],
  phrases: [
    'Du Flitzpiepe!',
    'Der Rentner ist älter als mein Dino!',
    'Wer hat hier den Controller falsch rum gehalten?',
    'Rawr! Das heißt „Hallo“.',
    'Ich bin 65 Millionen Jahre alt und DU spielst so?',
    'Spoiler: Das wird knapp.',
    'Platz da, der Dino kommt!',
    'Chat, habt ihr Snacks dabei?',
    'Ich bin nicht dick, ich bin prähistorisch.',
    '{streamer}, du alte Pflaume!',
    'Ich hab mehr Lag als dein WLAN.',
    'Kurze Arme, große Klappe.',
    'Ich hab mehr Zähne als {streamer} Kills.',
    'Mein Opa war ein T-Rex. Und deiner?',
    'Ich bin kein Dino, ich bin ein Lebensgefühl.',
    '{streamer}, das war ein Kunstschuss. Also Kunst. Kein Schuss.',
    'Pssst … ich glaube, {streamer} hat Lag im Kopf.',
    'Einmal Victory Royale zum Mitnehmen, bitte.',
    'Meine Lieblingswaffe? Meine Zähne.',
    'Achtung, Achtung: Der Dino ist jetzt live!',
    'Ich esse keine Zuschauer. Nur ein bisschen.',
    'Da war ein Busch. Der Busch war {streamer}.',
    'Ich hab Angst vor Meteoriten. Frag nicht, warum.',
    'Emote-Spam macht auch nicht satt.',
    'Chat, wer hat hier die Bananen verteilt?',
    'Ich wurde ausgebrütet, um zu nerven.',
    'Wort des Tages: Flitzpiepe.',
    'Wenn {streamer} gewinnt, ess ich einen Busch.',
    'Ich brauch keinen Baumodus, ich bin schon gebaut.',
    'Nächste Mission: Snackautomat.',
    'Pausenbrot? Wo? WO?!',
    'Ich hab {streamer} ins Knie gebissen. Aus Liebe.',
    'Rawr heißt übersetzt: Gib Snacks.',
    'Ich war Mitarbeiter des Monats. Im Jura.',
    'Wer hat mein Ei geklaut?!',
    'Ich bin nicht faul, ich spare Energie für die Evolution.',
    'Heute schon gestretcht? Ich komm nicht an meine Zehen.',
    '{streamer} spielt wie ein Tutorial: sehr langsam.',
    'Klatscht mal alle! … Ich kann nicht, kurze Arme.',
    'Ich hätte gern einen Fensterplatz im Battle Bus.',
    'Ist das hier die Bibliothek? Nein? Gut. RAWR!',
    'Mein Horoskop sagt: Heute gibt es Snacks.',
    'Kennt ihr den? Kommt ein Dino in den Stream …',
    'Ich zähl bis drei, dann hab ich Hunger. Eins …',
  ],
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const rand = (a, b) => a + Math.random() * (b - a);

// 0 = gerade gefüttert, 1 = ab jetzt hungrig (und mehr, je länger es her ist)
export function hungerOf(pet, now = Date.now()) {
  if (!pet?.last_fed_at) return 1;
  const minutes = (now - Date.parse(pet.last_fed_at)) / 60000;
  return Math.max(0, minutes / Math.max(1, pet.hungry_after ?? 45));
}
// Heißhunger per Knopf zählt auch als Hunger (roter Rexi)
export const isHungry = (pet, now) => hungerOf(pet, now) >= 1 || isFrenzy(pet);
// Heißhunger per Knopf (pet_frenzy): gilt, bis jemand füttert
export const isFrenzy = (pet) => !!pet?.frenzy_at
  && (!pet.last_fed_at || Date.parse(pet.frenzy_at) >= Date.parse(pet.last_fed_at));
// Heißhunger: doppelt so lange nicht gefüttert (Standard 90 Minuten) oder per Knopf
export const isStarving = (pet, now) => hungerOf(pet, now) >= 2 || isFrenzy(pet);

// {befehl} wird zum Chat-Befehl fürs Füttern (Standard !füttern)
export const HUNGRY_LINES = [
  'HUNGER! Schreibt {befehl} in den Chat!',
  'Mein Magen knurrt lauter als ein Subwoofer.',
  'Wenn mich keiner füttert, knabber ich euch an!',
  'Ich rieche Zuschauer … lecker.',
  '{befehl} – so schwer ist das doch nicht, Chat!',
  'Ich könnte einen ganzen Battle Bus verdrücken.',
  'Hallo? Snacks? Irgendwer? {befehl}!',
  'Mir ist schon ganz schwindelig vor Hunger …',
];
const CLIMB_LINES = [
  'Wenn ihr nicht füttert, ess ich die Karten!',
  'Mmh, knusprige Pixel!',
  'Die Karte schmeckt nach Pixeln.',
  'Ich hab gesagt, ich hab HUNGER!',
  '{befehl} – oder die nächste Karte ist dran!',
  'Knack! Das war die Ecke.',
];
const NIBBLE_LINES = [
  'Hmm, schmeckt nach Flitzpiepe.',
  'Ein bisschen salzig, aber geht.',
  'Knusper, knusper!',
  'Wer nicht füttert, wird gefüttert.',
  'Mampf! Nächster bitte.',
  'Schmeckt wie Montagmorgen.',
  'Zu viel Emote-Spam, schmeckt man sofort.',
  'Nicht schlecht. Ein Hauch von Lag.',
];
export const feedLine = (who) => pick([
  `Danke, ${who}! Mampf!`, `${who}, du bist der Beste! *schmatz*`, `Lecker! ${who} darf bleiben.`, `Endlich! Danke, ${who}!`,
  `${who} hat mich gerettet! *rülps*`, `Mmmh, ${who}, noch einen!`, `Ich verzeih euch alles. Außer ${who}. Nein, auch ${who}.`,
  `Satt und glücklich – danke, ${who}!`,
]);
export const petLine = (who) => pick([
  `Hihi, das kitzelt, ${who}!`, `Rrrr … weiter so, ${who}.`, `${who} darf mich streicheln. Nur ${who}.`, 'Schnurr … äh, ich meine RAWR!',
  `Hinterm Ohr, ${who}! Ach, ich hab keine Ohren.`, `${who}, du hast warme Hände.`,
]);
const SCREEN_LINES = [
  'Mmh, knuspriger Bildschirm!',
  'Ich fress euch das Bild weg!',
  'Wenn ihr nicht füttert, ess ich den Stream!',
  '{befehl} – oder der Bildschirm ist weg!',
  'Pixel schmecken wie Chips!',
  'Full HD? Gleich nur noch Half HD.',
];
export const nibbleLine = () => pick(NIBBLE_LINES);
export const screenLine = () => pick(SCREEN_LINES);
export const climbLine = () => pick(CLIMB_LINES);

// Die Zeichnung (Rexi aus „OBS Overlay v2“ in Claude Design): seitlich, schaut nach rechts.
// Drei Kostüme (data-costume): Kapitän (Mütze + Pfeife), Mechaniker (Streifenmütze +
// Halstuch), Bauarbeiter (Helm + Warnweste). Die ids bleiben (Datenbank). Farben kommen aus CSS-Variablen (--dn-…),
// damit er bei Hunger rot wird (css/pet.css). Teile mit Klassen bewegen sich per CSS,
// Drehpunkte in SVG-Einheiten (viewBox 170 × 140). IDs sind pro Dino eindeutig –
// sonst zeigen alle Dinos auf den Verlauf des ersten.
export const COSTUMES = [
  { id: 'schaffner', name: 'Kapitän', sound: 'whistle' },
  { id: 'lok', name: 'Mechaniker', sound: 'roar' },
  { id: 'bau', name: 'Bauarbeiter', sound: 'step' },
];
export const costumeName = (id) => COSTUMES.find((c) => c.id === id)?.name ?? COSTUMES[0].name;
let svgCount = 0;

// Rexis Teile (wie die anderen Tiere in js/pet-species.js)
function dinoParts(skin) {
  return {
    body: 'M44 80 C42 58 62 44 88 48 C102 50 110 60 111 72 C112 92 100 106 78 106 C58 106 46 96 44 80 Z',
    tail: `<path class="dn-ln" d="M50 78 C30 80 12 72 3 52 C18 66 34 68 52 64 Z" fill="${skin}" stroke-width="2.5" stroke-linejoin="round"/>
        <path class="dn-ln dn-f-s3" d="M22 66 l-3 -7 6 3 M34 70 l-2 -7 6 4" stroke-width="1.6" stroke-linejoin="round"/>`,
    legB: '<path class="dn-ln dn-f-lb" d="M62 94 h14 v19 c0 2 2 3 4 3 h4 c3 0 3 5 0 5 h-18 c-3 0 -4 -2 -4 -4 z" stroke-width="2.5" stroke-linejoin="round"/>',
    legA: `<path class="dn-ln dn-f-lf" d="M80 94 h14 v19 c0 2 2 3 4 3 h4 c3 0 3 5 0 5 h-18 c-3 0 -4 -2 -4 -4 z" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M101 116 v5 M97 116 v5" stroke="#e9f7df" stroke-width="1.4" stroke-linecap="round"/>`,
    arm: '<path class="dn-ln dn-f-lf" d="M103 74 q10 2 11 10 q-4 1 -6 -2 q-2 3 -6 1 z" stroke-width="2" stroke-linejoin="round"/>',
    deco: `<path class="dn-f-bl" d="M60 96 C66 106 88 107 100 96 C106 88 106 78 102 72 C88 78 70 82 60 96 Z"/>
      <path class="dn-st-bs" d="M66 98 q16 5 32 -4 M72 90 q13 2 27 -7 M82 82 q8 0 17 -6" fill="none" stroke-width="1.4" stroke-linecap="round"/>
      <path class="dn-ln dn-f-s3" d="M54 54 l3 -9 5 7 M65 48 l4 -10 5 8 M78 46 l5 -9 4 9 M90 48 l5 -8 3 8" stroke-width="2" stroke-linejoin="round"/>
      <circle class="dn-f-sp" cx="60" cy="66" r="2.2"/><circle class="dn-f-sp" cx="70" cy="59" r="2"/>
      <circle class="dn-f-sp" cx="74" cy="69" r="1.8"/><circle class="dn-f-sp" cx="55" cy="78" r="1.8"/>
      <path d="M58 60 C66 52 80 49 92 51" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>`,
    jaw: `<path class="dn-ln dn-f-jw" d="M102 56 C114 62 136 64 150 58 C150 66 140 72 122 70 C110 69 104 64 102 56 Z" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M120 67 C126 70 136 68 142 64" fill="none" stroke="#e8667a" stroke-width="3" stroke-linecap="round"/>`,
    head: `<path class="dn-ln" d="M96 50 C98 28 120 16 140 22 C154 27 160 42 154 54 C142 60 116 61 102 58 C98 57 96 54 96 50 Z" fill="${skin}" stroke-width="2.5" stroke-linejoin="round"/>
        <path class="dn-ln" d="M118 58 l3 4 3 -4 M128 58 l3 4 3 -4 M138 57 l2 4 3 -4" fill="#fff" stroke-width="1.2" stroke-linejoin="round"/>
        <ellipse cx="133" cy="47" rx="6" ry="3.5" fill="#ff8fa3" opacity=".55"/>
        <circle class="dn-f-ln" cx="151" cy="37" r="1.8"/>`,
    eye: { cx: 120, cy: 38, r: 7.5, white: true },
    brow: 'M111 29 L128 33.5',
  };
}

function eyeSvg({ cx, cy, r, white, slit }) {
  if (!white) {
    return `<g class="dino-eye"><g class="dino-pupil"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#1d1b2f"/><circle cx="${cx + r * 0.3}" cy="${cy - r * 0.35}" r="${r * 0.32}" fill="#fff"/></g></g>`;
  }
  const pupil = slit
    ? `<ellipse cx="${cx + 2}" cy="${cy}" rx="${r * 0.22}" ry="${r * 0.62}" fill="#1d2b1f"/>`
    : `<circle cx="${cx + 2}" cy="${cy}" r="${r * 0.48}" fill="#1d2b1f"/>`;
  return `<g class="dino-eye"><circle class="dn-ln" cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke-width="2"/>
    <g class="dino-pupil">${pupil}<circle cx="${cx + 3.5}" cy="${cy - 1.5}" r="${r * 0.15}" fill="#fff"/></g></g>`;
}

// Die Zeichnung eines Tiers (species aus js/pet-species.js, Standard Rexi). Seitlich, schaut nach rechts.
// Drei Kostüme (data-costume): Kapitän (Mütze + Pfeife), Mechaniker (Streifenmütze +
// Halstuch), Bauarbeiter (Helm + Warnweste). Die ids bleiben (Datenbank). Farben kommen aus CSS-Variablen (--dn-…),
// damit es bei Hunger rot wird (css/pet.css). Teile mit Klassen bewegen sich per CSS,
// Drehpunkte in SVG-Einheiten (viewBox 170 × 140). IDs sind pro Tier eindeutig –
// sonst zeigen alle auf den Verlauf des ersten.
export function dinoSvg(costume = 'schaffner', species = 'dino') {
  const id = `dn${++svgCount}${Math.random().toString(36).slice(2, 6)}`;
  const skin = `url(#${id}-skin)`;
  const kind = isSpecies(species) ? species : 'dino';
  const p = speciesParts(kind, skin) ?? dinoParts(skin);
  const [cx, cy] = p.cap ?? [0, 0];
  const [nx, ny] = p.neck ?? [0, 0];
  return `<svg class="dino-svg" viewBox="0 0 170 140" aria-hidden="true" data-species="${kind}" data-costume="${COSTUMES.some((c) => c.id === costume) ? costume : 'schaffner'}" style="--eye-o: ${p.eye.cx}px ${p.eye.cy}px">
    <defs>
      <clipPath id="${id}-body"><path d="${p.body}"/></clipPath>
      <pattern id="${id}-stripe" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#2d4f86"/><rect width="1.6" height="4" fill="#dfe8f5"/></pattern>
      <linearGradient id="${id}-skin" x1="0" y1="0" x2="0" y2="1"><stop class="dn-s1" offset="0"/><stop class="dn-s2" offset=".6"/><stop class="dn-s3" offset="1"/></linearGradient>
      <linearGradient id="${id}-cap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3e6b"/><stop offset="1" stop-color="#16223f"/></linearGradient>
    </defs>
    <ellipse class="dino-shadow" cx="82" cy="122" rx="36" ry="5" fill="#000"/>
    <g class="dino-bodyg">
      ${p.back ?? ''}
      <g class="dino-tail">${p.tail}</g>
      <g class="dino-leg dino-leg-b">${p.legB}</g>
      <path class="dn-ln" d="${p.body}" fill="${skin}" stroke-width="2.5" stroke-linejoin="round"/>
      ${p.deco}
      <g class="dino-leg dino-leg-a">${p.legA}</g>
      <g class="dino-arm">${p.arm}</g>
      <g class="dn-c dn-c-bau dn-vest" clip-path="url(#${id}-body)">
        <path d="M40 58 H116 V110 H40 Z" fill="#ff7a1a" opacity=".96"/>
        <path d="M40 74 H116 M40 90 H116" stroke="#e6ecf2" stroke-width="4"/>
        <path d="M40 74 H116 M40 90 H116" stroke="#9aa6b4" stroke-width="1" stroke-dasharray="2 3"/>
        <path d="M84 50 V108" stroke="#b34c05" stroke-width="1.6"/>
      </g>
      <g transform="translate(${nx} ${ny})">
        <g class="dn-c dn-c-schaffner dn-cord">
          <path d="M97 60 C100 70 106 76 112 77" fill="none" stroke="#ffb81c" stroke-width="1.8" stroke-linecap="round"/>
          <g class="dino-whistle">
            <path d="M110 76 h10 a3.5 3.5 0 0 1 0 7 h-6 l-1 3 h-3 z" fill="#dfe4ec" stroke="#5b6475" stroke-width="1.1" stroke-linejoin="round"/>
            <circle cx="118" cy="79.5" r="1.4" fill="#5b6475"/>
          </g>
        </g>
        <g class="dn-c dn-c-lok dn-scarf">
          <path d="M94 56 C101 62 110 63 115 58 L107 78 Z" fill="#e0322a" stroke="#7d0c12" stroke-width="1.6" stroke-linejoin="round"/>
          <circle cx="104" cy="63" r="1.3" fill="#fff3cf"/><circle cx="109" cy="62" r="1.1" fill="#fff3cf"/><circle cx="106" cy="69" r="1.1" fill="#fff3cf"/>
          <path d="M95 56 l-6 -3 l1 7 z M95 56 l-7 4 l5 4 z" fill="#c4271f" stroke="#7d0c12" stroke-width="1.2" stroke-linejoin="round"/>
        </g>
      </g>
      <g class="dino-head">
        ${p.headBack ?? ''}
        <g class="dino-jaw">${p.jaw}</g>
        ${p.head}
        ${p.face ?? ''}
        ${eyeSvg(p.eye)}
        <path class="dino-brow dn-ln" d="${p.brow}" stroke-width="3" stroke-linecap="round"/>
        <g class="dino-cap"><g transform="translate(${cx} ${cy})">
          <g class="dn-c dn-c-schaffner dn-hat">
            <path d="M103 28 C102 14 116 6 132 9 C140 11 143 18 141 27 Z" fill="url(#${id}-cap)" stroke="#0c1426" stroke-width="2" stroke-linejoin="round"/>
            <path d="M103 23.5 L141 22.5 L141 27.5 L103 28 Z" fill="#ffb81c" stroke="#8a5a00" stroke-width=".8"/>
            <path d="M138 23 C148 23 157 26 160 31 C151 32 142 31 136 28 Z" fill="#0c1426"/>
            <circle cx="121" cy="16" r="3.2" fill="#ffd36b" stroke="#8a5a00" stroke-width=".8"/>
            <path d="M113 16 h4 M125 16 h4" stroke="#ffd36b" stroke-width="1.4" stroke-linecap="round"/>
            <path d="M109 12 C113 10 118 9 122 9" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/>
          </g>
          <g class="dn-c dn-c-lok dn-hat">
            <path d="M102 28 C101 14 115 7 131 9 C140 11 144 18 142 27 Z" fill="url(#${id}-stripe)" stroke="#12203b" stroke-width="2" stroke-linejoin="round"/>
            <path d="M102 24 L142 23" stroke="#12203b" stroke-width="1.2"/>
            <path d="M138 23 C148 22 158 25 161 31 C151 32 142 31 136 28 Z" fill="#2d4f86" stroke="#12203b" stroke-width="1.4" stroke-linejoin="round"/>
            <circle cx="120" cy="9.5" r="2" fill="#12203b"/>
          </g>
          <g class="dn-c dn-c-bau dn-hat">
            <path d="M101 27 C100 11 116 3 132 6 C143 8 147 17 146 27 Z" fill="#ff8a1c" stroke="#7a3e00" stroke-width="2" stroke-linejoin="round"/>
            <path d="M122 5 C125 12 125 20 124 27" fill="none" stroke="#ffc27a" stroke-width="3" stroke-linecap="round"/>
            <path d="M96 26.5 H152 C155 26.5 155 31 152 31 H96 C93 31 93 26.5 96 26.5 Z" fill="#e6700f" stroke="#7a3e00" stroke-width="1.4"/>
            <path d="M106 12 C110 9 114 7 118 6.5" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>
          </g>
        </g></g>
      </g>
    </g>
  </svg>`;
}
export const petSvg = dinoSvg;

// Bissen beim Kartenfressen (aus Claude Design): [x %, y %, Radius px bei 400 px Kartenbreite].
// Er beginnt an der Kante in halber Höhe und frisst sich zur oberen Ecke vor.
// Am rechten Rand gespiegelt (x = 100 − x) und etwas größer.
const BITES = [[0, 62, 26], [0, 46, 20], [6, 30, 22], [0, 80, 24], [14, 14, 26], [4, 96, 22], [24, 2, 24], [10, 62, 20], [38, 0, 22]];
const BITE_EVERY = 650;
// Brüllen je Tier (Trick „roar“; der Drache spuckt dabei Feuer, css/pet.css)
const ROARS = {
  dino: ['RAWR!', 'RAAAWR!!', 'ROOOAAR!'], cat: ['MIAUUU!', 'FAUCH!', 'MRRRAU!'], fox: ['WAU-WAU-WAU!', 'KJAAA!', 'YIP YIP!'],
  axolotl: ['BLUBB!', 'BLUBBBB!!', '*quiek*'], penguin: ['NOOT!', 'KRAAH!', 'QUÄK!'], dragon: ['FUUUSCH!', 'ROOOAAAR!', 'FEUER!'],
};
const CLIMB_MAX = 100_000; // so lange frisst er höchstens am Stück, dann klettert er runter

// Der Dino in einem Behälter (position: relative/fixed). Läuft allein hin und her.
export class Dino {
  constructor(container, { size = 150, sfx = null, name = 'Rexi', costume = 'schaffner', species = 'dino', stage = 'adult', reducedMotion = false } = {}) {
    this.container = container;
    this.size = size;
    this.sfx = sfx;
    this.reducedMotion = reducedMotion;
    this.el = document.createElement('div');
    this.el.className = 'dino';
    this.el.style.setProperty('--ds', `${size}px`);
    this.species = isSpecies(species) ? species : 'dino';
    this.el.dataset.species = this.species;
    this.el.innerHTML = `<div class="dino-chat" hidden></div><div class="dino-bubble" hidden></div><div class="dino-pose"><div class="dino-grow"><div class="dino-body">${dinoSvg(costume, this.species)}</div></div><div class="pet-egg">${eggSvg()}</div></div><span class="dino-tag"><i></i><b></b></span>`;
    this.egg = this.el.querySelector('.pet-egg');
    this.setStage(stage);
    this.bubble = this.el.querySelector('.dino-bubble');
    this.chat = this.el.querySelector('.dino-chat');
    this.body = this.el.querySelector('.dino-body');
    this.svg = this.el.querySelector('.dino-svg');
    this.costume = this.svg.dataset.costume;
    this.tag = this.el.querySelector('.dino-tag b');
    this.y = 0;          // Höhe über dem Boden (Klettern)
    this.bitten = new Set(); // angeknabberte Karten – wachsen nach dem Füttern wieder zu
    this.setName(name);
    container.append(this.el);
    this.x = rand(0, Math.max(0, this.width() - size));
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.target = null;
    this.pauseUntil = performance.now() + rand(500, 2000);
    this.goal = null; // {x, resolve} für walkTo()
    this.queue = [];
    this.speaking = false;
    this.busy = false;
    this.last = performance.now();
    this.frame = (t) => this.step(t);
    this.raf = requestAnimationFrame(this.frame);
    this.blinkTimer = setInterval(() => this.blink(), 3800);
  }

  width() { return this.container.clientWidth; }

  // ---------- Tierart und Stadium (Ei → Baby → Erwachsen) ----------
  // Anderes Tier: gleiche Gelenke, neue Zeichnung – Kostüm bleibt
  setSpecies(id) {
    if (!isSpecies(id) || id === this.species) return false;
    this.species = id;
    this.el.dataset.species = id;
    this.body.innerHTML = dinoSvg(this.costume, id);
    this.svg = this.body.querySelector('.dino-svg');
    if (!this.reducedMotion) this.flash('is-change', 700);
    return true;
  }

  // egg | baby | adult. Im Ei läuft und spricht es nicht.
  setStage(stage) {
    this.stage = ['egg', 'baby', 'adult'].includes(stage) ? stage : 'adult';
    this.el.dataset.stage = this.stage;
    if (this.stage === 'egg') {
      this.goal?.resolve();
      this.goal = null;
      this.target = null;
      this.el.classList.remove('is-walking', 'is-hungry', 'is-starving');
    }
  }

  // Wie weit das Ei ist (0 … 1): ab der Hälfte Risse, kurz vor Schluss schauen Augen heraus
  setEggProgress(p) {
    const v = Math.max(0, Math.min(1, Number(p) || 0));
    this.egg.style.setProperty('--egg-p', v.toFixed(2));
    this.el.classList.toggle('egg-cracked', v >= 0.5);
    this.el.classList.toggle('egg-peek', v >= 0.85);
  }

  // Ei wackelt (beim Füttern im Ei-Stadium)
  wobble() {
    if (this.stage !== 'egg') return;
    this.sound('hop');
    this.flash('is-wobble', 900);
  }

  flash(cls, ms) {
    this.el.classList.remove(cls);
    void this.el.offsetWidth;
    this.el.classList.add(cls);
    clearTimeout(this.flashTimers?.[cls]);
    (this.flashTimers ??= {})[cls] = setTimeout(() => this.el.classList.remove(cls), ms);
  }

  // Schlüpfen: Ei zittert, platzt, das Baby hüpft heraus
  async hatch() {
    if (this.stage !== 'egg') return;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    this.busy = true;
    try {
      this.setEggProgress(1);
      if (!this.reducedMotion) {
        this.el.classList.add('is-hatching');
        this.sound('growl');
        await wait(1400);
      }
      this.sound('hop');
      this.setStage('baby');
      this.el.classList.remove('is-hatching');
      if (!this.reducedMotion) {
        this.flash('is-hatched', 1200);
        this.sparkle(10);
      }
      this.sound('happy');
      this.say('Hallo Welt!', 3200);
    } finally {
      this.busy = false;
      this.pauseUntil = performance.now() + 2500;
    }
  }

  // Wachsen: leuchtet auf und wird groß
  async grow() {
    if (this.stage !== 'baby') return;
    this.busy = true;
    try {
      if (!this.reducedMotion) {
        this.el.classList.add('is-growing');
        await new Promise((r) => setTimeout(r, 900));
      }
      this.setStage('adult');
      this.el.classList.remove('is-growing');
      if (!this.reducedMotion) { this.flash('is-grown', 1200); this.sparkle(14); }
      this.sound('frenzy');
      this.say('Ich bin groß!', 3200);
    } finally {
      this.busy = false;
      this.pauseUntil = performance.now() + 2500;
    }
  }

  // Funken rund ums Tier (Schlüpfen, Wachsen)
  sparkle(n = 10) {
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'pet-spark';
      s.textContent = pick(['✨', '⭐', '💫', '🎉']);
      s.style.setProperty('--ds', `${this.size}px`);
      s.style.left = `${this.x + this.size * rand(0.1, 0.9)}px`;
      s.style.setProperty('--dx', `${rand(-1, 1) * this.size * 0.5}px`);
      s.style.animationDelay = `${i * 50}ms`;
      this.container.append(s);
      setTimeout(() => s.remove(), 1600 + i * 50);
    }
  }
  setName(name) { this.tag.textContent = name; }
  setHungry(on) { this.el.classList.toggle('is-hungry', !!on && this.stage !== 'egg'); }
  sound(id, big) { rexiSound(this.sfx, id, big); }

  // Heißhunger: Rexi wächst (1,3 ×) und brüllt einmal laut, wenn es losgeht
  setStarving(on) {
    on = !!on && this.stage !== 'egg';
    if (on === !!this.starving) return;
    this.starving = on;
    this.el.classList.toggle('is-starving', on);
    if (on) this.sound('frenzy');
  }

  // Kostüm wechseln (schaffner, lok, bau) – mit passendem Sound, nur wenn es sich ändert
  setCostume(id, { sound = true } = {}) {
    const c = COSTUMES.find((x) => x.id === id);
    if (!c || c.id === this.costume) return false;
    this.costume = c.id;
    this.svg.dataset.costume = c.id;
    if (sound) {
      this.sound(c.sound);
      if (c.sound === 'step') setTimeout(() => this.sound('step'), 260);
    }
    if (!this.reducedMotion) {
      this.el.classList.remove('is-change');
      void this.el.offsetWidth;
      this.el.classList.add('is-change');
      clearTimeout(this.changeTimer);
      this.changeTimer = setTimeout(() => this.el.classList.remove('is-change'), 700);
    }
    return true;
  }

  // Chat-Zeile über dem Dino: „@user !change lok → LOKFÜHRER“
  chatLine(who, costume) {
    this.chat.replaceChildren();
    const name = document.createElement('b');
    name.textContent = `@${who || 'Chat'}`;
    const to = document.createElement('strong');
    to.textContent = costumeName(costume).toUpperCase();
    this.chat.append(name, ` !change ${costume} → `, to);
    this.chat.hidden = false;
    this.el.classList.add('has-chat');
    this.chat.classList.remove('is-in');
    void this.chat.offsetWidth;
    this.chat.classList.add('is-in');
    clearTimeout(this.chatTimer);
    this.chatTimer = setTimeout(() => {
      this.chat.hidden = true;
      this.el.classList.remove('has-chat');
    }, 4200);
  }

  destroy() {
    this.wake();
    this.regrow();
    cancelAnimationFrame(this.raf);
    clearInterval(this.blinkTimer);
    clearTimeout(this.chatTimer);
    this.el.remove();
  }

  blink() {
    this.el.classList.add('is-blink');
    setTimeout(() => this.el.classList.remove('is-blink'), 160);
  }

  // Umdrehen: erst schauen die Pupillen in die neue Richtung, dann dreht er sich
  face(dir) {
    if (dir === this.dir && !this.turning) return;
    if (this.turning) { this.turning.dir = dir; return; }
    if (this.reducedMotion || !this.el.classList.contains('is-walking')) {
      this.dir = dir;
      this.body.classList.toggle('is-left', dir < 0);
      return;
    }
    this.turning = { dir };
    this.el.classList.add('is-glance');
    setTimeout(() => {
      this.dir = this.turning.dir;
      this.turning = null;
      this.el.classList.remove('is-glance');
      this.body.classList.toggle('is-left', this.dir < 0);
    }, 220);
  }

  // Sprechblase und Chat-Zeile bleiben im Bild, auch wenn der Dino am Rand steht
  keepInView(el) {
    const bw = el.offsetWidth;
    const left = this.x + this.size / 2 - bw / 2;
    const W = this.width();
    let shift = 0;
    if (left < 6) shift = 6 - left;
    else if (left + bw > W - 6) shift = W - 6 - (left + bw);
    el.style.setProperty('--bx', `${Math.round(shift)}px`);
  }

  step(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const max = Math.max(0, this.width() - this.size);
    let walking = false;
    // Klettern: senkrecht zur Zielhöhe
    if (this.climbGoal) {
      const dy = this.climbGoal.y - this.y;
      // Wird er gefüttert, springt er schnell herunter
      const speed = this.size * 0.9 * (this.abortClimb ? 3.5 : 1);
      if (Math.abs(dy) < 2 || this.reducedMotion) {
        this.y = this.climbGoal.y;
        const done = this.climbGoal.resolve;
        this.climbGoal = null;
        done();
      } else {
        this.y += Math.sign(dy) * Math.min(Math.abs(dy), speed * dt);
      }
      this.el.style.transform = `translate(${this.x}px, ${-this.y}px)`;
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    if (this.goal || (!this.busy && !this.sleeping && this.stage !== 'egg' && t > this.pauseUntil)) {
      if (this.goal) this.target = this.goal.free ? this.goal.x : Math.min(max, Math.max(0, this.goal.x));
      else if (this.target === null) this.target = rand(0, max);
      const dx = this.target - this.x;
      const speed = this.size * (this.goal ? 1.1 : 0.55) * (this.el.classList.contains('is-hungry') ? 0.8 : 1);
      if (Math.abs(dx) < 2 || this.reducedMotion) {
        this.x = this.target;
        this.target = null;
        if (this.goal) { const done = this.goal.resolve; this.goal = null; done(); }
        else this.pauseUntil = t + rand(1500, 5000);
      } else {
        walking = true;
        this.el.classList.add('is-walking');
        this.face(Math.sign(dx));
        this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
      }
    }
    if (!this.climbing) this.x = Math.min(max, Math.max(0, this.x));
    this.el.classList.toggle('is-walking', walking);
    // Kleine Staubwölkchen an den Füßen
    if (walking && !this.reducedMotion && t - (this.dustAt ?? 0) > 380) {
      this.dustAt = t;
      this.dust();
    }
    this.el.style.transform = `translate(${this.x}px, ${-this.y}px)`;
    if (this.speaking) this.keepInView(this.bubble);
    if (!this.chat.hidden) this.keepInView(this.chat);
    this.raf = requestAnimationFrame(this.frame);
  }

  dust() {
    const d = document.createElement('span');
    d.className = 'dino-dust';
    d.style.setProperty('--ds', `${this.size}px`);
    d.style.left = `${this.x + this.size * (this.dir > 0 ? 0.35 : 0.6)}px`;
    this.container.append(d);
    setTimeout(() => d.remove(), 700);
  }

  // Kurze Einlage zwischendurch: hüpfen, brüllen, umschauen, tanzen, umdrehen
  async trick(kind = pick(['hop', 'roar', 'look', 'dance', 'turn'])) {
    if (this.busy || this.sleeping) return;
    if (this.stage === 'egg') { this.wobble(); return; }
    this.busy = true;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      if (kind === 'hop') {
        for (let i = 0; i < 2; i++) {
          this.sound('hop');
          this.el.classList.add('is-hop');
          await wait(520);
          this.el.classList.remove('is-hop');
          await wait(80);
        }
      } else if (kind === 'roar') {
        this.sound('roar');
        this.el.classList.add('is-roar');
        this.say(pick(ROARS[this.species] ?? ROARS.dino), 1800);
        await wait(1300);
        this.el.classList.remove('is-roar');
      } else if (kind === 'look') {
        this.el.classList.add('is-look');
        await wait(1800);
        this.el.classList.remove('is-look');
      } else if (kind === 'dance') {
        this.el.classList.add('is-dance');
        await wait(2400);
        this.el.classList.remove('is-dance');
      } else {
        this.face(-this.dir);
        await wait(500);
        this.face(-this.dir);
        await wait(300);
      }
    } finally {
      this.busy = false;
      this.pauseUntil = performance.now() + 1200;
    }
  }

  // Magenknurren (bei Hunger ab und zu): Bauch wackelt, tiefes Grummeln
  rumble() {
    if (this.sleeping) return;
    this.sound('growl');
    this.el.classList.add('is-rumble');
    setTimeout(() => this.el.classList.remove('is-rumble'), 900);
  }

  // Nickerchen: Augen zu, Zzz steigen auf, leises Schnarchen. wake() oder jede Aktion weckt ihn.
  sleep(ms = 12000) {
    if (this.busy || this.sleeping || this.stage === 'egg') return;
    this.sleeping = true;
    this.el.classList.add('is-sleep');
    this.zzz = setInterval(() => {
      const z = document.createElement('span');
      z.className = 'dino-zzz';
      z.textContent = 'z';
      z.style.setProperty('--ds', `${this.size}px`);
      z.style.left = `${this.x + this.size * (this.dir > 0 ? 0.8 : 0.2)}px`;
      this.container.append(z);
      setTimeout(() => z.remove(), 2200);
    }, 700);
    this.sound('snore');
    this.snoreTimer = setInterval(() => this.sound('snore'), 4000);
    this.sleepTimer = setTimeout(() => this.wake(), ms);
  }

  wake() {
    if (!this.sleeping) return;
    this.sleeping = false;
    clearInterval(this.zzz);
    clearInterval(this.snoreTimer);
    clearTimeout(this.sleepTimer);
    this.el.classList.remove('is-sleep');
    this.pauseUntil = performance.now() + 600;
  }

  // free = true: auch über den Rand des Behälters hinaus (Bildschirmkante beim Fressen)
  walkTo(x, { free = false } = {}) {
    return new Promise((resolve) => {
      this.goal?.resolve();
      this.goal = { x, resolve, free };
    });
  }

  climbTo(y) {
    return new Promise((resolve) => {
      this.climbGoal?.resolve();
      this.climbGoal = { y, resolve };
    });
  }

  // Heißhunger: an einer Karte hochklettern und Stücke aus dem Rand fressen (9 Bissen,
  // dann weiterkauen, solange hold() stimmt – höchstens CLIMB_MAX).
  // card = sichtbares Element im Bild, side = bevorzugte Kante ('left'/'right', sonst die nähere).
  // Liefert false, wenn die Karte nicht passt.
  async climb(card, { line = climbLine(), side: prefer = null, hold = () => false } = {}) {
    this.wake();
    if (this.busy || !card || this.stage === 'egg') return false;
    const box = this.container.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    // Bei Heißhunger ist er 1,3 × so groß – gewachsen um denselben Drehpunkt wie beim
    // Klettern (css/pet.css), der Kopf sitzt also höher, die Füße bleiben, wo sie sind.
    const w = this.size * (this.starving ? 1.3 : 1);
    const h = this.size * 140 / 170;
    // Bissstelle: bei Heißhunger im oberen Drittel (er frisst sich zur Ecke vor), sonst
    // in halber Höhe – gemessen vom Boden des Dinos. Beim Fressen lehnt er sich schräger
    // an (css/pet.css) und rückt dafür näher an die Kante.
    const biteY = r.top + r.height * (this.starving ? 0.2 : 0.45) - box.top;
    const lift = box.height - 0.14 * h - 0.43 * w - biteY;
    if (lift < w * 0.25 || r.height < w * 0.3) return false;
    const lean = this.starving ? 0.19 * this.size : 0;
    const leftX = r.left - box.left - 0.61 * this.size + lean;
    const rightX = r.right - box.left - 0.39 * this.size - lean;
    const fits = (x) => x >= -w * 0.2 && x <= box.width - w * 0.8;
    const center = this.x + this.size / 2;
    let side = prefer ?? (Math.abs(center - (r.left - box.left)) < Math.abs(center - (r.right - box.left)) ? 'left' : 'right');
    if (!fits(side === 'left' ? leftX : rightX)) side = side === 'left' ? 'right' : 'left';
    const x = side === 'left' ? leftX : rightX;
    if (!fits(x)) return false;

    this.busy = true;
    this.climbing = true;
    let finished;
    this.climbDone = new Promise((res) => { finished = res; });
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const started = Date.now();
    try {
      this.sound('growl');
      await this.walkTo(x);
      this.face(side === 'left' ? 1 : -1);
      await wait(260);
      this.el.classList.add('is-climb', side === 'left' ? 'climb-right' : 'climb-left');
      await wait(420);
      await this.climbTo(lift);
      this.say(line, 4200);
      this.bitten.add(card);
      const scale = r.width / 400;
      for (let i = 0; !this.abortClimb; i++) {
        const eating = i < BITES.length;
        if (!eating && (!hold() || Date.now() - started > CLIMB_MAX)) break;
        // Die Karte wackelt (eigene Eigenschaft „rotate“, stört ihre Animationen nicht)
        if (eating && !this.reducedMotion) {
          card.animate?.([{ rotate: '0deg' }, { rotate: '-1.2deg' }, { rotate: '1.2deg' }, { rotate: '-.6deg' }, { rotate: '0deg' }], { duration: 420, easing: 'ease-in-out' });
        }
        this.el.classList.add('is-chomp');
        if (eating) {
          this.sound('bite');
          biteCard(card, side, BITES[i], scale);
          this.crumbs(card, side);
        } else if (i % 2) {
          this.sound('chomp');
        }
        await wait(eating ? 260 : 200);
        this.el.classList.remove('is-chomp');
        await wait(eating ? BITE_EVERY - 260 : 700);
        // Zwischendurch drohen, solange keiner füttert
        if (!eating && i % 12 === 0) this.say(line, 3600);
      }
      if (!this.abortClimb) await wait(800);
      await this.climbTo(0);
      this.el.classList.remove('is-climb', 'climb-right', 'climb-left');
      await wait(300);
      return true;
    } finally {
      this.climbing = false;
      this.busy = false;
      this.pauseUntil = performance.now() + 2500;
      finished();
    }
  }

  // Heißhunger: an der Bildschirmkante hochklettern und Löcher ins Streambild fressen
  // (holes = ScreenHoles aus js/screen-holes.js). Erst 8 Bissen in Folge, dann weiter,
  // solange hold() stimmt – alle paar Sekunden ein neues, größeres Loch. Füttern beendet es.
  async eatScreen(holes, { line = screenLine(), hold = () => false } = {}) {
    this.wake();
    if (this.busy || !holes || this.stage === 'egg') return false;
    const box = this.container.getBoundingClientRect();
    const size = this.size;
    const w = size * (this.starving ? 1.3 : 1);
    const h = size * 140 / 170;
    // Zur näheren Kante des Bildschirms
    const edge = box.left + this.x + size / 2 < innerWidth / 2 ? 'left' : 'right';
    const lean = this.starving ? 0.19 * size : 0;
    const x = edge === 'left' ? -box.left - 0.39 * size - lean : innerWidth - box.left - 0.61 * size + lean;
    const liftFor = (screenY) => Math.max(w * 0.3, box.height - 0.14 * h - 0.43 * w - (screenY - box.top));
    let lift = liftFor(innerHeight * rand(0.4, 0.55));
    const top = liftFor(innerHeight * 0.14);

    this.busy = true;
    this.climbing = true;
    this.screenHoles = holes;
    let finished;
    this.climbDone = new Promise((res) => { finished = res; });
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    // Loch vor dem Maul – neben ihm im Bild, damit man es sieht (er hängt an der Kante).
    // Je länger er frisst (depth 0 … 1), desto weiter ins Bild hinein.
    const bite = (r, depth) => {
      const jaw = this.el.querySelector('.dino-jaw').getBoundingClientRect();
      const jx = jaw.left + jaw.width / 2;
      const inward = size * (0.45 + depth * 1.4) * rand(0.85, 1.15);
      const cx = edge === 'left' ? Math.max(r * 0.4, jx + inward) : Math.min(innerWidth - r * 0.4, jx - inward);
      const cy = jaw.top + jaw.height / 2 - size * 0.18 + rand(-0.15, 0.15) * size;
      holes.bite(cx, cy, r, { reducedMotion: this.reducedMotion });
      if (!this.reducedMotion) holes.shake();
    };
    const started = Date.now();
    try {
      this.sound('growl');
      await this.walkTo(x, { free: true });
      this.face(edge === 'left' ? -1 : 1);
      await wait(260);
      this.el.classList.add('is-climb', edge === 'left' ? 'climb-left' : 'climb-right');
      await wait(420);
      await this.climbTo(lift);
      this.say(line, 4200);
      for (let i = 0; !this.abortClimb; i++) {
        const eating = i < 8;
        if (!eating && (!hold() || Date.now() - started > CLIMB_MAX)) break;
        this.el.classList.add('is-chomp');
        if (eating || i % 3 === 0) {
          this.sound('bite');
          bite(size * (eating ? rand(0.32, 0.44) : rand(0.38, 0.56)), Math.min(1, i / 30));
        } else {
          this.sound('chomp');
        }
        await wait(eating ? 260 : 220);
        this.el.classList.remove('is-chomp');
        // Er frisst sich die Kante hoch (und ab und zu wieder ein Stück runter)
        if (i % 3 === 2 && !this.abortClimb) {
          lift = Math.min(top, Math.max(w * 0.3, lift + size * (Math.random() < 0.75 ? rand(0.2, 0.4) : -rand(0.2, 0.5))));
          await this.climbTo(lift);
        }
        await wait(eating ? BITE_EVERY - 260 : 900);
        if (!eating && i % 10 === 0) this.say(line, 3600);
      }
      if (!this.abortClimb) await wait(800);
      await this.climbTo(0);
      this.el.classList.remove('is-climb', 'climb-right', 'climb-left');
      await wait(200);
      if (!this.abortClimb) await this.walkTo(edge === 'left' ? 0 : this.width() - size);
      else this.x = Math.min(Math.max(0, this.x), this.width() - size);
      return true;
    } finally {
      this.climbing = false;
      this.busy = false;
      this.pauseUntil = performance.now() + 2500;
      finished();
    }
  }

  // Krümel fallen von der Bissstelle
  crumbs(card, side) {
    if (this.reducedMotion) return;
    const box = this.container.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('span');
      c.className = 'dino-crumb';
      c.style.left = `${(side === 'left' ? r.left : r.right) - box.left + rand(-6, 6)}px`;
      c.style.top = `${r.top + r.height * rand(0.3, 0.6) - box.top}px`;
      c.style.setProperty('--dx', `${(side === 'left' ? -1 : 1) * rand(10, 50)}px`);
      c.style.animationDelay = `${i * 90}ms`;
      this.container.append(c);
      setTimeout(() => c.remove(), 1600 + i * 90);
    }
  }

  // Nach dem Füttern: angeknabberte Karten wachsen wieder zu
  regrow() {
    for (const card of this.bitten) regrowCard(card);
    this.bitten.clear();
    this.screenHoles?.repair();
  }

  // Sprechblase; mehrere Sätze kommen nacheinander
  say(text, ms = 4200) {
    if (!text || this.stage === 'egg') return;
    this.wake();
    if (this.queue.length >= 4) this.queue.shift();
    this.queue.push({ text, ms });
    if (!this.speaking) this.nextLine();
  }

  nextLine() {
    const line = this.queue.shift();
    if (!line) { this.speaking = false; this.bubble.hidden = true; return; }
    this.speaking = true;
    this.bubble.textContent = line.text;
    this.bubble.hidden = false;
    this.bubble.classList.remove('is-in');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('is-in');
    this.el.classList.add('is-talking');
    setTimeout(() => this.el.classList.remove('is-talking'), Math.min(1200, line.ms));
    setTimeout(() => this.nextLine(), line.ms);
  }

  async chomp(times = 3) {
    for (let i = 0; i < times; i++) {
      this.el.classList.add('is-chomp');
      this.sound('chomp');
      await new Promise((r) => setTimeout(r, 160));
      this.el.classList.remove('is-chomp');
      await new Promise((r) => setTimeout(r, 140));
    }
  }

  // Läuft zu einem Namensschild, beißt hinein – das Schild fällt runter
  async nibble(name) {
    this.wake();
    if (this.busy || this.stage === 'egg') return;
    this.busy = true;
    try {
      this.sound('growl');
      const chip = document.createElement('span');
      chip.className = 'dino-snack';
      chip.textContent = name;
      this.container.append(chip);
      const w = this.width();
      const cw = chip.offsetWidth;
      const cx = Math.random() < 0.5 ? rand(w * 0.08, w * 0.4) : rand(w * 0.6, Math.max(w * 0.6, w * 0.92 - cw));
      chip.style.left = `${cx}px`;
      chip.style.setProperty('--ds', `${this.size}px`);
      chip.classList.add('is-in');
      this.say(`*knabbert an ${name}*`, 3600);
      const fromLeft = this.x + this.size / 2 < cx;
      await this.walkTo(fromLeft ? cx - this.size * 0.78 : cx + cw - this.size * 0.22);
      this.face(fromLeft ? 1 : -1);
      chip.classList.add('is-bitten');
      await this.chomp(3);
      chip.classList.add('is-gone');
      this.say(nibbleLine(), 3600);
      setTimeout(() => chip.remove(), 1400);
    } finally {
      this.pauseUntil = performance.now() + 2500;
      this.busy = false;
    }
  }

  // Futter fällt vom Himmel, der Dino schnappt es – danach Rülpser und Freude
  async eat(who) {
    this.wake();
    if (this.stage === 'egg') { this.wobble(); return; }
    // Hängt er gerade an einer Karte: erst runterklettern, dann fressen
    if (this.climbing) {
      this.abortClimb = true;
      await this.climbDone;
      this.abortClimb = false;
    }
    this.busy = true;
    try {
      const food = document.createElement('span');
      food.className = 'dino-food';
      food.textContent = pick(['🍖', '🍗', '🥩', '🍕', '🥨']);
      food.style.setProperty('--ds', `${this.size}px`);
      const fx = this.x + (this.dir > 0 ? this.size * 0.9 : this.size * 0.1);
      food.style.left = `${fx}px`;
      this.container.append(food);
      await new Promise((r) => setTimeout(r, 650));
      food.remove();
      await this.chomp(2);
      this.sound('burp');
      setTimeout(() => this.sound('happy'), 700);
      this.say(feedLine(who), 4200);
      this.regrow();
      // Freudentanz
      this.el.classList.add('is-dance');
      await new Promise((r) => setTimeout(r, 1600));
      this.el.classList.remove('is-dance');
    } finally {
      this.busy = false;
      this.pauseUntil = performance.now() + 2000;
    }
  }

  // Streicheln: Herzchen steigen auf
  cuddle(who) {
    this.wake();
    this.sound('happy');
    for (let i = 0; i < 5; i++) {
      const h = document.createElement('span');
      h.className = 'dino-heart';
      h.textContent = pick(['💚', '💖', '✨']);
      h.style.left = `${this.x + this.size * rand(0.3, 0.8)}px`;
      h.style.setProperty('--ds', `${this.size}px`);
      h.style.animationDelay = `${i * 120}ms`;
      this.container.append(h);
      setTimeout(() => h.remove(), 2200 + i * 120);
    }
    this.el.classList.add('is-happy');
    setTimeout(() => this.el.classList.remove('is-happy'), 1600);
    this.say(petLine(who), 3800);
  }
}

// Bissen in einer Karte: Löcher am Rand per CSS-Maske (mehrere Kreise, geschnitten).
// --bite (css/pet.css, @property) schrumpft beim Nachwachsen von 1 auf 0.
const MAX_BITES = 12;
function biteCard(card, side, [x, y, r], scale = 1) {
  const bites = (card.dinoBites ??= []);
  if (bites.length >= MAX_BITES) bites.shift();
  bites.push({ x: side === 'left' ? x : 100 - x, y, r: Math.max(6, Math.round((side === 'left' ? r : r + 4) * scale)) });
  paintBites(card);
}
function paintBites(card) {
  const bites = card.dinoBites ?? [];
  if (!bites.length) {
    for (const k of ['webkitMaskImage', 'maskImage', 'webkitMaskComposite', 'maskComposite']) card.style[k] = '';
    card.classList.remove('dino-bitten', 'dino-regrowing');
    return;
  }
  const layers = bites.map((b) => `radial-gradient(circle at ${b.x}% ${b.y}%, transparent calc(var(--bite) * ${b.r}px), #000 calc(var(--bite) * ${b.r}px + 1px))`).join(', ');
  card.classList.add('dino-bitten');
  card.style.webkitMaskImage = layers;
  card.style.maskImage = layers;
  card.style.webkitMaskComposite = 'source-in';
  card.style.maskComposite = 'intersect';
}
function regrowCard(card) {
  if (!card.dinoBites?.length) return;
  card.classList.add('dino-regrowing');
  setTimeout(() => { card.dinoBites = []; paintBites(card); }, 900);
}

// Der Kopf der Sache: plant Sprüche, Einlagen, Nickerchen, Hunger und Knabbern.
// getPet() liefert jeweils den aktuellen Stand, names() mögliche Opfer,
// cards() (nur im Overlay) Karten, an denen er bei Heißhunger hochklettern darf –
// die erste (die Karte „Als Nächstes“) bevorzugt er, von rechts. screen (ScreenHoles,
// nur im Overlay): dann frisst er abwechselnd Löcher in den Bildschirm und Karten an.
// screenOnFrenzy: Bildschirm nur bei Heißhunger per Knopf (Vorschau im OBS-Fenster).
// Sprüche passend zum Tier: Dino-Sprüche aus der Datenbank nur beim Dino, sonst die des Tiers dazu
export function petLines(pet) {
  const base = pet?.phrases?.length ? pet.phrases : DEFAULT_PET.phrases;
  const species = pet?.species ?? 'dino';
  if (species === 'dino') return base;
  const own = SPECIES_LINES[species] ?? [];
  const rest = base.filter((l) => !DINO_ONLY.test(l));
  return [...own, ...own, ...rest];
}

export function runDino(dino, { getPet, names, streamer = null, cards = null, screen = null, screenOnFrenzy = false, idleEvery = [45, 90], nibbleEvery = [40, 75], trickEvery = [18, 40], climbEvery = [50, 90] }) {
  let idleAt = Date.now() + rand(8, 20) * 1000;
  let nibbleAt = Date.now() + rand(10, 25) * 1000;
  let trickAt = Date.now() + rand(...trickEvery) * 1000;
  let climbAt = Date.now() + rand(6, 14) * 1000;
  let growlAt = Date.now() + rand(8, 16) * 1000;
  let hungryLineAt = 0;
  let frenzySeen = getPet()?.frenzy_at ?? null;
  let screenTurn = true; // Heißhunger fängt mit dem Bildschirm an
  // {befehl} = Chat-Befehl zum Füttern, {streamer} = Name des Kanals
  const fill = (text, pet) => text.replaceAll('{befehl}', pet?.feed_command || DEFAULT_PET.feed_command)
    .replaceAll('{streamer}', streamer?.() || 'Streamer');
  let wobbleAt = 0;
  const timer = setInterval(async () => {
    const pet = getPet();
    // Tierart und Stadium folgen der Datenbank (Wechsel im OBS-Fenster, Schlüpfen per Chat)
    if (pet?.species) dino.setSpecies(pet.species);
    if (pet?.stage && pet.stage !== dino.stage && !dino.busy) {
      if (dino.stage === 'egg' && pet.stage === 'baby') await dino.hatch();
      else if (dino.stage === 'baby' && pet.stage === 'adult') await dino.grow();
      else dino.setStage(pet.stage);
    }
    // Im Ei: kein Hunger, ab und zu ein Wackler
    if (dino.stage === 'egg') {
      dino.setEggProgress((pet?.stage_feeds ?? 0) / Math.max(1, pet?.hatch_feeds ?? 50));
      dino.setHungry(false);
      dino.setStarving(false);
      if (Date.now() > wobbleAt) { wobbleAt = Date.now() + rand(6, 14) * 1000; dino.wobble(); }
      return;
    }
    const hungry = isHungry(pet);
    const starving = isStarving(pet);
    dino.setHungry(hungry);
    dino.setStarving(starving);
    const now = Date.now();
    // Heißhunger per Knopf: sofort an die Karte
    const frenzy = isFrenzy(pet) ? pet.frenzy_at : null;
    if (frenzy && frenzy !== frenzySeen) climbAt = 0;
    frenzySeen = frenzy;
    if (hungry && now > growlAt && !dino.climbing) {
      growlAt = now + rand(18, 32) * 1000;
      dino.rumble();
    }
    if (dino.busy) return;
    if ((cards || screen) && starving && now > climbAt) {
      climbAt = now + rand(...climbEvery) * 1000;
      const hold = () => isStarving(getPet());
      const useScreen = screen && (!screenOnFrenzy || frenzy) && (screenTurn || !cards);
      screenTurn = !screenTurn;
      if (useScreen) {
        if (await dino.eatScreen(screen, { line: fill(frenzy && Math.random() < 0.5 ? 'Wenn ihr nicht füttert, ess ich den Stream!' : screenLine(), pet), hold })) return;
      }
      if (!cards) return;
      const [first, ...rest] = cards();
      const list = [first, ...rest.sort(() => Math.random() - 0.5)].filter(Boolean);
      const line = frenzy ? 'Wenn ihr nicht füttert, ess ich die Karten!' : fill(climbLine(), pet);
      for (const card of list) {
        if (await dino.climb(card, { line, side: card === first ? 'right' : null, hold })) return;
      }
    }
    if (hungry && now > nibbleAt) {
      nibbleAt = now + rand(...nibbleEvery) * 1000;
      const list = await Promise.resolve(names()).catch(() => []);
      await dino.nibble(list.length ? pick(list) : 'Chat');
      return;
    }
    if (hungry && now > hungryLineAt) {
      hungryLineAt = now + rand(25, 45) * 1000;
      dino.say(fill(pick(HUNGRY_LINES), pet));
      return;
    }
    if (now > idleAt) {
      idleAt = now + rand(...idleEvery) * 1000;
      dino.say(fill(pick(petLines(pet)), pet));
      return;
    }
    if (now > trickAt && !dino.sleeping) {
      trickAt = now + rand(...trickEvery) * 1000;
      // Satt und nichts los: ab und zu ein Nickerchen, sonst eine Einlage
      if (!hungry && Math.random() < 0.2) dino.sleep(rand(8, 16) * 1000);
      else dino.trick(hungry ? pick(['roar', 'look', 'turn']) : undefined);
    }
  }, 1000);
  return () => { clearInterval(timer); dino.wake(); };
}
