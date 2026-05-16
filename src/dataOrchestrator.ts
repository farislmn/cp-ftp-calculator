import type { MaxEffort } from './intervalsClient.js';
import { buildAuthHeader } from './intervalsClient.js';
import type { EnvironmentConditions } from './envAdjustment.js';
import { calculateCVI } from './strategyEngine.js';
import { getCached, setCached, TTL } from './cache.js';

export type { EnvironmentConditions };

const BASE_URL = typeof window !== 'undefined' ? '' : 'https://intervals.icu';

// ─── Internal API shapes ──────────────────────────────────────────────────────
// Field names verified against the live Intervals.icu API (May 2026).

interface ActivitySummary {
  id: string | number;
  name?: string;
  start_date_local: string;
  type: string;
  distance?: number;           // meters
  moving_time?: number;        // seconds
  /** true = race; workout_type is always null in this API — use this instead. */
  race?: boolean;
  total_elevation_gain?: number;   // meters
  average_altitude?: number;       // average altitude during run, meters
  min_altitude?: number;           // lowest point during run, meters
  /** Device/weather temperature in °C. Field name is average_temp (not temperature). */
  average_temp?: number | null;
  /** Stryd sensor humidity %. No native weather humidity field exists in the API. */
  StrydHumidity?: number | null;
  icu_ftp?: number | null;
  icu_average_watts?: number | null;   // average power for full activity
  average_speed?: number;              // m/s
}

/**
 * Shape returned by GET /api/v1/activity/{id}/intervals.
 * The response is an object wrapping the array, NOT a raw array.
 */
interface IntervalsResponse {
  icu_intervals?: IcuInterval[];
}

interface IcuInterval {
  start_index?: number;
  end_index?: number;
  distance?: number;           // meters
  moving_time?: number;        // seconds
  elapsed_time?: number;
  average_watts?: number;
  average_watts_alt?: number;  // backup watts field
  average_speed?: number;      // m/s — derive as distance/moving_time if absent
  type?: string;               // 'ACTIVE', 'REST', 'WARMUP', 'COOLDOWN', etc.
  label?: string;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface EnvironmentContext {
  /** Average altitude across CP test activities (meters). */
  altitudeM: number;
  /** Average test temperature, with high-variance fallback to 90-day median. */
  temperatureC: number;
  /** Average Stryd humidity during CP tests, or null when sensor data is absent. */
  humidityPercent: number | null;
}

export interface PriorRaceAnchor {
  distanceMeters: number;
  movingTimeSeconds: number;
  averagePowerWatts: number | null;
  elevationGainMeters: number | null;
}

export interface RaceRecord {
  id: string | number;
  /** ISO date (YYYY-MM-DD) */
  date: string;
  name?: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  elevationGainMeters: number | null;
}

export interface REResult {
  longRunRE: number | null;
  intervalRE: number | null;
}

export interface StrategyDataResult {
  environment: EnvironmentContext;
  /** Average CVI from the 3 longest non-race runs in the last 6 weeks. 0 when no data. */
  trainingTerrainCVI: number;
  re: REResult;
  warnings: string[];
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeHeaders(apiKey: string): Record<string, string> {
  return { Authorization: buildAuthHeader(apiKey), Accept: 'application/json' };
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** RE = (speed m/s × weight kg) / power W — matches the strategyEngine solver. */
function calcRE(speedMs: number, powerW: number, weightKg: number): number {
  return (speedMs * weightKg) / powerW;
}

function intervalWatts(iv: IcuInterval): number | null {
  return iv.average_watts ?? iv.average_watts_alt ?? null;
}

/** Speed in m/s: use the direct field, or derive from distance ÷ moving_time. */
function intervalSpeed(iv: IcuInterval): number | null {
  if (typeof iv.average_speed === 'number' && iv.average_speed > 0) return iv.average_speed;
  if (typeof iv.distance === 'number' && typeof iv.moving_time === 'number' && iv.moving_time > 0) {
    return iv.distance / iv.moving_time;
  }
  return null;
}

function isActiveInterval(iv: IcuInterval): boolean {
  const t = iv.type?.toUpperCase() ?? '';
  return t !== 'REST' && t !== 'COOLDOWN' && t !== 'WARMUP' && t !== 'RECOVERY';
}

async function fetchActivityDetail(
  activityId: string,
  headers: Record<string, string>,
): Promise<ActivitySummary | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/activity/${activityId}`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as ActivitySummary;
  } catch {
    return null;
  }
}

/**
 * Fetches structured intervals for an activity.
 * The endpoint returns { icu_intervals: [...] }, NOT a bare array.
 */
async function fetchActivityIntervals(
  activityId: string,
  headers: Record<string, string>,
): Promise<IcuInterval[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/v1/activity/${activityId}/intervals`,
      { headers },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as IntervalsResponse;
    return data.icu_intervals ?? [];
  } catch {
    return [];
  }
}

async function fetchActivityList(
  athleteId: string,
  headers: Record<string, string>,
  oldest: Date,
  newest: Date,
): Promise<ActivitySummary[]> {
  const url =
    `${BASE_URL}/api/v1/athlete/${athleteId}/activities` +
    `?oldest=${fmtDate(oldest)}&newest=${fmtDate(newest)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Activity list: HTTP ${res.status} ${res.statusText}`);
  return (await res.json()) as ActivitySummary[];
}

