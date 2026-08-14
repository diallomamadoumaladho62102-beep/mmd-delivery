/**
 * Role-select profile gate: validate session then load own profiles row.
 * Separates JWT/session failures from missing-profile (null row, no error).
 */

export type ProfileGateErrorKind =
  | "session_expired"
  | "network"
  | "permission"
  | "server"
  | "unknown";

export type ProfileGateRow = {
  role: string | null;
  is_founder: boolean;
};

export type ProfileGateOk = {
  ok: true;
  profile: ProfileGateRow | null;
  userId: string;
};

export type ProfileGateFail = {
  ok: false;
  kind: ProfileGateErrorKind;
  userId: string | null;
  code: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
};

export type ProfileGateResult = ProfileGateOk | ProfileGateFail;

type AuthLike = {
  getUser: () => Promise<{
    data: { user: { id: string } | null };
    error: { message?: string; code?: string } | null;
  }>;
  refreshSession: () => Promise<{
    data: { session: { user: { id: string } } | null };
    error: { message?: string; code?: string } | null;
  }>;
};

type ProfilesQueryLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        value: string,
      ) => {
        maybeSingle: () => Promise<{
          data: ProfileGateRow | null;
          error: {
            code?: string;
            message?: string;
            details?: string;
            hint?: string;
          } | null;
        }>;
      };
    };
  };
};

export function classifyProfileFetchError(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
} | null): ProfileGateErrorKind {
  if (!error) return "unknown";
  const code = String(error.code ?? "").toLowerCase();
  const message = String(error.message ?? "").toLowerCase();
  const details = String(error.details ?? "").toLowerCase();
  const blob = `${code} ${message} ${details}`;

  if (
    /jwt expired|invalid jwt|invalid claim|not authenticated|session|refresh.?token|auth session missing/i.test(
      blob,
    ) ||
    code === "pgrst301" ||
    code === "401"
  ) {
    return "session_expired";
  }

  if (
    /network|fetch failed|failed to fetch|timeout|timed out|offline|econnrefused|enotfound/i.test(
      blob,
    )
  ) {
    return "network";
  }

  if (
    /row-level security|permission denied|42501|pgrst301|jwt/i.test(blob) ||
    code === "42501"
  ) {
    return "permission";
  }

  if (/500|502|503|504|pgrst|postgres|database/i.test(blob) || code.startsWith("PGRST")) {
    return "server";
  }

  return "unknown";
}

export function userMessageForProfileGateKind(kind: ProfileGateErrorKind): string {
  switch (kind) {
    case "session_expired":
      return "Your session expired. Please sign in again.";
    case "network":
      return "Network error while verifying your profile. Check your connection and try again.";
    case "permission":
      return "Unable to access your profile. Sign out, sign in again, or contact support.";
    case "server":
      return "Profile service is temporarily unavailable. Please try again in a moment.";
    default:
      return "Unable to verify your profile. Please try again.";
  }
}

type SupabaseGateClient = {
  auth: AuthLike;
  from: ProfilesQueryLike["from"];
};

/**
 * Ensures Auth JWT is valid (getUser), refreshes once if needed, then loads profiles.
 * Does not invent a profile: null row without error is ok:true + profile:null.
 */
export async function fetchOwnProfileForRoleGate(
  client: SupabaseGateClient,
  preferredUserId?: string | null,
): Promise<ProfileGateResult> {
  let userId = String(preferredUserId ?? "").trim() || null;

  const ensureUser = async (): Promise<ProfileGateFail | { userId: string }> => {
    const first = await client.auth.getUser();
    if (!first.error && first.data.user?.id) {
      return { userId: first.data.user.id };
    }

    const refreshed = await client.auth.refreshSession();
    if (!refreshed.error && refreshed.data.session?.user?.id) {
      return { userId: refreshed.data.session.user.id };
    }

    const err = refreshed.error ?? first.error;
    const kind = classifyProfileFetchError(err);
    return {
      ok: false,
      kind: kind === "unknown" ? "session_expired" : kind,
      userId,
      code: err?.code != null ? String(err.code) : null,
      message: err?.message != null ? String(err.message) : null,
      details: null,
      hint: null,
    };
  };

  const authResult = await ensureUser();
  if ("ok" in authResult && authResult.ok === false) {
    return authResult;
  }
  userId = (authResult as { userId: string }).userId;

  const loadProfile = async () =>
    client
      .from("profiles")
      .select("role, is_founder")
      .eq("id", userId!)
      .maybeSingle();

  let { data, error } = await loadProfile();

  if (error) {
    const kind = classifyProfileFetchError(error);
    if (kind === "session_expired") {
      const refreshed = await client.auth.refreshSession();
      if (!refreshed.error && refreshed.data.session?.user?.id) {
        userId = refreshed.data.session.user.id;
        const retry = await loadProfile();
        data = retry.data;
        error = retry.error;
      }
    }
  }

  if (error) {
    return {
      ok: false,
      kind: classifyProfileFetchError(error),
      userId,
      code: error.code != null ? String(error.code) : null,
      message: error.message != null ? String(error.message) : null,
      details: error.details != null ? String(error.details) : null,
      hint: error.hint != null ? String(error.hint) : null,
    };
  }

  return {
    ok: true,
    userId,
    profile: data
      ? {
          role: data.role ?? null,
          is_founder: data.is_founder === true,
        }
      : null,
  };
}
