/**
 * lib/pools/performance.ts
 *
 * Historical pool volume & liquidity utilization (issue #333), served by
 * GET /api/pools/performance and charted on the lender dashboard.
 *
 * There is no snapshot table, so the daily series is reconstructed from the
 * records the app already keeps:
 *
 *  - **Pool capacity** (`totalLiquidity`) is anchored to the current
 *    `lending_pools.total_liquidity` and walked *backwards* through confirmed
 *    pool deposits / withdrawals in `ledger_transactions` (ref_type
 *    `pool_position`), mirroring how the deposit, withdraw and SEP-31 routes
 *    move `total_liquidity`.
 *  - **Borrowed** is the principal of pool-funded loans outstanding at the end
 *    of each day: a loan counts from `approved_at` (when the pool's available
 *    liquidity is drawn down) until it closes — `closed_at`, `defaulted_at`, or
 *    for repaid / cancelled loans the last repayment (falling back to
 *    `updated_at`). `lending_pools.total_borrowed` is not used because no code
 *    path maintains it.
 *
 * Utilization = (borrowed / totalLiquidity) × 100, clamped to 0–100 via the
 * same `computeUtilization` the floating-rate model uses.
 *
 * All amounts are XLM (the `money` columns store XLM, not stroops).
 */

import { and, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import { ledgerTransactions, lendingPools, loanRepayments, loans, poolPositions } from "@/lib/db/schema";
import { computeUtilization } from "@/lib/dashboard/interest-rates";

type Db = NonNullable<ReturnType<typeof getDb>>;

const DAY_MS = 24 * 60 * 60 * 1000;

export const PERFORMANCE_RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type PerformanceRange = keyof typeof PERFORMANCE_RANGES;
export const DEFAULT_PERFORMANCE_RANGE: PerformanceRange = "30d";

/** Parses `?range=`; missing → default, unknown → null (caller returns 400). */
export function parsePerformanceRange(raw: string | null | undefined): PerformanceRange | null {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_PERFORMANCE_RANGE;
  // Own-property check: `"toString" in obj` would be true via the prototype.
  return Object.prototype.hasOwnProperty.call(PERFORMANCE_RANGES, raw) ? (raw as PerformanceRange) : null;
}

export interface PoolFlowEvent {
  at: Date;
  kind: "deposit" | "withdrawal";
  /** XLM, positive. */
  amount: number;
}

export interface PoolLoanSpan {
  /** XLM principal drawn from the pool. */
  principal: number;
  /** When the pool's liquidity was committed (`approved_at`). */
  startAt: Date;
  /** When the principal stopped being outstanding; null while still open. */
  endAt: Date | null;
}

export interface UtilizationPoint {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Pool capacity at the end of the day (XLM). */
  totalLiquidity: number;
  /** Outstanding pool-loan principal at the end of the day (XLM). */
  borrowed: number;
  /** totalLiquidity − borrowed, floored at 0 (XLM). */
  available: number;
  /** (borrowed / totalLiquidity) × 100, 0–100, two decimals. */
  utilizationRate: number;
  /** New pool-loan principal committed during the day (XLM). */
  newBorrowed: number;
  /** Deposits credited during the day (XLM). */
  deposits: number;
  /** Withdrawals paid out during the day (XLM). */
  withdrawals: number;
}

export interface UtilizationSummary {
  currentUtilization: number;
  averageUtilization: number;
  peakUtilization: number;
  currentLiquidity: number;
  currentBorrowed: number;
  /** Σ newBorrowed over the window. */
  borrowedVolume: number;
  /** Σ deposits − Σ withdrawals over the window. */
  netFlow: number;
}

const round = (value: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** Amounts are `numeric(20, 6)`; keep that precision and kill float dust. */
const xlm = (value: number) => round(value, 6);

function startOfUtcDay(at: Date): number {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

/**
 * Builds one point per UTC day for the last `days` days (oldest first). Each
 * point is the state at the end of that day; the final point is "now".
 */
export function buildUtilizationSeries(input: {
  now: Date;
  days: number;
  currentTotalLiquidity: number;
  flows: PoolFlowEvent[];
  loans: PoolLoanSpan[];
}): UtilizationPoint[] {
  const { now, days, currentTotalLiquidity, flows, loans: spans } = input;
  const nowMs = now.getTime();
  const todayStart = startOfUtcDay(now);
  const points: UtilizationPoint[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const dayStart = todayStart - i * DAY_MS;
    const dayEnd = Math.min(dayStart + DAY_MS, nowMs);

    // Undo every flow that happened after this snapshot.
    let liquidity = currentTotalLiquidity;
    let deposits = 0;
    let withdrawals = 0;
    for (const flow of flows) {
      const t = flow.at.getTime();
      const signed = flow.kind === "deposit" ? flow.amount : -flow.amount;
      if (t >= dayEnd) liquidity -= signed;
      if (t >= dayStart && t < dayEnd) {
        if (flow.kind === "deposit") deposits += flow.amount;
        else withdrawals += flow.amount;
      }
    }
    liquidity = Math.max(0, liquidity);

    let borrowed = 0;
    let newBorrowed = 0;
    for (const span of spans) {
      const start = span.startAt.getTime();
      const end = span.endAt?.getTime() ?? Number.POSITIVE_INFINITY;
      if (start < dayEnd && end >= dayEnd) borrowed += span.principal;
      if (start >= dayStart && start < dayEnd) newBorrowed += span.principal;
    }

    points.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      totalLiquidity: xlm(liquidity),
      borrowed: xlm(borrowed),
      available: xlm(Math.max(0, liquidity - borrowed)),
      utilizationRate: round(computeUtilization(borrowed, liquidity) * 100, 2),
      newBorrowed: xlm(newBorrowed),
      deposits: xlm(deposits),
      withdrawals: xlm(withdrawals),
    });
  }

  return points;
}

export function summarizeUtilization(points: UtilizationPoint[]): UtilizationSummary {
  const last = points[points.length - 1];
  const rates = points.map((p) => p.utilizationRate);
  return {
    currentUtilization: last?.utilizationRate ?? 0,
    averageUtilization: rates.length ? round(rates.reduce((a, b) => a + b, 0) / rates.length, 2) : 0,
    peakUtilization: rates.length ? Math.max(...rates) : 0,
    currentLiquidity: last?.totalLiquidity ?? 0,
    currentBorrowed: last?.borrowed ?? 0,
    borrowedVolume: xlm(points.reduce((sum, p) => sum + p.newBorrowed, 0)),
    netFlow: xlm(points.reduce((sum, p) => sum + p.deposits - p.withdrawals, 0)),
  };
}

/** Picks when a pool loan stopped tying up liquidity. */
export function resolveLoanEnd(row: {
  status: string;
  closedAt: Date | null;
  defaultedAt: Date | null;
  lastRepaymentAt: Date | null;
  updatedAt: Date;
}): Date | null {
  if (row.closedAt) return row.closedAt;
  if (row.defaultedAt) return row.defaultedAt;
  if (row.status === "repaid" || row.status === "cancelled" || row.status === "defaulted") {
    return row.lastRepaymentAt ?? row.updatedAt;
  }
  return null;
}

const toDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
};

