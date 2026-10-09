import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { collectGuineaXlCash } from "@/lib/markets/guineaXlHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return await collectGuineaXlCash(
      auth.supabaseAdmin,
      auth.user.id,
      String(body.bookingId ?? body.booking_id ?? ""),
    );
  } catch {
    return taxiJson({ ok: false, error: "Server error" }, 500);
  }
}
