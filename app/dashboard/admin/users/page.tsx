import { WorkspaceFrame } from "@/components/dashboard/WorkspaceFrame";
import { WalletCard } from "@/components/dashboard/WalletCard";
import { AdminUsersTable } from "@/components/dashboard/AdminUsersTable";
import { adminNavLinks } from "@/lib/dashboard/admin-links";
import { requireTradeVaultAdmin } from "@/lib/auth/session";
import {
  getAdminDashboardMetrics,
  presentAdminMetrics,
} from "@/lib/dashboard/metrics";
import {
  USERS_PAGE_SIZE,
  countByRole,
  paginate,
  parsePageParam,
} from "@/lib/dashboard/admin-users";
import { desc, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { profileToRow } from "@/lib/db/rows";
import { profiles } from "@/lib/db/schema";
import Link from "next/link";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const countOf = sql<number>`count(*)::int`;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const { user } = await requireTradeVaultAdmin();
  const metrics = await getAdminDashboardMetrics();
  const walletAddress = String(user.walletAddress ?? "") || null;
  const walletConnected = Boolean(walletAddress);

  const requestedPage = parsePageParam(((await searchParams) ?? {}).page);

  const db = getDb();

  // Segment counts are platform-wide aggregates, independent of the page shown.
  const [roleRows, [flaggedRes], [pendingKycRes]] = db
    ? await Promise.all([
        db.select({ role: profiles.role, count: countOf }).from(profiles).groupBy(profiles.role),
        db.select({ count: countOf }).from(profiles).where(inArray(profiles.riskStatus, ["high", "blocked"])),
        db
          .select({ count: countOf })
          .from(profiles)
          .where(inArray(profiles.kycStatus, ["pending", "submitted", "rejected"])),
      ])
    : [[], [], []];

  const roleCounts = countByRole(roleRows);
  const totalUsers = roleRows.reduce((sum, row) => sum + Number(row.count ?? 0), 0);
  const flagged = Number(flaggedRes?.count ?? 0);
  const pendingKyc = Number(pendingKycRes?.count ?? 0);

  const pagination = paginate(totalUsers, requestedPage, USERS_PAGE_SIZE);
  const pageUsers = db && totalUsers > 0
    ? (
        await db
          .select()
          .from(profiles)
          // id tiebreak keeps pages stable when several users share a timestamp.
          .orderBy(desc(profiles.createdAt), desc(profiles.id))
          .limit(USERS_PAGE_SIZE)
          .offset(pagination.offset)
      ).map(profileToRow)
    : [];

  const pageHref = (page: number) =>
    page <= 1 ? "/dashboard/admin/users" : `/dashboard/admin/users?page=${page}`;

  return (
    <WorkspaceFrame
      roleLabel="Trade Vault Admin"
      heading="User Governance"
      description="Review user role distribution, KYC state, and high-risk identities."
      email={user.email ?? null}
      userName={String(user.fullName ?? "Admin")}
      metrics={presentAdminMetrics(metrics)}
      links={[...adminNavLinks]}
      currentPath="/dashboard/admin/users"
      showProfileAlert={false}
      headerWidget={(
        <WalletCard
          address={walletAddress}
          available={0}
          inLoansOrPools={totalUsers}
          pending={flagged}
          inLoansLabel="Users"
          compact
          inLoansIsCurrency={false}
          pendingIsCurrency={false}
        />
      )}
    >
      <div className="workspace-stack">
        {!walletConnected ? (
          <article className="workspace-card workspace-card--full">
            <h2 className="workspace-card-title">Wallet connection required</h2>
            <p className="workspace-card-copy">Connect wallet first to unlock user governance data.</p>
          </article>
        ) : (
          <>
            <section className="workspace-grid workspace-grid--two">
              <article className="workspace-card workspace-card--full">
                <h2 className="workspace-card-title">User segments</h2>
                <ul className="workspace-list workspace-list--compact">
                  <li><span>Total accounts</span><strong>{totalUsers}</strong></li>
                  <li><span>Borrowers</span><strong>{roleCounts.borrower}</strong></li>
                  <li><span>Lenders</span><strong>{roleCounts.lender}</strong></li>
                  <li><span>Flagged risk profiles</span><strong>{flagged}</strong></li>
                  <li><span>Pending KYC profiles</span><strong>{pendingKyc}</strong></li>
                </ul>
              </article>
            </section>

            <AdminUsersTable users={pageUsers} />

            {totalUsers > 0 ? (
              <nav
                aria-label="User list pagination"
                style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "space-between", alignItems: "center" }}
              >
                <p className="workspace-card-copy" style={{ margin: 0 }}>
                  Showing {pagination.from}–{pagination.to} of {totalUsers} users
                  {pagination.totalPages > 1 ? ` · Page ${pagination.page} of ${pagination.totalPages}` : null}
                </p>
                {pagination.totalPages > 1 ? (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {pagination.hasPrev ? (
                      <Link href={pageHref(pagination.page - 1)} className="workspace-nav-link" rel="prev">
                        ← Previous
                      </Link>
                    ) : (
                      <span className="workspace-nav-link" aria-disabled="true" style={{ opacity: 0.45, pointerEvents: "none" }}>
                        ← Previous
                      </span>
                    )}
                    {pagination.hasNext ? (
                      <Link href={pageHref(pagination.page + 1)} className="workspace-nav-link" rel="next">
                        Next →
                      </Link>
                    ) : (
                      <span className="workspace-nav-link" aria-disabled="true" style={{ opacity: 0.45, pointerEvents: "none" }}>
                        Next →
                      </span>
                    )}
                  </div>
                ) : null}
              </nav>
            ) : null}
          </>
        )}
      </div>
    </WorkspaceFrame>
  );
}
