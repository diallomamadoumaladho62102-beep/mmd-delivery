import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import { normalizeUserRole, type UserRole } from "@/lib/roles";
import { isStaffRole, normalizeProfileRole } from "@mmd/platform-roles";

export const DELETABLE_ROLES = [
  "client",
  "driver",
  "restaurant",
  "seller",
] as const;
export type DeletableRole = (typeof DELETABLE_ROLES)[number];

export function isDeletableRole(role: UserRole): role is DeletableRole {
  if (role == null) return false;
  if (isStaffRole(role)) return false;
  const canonical = normalizeProfileRole(role);
  return (
    canonical != null &&
    (DELETABLE_ROLES as readonly string[]).includes(canonical)
  );
}

function deletedEmail(userId: string): string {
  const compact = userId.replace(/-/g, "").slice(0, 24);
  return `deleted.${compact}@deleted.mmddelivery.invalid`;
}

function deletedLabel(userId: string): string {
  return `Deleted User ${userId.slice(0, 8)}`;
}

async function safeUpdate(
  supabase: SupabaseClient,
  table: string,
  values: Record<string, unknown>,
  match: { column: string; value: string }
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update(values)
    .eq(match.column, match.value);
  // Table/column may not exist in all environments — ignore missing-relation errors.
  if (error && !/does not exist|schema cache|Could not find/i.test(error.message)) {
    throw new Error(`${table}: ${error.message}`);
  }
}

async function safeDelete(
  supabase: SupabaseClient,
  table: string,
  match: { column: string; value: string }
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq(match.column, match.value);
  if (error && !/does not exist|schema cache|Could not find/i.test(error.message)) {
    throw new Error(`${table} delete: ${error.message}`);
  }
}

/**
 * Anonymize PII and soft-delete the account while retaining UUIDs needed for
 * payments, tax, fraud, and disputes. Must be called with the service-role client.
 */