// ─── %CP bracket per target distance ─────────────────────────────────────────

function cpBracket(distanceMeters: number): [low: number, high: number] {
  if (distanceMeters <  7_000) return [0.97, 1.10];  // 5 K
  if (distanceMeters < 15_000) return [0.90, 1.00];  // 10 K
  if (distanceMeters < 30_000) return [0.85, 0.93];  // Half marathon
  if (distanceMeters < 50_000) return [0.79, 0.87];  // Marathon
  return [0.72, 0.82];                                 // Ultra
}

// ─── Task 1: Environment Extractor ───────────────────────────────────────────

/**
 * Derives testConditions from the activities used for the CP calculation.
 *
 * - altitudeM    : average altitude across CP activities.
 * - temperatureC : simple average of average_temp; if max−min > 10 °C, falls
 *                  back to the 90-day median of all runs.
 * - humidityPercent: average of StrydHumidity sensor readings; null if absent.
 */
export async function extractEnvironmentContext(
  selectedEfforts: MaxEffort[],
  athleteId: string,
  apiKey: string,
): Promise<{ context: EnvironmentContext; warnings: string[] }> {
  const headers = makeHeaders(apiKey);
  const warnings: string[] = [];

  // Parallel fetch — typically just 2 activities.
  const details = (
    await Promise.all(selectedEfforts.map((e) => fetchActivityDetail(e.activityId, headers)))
  ).filter((d): d is ActivitySummary => d !== null);

  // ── Altitude ──────────────────────────────────────────────────────────────────
  const altitudes = details
    .map((d) => d.average_altitude)
    .filter((a): a is number => typeof a === 'number');

  const altitudeM = altitudes.length > 0 ? mean(altitudes) : 0;
  if (altitudes.length === 0) {
    warnings.push(
      'No altitude data on CP test activities. Defaulting to sea level (0 m).',
    );
  }

  // ── Temperature (average_temp) ────────────────────────────────────────────────
  const testTemps = details
    .map((d) => d.average_temp)
    .filter((t): t is number => typeof t === 'number');

  let temperatureC: number;

  if (testTemps.length === 0) {
    temperatureC = 20;
    warnings.push(
      'No average_temp data on CP test activities. Defaulting to 20 °C.',
    );
  } else {
    const tempRange = Math.max(...testTemps) - Math.min(...testTemps);
    if (tempRange > 10) {
      warnings.push(
        `Temperature spread across CP activities is ${tempRange.toFixed(1)} °C ` +
          '(> 10 °C threshold). Falling back to 90-day median.',
      );
      try {
        const recent = (
          await fetchActivityList(athleteId, headers, daysAgo(90), new Date())
        )
          .filter(
            (a) =>
              (a.type === 'Run' || a.type === 'VirtualRun') &&
              typeof a.average_temp === 'number',
          )
          .map((a) => a.average_temp as number);
        temperatureC = recent.length > 0 ? median(recent) : mean(testTemps);
      } catch {
        temperatureC = mean(testTemps);
        warnings.push(
          '90-day median fallback failed. Using average of test temperatures.',
        );
      }
    } else {
      temperatureC = mean(testTemps);
    }
  }

  // ── Humidity (StrydHumidity sensor) ──────────────────────────────────────────
  const humidities = details
    .map((d) => d.StrydHumidity)
    .filter((h): h is number => typeof h === 'number');

  const humidityPercent = humidities.length > 0 ? mean(humidities) : null;
  if (humidityPercent === null) {
    warnings.push(
      'No StrydHumidity data on CP test activities. ' +
        'Enter humidity manually if race conditions differ from test conditions.',
    );
  }

  return { context: { altitudeM, temperatureC, humidityPercent }, warnings };
}

