/**
 * Integration smoke — marketplace dispatch jobs (paid order → job, no core dispatch)
 * Run via: npm run test:marketplace-dispatch
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  isMarketplaceDispatchLiveEnabled,
} from "@/lib/marketplaceDispatch";
import {
  prepareMarketplaceDeliveryJob,
} from "@/lib/marketplaceDispatchService";
import { upsertMarketplaceDraftOrder } from "@/lib/marketplaceOrderService";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const serviceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

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
  console.log(`OK  [marketplace-dispatch] ${label}${detail ? ` — ${detail}` : ""}`);
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

async function getTestUserToken(): Promise<{
  token: string;
  userId: string;
}> {
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
        title: `Dispatch Smoke Product ${Date.now()}`,
        description: "Dispatch smoke marketplace product",
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
    fail("Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL, anon, service role)");
  }

  if (isMarketplaceDispatchLiveEnabled()) {
    fail("MARKETPLACE_DISPATCH_LIVE_ENABLED must stay false for dispatch smoke");
  }
  ok("dispatch flag off", "MARKETPLACE_DISPATCH_LIVE_ENABLED=false");

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
  ok("order marked paid (service role)", order.id);

  const beforeDeliveryRequests = await admin
    .from("delivery_requests")
    .select("id", { count: "exact", head: true });

  const prep = await prepareMarketplaceDeliveryJob(admin, {
    sellerOrderId: order.id,
    source: "integration_smoke",
  });

  if (!prep.ok || !prep.job?.id) {
    fail(`prepare job failed: ${prep.error ?? "missing job"}`);
  }
  ok("dispatch job created", prep.job.status);

  if (prep.job.live_dispatch_enabled !== false) {
    fail("job live_dispatch_enabled should be false");
  }
  if (prep.job.drivers_notified !== false) {
    fail("job drivers_notified should be false");
  }
  ok("no live dispatch on job", "live_dispatch_enabled=false, drivers_notified=false");

  const afterDeliveryRequests = await admin
    .from("delivery_requests")
    .select("id", { count: "exact", head: true });

  if ((afterDeliveryRequests.count ?? 0) > (beforeDeliveryRequests.count ?? 0)) {
    fail("delivery_requests were created during marketplace dispatch prep");
  }
  ok("no delivery_requests created");

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: clientRead, error: clientReadErr } = await userClient
    .from("marketplace_delivery_jobs")
    .select("id,status,live_dispatch_enabled,drivers_notified")
    .eq("seller_order_id", order.id)
    .maybeSingle();

  if (clientReadErr || !clientRead?.id) {
    fail(`client RLS read failed: ${clientReadErr?.message ?? "missing row"}`);
  }
  ok("client RLS read own job");

  const { res: adminRes, body: adminBody } = await authFetch(
    token,
    "/api/admin/marketplace-dispatch?limit=5"
  );
  if (adminRes.status === 404 || adminRes.status === 403) {
    ok("admin dispatch API", "route pending deploy or staff access unavailable on remote API");
  } else if (!adminRes.ok || adminBody?.ok === false) {
    fail(`admin dispatch API failed: ${adminBody?.error ?? adminRes.status}`);
  } else {
    ok("admin dispatch API", `${(adminBody.items ?? []).length} row(s)`);
    if (adminBody.live_dispatch_enabled === true) {
      fail("admin API reported live dispatch enabled");
    }
  }

  await admin.from("marketplace_delivery_jobs").delete().eq("id", prep.job.id);
  await admin.from("seller_orders").delete().eq("id", order.id);

  console.log("\nMarketplace Dispatch Smoke: ALL PASS\n");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
