import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { requireMarketplaceClientAuth } from "@/lib/marketplaceApiAuth";
import {
  getClientDraftOrder,
  upsertMarketplaceDraftOrder,
} from "@/lib/marketplaceOrderService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftBody = {
  seller_id?: string;
  order_id?: string;
  items?: Array<{ product_id?: string; quantity?: number }>;
  notes?: string | null;
  pickup_location_id?: string | null;
  dropoff_location_id?: string | null;
  replace_items?: boolean;
};

export async function POST(req: NextRequest) {
  const auth = await requireMarketplaceClientAuth(req);
  if (auth.ok === false) return auth.response;

  let body: DraftBody;
  try {
    body = (await req.json()) as DraftBody;
  } catch {
    return mmdLocationJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const sellerId = String(body.seller_id ?? "").trim();
  if (!sellerId) {
    return mmdLocationJson({ ok: false, error: "Missing seller_id" }, 400);
  }

  const items = (body.items ?? [])
    .map((item) => ({
      product_id: String(item.product_id ?? "").trim(),
      quantity: Math.max(1, Math.round(Number(item.quantity ?? 1))),
    }))
    .filter((item) => item.product_id);

  try {
    const order = await upsertMarketplaceDraftOrder(auth.supabaseAdmin, {
      clientUserId: auth.user.id,
      sellerId,
      orderId: body.order_id?.trim() || undefined,
      items,
      notes: body.notes ?? null,
      countryCode: auth.scope.country_code ?? null,
      pickupLocationId: body.pickup_location_id ?? null,
      dropoffLocationId: body.dropoff_location_id ?? null,
      replace_items: body.replace_items === true,
    });

    return mmdLocationJson({ ok: true, order });
  } catch (error) {
    return mmdLocationJson(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      400
    );
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireMarketplaceClientAuth(req);
  if (auth.ok === false) return auth.response;

  const url = new URL(req.url);
  const sellerId = url.searchParams.get("seller_id")?.trim() || undefined;
  const orderId = url.searchParams.get("order_id")?.trim() || undefined;

  try {
    const order = await getClientDraftOrder(auth.supabaseAdmin, {
      clientUserId: auth.user.id,
      sellerId,
      orderId,
    });

    return mmdLocationJson({ ok: true, order });
  } catch (error) {
    return mmdLocationJson(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      500
    );
  }
}
