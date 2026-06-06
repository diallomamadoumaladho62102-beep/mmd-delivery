import type { SupabaseClient } from "@supabase/supabase-js";
import { STAFF_ROLES } from "@/lib/adminRbac";
import { AdminAccessError } from "@/lib/adminServer";

type StaffProfileRow = {
  id: string;
  role: string | null;
  account_status: string | null;
  is_founder: boolean | null;
  email: string | null;
  full_name: string | null;
};

export async function resolveFounderAdminUserId(
  supabase: SupabaseClient
): Promise<string | null> {
  const envId = process.env.FOUNDER_ADMIN_USER_ID?.trim();
  if (envId) return envId;

  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_founder", true)
    .limit(1)
    .maybeSingle();

  if (data?.id) return String(data.id);

  const { data: oldest } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return oldest?.id ? String(oldest.id) : null;
}

export function assertNotSelfTarget(
  actorId: string,
  targetId: string,
  action: string
): void {
  if (actorId === targetId) {
    throw new AdminAccessError(`Cannot ${action} your own account`, 403);
  }
}

export async function assertFounderProtected(
  supabase: SupabaseClient,
  target: Pick<StaffProfileRow, "id" | "is_founder">,
  action: string
): Promise<void> {
  if (target.is_founder) {
    throw new AdminAccessError(`Founder account cannot be ${action}`, 403);
  }

  const founderId = await resolveFounderAdminUserId(supabase);
  if (founderId && founderId === target.id) {
    throw new AdminAccessError(`Founder account cannot be ${action}`, 403);
  }
}

export async function loadStaffProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<StaffProfileRow> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, account_status, is_founder, email, full_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new AdminAccessError(error.message, 500);
  if (!data) throw new AdminAccessError("Profile not found", 404);

  return data as StaffProfileRow;
}

export async function assertTargetIsStaffAdmin(
  supabase: SupabaseClient,
  userId: string
): Promise<StaffProfileRow> {
  const profile = await loadStaffProfile(supabase, userId);

  if (!(STAFF_ROLES as readonly string[]).includes(String(profile.role ?? ""))) {
    throw new AdminAccessError("Target is not a staff administrator", 400);
  }

  return profile;
}

export function assertStaffAccountActive(
  accountStatus: string | null | undefined
): void {
  const status = String(accountStatus ?? "active").trim().toLowerCase();
  if (status !== "active") {
    throw new AdminAccessError("Staff account is not active", 403);
  }
}
