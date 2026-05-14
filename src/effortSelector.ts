import type { MaxEffort } from './intervalsClient.js';

// ─── Target durations & bracket bounds ───────────────────────────────────────
// The default CP protocol uses exactly 2 points:
//   Point 1 — the classic 3-min (180 s) effort, searched within 180–300 s
//   Point 2 — the classic 12-min (720 s) effort, searched within 720–900 s

const SHORT_TARGET  = 180;  const SHORT_MIN  = 180;  const SHORT_MAX  = 300;
const MEDIUM_TARGET = 720;  const MEDIUM_MIN = 720;  const MEDIUM_MAX = 900;

// ─── Public helpers ───────────────────────────────────────────────────────────

/** Stable unique key for an effort; used as React list key and selection key. */
export const effortKey = (e: MaxEffort): string =>
  `${e.durationSeconds}-${e.activityId}`;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Comparator that sorts efforts by:
 *   1. Closest duration to `target` (ascending absolute delta)
 *   2. Most recent date
 *   3. Highest power (tiebreak)
 *
 * This means an exactly-180 s effort always sorts above a 181 s one, and
 * among exact matches the newest activity wins.
 */
function byTargetDurationThenRecency(target: number) {
  return (a: MaxEffort, b: MaxEffort): number => {
    const durDelta = Math.abs(a.durationSeconds - target) - Math.abs(b.durationSeconds - target);
    if (durDelta !== 0) return durDelta;
    const dateDelta = new Date(b.date).getTime() - new Date(a.date).getTime();
    if (dateDelta !== 0) return dateDelta;
    return b.averagePower - a.averagePower;
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Selects exactly 2 efforts for the default "blackbox" CP calculation, targeting
 * the classic 3-min / 12-min testing protocol.
 *
 * Selection:
 *   Point 1 — best match for 180 s within the 180–300 s bracket
 *             (exact 180 s preferred; ties broken by recency then power)
 *   Point 2 — best match for 720 s within the 720–900 s bracket
 *             (exact 720 s preferred; ties broken by recency then power)
 *
 * Fallback (either bracket empty):
 *   Uses the absolute shortest and absolute longest efforts in the full history
 *   to guarantee the widest possible duration spread for the 2-point regression.
 *   Logs a console warning identifying which bracket(s) were missing.
 */
export function autoSelectGoldilocksEfforts(allEfforts: MaxEffort[]): MaxEffort[] {
  const shortBracket  = allEfforts.filter(
    (e) => e.durationSeconds >= SHORT_MIN  && e.durationSeconds <= SHORT_MAX,
  );
  const mediumBracket = allEfforts.filter(
    (e) => e.durationSeconds >= MEDIUM_MIN && e.durationSeconds <= MEDIUM_MAX,
  );

  const shortPick  = [...shortBracket].sort(byTargetDurationThenRecency(SHORT_TARGET))[0];
  const mediumPick = [...mediumBracket].sort(byTargetDurationThenRecency(MEDIUM_TARGET))[0];

  // Happy path — both brackets have data
  if (shortPick && mediumPick) {
    return [shortPick, mediumPick];
  }

  // Fallback — one or both brackets are empty
  const missing: string[] = [];
  if (!shortPick)  missing.push('short (3–5 min, target 180 s)');
  if (!mediumPick) missing.push('medium (12–15 min, target 720 s)');
  console.warn(
    `[autoSelectGoldilocksEfforts] No data in bracket(s): ${missing.join(', ')}. ` +
    'Falling back to absolute shortest + longest efforts for maximum regression spread.',
  );

  const byDuration = [...allEfforts].sort((a, b) => a.durationSeconds - b.durationSeconds);
  const shortest   = byDuration[0];
  const longest    = byDuration[byDuration.length - 1];

  if (!shortest || !longest || effortKey(shortest) === effortKey(longest)) {
    // Only 0 or 1 distinct efforts — can't form a 2-point regression
    console.warn('[autoSelectGoldilocksEfforts] Not enough distinct efforts for a 2-point regression.');
    return shortest ? [shortest] : [];
  }

  // Substitute the bracket pick where available, fallback otherwise
  return [
    shortPick  ?? shortest,
    mediumPick ?? longest,
  ];
}
