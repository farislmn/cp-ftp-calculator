/**
 * CLI test for the Data Orchestrator (Pillar 4).
 * Runs the full sync pipeline and pretty-prints Environment, Prior Race, and RE.
 *
 * Usage:
 *   ATHLETE_ID=iXXXXXX API_KEY=your-key WEIGHT_KG=67 CP_WATTS=194 \
 *     TARGET_RACE_DISTANCE=42195 npx tsx src/testOrchestrator.ts
 *
 * CP_WATTS defaults to 194 W if not supplied — replace with your actual value.
 * TARGET_RACE_DISTANCE is in meters (e.g. 42195 = marathon, 21097 = half).
 */

import { fetchMaxEfforts }             from './intervalsClient.js';
import { autoSelectGoldilocksEfforts } from './effortSelector.js';
import { syncStrategyData }            from './dataOrchestrator.js';

// ── Config ────────────────────────────────────────────────────────────────────
const ATHLETE_ID            = process.env['ATHLETE_ID']            ?? '';
const API_KEY               = process.env['API_KEY']               ?? '';
const WEIGHT_KG             = Number(process.env['WEIGHT_KG']      ?? 67);
const CP_WATTS              = Number(process.env['CP_WATTS']       ?? 194);
const TARGET_RACE_DISTANCE  = process.env['TARGET_RACE_DISTANCE']
  ? Number(process.env['TARGET_RACE_DISTANCE'])
  : null;

if (!ATHLETE_ID || !API_KEY) {
  console.error('Set ATHLETE_ID and API_KEY environment variables.');
  process.exit(1);
}

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const R  = '\x1b[0m';
const B  = '\x1b[1m';
const DIM = '\x1b[2m';
const G  = '\x1b[32m';
const Y  = '\x1b[33m';
const C  = '\x1b[36m';
const M  = '\x1b[35m';
const RED = '\x1b[31m';

function section(title: string) {
  console.log(`\n${B}${C}  ${title}${R}`);
  console.log(DIM + '  ' + '─'.repeat(54) + R);
}

function row(label: string, value: string) {
  console.log(`  ${DIM}${label.padEnd(28)}${R}${value}`);
}

function warn(msg: string) {
  console.log(`  ${Y}⚠  ${msg}${R}`);
}

// ── Pipeline ──────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n${B}${C}  Data Orchestrator — Sync Test${R}`);
  console.log(DIM + '  ' + '═'.repeat(54) + R);
  console.log(`  Athlete  : ${B}${ATHLETE_ID}${R}`);
  console.log(`  CP       : ${B}${CP_WATTS} W${R}`);
  console.log(`  Weight   : ${B}${WEIGHT_KG} kg${R}`);
  console.log(
    `  Target   : ${B}${TARGET_RACE_DISTANCE != null ? `${TARGET_RACE_DISTANCE} m` : 'not set'}${R}`,
  );

  // Step 1 — fetch max efforts (needed to identify the CP test activities)
  console.log(`\n  Fetching max efforts to identify CP test activities…`);
  const effortResult = await fetchMaxEfforts(ATHLETE_ID, API_KEY, 90);
  if ('error' in effortResult) {
    console.error(`${RED}${B}  API error: ${effortResult.error}${R}\n`);
    process.exit(1);
  }

  const selectedEfforts = autoSelectGoldilocksEfforts(effortResult.efforts);
  console.log(`  Selected ${B}${selectedEfforts.length}${R} CP effort(s):`);
  for (const e of selectedEfforts) {
    const m   = Math.floor(e.durationSeconds / 60);
    const s   = e.durationSeconds % 60;
    const dur = `${m}:${String(s).padStart(2, '0')}`;
    console.log(`    ${DIM}${dur.padEnd(7)}${R} ${B}${e.averagePower} W${R}  ${DIM}${e.date}  id:${e.activityId}${R}`);
  }

  // Step 2 — run the full orchestrator
  console.log(`\n  Syncing strategy data (env · race anchor · RE)…`);
  const t0 = Date.now();
  const result = await syncStrategyData(
    selectedEfforts,
    ATHLETE_ID,
    API_KEY,
    TARGET_RACE_DISTANCE,
    CP_WATTS,
    WEIGHT_KG,
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ${G}Done in ${elapsed} s${R}`);

  // ── Environment ───────────────────────────────────────────────────────────────
  section('1 · Environment Context (test conditions)');
  const env = result.environment;
  row('Altitude',    `${B}${env.altitudeM.toFixed(0)} m${R}`);
  row('Temperature', `${B}${env.temperatureC.toFixed(1)} °C${R}`);
  row('Humidity',
    env.humidityPercent != null
      ? `${B}${env.humidityPercent.toFixed(0)} %${R}`
      : `${DIM}not available${R}`,
  );

  // ── Training Terrain CVI ─────────────────────────────────────────────────────
  section('2 · Training Terrain CVI (last 6 weeks)');
  row('Training CVI', `${B}${result.trainingTerrainCVI.toFixed(1)}${R}`);

  // ── Running Effectiveness ─────────────────────────────────────────────────────
  section('3 · Running Effectiveness');
  const re = result.re;
  row('Long Run RE',
    re.longRunRE != null
      ? `${G}${B}${re.longRunRE.toFixed(4)}${R}`
      : `${DIM}not available${R}`,
  );
  row('Interval RE',
    re.intervalRE != null
      ? `${M}${B}${re.intervalRE.toFixed(4)}${R}`
      : `${DIM}not available${R}`,
  );
  if (re.longRunRE != null && re.intervalRE != null) {
    row('Mean RE (suggested baseRE)',
      `${B}${((re.longRunRE + re.intervalRE) / 2).toFixed(4)}${R}`,
    );
  }

  // ── Warnings ──────────────────────────────────────────────────────────────────
  if (result.warnings.length > 0) {
    section('Warnings');
    for (const w of result.warnings) warn(w);
  }

  console.log('\n' + DIM + '  ' + '═'.repeat(54) + R + '\n');
})();
