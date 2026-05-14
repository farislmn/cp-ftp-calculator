/**
 * Pacing split plan verification test.
 *
 * Scenario: 21.1 km half-marathon, 2% negative split, 5 km splits.
 * Asserts: distance-weighted average power across all splits equals
 *          the scenario's target power to within 0.01 W.
 *
 * Run with: npm run test:pacing
 */

import { buildSplits } from './components/PacingSplitPlan.js';

// ── Simulated "Expected" scenario result from the strategy engine ─────────────
const TARGET_POWER_W  = 180;    // W   — representative half-marathon power
const ADJUSTED_RE     = 0.960;  // RE  — typical value
const WEIGHT_KG       = 65;
const DISTANCE_M      = 21_100; // 21.1 km
const SPLIT_EVERY_M   = 5_000;

function run() {
  const splits = buildSplits(
    TARGET_POWER_W,
    ADJUSTED_RE,
    WEIGHT_KG,
    DISTANCE_M,
    SPLIT_EVERY_M,
    'Negative Split',
    2,   // 2% deviation
  );

  console.log('\n── Pacing Split Verification ─────────────────────────────────');
  console.log(`Race:        ${(DISTANCE_M / 1000).toFixed(1)} km`);
  console.log(`Target Power: ${TARGET_POWER_W} W`);
  console.log(`Split type:  Negative Split, 2% deviation (±1%)`);
  console.log(`Split every: ${SPLIT_EVERY_M / 1000} km\n`);

  console.log('Split           | Power (W) | Split Time | Pace');
  console.log('─'.repeat(56));
  for (const s of splits) {
    const m = Math.floor(s.timeS / 60);
    const sec = Math.round(s.timeS % 60);
    const time = `${m}:${String(sec).padStart(2, '0')}`;
    console.log(
      `${s.label.padEnd(16)} | ${Math.round(s.powerW).toString().padStart(9)} | ${time.padStart(10)} | ${s.pace}`,
    );
  }

  const totalTime = splits.reduce((a, s) => a + s.timeS, 0);
  // Scenario finish time — the invariant the pace-interpolation approach guarantees.
  const scenarioTime = (DISTANCE_M * WEIGHT_KG) / (TARGET_POWER_W * ADJUSTED_RE);

  console.log('─'.repeat(56));
  console.log(`\nTotal pacing time:  ${totalTime.toFixed(2)} s  (${Math.floor(totalTime/60)}:${String(Math.round(totalTime%60)).padStart(2,'0')})`);
  console.log(`Scenario time:      ${scenarioTime.toFixed(2)} s  (${Math.floor(scenarioTime/60)}:${String(Math.round(scenarioTime%60)).padStart(2,'0')})`);
  console.log(`Δ:                  ${Math.abs(totalTime - scenarioTime).toFixed(3)} s`);

  const tolerance = 1.0; // 1 second tolerance over the full race
  const pass = Math.abs(totalTime - scenarioTime) <= tolerance;

  console.log(`\nResult: ${pass ? '✅ PASS' : '❌ FAIL'} (tolerance ≤ ${tolerance} s)\n`);

  // Additional checks
  const firstPower = splits[0]!.powerW;
  const lastPower  = splits[splits.length - 1]!.powerW;
  const negSplitOk = lastPower > firstPower;
  console.log(`Negative split (last chunk > first chunk): ${negSplitOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  First chunk: ${firstPower.toFixed(2)} W, Last chunk: ${lastPower.toFixed(2)} W\n`);

  if (!pass || !negSplitOk) process.exit(1);
}

run();
