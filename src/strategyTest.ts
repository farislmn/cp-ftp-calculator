/**
 * Strategy Room — console verification script
 * Run:  npm run test:strategy
 */
import {
  calculateRaceScenario,
  calculateCVI,
  resolveDistanceBracket,
  ScenarioResult,
  RiegelLabel,
  RELabel,
} from './strategyEngine.js';

// ─── Formatting helpers ───────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const WHITE  = '\x1b[37m';
const RED    = '\x1b[31m';

function fmt(n: number, dp = 2): string { return n.toFixed(dp); }

function fmtTime(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function divider(char = '─', width = 72): string {
  return DIM + char.repeat(width) + RESET;
}

// ─── CVI demo ─────────────────────────────────────────────────────────────────

console.log('\n' + BOLD + CYAN + '  CVI Helper — Illustrative Examples' + RESET);
console.log(divider('═') + '\n');

const cviCases = [
  { label: 'Flat marathon   (0 m climb, 0 m descent, 42195 m)',    dist: 42195, climb: 0,   descent: 0 },
  { label: 'Rolling half    (300 m climb, 300 m descent, 21097 m)', dist: 21097, climb: 300, descent: 300 },
  { label: 'Hilly 10 K      (250 m climb, 250 m descent, 10000 m)', dist: 10000, climb: 250, descent: 250 },
];

for (const c of cviCases) {
  const result = calculateCVI(c.dist, c.climb, c.descent);
  console.log(`  ${c.label}`);
  console.log(
    `    CVI    = ${CYAN}${fmt(result.cvi, 1)}${RESET}  ft/mi` +
    `    CVINet = ${CYAN}${fmt(result.cviNet, 1)}${RESET}  ft/mi\n`,
  );
}
console.log(divider('═') + '\n');

// ─── Parity verification against v4 Calcs spreadsheet ────────────────────────
// Test case:
//   CP 191 W, weight 53 kg, TTE 3000 s
//   Env adjustment 98.23 % → adjusted CP 187.62 W
//   Distance 42 400 m, base Riegel −0.10, base RE 0.93 (flat course)
//
// Expected (partial, Expected-RE column only):
//   Riegel −0.09 → 162.4 W  4:07:56 (14876 s)  86.58 %CP
//   Riegel −0.10 → 159.6 W  4:12:23 (15143 s)  85.05 %CP
//   Riegel −0.11 → 156.7 W  4:17:00 (15420 s)  83.52 %CP

console.log(BOLD + CYAN + '  Parity Check — v4 Calcs Spreadsheet (42 400 m, env-adjusted)' + RESET);
console.log(divider('═') + '\n');

const EXPECTED: { riegel: number; power: number; time: number; pctCP: number }[] = [
  { riegel: -0.09, power: 162.4, time: 14876, pctCP: 86.58 },
  { riegel: -0.10, power: 159.6, time: 15143, pctCP: 85.05 },
  { riegel: -0.11, power: 156.7, time: 15420, pctCP: 83.52 },
];

const parityAthlete = {
  cpWatts:      191,
  wPrimeJoules: 10_220,
  weightKg:     53,
  baseRE:       0.93,
  tteSeconds:   3000,
  baseRiegel:  -0.10,
};
const parityRace  = { distanceMeters: 42_400, cvi: 0 };
const ENV_FACTOR  = 0.9823;   // 98.23 %

const parityOut = calculateRaceScenario(parityAthlete, parityRace, undefined, ENV_FACTOR);
const adjustedCP = parityAthlete.cpWatts * ENV_FACTOR;

console.log(`  Adjusted CP   : ${CYAN}${adjustedCP.toFixed(2)} W${RESET}  (${parityAthlete.cpWatts} W × ${ENV_FACTOR})`);
console.log(`  TTE anchor    : ${CYAN}${parityAthlete.tteSeconds} s${RESET}`);
console.log(`  Distance      : ${CYAN}${parityRace.distanceMeters} m${RESET}`);
console.log(`  Base Riegel   : ${CYAN}${parityAthlete.baseRiegel}${RESET}   Base RE : ${CYAN}${parityAthlete.baseRE}${RESET}\n`);

const RIEGEL_ORDER: RiegelLabel[] = ['Aggressive', 'Expected', 'Conservative'];

let allPass = true;

for (const rLabel of RIEGEL_ORDER) {
  const s = parityOut.scenarios.find(s => s.riegelLabel === rLabel && s.reLabel === 'Expected')!;
  const exp = EXPECTED.find(e => Math.abs(e.riegel - s.riegelExponent) < 0.001);

  const dW = exp ? Math.abs(s.targetPowerWatts - exp.power) : NaN;
  const dT = exp ? Math.abs(s.estimatedTimeSeconds - exp.time) : NaN;
  const passW = dW <= 0.2;
  const passT = dT <= 5;
  const tick = (passW && passT) ? GREEN + '✓' + RESET : RED + '✗' + RESET;
  if (!passW || !passT) allPass = false;

  console.log(
    `  ${tick}  r=${fmt(s.riegelExponent, 2)}  RE=${fmt(s.adjustedRE, 2)}` +
    `  Power: ${CYAN}${fmt(s.targetPowerWatts, 1)} W${RESET}` +
    (exp ? `  (exp ${exp.power})  ΔW=${dW.toFixed(2)}` : '') +
    `  Time: ${GREEN}${s.formattedTime}${RESET}` +
    (exp ? `  (exp ${fmtTime(exp.time)})  ΔT=${dT.toFixed(1)} s` : '') +
    `  %CP: ${CYAN}${fmt(s.percentCP, 2)}${RESET}` +
    (exp ? `  (exp ${exp.pctCP})` : ''),
  );
}

console.log('\n  ' + (allPass
  ? GREEN + BOLD + '✓ ALL PARITY CHECKS PASSED' + RESET
  : RED  + BOLD + '✗ PARITY FAILURE — review deltas above' + RESET));
console.log('\n' + divider('═') + '\n');

// ─── Full 3×3 grid ────────────────────────────────────────────────────────────

console.log(BOLD + CYAN + '  Full 3×3 Scenario Bracket (Riegel × RE)' + RESET);
console.log(divider('═') + '\n');

const RE_ORDER: RELabel[] = ['Optimistic', 'Expected', 'Pessimistic'];
const COL_W = 24;
const PAD   = ''.padEnd(16);

function printGrid(scenarios: ScenarioResult[]): void {
  const headerLine = '  ' + PAD +
    BOLD + 'Optimistic'.padEnd(COL_W) +
    'Expected'.padEnd(COL_W) +
    'Pessimistic'.padEnd(COL_W) + RESET;
  console.log(headerLine);
  console.log(divider());

  for (const riegelLabel of RIEGEL_ORDER) {
    const row = RE_ORDER.map(reLabel =>
      scenarios.find(s => s.riegelLabel === riegelLabel && s.reLabel === reLabel)!,
    );

    const powerLine =
      `  ${BOLD}${riegelLabel.padEnd(16)}${RESET}` +
      row.map(s => CYAN + `${fmt(s.targetPowerWatts, 1)} W  (RE ${fmt(s.adjustedRE, 2)})`.padEnd(COL_W) + RESET).join('');
    console.log(powerLine);

    const timeLine =
      '  ' + PAD +
      row.map(s => GREEN + `${s.formattedTime}`.padEnd(COL_W) + RESET).join('');
    console.log(timeLine);

    const pctLine =
      '  ' + PAD +
      row.map(s => DIM + `${fmt(s.percentCP, 2)} %CP  r=${fmt(s.riegelExponent, 2)}`.padEnd(COL_W) + RESET).join('');
    console.log(pctLine + '\n');
  }
}

printGrid(parityOut.scenarios);
console.log(divider('═') + '\n');

// ─── Distance bracket test ────────────────────────────────────────────────────

console.log(BOLD + CYAN + '  Distance Bracket Test — 42 600 m vs 42 195 m' + RESET);
console.log(divider('═') + '\n');

const longRace = { distanceMeters: 42_600, cvi: 0 };
const stdRace  = { distanceMeters: 42_195, cvi: 0 };
const { eventType: eventTypeLong, outOfBounds } = resolveDistanceBracket(longRace.distanceMeters);

console.log(`  42 600 m bracket: ${CYAN}${eventTypeLong}${RESET}  ${outOfBounds ? YELLOW + '(out of bounds)' + RESET : DIM + '(within Marathon bracket)' + RESET}\n`);

const outputLong = calculateRaceScenario(parityAthlete, longRace, undefined, ENV_FACTOR);
const outputStd  = calculateRaceScenario(parityAthlete, stdRace,  undefined, ENV_FACTOR);
const baseLong = outputLong.scenarios.find(s => s.riegelLabel === 'Expected' && s.reLabel === 'Expected')!;
const baseStd  = outputStd.scenarios.find( s => s.riegelLabel === 'Expected' && s.reLabel === 'Expected')!;
const deltaT   = baseLong.estimatedTimeSeconds - baseStd.estimatedTimeSeconds;

console.log(`  ${'Distance'.padEnd(12)} ${'Event'.padEnd(16)} ${'Power'.padEnd(10)} ${'Time'.padEnd(12)} %CP`);
console.log(divider());
for (const [label, d, s] of [['Standard', 42_195, baseStd], ['Long', 42_600, baseLong]] as const) {
  console.log(
    `  ${label.padEnd(12)}${(d / 1000).toFixed(3)} km    ` +
    `${CYAN}${fmt(s.targetPowerWatts, 1).padEnd(10)}${RESET}` +
    `${GREEN}${s.formattedTime.padEnd(12)}${RESET}` +
    `${DIM}${fmt(s.percentCP, 2)} %CP${RESET}`,
  );
}
console.log();
const verdict = deltaT > 0
  ? GREEN + '✓ PASS  42 600 m is slower than 42 195 m' + RESET
  : YELLOW + '✗ FAIL  Expected longer time for longer distance' + RESET;
console.log(`  Δ time : ${CYAN}+${fmt(deltaT, 1)} s  (${fmt(deltaT / 60, 2)} min)${RESET}`);
console.log(`  ${verdict}`);
console.log('\n' + divider('═') + '\n');

// ─── Out-of-bounds warning ────────────────────────────────────────────────────

console.log(BOLD + CYAN + '  Out-of-Bounds Warning Demo — 30 000 m' + RESET);
console.log(divider('═') + '\n');

const outputOOB = calculateRaceScenario(parityAthlete, { distanceMeters: 30_000, cvi: 0 }, undefined, ENV_FACTOR);
if (outputOOB.warning) console.log(YELLOW + `  ⚠  ${outputOOB.warning}` + RESET);
const baseOOB = outputOOB.scenarios.find(s => s.riegelLabel === 'Expected' && s.reLabel === 'Expected')!;
console.log(`\n  Event type   : ${CYAN}${outputOOB.eventType}${RESET}`);
console.log(`  Target power : ${CYAN}${fmt(baseOOB.targetPowerWatts, 1)} W${RESET}`);
console.log(`  Finish time  : ${GREEN}${baseOOB.formattedTime}${RESET}`);
console.log(`  %%CP          : ${CYAN}${fmt(baseOOB.percentCP, 2)}${RESET}`);
console.log('\n' + divider('═') + '\n');
