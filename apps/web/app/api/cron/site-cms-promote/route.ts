import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { promoteScheduledContent } from "@/lib/siteCms";
import { revalidateTag } from "next/cache";
import { SITE_CMS_TAG } from "@/lib/siteCms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const supabase = buildSupabaseAdminClient();
    const result = await promoteScheduledContent(supabase);
    if (result.promoted > 0) {
      revalidateTag(SITE_CMS_TAG, "max");
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
