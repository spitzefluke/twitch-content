const GERMANY_CENTER = { latitude: 51.1657, longitude: 10.4515 };

const WEATHER = new Map([
  [0, ['clear', 'klar']], [1, ['clear', 'überwiegend klar']], [2, ['cloudy', 'leicht bewölkt']], [3, ['cloudy', 'bedeckt']],
  [45, ['fog', 'Nebel']], [48, ['fog', 'Nebel mit Reif']],
  [51, ['drizzle', 'leichter Nieselregen']], [53, ['drizzle', 'Nieselregen']], [55, ['drizzle', 'starker Nieselregen']],
  [61, ['rain', 'leichter Regen']], [63, ['rain', 'Regen']], [65, ['rain', 'starker Regen']],
  [71, ['snow', 'leichter Schneefall']], [73, ['snow', 'Schneefall']], [75, ['snow', 'starker Schneefall']], [77, ['snow', 'Schneegriesel']],
  [80, ['rain', 'Regenschauer']], [81, ['rain', 'Regenschauer']], [82, ['rain', 'starke Regenschauer']],
  [85, ['snow', 'Schneeschauer']], [86, ['snow', 'starke Schneeschauer']],
  [95, ['storm', 'Gewitter']], [96, ['storm', 'Gewitter mit Hagel']], [99, ['storm', 'starkes Gewitter']],
]);

export function daypart(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'day';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export async function getGermanyConditions() {
  const now = new Date();
  const fallback = { kind: 'clear', label: 'Wetterdaten nicht verfügbar', temperature: null, wind: null, daypart: daypart(now), source: 'fallback' };
  try {
    const query = new URLSearchParams({
      latitude: GERMANY_CENTER.latitude,
      longitude: GERMANY_CENTER.longitude,
      current: 'temperature_2m,weather_code,wind_speed_10m',
      timezone: 'Europe/Berlin',
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Weather ${response.status}`);
    const data = await response.json();
    const current = data.current ?? {};
    const [kind, label] = WEATHER.get(Number(current.weather_code)) ?? ['cloudy', 'wechselhaft'];
    return {
      kind,
      label,
      temperature: Number.isFinite(current.temperature_2m) ? Math.round(current.temperature_2m) : null,
      wind: Number.isFinite(current.wind_speed_10m) ? Math.round(current.wind_speed_10m) : null,
      daypart: daypart(now),
      source: 'open-meteo',
    };
  } catch {
    return fallback;
  }
}
