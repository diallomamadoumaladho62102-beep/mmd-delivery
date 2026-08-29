import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountInactiveApiError,
  isAccountActive,
  normalizeAccountStatus,
  type AccountStatus,
} from "@/lib/accountStatus";

export type ActiveAccountSuccess = {
  ok: true;
  accountStatus: AccountStatus;
};

export type ActiveAccountFailure = {
  ok: false;
  status: 403 | 500;
  error: string;
  code: "ACCOUNT_INACTIVE" | "ACCOUNT_STATUS_UNAVAILABLE";
  accountStatus?: AccountStatus;
};

/**
 * Server-side account gate. JWT validity is not enough — suspended,
 * disabled, deleted, and banned profiles must be rejected for mutations
 * and sensitive reads.
 */
export async function assertProfileActive(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<ActiveAccountSuccess | ActiveAccountFailure> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("account_status")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      error: "Unable to verify account status",
      code: "ACCOUNT_STATUS_UNAVAILABLE",
    };
  }

  if (!data) {
    return {
      ok: false,
      status: 403,
      error: "Account is not active",
      code: "ACCOUNT_INACTIVE",
      accountStatus: "disabled",
    };
  }

  const raw = String(data.account_status ?? "active");
  if (!isAccountActive(raw)) {
    const payload = accountInactiveApiError(raw);
    return {
      ok: false,
      status: 403,
      error: payload.error,
      code: payload.code,
      accountStatus: payload.account_status,
    };
  }

  return { ok: true, accountStatus: normalizeAccountStatus(raw) };
}

export function inactiveAccountBody(failure: ActiveAccountFailure): Record<string, unknown> {
  return {
    ok: false,
    error: failure.error,
    code: failure.code,
    account_status: failure.accountStatus ?? null,
  };
}
