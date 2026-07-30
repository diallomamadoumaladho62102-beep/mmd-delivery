import type { SupabaseClient } from "@supabase/supabase-js";
import { snapshotFromRideRow } from "@/lib/taxiFinalPrice";
import { enrichTaxiRideIdentification } from "@/lib/taxiRideClientIdentification";
import {
  buildEntityFinancialTimeline,
} from "@/lib/finance/buildEntityFinancialTimeline";
import type { FinancialActorRole } from "@/lib/finance/financialTimelineTypes";
import {
  filterApplicableFareLines,
  resolveTaxiFareLinesForDisplay,
  type TaxiFareComponentLine,
} from "@/lib/taxi/taxiFareComponents";
import { tryGetServerMapboxToken } from "@/lib/mapboxToken";

export type TaxiReceiptFareLine = {
  key: string;
  label_key: string;
  amount_cents: number;
  kind: "charge" | "discount" | "info";
};

export type TaxiReceiptPayload = {
  company: {
    legal_name: string;
    brand: string;
    support_email: string;
    support_phone: string | null;
    support_url: string;
  };
  invoice: {
    invoice_number: string;
    ride_number: string;
    ride_id: string;
    issued_at: string;
    status: string;
    payment_status: string;
    refund_status: string | null;
    qr_url: string;
    currency: string;
  };
  trip: {
    pickup_address: string;
    dropoff_address: string;
    pickup_at: string | null;
    dropoff_at: string | null;
    distance_miles: number | null;
    duration_minutes: number | null;
    wait_fee_minutes: number | null;
    vehicle_category: string | null;
    map_static_url: string | null;
    stops: Array<{ label: string; address: string; stop_order: number }>;
  };
  driver: {
    name: string | null;
    photo_url: string | null;
    vehicle_label: string | null;
    plate: string | null;
    rating: number | null;
  } | null;
  fare_lines: TaxiReceiptFareLine[];
  totals: {
    subtotal_cents: number;
    tax_cents: number;
    discounts_cents: number;
    tip_cents: number;
    wait_fee_cents: number;
    total_paid_cents: number;
  };
  payment: {
    method: string;
    funding: string | null;
    brand: string | null;
    last4: string | null;
    payment_intent_id: string | null;
    status: string;
  };
  financial_timeline: Awaited<ReturnType<typeof buildEntityFinancialTimeline>>;
  actions: {
    can_tip: boolean;
    can_rate: boolean;
    can_rebook: boolean;
    can_report: boolean;
  };
};

function siteBaseUrl(): string {
  return (
    String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "") ||
    "https://www.mmddelivery.com"
  );
}

function supportEmail(): string {
  return (
    String(process.env.MMD_SUPPORT_EMAIL ?? "").trim() ||
    "support@mmddelivery.com"
  );
}

function supportPhone(): string | null {
  const phone = String(process.env.MMD_ADMIN_SUPPORT_PHONE ?? "").trim();
  return phone || null;
}

function supportUrl(): string {
  const explicit = String(process.env.NEXT_PUBLIC_SUPPORT_URL ?? "").trim();
  if (explicit) return explicit;
  return `${siteBaseUrl()}/legal/support`;
}

function invoiceNumber(rideId: string, paidAt: string | null): string {
  const day = (paidAt ? new Date(paidAt) : new Date())
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  const short = rideId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `MMD-TX-${day}-${short}`;
}

