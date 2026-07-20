import type { SupabaseClient } from "@supabase/supabase-js";
import { filterRowsByLiveTripParent } from "@/lib/tripVisibility";

export async function getFinanceDashboard(
  supabase: SupabaseClient,
  filters?: { from?: string; to?: string; country?: string }
): Promise<Record<string, number | string | null>> {
  const from = filters?.from ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = filters?.to ?? new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const countStatus = async (status: string) => {
    const { count } = await supabase
      .from("finance_source_events")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    return count ?? 0;
  };

  const sumLines = async (accountCodes: string[], fromDate: string, toDate: string) => {
    const { data: accounts } = await supabase
      .from("finance_accounts")
      .select("id,code")
      .in("code", accountCodes);
    const ids = (accounts ?? []).map((a) => a.id);
    if (ids.length === 0) return 0;
    const { data: entries } = await supabase
      .from("finance_journal_entries")
      .select("id")
      .eq("status", "posted")
      .gte("accounting_date", fromDate)
      .lte("accounting_date", toDate)
      .limit(2000);
    const entryIds = (entries ?? []).map((e) => e.id);
    if (entryIds.length === 0) return 0;
    const { data: lines } = await supabase
      .from("finance_journal_lines")
      .select("account_id,debit_cents,credit_cents")
      .in("journal_entry_id", entryIds)
      .in("account_id", ids)
      .limit(5000);
    return (lines ?? []).reduce(
      (acc, row) => acc + Number(row.credit_cents ?? 0) + Number(row.debit_cents ?? 0),
      0
    );
  };

  const [
    pendingEvents,
    failedEvents,
    manualReview,
    openPeriods,
    disputesOpen,
    revenueMonth,
    feesMonth,
  ] = await Promise.all([
    countStatus("pending"),
    countStatus("failed"),
    countStatus("manual_review"),
    supabase
      .from("finance_periods")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .then((r) => r.count ?? 0),
    supabase
      .from("finance_disputes")
      .select("id", { count: "exact", head: true })
      .in("status", ["warning", "needs_response", "under_review"])
      .then((r) => r.count ?? 0),
    sumLines(["4010", "4020", "4030", "4040", "4100", "4200", "4210"], from, to),
    sumLines(["5010"], from, to),
  ]);

  const todayRevenue = await sumLines(
    ["4010", "4020", "4030", "4040", "4100"],
    today,
    today
  );

  return {
    collections_today_cents: todayRevenue,
    collections_month_cents: revenueMonth,
    mmd_revenue_cents: revenueMonth,
    payment_fees_cents: feesMonth,
    pending_source_events: pendingEvents,
    failed_source_events: failedEvents,
    manual_review_events: manualReview,
    open_periods: openPeriods,
    open_disputes: disputesOpen,
    unmatched_hint: pendingEvents + failedEvents + manualReview,
    from,
    to,
    country: filters?.country ?? null,
  };
}

export async function listJournalEntries(
  supabase: SupabaseClient,
  params: { limit?: number; status?: string; from?: string; to?: string }
) {
  let q = supabase
    .from("finance_journal_entries")
    .select(
      "id,accounting_date,event_type,source_type,source_id,vertical,currency,status,description,idempotency_key,posted_at,created_at"
    )
    .order("accounting_date", { ascending: false })
    .limit(Math.min(params.limit ?? 50, 400));
  if (params.status) q = q.eq("status", params.status);
  if (params.from) q = q.gte("accounting_date", params.from);
  if (params.to) q = q.lte("accounting_date", params.to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const filtered = await filterRowsByLiveTripParent(
    supabase,
    (data ?? []) as Record<string, unknown>[]
  );
  return filtered.slice(0, Math.min(params.limit ?? 50, 200));
}

export async function listFinanceAccounts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("finance_accounts")
    .select("id,code,name,category,status,is_system,currency")
    .order("code", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listSourceEvents(
  supabase: SupabaseClient,
  params?: { status?: string; limit?: number }
) {
  const limit = Math.min(params?.limit ?? 50, 200);
  let q = supabase
    .from("finance_source_events")
    .select(
      "id,source_type,source_id,event_type,status,attempts,last_error,vertical,currency,journal_entry_id,idempotency_key,created_at,processed_at"
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(limit * 2, 400));
  if (params?.status) q = q.eq("status", params.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const filtered = await filterRowsByLiveTripParent(
    supabase,
    (data ?? []) as Record<string, unknown>[]
  );
  return filtered.slice(0, limit);
}
