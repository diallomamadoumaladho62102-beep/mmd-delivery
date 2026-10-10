import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import {
  listDriverGuineaXlDepartures,
  listOpenGuineaXlDepartures,
  openGuineaXlDeparture,
  completeGuineaXlDeparture,
  syncGuineaXlProgress,
} from "@/lib/markets/guineaXlHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;
    if (req.nextUrl.searchParams.get("scope") === "driver") {
      return await listDriverGuineaXlDepartures(auth.supabaseAdmin, auth.user.id);
    }
    return await listOpenGuineaXlDepartures(auth.supabaseAdmin);
  } catch {
    return taxiJson({ ok: false, error: "Server error" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === "progress") {
      return await syncGuineaXlProgress(auth.supabaseAdmin, auth.user.id, body);
    }
    if (body.action === "complete") {
      return await completeGuineaXlDeparture(
        auth.supabaseAdmin,
        auth.user.id,
        String(body.departureId ?? ""),
      );
    }
    return await openGuineaXlDeparture(auth.supabaseAdmin, auth.user.id, body);
  } catch {
    return taxiJson({ ok: false, error: "Server error" }, 500);
  }
}
