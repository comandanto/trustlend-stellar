import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb } from "../../helpers/fake-db";

const mockGetDb = vi.fn();
const mockVerifySignature = vi.fn();
vi.mock("@/lib/db/client", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/stellar/sep31", () => ({
  discoverSep31Anchor: vi.fn(),
  verifyAnchorSignature: (...args: unknown[]) => mockVerifySignature(...args),
}));

import { POST } from "@/app/api/webhooks/sep31/route";

const ORIGINAL_ENV = { ...process.env };

function request(signature?: string) {
  return new NextRequest("http://localhost/api/webhooks/sep31", {
    method: "POST",
    headers: signature ? { "x-stellar-signature": signature } : {},
    body: JSON.stringify({ id: "anchor-tx-1", status: "completed" }),
  });
}

describe("POST /api/webhooks/sep31", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    process.env.SEP31_ANCHOR_SIGNING_KEY = "G-ANCHOR-KEY";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects unsigned webhooks on testnet before querying the ledger", async () => {
    const db = createFakeDb();
    mockGetDb.mockReturnValue(db);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Signature header missing" });
    expect(mockVerifySignature).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });

  it("rejects a webhook with an invalid signature before querying the ledger", async () => {
    const db = createFakeDb();
    mockGetDb.mockReturnValue(db);
    mockVerifySignature.mockResolvedValue(false);

    const response = await POST(request("invalid-signature"));

    expect(response.status).toBe(401);
    expect(mockVerifySignature).toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });
});
