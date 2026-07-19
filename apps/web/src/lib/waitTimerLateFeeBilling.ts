import type { SupabaseClient } from "@supabase/supabase-js";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";
import { resolveOrderPlatformCountry } from "@/lib/platformCountryResolver";
import { createLateFeePaymentTransaction } from "@/lib/paymentTransactionService";
import { appendWalletLedgerEntry } from "@/lib/payoutTransactionService";
import type { PaymentEntityType } from "@/lib/paymentTypes";
import { computeWaitTimerState } from "@/lib/waitFeeCalculator";
import { recordWaitLateFeeLedgerEntries } from "@/lib/waitTimerLateFeeBridge";
import { logWaitTimerEvent } from "@/lib/waitTimerService";
import {
  isWaitTimerGpsValidated,
  type WaitTimerEntityType,
} from "@/lib/waitTimerTypes";

type WaitLateFeeRow = {
  id: string;
  driver_id: string | null;
  client_user_id: string | null;
  created_by: string | null;
  user_id: string | null;
  client_id: string | null;
  currency: string | null;
  country_code?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  wait_fee_amount_cents: number | null;
  wait_fee_status: string | null;
  wait_fee_currency: string | null;
  driver_arrived_at: string | null;
  manual_arrival_required: boolean | null;
  driver_distance_to_target_meters: number | null;
  wait_timer_started_at: string | null;
  free_wait_minutes: number | null;
  leave_at_door: boolean | null;
};

function tableForEntity(entityType: WaitTimerEntityType) {
  switch (entityType) {
    case "order":
      return "orders" as const;
    case "delivery_request":
      return "delivery_requests" as const;
    case "taxi_ride":
      return "taxi_rides" as const;
  }
}

function paymentEntityType(entityType: WaitTimerEntityType): PaymentEntityType {
  return entityType;
}

function resolveClientUserId(row: WaitLateFeeRow): string | null {
  return (
    row.client_user_id ??
    row.client_id ??
    row.created_by ??
    row.user_id ??
    null
  );
}

function resolveCountryCode(
  entityType: WaitTimerEntityType,
  row: WaitLateFeeRow
): string {
  if (entityType === "taxi_ride" && row.country_code) {
    return String(row.country_code).toUpperCase();
  }
  if (entityType === "order") {
    const fromOrder = resolveOrderPlatformCountry({
      currency: row.currency,
      pickup_lat: row.pickup_lat ?? null,
      pickup_lng: row.pickup_lng ?? null,
      dropoff_lat: row.dropoff_lat ?? null,
      dropoff_lng: row.dropoff_lng ?? null,
    });
    if (fromOrder) return fromOrder;
  }
  return inferPlatformCountryCode({
    countryCode: row.country_code ?? null,
    lat: row.dropoff_lat ?? row.pickup_lat ?? null,
    lng: row.dropoff_lng ?? row.pickup_lng ?? null,
    currency: row.currency,
  });
}

async function loadWaitLateFeeRow(
  supabaseAdmin: SupabaseClient,
  entityType: WaitTimerEntityType,
  entityId: string
): Promise<WaitLateFeeRow | null> {
  const table = tableForEntity(entityType);
  // `orders` has no country_code column; infer from coords. Other entities keep it.
  const countrySelect = entityType === "order" ? "" : "country_code,";
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(
      `
      id,
      driver_id,
      client_user_id,
      created_by,
      user_id,
      client_id,
      currency,
      ${countrySelect}
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,
      wait_fee_amount_cents,
      wait_fee_status,
      wait_fee_currency,
      driver_arrived_at,
      manual_arrival_required,
      driver_distance_to_target_meters,
      wait_timer_started_at,
      free_wait_minutes,
      leave_at_door
`
    )
    .eq("id", entityId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as WaitLateFeeRow | null) ?? null;
}

export type ChargeWaitLateFeeResult =
  | { charged: false; reason: string; fee_cents?: number }
  | {
      charged: true;
      fee_cents: number;
      payment_transaction_id: string;
      already_charged?: boolean;
    };

