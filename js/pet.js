// Daves Dino: ein kleines Tamagotchi, das im OBS-Overlay (und in der Vorschau
// auf der Webseite) hin und her läuft, freche Sprüche sagt und an den
// Zuschauern knabbert, wenn es Hunger hat. Aussehen in css/pet.css.

export const DEFAULT_PET = {
  name: 'Rexi',
  hungry_after: 45,
  last_fed_at: null,
  last_fed_by: '',
  fed_count: 0,
  feed_command: '!füttern',
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
export const isHungry = (pet, now) => hungerOf(pet, now) >= 1;

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

// Die Zeichnung, seitlich, schaut nach rechts. Teile mit Klassen bewegen sich per CSS.
export function dinoSvg() {
  return `<svg class="dino-svg" viewBox="0 0 140 110" aria-hidden="true">
    <g class="dino-tail"><path d="M44 60 C24 62 10 54 3 36 C14 48 28 50 46 48 Z" fill="#4fb35f" stroke="#2c6e39" stroke-width="2.5" stroke-linejoin="round"/></g>
    <g class="dino-leg dino-leg-a"><path d="M50 74 h12 v20 c0 3 -2 5 -5 5 h-9 c-3 0 -3 -4 0 -5 l2 -1 z" fill="#46a356" stroke="#2c6e39" stroke-width="2.5" stroke-linejoin="round"/></g>
    <path d="M36 60 C36 40 58 32 78 38 L92 46 C96 64 88 84 64 84 C46 84 36 76 36 60 Z" fill="#5cc36b" stroke="#2c6e39" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M52 72 C56 80 72 82 82 74 C86 66 84 58 78 56 C66 60 56 62 52 72 Z" fill="#c9f0a8"/>
    <path d="M44 42 l4 -8 4 7 M54 37 l5 -8 4 7 M66 35 l5 -8 3 8" fill="#3f9a4f" stroke="#2c6e39" stroke-width="2" stroke-linejoin="round"/>
    <g class="dino-leg dino-leg-b"><path d="M66 74 h12 v20 c0 3 -2 5 -5 5 h-9 c-3 0 -3 -4 0 -5 l2 -1 z" fill="#5cc36b" stroke="#2c6e39" stroke-width="2.5" stroke-linejoin="round"/></g>
    <g class="dino-arm"><path d="M84 60 q8 2 9 8 q-4 1 -6 -2 q-2 3 -5 1 z" fill="#5cc36b" stroke="#2c6e39" stroke-width="2" stroke-linejoin="round"/></g>
    <g class="dino-head">
      <g class="dino-jaw"><path d="M84 44 C96 50 116 52 128 46 C128 54 118 60 102 58 C92 57 86 52 84 44 Z" fill="#4fb35f" stroke="#2c6e39" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M100 55 C106 58 116 56 122 52" fill="none" stroke="#e8667a" stroke-width="3" stroke-linecap="round"/></g>
      <path d="M78 36 C80 16 102 8 120 16 C132 22 136 36 130 44 C118 50 96 50 84 46 C80 44 78 40 78 36 Z" fill="#5cc36b" stroke="#2c6e39" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M100 46 l3 4 3 -4 M110 46 l3 4 3 -4 M120 45 l2 4 3 -4" fill="#fff" stroke="#2c6e39" stroke-width="1.2" stroke-linejoin="round"/>
      <ellipse cx="112" cy="36" rx="6" ry="3.5" fill="#ff8fa3" opacity=".55"/>
      <circle cx="127" cy="26" r="1.8" fill="#2c6e39"/>
      <g class="dino-eye"><circle cx="102" cy="25" r="7" fill="#fff" stroke="#2c6e39" stroke-width="2"/><circle class="dino-pupil" cx="104" cy="25" r="3.4" fill="#1d2b1f"/><circle cx="105.5" cy="23.5" r="1.1" fill="#fff"/></g>
      <path class="dino-brow" d="M94 15 L109 19" stroke="#2c6e39" stroke-width="3" stroke-linecap="round"/>
    </g>
  </svg>`;
}

// Kleine Töne über die Sfx-Klasse aus prank-fx.js (tone/noise)
function chompSound(sfx) {
  sfx?.noise({ type: 'bandpass', freq: 900, q: 1.5, release: 0.06, peak: 0.35 });
  sfx?.tone(160, { to: 90, release: 0.08, peak: 0.25 });
}
function growlSound(sfx) {
  sfx?.tone(90, { type: 'sawtooth', attack: 0.08, hold: 0.5, release: 0.3, peak: 0.08, vibrato: { rate: 18, depth: 12 }, filter: { type: 'lowpass', freq: 500 } });
}
function roarSound(sfx) {
  sfx?.tone(120, { type: 'sawtooth', to: 70, attack: 0.05, hold: 0.35, release: 0.5, peak: 0.12, vibrato: { rate: 24, depth: 18 }, filter: { type: 'lowpass', freq: 900 } });
  sfx?.noise({ freq: 700, to: 250, attack: 0.05, hold: 0.3, release: 0.4, peak: 0.12 });
}
function hopSound(sfx) { sfx?.tone(420, { to: 760, release: 0.12, peak: 0.08 }); }
function happySound(sfx) {
  sfx?.tone(660, { to: 990, release: 0.18, peak: 0.12 });
  sfx?.tone(990, { at: 0.12, to: 1320, release: 0.22, peak: 0.1 });
}

// Der Dino in einem Behälter (position: relative/fixed). Läuft allein hin und her.
export class Dino {
  constructor(container, { size = 150, sfx = null, name = 'Rexi', reducedMotion = false } = {}) {
    this.container = container;
    this.size = size;
    this.sfx = sfx;
    this.reducedMotion = reducedMotion;
    this.el = document.createElement('div');
    this.el.className = 'dino';
    this.el.style.setProperty('--ds', `${size}px`);
    this.el.innerHTML = `<div class="dino-bubble" hidden></div><div class="dino-body">${dinoSvg()}</div><span class="dino-tag"></span>`;
    this.bubble = this.el.querySelector('.dino-bubble');
    this.body = this.el.querySelector('.dino-body');
    this.tag = this.el.querySelector('.dino-tag');
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

  destroy() {
    this.wake();
    cancelAnimationFrame(this.raf);
    clearInterval(this.blinkTimer);
    this.el.remove();
  }

  blink() {
    this.el.classList.add('is-blink');
    setTimeout(() => this.el.classList.remove('is-blink'), 160);
  }

  face(dir) {
    this.dir = dir;
    this.body.classList.toggle('is-left', dir < 0);
  }

  step(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const max = Math.max(0, this.width() - this.size);
    let walking = false;
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
        this.face(Math.sign(dx));
        this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
        walking = true;
      }
    }
    this.x = Math.min(max, Math.max(0, this.x));
    this.el.classList.toggle('is-walking', walking);
    // Kleine Staubwölkchen an den Füßen
    if (walking && !this.reducedMotion && t - (this.dustAt ?? 0) > 380) {
      this.dustAt = t;
      this.dust();
    }
    this.el.style.transform = `translateX(${this.x}px)`;
    // Sprechblase bleibt im Bild, auch wenn der Dino am Rand steht
    if (this.speaking) {
      const bw = this.bubble.offsetWidth;
      const left = this.x + this.size / 2 - bw / 2;
      const W = this.width();
      let shift = 0;
      if (left < 6) shift = 6 - left;
      else if (left + bw > W - 6) shift = W - 6 - (left + bw);
      this.bubble.style.setProperty('--bx', `${Math.round(shift)}px`);
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  dust() {
    const d = document.createElement('span');
    d.className = 'dino-dust';
    d.style.setProperty('--ds', `${this.size}px`);
    d.style.left = `${this.x + this.size * (this.dir > 0 ? 0.3 : 0.7)}px`;
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
          hopSound(this.sfx);
          this.el.classList.add('is-hop');
          await wait(520);
          this.el.classList.remove('is-hop');
          await wait(80);
        }
      } else if (kind === 'roar') {
        roarSound(this.sfx);
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

  // Nickerchen: Augen zu, Zzz steigen auf. wake() oder jede Aktion weckt ihn.
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
    this.sleepTimer = setTimeout(() => this.wake(), ms);
  }

  wake() {
    if (!this.sleeping) return;
    this.sleeping = false;
    clearInterval(this.zzz);
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
      chompSound(this.sfx);
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
      growlSound(this.sfx);
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

  // Futter fällt vom Himmel, der Dino schnappt es
  async eat(who) {
    this.wake();
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
      happySound(this.sfx);
      this.say(feedLine(who), 4200);
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
    happySound(this.sfx);
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

// Der Kopf der Sache: plant Sprüche, Einlagen, Nickerchen, Hunger und Knabbern.
// getPet() liefert jeweils den aktuellen Stand, names() mögliche Opfer.
export function runDino(dino, { getPet, names, idleEvery = [45, 90], nibbleEvery = [40, 75], trickEvery = [18, 40] }) {
  let idleAt = Date.now() + rand(8, 20) * 1000;
  let nibbleAt = Date.now() + rand(10, 25) * 1000;
  let trickAt = Date.now() + rand(...trickEvery) * 1000;
  let hungryLineAt = 0;
  const fill = (text, pet) => text.replaceAll('{befehl}', pet?.feed_command || DEFAULT_PET.feed_command);
  const timer = setInterval(async () => {
    const pet = getPet();
    const hungry = isHungry(pet);
    dino.setHungry(hungry);
    const now = Date.now();
    if (dino.busy) return;
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
