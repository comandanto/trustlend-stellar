import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RECENT_USERS_LIMIT,
  countByRole,
  kycBadgeTone,
  paginate,
  parsePageParam,
  riskBadgeTone,
} from "@/lib/dashboard/admin-users";
import { AdminUsersTable, type AdminUserRow } from "@/components/dashboard/AdminUsersTable";

describe("admin user badge tones", () => {
  it.each([
    ["verified", "success"],
    ["submitted", "info"],
    ["pending", "warning"],
    ["rejected", "danger"],
    ["VERIFIED", "success"],
    [null, "neutral"],
    ["something-else", "neutral"],
  ])("kycBadgeTone(%s) → %s", (status, tone) => {
    expect(kycBadgeTone(status)).toBe(tone);
  });

  it.each([
    ["low", "success"],
    ["medium", "warning"],
    ["high", "danger"],
    ["blocked", "danger"],
    [undefined, "neutral"],
  ])("riskBadgeTone(%s) → %s", (status, tone) => {
    expect(riskBadgeTone(status)).toBe(tone);
  });
});

describe("parsePageParam", () => {
  it.each([
    [undefined, 1],
    ["", 1],
    ["abc", 1],
    ["0", 1],
    ["-3", 1],
    ["1", 1],
    ["4", 4],
    ["2.9", 2],
    [["3", "7"], 3],
  ] as const)("parses %j as page %d", (raw, page) => {
    expect(parsePageParam(raw as string | string[] | undefined)).toBe(page);
  });
});

describe("paginate", () => {
  it("handles an empty table", () => {
    expect(paginate(0, 1, 25)).toEqual({
      page: 1,
      totalPages: 1,
      offset: 0,
      from: 0,
      to: 0,
      hasPrev: false,
      hasNext: false,
    });
  });

  it("computes the first, middle and last pages", () => {
    expect(paginate(60, 1, 25)).toMatchObject({ page: 1, totalPages: 3, offset: 0, from: 1, to: 25, hasPrev: false, hasNext: true });
    expect(paginate(60, 2, 25)).toMatchObject({ page: 2, offset: 25, from: 26, to: 50, hasPrev: true, hasNext: true });
    expect(paginate(60, 3, 25)).toMatchObject({ page: 3, offset: 50, from: 51, to: 60, hasPrev: true, hasNext: false });
  });

  it("clamps a page beyond the end to the last page", () => {
    expect(paginate(60, 99, 25)).toMatchObject({ page: 3, offset: 50, from: 51, to: 60 });
  });

  it("returns a single page when the total fits exactly", () => {
    expect(paginate(25, 1, 25)).toMatchObject({ totalPages: 1, from: 1, to: 25, hasNext: false });
  });
});

describe("countByRole", () => {
  it("folds grouped counts and ignores unknown roles", () => {
    expect(
      countByRole([
        { role: "borrower", count: 12 },
        { role: "lender", count: "5" },
        { role: "admin", count: 1 },
        { role: null, count: 3 },
        { role: "ghost", count: 9 },
      ]),
    ).toEqual({ borrower: 12, lender: 5, admin: 1 });
  });

  it("defaults every role to zero", () => {
    expect(countByRole([])).toEqual({ borrower: 0, lender: 0, admin: 0 });
  });
});

describe("AdminUsersTable", () => {
  const render = (users: AdminUserRow[]) =>
    renderToStaticMarkup(createElement(AdminUsersTable, { users }));

  const user = (i: number, kyc: string, risk: string): AdminUserRow => ({
    id: `user-${String(i).padStart(4, "0")}-aaaa-bbbb`,
    role: i % 2 === 0 ? "borrower" : "lender",
    full_name: `User ${i}`,
    kyc_status: kyc,
    risk_status: risk,
    created_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
  });

  it("renders every fetched user, not just the first (#332)", () => {
    const users = Array.from({ length: RECENT_USERS_LIMIT }, (_, i) => user(i, "pending", "medium"));
    const html = render(users);

    expect(html.match(/<tr>/g)?.length).toBe(RECENT_USERS_LIMIT + 1); // + header row
    for (let i = 0; i < RECENT_USERS_LIMIT; i++) {
      expect(html).toContain(`User ${i}`);
    }
    expect(html).not.toContain("No users found.");
  });

  it("renders the matching KYC and risk badge on each row", () => {
    const rows: Array<[string, string, string, string]> = [
      ["verified", "success", "low", "success"],
      ["submitted", "info", "medium", "warning"],
      ["pending", "warning", "high", "danger"],
      ["rejected", "danger", "blocked", "danger"],
    ];
    const html = render(rows.map(([kyc, , risk], i) => user(i, kyc, risk)));

    const kycBadges = [...html.matchAll(/data-badge="kyc" data-status="([^"]+)" data-tone="([^"]+)"[^>]*>([^<]+)</g)];
    const riskBadges = [...html.matchAll(/data-badge="risk" data-status="([^"]+)" data-tone="([^"]+)"[^>]*>([^<]+)</g)];

    expect(kycBadges).toHaveLength(rows.length);
    expect(riskBadges).toHaveLength(rows.length);

    rows.forEach(([kyc, kycTone, risk, riskTone], i) => {
      expect(kycBadges[i].slice(1)).toEqual([kyc, kycTone, kyc.toUpperCase()]);
      expect(riskBadges[i].slice(1)).toEqual([risk, riskTone, risk.toUpperCase()]);
    });
  });

  it("shows the empty state when there are no users", () => {
    const html = render([]);
    expect(html).toContain("No users found.");
    expect(html.toLowerCase()).toContain('colspan="6"');
    expect(html).not.toContain('data-badge="kyc"');
  });
});
