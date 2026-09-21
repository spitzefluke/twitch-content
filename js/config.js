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
  SUPABASE_URL: 'https://ssibsphuttjlphijilsc.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzaWJzcGh1dHRqbHBoaWppbHNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4NDIyODYsImV4cCI6MjEwNTQxODI4Nn0.VGJXuEtG5hXyxGCVLagzDYciDx18EkNk_i--rCX-P3c',

  // Twitch-Kanal, der sich verbinden darf (muss zu BROADCASTER_LOGIN im Backend passen)
  CHANNEL: 'zugfahrer_davetv',

  // Länge des Intros in Sekunden (der ganze Ablauf richtet sich danach)
  INTRO_SECONDS: 20,
};
