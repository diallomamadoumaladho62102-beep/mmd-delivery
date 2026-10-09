import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { bookGuineaXl, listClientGuineaXlBookings } from "@/lib/markets/guineaXlHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;
    return await listClientGuineaXlBookings(auth.supabaseAdmin, auth.user.id);
  } catch {
    return taxiJson({ ok: false, error: "Server error" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return await bookGuineaXl(auth.supabaseAdmin, auth.user.id, body);
  } catch {
    return taxiJson({ ok: false, error: "Server error" }, 500);
  }
}
