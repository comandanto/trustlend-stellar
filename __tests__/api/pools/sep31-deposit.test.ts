import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb } from "../../helpers/fake-db";

const mockRequireUser = vi.fn();
const mockGetDb = vi.fn();
const mockGetTransaction = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireAuthenticatedUser: (...args: unknown[]) => mockRequireUser(...args) }));
vi.mock("@/lib/rate-limit", () => ({ enforceRouteRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/kyc/middleware", () => ({ requireKycVerified: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/stellar/sep31", () => ({
  discoverSep31Anchor: vi.fn().mockResolvedValue({ directPaymentServer: "https://anchor.example/sep31" }),
  getSep31Transaction: (...args: unknown[]) => mockGetTransaction(...args),
}));

import { POST } from "@/app/api/pools/sep31-deposit/route";

const requestBody = {
  poolId: "pool-1",
  amount: 25,
  currency: "USD",
  anchorTxId: "anchor-tx-1",
  anchorJwt: "sep10-jwt",
  instructions: { how_to_pay: "wire" },
};

function request(body = requestBody) {
  return new NextRequest("http://localhost/api/pools/sep31-deposit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pools/sep31-deposit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({ user: { id: "lender-1" } });
    mockGetTransaction.mockResolvedValue({
      id: "anchor-tx-1",
      status: "pending_sender",
      asset_code: "USD",
      amount_in: "25.00",
    });
  });

  it("inquires with the anchor and records only matching transactions", async () => {
    const db = createFakeDb();
    db.queue([{ id: "pool-1" }]).queue([]).queue([{ id: "ledger-1" }]);
    mockGetDb.mockReturnValue(db);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mockGetTransaction).toHaveBeenCalledWith("https://anchor.example/sep31", "sep10-jwt", "anchor-tx-1");
    expect(db.calls.some((call) => call.method === "insert")).toBe(true);
  });

  it.each([
    [{ id: "different-id", status: "pending_sender", asset_code: "USD", amount_in: "25" }, "id"],
    [{ id: "anchor-tx-1", status: "completed", asset_code: "USD", amount_in: "25" }, "status"],
    [{ id: "anchor-tx-1", status: "pending_sender", asset_code: "EUR", amount_in: "25" }, "currency"],
    [{ id: "anchor-tx-1", status: "pending_sender", asset_code: "USD", amount_in: "24" }, "amount"],
  ])("rejects when anchor transaction %s does not match", async (anchorTransaction) => {
    const db = createFakeDb();
    db.queue([{ id: "pool-1" }]);
    mockGetDb.mockReturnValue(db);
    mockGetTransaction.mockResolvedValue(anchorTransaction);

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("does not insert if the anchor inquiry fails", async () => {
    const db = createFakeDb();
    mockGetDb.mockReturnValue(db);
    mockGetTransaction.mockRejectedValue(new Error("anchor unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });
});
