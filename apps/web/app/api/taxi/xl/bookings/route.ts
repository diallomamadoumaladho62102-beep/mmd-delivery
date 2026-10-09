import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { bookGuineaXl } from "@/lib/markets/guineaXlHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return await bookGuineaXl(auth.supabaseAdmin, auth.user.id, body);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
