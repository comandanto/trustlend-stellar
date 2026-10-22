import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  UtilizationAreaChart,
  describeUtilizationPoint,
  formatChartDate,
  formatPercent,
} from "@/components/dashboard/LenderUtilizationChart";
import { formatXlm } from "@/lib/utils/formatting";
import type { UtilizationPoint } from "@/lib/pools/performance";

const point = (date: string, overrides: Partial<UtilizationPoint> = {}): UtilizationPoint => ({
  date,
  totalLiquidity: 1100,
  borrowed: 550,
  available: 550,
  utilizationRate: 50,
  newBorrowed: 0,
  deposits: 0,
  withdrawals: 0,
  ...overrides,
});

describe("utilization tooltip content", () => {
  it("shows utilization %, borrowed volume and pool capacity in XLM", () => {
    const rows = describeUtilizationPoint(point("2026-10-16", { utilizationRate: 42.5 }));
    expect(rows.slice(0, 3)).toEqual([
      { label: "Utilization", value: "42.50%" },
      { label: "Borrowed volume", value: formatXlm(550) },
      { label: "Pool capacity", value: formatXlm(1100) },
    ]);
    expect(rows.find((r) => r.label === "New loans")).toBeUndefined();
  });

  it("adds the day's new loan volume when there was any", () => {
    const rows = describeUtilizationPoint(point("2026-10-16", { newBorrowed: 200 }));
    expect(rows).toContainEqual({ label: "New loans", value: formatXlm(200) });
  });

  it("formats values", () => {
    expect(formatPercent(35)).toBe("35.00%");
    expect(formatPercent(33.333)).toBe("33.33%");
    // UTC day must not shift with the runner's timezone.
    expect(formatChartDate("2026-10-01")).toMatch(/1/);
    expect(formatChartDate("2026-10-01", true)).toMatch(/2026/);
    expect(formatChartDate("garbage")).toBe("garbage");
  });
});

describe("UtilizationAreaChart", () => {
  const points = [
    point("2026-10-15", { totalLiquidity: 700, borrowed: 350, available: 350, utilizationRate: 50 }),
    point("2026-10-16", { totalLiquidity: 1100, borrowed: 550, available: 550, utilizationRate: 50, newBorrowed: 200 }),
    point("2026-10-17", { totalLiquidity: 1000, borrowed: 350, available: 650, utilizationRate: 35 }),
  ];

  it("renders an area and line path through every point", () => {
    const html = renderToStaticMarkup(createElement(UtilizationAreaChart, { points }));
    const paths = [...html.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    expect(paths).toHaveLength(2); // area + line
    // line: M + one L per remaining point
    expect(paths[1].match(/L/g)).toHaveLength(points.length - 1);
    expect(paths[0].endsWith("Z")).toBe(true);
    expect(html).not.toContain('data-testid="utilization-tooltip"');
  });

  it("renders the tooltip breakdown for the active point", () => {
    const html = renderToStaticMarkup(
      createElement(UtilizationAreaChart, { points, initialActiveIndex: 1 }),
    );
    expect(html).toContain('data-testid="utilization-tooltip"');
    expect(html).toContain("Utilization");
    expect(html).toContain("50.00%");
    expect(html).toContain("Borrowed volume");
    expect(html).toContain(formatXlm(550));
    expect(html).toContain("Pool capacity");
    expect(html).toContain(formatXlm(1100));
    expect(html).toContain("New loans");
  });

  it("is keyboard focusable for accessibility", () => {
    const html = renderToStaticMarkup(createElement(UtilizationAreaChart, { points }));
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="group"');
  });

  it("renders nothing without data", () => {
    expect(renderToStaticMarkup(createElement(UtilizationAreaChart, { points: [] }))).toBe("");
  });
});
