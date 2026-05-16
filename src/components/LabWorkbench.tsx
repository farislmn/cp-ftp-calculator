import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { calculateCP } from '../labEngine.js';
import type { Sex, PowerMeter, CPResult, EnvironmentConditions } from '../labEngine.js';
import { fetchMaxEfforts } from '../intervalsClient.js';
import type { MaxEffort } from '../intervalsClient.js';
import { autoSelectGoldilocksEfforts, effortKey } from '../effortSelector.js';
import type { User } from '../supabaseClient.js';
import { initiateIntervalsOAuth } from './AuthSection.js';
import { getCached, clearCached } from '../cache.js';

export interface LabContext {
  cpWatts: number;
  wPrimeJoules: number;
  weightKg: number;
  athleteId: string;
  apiKey: string;
  selectedEfforts: MaxEffort[];
  testEnvironment?: EnvironmentConditions;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LS_WEIGHT         = 'ppe_lab_weight';
const LS_SEX            = 'ppe_lab_sex';
const LS_METER          = 'ppe_lab_power_meter';
const LS_LAST_SAVED     = 'ppe_lab_last_saved';
const LS_CP_SOURCE      = 'ppe_lab_cp_source';
const LS_MANUAL_POINTS  = 'ppe_lab_manual_points';
const LS_MANUAL_ENV     = 'ppe_lab_manual_env';

const lsSelKeys = (id: string) => `ppe_lab_sel_${id}`;

function lsGet(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

interface LastSaved { cpWatts: number; wPrimeKJ: number; date: string }

interface ManualPoint {
  id: string;
  durationInput: string;
  powerInput: string;
}

const DEFAULT_MANUAL_POINTS: ManualPoint[] = [
  { id: '1', durationInput: '', powerInput: '' },
  { id: '2', durationInput: '', powerInput: '' },
];

const DEFAULT_MANUAL_ENV: EnvironmentConditions = {
  temperatureC: 20,
  altitudeM: 0,
  humidityPercent: 50,
};

const POWER_METERS: PowerMeter[] = [
  'Stryd Wind',
  'Stryd non-Wind',
  'Others (Garmin/Coros-based power, etc)',
];

const RATING_COLOR: Record<string, string> = {
  Low:    '#ef4444',
  Medium: '#22c55e',
  High:   '#8b5cf6',
  'N/A':  '#94a3b8',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function IntervalsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect width="24" height="24" rx="4" fill="#E8521A"/>
      <path d="M6 17l4-10 4 10M8.5 13h3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M16 7v10" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function fmtDuration(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Parses "mm:ss" or a plain number (seconds). Returns null on invalid input.
function parseManualDuration(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    if (parts.length === 2 && !parts.some(isNaN) && parts[1] < 60) {
      return parts[0]! * 60 + parts[1]!;
    }
    return null;
  }
  const n = Number(s);
  return isNaN(n) || n <= 0 ? null : n;
}

// ─── PowerDurationCurve ───────────────────────────────────────────────────────

const LANDMARKS = [
  { t: 60,   label: '1m'  },
  { t: 180,  label: '3m'  },
  { t: 300,  label: '5m'  },
  { t: 1200, label: '20m' },
  { t: 2400, label: '40m' },
  { t: 3600, label: '1h'  },
];

function PowerDurationCurve({
  cpWatts,
  wPrimeJoules,
  effortPoints,
}: {
  cpWatts: number;
  wPrimeJoules: number;
  effortPoints: { durationSeconds: number; averagePower: number }[];
}) {
  // SVG layout
  const W = 580, H = 240;
  const padL = 58, padR = 28, padT = 28, padB = 46;
  const cW = W - padL - padR;
  const cH = H - padT - padB;
  const axisY = padT + cH;

  // X scale: log from 60 → 3600
  const logMin = Math.log(60);
  const logMax = Math.log(3600);
  const xOf = (t: number) =>
    padL + ((Math.log(Math.max(60, Math.min(3600, t))) - logMin) / (logMax - logMin)) * cW;

  // Y scale: linear, auto-ranged
  const pAt60 = cpWatts + wPrimeJoules / 60;
  const rawYMin = cpWatts * 0.9;
  const rawYMax = pAt60 * 1.06;
  const yStep = Math.ceil((rawYMax - rawYMin) / 4 / 10) * 10;
  const yMin = Math.floor(rawYMin / yStep) * yStep;
  const yMax = yMin + yStep * 5;
  const yOf = (p: number) => axisY - ((p - yMin) / (yMax - yMin)) * cH;

  // Curve path (150 log-spaced points)
  const curvePath = Array.from({ length: 150 }, (_, i) => {
    const t = Math.exp(logMin + (i / 149) * (logMax - logMin));
    return `${xOf(t).toFixed(1)},${yOf(cpWatts + wPrimeJoules / t).toFixed(1)}`;
  }).join(' ');

  // Y-axis gridlines (5 lines)
  const yGrids = Array.from({ length: 5 }, (_, i) => yMin + i * yStep);

  // Landmark points — suppress the predicted-watts label if an actual effort
  // is within 15 % of this landmark's duration (the effort dot's label takes over)
  const validEfforts = effortPoints.filter(
    e => e.durationSeconds >= 60 && e.durationSeconds <= 3600
  );
  const landmarkPts = LANDMARKS.map(({ t, label }) => {
    const nearby = validEfforts.some(
      e => Math.abs(e.durationSeconds - t) / t < 0.15
    );
    return {
      t, label,
      x: xOf(t),
      y: yOf(cpWatts + wPrimeJoules / t),
      watts: Math.round(cpWatts + wPrimeJoules / t),
      showWatts: !nearby,
    };
  });

  return (
    <div className="pd-curve-wrapper">
      <h3 className="pd-curve-title">Power–Duration Curve</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="pd-curve-svg" aria-label="Power-duration curve">

        {/* Y gridlines + labels */}
        {yGrids.map((yVal) => {
          const y = yOf(yVal);
          return (
            <g key={yVal}>
              <line x1={padL} y1={y} x2={padL + cW} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{yVal}</text>
            </g>
          );
        })}

        {/* CP asymptote */}
        <line
          x1={padL} y1={yOf(cpWatts)} x2={padL + cW} y2={yOf(cpWatts)}
          stroke="#cbd5e1" strokeWidth="1" strokeDasharray="5,4"
        />
        <text x={padL + cW + 4} y={yOf(cpWatts) + 4} fontSize="9" fill="#94a3b8" textAnchor="start">CP</text>

        {/* Axes */}
        <line x1={padL} y1={padT} x2={padL} y2={axisY} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={padL} y1={axisY} x2={padL + cW} y2={axisY} stroke="#cbd5e1" strokeWidth="1" />

        {/* Curve */}
        <polyline points={curvePath} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" />

        {/* Landmark markers — dot on curve + tick + duration label + predicted watts (if no effort nearby) */}
        {landmarkPts.map(({ t, label, x, y, watts, showWatts }) => (
          <g key={t}>
            <circle cx={x} cy={y} r="3" fill="#3b82f6" />
            <line x1={x} y1={axisY} x2={x} y2={axisY + 5} stroke="#94a3b8" strokeWidth="1" />
            <text x={x} y={axisY + 16} textAnchor="middle" fontSize="10" fill="#64748b">{label}</text>
            {showWatts && (
              <text x={x} y={y - 8} textAnchor="middle" fontSize="10" fontWeight="600" fill="#1e40af">
                {watts} W
              </text>
            )}
          </g>
        ))}

        {/* Effort dots — actual watt value above each dot (rendered last so they sit on top) */}
        {validEfforts.map((e, i) => {
          const ex = xOf(e.durationSeconds);
          const ey = yOf(e.averagePower);
          return (
            <g key={i}>
              <rect x={ex - 24} y={ey - 25} width={48} height={16} rx="3" fill="#fff" fillOpacity="0.9" />
              <text x={ex} y={ey - 13} textAnchor="middle" fontSize="11" fontWeight="700" fill="#0f172a">
                {e.averagePower} W
              </text>
              <circle cx={ex} cy={ey} r="5" fill="#0f172a" stroke="#fff" strokeWidth="1.5" />
            </g>
          );
        })}

        {/* Y-axis label */}
        <text
          x={12} y={padT + cH / 2}
          textAnchor="middle" fontSize="10" fill="#94a3b8"
          transform={`rotate(-90, 12, ${padT + cH / 2})`}
        >Watts</text>
      </svg>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface LabWorkbenchProps {
  onLabUpdate?: (ctx: LabContext | null) => void;
  user?: User | null;
  initialAthleteId?: string;
  initialApiKey?: string;
  initialAthleteName?: string;
  onSaveToJournal?: (result: CPResult, efforts: MaxEffort[]) => Promise<void>;
  onDisconnectIntervals?: () => void;
}

export function LabWorkbench({
  onLabUpdate,
  user,
  initialAthleteId,
  initialApiKey,
  initialAthleteName,
  onSaveToJournal,
  onDisconnectIntervals,
}: LabWorkbenchProps = {}) {

  // ── Config state ─────────────────────────────────────────────────────────────
  const [athleteId,      setAthleteId]      = useState(initialAthleteId ?? '');
  const [apiKey,         setApiKey]         = useState(initialApiKey ?? '');
  const [athleteName,    setAthleteName]    = useState(initialAthleteName ?? '');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [weightKg,   setWeightKg]   = useState<number>(() => Number(lsGet(LS_WEIGHT, '70')));
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [sex,        setSex]        = useState<Sex>(() => lsGet(LS_SEX, 'Male') as Sex);
  const [powerMeter, setPowerMeter] = useState<PowerMeter>(() => lsGet(LS_METER, 'Stryd non-Wind') as PowerMeter);
  const [lastSaved,  setLastSaved]  = useState<LastSaved | null>(() => {
    try {
      const raw = localStorage.getItem(LS_LAST_SAVED);
      return raw ? (JSON.parse(raw) as LastSaved) : null;
    } catch { return null; }
  });

  // ── CP data source ────────────────────────────────────────────────────────────
  const [cpDataSource, setCpDataSource] = useState<'intervals' | 'manual'>(
    () => lsGet(LS_CP_SOURCE, 'intervals') as 'intervals' | 'manual'
  );
  const [manualSubmitted, setManualSubmitted] = useState(false);

  // ── Manual entry state ────────────────────────────────────────────────────────
  const [manualPoints, setManualPoints] = useState<ManualPoint[]>(() => {
    try {
      const raw = localStorage.getItem(LS_MANUAL_POINTS);
      return raw ? (JSON.parse(raw) as ManualPoint[]) : DEFAULT_MANUAL_POINTS;
    } catch { return DEFAULT_MANUAL_POINTS; }
  });

  const [manualTestEnv, setManualTestEnv] = useState<EnvironmentConditions>(() => {
    try {
      const raw = localStorage.getItem(LS_MANUAL_ENV);
      return raw ? (JSON.parse(raw) as EnvironmentConditions) : DEFAULT_MANUAL_ENV;
    } catch { return DEFAULT_MANUAL_ENV; }
  });

  // ── Intervals data state ──────────────────────────────────────────────────────
  const [loading,      setLoading]      = useState(false);
  const [fetchError,   setFetchError]   = useState<string | null>(null);
  const [allEfforts,   setAllEfforts]   = useState<MaxEffort[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hasData,      setHasData]      = useState(false);

  // ── Manual effort handlers ────────────────────────────────────────────────────
  const nextId = useRef(100);

  const updateManualPoint = useCallback((id: string, field: keyof Omit<ManualPoint, 'id'>, value: string) => {
    setManualPoints(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }, []);

  const addManualPoint = useCallback(() => {
    setManualPoints(prev => [...prev, { id: String(nextId.current++), durationInput: '', powerInput: '' }]);
  }, []);

  const removeManualPoint = useCallback((id: string) => {
    setManualPoints(prev => prev.filter(p => p.id !== id));
  }, []);

  // ── Derived manual efforts ────────────────────────────────────────────────────
  const manualEfforts = useMemo(() =>
    manualPoints
      .map(p => ({
        durationSeconds: parseManualDuration(p.durationInput) ?? 0,
        averagePower: Number(p.powerInput) || 0,
      }))
      .filter(e => e.durationSeconds > 0 && e.averagePower > 0),
    [manualPoints]
  );

  // ── Fetch handler ─────────────────────────────────────────────────────────────
  const handleFetch = useCallback(async () => {
    if (!athleteId.trim() || !apiKey.trim()) return;
    setLoading(true);
    setFetchError(null);
    setHasData(false);
    setShowAdvanced(false);

    const result = await fetchMaxEfforts(athleteId.trim(), apiKey.trim(), 90);

    setLoading(false);

    if ('error' in result) {
      setFetchError(result.error);
      return;
    }

    const autoSelected = autoSelectGoldilocksEfforts(result.efforts);
    setAllEfforts(result.efforts);
    setSelectedKeys(new Set(autoSelected.map(effortKey)));
    setHasData(true);
  }, [athleteId, apiKey]);

  // ── Checkbox toggle ───────────────────────────────────────────────────────────
  const toggleEffort = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  // ── Selected efforts (intervals mode) ────────────────────────────────────────
  const selectedEfforts = useMemo(
    () => allEfforts.filter((e) => selectedKeys.has(effortKey(e))),
    [allEfforts, selectedKeys],
  );

  // ── CP result (both modes) ────────────────────────────────────────────────────
  const { cpResult, cpError } = useMemo<{
    cpResult: CPResult | null;
    cpError: string | null;
  }>(() => {
    if (cpDataSource === 'manual') {
      if (manualEfforts.length < 2)
        return { cpResult: null, cpError: 'Enter at least 2 valid efforts to calculate CP.' };
      try {
        return { cpResult: calculateCP(manualEfforts, weightKg, sex, powerMeter), cpError: null };
      } catch (e) {
        return { cpResult: null, cpError: (e as Error).message };
      }
    }

    if (!hasData) return { cpResult: null, cpError: null };
    if (selectedEfforts.length < 2)
      return { cpResult: null, cpError: 'Select at least 2 efforts to calculate CP.' };

    try {
      return { cpResult: calculateCP(selectedEfforts, weightKg, sex, powerMeter), cpError: null };
    } catch (e) {
      return { cpResult: null, cpError: (e as Error).message };
    }
  }, [cpDataSource, manualEfforts, hasData, selectedEfforts, weightKg, sex, powerMeter]);

  // Auto-show results on mount if manual data was previously entered (mirrors MMP cache restore)
  useEffect(() => {
    if (cpDataSource === 'manual' && manualEfforts.length >= 2) {
      setManualSubmitted(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // showResults drives the results section visibility
  const showResults = cpDataSource === 'manual' ? manualSubmitted : hasData;

  // Effort points fed to the curve — manual mode uses manualEfforts, intervals uses selected
  const curveEffortPoints = cpDataSource === 'manual' ? manualEfforts : selectedEfforts;

  // ── Persistence effects ────────────────────────────────────────────────────────
  useEffect(() => { try { localStorage.setItem(LS_WEIGHT,    String(weightKg)); } catch {} }, [weightKg]);
  useEffect(() => { try { localStorage.setItem(LS_SEX,       sex);              } catch {} }, [sex]);
  useEffect(() => { try { localStorage.setItem(LS_METER,     powerMeter);       } catch {} }, [powerMeter]);
  useEffect(() => { try { localStorage.setItem(LS_CP_SOURCE, cpDataSource);     } catch {} }, [cpDataSource]);
  useEffect(() => {
    try { localStorage.setItem(LS_MANUAL_POINTS, JSON.stringify(manualPoints)); } catch {}
  }, [manualPoints]);
  useEffect(() => {
    try { localStorage.setItem(LS_MANUAL_ENV, JSON.stringify(manualTestEnv)); } catch {}
  }, [manualTestEnv]);

  // Persist selected keys whenever they change (also after fetch auto-select)
  useEffect(() => {
    if (!hasData || !athleteId.trim()) return;
    try { localStorage.setItem(lsSelKeys(athleteId.trim()), JSON.stringify([...selectedKeys])); } catch {}
  }, [selectedKeys, hasData, athleteId]);

  // Auto-restore from MMP cache on mount / when credentials become available.
  useEffect(() => {
    const id = athleteId.trim();
    if (!id || hasData) return;
    const cached = getCached<{ efforts: MaxEffort[] }>(`mmp_v1_${id}`);
    if (!cached) return;

    setAllEfforts(cached.efforts);

    try {
      const raw = localStorage.getItem(lsSelKeys(id));
      if (raw) {
        setSelectedKeys(new Set(JSON.parse(raw) as string[]));
      } else {
        const auto = autoSelectGoldilocksEfforts(cached.efforts);
        setSelectedKeys(new Set(auto.map(effortKey)));
      }
    } catch {
      const auto = autoSelectGoldilocksEfforts(cached.efforts);
      setSelectedKeys(new Set(auto.map(effortKey)));
    }

    setHasData(true);
  }, [athleteId]); // hasData checked inside — intentionally not a dep

  // Pre-fill credentials when profile loads after mount
  useEffect(() => { if (initialAthleteId)   setAthleteId(initialAthleteId); },   [initialAthleteId]);
  useEffect(() => { if (initialApiKey)      setApiKey(initialApiKey); },          [initialApiKey]);
  useEffect(() => { if (initialAthleteName) setAthleteName(initialAthleteName); }, [initialAthleteName]);

  // Reset save status when result changes
  useEffect(() => { setSaveStatus('idle'); }, [cpResult]);

  // Notify parent whenever the Lab produces a valid result (or clears)
  useEffect(() => {
    if (!onLabUpdate) return;
    if (cpResult) {
      onLabUpdate({
        cpWatts:         cpResult.criticalPowerWatts,
        wPrimeJoules:    cpResult.wPrimeJoules,
        weightKg,
        athleteId,
        apiKey,
        selectedEfforts: cpDataSource === 'intervals' ? selectedEfforts : [],
        testEnvironment: cpDataSource === 'manual' ? manualTestEnv : undefined,
      });
    } else {
      onLabUpdate(null);
    }
  }, [cpResult, weightKg, athleteId, apiKey, selectedEfforts, cpDataSource, manualTestEnv, onLabUpdate]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="workbench">

      {/* ── Last-saved banner ──────────────────────────────────────────────────── */}
      {lastSaved && !showResults && (
        <div className="last-saved-banner">
          <span>Last saved: <strong>CP {Math.round(lastSaved.cpWatts)} W</strong> / <strong>W′ {lastSaved.wPrimeKJ.toFixed(2)} kJ</strong></span>
          <span className="last-saved-date">{lastSaved.date}</span>
        </div>
      )}

      {/* ── Config card ────────────────────────────────────────────────────────── */}
      <section className="card config-card">
        <h2 className="section-label">Connect to Intervals.icu</h2>

        <div className="config-grid">

          {/* ── Intervals.icu connection ─────────────────────────────────────── */}
          {apiKey.startsWith('Bearer ') && !showManualEntry ? (
            <div className="field field-full">
              <div className="intervals-oauth-connected">
                <span style={{ fontSize: '0.85rem', color: '#c0390a', fontWeight: 500, flex: 1 }}>
                  Connected as <strong>{athleteName || athleteId}</strong>
                </span>
                <button className="btn-ghost btn-sm" onClick={() => setShowManualEntry(true)}>
                  Edit manually
                </button>
                <button className="btn-ghost btn-sm" onClick={() => {
                  const id = athleteId.trim();
                  if (id) {
                    clearCached(`mmp_v1_${id}`);
                    try { localStorage.removeItem(lsSelKeys(id)); } catch {}
                  }
                  setApiKey(''); setAthleteId(''); setAthleteName('');
                  setAllEfforts([]); setSelectedKeys(new Set()); setHasData(false);
                  onDisconnectIntervals?.();
                }}>
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <>
              {!showManualEntry && (
                <div className="field field-full lab-connect-row">
                  <button className="btn-intervals" onClick={() => initiateIntervalsOAuth('data')}>
                    <IntervalsIcon /> Connect with Intervals.icu
                  </button>
                  <button className="btn-link" style={{ fontSize: '0.82rem' }} onClick={() => setShowManualEntry(true)}>
                    Enter credentials manually
                  </button>
                </div>
              )}
              {showManualEntry && (
                <>
                  <div className="field field-full">
                    <button className="btn-link" style={{ fontSize: '0.82rem' }} onClick={() => setShowManualEntry(false)}>
                      ← Back to OAuth connect
                    </button>
                  </div>
                  <label className="field">
                    <span>Athlete ID</span>
                    <input
                      value={athleteId}
                      onChange={(e) => setAthleteId(e.target.value)}
                      placeholder="i123456"
                      autoComplete="off"
                    />
                  </label>
                  <label className="field">
                    <span>API Key</span>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="your-api-key"
                      autoComplete="off"
                    />
                  </label>
                </>
              )}
            </>
          )}

          <label className="field">
            <span>Weight (kg)</span>
            <input
              type="number"
              value={weightKg}
              min={30}
              max={150}
              step={0.1}
              onChange={(e) => setWeightKg(Number(e.target.value))}
            />
          </label>

          <label className="field">
            <span>Sex</span>
            <select value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
              <option>Male</option>
              <option>Female</option>
            </select>
          </label>

          <label className="field field-full">
            <span>Power Meter</span>
            <select value={powerMeter} onChange={(e) => setPowerMeter(e.target.value as PowerMeter)}>
              {POWER_METERS.map((pm) => <option key={pm}>{pm}</option>)}
            </select>
          </label>
        </div>

        {/* ── CP data source toggle ─────────────────────────────────────────── */}
        <div className="cp-source-row">
          <span className="cp-source-label">CP Data Source</span>
          <div className="source-pills">
            <button
              className={`source-pill${cpDataSource === 'intervals' ? ' source-pill-active' : ''}`}
              onClick={() => setCpDataSource('intervals')}
            >
              From Intervals.icu
            </button>
            <button
              className={`source-pill${cpDataSource === 'manual' ? ' source-pill-active' : ''}`}
              onClick={() => setCpDataSource('manual')}
            >
              Manual Entry
            </button>
          </div>
        </div>

        {/* ── Intervals mode: fetch button ──────────────────────────────────── */}
        {cpDataSource === 'intervals' && (
          <>
            <button
              className="btn-primary"
              onClick={handleFetch}
              disabled={loading || !athleteId.trim() || !apiKey.trim()}
            >
              {loading ? 'Fetching…' : 'Fetch Max Efforts'}
            </button>
            {fetchError && <p className="msg-error">{fetchError}</p>}
          </>
        )}

        {/* ── Manual mode: effort entry + test conditions ───────────────────── */}
        {cpDataSource === 'manual' && (
          <div className="manual-entry">
            <div className="manual-entry-header">
              <span className="manual-col-label">Duration (mm:ss)</span>
              <span className="manual-col-label">Power (W)</span>
            </div>

            {manualPoints.map((pt) => {
              const parsedDur = parseManualDuration(pt.durationInput);
              const parsedPwr = Number(pt.powerInput);
              const valid = parsedDur != null && parsedDur > 0 && parsedPwr > 0;
              return (
                <div key={pt.id} className="manual-row">
                  <input
                    type="text"
                    className={`manual-input${pt.durationInput && !valid ? ' manual-input-warn' : ''}`}
                    placeholder="e.g. 3:00"
                    value={pt.durationInput}
                    onChange={(e) => updateManualPoint(pt.id, 'durationInput', e.target.value)}
                  />
                  <input
                    type="number"
                    className="manual-input"
                    placeholder="e.g. 280"
                    value={pt.powerInput}
                    min={1}
                    max={2000}
                    onChange={(e) => updateManualPoint(pt.id, 'powerInput', e.target.value)}
                  />
                  {manualPoints.length > 2 && (
                    <button
                      className="manual-remove"
                      onClick={() => removeManualPoint(pt.id)}
                      aria-label="Remove effort"
                    >×</button>
                  )}
                </div>
              );
            })}

            <button className="btn-add-effort" onClick={addManualPoint}>
              + Add effort
            </button>

            <button
              className="btn-primary"
              style={{ marginTop: 4 }}
              onClick={() => setManualSubmitted(true)}
            >
              Calculate CP
            </button>

            {/* Test conditions */}
            <div className="manual-env-section">
              <h4 className="manual-env-title">CP Test Conditions</h4>
              <p className="manual-env-hint">Used by the Strategy Room to adjust for race-day conditions.</p>
              <div className="manual-env-grid">
                <label className="field">
                  <span>Temperature (°C)</span>
                  <input
                    type="number"
                    value={manualTestEnv.temperatureC}
                    step={0.5}
                    onChange={(e) => setManualTestEnv(prev => ({ ...prev, temperatureC: Number(e.target.value) }))}
                  />
                </label>
                <label className="field">
                  <span>Altitude (m)</span>
                  <input
                    type="number"
                    value={manualTestEnv.altitudeM}
                    min={0}
                    step={10}
                    onChange={(e) => setManualTestEnv(prev => ({ ...prev, altitudeM: Number(e.target.value) }))}
                  />
                </label>
                <label className="field">
                  <span>Humidity (%)</span>
                  <input
                    type="number"
                    value={manualTestEnv.humidityPercent}
                    min={0}
                    max={100}
                    onChange={(e) => setManualTestEnv(prev => ({ ...prev, humidityPercent: Number(e.target.value) }))}
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Results ─────────────────────────────────────────────────────────────── */}
      {showResults && (
        <>
          {/* ── Prescription card ───────────────────────────────────────────────── */}
          <section className="card prescription-card">
            <div className="prescription-header">
              <h2>Your Running Prescription</h2>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={showAdvanced}
                  onChange={(e) => setShowAdvanced(e.target.checked)}
                />
                Show Advanced / Edit Data
              </label>
            </div>

            {cpResult ? (
              <>
                <div className="metrics-grid">
                  <div className="metric metric-primary">
                    <span className="metric-value">{Math.round(cpResult.criticalPowerWatts)}</span>
                    <span className="metric-unit">W</span>
                    <span className="metric-label">Critical Power</span>
                  </div>

                  <div className="metric">
                    <span className="metric-value">{cpResult.wPrimeKJ.toFixed(2)}</span>
                    <span className="metric-unit">kJ</span>
                    <span className="metric-label">W′ Anaerobic Capacity</span>
                  </div>

                  <div className="metric">
                    <span className="metric-value">{cpResult.wPrimePerKg.toFixed(1)}</span>
                    <span className="metric-unit">J/kg</span>
                    <span className="metric-label">W′ per kg</span>
                  </div>

                  <div className="metric">
                    <span
                      className="metric-value metric-rating"
                      style={{ color: RATING_COLOR[cpResult.wPrimeRating] }}
                    >
                      {cpResult.wPrimeRating}
                    </span>
                    <span className="metric-label">W′ Rating</span>
                  </div>
                </div>

                {!showAdvanced && cpDataSource === 'intervals' && (
                  <p className="prescription-footnote">
                    Calculated using your best 3-min and 12-min efforts from the last 90 days.
                  </p>
                )}
                {!showAdvanced && cpDataSource === 'manual' && (
                  <p className="prescription-footnote">
                    Calculated from {manualEfforts.length} manually entered effort{manualEfforts.length !== 1 ? 's' : ''}.
                  </p>
                )}

                {user && onSaveToJournal && (
                  <div className="save-journal-row">
                    <button
                      className="btn-primary btn-sm"
                      disabled={saveStatus === 'saving' || saveStatus === 'saved'}
                      onClick={async () => {
                        if (!cpResult) return;
                        setSaveStatus('saving');
                        try {
                          await onSaveToJournal(cpResult, selectedEfforts);
                          const entry: LastSaved = {
                            cpWatts: cpResult.criticalPowerWatts,
                            wPrimeKJ: cpResult.wPrimeKJ,
                            date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
                          };
                          try { localStorage.setItem(LS_LAST_SAVED, JSON.stringify(entry)); } catch {}
                          setLastSaved(entry);
                          setSaveStatus('saved');
                        } catch {
                          setSaveStatus('error');
                        }
                      }}
                    >
                      {saveStatus === 'saving' ? 'Saving…'
                        : saveStatus === 'saved'  ? '✓ Saved to Journal'
                        : 'Save to Journal'}
                    </button>
                    {saveStatus === 'error' && (
                      <span className="msg-error" style={{ fontSize: '0.8rem' }}>Save failed.</span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="msg-info">{cpError ?? 'No data.'}</p>
            )}
          </section>

          {/* ── Power-Duration Curve ─────────────────────────────────────────────── */}
          {cpResult && (
            <section className="card pd-curve-card">
              <PowerDurationCurve
                cpWatts={cpResult.criticalPowerWatts}
                wPrimeJoules={cpResult.wPrimeJoules}
                effortPoints={curveEffortPoints}
              />
            </section>
          )}

          {/* ── Advanced / Data Workbench ──────────────────────────────────────── */}
          {showAdvanced && (
            <section className="card advanced-card">
              <h3>Data Workbench</h3>

              {/* Intervals mode: effort table */}
              {cpDataSource === 'intervals' && (
                <>
                  <p className="advanced-hint">
                    Check or uncheck efforts to include them in the calculation. Results update live.
                  </p>
                  <div className="table-wrapper">
                    <table className="effort-table">
                      <thead>
                        <tr>
                          <th>Duration</th>
                          <th>Power</th>
                          <th>Date</th>
                          <th>Recent?</th>
                          <th>Use</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allEfforts.map((effort) => {
                          const key     = effortKey(effort);
                          const checked = selectedKeys.has(key);
                          return (
                            <tr
                              key={key}
                              className={checked ? 'row-on' : 'row-off'}
                              onClick={() => toggleEffort(key)}
                            >
                              <td>{fmtDuration(effort.durationSeconds)}</td>
                              <td><strong>{effort.averagePower} W</strong></td>
                              <td>{fmtDate(effort.date)}</td>
                              <td>
                                {effort.isRecent
                                  ? <span className="dot-recent" title="Within 42 days">●</span>
                                  : <span className="dot-older"  title="Older than 42 days">○</span>}
                              </td>
                              <td onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleEffort(key)}
                                  className="effort-check"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Manual mode: summary of entered points */}
              {cpDataSource === 'manual' && (
                <p className="advanced-hint">
                  Edit your effort data points in the config card above. The curve and calculation update live.
                </p>
              )}

              {/* Live result bar */}
              <div className="live-bar">
                {cpResult ? (
                  <div className="live-stats">
                    <span>CP <strong>{Math.round(cpResult.criticalPowerWatts)} W</strong></span>
                    <span>W′ <strong>{cpResult.wPrimeKJ.toFixed(2)} kJ</strong></span>
                    <span>
                      R² <strong className={cpResult.r2 < 0.95 ? 'r2-low' : 'r2-ok'}>
                        {cpResult.r2.toFixed(4)}
                      </strong>
                    </span>
                  </div>
                ) : (
                  <p className="msg-muted">{cpError}</p>
                )}
              </div>

              {/* ── Low-confidence warning ────────────────────────────────────── */}
              {cpResult?.warning && (
                <div className="warning-box" role="alert">
                  <span className="warning-icon">⚠️</span>
                  <div className="warning-body">
                    <strong>Low Confidence — R² {cpResult.r2.toFixed(4)}</strong>
                    <p>{cpResult.warning.message}</p>
                    {cpResult.warning.suggestedCorrection.length > 0 && (
                      <p className="warning-suggestion">
                        Biggest {cpResult.warning.suggestedCorrection.length === 1 ? 'outlier' : 'outliers'}:{' '}
                        {cpResult.warning.suggestedCorrection.slice(0, 3).map((o, i) => (
                          <React.Fragment key={o.index}>
                            {i > 0 && ', '}
                            <strong>{fmtDuration(o.effort.durationSeconds)}</strong>
                            {' '}({o.residualPercent.toFixed(1)}% off)
                          </React.Fragment>
                        ))}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
