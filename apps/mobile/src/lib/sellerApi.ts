import { supabase } from "./supabase";
import type { SellerOrderRow, SellerProductRow, SellerRow } from "./sellerTypes";
import { fetchClientPlatformFeatures } from "./platformFeaturesApi";

export async function requireSellerPlatformEnabled(): Promise<{
  enabled: boolean;
  message: string | null;
}> {
  const features = await fetchClientPlatformFeatures();
  const enabled = Boolean(features.ok !== false && features.seller_available);
  return {
    enabled,
    message: enabled
      ? null
      : features.service_messages?.marketplace ??
        features.message ??
        "Marketplace disabled in this county.\n\nYour products remain saved, but customers cannot place new orders until Marketplace is activated.",
  };
}

const SELLER_SELECT =
  "id,user_id,business_name,country_code,city,address,phone,region_code,mmd_zone_id,status,is_accepting_orders,logo_url,cover_image_url,document_urls,review_notes,created_at,updated_at";

const PRODUCT_SELECT =
  "id,seller_id,title,description,price_cents,currency,category,image_paths,active,stock_qty,options_json,variants_json,promo_price_cents,created_at,updated_at";

const ORDER_SELECT =
  "id,seller_id,client_user_id,status,currency,total_cents,country_code,region_code,notes,refund_status,delivery_status_shadow,delivery_quote_shadow,estimated_distance_miles,estimated_minutes,driver_earning_shadow_cents,dispatch_shadow,created_at";

export async function loadOwnSeller(): Promise<SellerRow | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("sellers")
    .select(SELLER_SELECT)
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
  logo_url?: string | null;
  cover_image_url?: string | null;
  document_urls?: string[];
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
    logo_url: input.logo_url?.trim() || null,
    cover_image_url: input.cover_image_url?.trim() || null,
    document_urls: input.document_urls ?? [],
    status: "pending" as const,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("sellers")
    .upsert(payload, { onConflict: "user_id" })
    .select(SELLER_SELECT)
    .single();

  if (error) throw error;
  return data as SellerRow;
}

export async function updateSellerProfile(input: {
  sellerId: string;
  business_name: string;
  city: string;
  address: string;
  phone: string;
  logo_url?: string | null;
  cover_image_url?: string | null;
  document_urls?: string[];
}): Promise<SellerRow> {
  const { data, error } = await supabase
    .from("sellers")
    .update({
      business_name: input.business_name.trim(),
      city: input.city.trim(),
      address: input.address.trim(),
      phone: input.phone.trim(),
      logo_url: input.logo_url?.trim() || null,
      cover_image_url: input.cover_image_url?.trim() || null,
      document_urls: input.document_urls ?? [],
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sellerId)
    .select(SELLER_SELECT)
    .single();

  if (error) throw error;
  return data as SellerRow;
}

export async function loadSellerProducts(sellerId: string): Promise<SellerProductRow[]> {
  const { data, error } = await supabase
    .from("seller_products")
    .select(PRODUCT_SELECT)
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
    stock_qty?: number | null;
    options_json?: unknown;
    variants_json?: unknown;
    promo_price_cents?: number | null;
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
    stock_qty:
      product.stock_qty == null || product.stock_qty === undefined
        ? null
        : Math.max(0, Math.round(Number(product.stock_qty))),
    options_json: product.options_json ?? [],
    variants_json: product.variants_json ?? [],
    promo_price_cents:
      product.promo_price_cents == null || product.promo_price_cents === undefined
        ? null
        : Math.max(0, Math.round(Number(product.promo_price_cents))),
    updated_at: new Date().toISOString(),
  };

  if (product.id) {
    const { data, error } = await supabase
      .from("seller_products")
      .update(row)
      .eq("id", product.id)
      .eq("seller_id", sellerId)
      .select(PRODUCT_SELECT)
      .single();
    if (error) throw error;
    return data as SellerProductRow;
  }

  const { data, error } = await supabase
    .from("seller_products")
    .insert(row)
    .select(PRODUCT_SELECT)
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
    .select(ORDER_SELECT)
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

export async function setSellerAcceptingOrders(
  sellerId: string,
  isAccepting: boolean
): Promise<SellerRow> {
  const { data, error } = await supabase
    .from("sellers")
    .update({
      is_accepting_orders: isAccepting,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sellerId)
    .select(SELLER_SELECT)
    .single();

  if (error) throw error;
  return data as SellerRow;
}
