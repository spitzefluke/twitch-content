// Fehlertext für Antworten an den Browser: nur die Meldung eines Error-Objekts, nie das Objekt
// selbst oder seinen Stacktrace (der verrät Dateipfade und Aufbau). Alles andere wird zu einem
// allgemeinen Text – die Einzelheiten stehen per console.* in den Logs der Edge Function.
export function errorText(e: unknown, max = 200): string {
  const message = e instanceof Error && typeof e.message === "string" ? e.message : "";
  return (message || "Unbekannter Fehler").slice(0, max);
}
