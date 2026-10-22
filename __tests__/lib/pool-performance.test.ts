import { describe, it, expect } from "vitest";
import {
  buildUtilizationSeries,
  parsePerformanceRange,
  resolveLoanEnd,
  summarizeUtilization,
  type PoolFlowEvent,
  type PoolLoanSpan,
} from "@/lib/pools/performance";

const at = (iso: string) => new Date(iso);

describe("parsePerformanceRange", () => {
  it("defaults to 30d when missing", () => {
    expect(parsePerformanceRange(null)).toBe("30d");
    expect(parsePerformanceRange(undefined)).toBe("30d");
    expect(parsePerformanceRange("")).toBe("30d");
  });

  it("accepts the supported ranges", () => {
    expect(parsePerformanceRange("7d")).toBe("7d");
    expect(parsePerformanceRange("30d")).toBe("30d");
    expect(parsePerformanceRange("90d")).toBe("90d");
  });

  it("rejects anything else", () => {
    expect(parsePerformanceRange("31d")).toBeNull();
    expect(parsePerformanceRange("toString")).toBeNull();
    expect(parsePerformanceRange("30")).toBeNull();
  });
});

describe("buildUtilizationSeries", () => {
  // Window: Oct 15, 16, 17 (2026); "now" is midday on the 17th.
  const now = at("2026-10-17T12:00:00Z");

  const flows: PoolFlowEvent[] = [
    { at: at("2026-10-14T00:00:00Z"), kind: "deposit", amount: 50 }, // before the window
    { at: at("2026-10-16T10:00:00Z"), kind: "deposit", amount: 400 },
    { at: at("2026-10-17T08:00:00Z"), kind: "withdrawal", amount: 100 },
  ];

  const loans: PoolLoanSpan[] = [
    { principal: 350, startAt: at("2026-10-15T09:00:00Z"), endAt: null }, // still open
    { principal: 200, startAt: at("2026-10-16T12:00:00Z"), endAt: at("2026-10-17T06:00:00Z") },
    { principal: 999, startAt: at("2026-10-01T00:00:00Z"), endAt: at("2026-10-10T00:00:00Z") }, // settled earlier
  ];

  const series = buildUtilizationSeries({
    now,
    days: 3,
    currentTotalLiquidity: 1000,
    flows,
    loans,
  });

  it("returns one point per UTC day, oldest first", () => {
    expect(series.map((p) => p.date)).toEqual(["2026-10-15", "2026-10-16", "2026-10-17"]);
  });

  it("walks pool capacity back from the current total through later flows", () => {
    // 17th (now): 1000. 16th end: undo the 17th's withdrawal → 1100.
    // 15th end: also undo the 16th's deposit → 700.
    expect(series.map((p) => p.totalLiquidity)).toEqual([700, 1100, 1000]);
  });

  it("counts loan principal outstanding at the end of each day", () => {
    expect(series.map((p) => p.borrowed)).toEqual([350, 550, 350]);
    expect(series.map((p) => p.available)).toEqual([350, 550, 650]);
  });

  it("computes utilization as (borrowed / totalLiquidity) × 100", () => {
    expect(series.map((p) => p.utilizationRate)).toEqual([50, 50, 35]);
  });

  it("reports the day's volume: new loans, deposits and withdrawals", () => {
    expect(series.map((p) => p.newBorrowed)).toEqual([350, 200, 0]);
    expect(series.map((p) => p.deposits)).toEqual([0, 400, 0]);
    expect(series.map((p) => p.withdrawals)).toEqual([0, 0, 100]);
  });

  it("summarizes the window", () => {
    expect(summarizeUtilization(series)).toEqual({
      currentUtilization: 35,
      averageUtilization: 45,
      peakUtilization: 50,
      currentLiquidity: 1000,
      currentBorrowed: 350,
      borrowedVolume: 550,
      netFlow: 300,
    });
  });

  it("rounds utilization to two decimals", () => {
    const [point] = buildUtilizationSeries({
      now,
      days: 1,
      currentTotalLiquidity: 3,
      flows: [],
      loans: [{ principal: 1, startAt: at("2026-10-01T00:00:00Z"), endAt: null }],
    });
    expect(point.utilizationRate).toBe(33.33);
  });

  it("returns 0% when the pool has no liquidity and caps at 100%", () => {
    const [empty] = buildUtilizationSeries({ now, days: 1, currentTotalLiquidity: 0, flows: [], loans: [] });
    expect(empty).toMatchObject({ totalLiquidity: 0, borrowed: 0, utilizationRate: 0 });

    const [over] = buildUtilizationSeries({
      now,
      days: 1,
      currentTotalLiquidity: 100,
      flows: [],
      loans: [{ principal: 150, startAt: at("2026-10-01T00:00:00Z"), endAt: null }],
    });
    expect(over.utilizationRate).toBe(100);
    expect(over.available).toBe(0);
  });

  it("never reports negative capacity when history is incomplete", () => {
    const [point] = buildUtilizationSeries({
      now,
      days: 2,
      currentTotalLiquidity: 100,
      flows: [{ at: at("2026-10-17T01:00:00Z"), kind: "deposit", amount: 500 }],
      loans: [],
    });
    expect(point.totalLiquidity).toBe(0);
  });

  it("produces a 30-point series for a 30-day window", () => {
    const points = buildUtilizationSeries({ now, days: 30, currentTotalLiquidity: 10, flows: [], loans: [] });
    expect(points).toHaveLength(30);
    expect(points[0].date).toBe("2026-09-18");
    expect(points[29].date).toBe("2026-10-17");
  });
});

describe("resolveLoanEnd", () => {
  const base = {
    closedAt: null,
    defaultedAt: null,
    lastRepaymentAt: null,
    updatedAt: at("2026-10-05T00:00:00Z"),
  };

  it("keeps open loans outstanding", () => {
    for (const status of ["approved", "funded", "active"]) {
      expect(resolveLoanEnd({ ...base, status })).toBeNull();
    }
  });

  it("prefers closedAt, then defaultedAt", () => {
    expect(resolveLoanEnd({ ...base, status: "repaid", closedAt: at("2026-10-02T00:00:00Z") })).toEqual(
      at("2026-10-02T00:00:00Z"),
    );
    expect(resolveLoanEnd({ ...base, status: "defaulted", defaultedAt: at("2026-10-03T00:00:00Z") })).toEqual(
      at("2026-10-03T00:00:00Z"),
    );
  });

  it("ends a repaid loan at its last repayment, else at updatedAt", () => {
    expect(resolveLoanEnd({ ...base, status: "repaid", lastRepaymentAt: at("2026-10-04T00:00:00Z") })).toEqual(
      at("2026-10-04T00:00:00Z"),
    );
    expect(resolveLoanEnd({ ...base, status: "cancelled" })).toEqual(base.updatedAt);
  });
});
