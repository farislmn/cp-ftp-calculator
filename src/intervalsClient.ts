// In a browser (Vite dev server) we route through the /api proxy to avoid CORS.
// In Node.js (CLI scripts) we call the real host directly.
const BASE_URL = typeof window !== 'undefined' ? '' : 'https://intervals.icu';

/**
 * Standard durations we compute MMP for (seconds).
 * Spread across the 120–1800 s window to give the CP regression good leverage.
 */
const CP_SAMPLE_DURATIONS = [
  120, 180, 240, 300, 360, 480, 600, 720, 900, 1080, 1200, 1500, 1800,
] as const;

/**
 * Activities within this many days are "primary" CP data.
 * Older activities feed the confidence / error-margin layer.
 */
const RECENT_THRESHOLD_DAYS = 42; // 6 weeks

/**
 * Maximum number of activities to fetch streams for.
 * Caps the number of secondary HTTP calls (one per activity).
 */
const MAX_ACTIVITIES = 20;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface MaxEffort {
  durationSeconds: number;
  averagePower: number;
  /** ISO date string (YYYY-MM-DD) of the source activity. */
  date: string;
  /** Intervals.icu activity ID. */
  activityId: string;
  /**
   * true  → within the last 6 weeks; used to calculate the primary CP.
   * false → older than 6 weeks; used to estimate the confidence margin.
   */
  isRecent: boolean;
}

export type FetchMaxEffortsResult =
  | { efforts: MaxEffort[] }
  | { error: string };

// ─── Internal shapes ──────────────────────────────────────────────────────────

interface IntervalsActivity {
  id: string | number;
  start_date_local: string;
  type: string;
  icu_ftp?: number | null;
  moving_time?: number;
}

interface PowerStream {
  type: string;
  data: number[];
}

// ─── MMP computation ──────────────────────────────────────────────────────────

/**
 * Returns the best (maximal mean) power for a given duration from a
 * per-second watts array using an O(n) sliding window.
 * Returns null when the stream is shorter than the requested duration.
 */
