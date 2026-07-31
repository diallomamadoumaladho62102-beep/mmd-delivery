import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { requireBusinessManager } from "@/lib/taxiBusinessMembers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const businessAccountId =
      req.nextUrl.searchParams.get("business_account_id")?.trim() || null;

    const gated = await requireBusinessManager(
      auth.supabaseAdmin,
      auth.user,
      businessAccountId
    );
    if (gated.ok === false) return gated.response;

    const { data: rides, error } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select(
        "id, status, business_approval_status, business_account_id, business_member_id, client_user_id, pickup_address, dropoff_address, total_cents, currency, created_at, vehicle_class"
      )
      .eq("business_account_id", gated.membership.businessAccountId)
      .eq("business_approval_status", "pending")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const clientIds = Array.from(
      new Set(
        (rides ?? [])
          .map((r) => String(r.client_user_id ?? ""))
          .filter(Boolean)
      )
    );

    const nameById = new Map<string, string | null>();
    if (clientIds.length > 0) {
      const { data: profiles } = await auth.supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", clientIds);
      for (const p of profiles ?? []) {
        nameById.set(String(p.id), (p.full_name as string | null) ?? null);
      }
    }

    return taxiJson({
      ok: true,
      business_account_id: gated.membership.businessAccountId,
      rides: (rides ?? []).map((r) => ({
        ...r,
        client_name: nameById.get(String(r.client_user_id)) ?? null,
      })),
    });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
