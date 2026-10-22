import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb } from "../../helpers/fake-db";

vi.mock("@/lib/rate-limit", () => ({ enforceRouteRateLimit: vi.fn().mockResolvedValue(null) }));

const mockGetDb = vi.fn();
vi.mock("@/lib/db/client", () => ({ getDb: () => mockGetDb() }));

import { GET } from "@/app/api/pools/performance/route";

const POOL_ID = "aaaa0000-0000-4000-8000-000000000001";

function request(query = "") {
  return new NextRequest(`http://localhost/api/pools/performance${query}`);
}

describe("GET /api/pools/performance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns a 30-day utilization series by default", async () => {
    const db = createFakeDb();
    db.queue([{ total: "1000" }]); // current Σ total_liquidity
    db.queue([
      { category: "deposit", amount: "400", createdAt: new Date("2026-10-16T10:00:00Z") },
      { category: "withdrawal", amount: "100", createdAt: new Date("2026-10-17T08:00:00Z") },
    ]);
    db.queue([
      {
        principal: "350",
        status: "active",
        approvedAt: new Date("2026-10-15T09:00:00Z"),
        closedAt: null,
        defaultedAt: null,
        updatedAt: new Date("2026-10-15T09:00:00Z"),
        lastRepaymentAt: null,
      },
      {
        principal: "200",
        status: "repaid",
        approvedAt: new Date("2026-10-16T12:00:00Z"),
        closedAt: null,
        defaultedAt: null,
        updatedAt: new Date("2026-10-17T06:00:00Z"),
        // Raw subquery values come back as strings from the driver.
        lastRepaymentAt: "2026-10-17T06:00:00Z",
      },
    ]);
    mockGetDb.mockReturnValue(db);

    const res = await GET(request("?range=30d"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage");
    const body = await res.json();
    expect(body).toMatchObject({ success: true, range: "30d", days: 30, poolId: null });
    expect(body.points).toHaveLength(30);

    const byDate = Object.fromEntries(body.points.map((p: { date: string }) => [p.date, p]));
    expect(byDate["2026-10-15"]).toMatchObject({ totalLiquidity: 700, borrowed: 350, utilizationRate: 50 });
    expect(byDate["2026-10-16"]).toMatchObject({ totalLiquidity: 1100, borrowed: 550, utilizationRate: 50 });
    expect(byDate["2026-10-17"]).toMatchObject({
      totalLiquidity: 1000,
      borrowed: 350,
      available: 650,
      utilizationRate: 35,
    });
    // Before any loan existed the pool was idle.
    expect(byDate["2026-10-14"]).toMatchObject({ totalLiquidity: 700, borrowed: 0, utilizationRate: 0 });

    expect(body.summary).toMatchObject({
      currentUtilization: 35,
      peakUtilization: 50,
      currentLiquidity: 1000,
      currentBorrowed: 350,
      borrowedVolume: 550,
    });
  });

  it("supports a single-pool query", async () => {
    const db = createFakeDb();
    db.queue([{ total: "0" }]).queue([]).queue([]);
    mockGetDb.mockReturnValue(db);

    const res = await GET(request(`?range=7d&poolId=${POOL_ID}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ range: "7d", days: 7, poolId: POOL_ID });
    expect(body.points).toHaveLength(7);
    expect(body.points.every((p: { utilizationRate: number }) => p.utilizationRate === 0)).toBe(true);
  });

  it("rejects an unsupported range with 400", async () => {
    mockGetDb.mockReturnValue(createFakeDb());
    const res = await GET(request("?range=1y"));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed poolId with 400", async () => {
    mockGetDb.mockReturnValue(createFakeDb());
    const res = await GET(request("?poolId=not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns 503 when the database is not configured", async () => {
    mockGetDb.mockReturnValue(null);
    const res = await GET(request());
    expect(res.status).toBe(503);
  });

  it("returns 500 without leaking internals when a query fails", async () => {
    const db = createFakeDb();
    db.select = () => {
      throw new Error("connection reset by peer");
    };
    mockGetDb.mockReturnValue(db);

    const res = await GET(request());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to load pool performance" });
  });
});
