import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  generateSecurePromoCode,
  isGuessablePromoCode,
  normalizePromoCodeInput,
  writeMarketingAudit,
} from "@/lib/marketing/marketingAdmin";
import { notifyMarketingClient } from "@/lib/marketing/marketingNotifications";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const campaignId = String(request.nextUrl.searchParams.get("campaignId") ?? "").trim();
    let query = supabase
      .from("marketing_promo_codes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (campaignId) query = query.eq("campaign_id", campaignId);
    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, codes: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("marketing.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "create_code").trim();
    const reason = String(body.reason ?? "admin_action").trim();

    if (action === "grant_coupon") {
      const userId = String(body.user_id ?? "").trim();
      const campaignId = String(body.campaign_id ?? "").trim();
      if (!userId || !campaignId) return json({ ok: false, error: "Missing user/campaign" }, 400);
      const { data, error } = await supabase.rpc("mmd_marketing_grant_coupon", {
        p_user_id: userId,
        p_campaign_id: campaignId,
        p_expires_at: body.expires_at ?? null,
        p_source: "admin",
        p_reason: reason,
        p_idempotency_key: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeMarketingAudit({
        supabase,
        adminUserId: session.userId,
        action: "grant_coupon",
        entityType: "marketing_coupon",
        entityId: (data as { coupon_id?: string })?.coupon_id ?? null,
        campaignId,
        newValue: data,
        reason,
        request,
      });
      await notifyMarketingClient({
        supabaseAdmin: supabase,
        userId,
        title: "Nouveau coupon MMD",
        body: "Un coupon promotionnel a été ajouté à votre portefeuille.",
        event: "coupon_granted",
      });
      return json({ ok: true, result: data });
    }

    if (action === "bulk_generate") {
      const campaignId = String(body.campaign_id ?? "").trim();
      const count = Math.min(500, Math.max(1, Math.round(Number(body.count ?? 1))));
      const kind = String(body.kind ?? "private");
      if (!campaignId) return json({ ok: false, error: "Missing campaign_id" }, 400);
      const rows = [];
      for (let i = 0; i < count; i += 1) {
        const code = generateSecurePromoCode("MMD");
        rows.push({
          campaign_id: campaignId,
          code_normalized: code,
          code_display: code,
          kind,
          status: "active",
          max_redemptions: 1,
          per_user_limit: 1,
          guessable: false,
          created_by: session.userId,
        });
      }
      const { data, error } = await supabase.from("marketing_promo_codes").insert(rows).select("id, code_display");
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeMarketingAudit({
        supabase,
        adminUserId: session.userId,
        action: "bulk_generate_codes",
        entityType: "marketing_promo_code",
        campaignId,
        newValue: { count: data?.length ?? 0 },
        reason,
        request,
      });
      return json({ ok: true, codes: data ?? [] });
    }

    const campaignId = String(body.campaign_id ?? "").trim();
    let code = normalizePromoCodeInput(body.code);
    if (!code) code = generateSecurePromoCode("MMD");
    const kind = String(body.kind ?? "public");
    if (kind !== "public" && isGuessablePromoCode(code)) {
      return json({ ok: false, error: "Code trop facilement devinable" }, 400);
    }
    if (!campaignId) return json({ ok: false, error: "Missing campaign_id" }, 400);

    const { data, error } = await supabase
      .from("marketing_promo_codes")
      .insert({
        campaign_id: campaignId,
        code_normalized: code,
        code_display: code,
        kind,
        status: "active",
        max_redemptions: body.max_redemptions == null ? null : Math.round(Number(body.max_redemptions)),
        per_user_limit: body.per_user_limit == null ? 1 : Math.round(Number(body.per_user_limit)),
        assigned_user_id: typeof body.assigned_user_id === "string" ? body.assigned_user_id : null,
        starts_at: body.starts_at ? String(body.starts_at) : null,
        ends_at: body.ends_at ? String(body.ends_at) : null,
        guessable: isGuessablePromoCode(code),
        created_by: session.userId,
      })
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    await writeMarketingAudit({
      supabase,
      adminUserId: session.userId,
      action: "create_promo_code",
      entityType: "marketing_promo_code",
      entityId: data?.id,
      campaignId,
      newValue: data,
      reason,
      request,
    });
    return json({ ok: true, code: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
