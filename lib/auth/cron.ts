/**
 * lib/auth/cron.ts
 *
 * Shared authorization for the scheduled endpoints under `app/api/cron/*`.
 * Callers (Vercel Cron, `.github/workflows/keepers.yml`, cURL) must send
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * The check fails closed: when CRON_SECRET is missing, requests are rejected
 * with 500 (server misconfigured) rather than let through, so a deployment
 * that forgot the env var cannot be driven by anonymous callers. The only
 * exception is local development (`NODE_ENV === "development"`), where an
 * unset secret skips the check so the routes can be exercised by hand.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string };

function configuredSecret(): string | null {
  const secret = process.env.CRON_SECRET?.trim();
  return secret ? secret : null;
}

/**
 * Constant-time string comparison. Both sides are hashed first so the
 * comparison neither short-circuits on the first differing byte nor leaks the
 * secret's length.
 */
function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

/** Decides whether a cron request may run, without building a response. */
export function checkCronAuth(request: Request): CronAuthResult {
  const secret = configuredSecret();

  if (!secret) {
    if (process.env.NODE_ENV === "development") {
      return { ok: true };
    }
    return {
      ok: false,
      status: 500,
      error: "Server misconfigured: CRON_SECRET is not set",
    };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${secret}`)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}

/**
 * Route-handler guard. Returns `null` when the request is authorized, or the
 * error response the handler should return immediately.
 *
 *   const denied = requireCronAuth(request, "liquidation");
 *   if (denied) return denied;
 */
export function requireCronAuth(
  request: Request,
  jobName: string,
): NextResponse | null {
  const result = checkCronAuth(request);
  if (result.ok) return null;

  if (result.status === 500) {
    console.error(
      `[${jobName}] Refusing cron request: CRON_SECRET is not configured. ` +
        "Set CRON_SECRET (or run with NODE_ENV=development for local testing).",
    );
  }

  return NextResponse.json(
    { ok: false, error: result.error },
    { status: result.status },
  );
}
