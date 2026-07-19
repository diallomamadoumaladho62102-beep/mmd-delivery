import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeFinanceAudit } from "@/lib/finance/financeAudit";
import {
  getFinanceDashboard,
  listFinanceAccounts,
  listJournalEntries,
  listSourceEvents,
} from "@/lib/finance/financeDashboard";
import {
  processFinancePendingBatch,
  refreshFinanceBalances,
} from "@/lib/finance/financeEvents";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    const session = await assertStaffPermission("finance.read", request);
    const supabase = buildSupabaseAdminClient();
    const view = String(request.nextUrl.searchParams.get("view") ?? "overview");
    const from = request.nextUrl.searchParams.get("from") ?? undefined;
    const to = request.nextUrl.searchParams.get("to") ?? undefined;
    const country = request.nextUrl.searchParams.get("country") ?? undefined;
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);

    if (view === "overview" || view === "treasury" || view === "revenue") {
      const dashboard = await getFinanceDashboard(supabase, { from, to, country });
      await writeFinanceAudit({
        supabase,
        adminUserId: session.userId,
        action: "dashboard_view",
        entityType: "finance_dashboard",
        request,
        metadata: { view },
      });
      return json({ ok: true, view, dashboard });
    }

    if (view === "ledger" || view === "journal") {
      await assertStaffPermission("finance.transactions.read", request);
      const entries = await listJournalEntries(supabase, { limit, status, from, to });
      return json({ ok: true, view, entries });
    }

    if (view === "accounts") {
      const accounts = await listFinanceAccounts(supabase);
      return json({ ok: true, view, accounts });
    }

    if (view === "events" || view === "payments") {
      const events = await listSourceEvents(supabase, { status, limit });
      return json({ ok: true, view, events });
    }

    if (view === "periods") {
      const { data, error } = await supabase
        .from("finance_periods")
        .select("*")
        .order("starts_on", { ascending: false })
        .limit(24);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, view, periods: data ?? [] });
    }

    if (view === "disputes") {
      await assertStaffPermission("finance.disputes.manage", request).catch(async () => {
        await assertStaffPermission("finance.read", request);
      });
      const { data, error } = await supabase
        .from("finance_disputes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, view, disputes: data ?? [] });
    }

    if (view === "adjustments") {
      const { data, error } = await supabase
        .from("finance_adjustments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, view, adjustments: data ?? [] });
    }

    if (view === "reconciliation") {
      await assertStaffPermission("finance.reconciliation.manage", request);
      const { data, error } = await supabase
        .from("finance_reconciliation_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, view, runs: data ?? [] });
    }

    if (view === "audit") {
      await assertStaffPermission("finance.audit.read", request);
      const { data, error } = await supabase
        .from("finance_audit")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, view, audits: data ?? [] });
    }

    return json({ ok: false, error: "unknown_view" }, 400);
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
    const supabase = buildSupabaseAdminClient();

    if (action === "process_pending") {
      const session = await assertStaffPermission(
        "finance.reconciliation.manage",
        request
      );
      const result = await processFinancePendingBatch(
        supabase,
        Number(body.limit ?? 100)
      );
      await writeFinanceAudit({
        supabase,
        adminUserId: session.userId,
        action: "process_pending",
        reason: String(body.reason ?? "manual"),
        request,
        newValue: result,
      });
      return json({ ok: true, result });
    }

    if (action === "refresh_balances") {
      const session = await assertStaffPermission("finance.periods.manage", request);
      const result = await refreshFinanceBalances(
        supabase,
        body.as_of ? String(body.as_of) : undefined
      );
      await writeFinanceAudit({
        supabase,
        adminUserId: session.userId,
        action: "refresh_balances",
        request,
        newValue: result,
      });
      return json({ ok: true, result });
    }

    if (action === "create_adjustment") {
      const session = await assertStaffPermission(
        "finance.adjustments.create",
        request
      );
      const amount = Math.max(1, Math.round(Number(body.amount_cents ?? 0)));
      const dual = amount >= Number(body.dual_threshold_cents ?? 100000);
      if (dual && String(body.requested_by ?? "") === session.userId) {
        // dual approval required later; create as pending
      }
      const { data: entity } = await supabase
        .from("finance_legal_entities")
        .select("id")
        .eq("code", "MMD_US")
        .maybeSingle();
      if (!entity?.id) return json({ ok: false, error: "legal_entity_missing" }, 500);

      const { data, error } = await supabase
        .from("finance_adjustments")
        .insert({
          legal_entity_id: entity.id,
          adjustment_type: String(body.adjustment_type ?? "correction"),
          amount_cents: amount,
          currency: String(body.currency ?? "USD"),
          debit_account_id: String(body.debit_account_id),
          credit_account_id: String(body.credit_account_id),
          reason: String(body.reason ?? "").trim() || "adjustment",
          status: dual ? "pending_approval" : "pending_approval",
          requires_dual_approval: dual,
          requested_by: session.userId,
          reference: body.reference ? String(body.reference) : null,
        })
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeFinanceAudit({
        supabase,
        adminUserId: session.userId,
        action: "adjustment_create",
        entityType: "finance_adjustments",
        entityId: data?.id,
        reason: String(body.reason ?? ""),
        request,
        newValue: data,
      });
      return json({ ok: true, adjustment: data });
    }

    if (action === "approve_adjustment") {
      const session = await assertStaffPermission(
        "finance.adjustments.approve",
        request
      );
      const adjustmentId = String(body.adjustment_id ?? "").trim();
      const { data: adj } = await supabase
        .from("finance_adjustments")
        .select("*")
        .eq("id", adjustmentId)
        .maybeSingle();
      if (!adj) return json({ ok: false, error: "not_found" }, 404);
      if (adj.requested_by === session.userId) {
        return json({ ok: false, error: "cannot_self_approve" }, 403);
      }
      const { data, error } = await supabase
        .from("finance_adjustments")
        .update({
          status: "approved",
          approved_by: session.userId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", adjustmentId)
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);

      // Post compensating entry
      const { data: debitAcc } = await supabase
        .from("finance_accounts")
        .select("code")
        .eq("id", adj.debit_account_id)
        .maybeSingle();
      const { data: creditAcc } = await supabase
        .from("finance_accounts")
        .select("code")
        .eq("id", adj.credit_account_id)
        .maybeSingle();
      const { data: posted } = await supabase.rpc("mmd_finance_post_entry", {
        p_event_type: "manual_adjustment",
        p_idempotency_key: `finance:adjustment:${adjustmentId}`,
        p_lines: [
          {
            account_code: debitAcc?.code,
            debit_cents: adj.amount_cents,
            credit_cents: 0,
          },
          {
            account_code: creditAcc?.code,
            debit_cents: 0,
            credit_cents: adj.amount_cents,
          },
        ],
        p_description: adj.reason,
        p_created_by: session.userId,
      });

      await supabase
        .from("finance_adjustments")
        .update({
          status: "executed",
          journal_entry_id: (posted as { journal_entry_id?: string })?.journal_entry_id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", adjustmentId);

      await writeFinanceAudit({
        supabase,
        adminUserId: session.userId,
        action: "adjustment_approve",
        entityType: "finance_adjustments",
        entityId: adjustmentId,
        request,
        newValue: { adjustment: data, posted },
      });
      return json({ ok: true, adjustment: data, posted });
    }

    if (action === "close_period") {
      const session = await assertStaffPermission("finance.periods.manage", request);
      const periodId = String(body.period_id ?? "").trim();
      const { data, error } = await supabase
        .from("finance_periods")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          closed_by: session.userId,
          notes: body.notes ? String(body.notes) : null,
        })
        .eq("id", periodId)
        .eq("status", "open")
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      await writeFinanceAudit({
        supabase,
        adminUserId: session.userId,
        action: "period_close",
        entityType: "finance_periods",
        entityId: periodId,
        reason: String(body.notes ?? ""),
        request,
        newValue: data,
      });
      return json({ ok: true, period: data });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return json({ ok: false, error: e.message }, e.status);
    }
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
}
