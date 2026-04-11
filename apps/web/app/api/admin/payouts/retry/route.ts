import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { AdminAccessError, assertCanRetryPayout } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RetryTarget = "restaurant" | "driver";

type RetryBody = {
  orderId?: unknown;
  target?: unknown;
};

type OrderRow = {
  id: string;
  payment_status: string;
  restaurant_paid_out: boolean;
  restaurant_paid_out_at: string | null;
  restaurant_transfer_id: string | null;
  driver_paid_out: boolean;
  driver_paid_out_at: string | null;
  driver_transfer_id: string | null;
};

type OrderPayoutRow = {
  id: string;
  order_id: string;
  target: RetryTarget | string;
  status: string;
  currency: string;
  amount_cents: number | null;
  destination_account_id: string | null;
  source_charge_id: string | null;
  stripe_transfer_id: string | null;
  idempotency_key: string | null;
  locked_at: string | null;
  locked_by: string | null;
  failure_code: string | null;
  failure_message: string | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  succeeded_at: string | null;
  failed_at: string | null;
};

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

const ORDER_ID_MAX_LENGTH = 128;
const ALLOWED_CURRENCIES = new Set(["usd", "eur", "gbp", "cad"]);

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: JSON_HEADERS,
  });
}

function buildStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Missing required env: STRIPE_SECRET_KEY");
  }

  return new Stripe(secretKey, {
    apiVersion: "2023-10-16",
  });
}

function isRetryTarget(value: unknown): value is RetryTarget {
  return value === "restaurant" || value === "driver";
}

function normalizeRetryTarget(value: unknown): RetryTarget {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "restaurant" || v === "driver") return v;
  throw new Error("target must be 'restaurant' or 'driver'.");
}

function normalizeOrderId(value: unknown): string {
  const raw = String(value ?? "").trim();

  if (!raw) return "";

  if (raw.length > ORDER_ID_MAX_LENGTH) {
    throw new Error("Invalid orderId.");
  }

  // Accept UUIDs and internal safe ids only
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error("Invalid orderId.");
  }

  return raw;
}

function getRetryCount(metadata: Record<string, unknown> | null): number {
  const raw = metadata?.retry_count;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function normalizeCurrency(value: unknown): string {
  const currency = String(value ?? "").trim().toLowerCase();
  if (!currency || !ALLOWED_CURRENCIES.has(currency)) {
    throw new Error("Invalid payout currency.");
  }
  return currency;
}

function normalizeDestinationAccountId(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!/^acct_[A-Za-z0-9]+$/.test(raw)) {
    throw new Error("Invalid destination_account_id on payout row.");
  }
  return raw;
}

function normalizeSourceChargeId(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!/^ch_[A-Za-z0-9]+$/.test(raw)) {
    throw new Error("Invalid source_charge_id on payout row.");
  }
  return raw;
}

function getStripeErrorDetails(error: unknown): {
  message: string;
  code: string;
  type: string;
} {
  if (error instanceof Stripe.errors.StripeError) {
    return {
      message: error.message,
      code: error.code ?? "stripe_error",
      type: error.type ?? "StripeError",
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      code: "retry_failed",
      type: error.name || "Error",
    };
  }

  return {
    message: "Unknown Stripe retry error",
    code: "retry_failed",
    type: "UnknownError",
  };
}

async function parseBody(request: NextRequest): Promise<{
  orderId: string;
  target: RetryTarget;
}> {
  try {
    const body = (await request.json()) as RetryBody | null;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Request body must be a valid JSON object.");
    }

    const orderId = normalizeOrderId(body.orderId);
    const target = normalizeRetryTarget(body.target);

    if (!orderId) {
      throw new Error("orderId is required.");
    }

    return { orderId, target };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Invalid JSON body.");
  }
}

async function writePayoutAuditLog(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  orderId: string;
  target: RetryTarget;
  actor: string;
  status: "requested" | "rejected" | "succeeded" | "failed";
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { supabase, orderId, target, actor, status, message, metadata } = params;

  const { error } = await supabase.from("admin_payout_audit_logs").insert({
    order_id: orderId,
    target,
    action: "retry_failed_payout",
    actor,
    status,
    message,
    metadata: metadata ?? {},
  });

  if (error) {
    throw new Error(`Failed to write payout audit log: ${error.message}`);
  }
}

