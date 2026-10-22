"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { LineChartSkeleton } from "@/components/dashboard/ChartSkeleton";
import { formatXlm } from "@/lib/utils/formatting";
import type { PerformanceRange, UtilizationPoint, UtilizationSummary } from "@/lib/pools/performance";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PerformanceResponse {
  success: true;
  range: PerformanceRange;
  days: number;
  poolId: string | null;
  points: UtilizationPoint[];
  summary: UtilizationSummary;
}

const CHART_HEIGHT = 300;

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

/** `YYYY-MM-DD` (UTC day) → "Oct 3" / "Oct 3, 2026". */
export function formatChartDate(date: string, withYear = false): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return date;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** Rows shown in the hover tooltip for one day. */
export function describeUtilizationPoint(point: UtilizationPoint): Array<{ label: string; value: string }> {
  const rows = [
    { label: "Utilization", value: formatPercent(point.utilizationRate) },
    { label: "Borrowed volume", value: formatXlm(point.borrowed) },
    { label: "Pool capacity", value: formatXlm(point.totalLiquidity) },
    { label: "Available", value: formatXlm(point.available) },
  ];
  if (point.newBorrowed > 0) rows.push({ label: "New loans", value: formatXlm(point.newBorrowed) });
  return rows;
}

function utilizationColor(rate: number): string {
  if (rate >= 90) return "var(--danger)";
  if (rate >= 75) return "var(--warning)";
  return "var(--accent)";
}

// ─── Chart ────────────────────────────────────────────────────────────────────

const VB_W = 1000;
const VB_H = CHART_HEIGHT;
const PAD_TOP = 12;
const PAD_BOTTOM = 4;
const Y_TICKS = [0, 25, 50, 75, 100];

const xFor = (i: number, n: number) => (n <= 1 ? VB_W / 2 : (i / (n - 1)) * VB_W);
const yFor = (rate: number) =>
  PAD_TOP + (1 - Math.min(100, Math.max(0, rate)) / 100) * (VB_H - PAD_TOP - PAD_BOTTOM);
/** Same positions as percentages of the plot box, for HTML overlays. */
const leftPct = (i: number, n: number) => (xFor(i, n) / VB_W) * 100;
const topPct = (rate: number) => (yFor(rate) / VB_H) * 100;

/**
 * Responsive utilization area chart (0–100 %) with a hover / touch / keyboard
 * tooltip. Exported separately from the data-fetching wrapper so it can be
 * rendered with fixture data.
 */
