import React, { useState, useEffect, useMemo, useRef } from 'react';
import { syncStrategyData, fetchRecentRaces } from '../dataOrchestrator.js';
import type { StrategyDataResult, RaceRecord } from '../dataOrchestrator.js';
import { calculateRaceScenario, calculateCVI } from '../strategyEngine.js';
import type { ScenarioResult } from '../strategyEngine.js';
import { calcEnvAdjustment } from '../envAdjustment.js';
import type { EnvironmentConditions } from '../envAdjustment.js';
import type { MaxEffort } from '../intervalsClient.js';
import { PacingSplitPlan } from './PacingSplitPlan.js';
import { getRiegelExponent, distMetersToKey, distLabelToKey } from '../riegelLookup.js';
import { getCached, setCached, TTL } from '../cache.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StrategyRoomProps {
  cpWatts: number;
  wPrimeJoules: number;
  weightKg: number;
  athleteId: string;
  apiKey: string;
  selectedEfforts: MaxEffort[];
  testEnvironment?: EnvironmentConditions;
}

type ScenarioLabel = 'Aggressive' | 'Expected' | 'Conservative';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RE = 0.96;

const LS = {
  distLabel:  'ppe_strat_dist_label',
  customKm:   'ppe_strat_custom_km',
  gainM:      'ppe_strat_gain_m',
  lossM:      'ppe_strat_loss_m',
  tempC:      'ppe_strat_temp_c',
  humidity:   'ppe_strat_humidity',
  altitudeM:  'ppe_strat_altitude_m',
} as const;

function lsGet(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
}

const DISTANCE_OPTIONS = [
  { label: '5K',            meters: 5_000  },
  { label: '10K',           meters: 10_000 },
  { label: 'Half Marathon', meters: 21_097 },
  { label: 'Marathon',      meters: 42_195 },
  { label: 'Custom',        meters: null   },
] as const;

