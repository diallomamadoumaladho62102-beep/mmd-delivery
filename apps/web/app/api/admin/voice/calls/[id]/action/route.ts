import { NextRequest, NextResponse } from "next/server";

import {
  executeAdminVoiceCallAction,
  parseAdminVoiceCallAction,
} from "@/lib/adminVoiceCallAction";
import { ADMIN_VOICE_CALL_PERMISSION } from "@/lib/adminVoiceTransfer";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: RouteCtx) {
  try {
    const session = await assertStaffPermission(
      ADMIN_VOICE_CALL_PERMISSION,
      request,
    );
    const { id: callId } = await ctx.params;
    const body = await request.json().catch(() => null);
    const action = parseAdminVoiceCallAction(body);
    if (!action) {
      return NextResponse.json(
        { ok: false, error: "action must be accept, decline, or end" },
        { status: 400 },
      );
    }

    const result = await executeAdminVoiceCallAction({
      actor: {
        userId: session.userId,
        role: session.role,
        isFounder: session.isFounder,
      },
      callId,
      action,
      supabaseAdmin: buildSupabaseAdminClient(),
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
  } catch (error) {
    const status = error instanceof AdminAccessError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Server error",
      },
      { status },
    );
  }
}
