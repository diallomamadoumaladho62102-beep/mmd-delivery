import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { canReadPricing } from "@/lib/adminAccess";
import { hasPermission, type AdminPermission } from "@/lib/adminRbac";
import { normalizeUserRole, type UserRole } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabaseServer";

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  if (!user) redirect("/auth/sign-in");

  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = normalizeUserRole(profile?.role);

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

  if (!user) redirect("/auth/sign-in");

  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = normalizeUserRole(profile?.role);

  if (!role || !canReadPricing(role)) redirect("/admin");

  const { canModifyPricing } = await import("@/lib/adminAccess");

  return { userId: user.id, role, canWrite: canModifyPricing(role) };
}
