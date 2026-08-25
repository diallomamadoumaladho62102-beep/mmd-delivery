import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  executeAccountDeletion,
  isDeletableRole,
} from "@/lib/accountDeletion";
import { normalizeUserRole } from "@/lib/roles";
import {
  getSupabasePublishableKey,
  getSupabaseUrl,
} from "@/lib/supabaseEnv";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() ?? null;
}

/**
 * Self-service account deletion.
 * Body: { password: string, confirm_phrase: "DELETE", expected_role?: string }
 * Requires Bearer session of the account owner (client|driver|restaurant|seller).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(request);
    if (auth.ok === false) return auth.response;

    const body = (await request.json().catch(() => ({}))) as {
      password?: string;
      confirm_phrase?: string;
      expected_role?: string;
    };

    const password = String(body.password ?? "");
    const confirm = String(body.confirm_phrase ?? "").trim().toUpperCase();
    if (confirm !== "DELETE") {
      return taxiJson(
        { ok: false, error: "confirm_phrase must be DELETE" },
        400
      );
    }
    if (password.length < 6) {
      return taxiJson({ ok: false, error: "password required" }, 400);
    }

    const email = String(auth.user.email ?? "").trim().toLowerCase();
    if (!email) {
      return taxiJson({ ok: false, error: "Account email missing" }, 400);
    }

    // Re-authenticate with a fresh anon client (stolen-session protection).
    const verifier = createClient(getSupabaseUrl(), getSupabasePublishableKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: reauthErr } = await verifier.auth.signInWithPassword({
      email,
      password,
    });
    if (reauthErr) {
      return taxiJson({ ok: false, error: "Invalid password" }, 403);
    }
    await verifier.auth.signOut().catch(() => undefined);

    const { data: profile, error: profileErr } = await auth.supabaseAdmin
      .from("profiles")
      .select("id, role, account_status, is_founder")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (profileErr) {
      return taxiJson({ ok: false, error: profileErr.message }, 500);
    }
    if (!profile) {
      return taxiJson({ ok: false, error: "Profile not found" }, 404);
    }
    if (profile.is_founder === true) {
      return taxiJson(
        { ok: false, error: "Founder accounts cannot be deleted this way" },
        403
      );
    }

    const role = normalizeUserRole(profile.role);
    if (!isDeletableRole(role)) {
      return taxiJson(
        {
          ok: false,
          error: "This account type cannot use self-service deletion",
        },
        403
      );
    }

    const expected = String(body.expected_role ?? "")
      .trim()
      .toLowerCase();
    if (expected && expected !== role) {
      return taxiJson({ ok: false, error: "Role mismatch" }, 403);
    }

    if (String(profile.account_status) === "deleted") {
      return taxiJson({ ok: false, error: "Account already deleted" }, 409);
    }

    const result = await executeAccountDeletion({
      supabaseAdmin: auth.supabaseAdmin,
      userId: auth.user.id,
      role,
      requestedBy: auth.user.id,
      ipAddress: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    if (result.ok === false) {
      return taxiJson({ ok: false, error: result.error }, 500);
    }

    return taxiJson({
      ok: true,
      deleted: true,
      role,
      message:
        "Account deleted. Personal data anonymized. Financial records retained as required by law.",
    });
  } catch (e) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      endpoint: "/api/account/delete",
      method: "POST",
      requires: ["Bearer session", "password", 'confirm_phrase=DELETE'],
    },
    { status: 200 }
  );
}
