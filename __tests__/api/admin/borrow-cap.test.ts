import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockRequireApiAdmin, mockSetPoolBorrowCap, MockUnauthorizedError } = vi.hoisted(() => {
  class MockUnauthorizedError extends Error {
    constructor(message = "Not authenticated") {
      super(message);
      this.name = "UnauthorizedError";
    }
  }

  return {
    mockRequireApiAdmin: vi.fn(),
    mockSetPoolBorrowCap: vi.fn(),
    MockUnauthorizedError,
  };
});

vi.mock("@/lib/auth/session", () => ({
  requireApiAdmin: () => mockRequireApiAdmin(),
  UnauthorizedError: MockUnauthorizedError,
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRouteRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/app/actions/admin-pools", () => ({
  setPoolBorrowCap: (...args: unknown[]) => mockSetPoolBorrowCap(...args),
}));

import { PUT } from "@/app/api/admin/pools/[id]/borrow-cap/route";

function makeRequest() {
  return new NextRequest("http://localhost/api/admin/pools/pool-1/borrow-cap", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ borrowCap: 1000 }),
  });
}

describe("PUT /api/admin/pools/[id]/borrow-cap authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiAdmin.mockResolvedValue({ id: "admin-1" });
    mockSetPoolBorrowCap.mockResolvedValue({ success: true });
  });

  it("returns a JSON 401 for an unauthenticated request", async () => {
    mockRequireApiAdmin.mockRejectedValue(new MockUnauthorizedError("Not authenticated"));

    const response = await PUT(makeRequest(), { params: Promise.resolve({ id: "pool-1" }) });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(mockSetPoolBorrowCap).not.toHaveBeenCalled();
  });

  it("returns a JSON 403 when the caller is not an allowlisted admin", async () => {
    mockRequireApiAdmin.mockRejectedValue(new MockUnauthorizedError("Admin access required."));

    const response = await PUT(makeRequest(), { params: Promise.resolve({ id: "pool-1" }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Admin access required" });
    expect(mockSetPoolBorrowCap).not.toHaveBeenCalled();
  });
});
