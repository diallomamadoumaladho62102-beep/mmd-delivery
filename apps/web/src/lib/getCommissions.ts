import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Commission = {
  currency: string | null;
  client_amount: number | null;
  driver_amount: number | null;
  restaurant_amount: number | null;
  platform_amount: number | null;
  client_pct: number | null;
  driver_pct: number | null;
  restaurant_pct: number | null;
  platform_pct: number | null;
};

type OrderCommissionRow = Commission;

type GenericErrorLike = {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
};

function asErrorLike(value: unknown): GenericErrorLike | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as GenericErrorLike;
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error && value.message) {
    return value.message;
  }

  const errorLike = asErrorLike(value);
  if (
    errorLike &&
    typeof errorLike.message === "string" &&
    errorLike.message.trim()
  ) {
    return errorLike.message;
  }

  return "Unknown error";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

function normalizeOrderId(orderId: string): string {
  const normalized = orderId.trim();

  if (!normalized) {
    throw new Error("orderId is required.");
  }

  return normalized;
}

export async function getCommissions(
  orderId: string
): Promise<Commission | null> {
  const normalizedOrderId = normalizeOrderId(orderId);
  const supabase = getSupabaseAdminClient();

  const { error: refreshError } = await supabase.rpc(
    "refresh_order_commissions",
    {
      p_order_id: normalizedOrderId,
    }
  );

  if (refreshError) {
    console.warn("[getCommissions] refresh_order_commissions failed", {
      orderId: normalizedOrderId,
      message: getErrorMessage(refreshError),
      code: asErrorLike(refreshError)?.code ?? null,
      details: asErrorLike(refreshError)?.details ?? null,
      hint: asErrorLike(refreshError)?.hint ?? null,
    });
  }

  const { data, error } = await supabase
    .from("order_commissions")
    .select(
      "currency, client_amount, driver_amount, restaurant_amount, platform_amount, client_pct, driver_pct, restaurant_pct, platform_pct"
    )
    .eq("order_id", normalizedOrderId)
    .maybeSingle<OrderCommissionRow>();

  if (error) {
    console.error("[getCommissions] order_commissions read failed", {
      orderId: normalizedOrderId,
      message: getErrorMessage(error),
      code: asErrorLike(error)?.code ?? null,
      details: asErrorLike(error)?.details ?? null,
      hint: asErrorLike(error)?.hint ?? null,
    });

    return null;
  }

  return data ?? null;
}