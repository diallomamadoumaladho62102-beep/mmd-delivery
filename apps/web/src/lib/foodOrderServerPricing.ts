/**
 * Phase 6 — menu IO helpers + pricing result types.
 * Quote SoT: quoteFoodSot / quoteFoodWithPricingEngine.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertNoClientFoodPricingFields,
  currencyForPlatformCountry,
  FOOD_LEGACY_TAX_RATE,
  FORBIDDEN_CLIENT_FOOD_PRICING_FIELDS,
  roundFoodMoney,
} from "@/lib/foodOrderClientPricingGuard";

export {
  assertNoClientFoodPricingFields,
  currencyForPlatformCountry,
  FOOD_LEGACY_TAX_RATE,
  FORBIDDEN_CLIENT_FOOD_PRICING_FIELDS,
  roundFoodMoney,
};

export type FoodOrderLineInput = {
  item_id: string;
  quantity: number;
  options?: unknown;
};

export type ResolvedFoodMenuLine = {
  item_id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  options?: unknown;
};

type RestaurantItemRow = {
  id: string;
  name: string;
  category: string | null;
  price_cents: number | null;
  is_available: boolean | null;
  stock_qty?: number | null;
  options_json?: unknown;
  restaurant_user_id: string;
};

type MenuOptionCatalogEntry = {
  id: string;
  name: string;
  price_cents: number;
};

export function parseMenuOptionsCatalog(raw: unknown): MenuOptionCatalogEntry[] {
  if (!Array.isArray(raw)) return [];

  const out: MenuOptionCatalogEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    const id = String(row.id ?? name).trim();
    const priceCents = Number(row.price_cents ?? row.priceCents ?? 0);
    if (!id || !name || !Number.isFinite(priceCents) || priceCents < 0) continue;
    out.push({ id, name, price_cents: Math.round(priceCents) });
  }
  return out;
}

export function resolveSelectedMenuOptionExtras(
  catalogRaw: unknown,
  selectedRaw: unknown,
): { extrasCents: number; selected: MenuOptionCatalogEntry[] } {
  const catalog = parseMenuOptionsCatalog(catalogRaw);
  if (selectedRaw == null) {
    return { extrasCents: 0, selected: [] };
  }

  const selectedKeys: string[] = [];
  if (Array.isArray(selectedRaw)) {
    for (const entry of selectedRaw) {
      if (typeof entry === "string") {
        const key = entry.trim();
        if (key) selectedKeys.push(key);
        continue;
      }
      if (entry && typeof entry === "object") {
        const row = entry as Record<string, unknown>;
        const key = String(row.id ?? row.name ?? "").trim();
        if (key) selectedKeys.push(key);
      }
    }
  } else if (typeof selectedRaw === "object") {
    for (const [key, enabled] of Object.entries(selectedRaw as Record<string, unknown>)) {
      if (enabled) selectedKeys.push(key);
    }
  }

  if (selectedKeys.length === 0) {
    return { extrasCents: 0, selected: [] };
  }

  if (catalog.length === 0) {
    throw new Error("Ce produit n’accepte pas d’options.");
  }

  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const byName = new Map(catalog.map((entry) => [entry.name.toLowerCase(), entry]));
  const selected: MenuOptionCatalogEntry[] = [];
  let extrasCents = 0;

  for (const key of selectedKeys) {
    const match = byId.get(key) ?? byName.get(key.toLowerCase());
    if (!match) {
      throw new Error(`Option invalide: ${key}`);
    }
    selected.push(match);
    extrasCents += match.price_cents;
  }

  return { extrasCents, selected };
}

export type FoodOrderPricingInput = {
  supabaseAdmin: SupabaseClient;
  restaurantUserId: string;
  items: FoodOrderLineInput[];
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  countryCode: string;
  promoCode?: string | null;
  /** Client applying MMD+ benefits (optional — fail-open if absent). */
  clientUserId?: string | null;
};

