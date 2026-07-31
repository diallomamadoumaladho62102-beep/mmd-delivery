import type { SupabaseClient, User } from "@supabase/supabase-js";
import { taxiJson } from "@/lib/taxiApi";
import type { NextResponse } from "next/server";

export type BusinessManagerAuth = {
  businessAccountId: string;
  role: "manager" | "admin";
  memberId: string;
};

const MANAGER_ROLES = new Set(["manager", "admin"]);

export async function requireBusinessManager(
  supabaseAdmin: SupabaseClient,
  user: User,
  businessAccountId: string | null
): Promise<
  | { ok: true; membership: BusinessManagerAuth }
  | { ok: false; response: NextResponse }
> {
  let query = supabaseAdmin
    .from("taxi_business_members")
    .select("id, role, business_account_id")
    .eq("user_id", user.id)
    .eq("active", true);

  if (businessAccountId) {
    query = query.eq("business_account_id", businessAccountId);
  }

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) {
    return { ok: false, response: taxiJson({ ok: false, error: error.message }, 500) };
  }
  if (!data?.business_account_id) {
    return {
      ok: false,
      response: taxiJson({ ok: false, error: "business_membership_required" }, 403),
    };
  }

  const role = String(data.role ?? "").toLowerCase();
  if (!MANAGER_ROLES.has(role)) {
    return {
      ok: false,
      response: taxiJson({ ok: false, error: "manager_or_admin_required" }, 403),
    };
  }

  return {
    ok: true,
    membership: {
      businessAccountId: String(data.business_account_id),
      role: role as "manager" | "admin",
      memberId: String(data.id),
    },
  };
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidBusinessRole(role: string): role is "employee" | "manager" | "admin" {
  return role === "employee" || role === "manager" || role === "admin";
}
