import { calcEnvAdjustment } from './envAdjustment.js';
import type { EnvironmentConditions } from './envAdjustment.js';
export type { EnvironmentConditions };

// ─── Constants ────────────────────────────────────────────────────────────────


/** Default TTE anchor when none is supplied in the Athlete object. */
const DEFAULT_TTE_SECONDS = 3000;

const METERS_TO_FEET = 3.28084;
const METERS_TO_MILES = 0.000621371;

// ─── Types ────────────────────────────────────────────────────────────────────

export type CVICategory = 'Flat' | 'SlightlyHilly' | 'ModeratelyHilly';
export type RiegelLabel = 'Aggressive' | 'Expected' | 'Conservative';
export type RELabel = 'Optimistic' | 'Expected' | 'Pessimistic';
export type EventType = '5K' | '10K' | 'HalfMarathon' | 'Marathon' | 'Custom';

export interface CVIResult {
  /** CVI = climbing_feet / miles (ascending only) */
  cvi: number;
  /** CVINet = ((2 × climbing_feet) − descending_feet) / miles */
  cviNet: number;
}

export interface Athlete {
  cpWatts: number;
  wPrimeJoules: number;
  weightKg: number;
  /** Running Effectiveness measured on flat terrain at race effort */
  baseRE: number;
  /** Time to Exhaustion in seconds — used as the Riegel anchor when no prior race is provided. Defaults to 3000 s. */
  tteSeconds?: number;
  /** Override the distance-bracket default Riegel exponent when no prior race is available. */
  baseRiegel?: number;
  /** Training terrain CVI derived from recent long runs — used for RE terrain adjustment. Defaults to 0 (flat). */
  trainingTerrainCVI?: number;
}

export interface TargetRace {
  distanceMeters: number;
  /** Course CVI for terrain adjustment */
  cvi: number;
}

export interface PriorRace {
  distanceMeters: number;
  timeSeconds: number;
  powerWatts: number;
  /** Course CVI of the prior race — used as the "training terrain" baseline */
  cvi: number;
}

export interface ScenarioResult {
  riegelLabel: RiegelLabel;
  reLabel: RELabel;
  riegelExponent: number;
  adjustedRE: number;
  targetPowerWatts: number;
  estimatedTimeSeconds: number;
  /** "H:MM:SS" formatted finish time */
  formattedTime: string;
  /** Power as % of env-adjusted CP */
  percentCP: number;
}

export interface RaceScenarioOutput {
  scenarios: ScenarioResult[];
  /** Standard event bracket the distance was matched to, or 'Custom' if out of bounds. */
  eventType: EventType;
  /** Present when distanceMeters falls outside all standard brackets and no prior race was provided. */
  warning?: string;
}

// ─── Internal lookup tables ───────────────────────────────────────────────────

/** CVI upper-bound thresholds for each terrain category */
const CVI_THRESHOLDS: [CVICategory, number][] = [
  ['Flat',            25],
  ['SlightlyHilly',   75],
  ['ModeratelyHilly', Infinity],
];

/**
 * RE Adjustment Matrix — delta to apply to baseRE.
 * Rows = training/prior-race terrain; Columns = target terrain.
 * Moving to hillier terrain decreases RE; to flatter terrain increases it.
 */
const RE_ADJUSTMENT_MATRIX: Record<CVICategory, Record<CVICategory, number>> = {
  Flat:            { Flat:  0.000, SlightlyHilly: -0.015, ModeratelyHilly: -0.030 },
  SlightlyHilly:   { Flat: +0.015, SlightlyHilly:  0.000, ModeratelyHilly: -0.015 },
  ModeratelyHilly: { Flat: +0.030, SlightlyHilly: +0.015, ModeratelyHilly:  0.000 },
};

/**
 * Standard-event distance brackets used to identify event type and select a
 * default Riegel exponent when no prior race is available.
 *
 * Ranges are intentionally wide enough to absorb GPS drift and tangent error
 * while remaining exclusive (no bracket overlaps another).
 *
 * Source: Riegels spreadsheet.
 */
interface DistanceBracket {
  eventType: Exclude<EventType, 'Custom'>;
  minMeters: number;
  maxMeters: number;
  riegelDefault: number;
}

