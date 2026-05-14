/**
 * Console verification script — paste your spreadsheet data into TEST_CASES
 * and run:  npm test
 */
import { calculateCP, Effort, PowerMeter, Sex, EnvironmentConditions } from './labEngine.js';
import { calcEnvAdjustment } from './envAdjustment.js';

// ─── YOUR DATA GOES HERE ──────────────────────────────────────────────────────

const TEST_CASES: Array<{
  label: string;
  efforts: Effort[];
  weightKg: number;
  sex: Sex;
  powerMeter: PowerMeter;
  testConditions?: EnvironmentConditions;
  targetConditions?: EnvironmentConditions;
}> = [
  // ── Real data — 3-point ──────────────────────────────────────────────────────
  {
    label: 'Real data — Male, 53 kg, Stryd Wind (3-point: 30 Apr / 16 Apr)',
    efforts: [
      { durationSeconds: 184,  averagePower: 241 },
      { durationSeconds: 726,  averagePower: 203 },
      { durationSeconds: 1208, averagePower: 202 },
    ],
    weightKg: 53,
    sex: 'Male',
    powerMeter: 'Stryd Wind',
  },

  // ── Real data — 4-point ──────────────────────────────────────────────────────
  {
    label: 'Real data — Male, 53 kg, Stryd Wind (4-point: adds 5 k on 4 May)',
    efforts: [
      { durationSeconds: 184,  averagePower: 241 },
      { durationSeconds: 726,  averagePower: 203 },
      { durationSeconds: 1208, averagePower: 202 },
      { durationSeconds: 1479, averagePower: 194 },
    ],
    weightKg: 53,
    sex: 'Male',
    powerMeter: 'Stryd Wind',
  },

  // ── Env adjustment parity check ──────────────────────────────────────────────
  // Calibration target (from v4 Calcs): 19 °C/47 % → 27 °C/39 % = 98.23 %
  // Expected adjusted CP ≈ 191.5 W (based on 3-point CP of 194.9 W)
  {
    label: 'Env adj parity — Faris, test 19 °C/47 % → race 27 °C/39 % (expected 98.23 %)',
    efforts: [
      { durationSeconds: 184,  averagePower: 241 },
      { durationSeconds: 726,  averagePower: 203 },
      { durationSeconds: 1208, averagePower: 202 },
    ],
    weightKg: 53,
    sex: 'Male',
    powerMeter: 'Stryd Wind',
    testConditions:   { altitudeM: 70, temperatureC: 19, humidityPercent: 47 },
    targetConditions: { altitudeM: 70, temperatureC: 27, humidityPercent: 39 },
  },
];

// ─── Formatting helpers ───────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const WHITE  = '\x1b[37m';

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function ratingColor(rating: string): string {
  switch (rating) {
    case 'High':   return GREEN + rating + RESET;
    case 'Medium': return YELLOW + rating + RESET;
    case 'Low':    return RED + rating + RESET;
    default:       return DIM + rating + RESET;
  }
}

function r2Color(r2: number): string {
  const formatted = fmt(r2, 4);
  return r2 >= 0.95 ? GREEN + formatted + RESET : RED + formatted + RESET;
}

function divider(char = '─', width = 60): string {
  return DIM + char.repeat(width) + RESET;
}

// ─── Standalone env parity check ─────────────────────────────────────────────
// Runs before the main test cases so any formula regression is immediately obvious.

console.log('\n' + BOLD + CYAN + '  Environmental Adjustment — Parity Checks' + RESET);
console.log(divider('═') + '\n');

const parityChecks = [
  { label: 'Faris  19°C/47% → 27°C/39%', expected: 98.23,
    test: { altitudeM: 70, temperatureC: 19, humidityPercent: 47 },
    target: { altitudeM: 70, temperatureC: 27, humidityPercent: 39 } },
  { label: 'Wendy  28°C/68% → 28°C/60%', expected: 100.56,
    test: { altitudeM: 0, temperatureC: 28, humidityPercent: 68 },
    target: { altitudeM: 0, temperatureC: 28, humidityPercent: 60 } },
];

