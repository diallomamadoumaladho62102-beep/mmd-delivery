/**
 * After Stripe Connect becomes ready (or daily-money cron), retry SCTs that
 * were blocked while Connect was missing / transfer failed:
 * - food restaurant → platform SCT
 * - food/package driver → platform SCT (orders.driver_transfer_id)
 * - marketplace seller + driver execute path
 *
 * Never invents Connect accounts. transfers/run still refuse without acct_.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ConnectPayoutRetryResult = {
  restaurant_attempted: number;
  restaurant_ok: number;
  driver_attempted: number;
  driver_ok: number;
  seller_attempted: boolean;
  seller_ok: boolean | null;
  errors: string[];
};

function internalApiBase(): string {
  const explicit =
    process.env.INTERNAL_API_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "";
  const candidate = explicit.trim().replace(/\/+$/, "");
  if (candidate) return candidate;
  const vercel = String(process.env.VERCEL_URL ?? "").trim().replace(/\/+$/, "");
  if (vercel) return vercel.startsWith("http") ? vercel : `https://${vercel}`;
  return "https://www.mmddelivery.com";
}

async function runOrderTransfer(
  orderId: string,
  target: "restaurant" | "driver",
): Promise<{ ok: boolean; error?: string }> {
  const cronSecret = process.env.CRON_SECRET?.trim() || "";
  if (!cronSecret) {
    return { ok: false, error: "Missing CRON_SECRET" };
  }

  const response = await fetch(`${internalApiBase()}/api/stripe/transfers/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cronSecret}`,
      "x-cron-secret": cronSecret,
    },
    body: JSON.stringify({ order_id: orderId, target }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as {
    ok?: unknown;
    error?: unknown;
    already_succeeded?: unknown;
  } | null;

  if (response.ok && (payload?.ok === true || payload?.already_succeeded === true)) {
    return { ok: true };
  }
  return {
    ok: false,
    error:
      typeof payload?.error === "string" && payload.error.trim()
        ? payload.error
        : `HTTP ${response.status}`,
  };
}

export async function retryAwaitingConnectTransfers(params: {
  supabaseAdmin: SupabaseClient;
  restaurantUserIds?: string[];
  /** When set, also retry food/package driver SCTs for these driver user ids. */
  driverUserIds?: string[];
  sellerReady?: boolean;
  /** Retry marketplace driver+seller execute (auto-promotes live pending drivers). */
  marketplaceReady?: boolean;
  limit?: number;
}): Promise<ConnectPayoutRetryResult> {
  const limit = Math.min(Math.max(params.limit ?? 8, 1), 20);
  const errors: string[] = [];
  let restaurantAttempted = 0;
  let restaurantOk = 0;
  let driverAttempted = 0;
  let driverOk = 0;

  const restaurantIds = (params.restaurantUserIds ?? [])
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);

  if (restaurantIds.length > 0) {
    const { data: orders, error } = await params.supabaseAdmin
      .from("orders")
      .select("id, restaurant_user_id, restaurant_id, restaurant_transfer_id, status, payment_status")
      .eq("payment_status", "paid")
      .in("status", ["delivered", "completed"])
      .is("restaurant_transfer_id", null)
      .or(
        `restaurant_user_id.in.(${restaurantIds.join(",")}),restaurant_id.in.(${restaurantIds.join(",")})`,
      )
      .order("delivered_at", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) {
      errors.push(`restaurant_orders:${error.message}`);
    } else {
      for (const row of orders ?? []) {
        const orderId = String((row as { id?: unknown }).id ?? "").trim();
        if (!orderId) continue;
        restaurantAttempted += 1;
        try {
          const out = await runOrderTransfer(orderId, "restaurant");
          if (out.ok) restaurantOk += 1;
          else errors.push(`rest:${orderId}:${out.error ?? "transfer_failed"}`);
        } catch (e) {
          errors.push(
            `rest:${orderId}:${e instanceof Error ? e.message : "transfer_exception"}`,
          );
        }
      }
    }
  }

  const driverIds = (params.driverUserIds ?? [])
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);

  if (driverIds.length > 0) {
    const { data: orders, error } = await params.supabaseAdmin
      .from("orders")
      .select("id, driver_id, driver_transfer_id, status, payment_status")
      .eq("payment_status", "paid")
      .in("status", ["delivered", "completed"])
      .is("driver_transfer_id", null)
      .in("driver_id", driverIds)
      .order("delivered_confirmed_at", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) {
      errors.push(`driver_orders:${error.message}`);
    } else {
      for (const row of orders ?? []) {
        const orderId = String((row as { id?: unknown }).id ?? "").trim();
        if (!orderId) continue;
        driverAttempted += 1;
        try {
          const out = await runOrderTransfer(orderId, "driver");
          if (out.ok) driverOk += 1;
          else errors.push(`drv:${orderId}:${out.error ?? "transfer_failed"}`);
        } catch (e) {
          errors.push(
            `drv:${orderId}:${e instanceof Error ? e.message : "transfer_exception"}`,
          );
        }
      }
    }
  }

  let sellerAttempted = false;
  let sellerOk: boolean | null = null;
  if (params.sellerReady === true || params.marketplaceReady === true) {
    sellerAttempted = true;
    try {
      const { executeMarketplacePayouts } = await import(
        "@/lib/marketplacePayoutService"
      );
      const out = await executeMarketplacePayouts(params.supabaseAdmin, {
        limit,
      });
      sellerOk = out.ok !== false;
      if (out.ok === false && out.error) errors.push(`seller:${out.error}`);
    } catch (e) {
      sellerOk = false;
      errors.push(
        `seller:${e instanceof Error ? e.message : "seller_retry_exception"}`,
      );
    }
  }

  return {
    restaurant_attempted: restaurantAttempted,
    restaurant_ok: restaurantOk,
    driver_attempted: driverAttempted,
    driver_ok: driverOk,
    seller_attempted: sellerAttempted,
    seller_ok: sellerOk,
    errors,
  };
}