async function writeGlobalAdminAuditLog(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  adminUserId: string;
  action: "payout_retry" | "payout_resolved" | "payout_reviewed";
  targetType: "payout" | "order";
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { supabase, adminUserId, action, targetType, targetId, metadata } = params;

  const { error } = await supabase.from("admin_audit_logs").insert({
    admin_user_id: adminUserId,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata: metadata ?? {},
    created_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to write global admin audit log: ${error.message}`);
  }
}

async function writeRetryAuditLogs(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  actor: string;
  orderId: string;
  target: RetryTarget;
  status: "requested" | "rejected" | "succeeded" | "failed";
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { supabase, actor, orderId, target, status, message, metadata } = params;

  await writePayoutAuditLog({
    supabase,
    orderId,
    target,
    actor,
    status,
    message,
    metadata,
  });

  await writeGlobalAdminAuditLog({
    supabase,
    adminUserId: actor,
    action: status === "succeeded" ? "payout_resolved" : "payout_retry",
    targetType: "payout",
    targetId: orderId,
    metadata: {
      order_id: orderId,
      target,
      status,
      message,
      ...(metadata ?? {}),
    },
  });
}

async function loadOrder(
  supabase: ReturnType<typeof buildSupabaseAdminClient>,
  orderId: string
): Promise<OrderRow | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
        id,
        payment_status,
        restaurant_paid_out,
        restaurant_paid_out_at,
        restaurant_transfer_id,
        driver_paid_out,
        driver_paid_out_at,
        driver_transfer_id
      `
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load order: ${error.message}`);
  }

  return (data as OrderRow | null) ?? null;
}

async function loadLatestTargetPayout(
  supabase: ReturnType<typeof buildSupabaseAdminClient>,
  orderId: string,
  target: RetryTarget
): Promise<OrderPayoutRow | null> {
  const { data, error } = await supabase
    .from("order_payouts")
    .select(
      `
        id,
        order_id,
        target,
        status,
        currency,
        amount_cents,
        destination_account_id,
        source_charge_id,
        stripe_transfer_id,
        idempotency_key,
        locked_at,
        locked_by,
        failure_code,
        failure_message,
        last_error,
        metadata,
        created_at,
        updated_at,
        succeeded_at,
        failed_at
      `
    )
    .eq("order_id", orderId)
    .eq("target", target)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load payout row: ${error.message}`);
  }

  return (data as OrderPayoutRow | null) ?? null;
}

function isAlreadyPaidOut(order: OrderRow, target: RetryTarget): boolean {
  return target === "restaurant"
    ? order.restaurant_paid_out === true && !!order.restaurant_transfer_id
    : order.driver_paid_out === true && !!order.driver_transfer_id;
}

function buildOrderPatch(
  target: RetryTarget,
  transferId: string,
  succeededAt: string
) {
  return target === "restaurant"
    ? {
        restaurant_paid_out: true,
        restaurant_paid_out_at: succeededAt,
        restaurant_transfer_id: transferId,
      }
    : {
        driver_paid_out: true,
        driver_paid_out_at: succeededAt,
        driver_transfer_id: transferId,
      };
}

function buildRetryIdempotencyKey(
  payout: OrderPayoutRow,
  orderId: string,
  target: RetryTarget,
  retryCount: number
): string {
  const base = payout.idempotency_key || `transfer:${orderId}:${target}`;
  return `${base}:retry:${retryCount + 1}`;
}