// ─── Task 2: Prior Race Anchor ────────────────────────────────────────────────

/**
 * Finds the race in the last 6 months (race === true) whose distance is
 * closest to targetRaceDistanceMeters.  Falls back to longest race when
 * targetRaceDistanceMeters is null.
 * Returns null without throwing when no races exist.
 */
export async function extractPriorRaceAnchor(
  athleteId: string,
  apiKey: string,
  targetRaceDistanceMeters?: number | null,
): Promise<{ anchor: PriorRaceAnchor | null; warnings: string[] }> {
  const headers = makeHeaders(apiKey);
  const warnings: string[] = [];

  let activities: ActivitySummary[];
  try {
    activities = await fetchActivityList(athleteId, headers, daysAgo(180), new Date());
  } catch (err) {
    return {
      anchor: null,
      warnings: [`Prior race fetch failed: ${(err as Error).message}`],
    };
  }

  const races = activities.filter(
    (a) =>
      (a.type === 'Run' || a.type === 'VirtualRun') &&
      a.race === true &&
      typeof a.distance === 'number' &&
      a.distance > 0 &&
      typeof a.moving_time === 'number' &&
      a.moving_time > 0,
  );

  if (races.length === 0) {
    warnings.push(
      'No races found in the last 6 months (race === true, Run). ' +
        'Riegel will use the TTE anchor.',
    );
    return { anchor: null, warnings };
  }

  const best = targetRaceDistanceMeters != null
    ? races.reduce((prev, cur) =>
        Math.abs((cur.distance ?? 0) - targetRaceDistanceMeters) <
        Math.abs((prev.distance ?? 0) - targetRaceDistanceMeters) ? cur : prev,
      )
    : races.reduce((prev, cur) =>
        (cur.distance ?? 0) > (prev.distance ?? 0) ? cur : prev,
      );

  return {
    anchor: {
      distanceMeters: best.distance!,
      movingTimeSeconds: best.moving_time!,
      averagePowerWatts: best.icu_average_watts ?? null,
      elevationGainMeters: best.total_elevation_gain ?? null,
    },
    warnings,
  };
}

// ─── Task 2b: Recent Race List ────────────────────────────────────────────────

/**
 * Returns all races from the last 6 months (race === true, Run / VirtualRun),
 * sorted most-recent first.  Throws on network failure.
 * Used by the Riegel Calibration panel to let the user pick a calibration anchor.
 */