const DISTANCE_BRACKETS: DistanceBracket[] = [
  { eventType: '5K',           minMeters:  4_850, maxMeters:  5_500, riegelDefault: -0.05 },
  { eventType: '10K',          minMeters:  9_500, maxMeters: 10_500, riegelDefault: -0.05 },
  { eventType: 'HalfMarathon', minMeters: 20_000, maxMeters: 22_000, riegelDefault: -0.06 },
  { eventType: 'Marathon',     minMeters: 40_929, maxMeters: 43_460, riegelDefault: -0.06 },
];

const OUT_OF_BOUNDS_DEFAULT_EXPONENT = -0.06;
const OUT_OF_BOUNDS_WARNING =
  'Distance does not fall within any recognised event bracket. ' +
  'A default Riegel exponent of −0.06 has been used. ' +
  'Provide a prior race for a personalised exponent.';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function classifyCVI(cvi: number): CVICategory {
  for (const [category, max] of CVI_THRESHOLDS) {
    if (cvi <= max) return category;
  }
  return 'ModeratelyHilly';
}

/**
 * Matches a distance to a standard event bracket.
 * Returns the event type, default Riegel exponent, and an out-of-bounds flag.
 * The physics calculation always uses the exact distanceMeters provided — this
 * function only governs exponent selection, never distance rounding.
 */
export function resolveDistanceBracket(distanceMeters: number): {
  eventType: EventType;
  riegelDefault: number;
  outOfBounds: boolean;
} {
  const bracket = DISTANCE_BRACKETS.find(
    (b) => distanceMeters >= b.minMeters && distanceMeters <= b.maxMeters,
  );
  if (bracket) {
    return { eventType: bracket.eventType, riegelDefault: bracket.riegelDefault, outOfBounds: false };
  }
  return { eventType: 'Custom', riegelDefault: OUT_OF_BOUNDS_DEFAULT_EXPONENT, outOfBounds: true };
}