function buildMapStaticUrl(ride: Record<string, unknown>): string | null {
  const pickLng = Number(ride.pickup_lng ?? ride.pickup_longitude);
  const pickLat = Number(ride.pickup_lat ?? ride.pickup_latitude);
  const dropLng = Number(ride.dropoff_lng ?? ride.dropoff_longitude);
  const dropLat = Number(ride.dropoff_lat ?? ride.dropoff_latitude);
  if (
    ![pickLng, pickLat, dropLng, dropLat].every((n) => Number.isFinite(n))
  ) {
    return null;
  }
  const token = tryGetServerMapboxToken();
  if (!token) return null;
  const path = [
    `pin-s-a+0ea5e9(${pickLng},${pickLat})`,
    `pin-s-b+f59e0b(${dropLng},${dropLat})`,
  ].join(",");
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${path}/auto/800x400@2x?access_token=${encodeURIComponent(token)}`;
}

/**
 * Reconstruct fare component lines from pricing + ride scalars.
 * Prefer stored fare_components when present (extensible catalog).
 * Only emits applicable (non-zero) lines — never invents surge/tolls/parking.
 */
export function buildTaxiFareLines(params: {
  ride: Record<string, unknown>;
  pricing: Record<string, unknown> | null;
}): TaxiReceiptFareLine[] {
  const resolved = resolveTaxiFareLinesForDisplay(params);
  return filterApplicableFareLines(resolved).map((line: TaxiFareComponentLine) => ({
    key: String(line.key),
    label_key: line.label_key,
    amount_cents: line.amount_cents,
    kind: line.kind === "total" ? "info" : line.kind === "discount" ? "discount" : "charge",
  }));
}

export async function buildTaxiReceiptPayload(
  supabaseAdmin: SupabaseClient,
  params: {
    rideId: string;
    role: FinancialActorRole;
    viewerUserId: string;
  }
): Promise<TaxiReceiptPayload | { error: string; status: number }> {
  const rideId = String(params.rideId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(rideId)) {
    return { error: "Invalid taxi ride id", status: 400 };
  }

  const { data: access, error: accessError } = await supabaseAdmin
    .from("taxi_rides")
    .select("id, client_user_id, driver_id")
    .eq("id", rideId)
    .maybeSingle();

  if (accessError) {
    return { error: accessError.message, status: 500 };
  }
  if (!access) {
    return { error: "Taxi ride not found", status: 404 };
  }

  const isClient = String(access.client_user_id) === params.viewerUserId;
  const isDriver = String(access.driver_id ?? "") === params.viewerUserId;
  if (params.role !== "admin" && !isClient && !isDriver) {
    return { error: "Forbidden", status: 403 };
  }

  const { data: rideRow, error } = await supabaseAdmin
    .from("taxi_rides")
    .select("*")
    .eq("id", rideId)
    .maybeSingle();

  if (error) return { error: error.message, status: 500 };
  if (!rideRow) return { error: "Taxi ride not found", status: 404 };

  const ride = (await enrichTaxiRideIdentification(
    supabaseAdmin,
    rideRow as Record<string, unknown>
  )) as Record<string, unknown>;

  const { data: stops } = await supabaseAdmin
    .from("taxi_ride_stops")
    .select("stop_order, address, label")
    .eq("taxi_ride_id", rideId)
    .order("stop_order", { ascending: true });

  let pricing: Record<string, unknown> | null = null;
  const pricingSnapshotId = String(ride.pricing_snapshot_id ?? "").trim();
  if (pricingSnapshotId) {
    const { data: pricingRow } = await supabaseAdmin
      .from("taxi_pricing")
      .select(
        "id, base_fare, per_mile, per_minute, min_fare, booking_fee, class_multiplier, surge_multiplier, airport_fee, cleaning_fee"
      )
      .eq("id", pricingSnapshotId)
      .maybeSingle();
    pricing = (pricingRow as Record<string, unknown> | null) ?? null;
  }

  const snap = snapshotFromRideRow(ride as any);
  const tipCents = Math.round(Number(ride.tip_cents ?? 0));
  const waitFeeCents = Math.round(Number(ride.wait_fee_amount_cents ?? 0));
  const status = String(ride.status ?? "");
  const paymentStatus = String(ride.payment_status ?? "");
  const paidAt = ride.paid_at ? String(ride.paid_at) : null;
  const issuedAt = String(
    ride.completed_at ?? ride.paid_at ?? ride.updated_at ?? ride.created_at
  );

  const timelineRole: FinancialActorRole =
    params.role === "admin"
      ? "admin"
      : isDriver
        ? "driver"
        : "client";

  const financial_timeline = await buildEntityFinancialTimeline(supabaseAdmin, {
    entityType: "taxi_ride",
    entityId: rideId,
    role: timelineRole,
    limit: 40,
  });

  const driverName =
    (ride.driver_name as string | null) ??
    (ride.driver_display_name as string | null) ??
    null;
  const vehicleParts = [
    ride.vehicle_make_snapshot ?? ride.vehicle_make,
    ride.vehicle_model_snapshot ?? ride.vehicle_model,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const vehicleLabel =
    (ride.vehicle_label as string | null) ??
    (vehicleParts.length > 0 ? vehicleParts : null);

  return {
    company: {
      legal_name: "MMD Delivery LLC",
      brand: "MMD",
      support_email: supportEmail(),
      support_phone: supportPhone(),
      support_url: supportUrl(),
    },
    invoice: {
      invoice_number: invoiceNumber(rideId, paidAt),
      ride_number: rideId.slice(0, 8).toUpperCase(),
      ride_id: rideId,
      issued_at: issuedAt,
      status,
      payment_status: paymentStatus,
      refund_status: ride.refund_status
        ? String(ride.refund_status)
        : null,
      qr_url: `${siteBaseUrl()}/taxi/receipt/${rideId}`,
      currency: String(ride.currency ?? "USD").toUpperCase(),
    },
    trip: {
      pickup_address: String(
        ride.pickup_address ?? ride.pickup_formatted_address ?? ""
      ),
      dropoff_address: String(
        ride.dropoff_address ?? ride.dropoff_formatted_address ?? ""
      ),
      pickup_at: ride.started_at
        ? String(ride.started_at)
        : ride.accepted_at
          ? String(ride.accepted_at)
          : null,
      dropoff_at: ride.completed_at ? String(ride.completed_at) : null,
      distance_miles: Number.isFinite(Number(ride.distance_miles))
        ? Number(ride.distance_miles)
        : null,
      duration_minutes: Number.isFinite(Number(ride.duration_minutes))
        ? Number(ride.duration_minutes)
        : null,
      wait_fee_minutes: Number.isFinite(Number(ride.wait_fee_minutes))
        ? Number(ride.wait_fee_minutes)
        : null,
      vehicle_category: ride.vehicle_category
        ? String(ride.vehicle_category)
        : ride.category_code
          ? String(ride.category_code)
          : null,
      map_static_url: buildMapStaticUrl(ride),
      stops: (stops ?? []).map((s: any) => ({
        stop_order: Number(s.stop_order ?? 0),
        address: String(s.address ?? ""),
        label: String(s.label ?? `Stop ${s.stop_order ?? ""}`),
      })),
    },
    driver: driverName
      ? {
          name: driverName,
          photo_url:
            (ride.driver_photo as string | null) ??
            (ride.driver_photo_url as string | null) ??
            null,
          vehicle_label: vehicleLabel,
          plate:
            (ride.vehicle_plate as string | null) ??
            (ride.vehicle_plate_snapshot as string | null) ??
            null,
          rating: Number.isFinite(Number(ride.driver_rating_snapshot))
            ? Number(ride.driver_rating_snapshot)
            : null,
        }
      : null,
    fare_lines: buildTaxiFareLines({ ride, pricing }),
    totals: {
      subtotal_cents: snap.subtotal_cents,
      tax_cents: snap.tax_cents,
      discounts_cents: snap.total_discount_cents,
      tip_cents: tipCents,
      wait_fee_cents: waitFeeCents,
      total_paid_cents:
        Math.round(Number(ride.total_cents ?? snap.total_cents)) + tipCents,
    },
    payment: {
      method:
        String(ride.payment_funding ?? "") === "business_wallet"
          ? "business_wallet"
          : "card",
      funding: ride.payment_funding ? String(ride.payment_funding) : null,
      brand: ride.payment_card_brand
        ? String(ride.payment_card_brand)
        : null,
      last4: ride.payment_card_last4
        ? String(ride.payment_card_last4)
        : null,
      payment_intent_id: ride.stripe_payment_intent_id
        ? String(ride.stripe_payment_intent_id)
        : null,
      status: paymentStatus,
    },
    financial_timeline,
    actions: {
      can_tip:
        isClient &&
        status === "completed" &&
        tipCents <= 0 &&
        paymentStatus === "paid",
      can_rate: isClient && status === "completed",
      can_rebook: isClient,
      can_report: isClient || isDriver,
    },
  };
}
