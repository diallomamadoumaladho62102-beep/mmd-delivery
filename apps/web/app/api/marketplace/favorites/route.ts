import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { requireMarketplaceClientAuth } from "@/lib/marketplaceApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FavoriteBody = {
  product_id?: string;
  seller_id?: string;
};

export async function GET(req: NextRequest) {
  const auth = await requireMarketplaceClientAuth(req);
  if (auth.ok === false) return auth.response;

  const url = new URL(req.url);
  const sellerId = url.searchParams.get("seller_id")?.trim() || undefined;

  try {
    let query = auth.supabaseAdmin
      .from("marketplace_favorites")
      .select(
        "id,client_user_id,product_id,seller_id,created_at,seller_products(id,title,price_cents,currency,active,image_paths)"
      )
      .eq("client_user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (sellerId) query = query.eq("seller_id", sellerId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return mmdLocationJson({ ok: true, items: data ?? [] });
  } catch (error) {
    return mmdLocationJson(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      500
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireMarketplaceClientAuth(req);
  if (auth.ok === false) return auth.response;

  let body: FavoriteBody;
  try {
    body = (await req.json()) as FavoriteBody;
  } catch {
    return mmdLocationJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const productId = String(body.product_id ?? "").trim();
  let sellerId = String(body.seller_id ?? "").trim();

  if (!productId) {
    return mmdLocationJson({ ok: false, error: "Missing product_id" }, 400);
  }

  try {
    if (!sellerId) {
      const { data: product, error: productError } = await auth.supabaseAdmin
        .from("seller_products")
        .select("id,seller_id,active")
        .eq("id", productId)
        .maybeSingle();
      if (productError) throw new Error(productError.message);
      if (!product || product.active !== true) {
        return mmdLocationJson({ ok: false, error: "product_not_found" }, 404);
      }
      sellerId = String(product.seller_id);
    }

    const { data, error } = await auth.supabaseAdmin
      .from("marketplace_favorites")
      .upsert(
        {
          client_user_id: auth.user.id,
          product_id: productId,
          seller_id: sellerId,
        },
        { onConflict: "client_user_id,product_id" }
      )
      .select("id,client_user_id,product_id,seller_id,created_at")
      .single();

    if (error) throw new Error(error.message);
    return mmdLocationJson({ ok: true, favorite: data });
  } catch (error) {
    return mmdLocationJson(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      400
    );
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireMarketplaceClientAuth(req);
  if (auth.ok === false) return auth.response;

  const url = new URL(req.url);
  let productId = url.searchParams.get("product_id")?.trim() || "";

  if (!productId) {
    try {
      const body = (await req.json()) as FavoriteBody;
      productId = String(body.product_id ?? "").trim();
    } catch {
      // ignore — query param preferred
    }
  }

  if (!productId) {
    return mmdLocationJson({ ok: false, error: "Missing product_id" }, 400);
  }

  try {
    const { error } = await auth.supabaseAdmin
      .from("marketplace_favorites")
      .delete()
      .eq("client_user_id", auth.user.id)
      .eq("product_id", productId);

    if (error) throw new Error(error.message);
    return mmdLocationJson({ ok: true });
  } catch (error) {
    return mmdLocationJson(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      400
    );
  }
}
