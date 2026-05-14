// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnvironmentConditions {
  /** Metres above sea level */
  altitudeM: number;
  /** Degrees Celsius */
  temperatureC: number;
  /** 1–100 */
  humidityPercent: number;
}

export interface EnvAdjustmentResult {
  /** Multiplicative factor to apply to power (e.g. 0.9823 = −1.77% penalty) */
  factor: number;
  /** factor expressed as a percentage, rounded to 2 dp (e.g. 98.23) */
  factorPercent: number;
  /** Individual component factors, useful for UI breakdown */
  components: {
    temperature: number;
    humidity: number;
    altitude: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Coefficients calibrated to match v4 Calcs spreadsheet:
//   Faris  19 °C / 47 % → 27 °C / 39 % = 98.23 %
//   Wendy  28 °C / 68 % → 28 °C / 60 % = 100.56 %
const TEMP_COEFF = 0.0029;   // per °C
const HUM_COEFF  = 0.0007;   // per % humidity
const ALT_COEFF  = 0.00003;  // per metre

const FACTOR_MIN = 0.80;
const FACTOR_MAX = 1.20;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Calculates the environmental adjustment factor between two sets of conditions.
 * A factor < 1 means the target conditions are harder (e.g. hotter); > 1 means easier.
 *
 * Used by both the Lab (adjusting CP) and the Strategy Room (adjusting race targets).
 */
export function calcEnvAdjustment(
  test: EnvironmentConditions,
  target: EnvironmentConditions,
): EnvAdjustmentResult {
  const deltaT   = target.temperatureC    - test.temperatureC;
  const deltaH   = target.humidityPercent - test.humidityPercent;
  const deltaAlt = target.altitudeM       - test.altitudeM;

  const tempFactor = 1 - deltaT   * TEMP_COEFF;
  const humFactor  = 1 - deltaH   * HUM_COEFF;
  const altFactor  = 1 - deltaAlt * ALT_COEFF;

  const raw    = tempFactor * humFactor * altFactor;
  const factor = Math.max(FACTOR_MIN, Math.min(FACTOR_MAX, raw));

  return {
    factor,
    factorPercent: Math.round(factor * 10000) / 100,
    components: {
      temperature: tempFactor,
      humidity:    humFactor,
      altitude:    altFactor,
    },
  };
}
