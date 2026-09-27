// Daves Dino: ein kleines Tamagotchi, das im OBS-Overlay (und in der Vorschau
// auf der Webseite) hin und her läuft, freche Sprüche sagt und an den
// Zuschauern knabbert, wenn es Hunger hat. Bei Hunger wird er rot. Bei Heißhunger
// (doppelte Hungerzeit oder per Knopf, pet.frenzy_at) wächst er, klettert im
// Overlay an Karten hoch und frisst Stücke aus dem Rand – nach dem Füttern wächst
// der Rand wieder zu. Kostüme wechseln Zuschauer mit !change. Aussehen in
// css/pet.css, Sounds in js/rexi-sfx.js.
import { rexiSound } from './rexi-sfx.js';

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
  phrases: [
    'Du Flitzpiepe!',
    'Der Rentner ist älter als mein Dino!',
    'Wer hat hier die Weiche falsch gestellt?',
    'Rawr! Das heißt „Hallo“.',
    'Ich bin 65 Millionen Jahre alt und DU spielst so?',
    'Nächster Halt: Niederlage.',
    'Bitte zurückbleiben, der Dino fährt ein!',
    'Chat, habt ihr Snacks dabei?',
    'Ich bin nicht dick, ich bin prähistorisch.',
    'Dave, du alte Pflaume!',
    'Zug hat Verspätung. Wie immer.',
    'Kurze Arme, große Klappe.',
    'Ich hab mehr Zähne als Dave Kills.',
    'Mein Opa war ein T-Rex. Und deiner?',
    'Ich bin kein Dino, ich bin ein Lebensgefühl.',
    'Dave, das war ein Kunstschuss. Also Kunst. Kein Schuss.',
    'Pssst … ich glaube, Dave hat Lag im Kopf.',
    'Einmal Victory Royale zum Mitnehmen, bitte.',
    'Meine Lieblingswaffe? Meine Zähne.',
    'Achtung an Gleis 3: Der Dino-Express fährt ein!',
    'Ich esse keine Zuschauer. Nur ein bisschen.',
    'Da war ein Busch. Der Busch war Dave.',
    'Ich hab Angst vor Meteoriten. Frag nicht, warum.',
    'Emote-Spam macht auch nicht satt.',
    'Der Zug ist abgefahren. Ich sitz drin.',
    'Ich wurde ausgebrütet, um zu nerven.',
    'Wort des Tages: Flitzpiepe.',
    'Wenn Dave gewinnt, ess ich einen Busch.',
    'Ich brauch keinen Baumodus, ich bin schon gebaut.',
    'Nächster Halt: Snackautomat.',
    'Pausenbrot? Wo? WO?!',
    'Ich hab Dave ins Knie gebissen. Aus Liebe.',
    'Rawr heißt übersetzt: Gib Snacks.',
    'Ich war Mitarbeiter des Monats. Im Jura.',
    'Wer hat mein Ei geklaut?!',
    'Ich bin nicht faul, ich spare Energie für die Evolution.',
    'Heute schon gestretcht? Ich komm nicht an meine Zehen.',
    'Dave spielt wie ein Fahrplan: niemand versteht ihn.',
    'Klatscht mal alle! … Ich kann nicht, kurze Arme.',
    'Ich hätte gern einen Fensterplatz im Battle Bus.',
    'Ist das hier der Ruhewagen? Nein? Gut. RAWR!',
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
  'Mein Magen knurrt lauter als ein Güterzug.',
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
  'Die Karte schmeckt nach Fahrplan.',
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
export const nibbleLine = () => pick(NIBBLE_LINES);
export const climbLine = () => pick(CLIMB_LINES);

// Die Zeichnung (Rexi aus „OBS Overlay v2“ in Claude Design): seitlich, schaut nach rechts.
// Drei Kostüme (data-costume): Schaffner (Mütze + Pfeife), Lokführer (Streifenmütze +
// Halstuch), Gleisbauer (Helm + Warnweste). Farben kommen aus CSS-Variablen (--dn-…),
// damit er bei Hunger rot wird (css/pet.css). Teile mit Klassen bewegen sich per CSS,
// Drehpunkte in SVG-Einheiten (viewBox 170 × 140). IDs sind pro Dino eindeutig –
// sonst zeigen alle Dinos auf den Verlauf des ersten.
export const COSTUMES = [
  { id: 'schaffner', name: 'Schaffner', sound: 'whistle' },
  { id: 'lok', name: 'Lokführer', sound: 'roar' },
  { id: 'bau', name: 'Gleisbauer', sound: 'step' },
];
export const costumeName = (id) => COSTUMES.find((c) => c.id === id)?.name ?? COSTUMES[0].name;
let svgCount = 0;
export function dinoSvg(costume = 'schaffner') {
  const id = `dn${++svgCount}${Math.random().toString(36).slice(2, 6)}`;
  const skin = `url(#${id}-skin)`;
  const body = 'M44 80 C42 58 62 44 88 48 C102 50 110 60 111 72 C112 92 100 106 78 106 C58 106 46 96 44 80 Z';
  return `<svg class="dino-svg" viewBox="0 0 170 140" aria-hidden="true" data-costume="${COSTUMES.some((c) => c.id === costume) ? costume : 'schaffner'}">
    <defs>
      <clipPath id="${id}-body"><path d="${body}"/></clipPath>
      <pattern id="${id}-stripe" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#2d4f86"/><rect width="1.6" height="4" fill="#dfe8f5"/></pattern>
      <linearGradient id="${id}-skin" x1="0" y1="0" x2="0" y2="1"><stop class="dn-s1" offset="0"/><stop class="dn-s2" offset=".6"/><stop class="dn-s3" offset="1"/></linearGradient>
      <linearGradient id="${id}-cap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3e6b"/><stop offset="1" stop-color="#16223f"/></linearGradient>
    </defs>
    <ellipse class="dino-shadow" cx="82" cy="122" rx="36" ry="5" fill="#000"/>
    <g class="dino-bodyg">
      <g class="dino-tail">
        <path class="dn-ln" d="M50 78 C30 80 12 72 3 52 C18 66 34 68 52 64 Z" fill="${skin}" stroke-width="2.5" stroke-linejoin="round"/>
        <path class="dn-ln dn-f-s3" d="M22 66 l-3 -7 6 3 M34 70 l-2 -7 6 4" stroke-width="1.6" stroke-linejoin="round"/>
      </g>
      <g class="dino-leg dino-leg-b"><path class="dn-ln dn-f-lb" d="M62 94 h14 v19 c0 2 2 3 4 3 h4 c3 0 3 5 0 5 h-18 c-3 0 -4 -2 -4 -4 z" stroke-width="2.5" stroke-linejoin="round"/></g>
      <path class="dn-ln" d="${body}" fill="${skin}" stroke-width="2.5" stroke-linejoin="round"/>
      <path class="dn-f-bl" d="M60 96 C66 106 88 107 100 96 C106 88 106 78 102 72 C88 78 70 82 60 96 Z"/>
      <path class="dn-st-bs" d="M66 98 q16 5 32 -4 M72 90 q13 2 27 -7 M82 82 q8 0 17 -6" fill="none" stroke-width="1.4" stroke-linecap="round"/>
      <path class="dn-ln dn-f-s3" d="M54 54 l3 -9 5 7 M65 48 l4 -10 5 8 M78 46 l5 -9 4 9 M90 48 l5 -8 3 8" stroke-width="2" stroke-linejoin="round"/>
      <circle class="dn-f-sp" cx="60" cy="66" r="2.2"/><circle class="dn-f-sp" cx="70" cy="59" r="2"/>
      <circle class="dn-f-sp" cx="74" cy="69" r="1.8"/><circle class="dn-f-sp" cx="55" cy="78" r="1.8"/>
      <path d="M58 60 C66 52 80 49 92 51" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>
      <g class="dino-leg dino-leg-a">
        <path class="dn-ln dn-f-lf" d="M80 94 h14 v19 c0 2 2 3 4 3 h4 c3 0 3 5 0 5 h-18 c-3 0 -4 -2 -4 -4 z" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M101 116 v5 M97 116 v5" stroke="#e9f7df" stroke-width="1.4" stroke-linecap="round"/>
      </g>
      <g class="dino-arm"><path class="dn-ln dn-f-lf" d="M103 74 q10 2 11 10 q-4 1 -6 -2 q-2 3 -6 1 z" stroke-width="2" stroke-linejoin="round"/></g>
      <g class="dn-c dn-c-bau dn-vest" clip-path="url(#${id}-body)">
        <path d="M40 58 H116 V110 H40 Z" fill="#ff7a1a" opacity=".96"/>
        <path d="M40 74 H116 M40 90 H116" stroke="#e6ecf2" stroke-width="4"/>
        <path d="M40 74 H116 M40 90 H116" stroke="#9aa6b4" stroke-width="1" stroke-dasharray="2 3"/>
        <path d="M84 50 V108" stroke="#b34c05" stroke-width="1.6"/>
      </g>
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
      <g class="dino-head">
        <g class="dino-jaw">
          <path class="dn-ln dn-f-jw" d="M102 56 C114 62 136 64 150 58 C150 66 140 72 122 70 C110 69 104 64 102 56 Z" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M120 67 C126 70 136 68 142 64" fill="none" stroke="#e8667a" stroke-width="3" stroke-linecap="round"/>
        </g>
        <path class="dn-ln" d="M96 50 C98 28 120 16 140 22 C154 27 160 42 154 54 C142 60 116 61 102 58 C98 57 96 54 96 50 Z" fill="${skin}" stroke-width="2.5" stroke-linejoin="round"/>
        <path class="dn-ln" d="M118 58 l3 4 3 -4 M128 58 l3 4 3 -4 M138 57 l2 4 3 -4" fill="#fff" stroke-width="1.2" stroke-linejoin="round"/>
        <ellipse cx="133" cy="47" rx="6" ry="3.5" fill="#ff8fa3" opacity=".55"/>
        <circle class="dn-f-ln" cx="151" cy="37" r="1.8"/>
        <g class="dino-eye">
          <circle class="dn-ln" cx="120" cy="38" r="7.5" fill="#fff" stroke-width="2"/>
          <g class="dino-pupil"><circle cx="122" cy="38" r="3.6" fill="#1d2b1f"/><circle cx="123.5" cy="36.5" r="1.1" fill="#fff"/></g>
        </g>
        <path class="dino-brow dn-ln" d="M111 29 L128 33.5" stroke-width="3" stroke-linecap="round"/>
        <g class="dino-cap">
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
        </g>
      </g>
    </g>
  </svg>`;
}

// Bissen beim Kartenfressen (aus Claude Design): [x %, y %, Radius px bei 400 px Kartenbreite].
// Er beginnt an der Kante in halber Höhe und frisst sich zur oberen Ecke vor.
// Am rechten Rand gespiegelt (x = 100 − x) und etwas größer.
const BITES = [[0, 62, 26], [0, 46, 20], [6, 30, 22], [0, 80, 24], [14, 14, 26], [4, 96, 22], [24, 2, 24], [10, 62, 20], [38, 0, 22]];
const BITE_EVERY = 650;
const CLIMB_MAX = 100_000; // so lange frisst er höchstens am Stück, dann klettert er runter

// Der Dino in einem Behälter (position: relative/fixed). Läuft allein hin und her.
export class Dino {
  constructor(container, { size = 150, sfx = null, name = 'Rexi', costume = 'schaffner', reducedMotion = false } = {}) {
    this.container = container;
    this.size = size;
    this.sfx = sfx;
    this.reducedMotion = reducedMotion;
    this.el = document.createElement('div');
    this.el.className = 'dino';
    this.el.style.setProperty('--ds', `${size}px`);
    this.el.innerHTML = `<div class="dino-chat" hidden></div><div class="dino-bubble" hidden></div><div class="dino-pose"><div class="dino-grow"><div class="dino-body">${dinoSvg(costume)}</div></div></div><span class="dino-tag"><i></i><b></b></span>`;
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
  setName(name) { this.tag.textContent = name; }
  setHungry(on) { this.el.classList.toggle('is-hungry', on); }
  sound(id, big) { rexiSound(this.sfx, id, big); }

  // Heißhunger: Rexi wächst (1,3 ×) und brüllt einmal laut, wenn es losgeht
  setStarving(on) {
    on = !!on;
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
      const speed = this.size * 0.9;
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
    if (this.goal || (!this.busy && !this.sleeping && t > this.pauseUntil)) {
      if (this.goal) this.target = Math.min(max, Math.max(0, this.goal.x));
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
        this.say(pick(['RAWR!', 'RAAAWR!!', 'ROOOAAR!']), 1800);
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
    if (this.busy || this.sleeping) return;
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

  walkTo(x) {
    return new Promise((resolve) => {
      this.goal?.resolve();
      this.goal = { x, resolve };
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
    if (this.busy || !card) return false;
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
  }

  // Sprechblase; mehrere Sätze kommen nacheinander
  say(text, ms = 4200) {
    if (!text) return;
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
    if (this.busy) return;
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
// die erste (die Karte „Als Nächstes“) bevorzugt er, von rechts.
export function runDino(dino, { getPet, names, cards = null, idleEvery = [45, 90], nibbleEvery = [40, 75], trickEvery = [18, 40], climbEvery = [50, 90] }) {
  let idleAt = Date.now() + rand(8, 20) * 1000;
  let nibbleAt = Date.now() + rand(10, 25) * 1000;
  let trickAt = Date.now() + rand(...trickEvery) * 1000;
  let climbAt = Date.now() + rand(6, 14) * 1000;
  let growlAt = Date.now() + rand(8, 16) * 1000;
  let hungryLineAt = 0;
  let frenzySeen = getPet()?.frenzy_at ?? null;
  const fill = (text, pet) => text.replaceAll('{befehl}', pet?.feed_command || DEFAULT_PET.feed_command);
  const timer = setInterval(async () => {
    const pet = getPet();
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
    if (cards && starving && now > climbAt) {
      climbAt = now + rand(...climbEvery) * 1000;
      const [first, ...rest] = cards();
      const list = [first, ...rest.sort(() => Math.random() - 0.5)].filter(Boolean);
      const line = frenzy ? 'Wenn ihr nicht füttert, ess ich die Karten!' : fill(climbLine(), pet);
      for (const card of list) {
        if (await dino.climb(card, { line, side: card === first ? 'right' : null, hold: () => isStarving(getPet()) })) return;
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
      const lines = pet?.phrases?.length ? pet.phrases : DEFAULT_PET.phrases;
      dino.say(fill(pick(lines), pet));
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
