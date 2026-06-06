import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

const MAX_MONEY_VALUE = 1_000_000;
const ALLOWED_PROMO_TYPES = new Set(["percent", "fixed", "free_delivery"]);

type PromoType = "percent" | "fixed" | "free_delivery" | null;

export type PricingPayload = {
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
  promo_type: PromoType;
  promo_value: number | null;
  promo_code: string | null;
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  region: "global" | "us" | "africa";
  tax_enabled: boolean;
  tax_pct: number;
  tax_label: string | null;
  fixed_client_fee: number;
  updated_at: string;
};

function text(value: FormDataEntryValue | null, fallback = "") {
  return String(value ?? fallback).trim();
}

function nullableText(value: FormDataEntryValue | null) {
  const clean = text(value);
  return clean ? clean : null;
}

function bool(value: FormDataEntryValue | null) {
  const clean = text(value).toLowerCase();
  return clean === "true" || clean === "1" || clean === "on" || clean === "yes";
}

function parseNumber(value: FormDataEntryValue | null, fallback = 0) {
  const clean = text(value).replace(",", ".");
  if (!clean) return fallback;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableNumber(value: FormDataEntryValue | null) {
  const clean = text(value).replace(",", ".");
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertUuid(value: string) {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(value)) {
    throw new Error("Invalid pricing config ID / ID de configuration invalide.");
  }
}

function assertPercent(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be between 0 and 100 / doit être entre 0 et 100.`);
  }
}

function assertMoney(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_MONEY_VALUE) {
    throw new Error(
      `${name} must be between 0 and ${MAX_MONEY_VALUE} / doit être entre 0 et ${MAX_MONEY_VALUE}.`
    );
  }
}

function normalizeCurrency(value: string) {
  const currency = value.trim().toUpperCase() || "USD";
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be a 3-letter code like USD / La devise doit être un code de 3 lettres comme USD.");
  }
  return currency;
}

function normalizePromoType(value: string | null): PromoType {
  if (!value) return null;
  const promoType = value.trim().toLowerCase();
  if (!ALLOWED_PROMO_TYPES.has(promoType)) {
    throw new Error("Invalid promo type / Type de promotion invalide.");
  }
  return promoType as PromoType;
}

function normalizePromoCode(value: string | null) {
  if (!value) return null;
  const promo = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!promo) return null;
  if (!/^[A-Z0-9_-]{3,32}$/.test(promo)) {
    throw new Error(
      "Promo code must be 3-32 characters: A-Z, 0-9, _ or - / Code promo : 3 à 32 caractères."
    );
  }
  return promo;
}

export function buildPricingPayload(formData: FormData): {
  id: string;
  payload: PricingPayload;
} {
  const id = text(formData.get("id"));
  if (!id) throw new Error("Missing ID / ID manquant.");
  assertUuid(id);

  const active = bool(formData.get("active"));
  const promoEnabled = bool(formData.get("promo_enabled"));

  const clientPct = round2(parseNumber(formData.get("client_pct")));
  const driverPct = 0;
  const restaurantPct = round2(parseNumber(formData.get("restaurant_pct")));
  const platformPct = round2(parseNumber(formData.get("platform_pct")));

  const deliveryPlatformPct = round2(
    parseNumber(formData.get("delivery_platform_pct"), 20)
  );
  const deliveryDriverPct = round2(
    parseNumber(formData.get("delivery_driver_pct"), 80)
  );

  const deliveryFeeBase = round2(parseNumber(formData.get("delivery_fee_base")));
  const deliveryFeePerMile = round2(
    parseNumber(formData.get("delivery_fee_per_mile"))
  );
  const deliveryFeePerMinute = round2(
    parseNumber(formData.get("delivery_fee_per_minute"))
  );
  const minimumOrderAmount = round2(
    parseNumber(formData.get("minimum_order_amount"))
  );

  const promoType = normalizePromoType(nullableText(formData.get("promo_type")));
  const promoValue = parseNullableNumber(formData.get("promo_value"));
  const promoCode = normalizePromoCode(nullableText(formData.get("promo_code")));
  const promoStartsAt = nullableText(formData.get("promo_starts_at"));
  const promoEndsAt = nullableText(formData.get("promo_ends_at"));
  const regionRaw = text(formData.get("region"), "global").toLowerCase();
  const region =
    regionRaw === "us" || regionRaw === "africa" || regionRaw === "global"
      ? regionRaw
      : "global";
  const taxEnabled = bool(formData.get("tax_enabled"));
  const taxPct = round2(parseNumber(formData.get("tax_pct")));
  const taxLabel = nullableText(formData.get("tax_label"));
  const fixedClientFee = round2(parseNumber(formData.get("fixed_client_fee")));
  const currency = normalizeCurrency(text(formData.get("currency"), "USD"));

  assertPercent("client_pct", clientPct);
  assertPercent("driver_pct", driverPct);
  assertPercent("restaurant_pct", restaurantPct);
  assertPercent("platform_pct", platformPct);
  assertPercent("delivery_platform_pct", deliveryPlatformPct);
  assertPercent("delivery_driver_pct", deliveryDriverPct);

  assertMoney("delivery_fee_base", deliveryFeeBase);
  assertMoney("delivery_fee_per_mile", deliveryFeePerMile);
  assertMoney("delivery_fee_per_minute", deliveryFeePerMinute);
  assertMoney("minimum_order_amount", minimumOrderAmount);
  assertMoney("fixed_client_fee", fixedClientFee);
  assertPercent("tax_pct", taxPct);

  const deliveryTotal = round2(deliveryDriverPct + deliveryPlatformPct);
  if (deliveryTotal !== 100) {
    throw new Error(
      "Delivery driver % + delivery platform % must equal 100 / La livraison chauffeur % + plateforme % doit faire 100."
    );
  }

  const coreTotal = round2(clientPct + restaurantPct + platformPct);
  if (coreTotal > 100) {
    throw new Error(
      "Client % + Restaurant % + Platform % must be <= 100 / Client % + Plateforme % doit être <= 100."
    );
  }

  if (promoEnabled) {
    if (!promoType) {
      throw new Error("Promo type is required when promo is enabled / Type promo obligatoire si la promo est active.");
    }
    if (promoType !== "free_delivery" && promoValue === null) {
      throw new Error("Promo value is required / Valeur promo obligatoire.");
    }
    if (promoValue !== null) {
      const safePromoValue = round2(promoValue);
      if (!Number.isFinite(safePromoValue) || safePromoValue < 0) {
        throw new Error("Promo value must be >= 0 / Valeur promo doit être >= 0.");
      }
      if (promoType === "percent" && safePromoValue > 100) {
        throw new Error("Percent promo must be <= 100 / Promo pourcentage doit être <= 100.");
      }
    }
  }

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
      promo_value:
        promoEnabled && promoType !== "free_delivery" && promoValue !== null
          ? round2(promoValue)
          : null,
      promo_code: promoEnabled ? promoCode : null,
      promo_starts_at: promoEnabled ? promoStartsAt : null,
      promo_ends_at: promoEnabled ? promoEndsAt : null,
      region,
      tax_enabled: taxEnabled,
      tax_pct: taxPct,
      tax_label: taxLabel,
      fixed_client_fee: fixedClientFee,
      updated_at: new Date().toISOString(),
    },
  };
}

export async function savePricingConfig(
  supabase: SupabaseClient,
  adminUserId: string,
  formData: FormData
) {
  const { id, payload } = buildPricingPayload(formData);

  const { data: before, error: readErr } = await supabase
    .from("pricing_config")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (readErr || !before) {
    throw new Error("pricing_config row not found");
  }

  const { error } = await supabase.from("pricing_config").update(payload).eq("id", id);

  if (error) {
    throw new Error(`Failed to save pricing_config: ${error.message}`);
  }

  await supabase.from("pricing_config_history").insert({
    pricing_config_id: id,
    changed_by: adminUserId,
    old_values: before,
    new_values: payload,
    change_type: "update",
  });

  await writeAdminAuditServer({
    supabaseAdmin: supabase,
    adminUserId,
    action: "pricing_updated",
    targetType: "pricing_config",
    targetId: id,
    oldValues: before as Record<string, unknown>,
    newValues: payload as unknown as Record<string, unknown>,
  });
}

export const PRICING_CONFIG_SELECT = `id, config_key, label, order_type, active, currency,
  client_pct, driver_pct, restaurant_pct, platform_pct,
  delivery_platform_pct, delivery_driver_pct,
  delivery_fee_base, delivery_fee_per_mile, delivery_fee_per_minute,
  minimum_order_amount,
  promo_enabled, promo_type, promo_value, promo_code,
  promo_starts_at, promo_ends_at,
  region, tax_enabled, tax_pct, tax_label, fixed_client_fee,
  updated_at`;
