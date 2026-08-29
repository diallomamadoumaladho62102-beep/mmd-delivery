import type { AiToolContext, AiToolResult } from "@/lib/ai/aiTypes";
import {
  TAXI_CATEGORIES,
  TAXI_CATEGORY_LABELS,
  type TaxiCategory,
} from "@/lib/driverServicePreferencesTypes";
import { quoteRideFinalFromRateCaptureSot } from "@/lib/pricingEngine";
import { applyTaxiServiceFeeToQuote, mergeTaxiServiceFeeIntoQuote } from "@/lib/taxiServiceFee";
import { resolveTaxiMultiStopRoute } from "@/lib/taxiMapbox";
import { normalizeTaxiCountryCode } from "@/lib/taxiCountries";

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getTaxiCategories(ctx: AiToolContext): Promise<AiToolResult> {
  let counts: Record<string, number> = {};
  try {
    const { data, error } = await ctx.supabaseAdmin.rpc(
      "count_taxi_eligible_drivers_all_categories"
    );
    if (!error && data && typeof data === "object") {
      counts = data as Record<string, number>;
    }
  } catch {
    counts = {};
  }

  const categories = TAXI_CATEGORIES.map((category: TaxiCategory) => {
    const availableCount = Number(counts[category] ?? 0);
    return {
      category,
      label: TAXI_CATEGORY_LABELS[category],
      available: availableCount > 0,
    };
  });

  return {
    ok: true,
    summary: `Taxi categories: ${categories.map((c) => c.label).join(", ")}.`,
    data: { categories },
    actions: [
      {
        type: "navigate",
        label: "Open Taxi",
        route: "TaxiHome",
        params: {},
        icon: "taxi",
      },
    ],
  };
}

export async function quoteTaxi(ctx: AiToolContext, args: Record<string, unknown>): Promise<AiToolResult> {
  const pickupAddress = String(args.pickup_address ?? args.pickupAddress ?? "").trim();
  const dropoffAddress = String(args.dropoff_address ?? args.dropoffAddress ?? "").trim();
  const vehicleClass = String(args.vehicle_class ?? args.vehicleClass ?? "standard").trim() || "standard";
  const countryCode = normalizeTaxiCountryCode(args.country_code ?? args.countryCode ?? "US");
  const pickupLat = num(args.pickup_lat ?? args.pickupLat);
  const pickupLng = num(args.pickup_lng ?? args.pickupLng);
  const dropoffLat = num(args.dropoff_lat ?? args.dropoffLat);
  const dropoffLng = num(args.dropoff_lng ?? args.dropoffLng);

  if (!pickupAddress || !dropoffAddress) {
    return {
      ok: false,
      summary:
        "I need a pickup address and a dropoff address before I can estimate a taxi fare.",
      data: { missing: ["pickup_address", "dropoff_address"].filter((k) =>
        k === "pickup_address" ? !pickupAddress : !dropoffAddress
      ) },
      actions: [{ type: "navigate", label: "Open Taxi", route: "TaxiHome", params: {} }],
    };
  }

  if (
    pickupLat == null ||
    pickupLng == null ||
    dropoffLat == null ||
    dropoffLng == null
  ) {
    return {
      ok: true,
      summary:
        "I have the addresses. Open Taxi to confirm the pins and see the official fare. MMD AI will not charge you.",
      data: {
        pickupAddress,
        dropoffAddress,
        vehicleClass,
        countryCode,
        phase: "needs_map_confirmation",
      },
      requiresConfirmation: true,
      actions: [
        {
          type: "navigate",
          label: "Confirm taxi details",
          route: "TaxiHome",
          params: {
            pickupAddress,
            dropoffAddress,
            vehicleClass,
            countryCode,
            ...(pickupLat != null ? { pickupLat } : {}),
            ...(pickupLng != null ? { pickupLng } : {}),
            ...(dropoffLat != null ? { dropoffLat } : {}),
            ...(dropoffLng != null ? { dropoffLng } : {}),
          },
          priority: "high",
        },
      ],
    };
  }

  try {
    const route = await resolveTaxiMultiStopRoute({
      pickupAddress,
      dropoffAddress,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
    });

    const { data: quote, error } = await ctx.supabaseAdmin.rpc("quote_taxi_ride", {
      p_distance_miles: route.distanceMiles,
      p_duration_minutes: route.durationMinutes,
      p_vehicle_class: vehicleClass,
      p_country_code: countryCode,
      p_passenger_count: 1,
    });

    if (error) {
      return {
        ok: false,
        summary: "I could not estimate the fare here. Continue in Taxi for the official quote.",
        data: { phase: "quote_unavailable" },
        actions: [{ type: "navigate", label: "Open Taxi", route: "TaxiHome", params: {} }],
      };
    }

    const quoteObj = (quote ?? {}) as Record<string, unknown>;
    const serviceFeeQuote = await applyTaxiServiceFeeToQuote(ctx.supabaseAdmin, {
      countryCode,
      vehicleClass,
      subtotalCents: Number(quoteObj.subtotal_cents ?? 0),
      taxCents: Number(quoteObj.tax_cents ?? 0),
    });
    const priced = quoteRideFinalFromRateCaptureSot(
      mergeTaxiServiceFeeIntoQuote(quoteObj, serviceFeeQuote)
    );

    return {
      ok: true,
      summary: `Estimate ${priced.total_cents / 100} from ${pickupAddress} to ${dropoffAddress} (${vehicleClass}). This is not a charge. Confirm in Taxi to pay.`,
      data: {
        pickupAddress,
        dropoffAddress,
        vehicleClass,
        countryCode,
        distanceMiles: route.distanceMiles,
        durationMinutes: route.durationMinutes,
        total_cents: priced.total_cents,
        phase: "estimate_only",
      },
      requiresConfirmation: true,
      actions: [
        {
          type: "navigate",
          label: "Confirm and continue to Taxi checkout",
          route: "TaxiHome",
          params: {
            pickupAddress,
            dropoffAddress,
            vehicleClass,
            countryCode,
            pickupLat,
            pickupLng,
            dropoffLat,
            dropoffLng,
          },
          priority: "high",
        },
      ],
    };
  } catch {
    return {
      ok: true,
      summary:
        "I could not calculate the route from here. Open Taxi to confirm addresses and see the official fare. MMD AI will not charge you.",
      requiresConfirmation: true,
      actions: [{ type: "navigate", label: "Open Taxi", route: "TaxiHome", params: {} }],
    };
  }
}

