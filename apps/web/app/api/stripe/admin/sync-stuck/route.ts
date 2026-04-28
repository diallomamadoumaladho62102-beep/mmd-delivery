import { NextRequest, NextResponse } from "next/server";
import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { stripe } from "@/lib/stripe";
import {
  AdminAccessError,
  assertCanRetryPayout,
} from "@/lib/adminServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  hours?: number;
  limit?: number;
  dry_run?: boolean;
};

type AdminSupabase = SupabaseClient;

type ProcessingOrderRow = {
  id: string;
  status: string | null;
  stripe_session_id: string | null;
  payment_status: string | null;
  paid_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
};

type CronLockRow = {
  name: string;
  locked_until: string | null;
};

type GenericErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  type?: unknown;
  statusCode?: unknown;
  requestId?: unknown;
};

type AuthorizeResult = {
  actor: string;
  usedSecret: boolean;
};

type MarkedAction = "paid" | "unpaid" | "canceled";

function asErrorLike(value: unknown): GenericErrorLike | null {
  if (!value || typeof value !== "object") return null;
  return value as GenericErrorLike;
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error && value.message) return value.message;

  const err = asErrorLike(value);
  if (typeof err?.message === "string" && err.message.trim()) {
    return err.message;
  }

  return "Unknown error";
}

function getErrorCode(value: unknown): string | null {
  const err = asErrorLike(value);
  return typeof err?.code === "string" ? err.code : null;
}

function getErrorDetails(value: unknown): string | null {
  const err = asErrorLike(value);
  return typeof err?.details === "string" ? err.details : null;
}

function getErrorHint(value: unknown): string | null {
  const err = asErrorLike(value);
  return typeof err?.hint === "string" ? err.hint : null;
}

function getStripeErrorType(value: unknown): string | null {
  const err = asErrorLike(value);
  return typeof err?.type === "string" ? err.type : null;
}

function getStripeStatusCode(value: unknown): number | null {
  const err = asErrorLike(value);
  return typeof err?.statusCode === "number" ? err.statusCode : null;
}

function getStripeRequestId(value: unknown): string | null {
  const err = asErrorLike(value);
  return typeof err?.requestId === "string" ? err.requestId : null;
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      Vary: "x-admin-secret, cookie",
    },
  });
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeLower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function safeIsoDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const dt = new Date(raw);
  if (!Number.isFinite(dt.getTime())) return null;

  return dt.toISOString();
}

function isExpired(expiresAt: unknown): boolean {
  const iso = safeIsoDate(expiresAt);
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function secureSecretEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");

  if (aBuf.length !== bBuf.length) {
    return false;
  }

  return timingSafeEqual(toUint8Array(aBuf), toUint8Array(bBuf));
}

function getSupabaseAdmin(): AdminSupabase {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!isNonEmptyString(supabaseUrl) || !isNonEmptyString(serviceKey)) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        "x-client-info": "stripe-sync-stuck-route",
      },
    },
  });
}

async function parseBody(req: NextRequest): Promise<Body> {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return {};
    }

    const body = (await req.json()) as Body | null;
    if (!body || typeof body !== "object") return {};
    return body;
  } catch {
    return {};
  }
}

function hasValidAdminSecret(req: NextRequest): boolean {
  const expected = process.env.STRIPE_SYNC_ADMIN_SECRET;
  const provided = req.headers.get("x-admin-secret");

  if (!isNonEmptyString(expected) || !isNonEmptyString(provided)) {
    return false;
  }

  return secureSecretEquals(provided.trim(), expected.trim());
}

async function authorizeRequest(req: NextRequest): Promise<AuthorizeResult> {
  const admin = await assertCanRetryPayout(req);

  const secretRequired =
    safeLower(process.env.STRIPE_SYNC_REQUIRE_ADMIN_SECRET) === "true";
  const usedSecret = hasValidAdminSecret(req);

  if (secretRequired && !usedSecret) {
    throw new AdminAccessError("Missing or invalid admin secret", 403);
  }

  return {
    actor: usedSecret
      ? `admin:${admin.userId}:secret`
      : `admin:${admin.userId}`,
    usedSecret,
  };
}