for (const pc of parityChecks) {
  const adj = calcEnvAdjustment(pc.test, pc.target);
  const match = Math.abs(adj.factorPercent - pc.expected) < 0.01;
  const status = match ? GREEN + '✓ PASS' + RESET : RED + '✗ FAIL' + RESET;
  console.log(
    `  ${status}  ${pc.label.padEnd(34)}` +
    `got ${CYAN}${fmt(adj.factorPercent, 2)}%${RESET}  expected ${DIM}${pc.expected}%${RESET}`,
  );
}
console.log('\n' + divider('═') + '\n');

// ─── Run CP test cases ────────────────────────────────────────────────────────

console.log(BOLD + CYAN + '  CP / W′ Lab Engine — Verification Output' + RESET);
console.log(divider('═') + '\n');

for (const tc of TEST_CASES) {
  console.log(BOLD + WHITE + `  ${tc.label}` + RESET);
  console.log(divider());

  // Echo input table
  console.log(DIM + '  Input efforts:' + RESET);
  console.log(DIM + '  ' + 'Duration (s)'.padEnd(14) + 'Avg Power (W)'.padEnd(16) + 'Work (J)' + RESET);
  for (const e of tc.efforts) {
    const work = (e.averagePower * e.durationSeconds).toLocaleString('en-US');
    console.log(`  ${String(e.durationSeconds).padEnd(14)}${String(e.averagePower).padEnd(16)}${work}`);
  }
  console.log();

  // Run calculation
  let result;
  try {
    result = calculateCP(tc.efforts, tc.weightKg, tc.sex, tc.powerMeter, tc.testConditions, tc.targetConditions);
  } catch (err) {
    console.log(RED + `  ERROR: ${(err as Error).message}` + RESET + '\n');
    continue;
  }

  // Primary outputs
  console.log(BOLD + `  Critical Power (unadj) : ${CYAN}${fmt(result.criticalPowerWatts, 1)} W${RESET}`);
  console.log(
    BOLD + `  W′                    : ${CYAN}${fmt(result.wPrimeKJ, 2)} kJ${RESET}` +
    DIM + `  (${result.wPrimeJoules.toLocaleString('en-US', { maximumFractionDigits: 0 })} J)` + RESET,
  );
  console.log(`  W′ / kg               : ${fmt(result.wPrimePerKg, 1)} J/kg  →  ${ratingColor(result.wPrimeRating)}`);
  console.log(`  R²                    : ${r2Color(result.r2)}`);

  // Environmental adjustment block
  if (result.envAdjustment) {
    const e = result.envAdjustment;
    const sign = e.factorPercent >= 100 ? GREEN : YELLOW;
    console.log();
    console.log(BOLD + `  Env Adjustment        : ${sign}${fmt(e.factorPercent, 2)}%${RESET}`);
    console.log(BOLD + `  Critical Power (adj)  : ${CYAN}${fmt(e.adjustedCriticalPowerWatts, 1)} W${RESET}`);
  }

  console.log();

  // Low-confidence warning block
  if (result.warning) {
    console.log(YELLOW + BOLD + '  ⚠  Low Confidence Warning' + RESET);
    console.log(YELLOW + '  ' + result.warning.message + RESET);
    console.log();
    console.log(DIM + '  Efforts ranked by deviation from regression line:' + RESET);
    console.log(
      DIM + '  ' + 'Rank'.padEnd(6) + 'Duration (s)'.padEnd(14) +
      'Avg Power (W)'.padEnd(16) + 'Residual (J)'.padEnd(16) + 'Residual (%)' + RESET,
    );
    result.warning.suggestedCorrection.forEach((o, rank) => {
      const flag = rank === 0 ? RED + ' ← suggest removing' + RESET : '';
      console.log(
        `  ${String(rank + 1).padEnd(6)}` +
        `${String(o.effort.durationSeconds).padEnd(14)}` +
        `${String(o.effort.averagePower).padEnd(16)}` +
        `${Math.round(o.residualJoules).toLocaleString('en-US').padEnd(16)}` +
        `${fmt(o.residualPercent, 1)}%` + flag,
      );
    });
    console.log();
  }

  console.log(divider('═') + '\n');
}
