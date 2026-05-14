import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { calculateCP } from '../labEngine.js';
import type { Sex, PowerMeter, CPResult } from '../labEngine.js';
import { fetchMaxEfforts } from '../intervalsClient.js';
import type { MaxEffort } from '../intervalsClient.js';
import { autoSelectGoldilocksEfforts, effortKey } from '../effortSelector.js';

export interface LabContext {
  cpWatts: number;
  wPrimeJoules: number;
  weightKg: number;
  athleteId: string;
  apiKey: string;
  selectedEfforts: MaxEffort[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

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

function fmtDuration(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

interface LabWorkbenchProps {
  onLabUpdate?: (ctx: LabContext | null) => void;
}

export function LabWorkbench({ onLabUpdate }: LabWorkbenchProps = {}) {

  // ── Config state ────────────────────────────────────────────────────────────
  const [athleteId,  setAthleteId]  = useState('');
  const [apiKey,     setApiKey]     = useState('');
  const [weightKg,   setWeightKg]   = useState(70);
  const [sex,        setSex]        = useState<Sex>('Male');
  const [powerMeter, setPowerMeter] = useState<PowerMeter>('Stryd non-Wind');

  // ── Data state ──────────────────────────────────────────────────────────────
  const [loading,      setLoading]      = useState(false);
  const [fetchError,   setFetchError]   = useState<string | null>(null);
  const [allEfforts,   setAllEfforts]   = useState<MaxEffort[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hasData,      setHasData]      = useState(false);

  // ── Fetch handler ────────────────────────────────────────────────────────────
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

  // ── Checkbox toggle ──────────────────────────────────────────────────────────
  const toggleEffort = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  // ── Live CP calculation ──────────────────────────────────────────────────────
  const selectedEfforts = useMemo(
    () => allEfforts.filter((e) => selectedKeys.has(effortKey(e))),
    [allEfforts, selectedKeys],
  );

  const { cpResult, cpError } = useMemo<{
    cpResult: CPResult | null;
    cpError: string | null;
  }>(() => {
    if (!hasData) return { cpResult: null, cpError: null };

    if (selectedEfforts.length < 2)
      return { cpResult: null, cpError: 'Select at least 2 efforts to calculate CP.' };

    try {
      return { cpResult: calculateCP(selectedEfforts, weightKg, sex, powerMeter), cpError: null };
    } catch (e) {
      return { cpResult: null, cpError: (e as Error).message };
    }
  }, [hasData, selectedEfforts, weightKg, sex, powerMeter]);

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
        selectedEfforts,
      });
    } else {
      onLabUpdate(null);
    }
  }, [cpResult, weightKg, athleteId, apiKey, selectedEfforts, onLabUpdate]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="workbench">

      {/* ── Config card ───────────────────────────────────────────────────────── */}
      <section className="card config-card">
        <h2 className="section-label">Connect to Intervals.icu</h2>

        <div className="config-grid">
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

        <button
          className="btn-primary"
          onClick={handleFetch}
          disabled={loading || !athleteId.trim() || !apiKey.trim()}
        >
          {loading ? 'Fetching…' : 'Fetch Max Efforts'}
        </button>

        {fetchError && <p className="msg-error">{fetchError}</p>}
      </section>

      {/* ── Results ───────────────────────────────────────────────────────────── */}
      {hasData && (
        <>
          {/* ── Prescription card ─────────────────────────────────────────────── */}
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

                {!showAdvanced && (
                  <p className="prescription-footnote">
                    Calculated using your best 3-min and 12-min efforts from the last 90 days.
                  </p>
                )}
              </>
            ) : (
              <p className="msg-info">{cpError ?? 'No data.'}</p>
            )}
          </section>

          {/* ── Advanced / Data Workbench ──────────────────────────────────────── */}
          {showAdvanced && (
            <section className="card advanced-card">
              <h3>Data Workbench</h3>
              <p className="advanced-hint">
                Check or uncheck efforts to include them in the calculation. Results update live.
              </p>

              {/* Effort table */}
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

              {/* ── Low-confidence warning ("Embrace the Mess") ───────────────── */}
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
