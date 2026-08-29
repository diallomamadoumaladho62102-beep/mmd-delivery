import { NextRequest, NextResponse } from "next/server";

import { executeMaskedCallAction } from "@/lib/maskedCallAction";
import { assertProfileActive, inactiveAccountBody } from "@/lib/requireActiveAccount";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const supabaseAdmin = buildSupabaseAdminClient();
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ ok: false, error: "Invalid user token" }, { status: 401 });
    }

    const account = await assertProfileActive(supabaseAdmin, user.id);
    if (account.ok === false) {
      return NextResponse.json(inactiveAccountBody(account), { status: account.status });
    }

    const body = (await req.json().catch(() => null)) as {
      sessionId?: unknown;
      action?: unknown;
    } | null;
    const sessionId = String(body?.sessionId ?? "").trim();
    const action = String(body?.action ?? "").trim().toLowerCase();
    if (action !== "decline" && action !== "end") {
      return NextResponse.json(
        { ok: false, error: "action must be decline or end" },
        { status: 400 },
      );
    }

    const result = await executeMaskedCallAction({
      userId: user.id,
      sessionId,
      action,
      supabaseAdmin,
    });

    if (result.ok === false) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
      ringingStopped: true,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
