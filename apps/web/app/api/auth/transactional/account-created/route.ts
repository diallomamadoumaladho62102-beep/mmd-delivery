import { NextRequest, NextResponse } from "next/server";

import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { notifyAccountCreatedEmail } from "@/lib/transactionalEmails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const admin = buildSupabaseAdminClient();
    const {
      data: { user },
      error,
    } = await admin.auth.getUser(token);

    if (error || !user?.id) {
      return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { name?: string | null };
    const name =
      String(body.name ?? user.user_metadata?.full_name ?? "").trim() || null;

    await notifyAccountCreatedEmail({
      supabaseAdmin: admin,
      userId: user.id,
      name,
    });

    return NextResponse.json({ ok: true, skipped: true });
  } catch (error) {
    console.error("[auth/transactional/account-created]", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