export async function fetchRecentRaces(
  athleteId: string,
  apiKey: string,
): Promise<RaceRecord[]> {
  const cacheKey = `races_v1_${athleteId}`;
  const cached = getCached<RaceRecord[]>(cacheKey);
  if (cached) return cached;

  const headers = makeHeaders(apiKey);
  const activities = await fetchActivityList(athleteId, headers, daysAgo(180), new Date());

  const races = activities
    .filter(
      (a) =>
        (a.type === 'Run' || a.type === 'VirtualRun') &&
        a.race === true &&
        typeof a.distance === 'number' &&
        a.distance > 0 &&
        typeof a.moving_time === 'number' &&
        a.moving_time > 0,
    )
    .map((a) => ({
      id: a.id,
      date: a.start_date_local.slice(0, 10),
      name: a.name,
      distanceMeters: a.distance!,
      movingTimeSeconds: a.moving_time!,
      elevationGainMeters: a.total_elevation_gain ?? null,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  setCached(cacheKey, races, TTL.RACE_LIST);
  return races;
}

// ─── Task 3: Running Effectiveness Extractor ─────────────────────────────────

/**
 * Derives longRunRE and intervalRE from recent training data.
 *
 * **longRunRE** — From the 3 longest non-race runs in the last 90 days.
 *   For each: fetches the structured intervals (icu_intervals endpoint), finds
 *   the single longest active interval, and computes RE. Falls back to
 *   whole-activity speed + power if no interval data is present.
 *
 * **intervalRE** — Scans all non-race runs in the last 90 days for individual
 *   intervals whose average_watts fall in the %CP bracket for the target
 *   distance (e.g. marathon = 79–87 % CP).
 *
 * Uses 90 days rather than 6 weeks to capture a full training block — athletes
 * in a post-race recovery period may have no structured long runs in 6 weeks.
 *
 * @throws {Error} when targetRaceDistanceMeters is null/undefined.
 */
export async function extractRunningEffectiveness(
  athleteId: string,
  apiKey: string,
  targetRaceDistanceMeters: number | null | undefined,
  calculatedCPWatts: number,
  weightKg: number,
): Promise<{ re: REResult; warnings: string[] }> {
  if (targetRaceDistanceMeters == null) {
    throw new Error(
      'Target Race Distance is required to calculate specific interval RE.',
    );
  }

  const headers = makeHeaders(apiKey);
  const warnings: string[] = [];

  let activities: ActivitySummary[];
  try {
    activities = await fetchActivityList(athleteId, headers, daysAgo(90), new Date());
  } catch (err) {
    throw new Error(`RE extractor: activity list failed: ${(err as Error).message}`);
  }

  const runs = activities.filter(
    (a) => (a.type === 'Run' || a.type === 'VirtualRun') && a.race !== true,
  );

  // ── Logic A: Long Run RE ──────────────────────────────────────────────────────
  const longRunCandidates = runs
    .filter((a) => typeof a.distance === 'number' && a.distance > 10_000)
    .sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0))
    .slice(0, 3);

  const longRunREValues: number[] = [];

  for (const run of longRunCandidates) {
    const id = String(run.id);
    const intervals = await fetchActivityIntervals(id, headers);

    let re: number | null = null;

    if (intervals.length > 0) {
      // Find the longest active interval by distance (then by time as fallback).
      const active = intervals.filter(isActiveInterval);
      const longest = active.reduce<IcuInterval | null>((best, iv) => {
        if (!best) return iv;
        const ivSize = iv.distance ?? iv.moving_time ?? 0;
        const bestSize = best.distance ?? best.moving_time ?? 0;
        return ivSize > bestSize ? iv : best;
      }, null);

      if (longest) {
        const power = intervalWatts(longest);
        const speed = intervalSpeed(longest);
        if (power != null && speed != null && power > 0 && speed > 0) {
          re = calcRE(speed, power, weightKg);
        }
      }
    }

    // Fallback: whole-activity averages if intervals gave no result.
    if (re === null && run.icu_average_watts && run.average_speed) {
      const power = run.icu_average_watts;
      const speed = run.average_speed;
      if (power > 0 && speed > 0) re = calcRE(speed, power, weightKg);
    }

    if (re !== null) longRunREValues.push(re);
  }

  const longRunRE = longRunREValues.length > 0 ? mean(longRunREValues) : null;
  if (longRunRE === null) {
    warnings.push(
      'Long Run RE: no qualifying runs > 10 km with power data found in the last 90 days.',
    );
  }

  // ── Logic B: Interval RE ──────────────────────────────────────────────────────
  const [cpLow, cpHigh] = cpBracket(targetRaceDistanceMeters);
  const powerLow  = calculatedCPWatts * cpLow;
  const powerHigh = calculatedCPWatts * cpHigh;

  // Any non-race run can contain structured intervals at race-effort pace.
  // Cap at 15 most recent to limit API calls.
  const intervalREValues: number[] = [];

  for (const run of runs.slice(0, 15)) {
    const intervals = await fetchActivityIntervals(String(run.id), headers);

    for (const iv of intervals) {
      if (!isActiveInterval(iv)) continue;
      const power = intervalWatts(iv);
      const speed = intervalSpeed(iv);
      if (power == null || speed == null || power <= 0 || speed <= 0) continue;
      if (power < powerLow || power > powerHigh) continue;
      intervalREValues.push(calcRE(speed, power, weightKg));
    }
  }

  const intervalRE = intervalREValues.length > 0 ? mean(intervalREValues) : null;
  if (intervalRE === null) {
    warnings.push(
      `Interval RE: no intervals found with power in the ` +
        `${(cpLow * 100).toFixed(0)}–${(cpHigh * 100).toFixed(0)}% CP bracket ` +
        `(${powerLow.toFixed(0)}–${powerHigh.toFixed(0)} W) in the last 90 days.`,
    );
  }

  return { re: { longRunRE, intervalRE }, warnings };
}

// ─── Task 3b: Training Terrain CVI ───────────────────────────────────────────

/**
 * Derives the athlete's training terrain CVI from the 3 longest non-race runs
 * in the last 6 weeks (42 days).  Uses total_elevation_gain as both climb and
 * descent (symmetric assumption — typical for laps / out-and-back routes).
 * Returns 0 (flat) when no qualifying runs are found.
 */
async function extractTrainingTerrainCVI(
  athleteId: string,
  headers: Record<string, string>,
): Promise<{ cvi: number; warnings: string[] }> {
  const warnings: string[] = [];

  let activities: ActivitySummary[];
  try {
    activities = await fetchActivityList(athleteId, headers, daysAgo(42), new Date());
  } catch {
    warnings.push('Training terrain CVI: activity list fetch failed. Defaulting to flat (CVI 0).');
    return { cvi: 0, warnings };
  }

  const candidates = activities
    .filter(
      (a) =>
        (a.type === 'Run' || a.type === 'VirtualRun') &&
        a.race !== true &&
        typeof a.distance === 'number' &&
        a.distance > 0 &&
        typeof a.total_elevation_gain === 'number',
    )
    .sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0))
    .slice(0, 3);

  if (candidates.length === 0) {
    warnings.push('Training terrain CVI: no qualifying runs found in the last 6 weeks. Defaulting to flat (CVI 0).');
    return { cvi: 0, warnings };
  }

  const cviValues = candidates.map((a) => {
    const elev = a.total_elevation_gain!;
    return calculateCVI(a.distance!, elev, elev).cvi;
  });

  return { cvi: mean(cviValues), warnings };
}

