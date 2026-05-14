import React, { useState, useMemo, useEffect, useRef } from 'react';
import { calculateRaceScenario, calculateCVI } from '../strategyEngine.js';
import type { Athlete, ScenarioResult, RaceScenarioOutput } from '../strategyEngine.js';
import { calcEnvAdjustment } from '../envAdjustment.js';
import type { EnvironmentConditions, EnvAdjustmentResult } from '../envAdjustment.js';
import type { StrategyDataResult } from '../dataOrchestrator.js';
import { PacingSplitPlan } from './PacingSplitPlan.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StrategyDashboardProps {
  cpWatts: number;
  wPrimeJoules: number;
  weightKg: number;
  strategyData: StrategyDataResult | null;
}

type DistancePreset = '5K' | '10K' | 'Half Marathon' | 'Marathon' | 'Custom';
export type ScenarioLabel = 'AGGRESSIVE' | 'EXPECTED' | 'CONSERVATIVE';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_DISTANCES: Record<Exclude<DistancePreset, 'Custom'>, number> = {
  '5K': 5_000,
  '10K': 10_000,
  'Half Marathon': 21_097,
  'Marathon': 42_195,
};

const DEFAULT_TEMP_C = 20;
const DEFAULT_HUMIDITY = 50;
const DEFAULT_RE = 1.0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Computes the middle RE from available training data.
 * middleRE = (longRunRE + intervalRE) / 2 when both exist.
 * Falls back to whichever single source is available, then to DEFAULT_RE.
 */
function resolveBaseRE(data: StrategyDataResult | null): {
  value: number;
  source: 'both' | 'interval' | 'longRun' | 'default';
} {
  const lr = data?.re.longRunRE;
  const iv = data?.re.intervalRE;
  if (lr != null && iv != null) return { value: (lr + iv) / 2, source: 'both' };
  if (iv != null) return { value: iv, source: 'interval' };
  if (lr != null) return { value: lr, source: 'longRun' };
  return { value: DEFAULT_RE, source: 'default' };
}

function classifyTerrain(cvi: number): string {
  if (cvi <= 25) return 'Flat';
  if (cvi <= 75) return 'Slightly Hilly';
  return 'Hilly';
}

function fmtEnvFactor(factorPercent: number): string {
  const delta = factorPercent - 100;
  return `${factorPercent.toFixed(1)}% (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%)`;
}

function fmtPower(w: number): string {
  return Math.round(w).toString();
}

// ─── Pipeline result type ──────────────────────────────────────────────────────