export type FoodOrderPricingResult = {
  countryCode: string;
  currency: string;
  configKey: string;
  items: ResolvedFoodMenuLine[];
  subtotal: number;
  tax: number;
  taxRatePct: number;
  taxSource: string;
  serviceFee: number;
  serviceFeeCents: number;
  serviceFeePct: number;
  serviceFeeEnabled: boolean;
  serviceFeeFixedCents: number;
  deliveryFeeRaw: number;
  deliveryFee: number;
  deliveryDiscountAmount: number;
  marketingDiscountAmount: number;
  marketingDeliveryDiscountAmount: number;
  mmdPlusDeliveryDiscountAmount: number;
  mmdPlusOrderDiscountAmount: number;
  promoCodeApplied: string | null;
  promoTypeApplied: string | null;
  promoValueApplied: number | null;
  promoDiscountAmount: number;
  discounts: number;
  subtotalAfterDiscount: number;
  total: number;
  totalCents: number;
  distanceMiles: number;
  etaMinutes: number;
  driverPayoutEstimate: number;
  /** Server-resolved restaurant pickup coordinates (never client-trusted). */
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
};

export function toFiniteFoodNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function normalizeFoodPromoCode(value?: string | null) {
  const text = String(value ?? "").trim().toUpperCase();
  return text || null;
}

function validateLineInputs(items: FoodOrderLineInput[]) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Le panier est vide");
  }

  for (const item of items) {
    const itemId = String(item?.item_id ?? "").trim();
    const quantity = toFiniteFoodNumber(item?.quantity);

    if (!itemId) {
      throw new Error("item_id manquant dans le panier");
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Quantité invalide pour ${itemId}`);
    }
  }
}

export async function loadRestaurantMenuLines(
  supabaseAdmin: SupabaseClient,
  restaurantUserId: string,
  items: FoodOrderLineInput[]
): Promise<ResolvedFoodMenuLine[]> {
  validateLineInputs(items);

  const itemIds = [...new Set(items.map((item) => String(item.item_id).trim()))];

  const { data, error } = await supabaseAdmin
    .from("restaurant_items")
    .select("id, name, category, price_cents, is_available, stock_qty, options_json, restaurant_user_id")
    .eq("restaurant_user_id", restaurantUserId)
    .in("id", itemIds);

  if (error) {
    throw new Error(`Menu lookup failed: ${error.message}`);
  }

  const byId = new Map<string, RestaurantItemRow>();
  for (const row of (data ?? []) as RestaurantItemRow[]) {
    byId.set(row.id, row);
  }

  const resolved: ResolvedFoodMenuLine[] = [];

  for (const line of items) {
    const itemId = String(line.item_id).trim();
    const fresh = byId.get(itemId);

    if (!fresh || fresh.is_available !== true) {
      throw new Error(`Plat indisponible: ${itemId}`);
    }

    if (fresh.stock_qty != null && Number(fresh.stock_qty) <= 0) {
      throw new Error(`Plat en rupture de stock: ${fresh.name || itemId}`);
    }

    const quantity = toFiniteFoodNumber(line.quantity);

    if (fresh.stock_qty != null && quantity > Number(fresh.stock_qty)) {
      throw new Error(`Stock insuffisant pour ${fresh.name || itemId}`);
    }

    const baseUnitPrice = roundFoodMoney(toFiniteFoodNumber(fresh.price_cents) / 100);
    const { extrasCents, selected } = resolveSelectedMenuOptionExtras(
      fresh.options_json,
      line.options,
    );
    const unitPrice = roundFoodMoney(baseUnitPrice + extrasCents / 100);

    if (unitPrice < 0) {
      throw new Error(`Prix invalide pour ${fresh.name}`);
    }

    resolved.push({
      item_id: itemId,
      name: String(fresh.name ?? "").trim() || "Item",
      category: fresh.category ?? null,
      quantity,
      unit_price: unitPrice,
      line_total: roundFoodMoney(unitPrice * quantity),
      options: selected.length > 0 ? selected : line.options ?? null,
    });
  }

  return resolved;
}
