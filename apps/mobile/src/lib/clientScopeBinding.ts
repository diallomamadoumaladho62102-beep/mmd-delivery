export type ClientManualScope = {
  countryCode: string;
  stateCode?: string | null;
  setAt: number;
};

export type StoredClientManualScope = {
  userId?: string | null;
  countryCode?: string | null;
  stateCode?: string | null;
  setAt?: number | null;
};

/**
 * Manual country/state is visible only for the auth user who stored it.
 * Another user's scope, or a legacy row with no user id, is discarded.
 */
export function manualScopeVisibleToUser(params: {
  stored: StoredClientManualScope | null;
  currentUserId: string | null;
}): { scope: ClientManualScope | null; clear: boolean } {
  if (!params.stored) return { scope: null, clear: false };

  const currentUserId = String(params.currentUserId ?? "").trim();
  const storedUserId = String(params.stored.userId ?? "").trim();
  if (!currentUserId || !storedUserId || storedUserId !== currentUserId) {
    return { scope: null, clear: true };
  }

  const countryCode = String(params.stored.countryCode ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return { scope: null, clear: true };
  }

  return {
    scope: {
      countryCode,
      stateCode: params.stored.stateCode
        ? String(params.stored.stateCode).trim().toUpperCase()
        : null,
      setAt: Number(params.stored.setAt ?? Date.now()),
    },
    clear: false,
  };
}
