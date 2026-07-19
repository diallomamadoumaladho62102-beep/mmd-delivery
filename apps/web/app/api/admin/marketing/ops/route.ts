import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeMarketingAudit } from "@/lib/marketing/marketingAdmin";
import { creditAvailableMarketingCashbackBatch } from "@/lib/marketing/marketingCashback";
import {
  payDriverMarketingProgress,
  processDriverMarketingObjectivesBatch,
  reverseDriverMarketingProgress,
} from "@/lib/marketing/marketingDriverRewards";
import { bridgeTaxiLegacyPromotions } from "@/lib/marketing/taxiLegacyBridge";
import {
  captureEntityMarketing,
  releaseEntityMarketing,
  reverseEntityMarketing,
} from "@/lib/marketing/marketingCheckoutLifecycle";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const view = String(request.nextUrl.searchParams.get("view") ?? "summary");

    if (view === "reservations") {
      const status = request.nextUrl.searchParams.get("status");
      let q = supabase
        .from("marketing_reservations")
        .select(
          "id,status,service,entity_type,entity_id,discount_cents,delivery_fee_discount_cents,expires_at,created_at,idempotency_key"
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, reservations: data ?? [] });
    }

    if (view === "cashback") {
      const status = request.nextUrl.searchParams.get("status");
      let q = supabase
        .from("marketing_cashback_ledger")
        .select(
          "id,user_id,amount_cents,status,available_at,credited_at,last_error,mmd_credit_ledger_id,campaign_id,entity_type,entity_id,created_at"
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, cashback: data ?? [] });
    }

    if (view === "driver_rewards") {
      const status = request.nextUrl.searchParams.get("status");
      let q = supabase
        .from("marketing_driver_progress")
        .select(
          "id,objective_id,driver_user_id,progress_count,status,rewarded_at,wallet_ledger_id,reverse_reason,updated_at"
        )
        .order("updated_at", { ascending: false })
        .limit(100);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, driver_progress: data ?? [] });
    }

    if (view === "taxi_legacy") {
      const { data, error } = await supabase
        .from("taxi_promotions")
        .select(
          "id,code,active,bridge_status,marketing_campaign_id,bridged_at,bridge_report,starts_at,ends_at"
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, taxi_promotions: data ?? [] });
    }

    const [
      reserved,
      expired,
      captured,
      cashbackPending,
      cashbackAvailable,
      cashbackCredited,
      cashbackFailed,
      cashbackClawback,
      driverPending,
      taxiLegacy,
    ] = await Promise.all([
      supabase
        .from("marketing_reservations")
        .select("id", { count: "exact", head: true })
        .eq("status", "reserved"),
      supabase
        .from("marketing_reservations")
        .select("id", { count: "exact", head: true })
        .eq("status", "released"),
      supabase
        .from("marketing_reservations")
        .select("id", { count: "exact", head: true })
        .eq("status", "captured"),
      supabase
        .from("marketing_cashback_ledger")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("marketing_cashback_ledger")
        .select("id", { count: "exact", head: true })
        .eq("status", "available"),
      supabase
        .from("marketing_cashback_ledger")
        .select("id", { count: "exact", head: true })
        .eq("status", "credited"),
      supabase
        .from("marketing_cashback_ledger")
        .select("id", { count: "exact", head: true })
        .in("status", ["failed", "pending_recovery"]),
      supabase
        .from("marketing_cashback_ledger")
        .select("id", { count: "exact", head: true })
        .eq("status", "clawed_back"),
      supabase
        .from("marketing_driver_progress")
        .select("id", { count: "exact", head: true })
        .in("status", ["qualified", "completed"]),
      supabase
        .from("taxi_promotions")
        .select("id", { count: "exact", head: true })
        .in("bridge_status", ["legacy_active", "manual_review_required"]),
    ]);

    return json({
      ok: true,
      summary: {
        reservations_reserved: reserved.count ?? 0,
        reservations_released: expired.count ?? 0,
        reservations_captured: captured.count ?? 0,
        cashback_pending: cashbackPending.count ?? 0,
        cashback_available: cashbackAvailable.count ?? 0,
        cashback_credited: cashbackCredited.count ?? 0,
        cashback_failed_or_recovery: cashbackFailed.count ?? 0,
        cashback_clawback: cashbackClawback.count ?? 0,
        driver_rewards_pending: driverPending.count ?? 0,
        taxi_legacy_review: taxiLegacy.count ?? 0,
      },
    });
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return json({ ok: false, error: e.message }, e.status);
    }
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();

    const financeActions = new Set([
      "credit_cashback_batch",
      "process_driver_batch",
      "pay_driver_progress",
      "reverse_driver_progress",
      "bridge_taxi_legacy",
      "capture",
      "release",
      "reverse",
    ]);

    const session = financeActions.has(action)
      ? await assertStaffPermission("marketing.finance", request)
      : await assertStaffPermission("marketing.manage", request);

    const supabase = buildSupabaseAdminClient();
    const reason = String(body.reason ?? "admin_manual_replay").trim();
    const correlationId = String(body.correlation_id ?? crypto.randomUUID());

    if (action === "credit_cashback_batch") {
      const result = await creditAvailableMarketingCashbackBatch(
        supabase,
        Number(body.limit ?? 100)
      );
      await writeMarketingAudit({
        supabase,
        adminUserId: session.userId,
        action: "admin_credit_cashback_batch",
        entityType: "marketing_cashback_ledger",
        reason,
        correlationId,
        newValue: result,
        request,
      });
      return json({ ok: true, result });
    }

    if (action === "process_driver_batch") {
      const result = await processDriverMarketingObjectivesBatch(
        supabase,
        Number(body.limit ?? 100)
      );
      await writeMarketingAudit({
        supabase,
        adminUserId: session.userId,
        action: "admin_process_driver_batch",
        entityType: "marketing_driver_progress",
        reason,
        correlationId,
        newValue: result,
        request,
      });
      return json({ ok: true, result });
    }

    if (action === "pay_driver_progress") {
      const progressId = String(body.progress_id ?? "").trim();
      if (!progressId) return json({ ok: false, error: "progress_id_required" }, 400);
      const result = await payDriverMarketingProgress(supabase, {
        progressId,
        idempotencyKey: `admin:driver:${progressId}:pay`,
        countryCode: body.country_code ? String(body.country_code) : "US",
      });
      return json({ ok: true, result });
    }

    if (action === "reverse_driver_progress") {
      const progressId = String(body.progress_id ?? "").trim();
      if (!progressId) return json({ ok: false, error: "progress_id_required" }, 400);
      const result = await reverseDriverMarketingProgress(supabase, {
        progressId,
        reason,
        idempotencyKey: `admin:driver:${progressId}:reverse`,
      });
      return json({ ok: true, result });
    }

    if (action === "bridge_taxi_legacy") {
      const result = await bridgeTaxiLegacyPromotions(supabase, {
        dryRun: body.dry_run !== false,
        limit: Number(body.limit ?? 200),
      });
      await writeMarketingAudit({
        supabase,
        adminUserId: session.userId,
        action: "admin_bridge_taxi_legacy",
        entityType: "taxi_promotions",
        reason,
        correlationId,
        newValue: { result, dry_run: body.dry_run !== false },
        request,
      });
      return json({ ok: true, result });
    }

    if (action === "capture" || action === "release" || action === "reverse") {
      const kind = String(body.kind ?? "").trim() as
        | "food"
        | "delivery"
        | "taxi"
        | "marketplace";
      const entityId = String(body.entity_id ?? "").trim();
      if (!kind || !entityId) {
        return json({ ok: false, error: "kind_and_entity_id_required" }, 400);
      }
      let result: Record<string, unknown>;
      if (action === "capture") {
        result = await captureEntityMarketing(supabase, kind, entityId);
      } else if (action === "release") {
        result = await releaseEntityMarketing(supabase, kind, entityId, reason);
      } else {
        result = await reverseEntityMarketing(supabase, kind, entityId, {
          reason,
          restoreCoupon: body.restore_coupon === true,
          refundId: body.refund_id ? String(body.refund_id) : null,
        });
      }
      await writeMarketingAudit({
        supabase,
        adminUserId: session.userId,
        action: `admin_${action}`,
        entityType: kind,
        entityId,
        reason,
        correlationId,
        newValue: result,
        request,
      });
      return json({ ok: true, result });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return json({ ok: false, error: e.message }, e.status);
    }
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
}
