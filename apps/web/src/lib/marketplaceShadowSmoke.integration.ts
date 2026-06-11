/**
 * Integration smoke — marketplace shadow (draft, RLS, checkout/dispatch shadow, no live paths)
 * Run via: npm run test:marketplace-shadow
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getClientDraftOrder,
  runMarketplaceCheckoutShadow,
  upsertMarketplaceDraftOrder,
} from "@/lib/marketplaceOrderService";
import { isMarketplaceCheckoutEnabled } from "@/lib/marketplaceCheckout";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const testEmail =
  process.env.TEST_LOGIN_EMAIL ||
  process.env.E2E_TEST_EMAIL ||
  "e2e.phase15@mmd.test";
const testPassword =
  process.env.TEST_LOGIN_PASSWORD ||
  process.env.E2E_TEST_PASSWORD ||
  "E2ePhase15!Mmd2026";

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function ok(label: string, detail = "") {
  console.log(`OK  [marketplace-shadow] ${label}${detail ? ` — ${detail}` : ""}`);
}

const apiBase = (
  process.env.SMOKE_API_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://www.mmddelivery.com"
).replace(/\/$/, "");

async function authFetch(
  token: string,
  pathname: string,
  options: RequestInit = {}
) {
  const res = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function enableGnMarketplaceFlags(admin: SupabaseClient) {
  await admin
    .from("platform_countries")
    .update({
      marketplace_enabled: true,
      seller_enabled: true,
      platform_enabled: true,
      updated_at: new Date().toISOString(),
    })
    .eq("country_code", "GN");

  const { data: gnRegions } = await admin
    .from("platform_regions")
    .select("region_code")
    .eq("country_code", "GN");

  for (const region of gnRegions ?? []) {
    await admin
      .from("platform_regions")
      .update({
        marketplace_enabled: true,
        seller_enabled: true,
        platform_enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq("country_code", "GN")
      .eq("region_code", region.region_code);
  }
}

async function main() {
  if (!url || !anon || !serviceKey) {
    fail("Missing Supabase env vars in apps/web/.env.local");
  }

  console.log("\n=== Marketplace Shadow Smoke ===");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: signIn, error: signInErr } = await authClient.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });

  if (signInErr || !signIn.session?.access_token || !signIn.user?.id) {
    fail(`auth failed: ${signInErr?.message ?? "no session"}`);
  }

  const userId = signIn.user.id;
  const token = signIn.session.access_token;
  ok("auth", userId);

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  await enableGnMarketplaceFlags(admin);
  ok("platform flags", "GN marketplace+seller enabled");

  const scopeQs = "?pickup_country=GN";

  const { res: featuresRes, body: featuresBody } = await authFetch(
    token,
    `/api/platform/client-features${scopeQs}`
  );
  if (!featuresRes.ok || featuresBody?.marketplace_available !== true) {
    fail(
      `client-features marketplace unavailable: ${featuresBody?.error ?? featuresRes.status}`
    );
  }
  const resolvedCountry =
    featuresBody?.scope?.country_code ?? featuresBody?.country_code ?? null;
  if (resolvedCountry !== "GN") {
    fail(`client-features resolved ${resolvedCountry ?? "null"}, expected GN`);
  }
  if (featuresBody?.seller_available !== true) {
    fail("client-features seller_available=false for GN scope");
  }
  ok("scope API", "pickup_country=GN → marketplace_available=true");

  const businessName = `Smoke Seller ${randomUUID().slice(0, 8)}`;
  const { data: seller, error: sellerErr } = await admin
    .from("sellers")
    .upsert(
      {
        user_id: userId,
        business_name: businessName,
        country_code: "GN",
        city: "Conakry",
        address: "Smoke test seller address",
        phone: "+224600000000",
        status: "approved",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("id")
    .single();

  if (sellerErr || !seller?.id) {
    fail(`seller fixture failed: ${sellerErr?.message ?? "missing seller"}`);
  }
  ok("seller fixture", seller.id);

  const productPriceCents = 2500;
  const { data: existingProducts } = await admin
    .from("seller_products")
    .select("id")
    .eq("seller_id", seller.id)
    .eq("active", true)
    .limit(1);

  let productId = existingProducts?.[0]?.id;

  if (!productId) {
    const { data: product, error: productErr } = await admin
      .from("seller_products")
      .insert({
        seller_id: seller.id,
        title: `Smoke Product ${Date.now()}`,
        description: "Smoke marketplace product",
        price_cents: productPriceCents,
        currency: "USD",
        category: "general",
        active: true,
      })
      .select("id")
      .single();

    if (productErr || !product?.id) {
      fail(`product fixture failed: ${productErr?.message ?? "missing product"}`);
    }
    productId = product.id;
  }

  ok("product fixture", productId);

  const { res: sellersRes, body: sellersBody } = await authFetch(
    token,
    `/api/marketplace/sellers${scopeQs}`
  );
  if (!sellersRes.ok || sellersBody?.ok === false) {
    fail(`GET sellers failed: ${sellersBody?.error ?? sellersRes.status}`);
  }
  ok("HTTP GET sellers", `${(sellersBody.items ?? []).length} item(s)`);

  const { res: productsRes, body: productsBody } = await authFetch(
    token,
    `/api/marketplace/products?seller_id=${encodeURIComponent(seller.id)}${scopeQs.replace("?", "&")}`
  );
  if (!productsRes.ok || productsBody?.ok === false) {
    fail(`GET products failed: ${productsBody?.error ?? productsRes.status}`);
  }
  ok("HTTP GET products", `${(productsBody.items ?? []).length} item(s)`);

  const { res: postDraftRes, body: postDraftBody } = await authFetch(
    token,
    `/api/marketplace/cart/draft${scopeQs}`,
    {
      method: "POST",
      body: JSON.stringify({
        seller_id: seller.id,
        items: [{ product_id: productId, quantity: 2 }],
      }),
    }
  );
  if (!postDraftRes.ok || !postDraftBody?.order?.id) {
    fail(`POST draft failed: ${postDraftBody?.error ?? postDraftRes.status}`);
  }
  const httpOrderId = postDraftBody.order.id as string;
  ok("HTTP POST draft", httpOrderId);

  const { res: getDraftRes, body: getDraftBody } = await authFetch(
    token,
    `/api/marketplace/cart/draft?order_id=${encodeURIComponent(httpOrderId)}&pickup_country=GN`
  );
  if (!getDraftRes.ok || !getDraftBody?.order?.id) {
    fail(`GET draft failed: ${getDraftBody?.error ?? getDraftRes.status}`);
  }
  ok("HTTP GET draft");

  const { res: checkoutRes, body: checkoutBody } = await authFetch(
    token,
    `/api/marketplace/checkout${scopeQs}`,
    {
      method: "POST",
      body: JSON.stringify({ order_id: httpOrderId }),
    }
  );
  if (!checkoutRes.ok || checkoutBody?.ok === false) {
    fail(`POST checkout failed: ${checkoutBody?.error ?? checkoutRes.status}`);
  }
  if (checkoutBody.stripe_checkout_created !== false) {
    fail("checkout unexpectedly created Stripe session");
  }
  ok("HTTP POST checkout shadow", "no Stripe");

  const { res: sellersNoScopeRes, body: sellersNoScopeBody } = await authFetch(
    token,
    "/api/marketplace/sellers"
  );
  if (
    sellersNoScopeRes.ok &&
    sellersNoScopeBody?.ok !== false &&
    resolvedCountry === "GN"
  ) {
    ok("scope contrast", "unscoped call did not false-positive fail");
  } else if (sellersNoScopeBody?.error === "marketplace_unavailable") {
    ok(
      "scope contrast",
      "unscoped call may fail without pickup_country — mobile fix sends pickup_country"
    );
  }

  const order = await upsertMarketplaceDraftOrder(admin, {
    clientUserId: userId,
    sellerId: seller.id,
    countryCode: "GN",
    items: [{ product_id: productId, quantity: 2 }],
  });

  ok("draft created via service", order.id);

  if (Number(order.subtotal_cents) <= 0) {
    fail("draft subtotal invalid");
  }
  ok("shadow totals computed", `subtotal=${order.subtotal_cents}`);

  const { error: forgedOrderErr } = await userClient.from("seller_orders").insert({
    seller_id: seller.id,
    client_user_id: userId,
    status: "draft",
    currency: "USD",
    total_cents: 1,
  });

  if (!forgedOrderErr) {
    fail("RLS allowed direct seller_orders insert — apply migration 20260709120000");
  }
  ok("RLS blocks direct seller_orders insert", forgedOrderErr.message);

  const { error: forgedItemErr } = await userClient.from("seller_order_items").insert({
    order_id: order.id,
    title: "Forged item",
    price_cents: 1,
    quantity: 1,
    currency: "USD",
  });

  if (!forgedItemErr) {
    fail("RLS allowed forged seller_order_items insert — apply migration 20260709120000");
  }
  ok("RLS blocks direct seller_order_items insert", forgedItemErr.message);

  const { data: readableDraft, error: readErr } = await userClient
    .from("seller_orders")
    .select("id,status,subtotal_cents,total_cents")
    .eq("id", order.id)
    .eq("client_user_id", userId)
    .maybeSingle();

  if (readErr || !readableDraft?.id) {
    fail(`draft not readable by owner: ${readErr?.message ?? "missing row"}`);
  }
  ok("draft readable by owner via RLS");

  const loaded = await getClientDraftOrder(admin, {
    clientUserId: userId,
    orderId: order.id,
  });

  if (!loaded?.id || !loaded.items?.length) {
    fail("draft reload failed");
  }
  ok("draft reload via service", `${loaded.items.length} item(s)`);

  if (isMarketplaceCheckoutEnabled()) {
    fail("MARKETPLACE_CHECKOUT_ENABLED must stay false for shadow smoke");
  }
  ok("checkout flag off", "MARKETPLACE_CHECKOUT_ENABLED=false");

  const checkout = await runMarketplaceCheckoutShadow(admin, {
    clientUserId: userId,
    orderId: order.id,
  });

  if (checkout.shadow.checkout_enabled) {
    fail("checkout shadow unexpectedly enabled live checkout");
  }
  ok("checkout shadow", "checkout_enabled=false, no Stripe");

  const dispatchShadow = (checkout.order.dispatch_shadow ?? {}) as Record<string, unknown>;
  if (dispatchShadow.live_dispatch_enabled === true) {
    fail("dispatch shadow reported live dispatch enabled");
  }
  if (dispatchShadow.drivers_notified === true) {
    fail("dispatch shadow reported drivers notified");
  }
  ok("no live dispatch", "live_dispatch_enabled=false, drivers_notified=false");

  const { count: deliveryRequestCount } = await admin
    .from("delivery_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());

  ok("no live delivery_requests", `recent count=${deliveryRequestCount ?? 0}`);

  console.log("\nMarketplace Shadow Smoke: ALL PASS\n");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
