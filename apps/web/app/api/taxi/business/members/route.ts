import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import {
  isBusinessManagerRole,
  requireBusinessActiveMember,
} from "@/lib/taxiBusinessMembers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const businessAccountId =
      req.nextUrl.searchParams.get("business_account_id")?.trim() || null;

    const gated = await requireBusinessActiveMember(
      auth.supabaseAdmin,
      auth.user,
      businessAccountId
    );
    if (gated.ok === false) return gated.response;

    const accountId = gated.membership.businessAccountId;
    const canManage = isBusinessManagerRole(gated.membership.role);

    const { data: members, error } = await auth.supabaseAdmin
      .from("taxi_business_members")
      .select("id, user_id, role, active, created_at")
      .eq("business_account_id", accountId)
      .order("created_at", { ascending: true });

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const userIds = (members ?? [])
      .map((m) => String(m.user_id))
      .filter(Boolean);

    const profileById = new Map<
      string,
      { full_name: string | null; email: string | null }
    >();

    if (userIds.length > 0) {
      const { data: profiles } = await auth.supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      for (const p of profiles ?? []) {
        profileById.set(String(p.id), {
          full_name: (p.full_name as string | null) ?? null,
          email: (p.email as string | null) ?? null,
        });
      }
    }

    const { data: invites } = canManage
      ? await auth.supabaseAdmin
          .from("taxi_business_member_invites")
          .select("id, email, role, status, expires_at, created_at")
          .eq("business_account_id", accountId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
      : { data: [] as Array<{
          id: string;
          email: string;
          role: string;
          status: string;
          expires_at: string | null;
          created_at: string;
        }> };

    return taxiJson({
      ok: true,
      business_account_id: accountId,
      role: gated.membership.role,
      can_invite: canManage,
      members: (members ?? []).map((m) => {
        const profile = profileById.get(String(m.user_id));
        return {
          id: m.id,
          user_id: m.user_id,
          role: m.role,
          active: m.active,
          created_at: m.created_at,
          full_name: profile?.full_name ?? null,
          email: canManage ? profile?.email ?? null : null,
        };
      }),
      invites: invites ?? [],
    });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
