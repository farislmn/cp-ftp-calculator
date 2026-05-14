import type { Split } from './components/PacingSplitPlan.js';

const BASE_URL = typeof window === 'undefined' ? 'https://intervals.icu' : '';

/**
 * Pushes the pacing split plan to Intervals.icu as a calendar event on the given race date.
 * Each split becomes one interval step with a ±2% power band around its target.
 */
export async function pushPacingPlan(
  athleteId: string,
  apiKey: string,
  raceDate: string,         // YYYY-MM-DD
  distanceMeters: number,
  totalTimeSeconds: number,
  splits: Split[],
  cpWatts: number,
): Promise<void> {
  const headers: Record<string, string> = {
    Authorization: 'Basic ' + btoa('API_KEY:' + apiKey),
    'Content-Type': 'application/json',
  };

  const distKm = (distanceMeters / 1000).toFixed(1);
  const name   = `Race Power Pacing Plan - ${distKm} km - ${raceDate}`;

  const description = splits
    .map((split) => {
      const distKm  = (split.distM / 1000).toFixed(2).replace(/\.?0+$/, '');
      const lowPct  = Math.round((split.powerW * 0.98) / cpWatts * 100);
      const highPct = Math.round((split.powerW * 1.02) / cpWatts * 100);
      return `- ${distKm}km ${lowPct}%-${highPct}% ${split.label}`;
    })
    .join('\n');

  const body = {
    category:         'WORKOUT',
    start_date_local: raceDate + 'T00:00:00',
    name,
    type:             'Run',
    distance:         Math.round(distanceMeters),
    moving_time:      Math.round(totalTimeSeconds),
    description,
  };

  const res = await fetch(`${BASE_URL}/api/v1/athlete/${athleteId}/events`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Intervals.icu ${res.status}${text ? ': ' + text : ''}`);
  }
}
