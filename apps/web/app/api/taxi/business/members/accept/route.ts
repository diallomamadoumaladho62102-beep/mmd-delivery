import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { normalizeInviteEmail } from "@/lib/taxiBusinessMembers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const token = String(body.token ?? "").trim();
    if (!token || token.length < 16) {
      return taxiJson({ ok: false, error: "token_required" }, 400);
    }

    const { data: invite, error: inviteError } = await auth.supabaseAdmin
      .from("taxi_business_member_invites")
      .select(
        "id, business_account_id, email, role, status, expires_at, token"
      )
      .eq("token", token)
      .maybeSingle();

    if (inviteError) {
      return taxiJson({ ok: false, error: inviteError.message }, 500);
    }
    if (!invite) {
      return taxiJson({ ok: false, error: "invite_not_found" }, 404);
    }
    if (invite.status !== "pending") {
      return taxiJson({ ok: false, error: "invite_not_pending" }, 400);
    }
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
      await auth.supabaseAdmin
        .from("taxi_business_member_invites")
        .update({ status: "expired" })
        .eq("id", invite.id);
      return taxiJson({ ok: false, error: "invite_expired" }, 400);
    }

    const userEmail = normalizeInviteEmail(
      String(auth.user.email ?? "")
    );
    const inviteEmail = normalizeInviteEmail(String(invite.email ?? ""));

    // Prefer auth email; fall back to profiles.email
    let matched = userEmail && inviteEmail && userEmail === inviteEmail;
    if (!matched) {
      const { data: profile } = await auth.supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("id", auth.user.id)
        .maybeSingle();
      const profileEmail = normalizeInviteEmail(String(profile?.email ?? ""));
      matched = Boolean(profileEmail && profileEmail === inviteEmail);
    }

    if (!matched) {
      return taxiJson({ ok: false, error: "email_mismatch" }, 403);
    }

    const { data: existing } = await auth.supabaseAdmin
      .from("taxi_business_members")
      .select("id, role, active")
      .eq("business_account_id", invite.business_account_id)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    let member = existing;
    if (existing?.id) {
      const { data: updated, error: updateError } = await auth.supabaseAdmin
        .from("taxi_business_members")
        .update({ role: invite.role, active: true })
        .eq("id", existing.id)
        .select("id, user_id, role, active, business_account_id")
        .maybeSingle();
      if (updateError) {
        return taxiJson({ ok: false, error: updateError.message }, 500);
      }
      member = updated;
    } else {
      const { data: inserted, error: insertError } = await auth.supabaseAdmin
        .from("taxi_business_members")
        .insert({
          business_account_id: invite.business_account_id,
          user_id: auth.user.id,
          role: invite.role,
          active: true,
        })
        .select("id, user_id, role, active, business_account_id")
        .maybeSingle();
      if (insertError) {
        return taxiJson({ ok: false, error: insertError.message }, 500);
      }
      member = inserted;
    }

    await auth.supabaseAdmin
      .from("taxi_business_member_invites")
      .update({ status: "accepted" })
      .eq("id", invite.id);

    return taxiJson({
      ok: true,
      member,
      business_account_id: invite.business_account_id,
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
