import React, { useMemo, useState } from 'react';
import type { LabContext } from './LabWorkbench.js';
import { calculatePowerZones } from '../powerZoneEngine.js';
import type { PowerZoneResult } from '../powerZoneEngine.js';

interface Props {
  labCtx: LabContext | null;
  calibratedRiegel: number | null;
}

// ─── Zone colour palette (dark-native) ───────────────────────────────────────
const ZONE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  Z1: { bg: 'rgba(34,197,94,0.07)',   border: 'rgba(34,197,94,0.22)',   text: '#4ade80' },
  Z2: { bg: 'rgba(59,130,246,0.07)',  border: 'rgba(59,130,246,0.22)',  text: '#60a5fa' },
  SS: { bg: 'rgba(234,179,8,0.07)',   border: 'rgba(234,179,8,0.28)',   text: '#fbbf24' },
  Z3: { bg: 'rgba(249,115,22,0.07)',  border: 'rgba(249,115,22,0.25)',  text: '#fb923c' },
  Z4: { bg: 'rgba(239,68,68,0.07)',   border: 'rgba(239,68,68,0.22)',   text: '#f87171' },
  Z5: { bg: 'rgba(217,70,239,0.07)',  border: 'rgba(217,70,239,0.22)',  text: '#e879f9' },
  Z6: { bg: 'rgba(139,92,246,0.07)',  border: 'rgba(139,92,246,0.22)',  text: '#a78bfa' },
  Z7: { bg: 'rgba(99,102,241,0.10)',  border: 'rgba(99,102,241,0.30)',  text: '#818cf8' },
};

