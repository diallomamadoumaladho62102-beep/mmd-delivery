import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  AdminAccessError,
  assertCanManageTaxiPayouts,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { assertTaxiPayoutCurrencyAllowed } from "@/lib/taxiCurrencyGuard";
import {
  assertTaxiLaunchFeature,
  fetchTaxiCountryLaunchConfig,
} from "@/lib/taxiLaunchControl";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";
import { toStripeAmount } from "@/lib/taxiStripeAmounts";
import { normalizeTaxiCurrencyForStripe } from "@/lib/taxiCountries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  taxi_ride_id?: string;
  rideId?: string;
  dry_run?: boolean;
};

type TaxiRideRow = {
  id: string;
  status: string | null;
  payment_status: string | null;
  currency: string | null;
  country_code: string | null;
  driver_id: string | null;
  stripe_payment_intent_id: string | null;
  total_cents: number | null;
};

type TaxiCommissionRow = {
  id: string;
  taxi_ride_id: string;
  currency: string;
  driver_cents: number;
  driver_paid_out: boolean;
  driver_transfer_id: string | null;
  driver_paid_out_at: string | null;
};

type DriverFeaturesRow = {
  stripe_connect_account_id: string | null;
};

type DriverProfileRow = {
  stripe_account_id: string | null;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function getStripe() {
  return new Stripe(getEnv("STRIPE_SECRET_KEY"), {
    apiVersion: "2023-10-16",
  });
}

function getSupabaseAdmin() {
  return buildSupabaseAdminClient();
}

function lower(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function normalizeCurrency(v: unknown): string {
  return normalizeTaxiCurrencyForStripe(v, "usd");
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let result = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

async function authorizeRequest(req: NextRequest): Promise<string> {
  const adminSecret = process.env.STRIPE_TRANSFERS_ADMIN_SECRET;
  const provided = req.headers.get("x-admin-secret") || "";

  if (adminSecret && provided && timingSafeEqualStrings(provided, adminSecret)) {
    return "secret:stripe_transfers_admin_secret";
  }

  const admin = await assertCanManageTaxiPayouts(req);
  return admin.userId;
}

async function resolveSourceChargeId(
  stripe: Stripe,
  paymentIntentId: string
): Promise<string | null> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  const charge = pi.latest_charge;
  if (typeof charge === "string" && charge.startsWith("ch_")) return charge;
  if (charge && typeof charge === "object" && "id" in charge) {
    return String(charge.id);
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const actor = await authorizeRequest(req);
    const stripe = getStripe();
    const supabaseAdmin = getSupabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const rideId = String(body.taxi_ride_id ?? body.rideId ?? "").trim();
    const dryRun = body.dry_run === true;

    if (!rideId) {
      return json({ error: "taxi_ride_id required" }, 400);
    }

    const { data: ride, error: rideErr } = await supabaseAdmin
      .from("taxi_rides")
      .select(
        "id, status, payment_status, currency, country_code, driver_id, stripe_payment_intent_id, total_cents"
      )
      .eq("id", rideId)
      .maybeSingle<TaxiRideRow>();

    if (rideErr || !ride) {
      return json({ error: "Taxi ride not found" }, 404);
    }

    if (lower(ride.status) !== "completed") {
      return json({ error: "Taxi ride is not completed" }, 409);
    }

    if (lower(ride.payment_status) !== "paid") {
      return json({ error: "Taxi ride is not paid" }, 409);
    }

    if (!ride.driver_id) {
      return json({ error: "Taxi ride has no driver" }, 409);
    }

    let { data: commission, error: comErr } = await supabaseAdmin
      .from("taxi_commissions")
      .select(
        "id, taxi_ride_id, currency, driver_cents, driver_paid_out, driver_transfer_id, driver_paid_out_at"
      )
      .eq("taxi_ride_id", rideId)
      .maybeSingle<TaxiCommissionRow>();

    if (comErr) {
      return json({ error: "Taxi commission lookup failed" }, 500);
    }

    if (!commission) {
      const { error: refreshErr } = await supabaseAdmin.rpc("refresh_taxi_commissions", {
        p_ride_id: rideId,
      });

      if (refreshErr) {
        return json({ error: "Failed to refresh taxi commissions" }, 500);
      }

      const reload = await supabaseAdmin
        .from("taxi_commissions")
        .select(
          "id, taxi_ride_id, currency, driver_cents, driver_paid_out, driver_transfer_id, driver_paid_out_at"
        )
        .eq("taxi_ride_id", rideId)
        .maybeSingle<TaxiCommissionRow>();

      commission = reload.data ?? null;
      if (reload.error) {
        return json({ error: "Taxi commission lookup failed after refresh" }, 500);
      }
    }

    if (!commission) {
      return json({ error: "Taxi commission missing" }, 409);
    }

    if (commission.driver_paid_out && commission.driver_transfer_id) {
      return json({
        ok: true,
        already_succeeded: true,
        taxi_ride_id: rideId,
        transfer_id: commission.driver_transfer_id,
      });
    }

    if (commission.driver_paid_out && !commission.driver_transfer_id) {
      await supabaseAdmin
        .from("taxi_commissions")
        .update({
          driver_paid_out: false,
          driver_paid_out_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", commission.id)
        .is("driver_transfer_id", null);
    }

    const amount = Math.round(Number(commission.driver_cents ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ error: "Driver payout amount invalid" }, 409);
    }

    const { data: features } = await supabaseAdmin
      .from("taxi_driver_features")
      .select("stripe_connect_account_id")
      .eq("user_id", ride.driver_id)
      .maybeSingle<DriverFeaturesRow>();

    let destination = String(features?.stripe_connect_account_id ?? "").trim();

    if (!destination) {
      const { data: driverProfile } = await supabaseAdmin
        .from("driver_profiles")
        .select("stripe_account_id")
        .eq("user_id", ride.driver_id)
        .maybeSingle<DriverProfileRow>();

      destination = String(driverProfile?.stripe_account_id ?? "").trim();
    }

    if (!destination) {
      return json({ error: "Driver payout account missing" }, 400);
    }

    const paymentIntentId = String(ride.stripe_payment_intent_id ?? "").trim();
    if (!paymentIntentId) {
      return json({ error: "Missing stripe payment intent" }, 409);
    }

    const sourceChargeId = await resolveSourceChargeId(stripe, paymentIntentId);
    if (!sourceChargeId) {
      return json({ error: "Missing source charge for transfer" }, 409);
    }

    const currency = normalizeCurrency(ride.currency || commission.currency);

    const launchConfig = await fetchTaxiCountryLaunchConfig(
      supabaseAdmin,
      String(ride.country_code ?? "")
    );
    if (launchConfig) {
      const payoutLaunch = assertTaxiLaunchFeature(launchConfig, "payout");
      if (payoutLaunch.ok === false) {
        return json(
          {
            ok: false,
            error: payoutLaunch.error,
            message: payoutLaunch.message,
            country_code: launchConfig.country_code,
          },
          400
        );
      }
    }

    const platformPayout = await assertPlatformFeature(
      supabaseAdmin,
      String(ride.country_code ?? ""),
      "taxi",
      "payout"
    );
    if (platformPayout.ok === false) {
      return json(
        {
          ok: false,
          error: platformPayout.error,
          message: platformPayout.message,
          country_code: platformPayout.country_code,
        },
        400
      );
    }

    const payoutCurrency = assertTaxiPayoutCurrencyAllowed(currency);
    if (payoutCurrency.ok === false) {
      return json(
        {
          ok: false,
          error: payoutCurrency.error,
          message: payoutCurrency.message,
          currency: payoutCurrency.currency,
        },
        400
      );
    }

    const stripeTransferAmount = toStripeAmount(currency, amount);
    if (stripeTransferAmount <= 0) {
      return json({ error: "Driver payout amount invalid for Stripe" }, 409);
    }

    const idempotencyKey = `taxi_driver_payout:${rideId}`;
    const transferGroup = `taxi_ride:${rideId}`;

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        taxi_ride_id: rideId,
        amount,
        stripe_amount: stripeTransferAmount,
        currency,
        destination,
        source_charge_id: sourceChargeId,
        idempotency_key: idempotencyKey,
      });
    }

    const lockNowIso = new Date().toISOString();
    const { data: locked, error: lockErr } = await supabaseAdmin
      .from("taxi_commissions")
      .update({
        driver_paid_out: true,
        driver_paid_out_at: lockNowIso,
        updated_at: lockNowIso,
      })
      .eq("id", commission.id)
      .eq("driver_paid_out", false)
      .is("driver_transfer_id", null)
      .select("id")
      .maybeSingle();

    if (lockErr) {
      return json({ error: "Failed to lock taxi payout" }, 500);
    }

    if (!locked) {
      const { data: current } = await supabaseAdmin
        .from("taxi_commissions")
        .select("driver_paid_out, driver_transfer_id")
        .eq("id", commission.id)
        .maybeSingle();

      if (current?.driver_paid_out && current.driver_transfer_id) {
        return json({
          ok: true,
          already_succeeded: true,
          taxi_ride_id: rideId,
          transfer_id: current.driver_transfer_id,
        });
      }

      return json({ error: "Taxi payout lock race — retry later" }, 409);
    }

    let transfer: Stripe.Transfer;

    try {
      transfer = await stripe.transfers.create(
        {
          amount: stripeTransferAmount,
          currency,
          destination,
          transfer_group: transferGroup,
          source_transaction: sourceChargeId,
          metadata: {
            module: "taxi",
            taxi_ride_id: rideId,
            taxi_commission_id: commission.id,
            driver_id: ride.driver_id,
            amount_cents: String(amount),
          },
        },
        { idempotencyKey }
      );
    } catch (e) {
      await supabaseAdmin
        .from("taxi_commissions")
        .update({
          driver_paid_out: false,
          driver_paid_out_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", commission.id)
        .eq("driver_transfer_id", null);

      console.error("[taxi-run] transfer create failed", e);
      return json({ error: "Stripe transfer failed" }, 500);
    }

    const nowIso = new Date().toISOString();
    const { error: saveErr } = await supabaseAdmin
      .from("taxi_commissions")
      .update({
        driver_transfer_id: transfer.id,
        driver_paid_out: true,
        driver_paid_out_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", commission.id);

    if (saveErr) {
      return json(
        {
          error: "Transfer created but commission update failed",
          transfer_id: transfer.id,
        },
        500
      );
    }

    await logTaxiEventServer(supabaseAdmin, {
      rideId,
      eventType: "driver_payout",
      triggeredRole: "admin",
      actorId: actor.startsWith("secret:") ? null : actor,
      description: "Driver taxi payout transfer",
      metadata: {
        transfer_id: transfer.id,
        amount,
        stripe_amount: stripeTransferAmount,
        currency,
      },
    });

    if (!actor.startsWith("secret:")) {
      await writeAdminAuditServer({
        supabaseAdmin,
        adminUserId: actor,
        action: "taxi_payout_transfer",
        targetType: "taxi_ride",
        targetId: rideId,
        newValues: {
          transfer_id: transfer.id,
          amount,
          stripe_amount: stripeTransferAmount,
          currency,
          destination,
        },
        metadata: {
          commission_id: commission.id,
        },
        request: req,
      });
    }

    return json({
      ok: true,
      dry_run: false,
      taxi_ride_id: rideId,
      transfer_id: transfer.id,
      amount,
      stripe_amount: stripeTransferAmount,
      currency,
      idempotency_key: idempotencyKey,
    });
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return json({ error: "Forbidden" }, e.status);
    }

    console.error("[taxi-run] fatal error", e);
    return json({ error: "Internal server error" }, 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
