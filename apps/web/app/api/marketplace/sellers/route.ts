import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { requireMarketplaceClientAuth } from "@/lib/marketplaceApiAuth";
import { loadApprovedSellers } from "@/lib/marketplaceOrderService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireMarketplaceClientAuth(req);
  if (auth.ok === false) return auth.response;

  try {
    const items = await loadApprovedSellers(auth.supabaseAdmin);
    return mmdLocationJson({ ok: true, items });
  } catch (error) {
    return mmdLocationJson(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      500
    );
  }
}
