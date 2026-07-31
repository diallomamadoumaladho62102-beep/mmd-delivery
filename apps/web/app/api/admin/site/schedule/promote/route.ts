import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { promoteScheduledContent } from "@/lib/siteCms";
import { adminError, json, revalidateSiteCms } from "../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.manage", request);
    const supabase = buildSupabaseAdminClient();
    const result = await promoteScheduledContent(supabase);
    if (result.promoted > 0) revalidateSiteCms();
    return json({ ok: true, ...result });
  } catch (e) {
    return adminError(e);
  }
}