export function prepareTaxiBooking(args: Record<string, unknown>): AiToolResult {
  const pickupAddress = String(args.pickup_address ?? args.pickupAddress ?? "").trim();
  const dropoffAddress = String(args.dropoff_address ?? args.dropoffAddress ?? "").trim();
  const vehicleClass = String(args.vehicle_class ?? args.vehicleClass ?? "standard").trim();

  if (!pickupAddress || !dropoffAddress) {
    return {
      ok: false,
      summary: "Confirm pickup and dropoff before I can prepare a taxi booking.",
    };
  }

  return {
    ok: true,
    requiresConfirmation: true,
    summary: `Ready to book taxi ${vehicleClass || "standard"} from ${pickupAddress} to ${dropoffAddress}. Confirm to open the official Taxi checkout. MMD AI will not take payment.`,
    data: {
      pickupAddress,
      dropoffAddress,
      vehicleClass,
      phase: "prepare_only",
    },
    actions: [
      {
        type: "navigate",
        label: "Confirm taxi booking",
        route: "TaxiHome",
        params: { pickupAddress, dropoffAddress, vehicleClass },
        priority: "high",
      },
    ],
  };
}

export async function getRecentTaxiRides(
  ctx: AiToolContext,
  args: Record<string, unknown>
): Promise<AiToolResult> {
  const limitRaw = Number(args.limit ?? 5);
  const limit = Number.isFinite(limitRaw) ? Math.min(10, Math.max(1, Math.trunc(limitRaw))) : 5;

  const { data, error } = await ctx.supabaseAdmin
    .from("taxi_rides")
    .select(
      "id, status, payment_status, created_at, pickup_address, dropoff_address, vehicle_class, total_cents"
    )
    .eq("client_user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { ok: false, summary: error.message };
  }

  const items = data ?? [];
  return {
    ok: true,
    summary: `Found ${items.length} taxi ride(s).`,
    data: { items },
    actions: items[0]
      ? [
          {
            type: "navigate",
            label: "Track latest taxi",
            route: "TaxiRideTracking",
            params: { rideId: String((items[0] as { id: string }).id) },
          },
        ]
      : undefined,
  };
}
