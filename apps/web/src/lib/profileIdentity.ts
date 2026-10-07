/**
 * Canonical profile rules. One auth user id owns one public.profiles row.
 * client_profiles is a delivery-detail row, not a second canonical profile.
 */

export const PUBLIC_SIGNUP_ROLES = ["client", "driver", "restaurant", "seller"] as const;

export type PublicSignupRole = (typeof PUBLIC_SIGNUP_ROLES)[number];

export type CanonicalProfile = {
  id: string;
  role: "client" | "driver" | "restaurant";
  fullName: string | null;
  phone: string | null;
  email: string | null;
};

export function roleFromSignupMetadata(requested: unknown): "client" | "driver" | "restaurant" {
  const value = String(requested ?? "").trim().toLowerCase();
  if (value === "driver" || value === "restaurant") return value;
  // seller stays a client profile plus an optional sellers row.
  return "client";
}

export function rejectPrivilegedSignupRole(requested: unknown): boolean {
  const value = String(requested ?? "").trim().toLowerCase();
  return (
    value === "admin" ||
    value === "super_admin" ||
    value === "operations_admin" ||
    value === "finance_admin" ||
    value === "support_admin" ||
    value === "review_admin"
  );
}

/**
 * A repeated profile insert for the same id updates allowed fields.
 * It never appends a second row and never changes role.
 */
export function applyProfileInsert(
  rows: CanonicalProfile[],
  incoming: { id: string; role?: string; fullName?: string | null; phone?: string | null; email?: string | null },
): CanonicalProfile[] {
  const existing = rows.find((row) => row.id === incoming.id);
  if (!existing) {
    return [
      ...rows,
      {
        id: incoming.id,
        role: roleFromSignupMetadata(incoming.role),
        fullName: incoming.fullName ?? null,
        phone: incoming.phone ?? null,
        email: incoming.email ?? null,
      },
    ];
  }

  return rows.map((row) => {
    if (row.id !== incoming.id) return row;
    return {
      ...row,
      fullName: textOrKeep(incoming.fullName, row.fullName),
      phone: textOrKeep(incoming.phone, row.phone),
      email: textOrKeep(incoming.email, row.email),
    };
  });
}

function textOrKeep(next: string | null | undefined, current: string | null): string | null {
  const value = String(next ?? "").trim();
  return value.length > 0 ? value : current;
}
