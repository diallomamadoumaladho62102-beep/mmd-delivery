import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Guinea rehearsal accounts already created in the shared production database.
 * Identity comes from auth.users for the authenticated user id. A request body
 * cannot add or remove an address from this list.
 */
export const GUINEA_ISOLATED_TEST_EMAILS = [
  "guinea-client@example.com",
  "guinea-driver@example.com",
  "guinea-restaurant@example.com",
  "guinea-seller@example.com",
] as const;

export const GUINEA_TEST_LIVE_OPERATION_BLOCKED = "guinea_test_live_operation_blocked";

/** Authenticated user ids of the four existing Guinea rehearsal accounts. */
export const GUINEA_ISOLATED_TEST_USER_IDS = [
  "9e0b3fb4-b23a-407c-a781-9f63f9b3de50",
  "05c34009-b050-454c-a94d-c4c803b26815",
  "2c1dc7b3-3784-4f35-ba72-56d6b3cd16fe",
  "7f1e2105-4032-4d49-868d-a7e2dad710a1",
] as const;

export function isGuineaIsolatedTestUserId(userId: unknown): boolean {
  const value = String(userId ?? "").trim().toLowerCase();
  return (GUINEA_ISOLATED_TEST_USER_IDS as readonly string[]).includes(value);
}

export function isGuineaIsolatedTestEmail(email: unknown): boolean {
  const value = String(email ?? "").trim().toLowerCase();
  return (GUINEA_ISOLATED_TEST_EMAILS as readonly string[]).includes(value);
}

type AuthAdmin = {
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{
        data: { user: { email?: string | null } | null } | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

export async function guineaIsolatedTestUserInvolved(
  admin: AuthAdmin,
  userIds: Array<string | null | undefined>,
): Promise<boolean> {
  const seen = new Set<string>();
  for (const raw of userIds) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (isGuineaIsolatedTestUserId(id)) return true;
    try {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error) continue;
      if (isGuineaIsolatedTestEmail(data?.user?.email)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function isIsolatedFromLiveDispatch(row: {
  is_test?: unknown;
  archived_at?: unknown;
  hidden_from_user?: unknown;
  client_user_id?: unknown;
  created_by?: unknown;
  user_id?: unknown;
  driver_id?: unknown;
  preferred_driver_id?: unknown;
  restaurant_user_id?: unknown;
  restaurant_id?: unknown;
}): boolean {
  if (row.is_test === true || row.hidden_from_user === true || Boolean(row.archived_at)) {
    return true;
  }
  return [
    row.client_user_id,
    row.created_by,
    row.user_id,
    row.driver_id,
    row.preferred_driver_id,
    row.restaurant_user_id,
    row.restaurant_id,
  ].some((id) => isGuineaIsolatedTestUserId(id));
}

export async function assertNoGuineaIsolatedLiveWrite(
  admin: SupabaseClient,
  userIds: Array<string | null | undefined>,
): Promise<void> {
  const blocked = await guineaIsolatedTestUserInvolved(admin, userIds);
  if (blocked) {
    throw new Error(GUINEA_TEST_LIVE_OPERATION_BLOCKED);
  }
}
