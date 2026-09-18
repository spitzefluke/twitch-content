// ------------------------------------------------------------
// Konfiguration
// ------------------------------------------------------------
// Solange SUPABASE_URL leer ist, läuft die Seite im Demo-Modus:
// Accounts, Kacheln und Drehungen werden nur im Browser gespeichert,
// Twitch ist deaktiviert.
//
// Beide Werte findest du im Supabase-Dashboard unter
// Project Settings → API. Der "anon"/"publishable" Key ist öffentlich
// und darf im Repo stehen – den "service_role"/"secret" Key NIEMALS hier eintragen.
export const CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  // Twitch-Kanal, der sich verbinden darf (muss zu BROADCASTER_LOGIN im Backend passen)
  CHANNEL: 'zugfahrer_davetv',

  // Länge des Intros in Sekunden
  INTRO_SECONDS: 10,
};
