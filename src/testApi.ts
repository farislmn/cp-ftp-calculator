/**
 * Temporary CLI test for the Intervals.icu API bridge.
 * Swap in your real credentials before running:  npm run test:api
 */
import { fetchMaxEfforts, MaxEffort } from './intervalsClient.js';

// ── Swap these before running ──────────────────────────────────────────────
const ATHLETE_ID = 'i170037';           // e.g. 'i123456' from your profile URL
const API_KEY    = '3xmp0g179efgdel6z33nxnw0k'; // Settings → API access in Intervals.icu
// ──────────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? `${m}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

function recencyLabel(e: MaxEffort): string {
  return e.isRecent
    ? GREEN  + 'RECENT     ' + RESET
    : YELLOW + 'HISTORICAL ' + RESET;
}

console.log(`\n${BOLD}${CYAN}  Intervals.icu API Bridge — Test Run${RESET}`);
console.log(DIM + '─'.repeat(60) + RESET);
console.log(`  Athlete : ${BOLD}${ATHLETE_ID}${RESET}`);
console.log(`  Range   : last 90 days\n`);

const result = await fetchMaxEfforts(ATHLETE_ID, API_KEY, 90);

if ('error' in result) {
  console.error(`${RED}${BOLD}  Error: ${result.error}${RESET}\n`);
  process.exit(1);
}

const { efforts } = result as { efforts: MaxEffort[] };
console.log(`${GREEN}  Found ${efforts.length} best efforts${RESET} (${
  efforts.filter((e: MaxEffort) => e.isRecent).length
} recent, ${
  efforts.filter((e: MaxEffort) => !e.isRecent).length
} historical)\n`);

// Top 5 by power
const top5 = [...efforts]
  .sort((a, b) => b.averagePower - a.averagePower)
  .slice(0, 5);

console.log(BOLD + '  Top 5 maximal efforts (by power):' + RESET);
console.log(DIM + '  ' +
  'Duration'.padEnd(10) +
  'Power'.padEnd(10) +
  'Recency'.padEnd(14) +
  'Date'.padEnd(14) +
  'Activity ID' + RESET);
console.log(DIM + '  ' + '─'.repeat(56) + RESET);

for (const e of top5) {
  console.log(
    '  ' +
    fmtDuration(e.durationSeconds).padEnd(10) +
    `${BOLD}${e.averagePower} W${RESET}`.padEnd(18) +
    recencyLabel(e).padEnd(22) +
    e.date.padEnd(14) +
    DIM + e.activityId + RESET,
  );
}

console.log();

// Full table (all durations, sorted by duration)
console.log(BOLD + '  All efforts by duration:' + RESET);
console.log(DIM + '  ' +
  'Duration'.padEnd(10) +
  'Power'.padEnd(10) +
  'Recency'.padEnd(14) +
  'Date'.padEnd(14) +
  'Activity ID' + RESET);
console.log(DIM + '  ' + '─'.repeat(56) + RESET);

for (const e of efforts) {
  console.log(
    '  ' +
    fmtDuration(e.durationSeconds).padEnd(10) +
    `${e.averagePower} W`.padEnd(10) +
    recencyLabel(e).padEnd(22) +
    e.date.padEnd(14) +
    DIM + e.activityId + RESET,
  );
}

console.log();
