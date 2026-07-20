import { NextRequest } from "next/server";
import {
  getProfileRole,
  isStaffRole,
  requireTaxiApiUser,
  taxiJson,
} from "@/lib/taxiApi";
import { enrichTaxiRidesIdentification } from "@/lib/taxiRideClientIdentification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const role = await getProfileRole(auth.supabaseAdmin, auth.user.id);
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 50), 100);

    let query = auth.supabaseAdmin
      .from("taxi_rides")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!isStaffRole(role)) {
      query = query.eq("client_user_id", auth.user.id);
    }

    const { data, error } = await query;

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const rides = await enrichTaxiRidesIdentification(
      auth.supabaseAdmin,
      (data ?? []) as Record<string, unknown>[],
    );

    return taxiJson({ ok: true, rides });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