// ─── Task 4: Master Orchestrator ─────────────────────────────────────────────

/**
 * Runs all three extractors in parallel and returns a single object ready
 * to feed into calculateRaceScenario.
 *
 * What the caller still needs to supply:
 *   - athlete.cpWatts / wPrimeJoules / weightKg   → from the Lab engine
 *   - targetRace.distanceMeters / cvi              → from user input
 *   - targetConditions (race-day env)              → from user input
 *   → call calcEnvAdjustment(result.environment, targetConditions) for the factor
 *
 * @param targetRaceDistanceMeters - null skips Interval RE; env + race anchor
 *   are still returned.
 */
export async function syncStrategyData(
  selectedEfforts: MaxEffort[],
  athleteId: string,
  apiKey: string,
  targetRaceDistanceMeters: number | null | undefined,
  calculatedCPWatts: number,
  weightKg: number,
): Promise<StrategyDataResult> {
  const headers = makeHeaders(apiKey);

  const rePromise: Promise<{ re: REResult; warnings: string[] }> =
    targetRaceDistanceMeters == null
      ? Promise.resolve({
          re: { longRunRE: null, intervalRE: null },
          warnings: ['Target Race Distance not provided — Interval RE skipped.'],
        })
      : extractRunningEffectiveness(
          athleteId,
          apiKey,
          targetRaceDistanceMeters,
          calculatedCPWatts,
          weightKg,
        ).catch((err: unknown) => ({
          re: { longRunRE: null, intervalRE: null },
          warnings: [(err as Error).message],
        }));

  const [envResult, terrainResult, reResult] = await Promise.all([
    extractEnvironmentContext(selectedEfforts, athleteId, apiKey),
    extractTrainingTerrainCVI(athleteId, headers),
    rePromise,
  ]);

  return {
    environment:        envResult.context,
    trainingTerrainCVI: terrainResult.cvi,
    re:                 reResult.re,
    warnings: [
      ...envResult.warnings,
      ...terrainResult.warnings,
      ...reResult.warnings,
    ],
  };
}
