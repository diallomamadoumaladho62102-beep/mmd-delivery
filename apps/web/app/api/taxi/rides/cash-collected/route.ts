import { NextRequest } from "next/server";
import { getTaxiRideId, requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { collectGuineaCash } from "@/lib/markets/guineaTaxiHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    let rideId = "";
    try {
      rideId = getTaxiRideId(body);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Invalid request";
      return taxiJson({ ok: false, error: message }, 400);
    }

    return await collectGuineaCash({
      supabaseAdmin: auth.supabaseAdmin,
      actorUserId: auth.user.id,
      rideId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
