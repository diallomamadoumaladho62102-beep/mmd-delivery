import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { allowMarketplacePublicCatalog } from "@/lib/marketplaceApiAuth";
import { loadApprovedSellers } from "@/lib/marketplaceOrderService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public catalog fields only — no private seller ops / PII beyond storefront. */
function toPublicSeller(row: Awaited<ReturnType<typeof loadApprovedSellers>>[number]) {
  return {
    id: row.id,
    business_name: row.business_name,
    country_code: row.country_code,
    city: row.city,
    // Business storefront locality only (not a personal home address).
    address: row.address,
    region_code: row.region_code,
    status: row.status,
    is_accepting_orders: row.is_accepting_orders,
    logo_url: row.logo_url ?? null,
    cover_image_url: row.cover_image_url ?? null,
    active_product_count: row.active_product_count ?? 0,
    created_at: row.created_at,
  };
}

export async function GET(_req: NextRequest) {
  // Guest browse allowed (Apple Guideline 5.1.1(v)) — catalog discovery only.
  const access = allowMarketplacePublicCatalog();
  if (access.ok === false) return access.response;

  try {
    const items = await loadApprovedSellers(access.supabaseAdmin);
    return mmdLocationJson({
      ok: true,
      items: items.map(toPublicSeller),
      guest: true,
    });
  } catch (error) {
    return mmdLocationJson(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      500,
    );
  }
}