export async function chargeWaitLateFeeIfEligible(
  supabaseAdmin: SupabaseClient,
  input: {
    entityType: WaitTimerEntityType;
    entityId: string;
    orderId?: string | null;
  }
): Promise<ChargeWaitLateFeeResult> {
  const row = await loadWaitLateFeeRow(
    supabaseAdmin,
    input.entityType,
    input.entityId
  );
  if (!row) return { charged: false, reason: "entity_not_found" };

  if (String(row.wait_fee_status ?? "").toLowerCase() === "charged") {
    return { charged: false, reason: "already_charged" };
  }

  if (!isWaitTimerGpsValidated(row)) {
    return { charged: false, reason: "gps_not_validated" };
  }

  if (!row.driver_id) {
    return { charged: false, reason: "missing_driver" };
  }

  const clientUserId = resolveClientUserId(row);
  if (!clientUserId) {
    return { charged: false, reason: "missing_client" };
  }

  const entityKind = input.entityType === "taxi_ride" ? "taxi" : "delivery";
  const computed = computeWaitTimerState({
    waitTimerStartedAt: row.wait_timer_started_at ?? row.driver_arrived_at,
    freeWaitMinutes: row.free_wait_minutes ?? undefined,
    leaveAtDoor: row.leave_at_door === true,
    entityKind,
  });

  const feeCents = computed.wait_fee_cents;
  if (feeCents <= 0) {
    return { charged: false, reason: "no_fee", fee_cents: 0 };
  }

  const paymentEntity = paymentEntityType(input.entityType);
  const { data: existingPayment } = await supabaseAdmin
    .from("payment_transactions")
    .select("id")
    .eq("entity_type", paymentEntity)
    .eq("entity_id", input.entityId)
    .eq("charge_category", "late_fee")
    .in("status", ["paid", "processing", "pending"])
    .maybeSingle();

  if (existingPayment?.id) {
    await supabaseAdmin
      .from(tableForEntity(input.entityType))
      .update({
        wait_fee_amount_cents: feeCents,
        wait_fee_minutes: computed.billable_minutes,
        wait_fee_status: "charged",
        wait_fee_currency: String(row.currency ?? "USD").toUpperCase(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.entityId);

    return {
      charged: true,
      fee_cents: feeCents,
      payment_transaction_id: String(existingPayment.id),
      already_charged: true,
    };
  }

  const currency = String(
    row.wait_fee_currency ?? row.currency ?? "USD"
  ).toUpperCase();
  const countryCode = resolveCountryCode(input.entityType, row);

  const payment = await createLateFeePaymentTransaction(supabaseAdmin, {
    orderId: input.orderId ?? (input.entityType === "order" ? input.entityId : null),
    userId: clientUserId,
    entityType: paymentEntity,
    entityId: input.entityId,
    countryCode,
    amountCents: feeCents,
    currency,
    providerPayload: {
      wait_fee_minutes: computed.billable_minutes,
      wait_fee_status: computed.wait_fee_status,
      gps_validated: true,
    },
  });

  await recordWaitLateFeeLedgerEntries(supabaseAdmin, {
    entityType: input.entityType,
    entityId: input.entityId,
    clientUserId,
    driverUserId: String(row.driver_id),
    countryCode,
    currency,
    feeCents,
    referenceId: payment.id,
  });

  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from(tableForEntity(input.entityType))
    .update({
      wait_fee_amount_cents: feeCents,
      wait_fee_minutes: computed.billable_minutes,
      wait_fee_status: "charged",
      wait_fee_currency: currency,
      updated_at: nowIso,
    })
    .eq("id", input.entityId);

  await logWaitTimerEvent(supabaseAdmin, {
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: "wait_fee_charged",
    actorId: null,
    triggeredRole: "system",
    description: "Wait late fee charged via payment_transactions",
    metadata: {
      fee_cents: feeCents,
      payment_transaction_id: payment.id,
    },
  });

  return {
    charged: true,
    fee_cents: feeCents,
    payment_transaction_id: payment.id,
  };
}

export async function recordTaxiNoShowDriverCompensation(
  supabaseAdmin: SupabaseClient,
  input: {
    rideId: string;
    driverUserId: string;
    countryCode: string;
    currency: string;
    rideCompensationCents: number;
    referenceId: string;
  }
) {
  if (input.rideCompensationCents <= 0) return;

  await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "platform",
    accountUserId: null,
    countryCode: input.countryCode,
    currency: input.currency,
    direction: "debit",
    amountCents: input.rideCompensationCents,
    referenceType: "payment_transaction",
    referenceId: input.referenceId,
    description: "Taxi no-show driver compensation (5% ride)",
    metadata: {
      entity_type: "taxi_ride",
      entity_id: input.rideId,
      compensation_type: "no_show_ride_pct",
    },
  });

  await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "driver",
    accountUserId: input.driverUserId,
    countryCode: input.countryCode,
    currency: input.currency,
    direction: "credit",
    amountCents: input.rideCompensationCents,
    referenceType: "payment_transaction",
    referenceId: input.referenceId,
    description: "Taxi no-show compensation credited to driver",
    metadata: {
      entity_type: "taxi_ride",
      entity_id: input.rideId,
      compensation_type: "no_show_ride_pct",
    },
  });
}
