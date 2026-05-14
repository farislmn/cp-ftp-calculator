import React, { useState, useMemo, useEffect } from 'react';
import type { ScenarioResult } from '../strategyEngine.js';
import type { ScenarioLabel } from './StrategyDashboard.js';
import { pushPacingPlan } from '../intervalsWorkout.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PacingSplitPlanProps {
  scenario: ScenarioResult;
  scenarioLabel: ScenarioLabel;
  distanceMeters: number;
  weightKg: number;
  cpWatts?: number;
  athleteId?: string;
  apiKey?: string;
}

type SplitType = 'Negative Split' | 'Positive Split' | 'Even Split';

export interface Split {
  /** e.g. "0 – 5 km" */
  label: string;
  /** Start distance of this chunk (meters, for chart position) */
  startM: number;
  /** Chunk distance in meters */
  distM: number;
  /** Target power for this chunk (W) */
  powerW: number;
  /** Estimated time for this chunk (seconds) */
  timeS: number;
  /** Pace in min/km as formatted string "MM:SS/km" */
  pace: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPace(speedMs: number): string {
  const secPerKm = 1000 / speedMs;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}/km`;
}

function fmtTime(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Builds the pacing split table.
 *
 * Pace (s/m) is linearly interpolated at each chunk's midpoint distance,
 * so the sum of split times equals the scenario finish time.
 * (Interpolating power instead causes Σ T_i > T_scenario via harmonic-mean
 * inequality whenever power varies across splits.)
 *
 * pace_avg = W / (P × RE)   — from the RE definition speed = P·RE/W
 * T_chunk  = D_chunk × pace  — time from pace
 * P_chunk  = D_chunk × W / (T_chunk × RE)  — power back-calculated from time
 */
export function buildSplits(
  targetPowerW: number,
  re: number,
  weightKg: number,
  distanceMeters: number,
  splitEveryM: number,
  splitType: SplitType,
  deviationPct: number,
): Split[] {
  const dev = deviationPct / 100;

  // Average pace in s/m derived from the target power and RE.
  const avgPacePerM = weightKg / (targetPowerW * re);

  // Pace factor at start and end of the race.
  // Negative split: start at slower pace (factor > 1), finish faster (factor < 1).
  // Positive split: the reverse.
  let startFactor: number;
  let endFactor: number;

  if (splitType === 'Negative Split') {
    startFactor = 1 + dev / 2;
    endFactor   = 1 - dev / 2;
  } else if (splitType === 'Positive Split') {
    startFactor = 1 - dev / 2;
    endFactor   = 1 + dev / 2;
  } else {
    startFactor = 1;
    endFactor   = 1;
  }

  const splits: Split[] = [];
  let cursor = 0;

  while (cursor < distanceMeters - 0.5) {
    const chunkDist = Math.min(splitEveryM, distanceMeters - cursor);
    const midpoint  = cursor + chunkDist / 2;

    // Linear interpolation of pace factor at chunk midpoint.
    const factor  = startFactor + (endFactor - startFactor) * (midpoint / distanceMeters);
    const timeS   = chunkDist * avgPacePerM * factor;
    const powerW  = (chunkDist * weightKg) / (timeS * re);
    const speedMs = chunkDist / timeS;

    const startKm = (cursor / 1000).toFixed(1);
    const endKm   = ((cursor + chunkDist) / 1000).toFixed(1);

    splits.push({
      label:  `${startKm} – ${endKm} km`,
      startM: cursor,
      distM:  chunkDist,
      powerW,
      timeS,
      pace:   fmtPace(speedMs),
    });

    cursor += chunkDist;
  }

  return splits;
}

// ─── SVG Line Chart ───────────────────────────────────────────────────────────

function PowerChart({ splits, targetPowerW }: { splits: Split[]; targetPowerW: number }) {
  const W = 600;
  const H = 110;
  const PAD = { top: 14, right: 20, bottom: 28, left: 44 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const powers = splits.map((s) => s.powerW);
  const minP = Math.min(...powers) * 0.995;
  const maxP = Math.max(...powers) * 1.005;
  const totalM = splits.reduce((acc, s) => acc + s.distM, 0);

  function xOf(startM: number, distM: number): number {
    return PAD.left + ((startM + distM / 2) / totalM) * innerW;
  }
  function yOf(power: number): number {
    return PAD.top + innerH - ((power - minP) / (maxP - minP)) * innerH;
  }

  const points = splits.map((s) => `${xOf(s.startM, s.distM)},${yOf(s.powerW)}`).join(' ');
  const firstX = xOf(splits[0]!.startM, splits[0]!.distM);
  const lastX  = xOf(splits[splits.length - 1]!.startM, splits[splits.length - 1]!.distM);

  // Area fill path (close to bottom)
  const areaPath =
    `M ${firstX},${PAD.top + innerH}` +
    splits.map((s) => ` L ${xOf(s.startM, s.distM)},${yOf(s.powerW)}`).join('') +
    ` L ${lastX},${PAD.top + innerH} Z`;

  // Target power reference line y
  const targetY = yOf(targetPowerW);

  // Y axis ticks (3 ticks)
  const yTicks = [minP, (minP + maxP) / 2, maxP];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="pacing-chart"
      role="img"
      aria-label="Power progression chart"
    >
      {/* Area fill */}
      <path d={areaPath} fill="var(--accent)" fillOpacity="0.08" />

      {/* Target power reference line */}
      <line
        x1={PAD.left} y1={targetY} x2={PAD.left + innerW} y2={targetY}
        stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" opacity={0.5}
      />
      <text x={PAD.left + innerW + 3} y={targetY + 4} fontSize={9} fill="var(--accent)" opacity={0.7}>
        avg
      </text>

      {/* Power line */}
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Data points */}
      {splits.map((s, i) => (
        <circle
          key={i}
          cx={xOf(s.startM, s.distM)}
          cy={yOf(s.powerW)}
          r={3.5}
          fill="var(--surface)"
          stroke="var(--accent)"
          strokeWidth={1.5}
        />
      ))}

      {/* Y axis ticks */}
      {yTicks.map((p, i) => (
        <g key={i}>
          <line x1={PAD.left - 4} y1={yOf(p)} x2={PAD.left} y2={yOf(p)}
            stroke="var(--border)" strokeWidth={1} />
          <text x={PAD.left - 7} y={yOf(p) + 4} textAnchor="end" fontSize={9} fill="var(--text-muted)">
            {Math.round(p)}
          </text>
        </g>
      ))}

      {/* Axis lines */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH}
        stroke="var(--border)" strokeWidth={1} />
      <line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH}
        stroke="var(--border)" strokeWidth={1} />

      {/* X axis label */}
      <text x={PAD.left + innerW / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
        Distance (km)
      </text>

      {/* Y axis label */}
      <text
        x={10} y={PAD.top + innerH / 2}
        textAnchor="middle" fontSize={9} fill="var(--text-muted)"
        transform={`rotate(-90, 10, ${PAD.top + innerH / 2})`}
      >
        Power (W)
      </text>

      {/* X tick labels — show every other split to avoid crowding */}
      {splits.map((s, i) => {
        if (splits.length > 10 && i % 2 !== 0) return null;
        const x = xOf(s.startM, s.distM);
        const labelKm = (s.startM / 1000).toFixed(0);
        return (
          <text key={i} x={x} y={PAD.top + innerH + 12} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
            {labelKm}
          </text>
        );
      })}
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PacingSplitPlan({
  scenario, scenarioLabel, distanceMeters, weightKg, cpWatts = 0, athleteId = '', apiKey = '',
}: PacingSplitPlanProps) {
  const [splitEveryKm,  setSplitEveryKm]  = useState(5);
  const [splitType,     setSplitType]     = useState<SplitType>('Negative Split');
  const [deviationPct,  setDeviationPct]  = useState(2);
  const [raceDate,      setRaceDate]      = useState('');
  const [pushStatus,    setPushStatus]    = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [pushError,     setPushError]     = useState<string | null>(null);

  // 0 or empty → one interval for the whole distance
  const splitEveryM = useMemo((): number =>
    (!splitEveryKm || splitEveryKm <= 0) ? distanceMeters : splitEveryKm * 1000,
  [splitEveryKm, distanceMeters]);

  const splits = useMemo(() =>
    buildSplits(
      scenario.targetPowerWatts,
      scenario.adjustedRE,
      weightKg,
      distanceMeters,
      splitEveryM,
      splitType,
      deviationPct,
    ),
  [scenario.targetPowerWatts, scenario.adjustedRE, weightKg, distanceMeters, splitEveryM, splitType, deviationPct]);

  // Reset push status whenever the plan changes so a stale success/error banner doesn't mislead.
  useEffect(() => {
    setPushStatus('idle');
    setPushError(null);
  }, [splits]);

  const totalTime = splits.reduce((a, s) => a + s.timeS, 0);

  // Distance-weighted average power — should match scenario.targetPowerWatts
  const avgPower = splits.reduce((a, s) => a + s.powerW * s.distM, 0) / distanceMeters;

  const scenarioColors: Record<ScenarioLabel, string> = {
    AGGRESSIVE:   '#dc2626',
    EXPECTED:     'var(--accent)',
    CONSERVATIVE: '#16a34a',
  };
  const accentColor = scenarioColors[scenarioLabel];

  async function handlePush() {
    setPushStatus('loading');
    setPushError(null);
    try {
      await pushPacingPlan(athleteId, apiKey, raceDate, distanceMeters, totalTime, splits, cpWatts);
      setPushStatus('success');
    } catch (err) {
      setPushStatus('error');
      setPushError((err as Error).message);
    }
  }

  return (
    <section className="card pacing-card">
      <div className="pacing-header">
        <div>
          <h3 className="pacing-title">Pacing Plan</h3>
          <p className="pacing-subtitle" style={{ color: accentColor }}>
            {scenarioLabel} — {Math.round(scenario.targetPowerWatts)} W target
          </p>
        </div>
        <div className="pacing-controls">
          <label className="pacing-control-field">
            <span>Split every (km, 0 = whole)</span>
            <input
              type="number"
              value={splitEveryKm}
              min={0}
              step={1}
              onChange={(e) => setSplitEveryKm(Number(e.target.value))}
            />
          </label>
          <label className="pacing-control-field">
            <span>Split type</span>
            <select value={splitType} onChange={(e) => setSplitType(e.target.value as SplitType)}>
              <option>Negative Split</option>
              <option>Positive Split</option>
              <option>Even Split</option>
            </select>
          </label>
          <label className="pacing-control-field">
            <span>Deviation %</span>
            <input
              type="number"
              value={deviationPct}
              min={0}
              max={10}
              step={0.5}
              onChange={(e) => setDeviationPct(Number(e.target.value))}
            />
          </label>
        </div>
      </div>

      {splits.length > 0 && (
        <>
          <div className="pacing-chart-wrapper">
            <PowerChart splits={splits} targetPowerW={scenario.targetPowerWatts} />
          </div>

          <div className="table-wrapper">
            <table className="effort-table pacing-table">
              <thead>
                <tr>
                  <th>Split</th>
                  <th>Target Power</th>
                  <th>Split Time</th>
                  <th>Target Pace</th>
                </tr>
              </thead>
              <tbody>
                {splits.map((s, i) => (
                  <tr key={i} className="row-off">
                    <td>{s.label}</td>
                    <td>
                      <span className="pacing-power" style={{ color: accentColor }}>
                        {Math.round(s.powerW)} W
                      </span>
                    </td>
                    <td>{fmtTime(s.timeS)}</td>
                    <td>{s.pace}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="pacing-totals">
                  <td><strong>Total</strong></td>
                  <td><strong>~{Math.round(avgPower)} W avg</strong></td>
                  <td><strong>{fmtTime(totalTime)}</strong></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="pacing-footnote">
            Pace interpolated linearly {splitType === 'Even Split' ? '(flat)' : `(${splitType.toLowerCase()}, ±${(deviationPct / 2).toFixed(1)}%)`}
            {' · '}total time = scenario time
            {' · '}RE {scenario.adjustedRE.toFixed(4)}
          </p>

          {/* ── Push to Intervals.icu ─────────────────────────────────────── */}
          <div className="pacing-push-section">
            <label className="pacing-control-field">
              <span>Race Date</span>
              <input
                type="date"
                value={raceDate}
                onChange={(e) => { setRaceDate(e.target.value); setPushStatus('idle'); }}
              />
            </label>
            <button
              className="btn-push"
              disabled={!raceDate || pushStatus === 'loading'}
              onClick={handlePush}
            >
              {pushStatus === 'loading' ? 'Pushing…' : '↑ Push to Intervals.icu'}
            </button>
            {pushStatus === 'success' && (
              <span className="push-status push-status-success">✓ Scheduled on Intervals.icu</span>
            )}
            {pushStatus === 'error' && pushError && (
              <span className="push-status push-status-error">{pushError}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