export function UtilizationAreaChart({
  points,
  initialActiveIndex = null,
}: {
  points: UtilizationPoint[];
  /** Pre-selected point (tests / server render); hover replaces it. */
  initialActiveIndex?: number | null;
}) {
  const [active, setActive] = useState<number | null>(initialActiveIndex);
  const plotRef = useRef<HTMLDivElement>(null);
  const gradientId = `util-grad-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const n = points.length;

  const indexFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const rect = plotRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || n === 0) return null;
      const ratio = (event.clientX - rect.left) / rect.width;
      return Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))));
    },
    [n],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const current = active ?? n - 1;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "ArrowRight") next = Math.min(n - 1, current + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = n - 1;
    else if (event.key === "Escape") next = null;
    else return;
    event.preventDefault();
    setActive(next);
  };

  if (n === 0) return null;

  const coords = points.map((p, i) => `${xFor(i, n)},${yFor(p.utilizationRate)}`);
  const linePath = `M ${coords.join(" L ")}`;
  const areaPath = `${linePath} L ${xFor(n - 1, n)},${VB_H} L ${xFor(0, n)},${VB_H} Z`;

  const activePoint = active !== null ? points[active] : null;
  const activeLeft = active !== null ? leftPct(active, n) : 0;
  const tooltipOnLeft = activeLeft > 55;

  // ~5 evenly spaced x-axis labels, always including both ends.
  const labelCount = Math.min(n, 5);
  const xLabelIndexes = Array.from(new Set(
    Array.from({ length: labelCount }, (_, k) => Math.round((k / Math.max(1, labelCount - 1)) * (n - 1))),
  ));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "2.75rem minmax(0, 1fr)", gap: "0.25rem 0.5rem" }}>
      {/* Y axis */}
      <div aria-hidden="true" style={{ position: "relative", height: CHART_HEIGHT }}>
        {Y_TICKS.map((tick) => (
          <span
            key={tick}
            style={{
              position: "absolute",
              right: 0,
              top: `${topPct(tick)}%`,
              transform: "translateY(-50%)",
              fontSize: "0.7rem",
              color: "var(--fg-muted)",
            }}
          >
            {tick}%
          </span>
        ))}
      </div>

      {/* Plot */}
      <div
        ref={plotRef}
        role="group"
        tabIndex={0}
        aria-label="Pool utilization over time. Use the left and right arrow keys to inspect each day."
        onPointerMove={(e) => setActive(indexFromPointer(e))}
        onPointerDown={(e) => setActive(indexFromPointer(e))}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        onFocus={() => setActive((prev) => prev ?? n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
        style={{ position: "relative", height: CHART_HEIGHT, width: "100%", touchAction: "pan-y", outlineOffset: 4 }}
      >
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {Y_TICKS.map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={VB_W}
              y1={yFor(tick)}
              y2={yFor(tick)}
              stroke="var(--border)"
              strokeDasharray={tick === 0 ? undefined : "4 6"}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path
            d={linePath}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {activePoint ? (
          <>
            {/* Crosshair + marker as HTML so they don't stretch with the SVG. */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${activeLeft}%`,
                width: 1,
                background: "var(--border-strong)",
                pointerEvents: "none",
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: `${activeLeft}%`,
                top: `${topPct(activePoint.utilizationRate)}%`,
                width: 12,
                height: 12,
                transform: "translate(-50%, -50%)",
                borderRadius: "50%",
                background: "var(--surface)",
                border: `3px solid ${utilizationColor(activePoint.utilizationRate)}`,
                pointerEvents: "none",
              }}
            />
            <div
              role="status"
              aria-live="polite"
              data-testid="utilization-tooltip"
              style={{
                position: "absolute",
                top: 8,
                left: `${activeLeft}%`,
                transform: tooltipOnLeft ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
                padding: "0.6rem 0.8rem",
                borderRadius: "0.6rem",
                pointerEvents: "none",
                minWidth: 190,
                maxWidth: "min(260px, 70vw)",
                zIndex: 2,
              }}
            >
              <p style={{ margin: "0 0 0.35rem", fontSize: "0.75rem", fontWeight: 700, color: "var(--fg-muted)" }}>
                {formatChartDate(activePoint.date, true)}
              </p>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto auto", gap: "0.2rem 0.75rem", fontSize: "0.78rem" }}>
                {describeUtilizationPoint(activePoint).map((row, i) => (
                  <div key={row.label} style={{ display: "contents" }}>
                    <dt style={{ color: "var(--fg-muted)" }}>{row.label}</dt>
                    <dd
                      style={{
                        margin: 0,
                        textAlign: "right",
                        fontWeight: i === 0 ? 800 : 600,
                        color: i === 0 ? utilizationColor(activePoint.utilizationRate) : "var(--fg)",
                      }}
                    >
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        ) : null}
      </div>

      {/* X axis */}
      <div />
      <div aria-hidden="true" style={{ position: "relative", height: "1.1rem" }}>
        {xLabelIndexes.map((i) => (
          <span
            key={i}
            style={{
              position: "absolute",
              left: `${leftPct(i, n)}%`,
              transform: i === 0 ? "none" : i === n - 1 ? "translateX(-100%)" : "translateX(-50%)",
              fontSize: "0.7rem",
              color: "var(--fg-muted)",
              whiteSpace: "nowrap",
            }}
          >
            {formatChartDate(points[i].date)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Card with data fetching ──────────────────────────────────────────────────

function SummaryStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: "0.72rem", opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </p>
      <p style={{ margin: "0.15rem 0 0", fontSize: "1.15rem", fontWeight: 700, color: color ?? "inherit" }}>{value}</p>
    </div>
  );
}

/**
 * Lender dashboard card: fetches GET /api/pools/performance and renders the
 * utilization history with summary stats.
 */
export function LenderUtilizationChart({
  range = "30d",
  poolId = null,
}: {
  range?: PerformanceRange;
  poolId?: string | null;
}) {
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ range });
      if (poolId) params.set("poolId", poolId);
      const res = await fetch(`/api/pools/performance?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load pool utilization.");
      setData(body as PerformanceResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }, [range, poolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = data?.days ?? Number.parseInt(range, 10);
  const isEmpty = !!data && data.points.every((p) => p.totalLiquidity === 0 && p.borrowed === 0);

  return (
    <article className="workspace-card workspace-card--full" aria-busy={isLoading}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", marginBottom: "1rem" }}>
        <div>
          <h2 className="workspace-card-title" style={{ margin: 0 }}>Pool Utilization</h2>
          <p className="workspace-card-copy" style={{ margin: "0.2rem 0 0", fontSize: "0.82rem", opacity: 0.65 }}>
            Borrowed share of pool capacity, last {days} days{poolId ? "" : " · all pools"}
          </p>
        </div>
      </div>

      {isLoading ? (
        <LineChartSkeleton pointCount={10} height={CHART_HEIGHT} />
      ) : error ? (
        <div role="alert" style={{ padding: "1.5rem 0", textAlign: "center" }}>
          <p className="workspace-card-copy" style={{ marginBottom: "0.75rem" }}>{error}</p>
          <button type="button" className="workspace-button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : !data || isEmpty ? (
        <p className="workspace-card-copy" style={{ padding: "2rem 0", textAlign: "center", opacity: 0.6 }}>
          No pool liquidity in this period yet. Utilization will appear once lenders deposit into a pool.
        </p>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: "0.75rem 1rem",
              marginBottom: "1.25rem",
            }}
          >
            <SummaryStat
              label="Current"
              value={formatPercent(data.summary.currentUtilization)}
              color={utilizationColor(data.summary.currentUtilization)}
            />
            <SummaryStat label={`${data.days}-day average`} value={formatPercent(data.summary.averageUtilization)} />
            <SummaryStat label="Peak" value={formatPercent(data.summary.peakUtilization)} />
            <SummaryStat label="Borrowed" value={formatXlm(data.summary.currentBorrowed)} />
            <SummaryStat label="Pool capacity" value={formatXlm(data.summary.currentLiquidity)} />
          </div>
          <UtilizationAreaChart points={data.points} />
        </>
      )}
    </article>
  );
}
