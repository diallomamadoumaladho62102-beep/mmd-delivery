export type BoundPublicRole = "client" | "driver" | "restaurant" | "seller";

const ROLES = new Set<BoundPublicRole>(["client", "driver", "restaurant", "seller"]);

/** True when this device still holds private cache for a different auth user. */
export function shouldClearPrivateDeviceState(
  storedOwner: string | null,
  currentUserId: string,
): boolean {
  const owner = String(storedOwner ?? "").trim();
  const current = currentUserId.trim();
  return Boolean(owner && current && owner !== current);
}

export function normalizeBoundRole(value: string | null | undefined): BoundPublicRole | null {
  const role = String(value ?? "").trim().toLowerCase();
  return ROLES.has(role as BoundPublicRole) ? (role as BoundPublicRole) : null;
}

/**
 * A cached role is visible only for the auth user it was bound to.
 * A role chosen before login (no stored user id) can be bound once.
 * A role bound to user A is never returned for user B.
 */
export function roleVisibleToUser(params: {
  storedRole: string | null;
  storedUserId: string | null;
  currentUserId: string;
}): { role: BoundPublicRole | null; bindUserId: string | null; clear: boolean } {
  const role = normalizeBoundRole(params.storedRole);
  const currentUserId = params.currentUserId.trim();
  const storedUserId = String(params.storedUserId ?? "").trim();

  if (!role || !currentUserId) {
    return { role: null, bindUserId: null, clear: false };
  }

  if (storedUserId && storedUserId !== currentUserId) {
    return { role: null, bindUserId: null, clear: true };
  }

  if (!storedUserId) {
    return { role, bindUserId: currentUserId, clear: false };
  }

  return { role, bindUserId: null, clear: false };
}
