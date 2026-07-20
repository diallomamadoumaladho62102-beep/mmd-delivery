import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type ArchivedTestRow = {
  entity_kind: string;
  id: string;
  status: string | null;
  payment_status: string | null;
  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;
  client_user_id: string | null;
  driver_id: string | null;
  total: number | null;
  created_at: string | null;
  archived_at: string | null;
  is_test: boolean | null;
  hidden_from_user: boolean | null;
};

const ARCHIVED_TEST_FILTER =
  "is_test.eq.true,archived_at.not.is.null,hidden_from_user.eq.true";

const TRIP_SELECT =
  "id, status, payment_status, stripe_payment_intent_id, stripe_session_id, client_user_id, driver_id, total, total_cents, created_at, archived_at, is_test, hidden_from_user";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function isMissingViewError(message: string | undefined): boolean {
  const msg = String(message ?? "").toLowerCase();
  return (
    msg.includes("v_trips_archived_test") ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table")
  );
}

async function loadArchivedTestFallback(
  supabase: SupabaseClient
): Promise<ArchivedTestRow[]> {
  const [ordersRes, deliveryRes, taxiRes] = await Promise.all([
    supabase
      .from("orders")
      .select(TRIP_SELECT)
      .or(ARCHIVED_TEST_FILTER)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("delivery_requests")
      .select(TRIP_SELECT)
      .or(ARCHIVED_TEST_FILTER)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("taxi_rides")
      .select(TRIP_SELECT)
      .or(ARCHIVED_TEST_FILTER)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const items: ArchivedTestRow[] = [];

  for (const row of ordersRes.data ?? []) {
    const r = row as Record<string, unknown>;
    items.push({
      entity_kind: "order",
      id: String(r.id),
      status: (r.status as string | null) ?? null,
      payment_status: (r.payment_status as string | null) ?? null,
      stripe_payment_intent_id: (r.stripe_payment_intent_id as string | null) ?? null,
      stripe_session_id: (r.stripe_session_id as string | null) ?? null,
      client_user_id: (r.client_user_id as string | null) ?? null,
      driver_id: (r.driver_id as string | null) ?? null,
      total: r.total != null ? Number(r.total) : null,
      created_at: (r.created_at as string | null) ?? null,
      archived_at: (r.archived_at as string | null) ?? null,
      is_test: (r.is_test as boolean | null) ?? null,
      hidden_from_user: (r.hidden_from_user as boolean | null) ?? null,
    });
  }

  for (const row of deliveryRes.data ?? []) {
    const r = row as Record<string, unknown>;
    items.push({
      entity_kind: "delivery_request",
      id: String(r.id),
      status: (r.status as string | null) ?? null,
      payment_status: (r.payment_status as string | null) ?? null,
      stripe_payment_intent_id: (r.stripe_payment_intent_id as string | null) ?? null,
      stripe_session_id: (r.stripe_session_id as string | null) ?? null,
      client_user_id: (r.client_user_id as string | null) ?? null,
      driver_id: (r.driver_id as string | null) ?? null,
      total: r.total != null ? Number(r.total) : null,
      created_at: (r.created_at as string | null) ?? null,
      archived_at: (r.archived_at as string | null) ?? null,
      is_test: (r.is_test as boolean | null) ?? null,
      hidden_from_user: (r.hidden_from_user as boolean | null) ?? null,
    });
  }

  for (const row of taxiRes.data ?? []) {
    const r = row as Record<string, unknown>;
    const totalCents = Number(r.total_cents ?? 0);
    items.push({
      entity_kind: "taxi_ride",
      id: String(r.id),
      status: (r.status as string | null) ?? null,
      payment_status: (r.payment_status as string | null) ?? null,
      stripe_payment_intent_id: (r.stripe_payment_intent_id as string | null) ?? null,
      stripe_session_id: (r.stripe_session_id as string | null) ?? null,
      client_user_id: (r.client_user_id as string | null) ?? null,
      driver_id: (r.driver_id as string | null) ?? null,
      total: Number.isFinite(totalCents) ? totalCents / 100 : null,
      created_at: (r.created_at as string | null) ?? null,
      archived_at: (r.archived_at as string | null) ?? null,
      is_test: (r.is_test as boolean | null) ?? null,
      hidden_from_user: (r.hidden_from_user as boolean | null) ?? null,
    });
  }

  return items
    .sort((a, b) => {
      const aTs = a.created_at ? Date.parse(a.created_at) : 0;
      const bTs = b.created_at ? Date.parse(b.created_at) : 0;
      return bTs - aTs;
    })
    .slice(0, 200);
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("test_records.read", request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("v_trips_archived_test")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      if (isMissingViewError(error.message)) {
        const items = await loadArchivedTestFallback(supabase);
        return json({ ok: true, items, count: items.length, source: "fallback" });
      }
      return json({ ok: false, error: error.message }, 500);
    }

    const items = (data ?? []) as ArchivedTestRow[];
    return json({ ok: true, items, count: items.length, source: "view" });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
