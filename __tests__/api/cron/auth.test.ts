import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Every cron route must enforce the shared fail-closed check from
// lib/auth/cron.ts. The jobs themselves are mocked so a request that slips
// past auth is observable as a call to the job runner.

const jobRunners = {
  defaultManagement: vi.fn(),
  liquidation: vi.fn(),
  paymentDue: vi.fn(),
  priceOracle: vi.fn(),
  reputationScoring: vi.fn(),
};

vi.mock("@/lib/scheduler/default-management", () => ({
  runDefaultManagement: () => jobRunners.defaultManagement(),
}));

vi.mock("@/scripts/liquidation-keeper", () => ({
  loadConfig: () => ({}),
  runLiquidationKeeper: () => jobRunners.liquidation(),
}));

vi.mock("@/lib/stellar/server-contract", () => ({
  getAdminKeypair: () => ({}),
}));

vi.mock("@/lib/scheduler/payment-due", () => ({
  runPaymentDueScheduler: () => jobRunners.paymentDue(),
}));

vi.mock("@/scripts/price-oracle-keeper", () => ({
  loadOracleConfig: () => ({}),
  runOracleCycle: () => jobRunners.priceOracle(),
  createInitialState: () => ({}),
  createDryRunPublisher: () => ({}),
}));

vi.mock("@/lib/oracle/sources", () => ({
  createDefaultSources: () => [{}],
}));

vi.mock("@/lib/reputation/daily-sync", () => ({
  runDailyReputationRecalculation: () => jobRunners.reputationScoring(),
}));

import * as defaultManagement from "@/app/api/cron/default-management/route";
import * as liquidation from "@/app/api/cron/liquidation/route";
import * as paymentDue from "@/app/api/cron/payment-due/route";
import * as priceOracle from "@/app/api/cron/price-oracle/route";
import * as reputationScoring from "@/app/api/cron/reputation-scoring/route";

type Handler = (req: NextRequest) => Promise<Response>;

const ROUTES: Array<{
  name: string;
  POST: Handler;
  GET: Handler;
  runner: ReturnType<typeof vi.fn>;
}> = [
  { name: "default-management", ...defaultManagement, runner: jobRunners.defaultManagement },
  { name: "liquidation", ...liquidation, runner: jobRunners.liquidation },
  { name: "payment-due", ...paymentDue, runner: jobRunners.paymentDue },
  { name: "price-oracle", ...priceOracle, runner: jobRunners.priceOracle },
  { name: "reputation-scoring", ...reputationScoring, runner: jobRunners.reputationScoring },
];

function req(name: string, method: "GET" | "POST", token?: string): NextRequest {
  return new NextRequest(`http://localhost/api/cron/${name}`, {
    method,
    headers: token !== undefined ? { authorization: `Bearer ${token}` } : {},
  });
}

describe.each(ROUTES)("/api/cron/$name authorization", ({ name, POST, GET, runner }) => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.CRON_SECRET;
    vi.clearAllMocks();
    runner.mockResolvedValue({ results: [] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(["production", "test"])(
    "rejects calls with 500 when CRON_SECRET is missing and NODE_ENV=%s",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);

      for (const [method, handler] of [["POST", POST], ["GET", GET]] as const) {
        const res = await handler(req(name, method));
        expect(res.status).toBe(500);
        expect((await res.json()).ok).toBe(false);

        // Guessing what an unset secret would interpolate to must not help.
        const guessed = await handler(req(name, method, "undefined"));
        expect(guessed.status).toBe(500);
      }
      expect(runner).not.toHaveBeenCalled();
    },
  );

  it("rejects a wrong or missing bearer token with 401", async () => {
    process.env.CRON_SECRET = "s3cret";

    expect((await POST(req(name, "POST", "wrong"))).status).toBe(401);
    expect((await POST(req(name, "POST"))).status).toBe(401);
    expect((await GET(req(name, "GET", "wrong"))).status).toBe(401);
    expect(runner).not.toHaveBeenCalled();
  });

  it("runs the job for the correct bearer token", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await POST(req(name, "POST", "s3cret"));

    expect(res.status).toBe(200);
    expect(runner).toHaveBeenCalledOnce();
  });

  it("allows unauthenticated calls only in development when CRON_SECRET is unset", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const res = await POST(req(name, "POST"));

    expect(res.status).toBe(200);
    expect(runner).toHaveBeenCalledOnce();
  });
});