type DistanceLabel = (typeof DISTANCE_OPTIONS)[number]['label'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseRaceTime(s: string): number | null {
  const parts = s.trim().split(':').map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return null;
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
}

function fmtTime(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * middleRE = (longRunRE + intervalRE) / 2 when both are available.
 * Falls back to whichever single source exists, then to DEFAULT_RE.
 */
function pickBaseRE(re: StrategyDataResult['re']): number {
  const lr = re.longRunRE;
  const iv = re.intervalRE;
  if (lr != null && iv != null) return (lr + iv) / 2;
  if (iv != null) return iv;
  if (lr != null) return lr;
  return DEFAULT_RE;
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function fmtRaceTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DetailRow({ label, value, highlight = false }: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={`detail-value${highlight ? ' detail-value-highlight' : ''}`}>{value}</span>
    </div>
  );
}

function ScenarioCard({
  scenario,
  weightKg,
  label,
  subLabel,
  isDefault,
  selected,
  onClick,
}: {
  scenario: ScenarioResult;
  weightKg: number;
  label: ScenarioLabel;
  subLabel: string;
  isDefault: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const cardClass = [
    'scenario-card',
    selected ? 'scenario-card-selected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClass}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      aria-pressed={selected}
    >
      <div className="scenario-label">
        {label.toUpperCase()}
        {selected   && <span className="scenario-badge scenario-badge-selected">Selected</span>}
        {!selected && isDefault && <span className="scenario-badge">Your Target</span>}
      </div>
      <div className="scenario-sublabel">{subLabel}</div>

      <div className="scenario-time">{scenario.formattedTime}</div>
      <div className="scenario-time-label">Finish Time</div>

      <div className="scenario-stats">
        <div className="scenario-stat">
          <span className="scenario-stat-value">{Math.round(scenario.targetPowerWatts)}</span>
          <span className="scenario-stat-unit">W</span>
          <span className="scenario-stat-label">Target Power</span>
        </div>
        <div className="scenario-stat">
          <span className="scenario-stat-value">
            {(scenario.targetPowerWatts / weightKg).toFixed(2)}
          </span>
          <span className="scenario-stat-unit">W/kg</span>
          <span className="scenario-stat-label">Power/Weight</span>
        </div>
        <div className="scenario-stat">
          <span className="scenario-stat-value">{scenario.percentCP.toFixed(1)}%</span>
          <span className="scenario-stat-unit">adj CP</span>
          <span className="scenario-stat-label">% of CP</span>
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StrategyRoom({
  cpWatts,
  wPrimeJoules,
  weightKg,
  athleteId,
  apiKey,
  selectedEfforts,
  testEnvironment,
}: StrategyRoomProps) {

  // ── User inputs ─────────────────────────────────────────────────────────────
  const [distanceLabel,       setDistanceLabel]       = useState<DistanceLabel>(() => lsGet(LS.distLabel, 'Marathon') as DistanceLabel);
  // stored in km; multiplied to meters for all physics
  const [customDistanceKm,    setCustomDistanceKm]    = useState(() => Number(lsGet(LS.customKm, '42.195')));
  const [elevationGainM,      setElevationGainM]      = useState(() => Number(lsGet(LS.gainM, '0')));
  const [elevationLossM,      setElevationLossM]      = useState(() => Number(lsGet(LS.lossM, '0')));
  const [forecastTempC,       setForecastTempC]       = useState(() => Number(lsGet(LS.tempC, '20')));
  const [forecastHumidityPct, setForecastHumidityPct] = useState(() => Number(lsGet(LS.humidity, '50')));
  const [forecastAltitudeM,   setForecastAltitudeM]   = useState(() => Number(lsGet(LS.altitudeM, '0')));
  const [showAdvanced,        setShowAdvanced]        = useState(false);
  const [selectedScenario,    setSelectedScenario]    = useState<ScenarioLabel>('Expected');
  // True when the user has explicitly configured weather (or has stored values from a previous session).
  // Prevents the orchestrator sync from overwriting race-day conditions the user set.
  const userSetWeather = useRef<boolean>(
    Boolean(localStorage.getItem(LS.tempC) || localStorage.getItem(LS.humidity) || localStorage.getItem(LS.altitudeM))
  );

  // ── Riegel calibration ──────────────────────────────────────────────────────
  const [showRiegelCalib,    setShowRiegelCalib]    = useState(false);
  const [knownRaceDistKm,    setKnownRaceDistKm]    = useState('');
  const [knownRaceTimeStr,   setKnownRaceTimeStr]   = useState('');
  const [manualRiegel,       setManualRiegel]       = useState<number | null>(null);
  const [autoRiegelSource,   setAutoRiegelSource]   = useState<{ date: string; distKm: number; timeStr: string } | null>(null);
  // userOverrodeRiegel: true once user explicitly selects or clears from the panel.
  // Prevents auto-calibration from overwriting a deliberate choice.
  const userOverrodeRiegel = useRef(false);
  // Race list — fetched on mount (background), not on panel open
  const [raceListLoading,    setRaceListLoading]    = useState(false);
  const [raceList,           setRaceList]           = useState<RaceRecord[]>([]);
  const [raceListError,      setRaceListError]      = useState<string | null>(null);
  const [raceListFetched,    setRaceListFetched]    = useState(false);

  // ── Orchestrator state ──────────────────────────────────────────────────────
  const [syncLoading,  setSyncLoading]  = useState(false);
  const [strategyData, setStrategyData] = useState<StrategyDataResult | null>(null);
  const [syncError,    setSyncError]    = useState<string | null>(null);

  // ── Derived target distance ──────────────────────────────────────────────────
  const targetDistanceM = useMemo<number>(() => {
    if (distanceLabel === 'Custom') return customDistanceKm * 1000;
    return DISTANCE_OPTIONS.find((d) => d.label === distanceLabel)?.meters ?? 42_195;
  }, [distanceLabel, customDistanceKm]);

  // ── Riegel calibration table ────────────────────────────────────────────────
  // Classic two-race Riegel: T₂ = T₁ × (D₂/D₁)^(1/(1+r))
  // Shows predicted finish time at target distance across 10 Riegel exponents.
  const RIEGEL_EXPONENTS = [-0.05, -0.06, -0.07, -0.08, -0.09, -0.10, -0.11, -0.12, -0.13, -0.14];
  const RIEGEL_TYPICAL_MIN = -0.10;
  const RIEGEL_TYPICAL_MAX = -0.07;

  const riegelTable = useMemo(() => {
    const d1 = parseFloat(knownRaceDistKm);
    const t1 = parseRaceTime(knownRaceTimeStr);
    const d2 = targetDistanceM / 1000;
    if (!d1 || !t1 || d1 <= 0 || t1 <= 0) return null;
    if (Math.abs(d1 - d2) < 0.2) return null; // distances too similar to calibrate
    return RIEGEL_EXPONENTS.map((r) => ({
      r,
      t2: t1 * Math.pow(d2 / d1, 1 / (1 + r)),
      typical: r >= RIEGEL_TYPICAL_MIN && r <= RIEGEL_TYPICAL_MAX,
    }));
  }, [knownRaceDistKm, knownRaceTimeStr, targetDistanceM]);

  // ── Sync orchestrator data — cached per athlete + distance (4 h TTL) ─────────
  useEffect(() => {
    if (!athleteId || !apiKey || selectedEfforts.length === 0) return;
    let cancelled = false;

    // Round CP to nearest 10 W so minor fluctuations don't bust the cache.
    const cpBucket = Math.round(cpWatts / 10) * 10;
    const cacheKey = `orch_v1_${athleteId}_${targetDistanceM}_${cpBucket}`;

    const applyData = (data: StrategyDataResult) => {
      setStrategyData(data);
      if (!userSetWeather.current) {
        setForecastTempC(Math.round(data.environment.temperatureC));
        setForecastAltitudeM(Math.round(data.environment.altitudeM));
        if (data.environment.humidityPercent != null) {
          setForecastHumidityPct(Math.round(data.environment.humidityPercent));
        }
      }
    };

    const cached = getCached<StrategyDataResult>(cacheKey);
    if (cached) {
      applyData(cached);
      return;
    }

    setSyncLoading(true);
    setSyncError(null);

    syncStrategyData(
      selectedEfforts, athleteId, apiKey,
      targetDistanceM, cpWatts, weightKg,
    )
      .then((data) => {
        if (cancelled) return;
        setCached(cacheKey, data, TTL.ORCHESTRATOR);
        applyData(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSyncError((err as Error).message);
      })
      .finally(() => { if (!cancelled) setSyncLoading(false); });

    return () => { cancelled = true; };
  }, [cpWatts, weightKg, athleteId, apiKey, selectedEfforts, targetDistanceM]);

  // ── Persist strategy inputs to localStorage on change ──────────────────────
  // skipFirstRender prevents the initial-mount effect from marking weather as
  // user-set when the values were just restored from localStorage defaults.
  const skipFirstWeatherSave = useRef(true);

  useEffect(() => { lsSet(LS.distLabel, distanceLabel); },           [distanceLabel]);
  useEffect(() => { lsSet(LS.customKm,  String(customDistanceKm)); }, [customDistanceKm]);
  useEffect(() => { lsSet(LS.gainM,     String(elevationGainM)); },   [elevationGainM]);
  useEffect(() => { lsSet(LS.lossM,     String(elevationLossM)); },   [elevationLossM]);
  useEffect(() => {
    if (skipFirstWeatherSave.current) return;
    lsSet(LS.tempC, String(forecastTempC));
    userSetWeather.current = true;
  }, [forecastTempC]);
  useEffect(() => {
    if (skipFirstWeatherSave.current) return;
    lsSet(LS.humidity, String(forecastHumidityPct));
    userSetWeather.current = true;
  }, [forecastHumidityPct]);
  useEffect(() => {
    if (skipFirstWeatherSave.current) { skipFirstWeatherSave.current = false; return; }
    lsSet(LS.altitudeM, String(forecastAltitudeM));
    userSetWeather.current = true;
  }, [forecastAltitudeM]);

  // ── Fetch race list on mount — fetchRecentRaces caches internally (24 h TTL) ─
  useEffect(() => {
    if (!athleteId || !apiKey || raceListFetched) return;
    setRaceListLoading(true);
    setRaceListError(null);
    fetchRecentRaces(athleteId, apiKey)
      .then((races) => { setRaceList(races); setRaceListFetched(true); })
      .catch((err: unknown) => setRaceListError((err as Error).message))
      .finally(() => setRaceListLoading(false));
  }, [athleteId, apiKey, raceListFetched]);

  // ── Auto-calibrate Riegel from lookup table once races are available ────────
  useEffect(() => {
    if (!raceListFetched || raceList.length === 0) return;
    if (userOverrodeRiegel.current) return; // user made an explicit choice — don't override

    const targetKey = distLabelToKey(distanceLabel)
      ?? (distanceLabel === 'Custom' ? distMetersToKey(targetDistanceM) : null);
    if (!targetKey) return;

    // Pick the recommended race inline (same scoring as the useMemo below)
    let rec = raceList[0]!;
    let bestScore = Infinity;
    for (const race of raceList) {
      const age = Math.floor((Date.now() - new Date(race.date).getTime()) / 86_400_000);
      const score = (age / 180) * 0.7 + (Math.abs(race.distanceMeters - targetDistanceM) / targetDistanceM) * 0.3;
      if (score < bestScore) { bestScore = score; rec = race; }
    }

    const knownKey = distMetersToKey(rec.distanceMeters);
    if (!knownKey) return;

    const riegel = getRiegelExponent(targetKey, knownKey, rec.movingTimeSeconds);
    if (riegel === null) return;

    setManualRiegel(riegel);
    setAutoRiegelSource({
      date: rec.date,
      distKm: rec.distanceMeters / 1000,
      timeStr: fmtRaceTime(rec.movingTimeSeconds),
    });
  }, [raceListFetched, raceList, distanceLabel, targetDistanceM]);

  // Seed forecast fields from testEnvironment when there's no orchestrator data.
  // Only runs once per testEnvironment change, and only when strategyData is absent.
  useEffect(() => {
    if (!testEnvironment || strategyData || userSetWeather.current) return;
    setForecastTempC(Math.round(testEnvironment.temperatureC));
    setForecastAltitudeM(Math.round(testEnvironment.altitudeM));
    if (testEnvironment.humidityPercent != null) {
      setForecastHumidityPct(Math.round(testEnvironment.humidityPercent));
    }
  }, [testEnvironment, strategyData]);

  // ── Reactive calculation pipeline ──────────────────────────────────────────
  const calcResult = useMemo(() => {
    // Need either orchestrator data OR a manually supplied test environment
    const effectiveEnv = testEnvironment ?? strategyData?.environment ?? null;
    if (!effectiveEnv) return null;

    const baseRE = strategyData ? pickBaseRE(strategyData.re) : DEFAULT_RE;
    const { cvi: targetCVI } = calculateCVI(targetDistanceM, elevationGainM, elevationLossM);

    const testHumidity = effectiveEnv.humidityPercent ?? forecastHumidityPct;
    const testEnv: EnvironmentConditions = {
      altitudeM:       effectiveEnv.altitudeM,
      temperatureC:    effectiveEnv.temperatureC,
      humidityPercent: testHumidity,
    };
    const targetEnv: EnvironmentConditions = {
      altitudeM:       forecastAltitudeM,
      temperatureC:    forecastTempC,
      humidityPercent: forecastHumidityPct,
    };

    const envAdj = calcEnvAdjustment(testEnv, targetEnv);

    // trainingTerrainCVI from the orchestrator drives the RE terrain adjustment.
    // manualRiegel (from the calibration panel) overrides bracket defaults.
    const athleteForCalc = {
      cpWatts, wPrimeJoules, weightKg, baseRE,
      trainingTerrainCVI: strategyData?.trainingTerrainCVI ?? 0,
      ...(manualRiegel !== null && { baseRiegel: manualRiegel }),
    };

    const output = calculateRaceScenario(
      athleteForCalc,
      { distanceMeters: targetDistanceM, cvi: targetCVI },
      undefined,  // Riegel always from manualRiegel or bracket/TTE default
      envAdj.factor,
    );

    // Performer cards: pick diagonal based on race duration vs TTE.
    //
    // For T > TTE (long race), higher r (closer to 0) → higher P → main diagonal:
    //   Aggressive   = scenarios[0] (r+0.01, RE+0.01) → highest P + fastest time
    //   Expected     = scenarios[4] (r,      RE)
    //   Conservative = scenarios[8] (r−0.01, RE−0.01) → lowest P + slowest time
    //
    // For T < TTE (short race, e.g. 5K), the r→P relationship inverts:
    // (T/TTE)^r with T/TTE < 1 and r < 0 → more-negative r → larger value → higher P.
    // Anti-diagonal restores the expected ordering:
    //   Aggressive   = scenarios[6] (r−0.01, RE+0.01) → highest P + fastest time
    //   Expected     = scenarios[4] (r,      RE)
    //   Conservative = scenarios[2] (r+0.01, RE−0.01) → lowest P + slowest time
    const expTime = output.scenarios[4]!.estimatedTimeSeconds;
    const isShortRace = expTime < 3000; // 3000 s = default TTE
    const aggScenario = isShortRace ? output.scenarios[6]! : output.scenarios[0]!;
    const expScenario = output.scenarios[4]!;
    const conScenario = isShortRace ? output.scenarios[2]! : output.scenarios[8]!;

    return { output, baseRE, envAdj, adjustedCP: cpWatts * envAdj.factor, aggScenario, expScenario, conScenario };
  }, [
    strategyData, testEnvironment,
    targetDistanceM, elevationGainM, elevationLossM,
    forecastAltitudeM, forecastTempC, forecastHumidityPct,
    cpWatts, wPrimeJoules, weightKg,
    manualRiegel,
  ]);

  // ── Recommended race for Riegel calibration ────────────────────────────────
  const recommendedRaceId = useMemo(() => {
    if (raceList.length === 0) return null;
    let best = raceList[0]!;
    let bestScore = Infinity;
    for (const race of raceList) {
      const age = daysSince(race.date);
      const recencyScore = age / 180;
      const distScore = Math.abs(race.distanceMeters - targetDistanceM) / targetDistanceM;
      // Recency is primary (70%), distance similarity secondary (30%).
      const score = recencyScore * 0.7 + distScore * 0.3;
      if (score < bestScore) { bestScore = score; best = race; }
    }
    return best.id;
  }, [raceList, targetDistanceM]);

  const handleOpenRiegelPanel = () => {
    setShowRiegelCalib((prev) => !prev);
  };

  const handleSelectRaceForCalib = (race: RaceRecord) => {
    setKnownRaceDistKm((race.distanceMeters / 1000).toFixed(3));
    setKnownRaceTimeStr(fmtRaceTime(race.movingTimeSeconds));
  };

  const handleSelectRiegelRow = (r: number, isSelected: boolean) => {
    userOverrodeRiegel.current = true;
    setAutoRiegelSource(null);
    setManualRiegel(isSelected ? null : r);
  };

  const handleClearRiegel = () => {
    userOverrodeRiegel.current = true;
    setManualRiegel(null);
    setAutoRiegelSource(null);
  };

  const scenarioMap: Record<ScenarioLabel, ScenarioResult | undefined> = {
    Aggressive:   calcResult?.aggScenario,
    Expected:     calcResult?.expScenario,
    Conservative: calcResult?.conScenario,
  };
  const activeScenario = scenarioMap[selectedScenario];

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="workbench">

      {/* ── Race Setup ─────────────────────────────────────────────────────── */}
      <section className="card config-card">
        <h2 className="section-label">Race Setup</h2>
        <div className="config-grid">

          <label className="field">
            <span>Target Distance</span>
            <select
              value={distanceLabel}
              onChange={(e) => setDistanceLabel(e.target.value as DistanceLabel)}
            >
              {DISTANCE_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.label}>{opt.label}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Elevation Gain (m)</span>
            <input
              type="number"
              value={elevationGainM}
              min={0}
              step={10}
              onChange={(e) => setElevationGainM(Number(e.target.value))}
            />
          </label>

          <label className="field">
            <span>Elevation Loss (m)</span>
            <input
              type="number"
              value={elevationLossM}
              min={0}
              step={10}
              onChange={(e) => setElevationLossM(Number(e.target.value))}
            />
          </label>

          {distanceLabel === 'Custom' && (
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
            <span>Race Temperature (°C)</span>
            <input
              type="number"
              value={forecastTempC}
              step={1}
              onChange={(e) => setForecastTempC(Number(e.target.value))}
            />
          </label>

          <label className="field">
            <span>Race Humidity (%)</span>
            <input
              type="number"
              value={forecastHumidityPct}
              min={0}
              max={100}
              step={5}
              onChange={(e) => setForecastHumidityPct(Number(e.target.value))}
            />
          </label>

          <label className="field field-full">
            <span>Race Altitude (m)</span>
            <input
              type="number"
              value={forecastAltitudeM}
              min={0}
              step={50}
              onChange={(e) => setForecastAltitudeM(Number(e.target.value))}
            />
          </label>

        </div>
      </section>

      {/* ── Riegel Calibration ─────────────────────────────────────────────── */}
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="section-label" style={{ marginBottom: 0 }}>
            Riegel Calibration
            {manualRiegel !== null && (
              <span style={{ marginLeft: 8, color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 700 }}>
                r = {manualRiegel.toFixed(2)}
                {autoRiegelSource ? ' · auto' : ' · manual'}
              </span>
            )}
          </h2>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600 }}
            onClick={handleOpenRiegelPanel}
          >
            {showRiegelCalib ? 'Hide ▲' : 'Show ▼'}
          </button>
        </div>

        {showRiegelCalib && (
          <div style={{ marginTop: 16 }}>
            {autoRiegelSource ? (
              <div className="warning-box" style={{ marginBottom: 16 }} role="status">
                <span className="warning-icon">✓</span>
                <div className="warning-body">
                  <p>
                    <strong>Auto-calibrated</strong> from your {autoRiegelSource.date} race
                    ({autoRiegelSource.distKm.toFixed(2)} km · {autoRiegelSource.timeStr}).
                    Select a different race below or pick a Riegel row to override.
                  </p>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                Select a recent race to use as the calibration base, or enter a result manually below.
                Recency is the primary recommendation factor; distance similarity is secondary.
              </p>
            )}

            {/* ── Step 1: Race list from Intervals.icu ── */}
            {raceListLoading && (
              <p className="msg-info" style={{ marginBottom: 12 }}>Loading races from Intervals.icu…</p>
            )}
            {raceListError && (
              <p className="msg-error" style={{ marginBottom: 12 }}>Could not load races: {raceListError}</p>
            )}
            {!raceListLoading && raceListFetched && raceList.length === 0 && (
              <div className="warning-box" style={{ marginBottom: 12 }} role="status">
                <span className="warning-icon">ℹ️</span>
                <div className="warning-body">
                  <p>No races found in Intervals.icu in the last 6 months.</p>
                  <p>Enter a result from Strava, Garmin, Coros, Stryd, or another platform manually below.</p>
                </div>
              </div>
            )}
            {!raceListLoading && raceList.length > 0 && (
              <div className="table-wrapper" style={{ marginBottom: 16 }}>
                <table className="effort-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Distance</th>
                      <th>Finish Time</th>
                      <th>Age</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {raceList.map((race) => {
                      const age = daysSince(race.date);
                      const isRecommended = race.id === recommendedRaceId;
                      const isOutdated = age > 90;
                      const isRecent = age <= 30;
                      return (
                        <tr key={String(race.id)} className="row-off">
                          <td>
                            {race.date}
                            {isRecommended && (
                              <span style={{ marginLeft: 6, fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 700 }}>
                                ★ Recommended
                              </span>
                            )}
                          </td>
                          <td>{(race.distanceMeters / 1000).toFixed(2)} km</td>
                          <td style={{ fontFamily: 'monospace' }}>{fmtRaceTime(race.movingTimeSeconds)}</td>
                          <td style={{ fontSize: '0.78rem' }}>
                            {isRecent
                              ? <span style={{ color: '#16a34a', fontWeight: 600 }}>{age}d ago</span>
                              : isOutdated
                                ? <span style={{ color: '#dc2626' }} title="Over 90 days old — may not reflect current fitness">{age}d ago ⚠️</span>
                                : <span style={{ color: 'var(--text-muted)' }}>{age}d ago</span>}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', fontSize: '0.76rem', cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}
                              onClick={() => handleSelectRaceForCalib(race)}
                            >
                              Use →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Step 2: Manual entry (fallback / override) ── */}
            <div className="config-grid" style={{ marginBottom: 12 }}>
              <label className="field">
                <span>Known Race Distance (km)</span>
                <input
                  type="number"
                  placeholder="e.g. 10.0"
                  min={0.4}
                  step={0.01}
                  value={knownRaceDistKm}
                  onChange={(e) => setKnownRaceDistKm(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Known Race Finish Time</span>
                <input
                  type="text"
                  placeholder="mm:ss or h:mm:ss"
                  value={knownRaceTimeStr}
                  onChange={(e) => setKnownRaceTimeStr(e.target.value)}
                />
              </label>
            </div>

            {/* ── Step 3: Riegel table ── */}
            {riegelTable ? (
              <>
                <div className="table-wrapper">
                  <table className="effort-table">
                    <thead>
                      <tr>
                        <th>Riegel (r)</th>
                        <th>Predicted time at {(targetDistanceM / 1000).toFixed(2)} km</th>
                        <th>Notes</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {riegelTable.map(({ r, t2, typical }) => {
                        const isSelected = manualRiegel === r;
                        return (
                          <tr
                            key={r}
                            className={isSelected ? 'row-on' : 'row-off'}
                            onClick={() => handleSelectRiegelRow(r, isSelected)}
                            title={isSelected ? 'Click to deselect' : 'Click to use this Riegel'}
                          >
                            <td>
                              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: typical ? 'var(--accent)' : 'var(--text)' }}>
                                {r.toFixed(2)}
                              </span>
                            </td>
                            <td style={{ fontWeight: isSelected ? 700 : 400 }}>{fmtTime(t2)}</td>
                            <td style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                              {typical ? '← typical' : ''}
                            </td>
                            <td style={{ textAlign: 'right', fontSize: '0.76rem' }}>
                              {isSelected
                                ? <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✓ Active</span>
                                : <span style={{ color: 'var(--text-muted)' }}>Use →</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {manualRiegel !== null && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px', fontSize: '0.78rem', cursor: 'pointer', color: 'var(--text-muted)' }}
                      onClick={handleClearRiegel}
                    >
                      Clear — revert to TTE default
                    </button>
                  </div>
                )}
                <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic' }}>
                  Hillier / longer course → more negative. Flat / shorter → less negative.
                </p>
              </>
            ) : (
              <p className="msg-muted">
                {knownRaceDistKm && knownRaceTimeStr
                  ? 'Known race and target distance are too similar to calibrate — use a different distance.'
                  : 'Select a race above or enter a distance and finish time to generate the table.'}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── Weather adjustment banner ───────────────────────────────────────── */}
      {calcResult && Math.abs(calcResult.envAdj.factor - 1.0) >= 0.001 && (
        <div className="env-banner">
          <span className="env-banner-label">Weather</span>
          <span className="env-banner-sep">|</span>
          <span>
            {calcResult.envAdj.factor < 1
              ? `${calcResult.envAdj.factorPercent}% — race conditions are harder than your test`
              : `${calcResult.envAdj.factorPercent}% — race conditions are easier than your test`}
          </span>
        </div>
      )}

      {/* ── Prescription cards ──────────────────────────────────────────────── */}
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

        {syncLoading ? (
          <p className="msg-info">Syncing strategy data from Intervals.icu…</p>
        ) : syncError ? (
          <p className="msg-error">Sync failed: {syncError}</p>
        ) : !calcResult ? (
          <p className="msg-muted">Waiting for sync…</p>
        ) : (
          <>
            <p className="prescription-footnote" style={{ marginBottom: 14 }}>
              Click a card to select it for pacing.
            </p>

            <div className="scenario-grid">
              <ScenarioCard
                scenario={calcResult.aggScenario}
                weightKg={weightKg}
                label="Aggressive"
                subLabel="Best case"
                isDefault={false}
                selected={selectedScenario === 'Aggressive'}
                onClick={() => setSelectedScenario('Aggressive')}
              />
              <ScenarioCard
                scenario={calcResult.expScenario}
                weightKg={weightKg}
                label="Expected"
                subLabel="Baseline estimate"
                isDefault={true}
                selected={selectedScenario === 'Expected'}
                onClick={() => setSelectedScenario('Expected')}
              />
              <ScenarioCard
                scenario={calcResult.conScenario}
                weightKg={weightKg}
                label="Conservative"
                subLabel="Conservative case"
                isDefault={false}
                selected={selectedScenario === 'Conservative'}
                onClick={() => setSelectedScenario('Conservative')}
              />
            </div>

            {calcResult.output.warning && (
              <div className="warning-box" role="alert">
                <span className="warning-icon">⚠️</span>
                <div className="warning-body">
                  <p>{calcResult.output.warning}</p>
                </div>
              </div>
            )}

            {manualRiegel === null && (
              <p className="prescription-footnote">
                No Riegel calibration set — using TTE anchor (3000 s). Open Riegel Calibration above to personalise.
              </p>
            )}
          </>
        )}
      </section>

      {/* ── Pacing Split Plan ───────────────────────────────────────────────── */}
      {calcResult && activeScenario && (
        <PacingSplitPlan
          scenario={activeScenario}
          scenarioLabel={
            selectedScenario === 'Aggressive'   ? 'AGGRESSIVE'   :
            selectedScenario === 'Conservative' ? 'CONSERVATIVE' : 'EXPECTED'
          }
          distanceMeters={targetDistanceM}
          weightKg={weightKg}
          cpWatts={cpWatts}
          athleteId={athleteId}
          apiKey={apiKey}
        />
      )}

      {/* ── Advanced strategy panel ─────────────────────────────────────────── */}
      {showAdvanced && calcResult && strategyData && (
        <section className="card advanced-card">
          <h3>Strategy Metrics</h3>
          <div className="strategy-detail-grid">

            <div className="detail-section">
              <div className="detail-section-title">Power Targets</div>
              <DetailRow label="Unadjusted CP"     value={`${Math.round(cpWatts)} W`} />
              <DetailRow label="Adjusted CP"       value={`${Math.round(calcResult.adjustedCP)} W`} highlight />
              <DetailRow label="Weather factor"    value={`${calcResult.envAdj.factorPercent}%`} />
              <DetailRow
                label="Temp Δ"
                value={`${((calcResult.envAdj.components.temperature - 1) * 100).toFixed(2)}%`}
              />
              <DetailRow
                label="Humidity Δ"
                value={`${((calcResult.envAdj.components.humidity - 1) * 100).toFixed(2)}%`}
              />
              <DetailRow
                label="Altitude Δ"
                value={`${((calcResult.envAdj.components.altitude - 1) * 100).toFixed(2)}%`}
              />
            </div>

            <div className="detail-section">
              <div className="detail-section-title">Fatigue Model</div>
              <DetailRow
                label="Riegel exponent"
                value={calcResult.expScenario.riegelExponent.toFixed(4)}
                highlight
              />
              <DetailRow
                label="Riegel source"
                value={
                  autoRiegelSource
                    ? `Auto (${autoRiegelSource.date} · r = ${manualRiegel?.toFixed(2)})`
                    : manualRiegel !== null
                      ? `Manual (r = ${manualRiegel.toFixed(2)})`
                      : 'TTE anchor (3000 s)'
                }
              />
              <DetailRow label="Event type"  value={calcResult.output.eventType} />
              <DetailRow
                label="Distance"
                value={`${(targetDistanceM / 1000).toFixed(2)} km`}
              />
            </div>

            <div className="detail-section">
              <div className="detail-section-title">Running Effectiveness</div>
              <DetailRow
                label="Long run RE"
                value={strategyData.re.longRunRE != null
                  ? strategyData.re.longRunRE.toFixed(4) : 'N/A'}
              />
              <DetailRow
                label="Interval RE"
                value={strategyData.re.intervalRE != null
                  ? strategyData.re.intervalRE.toFixed(4) : 'N/A'}
              />
              <DetailRow
                label="Middle RE (applied)"
                value={calcResult.baseRE.toFixed(4)}
                highlight
              />
              <DetailRow
                label="RE source"
                value={
                  strategyData.re.longRunRE != null && strategyData.re.intervalRE != null
                    ? 'avg of long run & interval'
                    : strategyData.re.intervalRE != null ? 'interval only'
                    : strategyData.re.longRunRE  != null ? 'long run only'
                    : 'default (0.96)'
                }
              />
              <DetailRow
                label="Training terrain CVI"
                value={strategyData.trainingTerrainCVI.toFixed(1)}
              />
            </div>

          </div>

          {strategyData.warnings.length > 0 && (
            <div className="warning-box" role="status" style={{ marginTop: 14 }}>
              <span className="warning-icon">ℹ️</span>
              <div className="warning-body">
                <strong>Data Notes</strong>
                {strategyData.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

    </div>
  );
}
