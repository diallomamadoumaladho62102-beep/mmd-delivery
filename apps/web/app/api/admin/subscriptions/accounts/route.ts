import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  activateSubscription,
  cancelSubscription,
  changeSubscriptionPlan,
  resumeSubscription,
} from "@/lib/subscriptions/subscriptionEngine";
import { cleanText, writeSubscriptionAudit } from "@/lib/subscriptions/subscriptionAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;
const PARTNER_TYPES = new Set(["restaurant", "seller", "driver", "business"]);

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("subscriptions.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const partnerType = String(params.get("partnerType") ?? "").trim();
    const partnerUserId = String(params.get("partnerUserId") ?? "").trim();
    const status = String(params.get("status") ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 100) || 100));

    let query = supabase
      .from("partner_subscriptions")
      .select("*, subscription_plans(code, name, billing_period)")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (partnerType) query = query.eq("partner_type", partnerType);
    if (partnerUserId) query = query.eq("partner_user_id", partnerUserId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, subscriptions: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

/**
 * Admin actions:
 *  offer | extend | change_plan | suspend | resume | cancel
 */
export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("subscriptions.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();
    const reason = cleanText(body.reason, 500);
    if (!reason) return json({ ok: false, error: "Reason is required" }, 400);

    if (action === "offer") {
      const partnerType = String(body.partner_type ?? "").trim();
      const partnerUserId = String(body.partner_user_id ?? "").trim();
      const planId = String(body.plan_id ?? "").trim();
      if (!PARTNER_TYPES.has(partnerType) || !UUID_RE.test(partnerUserId) || !UUID_RE.test(planId)) {
        return json({ ok: false, error: "Invalid partner/plan" }, 400);
      }
      const result = await activateSubscription(supabase, {
        partnerType: partnerType as "restaurant" | "seller" | "driver" | "business",
        partnerUserId,
        planId,
        isTrial: body.is_trial === true,
        trialDays: body.trial_days == null ? null : Number(body.trial_days),
        offeredByAdmin: true,
        idempotencyKey: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
        metadata: { offered_by: session.userId, reason },
      });
      await writeSubscriptionAudit({
        supabase,
        adminUserId: session.userId,
        action: "subscription_offered",
        entityType: "partner_subscription",
        entityId: result.subscription_id ? String(result.subscription_id) : null,
        partnerType,
        partnerUserId,
        newValue: result,
        reason,
        request,
      });
      return json({ ok: true, result });
    }

    const subscriptionId = String(body.subscription_id ?? "").trim();
    if (!UUID_RE.test(subscriptionId)) return json({ ok: false, error: "Invalid subscription_id" }, 400);

    const { data: existing } = await supabase
      .from("partner_subscriptions")
      .select("*")
      .eq("id", subscriptionId)
      .maybeSingle();
    if (!existing) return json({ ok: false, error: "Subscription not found" }, 404);

    if (action === "cancel") {
      const result = await cancelSubscription(supabase, subscriptionId, {
        atPeriodEnd: body.at_period_end !== false,
        reason,
      });
      await writeSubscriptionAudit({
        supabase,
        adminUserId: session.userId,
        action: "subscription_canceled",
        entityType: "partner_subscription",
        entityId: subscriptionId,
        partnerType: existing.partner_type,
        partnerUserId: existing.partner_user_id,
        oldValue: existing,
        newValue: result,
        reason,
        request,
      });
      return json({ ok: true, result });
    }

    if (action === "resume") {
      const result = await resumeSubscription(supabase, subscriptionId);
      await writeSubscriptionAudit({
        supabase,
        adminUserId: session.userId,
        action: "subscription_resumed",
        entityType: "partner_subscription",
        entityId: subscriptionId,
        partnerType: existing.partner_type,
        partnerUserId: existing.partner_user_id,
        oldValue: existing,
        newValue: result,
        reason,
        request,
      });
      return json({ ok: true, result });
    }

    if (action === "suspend") {
      const { data, error } = await supabase
        .from("partner_subscriptions")
        .update({ status: "suspended", renews: false })
        .eq("id", subscriptionId)
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      await supabase
        .from("subscription_active_benefits")
        .update({ status: "suspended" })
        .eq("subscription_id", subscriptionId)
        .eq("status", "active");
      await writeSubscriptionAudit({
        supabase,
        adminUserId: session.userId,
        action: "subscription_suspended",
        entityType: "partner_subscription",
        entityId: subscriptionId,
        partnerType: existing.partner_type,
        partnerUserId: existing.partner_user_id,
        oldValue: existing,
        newValue: data,
        reason,
        request,
      });
      return json({ ok: true, subscription: data });
    }

    if (action === "change_plan") {
      const planId = String(body.plan_id ?? "").trim();
      if (!UUID_RE.test(planId)) return json({ ok: false, error: "Invalid plan_id" }, 400);
      const result = await changeSubscriptionPlan(supabase, subscriptionId, planId, reason);
      await writeSubscriptionAudit({
        supabase,
        adminUserId: session.userId,
        action: "subscription_plan_changed",
        entityType: "partner_subscription",
        entityId: subscriptionId,
        partnerType: existing.partner_type,
        partnerUserId: existing.partner_user_id,
        oldValue: existing,
        newValue: result,
        reason,
        request,
      });
      return json({ ok: true, result });
    }

    if (action === "extend") {
      const days = Math.max(1, Math.round(Number(body.days ?? 30)) || 30);
      const currentEnd = existing.current_period_end
        ? new Date(String(existing.current_period_end))
        : new Date();
      const base = currentEnd.getTime() > Date.now() ? currentEnd : new Date();
      const next = new Date(base.getTime() + days * 86400000);
      const { data, error } = await supabase
        .from("partner_subscriptions")
        .update({
          current_period_end: next.toISOString(),
          status: existing.status === "expired" ? "active" : existing.status,
          renews: true,
        })
        .eq("id", subscriptionId)
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeSubscriptionAudit({
        supabase,
        adminUserId: session.userId,
        action: "subscription_extended",
        entityType: "partner_subscription",
        entityId: subscriptionId,
        partnerType: existing.partner_type,
        partnerUserId: existing.partner_user_id,
        oldValue: existing,
        newValue: data,
        reason,
        request,
      });
      return json({ ok: true, subscription: data });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