// ─── Copyable zone text builder ───────────────────────────────────────────────
function buildCopyText(result: PowerZoneResult, cp: number): string {
  const lines: string[] = [
    `Individualized Power Zones (CP ${Math.round(cp)} W, W′/CP k=${result.kSeconds}s)`,
    '',
  ];
  for (const z of result.zones) {
    if (z.isOverlay) continue;
    const upper = z.upperW !== null ? `${z.upperW} W` : 'no ceiling';
    lines.push(`${z.id} ${z.name}: ${z.lowerW}–${upper} (${z.lowerPct}–${z.upperPct ?? '∞'}% CP)`);
  }
  lines.push('');
  lines.push(`Sweet Spot: ${result.zones.find(z => z.id === 'SS')?.lowerW}–${result.zones.find(z => z.id === 'SS')?.upperW} W`);
  return lines.join('\n');
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PowerZones({ labCtx, calibratedRiegel }: Props) {
  const [copied, setCopied] = useState(false);

  const result = useMemo<PowerZoneResult | null>(() => {
    if (!labCtx) return null;
    try {
      return calculatePowerZones(labCtx.cpWatts, labCtx.wPrimeJoules, labCtx.weightKg, calibratedRiegel ?? undefined);
    } catch {
      return null;
    }
  }, [labCtx, calibratedRiegel]);

  if (!labCtx || !result) {
    return (
      <div className="workbench">
        <div className="card tab-gate">
          <p>Run a Lab session first to generate individualized power zones.</p>
        </div>
      </div>
    );
  }

  const cp = labCtx.cpWatts;

  const handleCopy = () => {
    navigator.clipboard.writeText(buildCopyText(result, cp)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="workbench">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="zone-header">
          <div>
            <div className="section-label" style={{ marginBottom: 4 }}>Individualized Zone Calculator</div>
            <div className="zone-meta">
              CP {Math.round(cp)} W · W′ {Math.round(labCtx.wPrimeJoules / 1000 * 10) / 10} kJ
              {' · '}
              <span title="k = W prime / CP (seconds). The individualization driver for zone boundaries — it measures how large your anaerobic reserve is relative to your aerobic ceiling. Higher k = wider anaerobic zones.">
                k = {result.kSeconds}s
              </span>
              {' · '}
              <span title={result.riegelIsPersonal ? 'Calibrated Riegel exponent from your Strategy Room race data. Controls how zone boundaries scale with distance. More negative = faster fatigue across distance.' : 'Default Riegel exponent (-0.10). Calibrate in Strategy Room using a race result for a personal value.'}>
                r = {result.riegelUsed.toFixed(2)}{result.riegelIsPersonal ? ' ✓' : ' (default)'}
              </span>
            </div>
          </div>
          <div className="zone-header-actions">
            {!result.ssIsRaceDerived && (
              <span className="warning-pill">
                SS using fallback %CP (race calc unavailable)
              </span>
            )}
            <button
              className="btn-primary btn-sm"
              onClick={handleCopy}
            >
              {copied ? '✓ Copied' : 'Copy for Intervals.icu'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Output 1: Zone table ─────────────────────────────────────────────── */}
      <div className="card">
        <div className="section-label">Power Zones — enter manually into Intervals.icu</div>
        <div className="zone-list">
          {result.zones.map(zone => {
            const colors = ZONE_COLORS[zone.id] ?? ZONE_COLORS.Z1!;
            const upper = zone.upperW !== null ? `${zone.upperW} W` : `${zone.lowerW}+ W`;
            const upperPct = zone.upperPct !== null ? `${zone.upperPct}%` : '∞';

            if (zone.isOverlay) {
              return (
                <div
                  key={zone.id}
                  className="zone-row"
                  style={{ background: colors.bg, border: `1.5px dashed ${colors.border}`, color: colors.text }}
                >
                  <div>
                    <div className="zone-overlay-label">Sweet Spot</div>
                    <div className="zone-overlay-sub">descriptive overlay — spans Z2/Z3</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="zone-row-watts">{zone.lowerW}–{zone.upperW} W</span>
                    <span className="zone-row-pct">{zone.lowerPct}–{zone.upperPct}% CP</span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={zone.id}
                className="zone-row"
                style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
              >
                <div className="zone-row-info">
                  <span className="zone-row-id">{zone.id}</span>
                  <span className="zone-row-name">{zone.name}</span>
                  {zone.subZoneNote && (
                    <span className="zone-row-subnote">{zone.subZoneNote}</span>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="zone-row-watts">
                    {zone.upperW !== null ? `${zone.lowerW}–${zone.upperW} W` : upper}
                  </span>
                  <span className="zone-row-pct">{zone.lowerPct}–{upperPct} CP</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="zone-footnote">
          Z3 upper: {Math.round((1.02 - result.kSeconds * 0.00077) * 100 * 10) / 10}% CP (102% − k × 0.077%, clamped 95–99%) ·
          Z4 symmetric around CP · Z5 upper ≈ PDC at {Math.round(result.kSeconds * 3.75 / 60 * 10) / 10} min · Z6 upper ≈ PDC at {Math.round(result.kSeconds * 2 / 60 * 10) / 10} min
        </p>
      </div>

      {/* ── Output 2: Above-CP interval targets ──────────────────────────────── */}
      <div className="card">
        <div className="section-label">Above-CP Interval Power Targets</div>
        <p className="zone-interval-desc">
          Full power-duration curve: P(t) = CP + W′/t — targets at each duration bracket's endpoints
        </p>
        <div className="zone-interval-grid">
          {result.intervalTargets.map(target => (
            <div key={target.name} className="zone-interval-card">
              <div className="zone-interval-name">{target.name}</div>
              <div className="zone-interval-duration">{target.durationLabel}</div>
              <div className="zone-interval-watts">{target.lowerW}–{target.upperW} W</div>
              <div className="zone-interval-pct">{target.lowerPct}–{target.upperPct}% CP</div>
            </div>
          ))}
        </div>
        <p className="zone-footnote">
          Ranges shown low to high within each bracket (longer effort = lower end, shorter effort = upper end).
        </p>
      </div>

      {/* ── Output 3: Sub-threshold bands ────────────────────────────────────── */}
      <div className="card">
        <div className="section-label">Sub-Threshold Training Bands</div>
        <p className="zone-interval-desc">
          Based on Palladino Levels Comparison Grid. Race power anchors: Marathon {result.marathonPowerW} W · HM {result.hmPowerW} W · 10K {result.tenKPowerW} W
        </p>
        <div className="zone-band-list">
          {result.subThresholdBands.map(band => (
            <div key={band.name} className="zone-band-row">
              <div>
                <div className="zone-band-name">{band.name}</div>
                <div className="zone-band-anchor">{band.anchor}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="zone-band-watts">{band.lowerW}–{band.upperW} W</span>
                <span className="zone-band-pct">{band.lowerPct}–{band.upperPct}% CP</span>
              </div>
            </div>
          ))}
        </div>
        <div className="zone-band-callout">
          <strong>HM plan adds HM Pace Tempo:</strong> {Math.round(0.93 * cp)}–{Math.round(0.96 * cp)} W (93–96% CP, in long run) ·
          Sub-Threshold 1 can serve both HM and Marathon plans at the same %CP range.
        </div>
      </div>

    </div>
  );
}
