"use server";

import { supabase } from "@/lib/supabaseServer";
import { getDistanceAndEta } from "@/lib/mapboxRoute";
import { computeDeliveryPricing } from "@/lib/deliveryPricing";

export type CartItem = {
  name: string;
  category?: string | null;
  quantity: number;
  unit_price: number;
};

type CreateFoodOrderWithDeliveryArgs = {
  // Identité
  clientId: string;

  // Restaurant
  restaurantUserId?: string | null;
  restaurantName: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;

  // Client / dropoff
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;

  // Panier
  items: CartItem[];
  subtotal: number; // somme des line_total
  tax: number; // taxes calculées côté front (ou 0 pour l’instant)
  currency?: string; // "USD" par défaut
};

export async function createFoodOrderWithDelivery(
  args: CreateFoodOrderWithDeliveryArgs
) {
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
    subtotal,
    tax,
    currency = "USD",
  } = args;

  if (!clientId) {
    throw new Error("clientId manquant");
  }

  if (!pickupAddress || !dropoffAddress) {
    throw new Error("Adresse pickup/dropoff manquante");
  }

  // 1) Distance + ETA via Mapbox
  const { distanceMiles, etaMinutes } = await getDistanceAndEta(
    { lat: pickupLat, lng: pickupLng },
    { lat: dropoffLat, lng: dropoffLng }
  );

  // 2) Calcul frais + parts avec ton modèle (3$ + 1.20/mile + 0.03/min, 25% MMD / 75% driver)
  const pricing = computeDeliveryPricing({
    distanceMiles,
    durationMinutes: etaMinutes,
  });

  const deliveryFee = pricing.deliveryFee;
  const driverPayout = pricing.driverPayout;
  // const platformFee = pricing.platformFee; // visible côté admin seulement

  // 3) Total client
  const total = subtotal + tax + deliveryFee;

  // 4) Construction du items_json
  const itemsJson = items.map((it) => ({
    name: it.name,
    category: it.category ?? null,
    quantity: it.quantity,
    unit_price: it.unit_price,
    line_total: Number((it.unit_price * it.quantity).toFixed(2)),
  }));

  // 5) Insert dans orders
  const { data, error } = await supabase
    .from("orders")
    .insert({
      created_by: clientId,
      client_id: clientId,
      user_id: clientId,

      kind: "food",
      order_type: "food",
      pickup_kind: "restaurant",

      restaurant_id: restaurantUserId ?? null,
      restaurant_user_id: restaurantUserId ?? null,
      restaurant_name: restaurantName,

      pickup_address: pickupAddress,
      dropoff_address: dropoffAddress,

      pickup_contact_name: null,
      pickup_phone: null,
      dropoff_contact_name: null,
      dropoff_phone: null,

      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      dropoff_lat: dropoffLat,
      dropoff_lng: dropoffLng,

      subtotal,
      tax,
      total,
      currency,

      items_json: itemsJson,

      distance_miles_est: distanceMiles,
      eta_minutes_est: etaMinutes,
      delivery_fee_est: deliveryFee,

      distance_miles: distanceMiles,
      eta_minutes: etaMinutes,
      delivery_fee: deliveryFee,
      delivery_pay: driverPayout,
    })
    .select("id")
    .single();

  if (error) {
    console.error(error);
    throw new Error(error.message);
  }

  return {
    orderId: data.id as string,
    deliveryFee,
    driverPayout,
    distanceMiles,
    etaMinutes,
  };
}
