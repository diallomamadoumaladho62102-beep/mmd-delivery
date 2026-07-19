import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeMmdPlusAudit } from "@/lib/mmdPlus/mmdPlusAdmin";
import {
  activateMmdPlus,
  cancelMmdPlus,
  changeMmdPlusPlan,
  extendMmdPlus,
  resumeMmdPlus,
  suspendMmdPlus,
} from "@/lib/mmdPlus/mmdPlusEngine";
import { notifyMmdPlusEvent } from "@/lib/mmdPlus/mmdPlusNotifications";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function cleanText(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("mmd_plus.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const userId = String(params.get("userId") ?? "").trim();
    const status = String(params.get("status") ?? "").trim();
    const q = String(params.get("q") ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 100) || 100));

    let query = supabase
      .from("mmd_plus_subscriptions")
      .select("*, mmd_plus_plans(code, name, billing_period)")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (userId) query = query.eq("user_id", userId);
    if (status) query = query.eq("status", status);
    if (q && UUID_RE.test(q)) query = query.eq("user_id", q);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, subscriptions: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("mmd_plus.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();
    const reason = cleanText(body.reason);
    if (!reason) return json({ ok: false, error: "Reason is required" }, 400);

    if (action === "offer") {
      const userId = String(body.user_id ?? "").trim();
      const planId = String(body.plan_id ?? "").trim();
      if (!UUID_RE.test(userId) || !UUID_RE.test(planId)) {
        return json({ ok: false, error: "Invalid user/plan" }, 400);
      }
      const result = await activateMmdPlus(supabase, {
        userId,
        planId,
        isTrial: body.is_trial === true,
        trialDays: body.trial_days == null ? null : Number(body.trial_days),
        offeredByAdmin: true,
        idempotencyKey: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
        metadata: { offered_by: session.userId, reason },
      });
      await writeMmdPlusAudit({
        supabase,
        adminUserId: session.userId,
        action: "offer",
        entityType: "mmd_plus_subscription",
        entityId: result.subscription_id ? String(result.subscription_id) : null,
        userId,
        newValue: result,
        reason,
        request,
      });
      await notifyMmdPlusEvent(supabase, {
        userId,
        event: body.is_trial === true ? "trial_started" : "created",
      });
      return json({ ok: true, result });
    }

    const subscriptionId = String(body.subscription_id ?? "").trim();
    if (!UUID_RE.test(subscriptionId)) {
      return json({ ok: false, error: "Invalid subscription_id" }, 400);
    }

    const { data: existing } = await supabase
      .from("mmd_plus_subscriptions")
      .select("*")
      .eq("id", subscriptionId)
      .maybeSingle();
    if (!existing) return json({ ok: false, error: "Subscription not found" }, 404);

    let result: Record<string, unknown> = {};

    if (action === "extend") {
      const days = Math.max(1, Math.round(Number(body.days ?? 0)));
      result = await extendMmdPlus(supabase, subscriptionId, days, reason);
    } else if (action === "change_plan") {
      const planId = String(body.plan_id ?? "").trim();
      if (!UUID_RE.test(planId)) return json({ ok: false, error: "Invalid plan_id" }, 400);
      result = await changeMmdPlusPlan(supabase, subscriptionId, planId, reason);
      await notifyMmdPlusEvent(supabase, {
        userId: String(existing.user_id),
        event: "plan_changed",
      });
    } else if (action === "suspend") {
      result = await suspendMmdPlus(supabase, subscriptionId, reason);
    } else if (action === "resume") {
      result = await resumeMmdPlus(supabase, subscriptionId);
    } else if (action === "cancel") {
      result = await cancelMmdPlus(supabase, subscriptionId, {
        atPeriodEnd: body.at_period_end !== false,
        reason,
      });
      await notifyMmdPlusEvent(supabase, {
        userId: String(existing.user_id),
        event: "canceled",
      });
    } else {
      return json({ ok: false, error: "Unknown action" }, 400);
    }

    await writeMmdPlusAudit({
      supabase,
      adminUserId: session.userId,
      action,
      entityType: "mmd_plus_subscription",
      entityId: subscriptionId,
      userId: String(existing.user_id),
      oldValue: existing,
      newValue: result,
      reason,
      request,
    });

    return json({ ok: true, result });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
