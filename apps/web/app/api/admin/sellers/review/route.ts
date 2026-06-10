import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanReviewSellers } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { fetchPlatformScopeConfig } from "@/lib/platformScopeResolver";

export const dynamic = "force-dynamic";

type SellerReviewStatus = "approved" | "rejected" | "suspended";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function isSellerReviewStatus(value: unknown): value is SellerReviewStatus {
  return value === "approved" || value === "rejected" || value === "suspended";
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertCanReviewSellers(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sellerId = String(body.sellerId ?? body.seller_id ?? "").trim();
    const status = body.status;
    const reviewNotes = String(body.reviewNotes ?? body.review_notes ?? "").trim();

    if (!sellerId) return json({ ok: false, error: "Missing sellerId" }, 400);
    if (!isSellerReviewStatus(status)) {
      return json({ ok: false, error: "Invalid status" }, 400);
    }

    const supabase = buildSupabaseAdminClient();
    const { data: existing, error: readErr } = await supabase
      .from("sellers")
      .select("*")
      .eq("id", sellerId)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "Seller not found" }, 404);

    if (status === "approved") {
      const scopeConfig = await fetchPlatformScopeConfig(supabase, {
        country_code: existing.country_code,
        region_code: existing.region_code,
        mmd_zone_id: existing.mmd_zone_id,
      });

      if (
        !scopeConfig?.platform_enabled ||
        !scopeConfig.marketplace_enabled ||
        !scopeConfig.seller_enabled
      ) {
        return json(
          {
            ok: false,
            error: "platform_seller_disabled",
            message: `Marketplace/seller is not enabled for ${existing.country_code}${
              existing.region_code ? `/${existing.region_code}` : ""
            }`,
          },
          403
        );
      }
    }

    const { data: updated, error: updateErr } = await supabase
      .from("sellers")
      .update({
        status,
        review_notes: reviewNotes || null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: session.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sellerId)
      .select("*")
      .maybeSingle();

    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: `seller_${status}`,
      targetType: "sellers",
      targetId: sellerId,
      oldValues: existing as Record<string, unknown>,
      newValues: (updated ?? { status }) as Record<string, unknown>,
      request,
    });

    return json({ ok: true, item: updated });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
