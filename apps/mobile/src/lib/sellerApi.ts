import { supabase } from "./supabase";
import type { SellerOrderRow, SellerProductRow, SellerRow } from "./sellerTypes";
import { fetchClientPlatformFeatures } from "./platformFeaturesApi";

export async function requireSellerPlatformEnabled(): Promise<boolean> {
  const features = await fetchClientPlatformFeatures();
  return Boolean(features.ok !== false && features.seller_available);
}

export async function loadOwnSeller(): Promise<SellerRow | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("sellers")
    .select(
      "id,user_id,business_name,country_code,city,address,phone,region_code,mmd_zone_id,status,review_notes,created_at,updated_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as SellerRow | null) ?? null;
}

export async function upsertSellerOnboarding(input: {
  business_name: string;
  country_code: string;
  city: string;
  address: string;
  phone: string;
}): Promise<SellerRow> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const payload = {
    user_id: userId,
    business_name: input.business_name.trim(),
    country_code: input.country_code.trim().toUpperCase(),
    city: input.city.trim(),
    address: input.address.trim(),
    phone: input.phone.trim(),
    status: "pending" as const,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("sellers")
    .upsert(payload, { onConflict: "user_id" })
    .select(
      "id,user_id,business_name,country_code,city,address,phone,region_code,mmd_zone_id,status,review_notes,created_at,updated_at"
    )
    .single();

  if (error) throw error;
  return data as SellerRow;
}

export async function loadSellerProducts(sellerId: string): Promise<SellerProductRow[]> {
  const { data, error } = await supabase
    .from("seller_products")
    .select(
      "id,seller_id,title,description,price_cents,currency,category,image_paths,active,created_at,updated_at"
    )
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as SellerProductRow[]) ?? [];
}

export async function saveSellerProduct(
  sellerId: string,
  product: {
    id?: string;
    title: string;
    description: string;
    price_cents: number;
    currency: string;
    category: string;
    image_paths?: string[];
    active: boolean;
  }
): Promise<SellerProductRow> {
  const row = {
    seller_id: sellerId,
    title: product.title.trim(),
    description: product.description.trim(),
    price_cents: Math.max(0, Math.round(product.price_cents)),
    currency: product.currency.trim().toUpperCase() || "USD",
    category: product.category.trim() || "general",
    image_paths: product.image_paths ?? [],
    active: product.active,
    updated_at: new Date().toISOString(),
  };

  if (product.id) {
    const { data, error } = await supabase
      .from("seller_products")
      .update(row)
      .eq("id", product.id)
      .eq("seller_id", sellerId)
      .select(
        "id,seller_id,title,description,price_cents,currency,category,image_paths,active,created_at,updated_at"
      )
      .single();
    if (error) throw error;
    return data as SellerProductRow;
  }

  const { data, error } = await supabase
    .from("seller_products")
    .insert(row)
    .select(
      "id,seller_id,title,description,price_cents,currency,category,image_paths,active,created_at,updated_at"
    )
    .single();

  if (error) throw error;
  return data as SellerProductRow;
}

export async function toggleSellerProductActive(
  sellerId: string,
  productId: string,
  active: boolean
): Promise<void> {
  const { error } = await supabase
    .from("seller_products")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("seller_id", sellerId);

  if (error) throw error;
}

export async function loadSellerOrders(sellerId: string): Promise<SellerOrderRow[]> {
  const { data, error } = await supabase
    .from("seller_orders")
    .select(
      "id,seller_id,client_user_id,status,currency,total_cents,country_code,region_code,notes,created_at"
    )
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as SellerOrderRow[]) ?? [];
}

export async function loadSellerDashboardCounts(sellerId: string): Promise<{
  productCount: number;
  orderCount: number;
}> {
  const [productsRes, ordersRes] = await Promise.all([
    supabase
      .from("seller_products")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", sellerId),
    supabase
      .from("seller_orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", sellerId),
  ]);

  if (productsRes.error) throw productsRes.error;
  if (ordersRes.error) throw ordersRes.error;

  return {
    productCount: productsRes.count ?? 0,
    orderCount: ordersRes.count ?? 0,
  };
}
