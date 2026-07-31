import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { adminError, json } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function aggregate(
  rows: { event_name: string }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const name = String(row.event_name);
    out[name] = (out[name] ?? 0) + 1;
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const since7 = daysAgoIso(7);
    const since30 = daysAgoIso(30);

    const [r7, r30] = await Promise.all([
      supabase
        .from("site_analytics_events")
        .select("event_name")
        .gte("created_at", since7)
        .limit(20_000),
      supabase
        .from("site_analytics_events")
        .select("event_name")
        .gte("created_at", since30)
        .limit(50_000),
    ]);

    if (r7.error) return json({ ok: false, error: r7.error.message }, 500);
    if (r30.error) return json({ ok: false, error: r30.error.message }, 500);

    const last7 = aggregate(r7.data ?? []);
    const last30 = aggregate(r30.data ?? []);
    const eventNames = Array.from(
      new Set([...Object.keys(last7), ...Object.keys(last30)]),
    ).sort();

    return json({
      ok: true,
      event_names: eventNames,
      last_7_days: last7,
      last_30_days: last30,
      totals: {
        last_7_days: Object.values(last7).reduce((a, b) => a + b, 0),
        last_30_days: Object.values(last30).reduce((a, b) => a + b, 0),
      },
    });
  } catch (e) {
    return adminError(e);
  }
}