async function lockPayoutRow(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  payout: OrderPayoutRow;
  actor: string;
  nowIso: string;
  retryCount: number;
}): Promise<void> {
  const { supabase, payout, actor, nowIso, retryCount } = params;

  const { data, error } = await supabase
    .from("order_payouts")
    .update({
      locked_at: nowIso,
      locked_by: actor,
      updated_at: nowIso,
      metadata: {
        ...(payout.metadata ?? {}),
        retry_requested_at: nowIso,
        retry_count: retryCount + 1,
        last_retry_actor: actor,
      },
    })
    .eq("id", payout.id)
    .eq("status", "failed")
    .is("succeeded_at", null)
    .select("id")
    .limit(1);

  if (error) {
    throw new Error(`Failed to lock payout row: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error("Payout row could not be locked for retry.");
  }
}

async function markRetrySuccess(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  payout: OrderPayoutRow;
  actor: string;
  retryCount: number;
  retryIdempotencyKey: string;
  transferId: string;
  requestedAt: string;
  succeededAt: string;
}): Promise<void> {
  const {
    supabase,
    payout,
    actor,
    retryCount,
    retryIdempotencyKey,
    transferId,
    requestedAt,
    succeededAt,
  } = params;

  const { data, error } = await supabase
    .from("order_payouts")
    .update({
      status: "succeeded",
      stripe_transfer_id: transferId,
      failure_code: null,
      failure_message: null,
      last_error: null,
      failed_at: null,
      succeeded_at: succeededAt,
      locked_at: requestedAt,
      locked_by: actor,
      updated_at: succeededAt,
      idempotency_key: retryIdempotencyKey,
      metadata: {
        ...(payout.metadata ?? {}),
        retry_requested_at: requestedAt,
        retry_count: retryCount + 1,
        retried_successfully_at: succeededAt,
        last_retry_actor: actor,
        previous_failure_code: payout.failure_code,
        previous_failure_message: payout.failure_message,
        previous_last_error: payout.last_error,
      },
    })
    .eq("id", payout.id)
    .select("id")
    .limit(1);

  if (error) {
    throw new Error(
      `Failed to update payout row after retry: ${error.message}`
    );
  }

  if (!data || data.length === 0) {
    throw new Error("Retry success update did not affect the payout row.");
  }
}

async function syncOrderAfterSuccess(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  orderId: string;
  target: RetryTarget;
  transferId: string;
  succeededAt: string;
}): Promise<void> {
  const { supabase, orderId, target, transferId, succeededAt } = params;

  const { data, error } = await supabase
    .from("orders")
    .update(buildOrderPatch(target, transferId, succeededAt))
    .eq("id", orderId)
    .select("id")
    .limit(1);

  if (error) {
    throw new Error(
      `Failed to sync orders table after retry: ${error.message}`
    );
  }

  if (!data || data.length === 0) {
    throw new Error("Retry succeeded but orders table was not updated.");
  }
}

async function markRetryFailure(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  payout: OrderPayoutRow;
  actor: string;
  retryCount: number;
  retryIdempotencyKey: string;
  requestedAt: string;
  failedAt: string;
  failureCode: string;
  failureMessage: string;
  failureType: string;
}): Promise<void> {
  const {
    supabase,
    payout,
    actor,
    retryCount,
    retryIdempotencyKey,
    requestedAt,
    failedAt,
    failureCode,
    failureMessage,
    failureType,
  } = params;

  const { error } = await supabase
    .from("order_payouts")
    .update({
      status: "failed",
      failed_at: failedAt,
      updated_at: failedAt,
      failure_code: failureCode,
      failure_message: failureMessage,
      last_error: failureMessage,
      locked_at: requestedAt,
      locked_by: actor,
      idempotency_key: retryIdempotencyKey,
      metadata: {
        ...(payout.metadata ?? {}),
        retry_requested_at: requestedAt,
        retry_count: retryCount + 1,
        retry_failed_at: failedAt,
        last_retry_actor: actor,
        last_retry_error_type: failureType,
      },
    })
    .eq("id", payout.id);

  if (error) {
    throw new Error(
      `Failed to update payout row after failed retry: ${error.message}`
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await assertCanRetryPayout();
    const actor = admin.userId;

    const { orderId, target } = await parseBody(request);

    const supabase = buildSupabaseAdminClient();
    const stripe = buildStripeClient();

    await writeRetryAuditLogs({
      supabase,
      actor,
      orderId,
      target,
      status: "requested",
      message: `Retry requested for ${target}.`,
    });

    const order = await loadOrder(supabase, orderId);

    if (!order) {
      await writeRetryAuditLogs({
        supabase,
        actor,
        orderId,
        target,
        status: "rejected",
        message: "Order not found.",
      });

      return json({ ok: false, error: "Order not found." }, 404);
    }

    if (order.payment_status !== "paid") {
      await writeRetryAuditLogs({
        supabase,
        actor,
        orderId,
        target,
        status: "rejected",
        message: "Only paid orders can be retried.",
      });

      return json({ ok: false, error: "Only paid orders can be retried." }, 400);
    }

    const payout = await loadLatestTargetPayout(supabase, orderId, target);

    if (!payout) {
      await writeRetryAuditLogs({
        supabase,
        actor,
        orderId,
        target,
        status: "rejected",
        message: "No payout row found for this target.",
      });

      return json(
        { ok: false, error: "No payout row found for this target." },
        404
      );
    }

    if (payout.status !== "failed") {
      await writeRetryAuditLogs({
        supabase,
        actor,
        orderId,
        target,
        status: "rejected",
        message: `Retry only allowed when payout status is 'failed'. Current status: ${payout.status}`,
        metadata: {
          payout_row_id: payout.id,
          current_status: payout.status,
        },
      });

      return json(
        {
          ok: false,
          error: `Retry only allowed when payout status is 'failed'. Current status: ${payout.status}`,
        },
        400
      );
    }

    if (!payout.amount_cents || payout.amount_cents <= 0) {
      await writeRetryAuditLogs({
        supabase,
        actor,
        orderId,
        target,
        status: "rejected",
        message: "Invalid amount_cents on payout row.",
        metadata: {
          payout_row_id: payout.id,
          amount_cents: payout.amount_cents,
        },
      });

      return json({ ok: false, error: "Invalid amount_cents on payout row." }, 400);
    }

    let validatedDestination = "";
    let validatedSourceChargeId = "";
    let validatedCurrency = "";

    try {
      validatedDestination = normalizeDestinationAccountId(
        payout.destination_account_id
      );
      validatedSourceChargeId = normalizeSourceChargeId(payout.source_charge_id);
      validatedCurrency = normalizeCurrency(payout.currency);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid payout row.";

      await writeRetryAuditLogs({
        supabase,
        actor,
        orderId,
        target,
        status: "rejected",
        message,
        metadata: {
          payout_row_id: payout.id,
        },
      });

      return json({ ok: false, error: message }, 400);
    }

    if (payout.stripe_transfer_id || payout.succeeded_at) {
      await writeRetryAuditLogs({
        supabase,
        actor,
        orderId,
        target,
        status: "rejected",
        message: "Payout already has a successful transfer reference.",
        metadata: {
          payout_row_id: payout.id,
          stripe_transfer_id: payout.stripe_transfer_id,
          succeeded_at: payout.succeeded_at,
        },
      });

      return json(
        { ok: false, error: "Payout already has a successful transfer reference." },
        400
      );
    }

    if (isAlreadyPaidOut(order, target)) {
      await writeRetryAuditLogs({
        supabase,
        actor,
        orderId,
        target,
        status: "rejected",
        message: `${target} already paid out on orders table.`,
        metadata: {
          payout_row_id: payout.id,
        },
      });

      return json(
        { ok: false, error: `${target} already paid out on orders table.` },
        400
      );
    }

    if (payout.locked_at) {
      await writeRetryAuditLogs({
        supabase,
        actor,
        orderId,
        target,
        status: "rejected",
        message: "Payout row is currently locked for processing.",
        metadata: {
          payout_row_id: payout.id,
          locked_at: payout.locked_at,
          locked_by: payout.locked_by,
        },
      });

      return json(
        {
          ok: false,
          error: "Payout row is currently locked for processing.",
        },
        409
      );
    }

    const retryCount = getRetryCount(payout.metadata);
    const retryIdempotencyKey = buildRetryIdempotencyKey(
      payout,
      orderId,
      target,
      retryCount
    );
    const requestedAt = new Date().toISOString();

    await lockPayoutRow({
      supabase,
      payout,
      actor,
      nowIso: requestedAt,
      retryCount,
    });

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: payout.amount_cents,
          currency: validatedCurrency,
          destination: validatedDestination,
          source_transaction: validatedSourceChargeId,
          metadata: {
            order_id: orderId,
            target,
            retry: "true",
            original_payout_row_id: payout.id,
          },
        },
        {
          idempotencyKey: retryIdempotencyKey,
        }
      );

      const transferId = transfer.id;
      const succeededAt = new Date().toISOString();

      await markRetrySuccess({
        supabase,
        payout,
        actor,
        retryCount,
        retryIdempotencyKey,
        transferId,
        requestedAt,
        succeededAt,
      });

      await syncOrderAfterSuccess({
        supabase,
        orderId,
        target,
        transferId,
        succeededAt,
      });

      await writeRetryAuditLogs({
        supabase,
        actor,
        orderId,
        target,
        status: "succeeded",
        message: `Retry succeeded for ${target}.`,
        metadata: {
          payout_row_id: payout.id,
          transfer_id: transferId,
          idempotency_key: retryIdempotencyKey,
        },
      });

      return json(
        {
          ok: true,
          message: `Retry succeeded for ${target}.`,
          orderId,
          target,
          transferId,
          payoutRowId: payout.id,
          idempotencyKey: retryIdempotencyKey,
        },
        200
      );
    } catch (error) {
      const details = getStripeErrorDetails(error);
      const failedAt = new Date().toISOString();

      await markRetryFailure({
        supabase,
        payout,
        actor,
        retryCount,
        retryIdempotencyKey,
        requestedAt,
        failedAt,
        failureCode: details.code,
        failureMessage: details.message,
        failureType: details.type,
      });

      await writeRetryAuditLogs({
        supabase,
        actor,
        orderId,
        target,
        status: "failed",
        message: details.message,
        metadata: {
          payout_row_id: payout.id,
          idempotency_key: retryIdempotencyKey,
          failure_code: details.code,
          failure_type: details.type,
        },
      });

      return json(
        {
          ok: false,
          error: details.message,
          orderId,
          target,
          payoutRowId: payout.id,
        },
        500
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown retry payout error";

    const status = error instanceof AdminAccessError ? error.status : 500;

    return json(
      {
        ok: false,
        error: message,
      },
      status
    );
  }
}
