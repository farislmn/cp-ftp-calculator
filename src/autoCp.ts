/**
 * Full-pipeline CLI: fetch max efforts → auto-select → calculate CP/W'.
 *
 * Usage:
 *   ATHLETE_ID=iXXXXXX API_KEY=your-key npx tsx src/autoCp.ts
 *
 * Or set the vars inline at the top of this file for quick iteration.
 */

import { fetchMaxEfforts } from './intervalsClient.js';
import { autoSelectGoldilocksEfforts } from './effortSelector.js';
import { calculateCP } from './labEngine.js';
import type { Sex, PowerMeter } from './labEngine.js';

// ── Config ────────────────────────────────────────────────────────────────────
// Override these via environment variables or edit directly:
const ATHLETE_ID  = process.env['ATHLETE_ID']  ?? '';
const API_KEY     = process.env['API_KEY']      ?? '';
const WEIGHT_KG   = Number(process.env['WEIGHT_KG']  ?? 67);
const SEX         = (process.env['SEX']         ?? 'Male')             as Sex;
const POWER_METER = (process.env['POWER_METER'] ?? 'Stryd non-Wind')   as PowerMeter;
const DAYS_BACK   = Number(process.env['DAYS_BACK'] ?? 90);

if (!ATHLETE_ID || !API_KEY) {
  console.error('Set ATHLETE_ID and API_KEY environment variables.');
  process.exit(1);
}

// ── Pipeline ──────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nFetching max efforts for ${ATHLETE_ID} (last ${DAYS_BACK} days)…\n`);

  const result = await fetchMaxEfforts(ATHLETE_ID, API_KEY, DAYS_BACK);

  if ('error' in result) {
    console.error('API error:', result.error);
    process.exit(1);
  }

  const { efforts: allEfforts } = result;
  console.log(`Found ${allEfforts.length} MMP data points.`);

  const selected = autoSelectGoldilocksEfforts(allEfforts);

  console.log('\nAuto-selected efforts (Goldilocks):');
  console.log('─'.repeat(52));
  for (const e of selected) {
    const m   = Math.floor(e.durationSeconds / 60);
    const s   = e.durationSeconds % 60;
    const dur = `${m}:${s.toString().padStart(2, '0')}`;
    const tag = e.isRecent ? ' [recent]' : ' [older]';
    console.log(`  ${dur.padEnd(7)} ${String(e.averagePower).padStart(4)} W  ${e.date}${tag}`);
  }

  const cp = calculateCP(selected, WEIGHT_KG, SEX, POWER_METER);

  console.log('\n' + '═'.repeat(52));
  console.log('  Critical Power  : ' + Math.round(cp.criticalPowerWatts) + ' W');
  console.log('  W′              : ' + cp.wPrimeKJ.toFixed(2) + ' kJ');
  console.log('  W′/kg           : ' + cp.wPrimePerKg.toFixed(1) + ' J/kg  (' + cp.wPrimeRating + ')');
  console.log('  R²              : ' + cp.r2.toFixed(4));
  console.log('═'.repeat(52));

  if (cp.warning) {
    console.log('\n⚠️  ' + cp.warning.message);
    const top = cp.warning.suggestedCorrection[0];
    if (top) {
      const dur = `${Math.floor(top.effort.durationSeconds / 60)}:${String(top.effort.durationSeconds % 60).padStart(2, '0')}`;
      console.log(`   Biggest outlier: ${dur} effort (${top.residualPercent.toFixed(1)}% off predicted)`);
    }
  }
})();
