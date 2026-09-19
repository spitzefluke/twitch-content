// Ton fürs Intro: Bahnhofs-Gong und Durchsage.
// Der Gong wird im Browser erzeugt (keine Audiodatei), die Durchsage
// übernimmt die eingebaute Sprachausgabe.
const STORE_KEY = 'zd_sound';

// Vierklang wie eine Bahnhofsansage (a – cis – e – a)
const CHIME = [
  { at: 0.00, hz: 440.00 },
  { at: 0.30, hz: 554.37 },
  { at: 0.60, hz: 659.25 },
  { at: 0.95, hz: 880.00 },
];

export class IntroSound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.spoken = false;
  }

  get wanted() {
    try { return localStorage.getItem(STORE_KEY) !== 'off'; } catch { return true; }
  }
  set wanted(on) {
    try { localStorage.setItem(STORE_KEY, on ? 'on' : 'off'); } catch { /* privater Modus */ }
  }

  // true, wenn Ton jetzt wirklich abgespielt werden darf
  async enable() {
    if (!this.wanted) return false;
    try {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return false;
      if (!this.ctx) {
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.22;
        // kleine Hallfahne, damit es nach Bahnhofshalle klingt
        const delay = this.ctx.createDelay();
        delay.delayTime.value = 0.19;
        const feedback = this.ctx.createGain();
        feedback.gain.value = 0.28;
        const wet = this.ctx.createGain();
        wet.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
        this.master.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        wet.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ctx.state === 'running';
    } catch {
      return false;
    }
  }

  chime() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime + 0.05;
    for (const { at, hz } of CHIME) {
      // Grundton plus leiser Oberton ergibt den glockigen Klang
      for (const [mult, level, decay] of [[1, 1, 2.2], [2.01, 0.28, 1.4], [3.02, 0.1, 0.9]]) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz * mult;
        const start = t0 + at;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(level, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(start);
        osc.stop(start + decay + 0.05);
      }
    }
  }

  // Vorbeifahrender Zug: gefiltertes Rauschen, das an- und abschwillt
  whoosh(duration = 2.6) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime;
    const frames = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * 0.6;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.8;
    band.frequency.setValueAtTime(320, t0);
    band.frequency.linearRampToValueAtTime(1500, t0 + duration * 0.45); // Doppler
    band.frequency.linearRampToValueAtTime(260, t0 + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.5, t0 + duration * 0.45);
    gain.gain.linearRampToValueAtTime(0.0001, t0 + duration);
    src.connect(band);
    band.connect(gain);
    gain.connect(this.master);
    src.start(t0);
    src.stop(t0 + duration);
  }

  speak(text) {
    if (this.spoken || !this.wanted) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    this.spoken = true;
    const say = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE';
      u.rate = 0.95;
      u.pitch = 0.95;
      u.volume = 0.9;
      const de = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith('de'));
      if (de) u.voice = de;
      synth.speak(u);
    };
    // Stimmen sind beim ersten Aufruf oft noch nicht geladen
    if (synth.getVoices().length) say();
    else synth.addEventListener('voiceschanged', say, { once: true });
  }

  stop() {
    try { window.speechSynthesis?.cancel(); } catch { /* egal */ }
    try { this.ctx?.close(); } catch { /* egal */ }
    this.ctx = null;
  }
}
