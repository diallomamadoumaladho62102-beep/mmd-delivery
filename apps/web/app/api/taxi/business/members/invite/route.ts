import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import {
  isValidBusinessRole,
  normalizeInviteEmail,
  requireBusinessManager,
} from "@/lib/taxiBusinessMembers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = normalizeInviteEmail(String(body.email ?? ""));
    const role = String(body.role ?? "employee").trim().toLowerCase();
    const businessAccountId =
      String(body.business_account_id ?? "").trim() || null;

    if (!email || !email.includes("@")) {
      return taxiJson({ ok: false, error: "valid_email_required" }, 400);
    }
    if (!isValidBusinessRole(role)) {
      return taxiJson({ ok: false, error: "invalid_role" }, 400);
    }

    const gated = await requireBusinessManager(
      auth.supabaseAdmin,
      auth.user,
      businessAccountId
    );
    if (gated.ok === false) return gated.response;

    const accountId = gated.membership.businessAccountId;

    const { data: existingProfile } = await auth.supabaseAdmin
      .from("profiles")
      .select("id, email, full_name")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (existingProfile?.id) {
      const { data: existingMember } = await auth.supabaseAdmin
        .from("taxi_business_members")
        .select("id, role, active")
        .eq("business_account_id", accountId)
        .eq("user_id", existingProfile.id)
        .maybeSingle();

      if (existingMember?.id) {
        if (!existingMember.active || existingMember.role !== role) {
          const { data: updated, error: updateError } = await auth.supabaseAdmin
            .from("taxi_business_members")
            .update({ role, active: true })
            .eq("id", existingMember.id)
            .select("id, user_id, role, active")
            .maybeSingle();
          if (updateError) {
            return taxiJson({ ok: false, error: updateError.message }, 500);
          }
          return taxiJson({
            ok: true,
            mode: "member_updated",
            member: updated,
          });
        }
        return taxiJson({
          ok: true,
          mode: "already_member",
          member: existingMember,
        });
      }

      const { data: inserted, error: insertError } = await auth.supabaseAdmin
        .from("taxi_business_members")
        .insert({
          business_account_id: accountId,
          user_id: existingProfile.id,
          role,
          active: true,
        })
        .select("id, user_id, role, active")
        .maybeSingle();

      if (insertError) {
        return taxiJson({ ok: false, error: insertError.message }, 500);
      }

      return taxiJson({
        ok: true,
        mode: "member_added",
        member: inserted,
        profile: {
          id: existingProfile.id,
          email: existingProfile.email,
          full_name: existingProfile.full_name,
        },
      });
    }

    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    await auth.supabaseAdmin
      .from("taxi_business_member_invites")
      .update({ status: "revoked" })
      .eq("business_account_id", accountId)
      .eq("status", "pending")
      .ilike("email", email);

    const { data: created, error: createError } = await auth.supabaseAdmin
      .from("taxi_business_member_invites")
      .insert({
        business_account_id: accountId,
        email,
        role,
        token,
        invited_by: auth.user.id,
        status: "pending",
        expires_at: expiresAt,
      })
      .select("id, email, role, status, expires_at, token, created_at")
      .maybeSingle();

    if (createError) {
      return taxiJson({ ok: false, error: createError.message }, 500);
    }

    return taxiJson({
      ok: true,
      mode: "invite_created",
      invite: created,
    });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
