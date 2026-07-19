import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { computeCreditApplication, type CreditMode } from "@/lib/loyalty/loyaltyProgram";
import {
  reserveEntityCredit,
  releaseEntityCredit,
  type CreditEntityType,
} from "@/lib/loyalty/loyaltyCredit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EntityInfo = {
  ownerId: string | null;
  currency: string;
  payableBeforeCreditCents: number;
  paid: boolean;
  terminal: boolean;
};

const ENTITY_TYPES: CreditEntityType[] = ["food_order", "delivery_request", "taxi_ride"];

function toInt(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : 0;
}

async function loadEntity(
  admin: SupabaseClient,
  entityType: CreditEntityType,
  entityId: string
): Promise<EntityInfo | null> {
  if (entityType === "taxi_ride") {
    const { data } = await admin
      .from("taxi_rides")
      .select(
        "id,client_user_id,currency,payment_status,status,gross_total_cents,total_cents,discount_cents,loyalty_discount_cents,shared_discount_cents"
      )
      .eq("id", entityId)
      .maybeSingle();
    if (!data) return null;
    const gross = toInt(data.gross_total_cents) || toInt(data.total_cents);
    const discounts =
      toInt(data.discount_cents) +
      toInt(data.loyalty_discount_cents) +
      toInt(data.shared_discount_cents);
    return {
      ownerId: data.client_user_id ?? null,
      currency: String(data.currency ?? "USD"),
      payableBeforeCreditCents: Math.max(0, gross - discounts),
      paid: String(data.payment_status ?? "").toLowerCase() === "paid",
      terminal: ["canceled", "cancelled", "completed"].includes(
        String(data.status ?? "").toLowerCase()
      ),
    };
  }

  const table = entityType === "food_order" ? "orders" : "delivery_requests";
  const { data } = await admin
    .from(table)
    .select(
      entityType === "food_order"
        ? "id,client_user_id,created_by,currency,payment_status,status,total_cents,total"
        : "id,client_user_id,created_by,currency,payment_status,status,total_cents,total"
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const payable =
    toInt(row.total_cents) || Math.round(Number(row.total ?? 0) * 100);
  return {
    ownerId: (row.client_user_id ?? row.created_by ?? null) as string | null,
    currency: String(row.currency ?? "USD"),
    payableBeforeCreditCents: Math.max(0, payable),
    paid: String(row.payment_status ?? "").toLowerCase() === "paid",
    terminal: ["canceled", "cancelled", "delivered", "completed"].includes(
      String(row.status ?? "").toLowerCase()
    ),
  };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;
    const admin = auth.supabaseAdmin;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const entityType = String(body.entity_type ?? "") as CreditEntityType;
    const entityId = String(body.entity_id ?? "").trim();
    const mode = (String(body.mode ?? "none") as CreditMode) || "none";
    const requestedCents = Math.max(0, toInt(body.amount_cents));

    if (!ENTITY_TYPES.includes(entityType) || !entityId) {
      return taxiJson({ ok: false, error: "invalid_entity" }, 400);
    }
    if (!["none", "partial", "max"].includes(mode)) {
      return taxiJson({ ok: false, error: "invalid_mode" }, 400);
    }

    const info = await loadEntity(admin, entityType, entityId);
    if (!info) return taxiJson({ ok: false, error: "entity_not_found" }, 404);
    if (info.ownerId !== auth.user.id) {
      return taxiJson({ ok: false, error: "forbidden" }, 403);
    }
    if (info.paid) return taxiJson({ ok: false, error: "already_paid" }, 409);
    if (info.terminal) return taxiJson({ ok: false, error: "entity_not_open" }, 409);

    const gross = info.payableBeforeCreditCents;

    // Mode "none" (or nothing to apply): release any prior hold and clear applied.
    if (mode === "none") {
      await releaseEntityCredit(admin, entityType, entityId);
      await persistApplied(admin, entityType, entityId, 0, gross);
      return taxiJson({
        ok: true,
        currency: info.currency,
        subtotal_cents: gross,
        credit_applied_cents: 0,
        net_to_pay_cents: gross,
      });
    }

    const plan = computeCreditApplication({
      grossCents: gross,
      availableCents: Number.MAX_SAFE_INTEGER, // DB clamps to real available
      mode,
      requestedCents,
    });

    const reservation = await reserveEntityCredit(admin, {
      userId: auth.user.id,
      entityType,
      entityId,
      requestedCents: mode === "max" ? plan.maxApplicableCents : requestedCents,
      maxApplicableCents: plan.maxApplicableCents,
      currency: info.currency,
    });

    if (!reservation.ok) {
      return taxiJson(
        { ok: false, error: reservation.error ?? "reserve_failed" },
        reservation.error === "currency_mismatch" ? 409 : 400
      );
    }

    const applied = Math.max(0, Math.min(reservation.amountCents, plan.maxApplicableCents));
    await persistApplied(admin, entityType, entityId, applied, gross);

    return taxiJson({
      ok: true,
      currency: info.currency,
      subtotal_cents: gross,
      credit_applied_cents: applied,
      net_to_pay_cents: gross - applied,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

async function persistApplied(
  admin: SupabaseClient,
  entityType: CreditEntityType,
  entityId: string,
  appliedCents: number,
  grossCents: number
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (entityType === "taxi_ride") {
    await admin
      .from("taxi_rides")
      .update({
        mmd_credit_applied_cents: appliedCents,
        total_cents: Math.max(0, grossCents - appliedCents),
        updated_at: nowIso,
      })
      .eq("id", entityId)
      .neq("payment_status", "paid");
    return;
  }
  const table = entityType === "food_order" ? "orders" : "delivery_requests";
  await admin
    .from(table)
    .update({
      mmd_credit_applied_cents: appliedCents,
      net_charge_cents: appliedCents > 0 ? Math.max(0, grossCents - appliedCents) : null,
      updated_at: nowIso,
    })
    .eq("id", entityId)
    .neq("payment_status", "paid");
}
