import { calculateRaceScenario } from './strategyEngine.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PowerZone {
  id: 'Z1' | 'Z2' | 'SS' | 'Z3' | 'Z4' | 'Z5' | 'Z6' | 'Z7';
  name: string;
  lowerW: number;
  upperW: number | null;  // null = no ceiling (Z7)
  lowerPct: number;
  upperPct: number | null;
  isOverlay?: boolean;
  subZoneNote?: string;
}

export interface IntervalTarget {
  name: string;
  durationLabel: string;
  lowerW: number;
  upperW: number;
  lowerPct: number;
  upperPct: number;
}

export interface SubThresholdBand {
  name: string;
  anchor: string;
  lowerW: number;
  upperW: number;
  lowerPct: number;
  upperPct: number;
}

export interface PowerZoneResult {
  zones: PowerZone[];
  kSeconds: number;
  ssIsRaceDerived: boolean;
  marathonPowerW: number;
  hmPowerW: number;
  tenKPowerW: number;
  intervalTargets: IntervalTarget[];
  subThresholdBands: SubThresholdBand[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round(w: number): number {
  return Math.round(w);
}

function pct(w: number, cp: number): number {
  return Math.round((w / cp) * 100);
}

/**
 * Palladino interval target formula: P = CP + X × (W'/t)
 *
 * X fractions are zone-specific, reverse-engineered from observed %CP targets
 * at k=60s. They scale correctly for any k because the formula divides W' by t.
 *
 * Lower bound: longer duration, X_lower (easier)
 * Upper bound: shorter duration, X_upper (harder)
 *
 * Verified against Palladino screenshots:
 * - Near-Threshold  (420–600s): X_lower = −0.30, X_upper = 0.21  → 97–103% at k=60s
 * - Supra-Threshold (300–360s): X_lower =  0.20, X_upper = 0.50  → 103–110% at k=60s
 * - VO2Max          (150–180s): X_lower =  0.20, X_upper = 0.525 → 107–121% at k=60s
 * - Intensive Max   (60–90s):   X_lower =  0.20, X_upper = 0.42  → 112–142% at k=60s
 * - RWC             (30–45s):   X_lower =  0.20, X_upper = 0.415 → 125–183% at k=60s
 */
function palladinoPower(cp: number, wPrime: number, tSeconds: number, x: number): number {
  return cp + x * (wPrime / tSeconds);
}

interface IntervalSpec {
  name: string;
  durationLabel: string;
  tLong: number;   // seconds — long end (lower power)
  tShort: number;  // seconds — short end (higher power)
  xLower: number;
  xUpper: number;
}

const INTERVAL_SPECS: IntervalSpec[] = [
  { name: 'Near-Threshold',        durationLabel: '7–10 min',    tLong: 600, tShort: 420, xLower: -0.30, xUpper:  0.21  },
  { name: 'Supra-Threshold',       durationLabel: '5–6 min',     tLong: 360, tShort: 300, xLower:  0.20, xUpper:  0.50  },
  { name: 'VO2Max',                durationLabel: '2:30–3:00',   tLong: 180, tShort: 150, xLower:  0.20, xUpper:  0.525 },
  { name: 'Intensive Max Aerobic', durationLabel: '1:00–1:30',   tLong: 90,  tShort: 60,  xLower:  0.20, xUpper:  0.42  },
  { name: 'RWC',                   durationLabel: '0:30–0:45',   tLong: 45,  tShort: 30,  xLower:  0.20, xUpper:  0.415 },
];

// ─── Core calculation ─────────────────────────────────────────────────────────

export function calculatePowerZones(
  cp: number,
  wPrime: number,
  weightKg: number,
): PowerZoneResult {
  const k = wPrime / cp; // W'/CP ratio in seconds

  // ── Race-derived anchor powers (RE=1.0, flat course, no env adjustment) ──────
  // baseRiegel: −0.10 reflects real-world fatigue decay at marathon/HM distances.
  // The bracket default (−0.06) is calibrated for short efforts and gives marathon
  // power ~91% CP, which is too high. −0.10 yields ~85% CP, matching Palladino targets.
  const raceAthlete = { cpWatts: cp, wPrimeJoules: wPrime, weightKg, baseRE: 1.0, tteSeconds: 3000, baseRiegel: -0.10 };

  let marathonPowerW: number;
  let hmPowerW: number;
  let tenKPowerW: number;
  let ssIsRaceDerived = false;

  try {
    const marathon = calculateRaceScenario(raceAthlete, { distanceMeters: 42195, cvi: 0 });
    const hm       = calculateRaceScenario(raceAthlete, { distanceMeters: 21097, cvi: 0 });
    const tenK     = calculateRaceScenario(raceAthlete, { distanceMeters: 10000, cvi: 0 });
    marathonPowerW = round(marathon.scenarios[4].targetPowerWatts);
    hmPowerW       = round(hm.scenarios[4].targetPowerWatts);
    tenKPowerW     = round(tenK.scenarios[4].targetPowerWatts);
    ssIsRaceDerived = true;
  } catch {
    marathonPowerW = round(0.85 * cp);
    hmPowerW       = round(0.90 * cp);
    tenKPowerW     = round(0.97 * cp);
    ssIsRaceDerived = false;
  }

  // ── Zone boundary formulas ───────────────────────────────────────────────────
  const z1Upper  = round(0.80 * cp);
  const z2Upper  = marathonPowerW;   // marathon power = Z2/Z3 boundary
  const z3UpperPct = Math.min(0.99, Math.max(0.95, 1.02 - k * 0.00077));
  const z3Upper  = round(z3UpperPct * cp);
  const z4Upper  = round((2.00 - z3UpperPct) * cp);  // symmetric around CP
  const z5Upper  = round((1 + k / 375) * cp);         // PDC at t = k×3.75s
  const z6Upper  = round((1 + k / 120) * cp);         // PDC at t = k×2.0s
  // Z7 has no upper bound

  // ── Zone table ───────────────────────────────────────────────────────────────
  const zones: PowerZone[] = [
    {
      id: 'Z1',
      name: 'Active Recovery',
      lowerW: 0,
      upperW: z1Upper,
      lowerPct: 0,
      upperPct: 80,
      subZoneNote: 'Z1A 50–65% (post-interval recovery) · Z1B 65–75% (warm-up) · Z1C 75–80% (easy aerobic)',
    },
    {
      id: 'Z2',
      name: 'Aerobic Efficiency',
      lowerW: z1Upper + 1,
      upperW: z2Upper,
      lowerPct: pct(z1Upper + 1, cp),
      upperPct: pct(z2Upper, cp),
    },
    {
      id: 'Z3',
      name: 'Extensive Threshold',
      lowerW: z2Upper + 1,
      upperW: z3Upper,
      lowerPct: pct(z2Upper + 1, cp),
      upperPct: pct(z3Upper, cp),
    },
    {
      id: 'Z4',
      name: 'Intensive Threshold',
      lowerW: z3Upper + 1,
      upperW: z4Upper,
      lowerPct: pct(z3Upper + 1, cp),
      upperPct: pct(z4Upper, cp),
    },
    {
      id: 'Z5',
      name: 'VO2Max',
      lowerW: z4Upper + 1,
      upperW: z5Upper,
      lowerPct: pct(z4Upper + 1, cp),
      upperPct: pct(z5Upper, cp),
    },
    {
      id: 'Z6',
      name: 'Anaerobic Capacity',
      lowerW: z5Upper + 1,
      upperW: z6Upper,
      lowerPct: pct(z5Upper + 1, cp),
      upperPct: pct(z6Upper, cp),
    },
    {
      id: 'Z7',
      name: 'Neuromuscular Power',
      lowerW: z6Upper + 1,
      upperW: null,
      lowerPct: pct(z6Upper + 1, cp),
      upperPct: null,
    },
    {
      id: 'SS',
      name: 'Sweet Spot',
      lowerW: marathonPowerW,
      upperW: hmPowerW,
      lowerPct: pct(marathonPowerW, cp),
      upperPct: pct(hmPowerW, cp),
      isOverlay: true,
    },
  ];

  // ── Output 2: Above-CP interval power targets ─────────────────────────────
  // P = CP + X × (W'/t) with zone-specific X fractions derived from Palladino screenshots
  // lowerW = easier end (longer duration), upperW = harder end (shorter duration)
  const intervalTargets: IntervalTarget[] = INTERVAL_SPECS.map(spec => {
    const lowerW = round(palladinoPower(cp, wPrime, spec.tLong,  spec.xLower));
    const upperW = round(palladinoPower(cp, wPrime, spec.tShort, spec.xUpper));
    return {
      name:         spec.name,
      durationLabel: spec.durationLabel,
      lowerW,
      upperW,
      lowerPct: pct(lowerW, cp),
      upperPct: pct(upperW, cp),
    };
  });

  // ── Output 3: Sub-threshold training bands ────────────────────────────────
  // Based on Palladino Levels Grid (Level 4 column as default)
  // Bands expressed as %CP ranges; also shown in watts
  const subThresholdBands: SubThresholdBand[] = [
    {
      name: 'Sub-Threshold 1',
      anchor: 'near 10–15K race pace',
      lowerW: round(0.96 * cp),
      upperW: round(0.99 * cp),
      lowerPct: 96,
      upperPct: 99,
    },
    {
      name: 'Sub-Threshold 2',
      anchor: 'near half-marathon power',
      lowerW: round(0.92 * cp),
      upperW: round(0.95 * cp),
      lowerPct: 92,
      upperPct: 95,
    },
    {
      name: 'Sub-Threshold 3',
      anchor: 'near 30K race power',
      lowerW: round(0.89 * cp),
      upperW: round(0.92 * cp),
      lowerPct: 89,
      upperPct: 92,
    },
    {
      name: 'Marathon Pace Tempo',
      anchor: 'in long run',
      lowerW: round(0.86 * cp),
      upperW: round(0.89 * cp),
      lowerPct: 86,
      upperPct: 89,
    },
  ];

  return {
    zones,
    kSeconds: Math.round(k * 10) / 10,
    ssIsRaceDerived,
    marathonPowerW,
    hmPowerW,
    tenKPowerW,
    intervalTargets,
    subThresholdBands,
  };
}
