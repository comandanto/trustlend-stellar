/**
 * lib/dashboard/admin-users.ts
 *
 * Pure helpers for the admin user tables (overview "Recent Users" card and the
 * paginated /dashboard/admin/users list): status → badge tone mapping,
 * page-param parsing and pagination maths. Kept free of DB / React imports so
 * they can be unit-tested directly.
 */

/** Rows shown in the overview's "Recent Users" card. */
export const RECENT_USERS_LIMIT = 10;

/** Rows per page on /dashboard/admin/users. */
export const USERS_PAGE_SIZE = 25;

export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral";

/** KYC lifecycle: pending → submitted → verified | rejected. */
export function kycBadgeTone(status: unknown): StatusTone {
  switch (String(status ?? "").toLowerCase()) {
    case "verified":
      return "success";
    case "submitted":
      return "info";
    case "rejected":
      return "danger";
    case "pending":
      return "warning";
    default:
      return "neutral";
  }
}

/** Risk levels: low | medium | high | blocked. */
export function riskBadgeTone(status: unknown): StatusTone {
  switch (String(status ?? "").toLowerCase()) {
    case "low":
      return "success";
    case "medium":
      return "warning";
    case "high":
    case "blocked":
      return "danger";
    default:
      return "neutral";
  }
}

/** Parses a `?page=` search param into a 1-based page number (default 1). */
export function parsePageParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const page = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(page) && page >= 1 ? page : 1;
}

export interface Pagination {
  /** Current page, clamped to [1, totalPages]. */
  page: number;
  totalPages: number;
  /** Row offset for the query. */
  offset: number;
  /** 1-based index of the first row on this page (0 when empty). */
  from: number;
  /** 1-based index of the last row on this page (0 when empty). */
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export function paginate(total: number, requestedPage: number, pageSize: number): Pagination {
  const safeTotal = Math.max(0, Math.floor(total));
  const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), totalPages);
  const offset = (page - 1) * pageSize;
  const from = safeTotal === 0 ? 0 : offset + 1;
  const to = Math.min(offset + pageSize, safeTotal);

  return {
    page,
    totalPages,
    offset,
    from,
    to,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

/** Folds `SELECT role, count(*) ... GROUP BY role` rows into a lookup. */
export function countByRole(
  rows: Array<{ role: string | null; count: number | string }>,
): Record<"borrower" | "lender" | "admin", number> {
  const counts = { borrower: 0, lender: 0, admin: 0 };
  for (const row of rows) {
    const role = String(row.role ?? "");
    if (role in counts) {
      counts[role as keyof typeof counts] += Number(row.count ?? 0);
    }
  }
  return counts;
}
