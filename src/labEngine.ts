import { calcEnvAdjustment, EnvironmentConditions } from './envAdjustment.js';
export type { EnvironmentConditions };

// ─── Types ────────────────────────────────────────────────────────────────────

export type Sex = 'Male' | 'Female';

export type PowerMeter =
  | 'Stryd Wind'
  | 'Stryd non-Wind'
  | 'Others (Garmin/Coros-based power, etc)';

export type WPrimeRating = 'Low' | 'Medium' | 'High' | 'N/A';

export interface Effort {
  durationSeconds: number;
  averagePower: number;
}

export interface OutlierInfo {
  /** Zero-based index into the original efforts array */
  index: number;
  effort: Effort;
  /** Actual work calculated from the effort (J) */
  workJoules: number;
  /** Work predicted by the regression line (J) */
  predictedWorkJoules: number;
  /** Absolute deviation from the regression line (J) */
  residualJoules: number;
  /** Relative deviation as a percentage of the predicted value */
  residualPercent: number;
}

export interface CPWarning {
  message: string;
  /** All efforts ranked by how far they deviate from the regression line.
   *  The first element is the biggest outlier — the one the UI should suggest removing. */
  suggestedCorrection: OutlierInfo[];
}

export interface CPResult {
  criticalPowerWatts: number;
  wPrimeKJ: number;
  /** W' in raw Joules, useful for downstream calculations */
  wPrimeJoules: number;
  /** W' normalised to body weight (J/kg) */
  wPrimePerKg: number;
  wPrimeRating: WPrimeRating;
  /** Coefficient of determination for the regression fit */
  r2: number;
  /** Only present when environment conditions are supplied */
  envAdjustment?: {
    /** Multiplicative factor (e.g. 0.9823) */
    factor: number;
    /** Factor as a percentage (e.g. 98.23) */
    factorPercent: number;
    /** CP after applying the environmental factor */
    adjustedCriticalPowerWatts: number;
  };
  /** Only present when R² < 0.95 */
  warning?: CPWarning;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Reference W' baselines (J/kg) per sex × power-meter combination */
const W_PRIME_BASELINES: Partial<Record<`${Sex}-${PowerMeter}`, number>> = {
  'Male-Stryd non-Wind': 108,
  'Female-Stryd non-Wind': 102,
  'Male-Stryd Wind': 138,
  'Female-Stryd Wind': 132,
};

const MEDIUM_BAND = 0.15; // ±15% defines the "Medium" corridor
const LOW_R2_THRESHOLD = 0.95;
const MIN_DURATION_S = 180;
const MAX_DURATION_S = 2400;

const LOW_CONFIDENCE_WARNING =
  'Confidence in this result is low due to inconsistent pacing. ' +
  'Consider removing the anomalous effort or re-testing in the upcoming weeks.';

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface RegressionResult {
  slope: number;
  intercept: number;
  r2: number;
}

/**
 * Ordinary least-squares linear regression.
 * Returns slope (m), intercept (b), and R² for y = mx + b.
 */
function linearRegression(x: number[], y: number[]): RegressionResult {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i]!, 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi ** 2, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX ** 2);
  const intercept = (sumY - slope * sumX) / n;

  const yMean = sumY / n;
  const ssTot = y.reduce((acc, yi) => acc + (yi - yMean) ** 2, 0);
  const ssRes = y.reduce(
    (acc, yi, i) => acc + (yi - (slope * x[i]! + intercept)) ** 2,
    0,
  );

  // Guard against degenerate case (all y values identical → ssTot = 0)
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}

/**
 * Rates W' relative to sex/device population baselines.
 * Returns 'N/A' when no baseline exists for the given combination.
 */
function rateWPrime(
  wPrimePerKg: number,
  sex: Sex,
  powerMeter: PowerMeter,
): WPrimeRating {
  const key = `${sex}-${powerMeter}` as `${Sex}-${PowerMeter}`;
  const baseline = W_PRIME_BASELINES[key];
  if (baseline === undefined) return 'N/A';

  if (wPrimePerKg < baseline * (1 - MEDIUM_BAND)) return 'Low';
  if (wPrimePerKg > baseline * (1 + MEDIUM_BAND)) return 'High';
  return 'Medium';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Calculates Critical Power (CP) and W' (anaerobic work capacity) from a set
 * of maximal efforts using the linear work-duration regression model.
 *
 * @throws {Error} if fewer than 2 efforts are provided or any duration is
 *   outside the inclusive interval [180 s, 2400 s].
 */
export function calculateCP(
  efforts: Effort[],
  weightKg: number,
  sex: Sex,
  powerMeter: PowerMeter,
  testConditions?: EnvironmentConditions,
  targetConditions?: EnvironmentConditions,
): CPResult {
  // ── Validation ──────────────────────────────────────────────────────────────
  if (efforts.length < 2) {
    throw new Error('At least 2 efforts are required to calculate CP.');
  }

  const invalidEfforts = efforts.filter(
    (e) => e.durationSeconds < MIN_DURATION_S || e.durationSeconds > MAX_DURATION_S,
  );
  if (invalidEfforts.length > 0) {
    const list = invalidEfforts.map((e) => `${e.durationSeconds}s`).join(', ');
    throw new Error(
      `All durations must be between ${MIN_DURATION_S} and ${MAX_DURATION_S} seconds (inclusive). ` +
        `Out-of-range: ${list}`,
    );
  }

  // ── Core regression ─────────────────────────────────────────────────────────
  const x = efforts.map((e) => e.durationSeconds);
  const y = efforts.map((e) => e.averagePower * e.durationSeconds); // Work in Joules

  const { slope, intercept, r2 } = linearRegression(x, y);

  const cpWatts = slope;
  const wPrimeJoules = intercept;
  const wPrimeKJ = wPrimeJoules / 1000;
  const wPrimePerKg = wPrimeJoules / weightKg;

  // ── Environmental adjustment (optional) ────────────────────────────────────
  let envAdjustment: CPResult['envAdjustment'];
  if (testConditions && targetConditions) {
    const adj = calcEnvAdjustment(testConditions, targetConditions);
    envAdjustment = {
      factor: adj.factor,
      factorPercent: adj.factorPercent,
      adjustedCriticalPowerWatts: cpWatts * adj.factor,
    };
  }

  // ── Assemble result ─────────────────────────────────────────────────────────
  const result: CPResult = {
    criticalPowerWatts: cpWatts,
    wPrimeKJ,
    wPrimeJoules,
    wPrimePerKg,
    wPrimeRating: rateWPrime(wPrimePerKg, sex, powerMeter),
    r2,
    ...(envAdjustment && { envAdjustment }),
  };

  // ── Low-confidence warning ──────────────────────────────────────────────────
  if (r2 < LOW_R2_THRESHOLD) {
    // Rank efforts by relative residual (% deviation from predicted Work).
    // Using relative rather than absolute residual prevents longer, higher-Work
    // efforts from always being flagged simply because of scale.
    const outliers: OutlierInfo[] = x
      .map((xi, i) => {
        const predicted = slope * xi + intercept;
        const absResidual = Math.abs(y[i]! - predicted);
        return {
          index: i,
          effort: efforts[i]!,
          workJoules: y[i]!,
          predictedWorkJoules: predicted,
          residualJoules: absResidual,
          residualPercent: (absResidual / Math.abs(predicted)) * 100,
        };
      })
      .sort((a, b) => b.residualPercent - a.residualPercent);

    result.warning = {
      message: LOW_CONFIDENCE_WARNING,
      suggestedCorrection: outliers,
    };
  }

  return result;
}
