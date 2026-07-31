import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import {
  isValidBusinessRole,
  requireBusinessManager,
} from "@/lib/taxiBusinessMembers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const memberId = String(body.member_id ?? body.id ?? "").trim();
    const businessAccountId =
      String(body.business_account_id ?? "").trim() || null;

    if (!UUID_RE.test(memberId)) {
      return taxiJson({ ok: false, error: "Invalid member_id" }, 400);
    }

    const gated = await requireBusinessManager(
      auth.supabaseAdmin,
      auth.user,
      businessAccountId
    );
    if (gated.ok === false) return gated.response;

    const { data: target, error: findError } = await auth.supabaseAdmin
      .from("taxi_business_members")
      .select("id, user_id, role, active, business_account_id")
      .eq("id", memberId)
      .eq("business_account_id", gated.membership.businessAccountId)
      .maybeSingle();

    if (findError) {
      return taxiJson({ ok: false, error: findError.message }, 500);
    }
    if (!target) {
      return taxiJson({ ok: false, error: "member_not_found" }, 404);
    }

    const patch: Record<string, unknown> = {};

    if (body.role != null) {
      const role = String(body.role).trim().toLowerCase();
      if (!isValidBusinessRole(role)) {
        return taxiJson({ ok: false, error: "invalid_role" }, 400);
      }
      patch.role = role;
    }

    if (body.active != null) {
      patch.active = Boolean(body.active);
    }

    if (Object.keys(patch).length === 0) {
      return taxiJson({ ok: false, error: "nothing_to_update" }, 400);
    }

    // Prevent self-demotion lockout: last admin cannot deactivate themselves
    if (
      String(target.user_id) === auth.user.id &&
      (patch.active === false ||
        (patch.role != null && patch.role !== "admin" && target.role === "admin"))
    ) {
      const { count } = await auth.supabaseAdmin
        .from("taxi_business_members")
        .select("id", { count: "exact", head: true })
        .eq("business_account_id", gated.membership.businessAccountId)
        .eq("role", "admin")
        .eq("active", true);

      if ((count ?? 0) <= 1) {
        return taxiJson({ ok: false, error: "cannot_remove_last_admin" }, 400);
      }
    }

    const { data: updated, error: updateError } = await auth.supabaseAdmin
      .from("taxi_business_members")
      .update(patch)
      .eq("id", memberId)
      .select("id, user_id, role, active, business_account_id")
      .maybeSingle();

    if (updateError) {
      return taxiJson({ ok: false, error: updateError.message }, 500);
    }

    return taxiJson({ ok: true, member: updated });
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
