// Vorlesen mit der Sprachausgabe des Browsers (Web Speech API) – ohne Schlüssel, ohne Server.
// In OBS geht der Ton an das Standard-Audiogerät von Windows (wird mit „Desktop-Audio“ aufgenommen).
export const TTS_VOICES = [
  { id: 'normal', name: 'Normal', pitch: 1, rate: 1 },
  { id: 'roboter', name: 'Roboter', pitch: 0.1, rate: 0.85 },
  { id: 'oma', name: 'Oma', pitch: 1.7, rate: 0.75 },
  { id: 'monster', name: 'Monster', pitch: 0.05, rate: 0.7 },
  { id: 'schnell', name: 'Schnell', pitch: 1.2, rate: 1.8 },
  { id: 'fluester', name: 'Flüstern', pitch: 0.8, rate: 0.9, volume: 0.45 },
];

export const ttsAvailable = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

// Deutsche Stimme bevorzugen (die Liste kommt bei manchen Browsern erst nach einem Moment)
function germanVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => /^de(-|_|$)/i.test(v.lang) && /google|microsoft/i.test(v.name))
    ?? voices.find((v) => /^de(-|_|$)/i.test(v.lang)) ?? null;
}

// Vorlesen; das Promise ist fertig, wenn der Text zu Ende ist (oder abgebrochen wurde).
// Hängt die Sprachausgabe, ist nach spätestens 60 Sekunden Schluss.
export function speak(text, voiceId = 'normal', { volume = 1 } = {}) {
  if (!ttsAvailable() || !text) return Promise.resolve(false);
  const preset = TTS_VOICES.find((v) => v.id === voiceId) ?? TTS_VOICES[0];
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    const voice = germanVoice();
    if (voice) u.voice = voice;
    u.pitch = preset.pitch;
    u.rate = preset.rate;
    u.volume = Math.max(0, Math.min(1, volume * (preset.volume ?? 1)));
    let done = false;
    const finish = (ok) => { if (!done) { done = true; clearTimeout(guard); resolve(ok); } };
    const guard = setTimeout(() => { speechSynthesis.cancel(); finish(false); }, 60000);
    u.onend = () => finish(true);
    u.onerror = () => finish(false);
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (ttsAvailable()) speechSynthesis.cancel();
}