function formatTime(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Closed-form solution for the coupled power–time system:
 *   P = P₀ × (T / T₀)^r          [Riegel power-duration decay]
 *   T = (D × W) / (P × RE)        [Running Effectiveness definition]
 *
 * Substituting and solving for T:
 *   T = ((D × W × T₀^r) / (P₀ × RE))^(1 / (1 + r))
 *   P = P₀ × (T / T₀)^r
 */
function solveTimePower(
  distanceMeters: number,
  weightKg: number,
  anchorTime: number,
  anchorPower: number,
  riegel: number,
  re: number,
): { time: number; power: number } {
  const numerator = distanceMeters * weightKg * Math.pow(anchorTime, riegel);
  const denominator = anchorPower * re;
  const time = Math.pow(numerator / denominator, 1 / (1 + riegel));
  const power = anchorPower * Math.pow(time / anchorTime, riegel);
  return { time, power };
}

// ─── Environment adjustment ───────────────────────────────────────────────────

/**
 * Returns the environmental adjustment factor for race power targets.
 * Delegates to `calcEnvAdjustment` from envAdjustment.ts (parity-verified).
 * Pass the result's `.factor` directly as `envAdjustmentFactor` in `calculateRaceScenario`.
 */
export function calculateEnvironmentAdjustment(
  baselineEnv: EnvironmentConditions,
  targetEnv: EnvironmentConditions,
): number {
  return calcEnvAdjustment(baselineEnv, targetEnv).factor;
}

// ─── Task 2: CVI helper ───────────────────────────────────────────────────────

/**
 * Calculates Course Variability Index (CVI) and Net CVI for a given course.
 *
 * CVI    = climbing_feet / miles
 * CVINet = ((2 × climbing_feet) − descending_feet) / miles
 */
export function calculateCVI(
  distanceMeters: number,
  climbingMeters: number,
  descendingMeters: number,
): CVIResult {
  const miles = distanceMeters * METERS_TO_MILES;
  const climbFeet = climbingMeters * METERS_TO_FEET;
  const descFeet = descendingMeters * METERS_TO_FEET;

  return {
    cvi:    climbFeet / miles,
    cviNet: (2 * climbFeet - descFeet) / miles,
  };
}

// ─── Task 4: Core race-scenario calculator ────────────────────────────────────

/**
 * Generates a 3×3 bracket of 9 race scenarios pairing three Riegel exponents
 * (Aggressive / Expected / Conservative) with three RE values
 * (Optimistic / Expected / Pessimistic).
 *
 * The physics always use the exact `targetRace.distanceMeters` supplied —
 * distance is never rounded to a standard event length.
 *
 * When `priorRace` is supplied the model uses it as the power-duration anchor
 * and derives a personal Riegel exponent from the athlete's CP.
 * Without a prior race the anchor is (athlete.tteSeconds ?? 3000, adjustedCP) and
 * the Riegel exponent comes from athlete.baseRiegel or the distance-bracket lookup.
 *
 * @param envAdjustmentFactor - Multiplier applied to CP before solving (e.g. 0.9823).
 *   Defaults to 1.0 (no adjustment). percentCP in results is always relative to adjustedCP.
 */
export function calculateRaceScenario(
  athlete: Athlete,
  targetRace: TargetRace,
  priorRace?: PriorRace,
  envAdjustmentFactor: number = 1.0,
): RaceScenarioOutput {
  const adjustedCP = athlete.cpWatts * envAdjustmentFactor;
  const tteSeconds = athlete.tteSeconds ?? DEFAULT_TTE_SECONDS;
  // ── Terrain-based RE adjustment ──────────────────────────────────────────────
  const trainingCVI = athlete.trainingTerrainCVI ?? priorRace?.cvi ?? 0;
  const trainingCategory = classifyCVI(trainingCVI);
  const targetCategory = classifyCVI(targetRace.cvi);
  const reAdjustment = RE_ADJUSTMENT_MATRIX[trainingCategory][targetCategory];
  const adjustedRE = athlete.baseRE + reAdjustment;

  // ── Central Riegel exponent & event-type identification ──────────────────────
  let centralRiegel: number;
  let eventType: EventType;
  let warning: string | undefined;

  if (priorRace) {
    centralRiegel =
      Math.log(priorRace.powerWatts / athlete.cpWatts) /
      Math.log(priorRace.timeSeconds / tteSeconds);
    eventType = resolveDistanceBracket(targetRace.distanceMeters).eventType;
  } else {
    const resolved = resolveDistanceBracket(targetRace.distanceMeters);
    centralRiegel = athlete.baseRiegel ?? resolved.riegelDefault;
    eventType = resolved.eventType;
    if (resolved.outOfBounds && athlete.baseRiegel === undefined) warning = OUT_OF_BOUNDS_WARNING;
  }

  // ── Anchor point for the power-duration curve ────────────────────────────────
  // Prior race: anchor to actual race performance.
  // No prior race: anchor to (TTE, adjustedCP) — matches v4 Calcs spreadsheet.
  const anchorTime  = priorRace ? priorRace.timeSeconds : tteSeconds;
  const anchorPower = priorRace ? priorRace.powerWatts  : adjustedCP;

  // ── Build the 3×3 bracket ────────────────────────────────────────────────────
  const riegelBracket: [RiegelLabel, number][] = [
    ['Aggressive',   centralRiegel + 0.01],  // less fatigue fade
    ['Expected',     centralRiegel],
    ['Conservative', centralRiegel - 0.01],  // more fatigue fade
  ];

  const reBracket: [RELabel, number][] = [
    ['Optimistic',  adjustedRE + 0.01],
    ['Expected',    adjustedRE],
    ['Pessimistic', adjustedRE - 0.01],
  ];

  const scenarios: ScenarioResult[] = [];

  for (const [riegelLabel, riegel] of riegelBracket) {
    for (const [reLabel, re] of reBracket) {
      const { time, power } = solveTimePower(
        targetRace.distanceMeters,  // always exact — never snapped to standard distance
        athlete.weightKg,
        anchorTime,
        anchorPower,
        riegel,
        re,
      );
      scenarios.push({
        riegelLabel,
        reLabel,
        riegelExponent: riegel,
        adjustedRE: re,
        targetPowerWatts: power,
        estimatedTimeSeconds: time,
        formattedTime: formatTime(time),
        percentCP: (power / adjustedCP) * 100,
      });
    }
  }

  return { scenarios, eventType, ...(warning !== undefined && { warning }) };
}