function logSupabaseError(
  prefix: string,
  err: unknown,
  extra?: Record<string, unknown>
) {
  console.error(prefix, {
    code: getErrorCode(err),
    message: getErrorMessage(err),
    details: getErrorDetails(err),
    hint: getErrorHint(err),
    ...extra,
  });
}

function logStripeError(
  prefix: string,
  err: unknown,
  extra?: Record<string, unknown>
) {
  console.error(prefix, {
    type: getStripeErrorType(err),
    code: getErrorCode(err),
    message: getErrorMessage(err),
    statusCode: getStripeStatusCode(err),
    requestId: getStripeRequestId(err),
    ...extra,
  });
}

async function markOrderUnpaid(opts: {
  supabaseAdmin: AdminSupabase;
  orderId: string;
  canceled?: boolean;
}) {
  const { supabaseAdmin, orderId, canceled = false } = opts;
  const nowIso = new Date().toISOString();

  const payload: Record<string, unknown> = {
    payment_status: "unpaid",
    updated_at: nowIso,
  };

  if (canceled) {
    payload.status = "canceled";
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update(payload)
    .eq("id", orderId)
    .neq("payment_status", "paid");

  return { error };
}

async function readCronLock(
  supabaseAdmin: AdminSupabase,
  lockName: string
): Promise<CronLockRow | null> {
  const { data, error } = await supabaseAdmin
    .from("cron_locks")
    .select("name, locked_until")
    .eq("name", lockName)
    .maybeSingle<CronLockRow>();

  if (error) {
    logSupabaseError("[sync-stuck] lock read failed", error, {
      lock_name: lockName,
    });
    throw new Error("Failed to read cron lock");
  }

  return data ?? null;
}

async function writeCronLock(opts: {
  supabaseAdmin: AdminSupabase;
  lockName: string;
  lockUntilIso: string;
  actor: string;
}) {
  const { supabaseAdmin, lockName, lockUntilIso, actor } = opts;

  const { error } = await supabaseAdmin.from("cron_locks").upsert(
    {
      name: lockName,
      locked_until: lockUntilIso,
    },
    { onConflict: "name" }
  );

  if (error) {
    logSupabaseError("[sync-stuck] lock write failed", error, {
      actor,
      lock_name: lockName,
      lock_until: lockUntilIso,
    });
    throw new Error("Failed to acquire cron lock");
  }
}

function buildMarkedEntry(input: {
  orderId: string;
  sessionId: string;
  paymentIntentId: string | null;
  action: MarkedAction;
  stripePaymentStatus?: string;
  stripeSessionStatus?: string;
}) {
  return {
    order_id: input.orderId,
    session_id: input.sessionId,
    payment_intent_id: input.paymentIntentId,
    action: input.action,
    stripe_payment_status: input.stripePaymentStatus,
    stripe_session_status: input.stripeSessionStatus,
  };
}

export async function POST(req: NextRequest) {
  const startedAt = new Date();
  const startedIso = startedAt.toISOString();

  try {
    const requestId = randomUUID();
    const { actor, usedSecret } = await authorizeRequest(req);
    const body = await parseBody(req);
    const supabaseAdmin = getSupabaseAdmin();

    const hours = clampInt(body.hours, 1, 168, 24);
    const limit = clampInt(body.limit, 1, 300, 100);
    const dryRun = body.dry_run === true;

    const lockSeconds = clampInt(
      process.env.STRIPE_SYNC_RATE_LIMIT_SECONDS,
      10,
      3600,
      120
    );

    const lockName = "stripe-sync-stuck";
    const now = new Date();
    const lockUntil = new Date(now.getTime() + lockSeconds * 1000);

    const existingLock = await readCronLock(supabaseAdmin, lockName);

    if (existingLock?.locked_until) {
      const lockedUntilIso = safeIsoDate(existingLock.locked_until);
      if (lockedUntilIso) {
        const lockedUntilDate = new Date(lockedUntilIso);

        if (lockedUntilDate.getTime() > now.getTime()) {
          return json({
            ok: true,
            request_id: requestId,
            skipped: true,
            reason: "locked",
            locked_until: lockedUntilDate.toISOString(),
            rate_limit_seconds: lockSeconds,
          });
        }
      }
    }

    await writeCronLock({
      supabaseAdmin,
      lockName,
      lockUntilIso: lockUntil.toISOString(),
      actor,
    });

    const sinceIso = new Date(
      Date.now() - hours * 60 * 60 * 1000
    ).toISOString();

    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id, status, stripe_session_id, payment_status, paid_at, created_at, updated_at, expires_at"
      )
      .eq("payment_status", "processing")
      .not("stripe_session_id", "is", null)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      logSupabaseError("[sync-stuck] orders lookup failed", error, {
        request_id: requestId,
        actor,
        since_iso: sinceIso,
        limit,
      });

      return json(
        {
          error: "Failed to fetch processing orders",
          request_id: requestId,
        },
        500
      );
    }

    let checked = 0;
    let markedPaid = 0;
    let resetToUnpaid = 0;
    let canceledExpired = 0;
    let stillProcessing = 0;
    let failed = 0;

    const marked: Array<{
      order_id: string;
      session_id: string;
      payment_intent_id: string | null;
      action: MarkedAction;
      stripe_payment_status?: string;
      stripe_session_status?: string;
    }> = [];

    const errors: Array<{
      order_id?: string;
      session_id?: string;
      error: string;
    }> = [];

    for (const row of (orders ?? []) as ProcessingOrderRow[]) {
      checked++;

      const orderId = String(row.id ?? "").trim();
      const sessionId = String(row.stripe_session_id ?? "").trim();
      const expired = isExpired(row.expires_at);

      if (!orderId || !sessionId) {
        failed++;
        errors.push({
          order_id: orderId || undefined,
          session_id: sessionId || undefined,
          error: "Missing order id or stripe_session_id",
        });
        continue;
      }

      if (!/^cs_(test_|live_)?/i.test(sessionId)) {
        failed++;
        errors.push({
          order_id: orderId,
          session_id: sessionId,
          error: "Invalid stripe_session_id format",
        });
        continue;
      }

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const stripePaymentStatus = safeLower(session.payment_status);
        const stripeSessionStatus = safeLower(session.status);

        if (stripePaymentStatus === "paid") {
          const paymentIntentId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : null;

          if (!dryRun) {
            const { error: rpcErr } = await supabaseAdmin.rpc("mark_order_paid", {
              p_order_id: orderId,
              p_session_id: sessionId,
              p_payment_intent_id: paymentIntentId,
            });

            if (rpcErr) {
              failed++;
              logSupabaseError("[sync-stuck] mark_order_paid failed", rpcErr, {
                request_id: requestId,
                actor,
                order_id: orderId,
                session_id: sessionId,
                payment_intent_id: paymentIntentId,
              });

              errors.push({
                order_id: orderId,
                session_id: sessionId,
                error: getErrorMessage(rpcErr),
              });
            } else {
              markedPaid++;
              marked.push(
                buildMarkedEntry({
                  orderId,
                  sessionId,
                  paymentIntentId,
                  action: "paid",
                  stripePaymentStatus,
                  stripeSessionStatus,
                })
              );
            }
          } else {
            markedPaid++;
            marked.push(
              buildMarkedEntry({
                orderId,
                sessionId,
                paymentIntentId,
                action: "paid",
                stripePaymentStatus,
                stripeSessionStatus,
              })
            );
          }

          continue;
        }

        const shouldCancel =
          expired ||
          stripeSessionStatus === "expired" ||
          stripeSessionStatus === "complete";

        if (shouldCancel) {
          if (!dryRun) {
            const { error: updErr } = await markOrderUnpaid({
              supabaseAdmin,
              orderId,
              canceled: true,
            });

            if (updErr) {
              failed++;
              logSupabaseError("[sync-stuck] cancel expired order failed", updErr, {
                request_id: requestId,
                actor,
                order_id: orderId,
                session_id: sessionId,
                stripe_payment_status: stripePaymentStatus,
                stripe_session_status: stripeSessionStatus,
              });

              errors.push({
                order_id: orderId,
                session_id: sessionId,
                error: getErrorMessage(updErr),
              });
            } else {
              canceledExpired++;
              marked.push(
                buildMarkedEntry({
                  orderId,
                  sessionId,
                  paymentIntentId: null,
                  action: "canceled",
                  stripePaymentStatus,
                  stripeSessionStatus,
                })
              );
            }
          } else {
            canceledExpired++;
            marked.push(
              buildMarkedEntry({
                orderId,
                sessionId,
                paymentIntentId: null,
                action: "canceled",
                stripePaymentStatus,
                stripeSessionStatus,
              })
            );
          }

          continue;
        }

        if (stripePaymentStatus === "unpaid" || stripeSessionStatus === "open") {
          stillProcessing++;
          continue;
        }

        if (!dryRun) {
          const { error: updErr } = await markOrderUnpaid({
            supabaseAdmin,
            orderId,
            canceled: false,
          });

          if (updErr) {
            failed++;
            logSupabaseError("[sync-stuck] reset unpaid failed", updErr, {
              request_id: requestId,
              actor,
              order_id: orderId,
              session_id: sessionId,
              stripe_payment_status: stripePaymentStatus,
              stripe_session_status: stripeSessionStatus,
            });

            errors.push({
              order_id: orderId,
              session_id: sessionId,
              error: getErrorMessage(updErr),
            });
          } else {
            resetToUnpaid++;
            marked.push(
              buildMarkedEntry({
                orderId,
                sessionId,
                paymentIntentId: null,
                action: "unpaid",
                stripePaymentStatus,
                stripeSessionStatus,
              })
            );
          }
        } else {
          resetToUnpaid++;
          marked.push(
            buildMarkedEntry({
              orderId,
              sessionId,
              paymentIntentId: null,
              action: "unpaid",
              stripePaymentStatus,
              stripeSessionStatus,
            })
          );
        }
      } catch (err: unknown) {
        failed++;
        logStripeError("[sync-stuck] retrieve checkout session failed", err, {
          request_id: requestId,
          actor,
          order_id: orderId,
          session_id: sessionId,
        });

        errors.push({
          order_id: orderId,
          session_id: sessionId,
          error: getErrorMessage(err),
        });
      }
    }

    const finishedAt = new Date();

    console.log("[sync-stuck] finished", {
      request_id: requestId,
      actor,
      used_secret: usedSecret,
      ms: finishedAt.getTime() - startedAt.getTime(),
      since_iso: sinceIso,
      checked,
      marked_paid: markedPaid,
      reset_to_unpaid: resetToUnpaid,
      canceled_expired: canceledExpired,
      still_processing: stillProcessing,
      failed,
      dry_run: dryRun,
      started_at: startedIso,
      finished_at: finishedAt.toISOString(),
    });

    return json({
      ok: true,
      request_id: requestId,
      actor,
      used_secret: usedSecret,
      dry_run: dryRun,
      sinceIso,
      checked,
      markedPaid,
      resetToUnpaid,
      canceledExpired,
      stillProcessing,
      failed,
      rate_limit_seconds: lockSeconds,
      lock_until: lockUntil.toISOString(),
      marked: marked.slice(0, 50),
      errors: errors.slice(0, 50),
    });
  } catch (err: unknown) {
    const status = err instanceof AdminAccessError ? err.status : 500;

    return json(
      {
        error: getErrorMessage(err),
      },
      status
    );
  }
}