interface PipelineResult {
  envAdj: EnvAdjustmentResult;
  baselineEnv: EnvironmentConditions;
  targetEnv: EnvironmentConditions;
  adjustedCP: number;
  cvi: number;
  baseRE: number;
  reSource: 'both' | 'interval' | 'longRun' | 'default';
  output: RaceScenarioOutput;
  /** Diagonal scenarios sorted by power descending: [Aggressive, Expected, Conservative] */
  orderedTriple: [ScenarioResult, ScenarioResult, ScenarioResult];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StrategyDashboard({ cpWatts, wPrimeJoules, weightKg, strategyData }: StrategyDashboardProps) {

  // ── Input state ──────────────────────────────────────────────────────────────
  const [distancePreset, setDistancePreset] = useState<DistancePreset>('Marathon');
  // Custom distance is stored in km (user-facing) and multiplied to meters for math
  const [customDistanceKm, setCustomDistanceKm] = useState(42.195);
  const [elevationGainM, setElevationGainM] = useState(0);
  const [forecastTempC, setForecastTempC] = useState(DEFAULT_TEMP_C);
  const [forecastHumidity, setForecastHumidity] = useState(DEFAULT_HUMIDITY);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioLabel>('EXPECTED');

  // When strategyData first arrives, sync forecast defaults to test conditions
  const hasInitForecast = useRef(false);
  useEffect(() => {
    if (strategyData && !hasInitForecast.current) {
      hasInitForecast.current = true;
      setForecastTempC(strategyData.environment.temperatureC);
      setForecastHumidity(strategyData.environment.humidityPercent ?? DEFAULT_HUMIDITY);
    }
  }, [strategyData]);

  // ── Derived ───────────────────────────────────────────────────────────────────
  const targetDistanceM =
    distancePreset === 'Custom'
      ? customDistanceKm * 1000
      : PRESET_DISTANCES[distancePreset];

  const displayCVI = useMemo(() => {
    const { cvi } = calculateCVI(targetDistanceM, elevationGainM, elevationGainM);
    return { cvi, label: classifyTerrain(cvi) };
  }, [targetDistanceM, elevationGainM]);

  const pipeline = useMemo((): PipelineResult | null => {
    if (!cpWatts) return null;

    // 1. Baseline conditions (from orchestrator or neutral defaults)
    const baselineEnv: EnvironmentConditions = {
      altitudeM:       strategyData?.environment.altitudeM ?? 0,
      temperatureC:    strategyData?.environment.temperatureC ?? DEFAULT_TEMP_C,
      humidityPercent: strategyData?.environment.humidityPercent ?? DEFAULT_HUMIDITY,
    };

    // 2. Target (race-day forecast) — altitude assumed same as test
    const targetEnv: EnvironmentConditions = {
      altitudeM:       baselineEnv.altitudeM,
      temperatureC:    forecastTempC,
      humidityPercent: forecastHumidity,
    };

    // 3. Environment adjustment factor
    const envAdj = calcEnvAdjustment(baselineEnv, targetEnv);
    const adjustedCP = cpWatts * envAdj.factor;

    // 4. Target course CVI
    const { cvi } = calculateCVI(targetDistanceM, elevationGainM, elevationGainM);

    // 5. middleRE = (longRunRE + intervalRE) / 2 when both available
    const { value: baseRE, source: reSource } = resolveBaseRE(strategyData);

    // 6. Run the strategy engine — scenarios[0/4/8] are the diagonal triple
    const athlete: Athlete = {
      cpWatts, wPrimeJoules, weightKg, baseRE,
      trainingTerrainCVI: strategyData?.trainingTerrainCVI,
    };
    const output = calculateRaceScenario(
      athlete,
      { distanceMeters: targetDistanceM, cvi },
      undefined,
      envAdj.factor,
    );

    // 7. Extract diagonal (Aggressive/Expected/Conservative each paired with their
    //    matching RE tier), then sort by targetPowerWatts descending to guarantee
    //    the label "Aggressive" always maps to the highest-power scenario.
    const diag = [output.scenarios[0]!, output.scenarios[4]!, output.scenarios[8]!];
    diag.sort((a, b) => b.targetPowerWatts - a.targetPowerWatts);
    const orderedTriple: [ScenarioResult, ScenarioResult, ScenarioResult] = [diag[0]!, diag[1]!, diag[2]!];

    return { envAdj, baselineEnv, targetEnv, adjustedCP, cvi, baseRE, reSource, output, orderedTriple };
  }, [cpWatts, wPrimeJoules, weightKg, strategyData, targetDistanceM, elevationGainM, forecastTempC, forecastHumidity]);

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (!cpWatts) {
    return (
      <div className="workbench">
        <section className="card strategy-empty">
          <h2 className="section-label">Strategy Room</h2>
          <p className="msg-info">
            Run a CP calculation in The Lab to unlock race prescriptions.
          </p>
        </section>
      </div>
    );
  }

  const [aggressive, expected, conservative] = pipeline!.orderedTriple;

  const scenarioMap: Record<ScenarioLabel, ScenarioResult> = {
    AGGRESSIVE:   aggressive,
    EXPECTED:     expected,
    CONSERVATIVE: conservative,
  };
  const activeScenario = scenarioMap[selectedScenario];

  const envHasPenalty = Math.abs(pipeline!.envAdj.factor - 1) >= 0.001;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="workbench">

      {/* ── Target Race Inputs ────────────────────────────────────────────────── */}
      <section className="card">
        <h2 className="section-label">Strategy Room — Target Race</h2>

        <div className="config-grid">

          <label className="field field-full">
            <span>Target Distance</span>
            <select
              value={distancePreset}
              onChange={(e) => setDistancePreset(e.target.value as DistancePreset)}
            >
              {(['5K', '10K', 'Half Marathon', 'Marathon', 'Custom'] as DistancePreset[]).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>

          {distancePreset === 'Custom' && (
            <label className="field field-full">
              <span>Custom Distance (km)</span>
              <input
                type="number"
                value={customDistanceKm}
                min={0.1}
                max={200}
                step={0.1}
                onChange={(e) => setCustomDistanceKm(Number(e.target.value))}
              />
            </label>
          )}

          <label className="field">
            <span>Elevation Gain (m)</span>
            <input
              type="number"
              value={elevationGainM}
              min={0}
              max={10_000}
              step={10}
              onChange={(e) => setElevationGainM(Number(e.target.value))}
            />
          </label>

          <div className="field">
            <span>Course Profile</span>
            <div className="derived-field">
              {displayCVI.label}
              <span className="derived-field-sub">CVI {Math.round(displayCVI.cvi)}</span>
            </div>
          </div>

          <label className="field">
            <span>Forecast Temp (°C)</span>
            <input
              type="number"
              value={forecastTempC}
              min={-20}
              max={50}
              step={0.5}
              onChange={(e) => setForecastTempC(Number(e.target.value))}
            />
          </label>

          <label className="field">
            <span>Forecast Humidity (%)</span>
            <input
              type="number"
              value={forecastHumidity}
              min={0}
              max={100}
              step={1}
              onChange={(e) => setForecastHumidity(Number(e.target.value))}
            />
          </label>

        </div>

        <p className="msg-muted" style={{ marginTop: 8 }}>
          {strategyData
            ? `Baseline: ${strategyData.environment.temperatureC.toFixed(1)} °C / ${(strategyData.environment.humidityPercent ?? DEFAULT_HUMIDITY).toFixed(0)}% humidity — from CP test activities.`
            : 'Connect Intervals.icu in The Lab for a personalised baseline.'}
        </p>
      </section>

      {/* ── Prescription Cards ─────────────────────────────────────────────────── */}
      <section className="card prescription-card">
        <div className="prescription-header">
          <h2>Race Prescription</h2>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={showAdvanced}
              onChange={(e) => setShowAdvanced(e.target.checked)}
            />
            Show Advanced Strategy Metrics
          </label>
        </div>

        {envHasPenalty && (
          <div className="env-banner">
            <span className="env-banner-label">Weather Adjustment</span>
            <strong>{fmtEnvFactor(pipeline!.envAdj.factorPercent)}</strong>
            <span className="env-banner-sep">·</span>
            <span>
              CP {Math.round(cpWatts)} W → <strong>{Math.round(pipeline!.adjustedCP)} W</strong>
            </span>
          </div>
        )}

        <p className="prescription-footnote" style={{ marginBottom: 14 }}>
          Click a card to select it for pacing.
        </p>

        <div className="scenario-grid">
          <ScenarioCard
            scenario={aggressive}
            weightKg={weightKg}
            label="AGGRESSIVE"
            subLabel="Best case"
            selected={selectedScenario === 'AGGRESSIVE'}
            isDefault={false}
            onClick={() => setSelectedScenario('AGGRESSIVE')}
          />
          <ScenarioCard
            scenario={expected}
            weightKg={weightKg}
            label="EXPECTED"
            subLabel="Recommended"
            selected={selectedScenario === 'EXPECTED'}
            isDefault={true}
            onClick={() => setSelectedScenario('EXPECTED')}
          />
          <ScenarioCard
            scenario={conservative}
            weightKg={weightKg}
            label="CONSERVATIVE"
            subLabel="Cautious scenario"
            selected={selectedScenario === 'CONSERVATIVE'}
            isDefault={false}
            onClick={() => setSelectedScenario('CONSERVATIVE')}
          />
        </div>

        {!showAdvanced && (
          <p className="prescription-footnote">
            TTE anchor (3000 s)
            {' · '}
            {pipeline!.reSource === 'both'
              ? 'RE = average of long-run & interval data'
              : pipeline!.reSource === 'interval'
                ? 'RE from interval training'
                : pipeline!.reSource === 'longRun'
                  ? 'RE from long run data'
                  : 'Default RE (1.0)'}
          </p>
        )}
      </section>

      {/* ── Pacing Split Plan ─────────────────────────────────────────────────── */}
      <PacingSplitPlan
        scenario={activeScenario}
        scenarioLabel={selectedScenario}
        distanceMeters={targetDistanceM}
        weightKg={weightKg}
      />

      {/* ── Advanced Data Nerd Panel ──────────────────────────────────────────── */}
      {showAdvanced && (
        <section className="card advanced-card">
          <h3>Strategy Metrics</h3>
          <p className="advanced-hint">Underlying model parameters for this prescription.</p>

          <div className="strategy-detail-grid">

            <div className="detail-section">
              <p className="detail-section-title">Environment</p>
              <DetailRow
                label="Test Conditions"
                value={`${pipeline!.baselineEnv.temperatureC.toFixed(1)} °C / ${pipeline!.baselineEnv.humidityPercent.toFixed(0)}% / ${pipeline!.baselineEnv.altitudeM.toFixed(0)} m`}
              />
              <DetailRow
                label="Race Forecast"
                value={`${pipeline!.targetEnv.temperatureC.toFixed(1)} °C / ${pipeline!.targetEnv.humidityPercent.toFixed(0)}% / ${pipeline!.targetEnv.altitudeM.toFixed(0)} m`}
              />
              <DetailRow
                label="Weather Adjustment"
                value={fmtEnvFactor(pipeline!.envAdj.factorPercent)}
                highlight={envHasPenalty}
              />
              <DetailRow label="Unadjusted CP"  value={`${Math.round(cpWatts)} W`} />
              <DetailRow label="Adjusted CP"    value={`${Math.round(pipeline!.adjustedCP)} W`} highlight />
            </div>

            <div className="detail-section">
              <p className="detail-section-title">Running Effectiveness</p>
              <DetailRow
                label="Long Run RE"
                value={strategyData?.re.longRunRE != null
                  ? strategyData.re.longRunRE.toFixed(4)
                  : '—'}
              />
              <DetailRow
                label="Interval RE"
                value={strategyData?.re.intervalRE != null
                  ? strategyData.re.intervalRE.toFixed(4)
                  : '—'}
              />
              <DetailRow
                label="Middle RE (applied)"
                value={`${pipeline!.baseRE.toFixed(4)} (${
                  pipeline!.reSource === 'both'     ? 'avg of both' :
                  pipeline!.reSource === 'interval' ? 'intervals' :
                  pipeline!.reSource === 'longRun'  ? 'long runs' : 'default'
                })`}
                highlight
              />
            </div>

            <div className="detail-section">
              <p className="detail-section-title">Fatigue Model</p>
              <DetailRow
                label="Fatigue Factor (r)"
                value={expected.riegelExponent.toFixed(4)}
              />
              <DetailRow label="Anchor" value="TTE default (3000 s)" />
              <DetailRow label="Event Type" value={pipeline!.output.eventType} />
              <DetailRow
                label="Course CVI"
                value={`${Math.round(pipeline!.cvi)} — ${displayCVI.label}`}
              />
              {pipeline!.output.warning && (
                <p style={{ fontSize: '0.78rem', color: 'var(--warn-text)', marginTop: 8, fontStyle: 'italic' }}>
                  ⚠️ {pipeline!.output.warning}
                </p>
              )}
            </div>

          </div>

          {/* Full 9-scenario matrix */}
          <p className="detail-section-title" style={{ marginTop: 20, marginBottom: 8 }}>
            Full Scenario Matrix
          </p>
          <div className="table-wrapper">
            <table className="effort-table">
              <thead>
                <tr>
                  <th>Riegel \ RE</th>
                  <th>Optimistic RE</th>
                  <th>Expected RE</th>
                  <th>Pessimistic RE</th>
                </tr>
              </thead>
              <tbody>
                {(['Aggressive', 'Expected', 'Conservative'] as const).map((rLabel, ri) => (
                  <tr key={rLabel} className={rLabel === 'Expected' ? 'row-on' : 'row-off'}>
                    <td><strong>{rLabel}</strong></td>
                    {([0, 1, 2] as const).map((ci) => {
                      const sc = pipeline!.output.scenarios[ri * 3 + ci]!;
                      return (
                        <td key={ci}>
                          {sc.formattedTime}
                          <span className="scenario-matrix-pct">
                            {sc.percentCP.toFixed(1)}% CP
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {strategyData?.warnings && strategyData.warnings.length > 0 && (
            <div className="warning-box" role="alert" style={{ marginTop: 14 }}>
              <span className="warning-icon">⚠️</span>
              <div className="warning-body">
                <strong>Data Source Notes</strong>
                {strategyData.warnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            </div>
          )}

        </section>
      )}

    </div>
  );
}

// ─── ScenarioCard ─────────────────────────────────────────────────────────────

interface ScenarioCardProps {
  scenario: ScenarioResult;
  weightKg: number;
  label: string;
  subLabel: string;
  selected: boolean;
  isDefault: boolean;
  onClick: () => void;
}

function ScenarioCard({ scenario, weightKg, label, subLabel, selected, isDefault, onClick }: ScenarioCardProps) {
  const wPerKg = (scenario.targetPowerWatts / weightKg).toFixed(2);
  const cardClass = [
    'scenario-card',
    isDefault ? 'scenario-card-expected' : '',
    selected ? 'scenario-card-selected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClass} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      aria-pressed={selected}
    >
      <div className="scenario-label">
        {label}
        {selected && <span className="scenario-badge scenario-badge-selected">Selected</span>}
        {!selected && isDefault && <span className="scenario-badge">Recommended</span>}
      </div>
      <p className="scenario-sublabel">{subLabel}</p>

      <div className="scenario-time">{scenario.formattedTime}</div>
      <p className="scenario-time-label">Finish Time</p>

      <div className="scenario-stats">
        <div className="scenario-stat">
          <span className="scenario-stat-value">{fmtPower(scenario.targetPowerWatts)}</span>
          <span className="scenario-stat-unit">W</span>
          <span className="scenario-stat-label">Target Power</span>
        </div>
        <div className="scenario-stat">
          <span className="scenario-stat-value">{wPerKg}</span>
          <span className="scenario-stat-unit">W/kg</span>
          <span className="scenario-stat-label">Power/Weight</span>
        </div>
        <div className="scenario-stat">
          <span className="scenario-stat-value">{scenario.percentCP.toFixed(1)}</span>
          <span className="scenario-stat-unit">% CP</span>
          <span className="scenario-stat-label">Intensity</span>
        </div>
      </div>
    </div>
  );
}

// ─── DetailRow ────────────────────────────────────────────────────────────────

interface DetailRowProps {
  label: string;
  value: string;
  highlight?: boolean;
}

function DetailRow({ label, value, highlight = false }: DetailRowProps) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={`detail-value${highlight ? ' detail-value-highlight' : ''}`}>{value}</span>
    </div>
  );
}
