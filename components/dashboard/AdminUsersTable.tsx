import type { CSSProperties } from "react";
import { kycBadgeTone, riskBadgeTone, type StatusTone } from "@/lib/dashboard/admin-users";

export interface AdminUserRow {
  id: unknown;
  role: unknown;
  full_name?: unknown;
  kyc_status: unknown;
  risk_status: unknown;
  created_at?: unknown;
}

const TONE_STYLES: Record<StatusTone, CSSProperties> = {
  success: { color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 12%, transparent)" },
  info: { color: "var(--info)", background: "color-mix(in srgb, var(--info) 12%, transparent)" },
  warning: { color: "var(--warning)", background: "color-mix(in srgb, var(--warning) 12%, transparent)" },
  danger: { color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 12%, transparent)" },
  neutral: { color: "inherit", background: "var(--surface-2)" },
};

const BADGE_BASE: CSSProperties = {
  padding: "0.15rem 0.5rem",
  borderRadius: "999px",
  fontSize: "0.75rem",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

function StatusBadge({ kind, status, tone }: { kind: "kyc" | "risk"; status: unknown; tone: StatusTone }) {
  const label = String(status ?? "unknown");
  return (
    <span
      data-badge={kind}
      data-status={label}
      data-tone={tone}
      style={{ ...BADGE_BASE, ...TONE_STYLES[tone] }}
    >
      {label.toUpperCase()}
    </span>
  );
}

/**
 * User table shared by the admin overview ("Recent Users") and the paginated
 * /dashboard/admin/users list. Renders every row it is given — callers decide
 * how many to fetch.
 */
export function AdminUsersTable({
  users,
  emptyMessage = "No users found.",
}: {
  users: AdminUserRow[];
  emptyMessage?: string;
}) {
  return (
    <div className="workspace-table-wrap">
      <table className="workspace-table">
        <thead>
          <tr>
            <th>User ID</th>
            <th>Role</th>
            <th>Name</th>
            <th>KYC</th>
            <th>Risk</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", padding: "1.5rem", opacity: 0.5 }}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            users.map((p) => (
              <tr key={String(p.id)}>
                <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{String(p.id).slice(0, 8)}</td>
                <td><span style={{ textTransform: "capitalize", fontWeight: 600 }}>{String(p.role)}</span></td>
                <td>{String(p.full_name || "Unknown")}</td>
                <td><StatusBadge kind="kyc" status={p.kyc_status} tone={kycBadgeTone(p.kyc_status)} /></td>
                <td><StatusBadge kind="risk" status={p.risk_status} tone={riskBadgeTone(p.risk_status)} /></td>
                <td>{p.created_at ? new Date(String(p.created_at)).toLocaleDateString() : "-"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
