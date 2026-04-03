import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { canAccessAdmin, normalizeUserRole } from "@/lib/roles";

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

function getUserClientFromRequest(request: Request): SupabaseClient | null {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    return null;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

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
  return toText(value).toLowerCase() === "true";
}

function toNumber(value: FormDataEntryValue | null, fallback = 0): number {
  const text = toText(value);
  if (!text) return fallback;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNullableNumber(value: FormDataEntryValue | null): number | null {
  const text = toText(value);
  if (!text) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function assertNonNegative(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be >= 0`);
  }
}

function assertPctRange(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be between 0 and 100`);
  }
}

function assertPromoType(value: string | null) {
  if (
    value !== null &&
    value !== "percent" &&
    value !== "fixed" &&
    value !== "free_delivery"
  ) {
    throw new Error("promo_type is invalid");
  }
}

function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  return currency || "USD";
}

function normalizePromoCode(value: string | null): string | null {
  if (!value) return null;
  const promo = value.trim().toUpperCase();
  return promo || null;
}

function buildValidationError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function requireAdminAccess(request: Request) {
  const userClient = getUserClientFromRequest(request);

  if (!userClient) {
    return { ok: false as const, response: buildValidationError("Unauthorized", 401) };
  }

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return { ok: false as const, response: buildValidationError("Unauthorized", 401) };
  }

  const adminClient = getAdminClient();

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { ok: false as const, response: buildValidationError("Forbidden", 403) };
  }

  const role = normalizeUserRole(profile.role);

  if (!canAccessAdmin(role)) {
    return { ok: false as const, response: buildValidationError("Forbidden", 403) };
  }

  return {
    ok: true as const,
    userId: user.id,
    adminClient,
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdminAccess(request);
    if (!auth.ok) {
      return auth.response;
    }

    const formData = await request.formData();

    const id = toText(formData.get("id"));
    if (!id) {
      return buildValidationError("missing_id", 400);
    }

    const active = toBoolean(formData.get("active"));
    const promoEnabled = toBoolean(formData.get("promo_enabled"));

    const clientPct = round2(toNumber(formData.get("client_pct")));
    const driverPct = round2(toNumber(formData.get("driver_pct")));
    const restaurantPct = round2(toNumber(formData.get("restaurant_pct")));
    const platformPct = round2(toNumber(formData.get("platform_pct")));

    const deliveryPlatformPct = round2(
      toNumber(formData.get("delivery_platform_pct"), 20)
    );
    const deliveryDriverPct = round2(
      toNumber(formData.get("delivery_driver_pct"), 80)
    );

    const deliveryFeeBase = round2(toNumber(formData.get("delivery_fee_base")));
    const deliveryFeePerMile = round2(
      toNumber(formData.get("delivery_fee_per_mile"))
    );
    const deliveryFeePerMinute = round2(
      toNumber(formData.get("delivery_fee_per_minute"))
    );
    const minimumOrderAmount = round2(
      toNumber(formData.get("minimum_order_amount"))
    );

    const promoType = toNullableText(formData.get("promo_type"));
    const promoValue = toNullableNumber(formData.get("promo_value"));
    const promoCodeRaw = toNullableText(formData.get("promo_code"));
    const currency = normalizeCurrency(toText(formData.get("currency"), "USD"));
    const promoCode = normalizePromoCode(promoCodeRaw);

    assertPctRange("client_pct", clientPct);
    assertPctRange("driver_pct", driverPct);
    assertPctRange("restaurant_pct", restaurantPct);
    assertPctRange("platform_pct", platformPct);
    assertPctRange("delivery_platform_pct", deliveryPlatformPct);
    assertPctRange("delivery_driver_pct", deliveryDriverPct);

    assertNonNegative("delivery_fee_base", deliveryFeeBase);
    assertNonNegative("delivery_fee_per_mile", deliveryFeePerMile);
    assertNonNegative("delivery_fee_per_minute", deliveryFeePerMinute);
    assertNonNegative("minimum_order_amount", minimumOrderAmount);

    assertPromoType(promoType);

    if (promoValue !== null && promoValue < 0) {
      throw new Error("promo_value must be >= 0");
    }

    if (promoType === "percent" && promoValue !== null && promoValue > 100) {
      throw new Error("promo_value must be between 0 and 100 for percent promo");
    }

    if (!promoEnabled && (promoType !== null || promoValue !== null || promoCode !== null)) {
      // On nettoie tout si la promo est désactivée
    }

    // Cohérence minimale des splits pour éviter des configs absurdes.
    if (restaurantPct > 0 && platformPct > 0) {
      const subtotalSplit = round2(clientPct + restaurantPct + platformPct);
      if (subtotalSplit > 100) {
        throw new Error("client_pct + restaurant_pct + platform_pct must be <= 100");
      }
    }

    const deliverySplit = round2(deliveryPlatformPct + deliveryDriverPct);
    if (deliverySplit > 100) {
      throw new Error("delivery_platform_pct + delivery_driver_pct must be <= 100");
    }

    const payload = {
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
      promo_value: promoEnabled ? promoValue : null,
      promo_code: promoEnabled ? promoCode : null,
    };

    const { error } = await auth.adminClient
      .from("pricing_config")
      .update(payload)
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.redirect(new URL("/admin/pricing", request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}