function computeMMP(watts: number[], durationSeconds: number): number | null {
  if (watts.length < durationSeconds) return null;

  let windowSum = 0;
  for (let i = 0; i < durationSeconds; i++) windowSum += watts[i]!;

  let maxSum = windowSum;
  for (let i = durationSeconds; i < watts.length; i++) {
    windowSum += watts[i]! - watts[i - durationSeconds]!;
    if (windowSum > maxSum) maxSum = windowSum;
  }

  const mmp = Math.round(maxSum / durationSeconds);
  return mmp > 0 ? mmp : null;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Fetches running max efforts from Intervals.icu and maps them to the
 * Lab Engine schema, covering the CP-valid window of 120–1800 seconds.
 *
 * Strategy:
 * 1. Fetch the activity list and filter for power-running activities.
 * 2. For each of the most recent MAX_ACTIVITIES runs, download the raw per-second
 *    watts stream and compute the Maximal Mean Power (MMP) at each sample duration.
 * 3. For each (duration, recency-tier) pair, keep the single best effort, so the
 *    caller can use recent data for primary CP regression and older data for
 *    confidence bounding.
 *
 * @param athleteId  Intervals.icu athlete ID (e.g. 'i123456' from your profile URL).
 * @param apiKey     Intervals.icu API key (Settings → API access).
 * @param daysBack   How far back to search (default 90 days).
 */
export async function fetchMaxEfforts(
  athleteId: string,
  apiKey: string,
  daysBack = 90,
): Promise<FetchMaxEffortsResult> {
  // ── Date range ────────────────────────────────────────────────────────────
  const newest = new Date();
  const oldest = new Date(newest);
  oldest.setDate(oldest.getDate() - daysBack);
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

  // ── Authentication ────────────────────────────────────────────────────────
  // Intervals.icu Basic Auth: username = literal "API_KEY", password = apiKey
  // btoa is available in both modern browsers and Node.js ≥ 16.
  const auth = `Basic ${btoa(`API_KEY:${apiKey}`)}`;
  const headers = { Authorization: auth, Accept: 'application/json' };

  // ── Fetch activity list ───────────────────────────────────────────────────
  const listUrl =
    `${BASE_URL}/api/v1/athlete/${athleteId}/activities` +
    `?oldest=${fmtDate(oldest)}&newest=${fmtDate(newest)}`;

  let activities: IntervalsActivity[];
  try {
    const res = await fetch(listUrl, { headers });
    if (res.status === 401 || res.status === 403) {
      return { error: 'Authentication failed. Please check your API Key and Athlete ID.' };
    }
    if (!res.ok) {
      return { error: `Intervals.icu API error: HTTP ${res.status} ${res.statusText}.` };
    }
    activities = (await res.json()) as IntervalsActivity[];
  } catch (err) {
    return { error: `Network error: ${(err as Error).message}` };
  }

  // ── Filter: running activities with power (icu_ftp present and > 0) ───────
  // Note: has_power is not reliably populated in the list response; icu_ftp > 0
  // is the reliable indicator that Intervals.icu has processed power for this run.
  const powerRuns = activities.filter(
    (a) =>
      (a.type === 'Run' || a.type === 'VirtualRun') &&
      typeof a.icu_ftp === 'number' &&
      a.icu_ftp > 0,
  );

  if (powerRuns.length === 0) {
    return { error: `No running power data found in the last ${daysBack} days.` };
  }

  // ── Sort by recency, cap at MAX_ACTIVITIES ────────────────────────────────
  const recentCutoff = new Date();
  recentCutoff.setDate(recentCutoff.getDate() - RECENT_THRESHOLD_DAYS);

  const candidates = powerRuns
    .sort(
      (a, b) =>
        new Date(b.start_date_local).getTime() -
        new Date(a.start_date_local).getTime(),
    )
    .slice(0, MAX_ACTIVITIES);

  // ── Fetch watts streams and compute MMP ───────────────────────────────────
  // Key: `${durationSeconds}-r` (recent) or `${durationSeconds}-h` (historical).
  // Two tiers per duration: recent drives the primary CP regression, historical
  // informs the confidence / error-margin layer.
  const bests = new Map<string, MaxEffort>();

  for (const activity of candidates) {
    const actDate = new Date(activity.start_date_local);
    const isRecent = actDate >= recentCutoff;
    const date = activity.start_date_local.slice(0, 10);
    const activityId = String(activity.id);

    // Fetch per-second power stream
    const streamRes = await fetch(
      `${BASE_URL}/api/v1/activity/${activityId}/streams?types=watts`,
      { headers },
    );
    if (!streamRes.ok) continue;

    const streams = (await streamRes.json()) as PowerStream[];
    const wattsStream = streams.find((s) => s.type === 'watts');
    // Skip activities shorter than the minimum CP duration
    if (!wattsStream || wattsStream.data.length < CP_SAMPLE_DURATIONS[0]) continue;

    const watts = wattsStream.data;

    for (const dur of CP_SAMPLE_DURATIONS) {
      const mmp = computeMMP(watts, dur);
      if (mmp === null) continue;

      const tier = isRecent ? 'r' : 'h';
      const key = `${dur}-${tier}`;
      const existing = bests.get(key);

      if (!existing || mmp > existing.averagePower) {
        bests.set(key, {
          durationSeconds: dur,
          averagePower: mmp,
          date,
          activityId,
          isRecent,
        });
      }
    }
  }

  if (bests.size === 0) {
    return { error: `No running power data found in the last ${daysBack} days.` };
  }

  // Sort: duration ascending; within same duration, highest power first
  const efforts = Array.from(bests.values()).sort(
    (a, b) =>
      a.durationSeconds - b.durationSeconds || b.averagePower - a.averagePower,
  );

  return { efforts };
}
