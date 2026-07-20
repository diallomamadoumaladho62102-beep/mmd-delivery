import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { canReadPricing } from "@/lib/adminAccess";
import {
  effectiveStaffRole,
  hasPermission,
  type AdminPermission,
} from "@/lib/adminRbac";
import { type UserRole } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabaseServer";

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase env for admin page auth");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

export async function requireStaffPageAccess(
  permission?: AdminPermission
): Promise<{ userId: string; role: UserRole }> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/admin/login");

  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_founder")
    .eq("id", user.id)
    .maybeSingle();

  const role = effectiveStaffRole({
    role: profile?.role,
    isFounder: profile?.is_founder === true,
  });

  if (!role || !hasPermission(role, permission ?? "hub.access")) {
    redirect("/admin");
  }

  return { userId: user.id, role };
}

export async function requirePricingPageAccess(): Promise<{
  userId: string;
  role: UserRole;
  canWrite: boolean;
}> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/admin/login");

  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_founder")
    .eq("id", user.id)
    .maybeSingle();

  const role = effectiveStaffRole({
    role: profile?.role,
    isFounder: profile?.is_founder === true,
  });

  if (!role || !canReadPricing(role)) redirect("/admin");

  const { canModifyPricing } = await import("@/lib/adminAccess");

  return { userId: user.id, role, canWrite: canModifyPricing(role) };
}
