import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveOrderAmountCents } from "@/lib/orderAmountCents";
import { inferPlatformCountryCode } from "@/lib/platformCountryInference";
import { resolveOrderPlatformCountry } from "@/lib/platformCountryResolver";
import type { PaymentEntityType, ResolvedPaymentEntity } from "@/lib/paymentTypes";

type OrderRow = {
  id: string;
  client_user_id: string | null;
  created_by: string | null;
  client_id: string | null;
  user_id: string | null;
  payment_status: string | null;
  total_cents: number | null;
  total: number | null;
  grand_total: number | null;
  currency: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
};

type DeliveryRequestRow = {
  id: string;
  client_user_id: string | null;
  created_by: string | null;
  payment_status: string | null;
  total_cents: number | null;
  total: number | null;
  currency: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
};

type TaxiRideRow = {
  id: string;
  client_user_id: string | null;
  payment_status: string | null;
  total_cents: number | null;
  currency: string | null;
  country_code: string | null;
};

type SellerOrderRow = {
  id: string;
  client_user_id: string | null;
  payment_status: string | null;
  total_cents: number | null;
  currency: string | null;
  country_code: string | null;
};

function resolveOwnerId(row: {
  client_user_id?: string | null;
  created_by?: string | null;
  client_id?: string | null;
  user_id?: string | null;
}): string {
  return String(
    row.client_user_id ?? row.created_by ?? row.client_id ?? row.user_id ?? ""
  ).trim();
}

function resolveAmountFromTotalFields(row: {
  total_cents?: number | null;
  total?: number | null;
  grand_total?: number | null;
}): number | null {
  return resolveOrderAmountCents(row);
}

export async function resolvePaymentEntity(
  supabaseAdmin: SupabaseClient,
  entityType: PaymentEntityType,
  entityId: string,
  userId: string,
  countryOverride?: string | null
): Promise<ResolvedPaymentEntity | { error: string }> {
  switch (entityType) {
    case "order": {
      const { data, error } = await supabaseAdmin
        .from("orders")
        .select(
          "id,client_user_id,created_by,client_id,user_id,payment_status,total_cents,total,grand_total,currency,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng"
        )
        .eq("id", entityId)
        .maybeSingle<OrderRow>();
      if (error || !data) return { error: "order_not_found" };
      const ownerId = resolveOwnerId(data);
      if (ownerId !== userId) return { error: "forbidden" };
      const amountCents = resolveAmountFromTotalFields(data);
      if (amountCents == null) return { error: "invalid_order_amount" };
      const country_code =
        countryOverride ??
        resolveOrderPlatformCountry(data) ??
        inferPlatformCountryCode({ currency: data.currency });
      return {
        entity_type: entityType,
        entity_id: entityId,
        user_id: userId,
        country_code,
        amount_cents: amountCents,
        currency: String(data.currency ?? "USD").toUpperCase(),
        payment_status: data.payment_status,
        order_id: entityId,
      };
    }
    case "delivery_request": {
      const { data, error } = await supabaseAdmin
        .from("delivery_requests")
        .select(
          "id,client_user_id,created_by,payment_status,total_cents,total,currency,pickup_lat,pickup_lng"
        )
        .eq("id", entityId)
        .maybeSingle<DeliveryRequestRow>();
      if (error || !data) return { error: "delivery_request_not_found" };
      const ownerId = resolveOwnerId(data);
      if (ownerId !== userId) return { error: "forbidden" };
      const amountCents = resolveAmountFromTotalFields(data);
      if (amountCents == null) return { error: "invalid_delivery_amount" };
      const country_code =
        countryOverride ??
        inferPlatformCountryCode({
          lat: data.pickup_lat,
          lng: data.pickup_lng,
          currency: data.currency,
        });
      return {
        entity_type: entityType,
        entity_id: entityId,
        user_id: userId,
        country_code,
        amount_cents: amountCents,
        currency: String(data.currency ?? "USD").toUpperCase(),
        payment_status: data.payment_status,
        order_id: null,
      };
    }
    case "taxi_ride": {
      const { data, error } = await supabaseAdmin
        .from("taxi_rides")
        .select("id,client_user_id,payment_status,total_cents,currency,country_code")
        .eq("id", entityId)
        .maybeSingle<TaxiRideRow>();
      if (error || !data) return { error: "taxi_ride_not_found" };
      const ownerId = resolveOwnerId(data);
      if (ownerId !== userId) return { error: "forbidden" };
      const amountCents = resolveAmountFromTotalFields(data);
      if (amountCents == null) return { error: "invalid_taxi_amount" };
      const country_code =
        countryOverride ??
        inferPlatformCountryCode({ countryCode: data.country_code, currency: data.currency });
      return {
        entity_type: entityType,
        entity_id: entityId,
        user_id: userId,
        country_code,
        amount_cents: amountCents,
        currency: String(data.currency ?? "USD").toUpperCase(),
        payment_status: data.payment_status,
        order_id: null,
      };
    }
    case "seller_order": {
      const { data, error } = await supabaseAdmin
        .from("seller_orders")
        .select("id,client_user_id,payment_status,total_cents,currency,country_code")
        .eq("id", entityId)
        .maybeSingle<SellerOrderRow>();
      if (error || !data) return { error: "seller_order_not_found" };
      const ownerId = resolveOwnerId(data);
      if (ownerId !== userId) return { error: "forbidden" };
      const amountCents = resolveAmountFromTotalFields(data);
      if (amountCents == null) return { error: "invalid_marketplace_amount" };
      const country_code =
        countryOverride ??
        inferPlatformCountryCode({ countryCode: data.country_code, currency: data.currency });
      return {
        entity_type: entityType,
        entity_id: entityId,
        user_id: userId,
        country_code,
        amount_cents: amountCents,
        currency: String(data.currency ?? "USD").toUpperCase(),
        payment_status: data.payment_status,
        order_id: null,
      };
    }
    default:
      return { error: "unsupported_entity_type" };
  }
}
