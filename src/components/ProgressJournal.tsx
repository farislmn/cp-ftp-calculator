import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient.js';
import type { User } from '../supabaseClient.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JournalEntry {
  id: string;
  recorded_at: string;   // date string 'YYYY-MM-DD'
  cp_watts: number;
  w_prime_joules: number;
  r_squared: number | null;
}

interface ProgressJournalProps {
  user: User;
}

// ─── Chart constants ──────────────────────────────────────────────────────────

const W = 660, H = 290;
const PAD = { top: 44, right: 24, bottom: 48, left: 58 };
const CW = W - PAD.left - PAD.right;
const CH = H - PAD.top - PAD.bottom;
const ACCENT = '#2563eb';
const POINT_R = 6;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtDateMonth(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProgressJournal({ user }: ProgressJournalProps) {
  const [entries, setEntries]           = useState<JournalEntry[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [windowMonths, setWindowMonths] = useState<3 | 6>(3);
  const [pageIndex, setPageIndex]       = useState(0);   // 0 = most recent
  const [hoveredId, setHoveredId]       = useState<string | null>(null);
  const [deleteId, setDeleteId]         = useState<string | null>(null);
  const [deleting, setDeleting]         = useState(false);

  // ── Load all entries ────────────────────────────────────────────────────────
  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('journal_entries')
      .select('id, recorded_at, cp_watts, w_prime_joules, r_squared')
      .eq('user_id', user.id)
      .order('recorded_at', { ascending: true });

    if (err) {
      setError(err.message);
    } else {
      setEntries((data ?? []) as JournalEntry[]);
    }
    setLoading(false);
  }, [user.id]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // Reset to page 0 when window size changes
  useEffect(() => { setPageIndex(0); }, [windowMonths]);

  // ── Window bounds ───────────────────────────────────────────────────────────
  const { windowStart, windowEnd } = useMemo(() => {
    const end   = startOfDay(addMonths(new Date(), -pageIndex * windowMonths));
    const start = startOfDay(addMonths(end, -windowMonths));
    return { windowStart: start, windowEnd: end };
  }, [pageIndex, windowMonths]);

  const windowEntries = useMemo(() =>
    entries.filter(e => {
      const d = new Date(e.recorded_at + 'T00:00:00');
      return d >= windowStart && d <= windowEnd;
    }),
  [entries, windowStart, windowEnd]);

  const hasOlderPage = useMemo(() =>
    entries.some(e => new Date(e.recorded_at + 'T00:00:00') < windowStart),
  [entries, windowStart]);

  const hasNewerPage = pageIndex > 0;

  // ── SVG chart ──────────────────────────────────────────────────────────────
  const chart = useMemo(() => {
    if (windowEntries.length === 0) return null;

    const cpValues = windowEntries.map(e => e.cp_watts);
    const cpMin = Math.min(...cpValues);
    const cpMax = Math.max(...cpValues);
    const yPad  = Math.max((cpMax - cpMin) * 0.2, 10);
    const yMin  = cpMin - yPad;
    const yMax  = cpMax + yPad;

    const startMs = windowStart.getTime();
    const endMs   = windowEnd.getTime();
    const span    = endMs - startMs || 1;

    function xOf(iso: string): number {
      const ms = new Date(iso + 'T00:00:00').getTime();
      return PAD.left + ((ms - startMs) / span) * CW;
    }
    function yOf(cp: number): number {
      return PAD.top + CH - ((cp - yMin) / (yMax - yMin)) * CH;
    }

    // Grid lines — 5 horizontal
    const gridLines: number[] = [];
    const gridStep = (yMax - yMin) / 4;
    for (let i = 0; i <= 4; i++) gridLines.push(yMin + i * gridStep);

    // X axis ticks — monthly
    const xTicks: { label: string; x: number }[] = [];
    const cursor = new Date(windowStart);
    cursor.setDate(1);
    while (cursor <= windowEnd) {
      const x = PAD.left + ((cursor.getTime() - startMs) / span) * CW;
      if (x >= PAD.left && x <= PAD.left + CW) {
        xTicks.push({ label: fmtDateMonth(cursor), x });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }

    // Polyline points
    const points = windowEntries.map(e => ({ x: xOf(e.recorded_at), y: yOf(e.cp_watts), e }));

    return { gridLines, xTicks, points, yOf, xOf, yMin, yMax };
  }, [windowEntries, windowStart, windowEnd]);

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!deleteId) return;
    setDeleting(true);
    const { error: err } = await supabase
      .from('journal_entries')
      .delete()
      .eq('id', deleteId)
      .eq('user_id', user.id);

    if (err) {
      setError(err.message);
    } else {
      setEntries(prev => prev.filter(e => e.id !== deleteId));
    }
    setDeleteId(null);
    setDeleting(false);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  if (loading) return <div className="journal-empty">Loading journal…</div>;
  if (error)   return <div className="journal-empty msg-error">{error}</div>;

  return (
    <div className="journal-wrap">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="journal-header">
        <div>
          <h2 className="journal-title">Progress Journal</h2>
          <p className="journal-subtitle">
            {entries.length === 0
              ? 'No entries yet — save a Lab result to start tracking.'
              : `${entries.length} test${entries.length === 1 ? '' : 's'} recorded`}
          </p>
        </div>

        <div className="journal-window-toggle">
          <button
            className={windowMonths === 3 ? 'toggle-btn active' : 'toggle-btn'}
            onClick={() => setWindowMonths(3)}
          >3 mo</button>
          <button
            className={windowMonths === 6 ? 'toggle-btn active' : 'toggle-btn'}
            onClick={() => setWindowMonths(6)}
          >6 mo</button>
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {entries.length === 0 ? (
        <div className="card journal-empty-card">
          <div className="journal-empty-icon">📈</div>
          <p>
            Run a Lab session and click <strong>Save to Journal</strong> to begin
            tracking your Critical Power over time.
          </p>
        </div>
      ) : (
        <>
          {/* ── Chart ────────────────────────────────────────────────────────── */}
          <div className="card journal-chart-card">
            <div className="journal-period">
              {fmtDateShort(windowStart)} — {fmtDateShort(windowEnd)}
            </div>

            {windowEntries.length === 0 ? (
              <div className="journal-window-empty">No entries in this window.</div>
            ) : chart ? (
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="journal-svg"
                aria-label="CP over time chart"
              >
                {/* Grid lines */}
                {chart.gridLines.map((v, i) => (
                  <g key={i}>
                    <line
                      x1={PAD.left} y1={chart.yOf(v)}
                      x2={PAD.left + CW} y2={chart.yOf(v)}
                      stroke="#e2e8f0" strokeWidth={1}
                    />
                    <text
                      x={PAD.left - 8} y={chart.yOf(v) + 4}
                      textAnchor="end"
                      fontSize={11}
                      fill="#94a3b8"
                    >
                      {Math.round(v)}
                    </text>
                  </g>
                ))}

                {/* Y axis label */}
                <text
                  x={14} y={PAD.top + CH / 2}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#94a3b8"
                  transform={`rotate(-90, 14, ${PAD.top + CH / 2})`}
                >
                  CP (W)
                </text>

                {/* X axis ticks */}
                {chart.xTicks.map((t, i) => (
                  <text
                    key={i}
                    x={t.x} y={PAD.top + CH + 20}
                    textAnchor="middle"
                    fontSize={11}
                    fill="#94a3b8"
                  >
                    {t.label}
                  </text>
                ))}

                {/* Line */}
                {chart.points.length > 1 && (
                  <polyline
                    points={chart.points.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={ACCENT}
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                )}

                {/* Area fill (subtle) */}
                {chart.points.length > 1 && (
                  <polygon
                    points={[
                      ...chart.points.map(p => `${p.x},${p.y}`),
                      `${chart.points[chart.points.length - 1].x},${PAD.top + CH}`,
                      `${chart.points[0].x},${PAD.top + CH}`,
                    ].join(' ')}
                    fill={ACCENT}
                    fillOpacity={0.06}
                  />
                )}

                {/* Data points */}
                {chart.points.map(({ x, y, e }) => {
                  const hovered = hoveredId === e.id;
                  return (
                    <g
                      key={e.id}
                      onMouseEnter={() => setHoveredId(e.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      style={{ cursor: 'pointer' }}
                    >
                      {/* W′ annotation above point */}
                      <text
                        x={x} y={y - POINT_R - 6}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#64748b"
                        fontWeight={hovered ? 700 : 400}
                      >
                        {(e.w_prime_joules / 1000).toFixed(1)} kJ
                      </text>

                      {/* Outer ring on hover */}
                      {hovered && (
                        <circle cx={x} cy={y} r={POINT_R + 4} fill={ACCENT} fillOpacity={0.15} />
                      )}

                      {/* Main dot */}
                      <circle
                        cx={x} cy={y} r={POINT_R}
                        fill={hovered ? ACCENT : '#fff'}
                        stroke={ACCENT}
                        strokeWidth={2}
                      />

                      {/* CP label below point */}
                      {hovered && (
                        <g>
                          <rect
                            x={x - 36} y={y + POINT_R + 4}
                            width={72} height={36}
                            rx={4} fill="#0f172a" fillOpacity={0.88}
                          />
                          <text x={x} y={y + POINT_R + 17} textAnchor="middle" fontSize={10} fill="#fff" fontWeight={700}>
                            CP {Math.round(e.cp_watts)} W
                          </text>
                          <text x={x} y={y + POINT_R + 30} textAnchor="middle" fontSize={10} fill="#94a3b8">
                            {fmtDate(e.recorded_at)}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
            ) : null}

            {/* Pagination */}
            <div className="journal-pagination">
              <button
                className="btn-ghost btn-sm"
                onClick={() => setPageIndex(p => p + 1)}
                disabled={!hasOlderPage}
              >
                ← Older
              </button>
              <span className="journal-page-label">
                {pageIndex === 0 ? 'Most recent' : `${pageIndex * windowMonths + windowMonths} – ${pageIndex * windowMonths} mo ago`}
              </span>
              <button
                className="btn-ghost btn-sm"
                onClick={() => setPageIndex(p => p - 1)}
                disabled={!hasNewerPage}
              >
                Newer →
              </button>
            </div>
          </div>

          {/* ── Entry list ────────────────────────────────────────────────────── */}
          <div className="card journal-list-card">
            <h3 className="section-label">All entries</h3>
            <table className="journal-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>CP (W)</th>
                  <th>W′ (kJ)</th>
                  <th>R²</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...entries].reverse().map(e => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.recorded_at)}</td>
                    <td><strong>{Math.round(e.cp_watts)}</strong></td>
                    <td>{(e.w_prime_joules / 1000).toFixed(2)}</td>
                    <td className={e.r_squared != null && e.r_squared < 0.95 ? 'r2-low' : ''}>
                      {e.r_squared != null ? e.r_squared.toFixed(4) : '—'}
                    </td>
                    <td>
                      <button
                        className="btn-ghost btn-sm btn-danger-ghost"
                        onClick={() => setDeleteId(e.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Delete confirmation ────────────────────────────────────────────── */}
      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Delete entry?</h3>
            <p>This cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="btn-danger" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
