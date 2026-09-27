import type { MaxEffort } from './intervalsClient.js';
import { DURATION_TOLERANCE_S } from './labEngine.js';

// ─── Test protocols ───────────────────────────────────────────────────────────
// Each protocol auto-selects one effort per bracket: the best match for `target`
// within the inclusive [min, max] window. 3/12 is the default (and the original
// Goldilocks protocol — its brackets must stay 180–300 s / 720–900 s for parity).
// Every bracket is widened by ±DURATION_TOLERANCE_S so near-miss durations
// (e.g. 178 s, 543 s) still qualify.

export type CPProtocolId = '3-12' | '3-20' | '2-9' | 'stryd' | 'palladino';

interface Bracket { target: number; min: number; max: number }

export interface CPProtocol {
  id: CPProtocolId;
  label: string;
  /** Human-readable list of the target durations, e.g. "3- and 12-min". */
  durationsText: string;
  brackets: Bracket[];
}

const B2  : Bracket = { target:  120, min:  120, max:  180 };
const B3  : Bracket = { target:  180, min:  180, max:  300 };
const B9  : Bracket = { target:  540, min:  540, max:  600 };
const B12 : Bracket = { target:  720, min:  720, max:  900 };
const B20 : Bracket = { target: 1200, min: 1200, max: 1500 };

export const CP_PROTOCOLS: CPProtocol[] = [
  { id: '3-12',      label: '3/12',                        durationsText: '3- and 12-min',      brackets: [B3, B12] },
  { id: '3-20',      label: '3/20',                        durationsText: '3- and 20-min',      brackets: [B3, B20] },
  { id: '2-9',       label: '2/9',                         durationsText: '2- and 9-min',       brackets: [B2, B9] },
  { id: 'stryd',     label: 'Stryd Auto CP (2/9/20)',      durationsText: '2-, 9- and 20-min',  brackets: [B2, B9, B20] },
  { id: 'palladino', label: 'Palladino Auto CP (3/12/20)', durationsText: '3-, 12- and 20-min', brackets: [B3, B12, B20] },
];

export const DEFAULT_CP_PROTOCOL: CPProtocolId = '3-12';

/** Returns the protocol for `id`, falling back to the default for unknown ids. */
export const getCPProtocol = (id: string | null | undefined): CPProtocol =>
  CP_PROTOCOLS.find((p) => p.id === id) ?? CP_PROTOCOLS[0]!;

// ─── Public helpers ───────────────────────────────────────────────────────────

/** Stable unique key for an effort; used as React list key and selection key. */
export const effortKey = (e: MaxEffort): string =>
  `${e.durationSeconds}-${e.activityId}`;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Comparator that sorts efforts by:
 *   1. Closest duration to `target` (ascending absolute delta)
 *   2. Highest power — the CP model needs true maximal efforts; a harder effort
 *      from any date beats a weaker recent one
 *   3. Most recent date (tiebreak when power is identical)
 */
function byTargetDurationThenPower(target: number) {
  return (a: MaxEffort, b: MaxEffort): number => {
    const durDelta = Math.abs(a.durationSeconds - target) - Math.abs(b.durationSeconds - target);
    if (durDelta !== 0) return durDelta;
    const powerDelta = b.averagePower - a.averagePower;
    if (powerDelta !== 0) return powerDelta;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  };
}

const fmtMin = (s: number) => `${s / 60}`;

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Selects one effort per bracket of the chosen test protocol (default 3/12).
 *
 * Selection (per bracket):
 *   best match for the target duration within the bracket window
 *   (exact target preferred; ties broken by power then recency)
 *
 * Fallback (any bracket empty):
 *   An empty first bracket is replaced by the absolute shortest effort and an
 *   empty last bracket by the absolute longest, to keep the widest possible
 *   duration spread for the regression. An empty middle bracket is dropped.
 *   Logs a console warning identifying which bracket(s) were missing.
 */
export function autoSelectGoldilocksEfforts(
  allEfforts: MaxEffort[],
  protocolId: CPProtocolId = DEFAULT_CP_PROTOCOL,
): MaxEffort[] {
  const { brackets } = getCPProtocol(protocolId);

  const picks = brackets.map((b) =>
    allEfforts
      .filter((e) =>
        e.durationSeconds >= b.min - DURATION_TOLERANCE_S &&
        e.durationSeconds <= b.max + DURATION_TOLERANCE_S,
      )
      .sort(byTargetDurationThenPower(b.target))[0],
  );

  // Happy path — every bracket has data
  if (picks.every(Boolean)) {
    return picks as MaxEffort[];
  }

  // Fallback — one or more brackets are empty
  const missing = brackets
    .filter((_, i) => !picks[i])
    .map((b) => `${fmtMin(b.min)}–${fmtMin(b.max)} min (target ${b.target} s)`);
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
  const last = brackets.length - 1;
  const result: MaxEffort[] = [];
  const seen = new Set<string>();
  picks.forEach((p, i) => {
    const e = p ?? (i === 0 ? shortest : i === last ? longest : undefined);
    if (e && !seen.has(effortKey(e))) {
      seen.add(effortKey(e));
      result.push(e);
    }
  });
  return result;
}
