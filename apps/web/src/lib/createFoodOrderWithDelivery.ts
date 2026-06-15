"use server";

import { supabaseServer } from "@/lib/supabaseServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createFoodOrderServerSide } from "@/lib/foodOrderService";
import type { FoodOrderLineInput } from "@/lib/foodOrderServerPricing";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";

export type CartItem = {
  id?: string;
  item_id?: string;
  name?: string;
  category?: string | null;
  quantity: number;
  unit_price?: number;
};

type CreateFoodOrderWithDeliveryArgs = {
  clientId: string;
  restaurantUserId?: string | null;
  restaurantName: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  items: CartItem[];
  promoCode?: string | null;
};

function toLineInputs(items: CartItem[]): FoodOrderLineInput[] {
  const lines: FoodOrderLineInput[] = [];

  for (const item of items) {
    const itemId = String(item.item_id ?? item.id ?? "").trim();
    if (!itemId) {
      throw new Error("Chaque article du panier doit avoir un item_id");
    }

    lines.push({
      item_id: itemId,
      quantity: Number(item.quantity),
    });
  }

  return lines;
}

export async function createFoodOrderWithDelivery(args: CreateFoodOrderWithDeliveryArgs) {
  const {
    clientId,
    restaurantUserId,
    restaurantName,
    pickupAddress,
    pickupLat,
    pickupLng,
    dropoffAddress,
    dropoffLat,
    dropoffLng,
    items,
    promoCode,
  } = args;

  if (!clientId) {
    throw new Error("clientId manquant");
  }

  if (!restaurantUserId) {
    throw new Error("restaurantUserId manquant");
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.id || user.id !== clientId) {
    throw new Error("Session client invalide");
  }

  const supabaseAdmin = buildSupabaseAdminClient();
  const countryCode = inferPlatformCountryCode({
    lat: dropoffLat,
    lng: dropoffLng,
  });

  const result = await createFoodOrderServerSide({
    supabaseAdmin,
    clientId,
    restaurantUserId,
    restaurantName,
    pickupAddress,
    pickupLat,
    pickupLng,
    dropoffAddress,
    dropoffLat,
    dropoffLng,
    items: toLineInputs(items),
    countryCode,
    promoCode,
  });

  return {
    orderId: result.orderId,
    deliveryFee: result.deliveryFee,
    rawDeliveryFee: result.deliveryFeeRaw,
    deliveryDiscountAmount: result.deliveryDiscountAmount,
    driverPayout: result.driverPayoutEstimate,
    promoCodeApplied: result.promoCodeApplied,
    promoTypeApplied: result.promoTypeApplied,
    promoValueApplied: result.promoValueApplied,
    promoDiscountAmount: result.promoDiscountAmount,
    discounts: result.discounts,
    subtotalAfterDiscount: result.subtotalAfterDiscount,
    subtotal: result.subtotal,
    tax: result.tax,
    currency: result.currency,
    total: result.total,
    totalCents: result.totalCents,
    distanceMiles: result.distanceMiles,
    etaMinutes: result.etaMinutes,
  };
}