export async function executeAccountDeletion(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  role: DeletableRole;
  requestedBy: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ ok: true; deletedEmail: string } | { ok: false; error: string }> {
  const { supabaseAdmin, userId, role, requestedBy } = params;
  const now = new Date().toISOString();
  const label = deletedLabel(userId);
  const email = deletedEmail(userId);

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("id, role, account_status, is_founder, email, full_name, phone")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr) return { ok: false, error: profileErr.message };
  if (!profile) return { ok: false, error: "Profile not found" };
  if (profile.is_founder === true) {
    return { ok: false, error: "Founder accounts cannot be self-deleted" };
  }
  if (String(profile.account_status) === "deleted") {
    return { ok: false, error: "Account already deleted" };
  }

  const profileRole = normalizeUserRole(profile.role);
  if (!isDeletableRole(profileRole) || profileRole !== role) {
    return { ok: false, error: "Role mismatch for deletion" };
  }

  // 1) Soft-delete + anonymize core profile
  const { error: updProfileErr } = await supabaseAdmin
    .from("profiles")
    .update({
      account_status: "deleted",
      deleted_at: now,
      deletion_requested_at: now,
      full_name: label,
      phone: null,
      email,
      avatar_url: null,
    })
    .eq("id", userId)
    .neq("account_status", "deleted");

  if (updProfileErr) return { ok: false, error: updProfileErr.message };

  // 2) Role-specific PII scrub (best-effort)
  if (role === "client" || role === "seller") {
    await safeUpdate(
      supabaseAdmin,
      "client_profiles",
      {
        full_name: label,
        phone: null,
        avatar_url: null,
        address: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        zip: null,
        postal_code: null,
      },
      { column: "user_id", value: userId }
    );
    await safeDelete(supabaseAdmin, "client_addresses", {
      column: "user_id",
      value: userId,
    });
  }

  // Marketplace seller is a profile overlay (often profiles.role=client).
  // Scrub PII for every deletion so a shop created in-app cannot outlive the account.
  await safeUpdate(
    supabaseAdmin,
    "sellers",
    {
      business_name: `Deleted Seller ${userId.slice(0, 8)}`,
      phone: "deleted",
      address: "deleted",
      city: "deleted",
      logo_url: null,
      cover_image_url: null,
      document_urls: [],
      status: "suspended",
      is_accepting_orders: false,
    },
    { column: "user_id", value: userId }
  );

  // Taxi Business is a Customer membership overlay — revoke access on any self-delete.
  await safeUpdate(
    supabaseAdmin,
    "taxi_business_members",
    { active: false },
    { column: "user_id", value: userId }
  );

  if (role === "driver") {
    await safeUpdate(
      supabaseAdmin,
      "driver_profiles",
      {
        full_name: label,
        phone: null,
        avatar_url: null,
        city: null,
        state: null,
        // Keep stripe_account_id for payout/tax reconciliation — do not wipe.
      },
      { column: "user_id", value: userId }
    );
    await safeUpdate(
      supabaseAdmin,
      "driver_documents",
      {
        status: "deleted",
        rejection_reason: "account_deleted",
      },
      { column: "driver_id", value: userId }
    );
  }

  if (role === "restaurant") {
    await safeUpdate(
      supabaseAdmin,
      "restaurant_profiles",
      {
        restaurant_name: `Deleted Restaurant ${userId.slice(0, 8)}`,
        phone: null,
        email,
        avatar_url: null,
        address: null,
        city: null,
        account_status: "disabled",
      },
      { column: "user_id", value: userId }
    );
  }

  // Push tokens / devices / preferences
  await safeDelete(supabaseAdmin, "user_push_tokens", {
    column: "user_id",
    value: userId,
  });
  await safeDelete(supabaseAdmin, "push_tokens", {
    column: "user_id",
    value: userId,
  });
  await safeDelete(supabaseAdmin, "device_push_tokens", {
    column: "user_id",
    value: userId,
  });
  await safeDelete(supabaseAdmin, "user_devices", {
    column: "user_id",
    value: userId,
  });
  await safeDelete(supabaseAdmin, "notification_preferences", {
    column: "user_id",
    value: userId,
  });

  // Referral codes — unlink ownership (keep code row for fraud analytics if present)
  await safeUpdate(
    supabaseAdmin,
    "referral_codes",
    { owner_user_id: null, user_id: null },
    { column: "owner_user_id", value: userId }
  );
  await safeUpdate(
    supabaseAdmin,
    "referral_codes",
    { owner_user_id: null, user_id: null },
    { column: "user_id", value: userId }
  );

  // 3) Ban auth user + rotate credentials (prevents login / session reuse)
  const randomPassword = randomBytes(32).toString("base64url");
  const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(
    userId,
    {
      email,
      password: randomPassword,
      email_confirm: true,
      ban_duration: "876600h",
      user_metadata: {
        deleted: true,
        deleted_at: now,
        previous_role: role,
      },
      app_metadata: {
        deleted: true,
        account_status: "deleted",
      },
    }
  );
  if (authErr) return { ok: false, error: authErr.message };

  // Best-effort global sign-out of refresh tokens
  try {
    const adminAuth = supabaseAdmin.auth.admin as {
      signOut?: (id: string, scope?: string) => Promise<unknown>;
    };
    if (typeof adminAuth.signOut === "function") {
      await adminAuth.signOut(userId, "global");
    }
  } catch {
    // ignore — ban + password rotate already invalidate practical reuse
  }

  // 4) Audit trail
  const { error: eventErr } = await supabaseAdmin
    .from("account_deletion_events")
    .insert({
      user_id: userId,
      role,
      requested_at: now,
      executed_at: now,
      requested_by: requestedBy,
      ip_address: params.ipAddress ?? null,
      user_agent: params.userAgent ?? null,
      metadata: {
        profile_hash: createHash("sha256")
          .update(String(profile.email ?? "") + "|" + String(profile.phone ?? ""))
          .digest("hex")
          .slice(0, 16),
        retained:
          "orders,taxi_rides,payments,payouts,tax_records,stripe_ids,audit_logs",
      },
    });
  if (eventErr && !/does not exist|schema cache/i.test(eventErr.message)) {
    return { ok: false, error: eventErr.message };
  }

  await supabaseAdmin.from("admin_audit_logs").insert({
    admin_user_id: requestedBy,
    action: "account_deleted",
    target_type: "user",
    target_id: userId,
    old_values: {
      role: profile.role,
      account_status: profile.account_status,
      email_present: Boolean(profile.email),
    },
    new_values: {
      account_status: "deleted",
      deleted_at: now,
      anonymized: true,
    },
    metadata: { self_service: requestedBy === userId, role },
    created_at: now,
    ip_address: params.ipAddress ?? null,
  }).then(({ error }) => {
    if (error && !/does not exist|schema cache/i.test(error.message)) {
      console.error("[accountDeletion] admin_audit_logs insert failed", error.message);
    }
  });

  return { ok: true, deletedEmail: email };
}
