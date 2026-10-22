import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkCronAuth, requireCronAuth } from "@/lib/auth/cron";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/test", {
    headers: authorization ? { authorization } : {},
  });
}

describe("checkCronAuth", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("with CRON_SECRET configured", () => {
    beforeEach(() => {
      process.env.CRON_SECRET = "s3cret";
    });

    it("accepts the matching bearer token", () => {
      expect(checkCronAuth(request("Bearer s3cret"))).toEqual({ ok: true });
    });

    it("rejects a wrong token with 401", () => {
      expect(checkCronAuth(request("Bearer wrong"))).toMatchObject({ ok: false, status: 401 });
    });

    it("rejects a token that is a prefix of the secret with 401", () => {
      expect(checkCronAuth(request("Bearer s3cre"))).toMatchObject({ ok: false, status: 401 });
    });

    it("rejects the bare secret without the Bearer scheme with 401", () => {
      expect(checkCronAuth(request("s3cret"))).toMatchObject({ ok: false, status: 401 });
    });

    it("rejects a missing Authorization header with 401", () => {
      expect(checkCronAuth(request())).toMatchObject({ ok: false, status: 401 });
    });

    it("still requires the token in development", () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(checkCronAuth(request())).toMatchObject({ ok: false, status: 401 });
    });
  });

  describe("with CRON_SECRET missing", () => {
    it.each(["production", "test"])(
      "fails closed with 500 when NODE_ENV=%s",
      (nodeEnv) => {
        vi.stubEnv("NODE_ENV", nodeEnv);
        expect(checkCronAuth(request())).toMatchObject({ ok: false, status: 500 });
        // A guessed header must not help either.
        expect(checkCronAuth(request("Bearer "))).toMatchObject({ ok: false, status: 500 });
        expect(checkCronAuth(request("Bearer undefined"))).toMatchObject({
          ok: false,
          status: 500,
        });
      },
    );

    it("fails closed when NODE_ENV is unset", () => {
      vi.stubEnv("NODE_ENV", undefined);
      expect(checkCronAuth(request())).toMatchObject({ ok: false, status: 500 });
    });

    it("treats an empty or whitespace-only CRON_SECRET as missing", () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.CRON_SECRET = "   ";
      expect(checkCronAuth(request("Bearer    "))).toMatchObject({ ok: false, status: 500 });
      process.env.CRON_SECRET = "";
      expect(checkCronAuth(request("Bearer "))).toMatchObject({ ok: false, status: 500 });
    });

    it("allows unauthenticated calls only when NODE_ENV=development", () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(checkCronAuth(request())).toEqual({ ok: true });
    });
  });
});

describe("requireCronAuth", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns null for an authorized request", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(requireCronAuth(request("Bearer s3cret"), "test-job")).toBeNull();
  });

  it("returns a 401 JSON response for a bad token", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = requireCronAuth(request("Bearer nope"), "test-job");
    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("returns a 500 response and logs when CRON_SECRET is missing in production", async () => {
    delete process.env.CRON_SECRET;
    vi.stubEnv("NODE_ENV", "production");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = requireCronAuth(request(), "test-job");

    expect(res?.status).toBe(500);
    const body = await res?.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/CRON_SECRET/);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toContain("[test-job]");
  });
});
