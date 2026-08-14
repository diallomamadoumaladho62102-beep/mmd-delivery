import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { allowMarketplacePublicCatalog } from "@/lib/marketplaceApiAuth";
import { loadApprovedSellerProducts } from "@/lib/marketplaceOrderService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public product fields only. */
function toPublicProduct(
  row: Awaited<ReturnType<typeof loadApprovedSellerProducts>>[number],
) {
  return {
    id: row.id,
    seller_id: row.seller_id,
    title: row.title,
    description: row.description,
    price_cents: row.price_cents,
    currency: row.currency,
    category: row.category,
    image_paths: row.image_paths,
    active: row.active,
    stock_qty: row.stock_qty ?? null,
    options_json: row.options_json,
    variants_json: row.variants_json,
    promo_price_cents: row.promo_price_cents ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET(req: NextRequest) {
  // Guest browse allowed (Apple Guideline 5.1.1(v)) — catalog discovery only.
  const access = allowMarketplacePublicCatalog();
  if (access.ok === false) return access.response;

  const sellerId =
    new URL(req.url).searchParams.get("seller_id")?.trim() || undefined;

  try {
    const items = await loadApprovedSellerProducts(access.supabaseAdmin, sellerId);
    return mmdLocationJson({
      ok: true,
      items: items.map(toPublicProduct),
      guest: true,
    });
  } catch (error) {
    return mmdLocationJson(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      500,
    );
  }
}
