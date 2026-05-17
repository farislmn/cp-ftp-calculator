import React, { useMemo, useState } from 'react';
import type { LabContext } from './LabWorkbench.js';
import { calculatePowerZones } from '../powerZoneEngine.js';
import type { PowerZoneResult } from '../powerZoneEngine.js';

interface Props {
  labCtx: LabContext | null;
  calibratedRiegel: number | null;
}

// ─── Zone colour palette ──────────────────────────────────────────────────────
const ZONE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  Z1: { bg: '#f0fdf4', border: '#86efac', text: '#14532d' },
  Z2: { bg: '#eff6ff', border: '#93c5fd', text: '#1e3a8a' },
  SS: { bg: '#fefce8', border: '#fde047', text: '#713f12' },
  Z3: { bg: '#fff7ed', border: '#fdba74', text: '#7c2d12' },
  Z4: { bg: '#fef2f2', border: '#fca5a5', text: '#7f1d1d' },
  Z5: { bg: '#fdf4ff', border: '#e879f9', text: '#581c87' },
  Z6: { bg: '#f5f3ff', border: '#a78bfa', text: '#3b0764' },
  Z7: { bg: '#1e1b4b', border: '#4338ca', text: '#e0e7ff' },
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

  const ss = result.zones.find(z => z.id === 'SS')!;

  return (
    <div className="workbench">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="section-label" style={{ marginBottom: 4 }}>Individualized Zone Calculator</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              CP {Math.round(cp)} W · W′ {Math.round(labCtx.wPrimeJoules / 1000 * 10) / 10} kJ · k = {result.kSeconds}s
              {' · '}
              <span title={result.riegelIsPersonal ? 'Calibrated from your Strategy Room race data' : 'Default — calibrate in Strategy Room for a personal value'}>
                r = {result.riegelUsed.toFixed(2)}{result.riegelIsPersonal ? ' ✓' : ' (default)'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {!result.ssIsRaceDerived && (
              <span style={{ fontSize: '0.75rem', color: 'var(--warn-text)', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 4, padding: '3px 8px' }}>
                SS using fallback %CP (race calc unavailable)
              </span>
            )}
            <button
              className="btn-primary"
              style={{ width: 'auto', padding: '8px 16px', fontSize: '0.82rem' }}
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {result.zones.map(zone => {
            const colors = ZONE_COLORS[zone.id] ?? ZONE_COLORS.Z1;
            const upper = zone.upperW !== null
              ? `${zone.upperW} W`
              : `${zone.lowerW}+ W`;
            const upperPct = zone.upperPct !== null ? `${zone.upperPct}%` : '∞';

            if (zone.isOverlay) {
              return (
                <div
                  key={zone.id}
                  style={{
                    background: colors.bg,
                    border: `1.5px dashed ${colors.border}`,
                    borderRadius: 8,
                    padding: '10px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 700, color: colors.text, fontSize: '0.88rem' }}>
                      Sweet Spot
                    </span>
                    <span style={{ fontSize: '0.75rem', color: colors.text, opacity: 0.75, marginLeft: 8 }}>
                      descriptive overlay — spans Z2/Z3
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', color: colors.text }}>
                      {zone.lowerW}–{zone.upperW} W
                    </span>
                    <span style={{ fontSize: '0.78rem', color: colors.text, opacity: 0.75, marginLeft: 8 }}>
                      {zone.lowerPct}–{zone.upperPct}% CP
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={zone.id}
                style={{
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  padding: '10px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, fontSize: '0.9rem', color: colors.text, minWidth: 28 }}>
                    {zone.id}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: '0.88rem', color: colors.text }}>
                    {zone.name}
                  </span>
                  {zone.subZoneNote && (
                    <span style={{ fontSize: '0.72rem', color: colors.text, opacity: 0.7 }}>
                      {zone.subZoneNote}
                    </span>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: colors.text }}>
                    {zone.upperW !== null ? `${zone.lowerW}–${zone.upperW} W` : upper}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: colors.text, opacity: 0.75, marginLeft: 8 }}>
                    {zone.lowerPct}–{upperPct} CP
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 14, fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Z3 upper boundary: {Math.round((1.02 - result.kSeconds * 0.00077) * 100 * 10) / 10}% CP (formula: 102% − k × 0.077%, clamped 95–99%) ·
          Z4 symmetric around CP · Z5 upper ≈ PDC at {Math.round(result.kSeconds * 3.75 / 60 * 10) / 10} min · Z6 upper ≈ PDC at {Math.round(result.kSeconds * 2 / 60 * 10) / 10} min
        </div>
      </div>

      {/* ── Output 2: Above-CP interval targets ──────────────────────────────── */}
      <div className="card">
        <div className="section-label">Above-CP Interval Power Targets</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 16 }}>
          Full power-duration curve: P(t) = CP + W′/t — targets at each duration bracket's endpoints
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {result.intervalTargets.map(target => (
            <div
              key={target.name}
              style={{
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '14px 16px',
              }}
            >
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 6 }}>
                {target.name}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                {target.durationLabel}
              </div>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--accent)', letterSpacing: '-0.01em' }}>
                {target.lowerW}–{target.upperW} W
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 3 }}>
                {target.lowerPct}–{target.upperPct}% CP
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Ranges shown low → high within each bracket (longer effort = lower end, shorter effort = upper end).
        </div>
      </div>

      {/* ── Output 3: Sub-threshold bands ────────────────────────────────────── */}
      <div className="card">
        <div className="section-label">Sub-Threshold Training Bands</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 16 }}>
          Based on Palladino Levels Comparison Grid. Race power anchors: Marathon {result.marathonPowerW} W · HM {result.hmPowerW} W · 10K {result.tenKPowerW} W
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {result.subThresholdBands.map((band) => (
            <div
              key={band.name}
              style={{
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                borderLeft: '4px solid var(--accent)',
                borderRadius: 8,
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text)' }}>
                  {band.name}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {band.anchor}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--accent)' }}>
                  {band.lowerW}–{band.upperW} W
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 8 }}>
                  {band.lowerPct}–{band.upperPct}% CP
                </span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 6, fontSize: '0.75rem', color: 'var(--warn-text)', lineHeight: 1.6 }}>
          <strong>HM plan adds HM Pace Tempo:</strong> {Math.round(0.93 * cp)}–{Math.round(0.96 * cp)} W (93–96% CP, in long run) ·
          Sub-Threshold 1 can serve both HM and Marathon plans at the same %CP range.
        </div>
      </div>

    </div>
  );
}
