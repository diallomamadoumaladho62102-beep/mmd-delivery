import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { canAccessAdmin, normalizeUserRole } from "@/lib/roles";

const PRICING_REDIRECT_PATH = "/admin/pricing";
const MAX_MONEY_VALUE = 1_000_000;
const ALLOWED_PROMO_TYPES = new Set(["percent", "fixed", "free_delivery"]);

type AuthFailure = {
  ok: false;
  response: NextResponse;
};

type AuthSuccess = {
  ok: true;
  userId: string;
  adminClient: SupabaseClient;
};

type PricingPayload = {
  active: boolean;
  currency: string;
  client_pct: number;
  driver_pct: number;
  restaurant_pct: number;
  platform_pct: number;
  delivery_platform_pct: number;
  delivery_driver_pct: number;
  delivery_fee_base: number;
  delivery_fee_per_mile: number;
  delivery_fee_per_minute: number;
  minimum_order_amount: number;
  promo_enabled: boolean;
  promo_type: "percent" | "fixed" | "free_delivery" | null;
  promo_value: number | null;
  promo_code: string | null;
  updated_at: string;
};

function getEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }

  return value;
}

function getAdminClient(): SupabaseClient {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

function getUserClientFromRequest(request: Request): SupabaseClient | null {
  const token = getBearerToken(request);
  if (!token) return null;

  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

function toText(value: FormDataEntryValue | null, fallback = ""): string {
  return String(value ?? fallback).trim();
}

function toNullableText(value: FormDataEntryValue | null): string | null {
  const text = toText(value);
  return text ? text : null;
}

function toBoolean(value: FormDataEntryValue | null): boolean {
  const text = toText(value).toLowerCase();
  return text === "true" || text === "1" || text === "on" || text === "yes";
}

function parseNumber(value: FormDataEntryValue | null, fallback = 0): number {
  const text = toText(value).replace(",", ".");
  if (!text) return fallback;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableNumber(value: FormDataEntryValue | null): number | null {
  const text = toText(value).replace(",", ".");
  if (!text) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertUuid(value: string) {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(value)) {
    throw new Error("invalid_pricing_config_id");
  }
}

function assertNonNegativeMoney(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_MONEY_VALUE) {
    throw new Error(`${name} must be between 0 and ${MAX_MONEY_VALUE}`);
  }
}

function assertPctRange(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be between 0 and 100`);
  }
}

function assertPctTotal(name: string, value: number, expected = 100) {
  const rounded = round2(value);
  if (rounded !== expected) {
    throw new Error(`${name} must equal ${expected}`);
  }
}

function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase() || "USD";

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("currency must be a 3-letter ISO code like USD");
  }

  return currency;
}

function normalizePromoType(value: string | null): PricingPayload["promo_type"] {
  if (!value) return null;

  const promoType = value.trim().toLowerCase();
  if (!ALLOWED_PROMO_TYPES.has(promoType)) {
    throw new Error("promo_type is invalid");
  }

  return promoType as PricingPayload["promo_type"];
}

function normalizePromoCode(value: string | null): string | null {
  if (!value) return null;

  const promo = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!promo) return null;

  if (!/^[A-Z0-9_-]{3,32}$/.test(promo)) {
    throw new Error("promo_code must be 3-32 characters: A-Z, 0-9, _ or -");
  }

  return promo;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function redirectToPricing(request: Request) {
  return NextResponse.redirect(new URL(PRICING_REDIRECT_PATH, request.url), 303);
}

async function requireAdminAccess(request: Request): Promise<AuthFailure | AuthSuccess> {
  const userClient = getUserClientFromRequest(request);

  if (!userClient) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  const adminClient = getAdminClient();

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  const role = normalizeUserRole(profile.role);

  if (!canAccessAdmin(role)) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  return {
    ok: true,
    userId: user.id,
    adminClient,
  };
}

function buildPayload(formData: FormData): { id: string; payload: PricingPayload } {
  const id = toText(formData.get("id"));
  if (!id) throw new Error("missing_id");
  assertUuid(id);

  const active = toBoolean(formData.get("active"));
  const promoEnabled = toBoolean(formData.get("promo_enabled"));

  const clientPct = round2(parseNumber(formData.get("client_pct")));
  const driverPct = round2(parseNumber(formData.get("driver_pct")));
  const restaurantPct = round2(parseNumber(formData.get("restaurant_pct")));
  const platformPct = round2(parseNumber(formData.get("platform_pct")));

  const deliveryPlatformPct = round2(parseNumber(formData.get("delivery_platform_pct"), 20));
  const deliveryDriverPct = round2(parseNumber(formData.get("delivery_driver_pct"), 80));

  const deliveryFeeBase = round2(parseNumber(formData.get("delivery_fee_base")));
  const deliveryFeePerMile = round2(parseNumber(formData.get("delivery_fee_per_mile")));
  const deliveryFeePerMinute = round2(parseNumber(formData.get("delivery_fee_per_minute")));
  const minimumOrderAmount = round2(parseNumber(formData.get("minimum_order_amount")));

  const promoType = normalizePromoType(toNullableText(formData.get("promo_type")));
  const promoValue = parseNullableNumber(formData.get("promo_value"));
  const promoCode = normalizePromoCode(toNullableText(formData.get("promo_code")));
  const currency = normalizeCurrency(toText(formData.get("currency"), "USD"));

  assertPctRange("client_pct", clientPct);
  assertPctRange("driver_pct", driverPct);
  assertPctRange("restaurant_pct", restaurantPct);
  assertPctRange("platform_pct", platformPct);
  assertPctRange("delivery_platform_pct", deliveryPlatformPct);
  assertPctRange("delivery_driver_pct", deliveryDriverPct);

  assertNonNegativeMoney("delivery_fee_base", deliveryFeeBase);
  assertNonNegativeMoney("delivery_fee_per_mile", deliveryFeePerMile);
  assertNonNegativeMoney("delivery_fee_per_minute", deliveryFeePerMinute);
  assertNonNegativeMoney("minimum_order_amount", minimumOrderAmount);

  // Your production payout triggers read these two delivery values directly.
  // Keeping the delivery split exactly at 100 prevents driver/platform payout gaps.
  assertPctTotal(
    "delivery_platform_pct + delivery_driver_pct",
    deliveryPlatformPct + deliveryDriverPct,
    100
  );

  // Food uses restaurant + platform for the restaurant subtotal split.
  // Errand can safely keep restaurant_pct = 0 and platform_pct/driver_pct values for legacy views.
  if (restaurantPct > 0 || platformPct > 0) {
    const coreTotal = round2(clientPct + restaurantPct + platformPct);
    if (coreTotal > 100) {
      throw new Error("client_pct + restaurant_pct + platform_pct must be <= 100");
    }
  }

  if (promoEnabled) {
    if (!promoType) {
      throw new Error("promo_type is required when promo is enabled");
    }

    if (promoType !== "free_delivery" && promoValue === null) {
      throw new Error("promo_value is required when promo is enabled");
    }

    if (promoValue !== null) {
      const normalizedPromoValue = round2(promoValue);
      if (!Number.isFinite(normalizedPromoValue) || normalizedPromoValue < 0) {
        throw new Error("promo_value must be >= 0");
      }

      if (promoType === "percent" && normalizedPromoValue > 100) {
        throw new Error("promo_value must be between 0 and 100 for percent promo");
      }
    }
  }

  const safePromoValue = promoValue === null ? null : round2(promoValue);

  return {
    id,
    payload: {
      active,
      currency,
      client_pct: clientPct,
      driver_pct: driverPct,
      restaurant_pct: restaurantPct,
      platform_pct: platformPct,
      delivery_platform_pct: deliveryPlatformPct,
      delivery_driver_pct: deliveryDriverPct,
      delivery_fee_base: deliveryFeeBase,
      delivery_fee_per_mile: deliveryFeePerMile,
      delivery_fee_per_minute: deliveryFeePerMinute,
      minimum_order_amount: minimumOrderAmount,
      promo_enabled: promoEnabled,
      promo_type: promoEnabled ? promoType : null,
      promo_value: promoEnabled && promoType !== "free_delivery" ? safePromoValue : null,
      promo_code: promoEnabled ? promoCode : null,
      updated_at: new Date().toISOString(),
    },
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdminAccess(request);
    if (auth.ok === false) {
      return auth.response;
    }

    const formData = await request.formData();
    const { id, payload } = buildPayload(formData);

    const { data, error } = await auth.adminClient
      .from("pricing_config")
      .update(payload)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      return jsonError(error.message, 500);
    }

    if (!data) {
      return jsonError("pricing_config row not found", 404);
    }

    return redirectToPricing(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return jsonError(message, 400);
  }
}
