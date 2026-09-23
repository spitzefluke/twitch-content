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
    this.ambient = [];
    this.weather = { kind: 'clear', daypart: 'night' };
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
      this.startAmbience();
      return this.ctx.state === 'running';
    } catch {
      return false;
    }
  }

  setWeatherProfile(profile = {}) {
    this.weather = { ...this.weather, ...profile };
    if (this.ctx?.state === 'running') this.startAmbience();
  }

  startAmbience() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.stopAmbience();
    const ctx = this.ctx;
    const profile = this.weather;
    const weatherGain = profile.kind === 'storm' ? 0.12 : profile.kind === 'rain' || profile.kind === 'drizzle' ? 0.075 : profile.kind === 'snow' ? 0.018 : 0;
    const windGain = profile.kind === 'storm' ? 0.075 : profile.kind === 'fog' ? 0.038 : 0.026;
    const makeNoise = (seconds = 2) => {
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      return buffer;
    };
    const loop = (filterType, frequency, q, gainValue, buffer) => {
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      source.buffer = buffer; source.loop = true;
      filter.type = filterType; filter.frequency.value = frequency; filter.Q.value = q;
      gain.gain.value = gainValue;
      source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start();
      this.ambient.push(source);
    };
    loop('lowpass', 420, .5, windGain, makeNoise(3.2));
    loop('lowpass', 145, .7, .028, makeNoise(2.1));
    if (weatherGain) loop('highpass', profile.kind === 'snow' ? 1800 : 1200, .35, weatherGain, makeNoise(1.3));
  }

  stopAmbience() {
    for (const source of this.ambient) { try { source.stop(); } catch { /* bereits gestoppt */ } }
    this.ambient = [];
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

  railRattle(duration = 8, intensity = 0.18) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (i % 700 < 40 ? 1 : .22);
    source.buffer = buffer;
    filter.type = 'bandpass'; filter.frequency.value = 720; filter.Q.value = 1.1;
    gain.gain.setValueAtTime(.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(intensity, ctx.currentTime + .8);
    gain.gain.linearRampToValueAtTime(.0001, ctx.currentTime + duration);
    lfo.type = 'sine'; lfo.frequency.value = 5.7; lfoGain.gain.value = intensity * .42;
    source.connect(filter); filter.connect(gain); gain.connect(this.master);
    lfo.connect(lfoGain); lfoGain.connect(gain.gain);
    source.start(); lfo.start(); source.stop(ctx.currentTime + duration); lfo.stop(ctx.currentTime + duration);
  }

  tunnelRush(duration = 3.2) {
    this.whoosh(duration);
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(58, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(34, ctx.currentTime + duration);
    gain.gain.setValueAtTime(.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(.12, ctx.currentTime + .4);
    gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(); osc.stop(ctx.currentTime + duration + .05);
  }

  secretWhistle() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime + .04;
    [0, .22].forEach((offset, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(index ? 1046 : 784, now + offset);
      osc.frequency.exponentialRampToValueAtTime(index ? 880 : 659, now + offset + .32);
      gain.gain.setValueAtTime(.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(.34, now + offset + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, now + offset + .42);
      osc.connect(gain); gain.connect(this.master);
      osc.start(now + offset); osc.stop(now + offset + .48);
    });
  }

  speak(text) {
    if (this.spoken || !this.wanted) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    this.spoken = true;
    const say = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE';
      u.rate = 0.88;
      u.pitch = 0.9;
      u.volume = 0.86;
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
    this.stopAmbience();
    try { this.ctx?.close(); } catch { /* egal */ }
    this.ctx = null;
  }
}
