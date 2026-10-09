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

  // Optional: Twitch-Name des Streamers, solange noch kein Kanal verbunden ist.
  // Leer lassen – sobald der Streamer Twitch verbindet, kommt der Name aus der Datenbank.
  CHANNEL: '',

  // Optional: Bot-Schutz beim Anmelden und Registrieren (Cloudflare Turnstile).
  // Den öffentlichen „Site Key“ hier eintragen, den geheimen „Secret Key“ NUR in Supabase unter
  // Authentication → Attack Protection → Captcha (Anbieter Turnstile). Leer = aus.
  // Erst beides eintragen, dann in Supabase einschalten – sonst klappt das Anmelden nicht.
  TURNSTILE_SITE_KEY: '',
};