export interface PoolPerformance {
  range: PerformanceRange;
  days: number;
  poolId: string | null;
  generatedAt: string;
  points: UtilizationPoint[];
  summary: UtilizationSummary;
}

/**
 * Loads the raw rows for the window and builds the series. Pass `poolId` for a
 * single pool; omit it for the platform-wide aggregate across all pools.
 */
export async function fetchPoolPerformance(
  db: Db,
  options: { range: PerformanceRange; poolId?: string | null; now?: Date },
): Promise<PoolPerformance> {
  const now = options.now ?? new Date();
  const days = PERFORMANCE_RANGES[options.range];
  const poolId = options.poolId ?? null;
  const windowStart = new Date(startOfUtcDay(now) - (days - 1) * DAY_MS);

  const lastRepayment = sql<Date | null>`(
    select max(${loanRepayments.paidAt}) from ${loanRepayments}
    where ${loanRepayments.loanId} = ${loans.id}
  )`;

  const [[liquidityRow], flowRows, loanRows] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${lendingPools.totalLiquidity}), 0)` })
      .from(lendingPools)
      .where(poolId ? eq(lendingPools.id, poolId) : undefined),
    db
      .select({
        category: ledgerTransactions.category,
        amount: ledgerTransactions.amount,
        createdAt: ledgerTransactions.createdAt,
      })
      .from(ledgerTransactions)
      .innerJoin(poolPositions, eq(poolPositions.id, ledgerTransactions.refId))
      .where(
        and(
          eq(ledgerTransactions.refType, "pool_position"),
          eq(ledgerTransactions.status, "confirmed"),
          inArray(ledgerTransactions.category, ["deposit", "withdrawal"]),
          gte(ledgerTransactions.createdAt, windowStart),
          poolId ? eq(poolPositions.poolId, poolId) : undefined,
        ),
      ),
    db
      .select({
        principal: loans.principalAmount,
        status: loans.status,
        approvedAt: loans.approvedAt,
        closedAt: loans.closedAt,
        defaultedAt: loans.defaultedAt,
        updatedAt: loans.updatedAt,
        lastRepaymentAt: lastRepayment,
      })
      .from(loans)
      .where(
        and(
          poolId ? eq(loans.poolId, poolId) : isNotNull(loans.poolId),
          isNotNull(loans.approvedAt),
          ne(loans.status, "requested"),
        ),
      ),
  ]);

  const flows: PoolFlowEvent[] = flowRows.flatMap((row) => {
    const at = toDate(row.createdAt);
    const amount = Number(row.amount);
    if (!at || !Number.isFinite(amount) || amount <= 0) return [];
    return [{ at, kind: row.category === "withdrawal" ? "withdrawal" : "deposit", amount }];
  });

  const spans: PoolLoanSpan[] = loanRows.flatMap((row) => {
    const startAt = toDate(row.approvedAt);
    const principal = Number(row.principal);
    if (!startAt || !Number.isFinite(principal) || principal <= 0) return [];
    const endAt = resolveLoanEnd({
      status: String(row.status),
      closedAt: toDate(row.closedAt),
      defaultedAt: toDate(row.defaultedAt),
      lastRepaymentAt: toDate(row.lastRepaymentAt),
      updatedAt: toDate(row.updatedAt) ?? now,
    });
    return [{ principal, startAt, endAt }];
  });

  const points = buildUtilizationSeries({
    now,
    days,
    currentTotalLiquidity: Number(liquidityRow?.total ?? 0),
    flows,
    loans: spans,
  });

  return {
    range: options.range,
    days,
    poolId,
    generatedAt: now.toISOString(),
    points,
    summary: summarizeUtilization(points),
  };
}
