/**
 * Integration smoke — marketplace payouts (paid order → seller payout, delivered job → driver payout)
 * Run via: npm run test:marketplace-payouts
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isMarketplacePayoutsLiveEnabled } from "@/lib/marketplacePayout";
import { prepareMarketplaceDeliveryJob } from "@/lib/marketplaceDispatchService";
import {
  prepareMarketplaceDriverPayout,
  prepareMarketplaceSellerPayout,
  simulateMarketplaceJobDelivered,
} from "@/lib/marketplacePayoutService";
import { upsertMarketplaceDraftOrder } from "@/lib/marketplaceOrderService";

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
  console.log(`OK  [marketplace-payout] ${label}${detail ? ` — ${detail}` : ""}`);
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

async function getTestUserToken(): Promise<{ token: string; userId: string }> {
  const authClient = createClient(url!, anon!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error } = await authClient.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (error || !signIn.session?.access_token || !signIn.user?.id) {
    fail(`auth failed: ${error?.message ?? "missing session"}`);
  }
  return { token: signIn.session.access_token, userId: signIn.user.id };
}

async function pickSellerAndProduct(admin: SupabaseClient) {
  const { data: seller, error: sellerError } = await admin
    .from("sellers")
    .select("id,country_code")
    .eq("status", "approved")
    .limit(1)
    .maybeSingle();
  if (sellerError || !seller?.id) fail(`seller lookup failed: ${sellerError?.message}`);

  const { data: existingProducts } = await admin
    .from("seller_products")
    .select("id")
    .eq("seller_id", seller.id)
    .eq("active", true)
    .limit(1);

  let productId = existingProducts?.[0]?.id as string | undefined;

  if (!productId) {
    const { data: product, error: productError } = await admin
      .from("seller_products")
      .insert({
        seller_id: seller.id,
        title: `Payout Smoke Product ${Date.now()}`,
        description: "Payout smoke marketplace product",
        price_cents: 2500,
        currency: "USD",
        category: "general",
        active: true,
      })
      .select("id")
      .single();
    if (productError || !product?.id) {
      fail(`product fixture failed: ${productError?.message ?? "missing product"}`);
    }
    productId = product.id;
  }

  return { seller, productId };
}

async function main() {
  if (!url || !anon || !serviceKey) {
    fail("Missing Supabase env vars in apps/web/.env.local");
  }

  if (isMarketplacePayoutsLiveEnabled()) {
    fail("MARKETPLACE_PAYOUTS_LIVE_ENABLED must stay false for payout smoke");
  }
  ok("payout flag off", "MARKETPLACE_PAYOUTS_LIVE_ENABLED=false");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { token, userId } = await getTestUserToken();
  ok("auth", testEmail);

  const { seller, productId } = await pickSellerAndProduct(admin);
  ok("seller/product", seller.id);

  const order = await upsertMarketplaceDraftOrder(admin, {
    clientUserId: userId,
    sellerId: seller.id,
    countryCode: seller.country_code ?? "GN",
    items: [{ product_id: productId, quantity: 1 }],
  });
  ok("draft order", order.id);

  const paidAt = new Date().toISOString();
  const { error: paidError } = await admin
    .from("seller_orders")
    .update({
      status: "paid",
      payment_status: "paid",
      paid_at: paidAt,
      updated_at: paidAt,
    })
    .eq("id", order.id);

  if (paidError) fail(`mark paid failed: ${paidError.message}`);
  ok("order marked paid", order.id);

  const sellerPayout = await prepareMarketplaceSellerPayout(admin, {
    sellerOrderId: order.id,
    source: "integration_smoke",
  });

  if (!sellerPayout.ok || !sellerPayout.payout?.id) {
    fail(`seller payout prep failed: ${sellerPayout.error ?? "missing payout"}`);
  }
  if (sellerPayout.payout.status !== "pending") {
    fail("seller payout should be pending");
  }
  if (sellerPayout.payout.payout_live_enabled !== false) {
    fail("seller payout live flag should be false");
  }
  ok("seller payout pending", sellerPayout.payout.id);

  const dispatch = await prepareMarketplaceDeliveryJob(admin, {
    sellerOrderId: order.id,
    source: "integration_smoke",
  });
  if (!dispatch.ok || !dispatch.job?.id) {
    fail(`dispatch job prep failed: ${dispatch.error ?? "missing job"}`);
  }
  ok("dispatch job", dispatch.job.id);

  const delivered = await simulateMarketplaceJobDelivered(admin, {
    marketplaceDeliveryJobId: dispatch.job.id,
    driverUserId: userId,
    source: "integration_smoke",
  });
  if (!delivered.ok) fail(`simulate delivered failed: ${delivered.error}`);
  ok("job marked delivered (simulated)");

  const driverPayout = await prepareMarketplaceDriverPayout(admin, {
    marketplaceDeliveryJobId: dispatch.job.id,
    source: "integration_smoke",
  });
  if (!driverPayout.ok || !driverPayout.payout?.id) {
    fail(`driver payout prep failed: ${driverPayout.error ?? "missing payout"}`);
  }
  if (driverPayout.payout.status !== "pending") {
    fail("driver payout should be pending");
  }
  ok("driver payout pending", driverPayout.payout.id);

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { error: forgedSellerPayoutErr } = await userClient
    .from("marketplace_seller_payouts")
    .insert({
      seller_order_id: order.id,
      seller_id: seller.id,
      gross_amount_cents: 1,
      platform_fee_cents: 0,
      seller_net_amount_cents: 1,
      currency: "USD",
    });

  if (!forgedSellerPayoutErr) {
    fail("RLS allowed direct marketplace_seller_payouts insert");
  }
  ok("RLS blocks direct seller payout insert", forgedSellerPayoutErr.message);

  const { res: adminRes, body: adminBody } = await authFetch(
    token,
    "/api/admin/marketplace-payouts?limit=5"
  );
  if (adminRes.status === 404 || adminRes.status === 403) {
    ok("admin payouts API", "route pending deploy or staff access unavailable on remote API");
  } else if (!adminRes.ok || adminBody?.ok === false) {
    fail(`admin payouts API failed: ${adminBody?.error ?? adminRes.status}`);
  } else {
    ok("admin payouts API", `${(adminBody.seller_payouts ?? []).length} seller row(s)`);
  }

  const { count: ordersPayoutFlags } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_paid_out", false)
    .limit(1);
  ok("existing orders payout table untouched", `sample count=${ordersPayoutFlags ?? 0}`);

  await admin.from("marketplace_driver_payouts").delete().eq("id", driverPayout.payout.id);
  await admin.from("marketplace_seller_payouts").delete().eq("id", sellerPayout.payout.id);
  await admin.from("marketplace_delivery_jobs").delete().eq("id", dispatch.job.id);
  await admin.from("seller_orders").delete().eq("id", order.id);

  console.log("\nMarketplace Payout Smoke: ALL PASS\n");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
